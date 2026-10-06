/* rain.js — the living pane. Two hero-only canvases:
   #city (static, 0.5x, bokeh + silhouettes + wet-street mirror)
   #pane (animated: streaks → ripples → fog composite → glass drops)
   Nothing is allocated per frame; all layout reads happen on resize/theme. */
(function () {
  'use strict';

  var R = {};
  // fogC is a WHITE coverage mask: repeated destination-out on a dark premultiplied colour rounds the
  // colour to black faster than the alpha, leaving a dark smear; on white both round identically.
  // fogOut = fogTex clipped by that mask, rebuilt only when either changes.
  var hero, cityC, paneC, cityX, paneX, fogC, fogX, fogOut, fogOutX, fogDirty = true, lampEl;
  var fogTex, fogTexX, blur1, blur2; // frosted-glass fog: a blurred copy of the city glow (built on resize/theme only)
  var W = 0, H = 0, dpr = 1, dprA = .5, fogS = .5;
  var pal = {};
  var reduced = false, fine = false, theme = 'night', scene = 'hero';
  var running = false, rafId = 0, lastT = 0, now = 0, tAcc = 0;
  var intensity = .7, targetI = .7;
  var burst = 0, burstStart = -1, nextBurst = 0;
  var wind = 0, gustStart = -1, gustDir = 0, nextGust = 0;
  var px = 0, py = 0, tpx = 0, tpy = 0, lampX = -1, lampY = -1, lampTX = 0, lampTY = 0;
  var tier = 0, tierAt = 0, ftimes = new Float32Array(120), fi = 0, ffill = 0, dprCap = 2, refillAcc = 0;
  var cfg = null;
  var streaks, streakN, farN;
  var drops, dropN, staticN, sliderCap, slots, trails, trailHead, trailPts = 24;
  var ripples, rippleCap, rippleUse = 0, dotsX = new Float32Array(48), dotsY = new Float32Array(48), dotsN = 0;
  var lit = [], litN = 0, litX = new Float32Array(8), litY = new Float32Array(8), litR2 = new Float32Array(8);
  var batch = [], batchN = new Int32Array(5);
  var sprDrop, sprHi, sprBrush, sprBokeh = [];
  var nameRect = null, bandTop = 0, margin = 60;
  var lastWipe = -1e9, fogFull = true, wipeTravel = 0, lastWX = -1, lastWY = -1, spawnBudget = 0, spawnAt = 0;
  var flash = 0, flashAt = -1e9, nextFlash = 0;
  var nameCrossAt = -1e9;
  var loadWipe = null, refractOn = true;
  var hooks = {};
  var rand = Math.random;
  var PI = Math.PI;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rr(a, b) { return a + rand() * (b - a); }
  function easeOut(p) { return 1 - (1 - p) * (1 - p) * (1 - p); }
  function easeInOut(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  /* ---------- palette ---------- */
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    function g(n) { return cs.getPropertyValue(n).trim(); }
    pal = {
      rain: g('--rain-rgb') || '190,205,225',
      ripple: g('--ripple-rgb') || '190,205,225',
      rippleA: parseFloat(g('--ripple-a')) || .35,
      fog: g('--fog-rgb') || '26,34,56',
      skyTop: g('--sky-top') || '#070A12',
      skyBottom: g('--sky-bottom') || '#0D1322',
      fogD: parseFloat(g('--fog-density')) || .5,
      glassHi: g('--glass-hi') || 'rgba(205,222,245,.55)',
      drop: g('--drop-rgb') || '200,220,255',
      dropArc: parseFloat(g('--drop-arc-a')) || .35,
      sil: g('--silhouette-rgb') || '10,15,26',
      silA: parseFloat(g('--silhouette-a')) || .85,
      amber: g('--bokeh-amber') || '232,184,109',
      cold: g('--bokeh-cold') || '200,214,240',
      cyan: g('--bokeh-cyan') || '127,183,201',
      magenta: g('--bokeh-magenta') || '216,111,168'
    };
    theme = document.documentElement.getAttribute('data-theme') === 'day' ? 'day' : 'night';
  }

  /* ---------- sprites ---------- */
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function buildSprites() {
    // glass drop (64px)
    sprDrop = mk(64, 64);
    var x = sprDrop.getContext('2d'), r = 30, cx = 32, cy = 32;
    var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(' + pal.drop + ',.05)'); g.addColorStop(.78, 'rgba(' + pal.drop + ',.11)'); g.addColorStop(1, 'rgba(' + pal.drop + ',.26)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, PI * 2); x.fill();
    x.strokeStyle = 'rgba(0,0,0,' + pal.dropArc + ')'; x.lineWidth = 1.4; x.beginPath(); x.arc(cx, cy, r - .8, PI * .08, PI * .6); x.stroke();
    x.fillStyle = pal.glassHi; x.globalAlpha = .5; x.beginPath(); x.arc(cx - r * .42, cy - r * .42, r * .28, 0, PI * 2); x.fill();
    x.globalAlpha = 1;
    // highlight-only sprite (lightning boost)
    sprHi = mk(64, 64); x = sprHi.getContext('2d');
    x.fillStyle = pal.glassHi; x.beginPath(); x.arc(cx - r * .42, cy - r * .42, r * .3, 0, PI * 2); x.fill();
    // brush (128px soft disc, alpha only)
    sprBrush = mk(128, 128); x = sprBrush.getContext('2d');
    g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.45, 'rgba(0,0,0,.85)'); g.addColorStop(.8, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    // bokeh sprites: 4 colours × 3 sizes
    var cols = [pal.amber, pal.cold, pal.cyan, pal.magenta], sizes = [32, 64, 128];
    sprBokeh = [];
    for (var c = 0; c < 4; c++) {
      sprBokeh[c] = [];
      for (var s = 0; s < 3; s++) {
        var sz = sizes[s], cv = mk(sz, sz), cxx = cv.getContext('2d'), hr = sz / 2;
        var gg = cxx.createRadialGradient(hr, hr, 0, hr, hr, hr);
        gg.addColorStop(0, 'rgba(' + cols[c] + ',.82)'); gg.addColorStop(.72, 'rgba(' + cols[c] + ',.9)');
        gg.addColorStop(.93, 'rgba(' + cols[c] + ',.55)'); gg.addColorStop(1, 'rgba(' + cols[c] + ',0)');
        cxx.fillStyle = gg; cxx.beginPath(); cxx.arc(hr, hr, hr, 0, PI * 2); cxx.fill();
        sprBokeh[c][s] = cv;
      }
    }
  }

  /* ---------- configuration ---------- */
  function config(w, h) {
    var bp = w <= 480 ? 0 : w <= 1024 ? 1 : 2;
    var base = [
      { streaks: 90, statics: 16, sliders: 2, ripples: 12, bokeh: 40, sil: 7, ref: 390 * 844 },
      { streaks: 150, statics: 24, sliders: 3, ripples: 18, bokeh: 62, sil: 9, ref: 820 * 1180 },
      { streaks: 220, statics: 34, sliders: 4, ripples: 24, bokeh: 88, sil: 12, ref: 1440 * 900 }
    ][bp];
    var s = clamp((w * h) / base.ref, .35, 1);
    return {
      streaks: Math.round(base.streaks * s), statics: Math.round(base.statics * s), sliders: base.sliders,
      ripples: Math.round(base.ripples * s), bokeh: Math.round(base.bokeh * s), sil: base.sil
    };
  }

  /* ---------- particles ---------- */
  function initStreak(i, anyY) {
    var o = i * 6, far = (i % 20) < 9;
    streaks[o] = rr(-margin, W + margin);
    streaks[o + 1] = anyY ? rr(-H * .2, H) : rr(-H * .3, -10);
    streaks[o + 2] = far ? rr(10, 18) : rr(18, 30);
    streaks[o + 3] = far ? rr(520, 700) : rr(760, 980);
    streaks[o + 4] = far ? rr(.10, .16) : rr(.18, .38);
    streaks[o + 5] = far ? 0 : 1;
  }
  function placeDrop(i, small) {
    var o = i * 6;
    drops[o] = rr(8, W - 8); drops[o + 1] = rr(8, H - 8);
    drops[o + 2] = small ? rr(2, 3) : rr(2, 6.2);
    drops[o + 3] = 0; drops[o + 4] = 0; drops[o + 5] = now + rr(3000, 12000);
  }
  function build() {
    var c = cfg;
    streakN = c.streaks; streaks = new Float32Array(streakN * 6);
    for (var i = 0; i < streakN; i++) initStreak(i, true);
    batch = []; for (i = 0; i < 5; i++) batch[i] = new Int32Array(streakN);
    staticN = c.statics; dropN = staticN + 10; drops = new Float32Array(dropN * 6);
    for (i = 0; i < dropN; i++) { placeDrop(i, false); if (i >= staticN) drops[i * 6 + 4] = 3; }
    sliderCap = c.sliders; slots = new Int16Array(sliderCap); trailHead = new Int16Array(sliderCap);
    for (i = 0; i < sliderCap; i++) slots[i] = -1;
    trails = new Float32Array(sliderCap * trailPts * 4);
    for (i = 0; i < trails.length; i += 4) trails[i + 3] = -1e9;
    rippleCap = c.ripples; ripples = new Float32Array(rippleCap * 4); rippleUse = 0;
  }
  function reposition(ow, oh) {
    var sx = W / ow, sy = H / oh, i, o;
    for (i = 0; i < streakN; i++) { o = i * 6; streaks[o] *= sx; streaks[o + 1] *= sy; }
    for (i = 0; i < dropN; i++) { o = i * 6; drops[o] *= sx; drops[o + 1] *= sy; }
    for (i = 0; i < rippleCap; i++) { o = i * 4; ripples[o] *= sx; ripples[o + 1] *= sy; }
    for (i = 0; i < trails.length; i += 4) { trails[i] *= sx; trails[i + 1] *= sy; }
  }

  /* ---------- sizing ---------- */
  function size(w, h) {
    var ow = W, oh = H;
    W = w; H = h;
    dpr = Math.min(window.devicePixelRatio || 1, W < 500 ? 1.5 : 2, dprCap);
    dprA = dpr * .5; fogS = .5;
    paneC.width = Math.round(W * dpr); paneC.height = Math.round(H * dpr);
    paneX.setTransform(dpr, 0, 0, dpr, 0, 0);
    cityC.width = Math.round(W * dprA); cityC.height = Math.round(H * dprA);
    fogC.width = Math.max(1, Math.round(W * fogS)); fogC.height = Math.max(1, Math.round(H * fogS));
    fogOut.width = fogC.width; fogOut.height = fogC.height;
    bandTop = H * .87;
    var nc = config(W, H);
    if (!cfg || nc.streaks !== cfg.streaks || nc.statics !== cfg.statics || nc.sliders !== cfg.sliders || nc.ripples !== cfg.ripples) { cfg = nc; build(); }
    else if (ow && oh) reposition(ow, oh);
    cfg = nc;
    drawCity();
    makeFogTexture();
    fillFog(1);
    if (reduced) { stampBand(); drawStill(); }
  }
  function fogLayer() {
    if (fogDirty) {
      fogOutX.globalCompositeOperation = 'source-over'; fogOutX.globalAlpha = 1;
      fogOutX.clearRect(0, 0, fogOut.width, fogOut.height);
      fogOutX.drawImage(fogTex, 0, 0, fogOut.width, fogOut.height);
      fogOutX.globalCompositeOperation = 'destination-in';
      fogOutX.drawImage(fogC, 0, 0);
      fogOutX.globalCompositeOperation = 'source-over';
      fogDirty = false;
    }
    return fogOut;
  }
  function fillFog(a) {
    fogX.globalCompositeOperation = 'source-over';
    fogX.globalAlpha = a >= 1 ? 1 : a;
    fogX.fillStyle = '#fff'; fogX.fillRect(0, 0, fogC.width, fogC.height);
    fogX.globalAlpha = 1; fogDirty = true;
    if (a >= 1) fogFull = true;
  }
  function recolorFog() {
    fogDirty = true; // the mask is colourless; only the clipped layer needs rebuilding
  }
  // Frosted glass: the fog is not a flat tint but the city's own glow, blurred twice (1/8 and 1/32
  // downsamples drawn back up), plus a few soft blooms and the room lamp's warm scatter bottom-left.
  function makeFogTexture() {
    var fw = fogC.width, fh = fogC.height, night = theme === 'night';
    fogDirty = true;
    fogTex.width = fw; fogTex.height = fh;
    var c = fogTexX, i, x, y, r, g;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    // base = the sky gradient it sits on: composited at --fog-density this is luminance-neutral,
    // so a wipe never darkens the glass; the fog only reads through the blurred glow below
    var sg = c.createLinearGradient(0, 0, 0, fh);
    sg.addColorStop(0, pal.skyTop); sg.addColorStop(1, pal.skyBottom);
    c.fillStyle = sg; c.fillRect(0, 0, fw, fh);
    if (!night) { c.fillStyle = 'rgba(' + pal.fog + ',.12)'; c.fillRect(0, 0, fw, fh); }
    var w1 = Math.max(8, Math.round(fw / 8)), h1 = Math.max(8, Math.round(fh / 8));
    var w2 = Math.max(4, Math.round(fw / 32)), h2 = Math.max(4, Math.round(fh / 32));
    blur1.width = w1; blur1.height = h1; blur2.width = w2; blur2.height = h2;
    var b1 = blur1.getContext('2d'), b2 = blur2.getContext('2d');
    b1.clearRect(0, 0, w1, h1); b1.drawImage(cityC, 0, 0, w1, h1);
    b2.clearRect(0, 0, w2, h2); b2.drawImage(blur1, 0, 0, w2, h2);
    // the frosted glow must stay a touch darker than the sharp city, so a wipe reads as clear glass, not a dark smear
    c.globalAlpha = night ? .6 : .5; c.drawImage(blur2, 0, 0, fw, fh);
    c.globalAlpha = night ? .3 : .25; c.drawImage(blur1, 0, 0, fw, fh);
    c.globalAlpha = 1;
    var light = night ? '64,76,104' : '255,255,255', warm = night ? '120,98,70' : '255,255,255', m = Math.max(fw, fh);
    for (i = 0; i < 6; i++) {
      x = rand() * fw; y = rand() * fh; r = (.18 + rand() * .3) * m;
      g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(' + light + ',.025)'); g.addColorStop(1, 'rgba(' + light + ',0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g = c.createRadialGradient(fw * .2, fh * 1.05, 0, fw * .2, fh * 1.05, m * .5);
    g.addColorStop(0, 'rgba(' + warm + ',.1)'); g.addColorStop(.5, 'rgba(' + warm + ',.035)'); g.addColorStop(1, 'rgba(' + warm + ',0)');
    c.fillStyle = g; c.fillRect(0, 0, fw, fh);
  }

  /* ---------- canvas A: the city ---------- */
  function drawCity() {
    var x = cityX, i;
    x.setTransform(dprA, 0, 0, dprA, 0, 0);
    x.clearRect(0, 0, W, H);
    lit = []; litN = 0;
    var ground = H * .87, n = cfg.bokeh, items = [];
    if (theme === 'night') {
      // bokeh in slanted floor lines (lower 60%) + dense amber street band (bottom 15%)
      var lines = [[.44, .03], [.56, -.02], [.67, .035], [.78, -.015]];
      var nLines = Math.round(n * .6), nStreet = n - nLines;
      for (i = 0; i < nLines; i++) {
        var L = lines[i % 4], bx = rr(0, W), by = H * L[0] + (bx - W / 2) * L[1] + rr(-H * .025, H * .025);
        var depth = i % 4, r = rr(5, 14) + depth * rr(2, 7);
        items.push({ x: bx, y: by, r: r, c: pickColor(), a: rr(.12, .22) * (1 - (r - 5) / 90) });
      }
      for (i = 0; i < nStreet; i++) {
        var sv = rand();
        items.push({ x: rr(0, W), y: ground - rr(0, H * .13), r: rr(6, 26), c: sv < .8 ? 0 : sv < .95 ? 1 : 2, a: rr(.13, .22) });
      }
      var mag = 0;
      for (i = 0; i < items.length; i++) { if (items[i].c === 3) { mag++; if (mag > 2) items[i].c = 0; } }
      for (i = 0; i < items.length; i++) blit(items[i], 1);
      // silhouettes with 5% lit windows
      x.fillStyle = 'rgba(' + pal.sil + ',' + pal.silA + ')';
      var sil = cfg.sil, bw = W / sil, cx0 = -bw * .3;
      for (i = 0; i < sil; i++) {
        var w = bw * rr(.55, 1.25), hgt = H * rr(.1, .3), bx2 = cx0 + rr(-bw * .2, bw * .2);
        x.fillRect(bx2, ground - hgt, w, hgt);
        x.fillStyle = 'rgba(' + pal.amber + ',.55)';
        for (var wx = bx2 + 6; wx < bx2 + w - 6; wx += 9) for (var wy = ground - hgt + 8; wy < ground - 6; wy += 11) if (rand() < .05) x.fillRect(wx, wy, 3, 4);
        x.fillStyle = 'rgba(' + pal.sil + ',' + pal.silA + ')';
        cx0 += w * rr(.8, 1.1);
      }
      // wet-street mirror: bokeh above ground mirrored into the bottom 13%, stretched x2.5
      x.save(); x.beginPath(); x.rect(0, ground, W, H - ground); x.clip();
      for (i = 0; i < items.length; i++) {
        var it = items[i], d = ground - it.y; if (d < 0 || d > H * .32) continue;
        x.globalAlpha = Math.min(.3 * it.a / .22 * .9 + .01, .3);
        var sp = sprBokeh[it.c][2];
        x.drawImage(sp, it.x - it.r, ground + d * .3 - it.r * 2.5, it.r * 2, it.r * 5);
      }
      x.globalAlpha = 1;
      for (i = 0; i < 8; i++) {
        var sx = rr(W * .05, W * .95), gl = x.createLinearGradient(0, ground, 0, H);
        gl.addColorStop(0, 'rgba(' + pal.amber + ',.18)'); gl.addColorStop(1, 'rgba(' + pal.amber + ',0)');
        x.fillStyle = gl; x.fillRect(sx, ground, rr(1, 3), H - ground);
      }
      x.restore();
    } else {
      // day: 8 grey cloud blobs + 3 dim lit signs; towers in mist; grey-blue street mirror
      for (i = 0; i < 8; i++) {
        var cw = rr(W * .18, W * .4), ch = cw * rr(.28, .45), cx1 = rr(0, W), cy1 = rr(H * .05, H * .55);
        x.save(); x.translate(cx1, cy1); x.scale(1, ch / cw); x.globalAlpha = .12;
        x.drawImage(sprBokeh[1][2], -cw / 2, -cw / 2, cw, cw); x.restore();
      }
      x.globalAlpha = 1;
      // towers in mist: a far tier (wide, low, faint) behind a near tier (narrower), overlapping,
      // capped well below the name so the skyline sits in the bottom quarter
      var maxH = Math.max(H * .1, ground - (nameRect ? nameRect.bottom + 48 : H * .55));
      for (var tierN = 0; tierN < 2; tierN++) {
        var far = tierN === 0, sil2 = far ? Math.round(cfg.sil * .8) : cfg.sil, bw2 = W / sil2, cx2 = -bw2 * rr(.1, .5);
        var aMul2 = far ? .45 : 1;
        while (cx2 < W) {
          var w2 = bw2 * (far ? rr(.6, 1.2) : rr(.3, .85)), h2 = Math.min(maxH, H * (far ? rr(.07, .17) : rr(.09, .24))), bx3 = cx2;
          var gv = x.createLinearGradient(0, ground - h2, 0, ground);
          gv.addColorStop(0, 'rgba(' + pal.sil + ',' + (pal.silA * .25 * aMul2).toFixed(3) + ')');
          gv.addColorStop(.6, 'rgba(' + pal.sil + ',' + (pal.silA * .7 * aMul2).toFixed(3) + ')');
          gv.addColorStop(1, 'rgba(' + pal.sil + ',' + (pal.silA * 1.2 * aMul2).toFixed(3) + ')');
          x.fillStyle = gv; x.fillRect(bx3, ground - h2, w2, h2);
          if (!far) {
            x.fillStyle = 'rgba(255,255,255,.35)';
            for (var wx2 = bx3 + 5; wx2 < bx3 + w2 - 6; wx2 += 8) for (var wy2 = ground - h2 + 8; wy2 < ground - 8; wy2 += 11) if (rand() < .05) x.fillRect(wx2, wy2, 3, 4);
          }
          cx2 += w2 * rr(.55, .95) + (rand() < .25 ? bw2 * rr(.2, .5) : 0);
        }
      }
      // mist swallows the skyline toward the left/right edges
      x.save(); x.globalCompositeOperation = 'destination-out';
      var me = x.createLinearGradient(0, 0, W, 0);
      me.addColorStop(0, 'rgba(0,0,0,.55)'); me.addColorStop(.22, 'rgba(0,0,0,0)'); me.addColorStop(.78, 'rgba(0,0,0,0)'); me.addColorStop(1, 'rgba(0,0,0,.55)');
      x.fillStyle = me; x.fillRect(0, ground - H * .3, W, H * .3); x.restore();
      for (i = 0; i < 4; i++) {
        items.push({ x: rr(W * .1, W * .9), y: ground - rr(H * .06, H * .2), r: rr(14, 26), c: 0, a: .13 });
      }
      for (i = 0; i < items.length; i++) blit(items[i], 1);
      var gm = x.createLinearGradient(0, ground, 0, H);
      gm.addColorStop(0, 'rgba(120,140,160,.22)'); gm.addColorStop(1, 'rgba(120,140,160,0)');
      x.fillStyle = gm; x.fillRect(0, ground, W, H - ground);
      x.save(); x.beginPath(); x.rect(0, ground, W, H - ground); x.clip();
      for (i = 0; i < items.length; i++) {
        var it2 = items[i], d2 = ground - it2.y; x.globalAlpha = .1;
        x.drawImage(sprBokeh[0][2], it2.x - it2.r, ground + d2 * .3 - it2.r * 2.5, it2.r * 2, it2.r * 5);
      }
      x.globalAlpha = 1; x.restore();
    }
    // export the 8 brightest lamps (hero coords)
    items.sort(function (a, b) { return b.a * b.r - a.a * a.r; });
    for (i = 0; i < Math.min(8, items.length); i++) lit.push({ x: items[i].x, y: items[i].y, r: items[i].r * .9, c: items[i].c === 3 ? 1 : items[i].c });
    litN = lit.length;
    if (hooks.onCity) hooks.onCity();

    function blit(it, mul) {
      var s = it.r < 10 ? 0 : it.r < 24 ? 1 : 2;
      x.globalAlpha = Math.min(it.a * mul, .22);
      x.drawImage(sprBokeh[it.c][s], it.x - it.r, it.y - it.r, it.r * 2, it.r * 2);
      x.globalAlpha = 1;
    }
  }
  function pickColor() { var v = rand(); return v < .62 ? 0 : v < .9 ? 1 : v < .98 ? 2 : 3; }

  /* ---------- fog ---------- */
  function brushR() { return clamp(W * .06, 28, 56); }
  function stamp(x, y, r, a) {
    fogX.globalCompositeOperation = 'destination-out';
    fogX.globalAlpha = a || 1;
    fogX.drawImage(sprBrush, (x - r) * fogS, (y - r) * fogS, r * 2 * fogS, r * 2 * fogS);
    fogX.globalCompositeOperation = 'source-over'; fogX.globalAlpha = 1; fogDirty = true;
    fogFull = false;
  }
  function wipeLine(x0, y0, x1, y1, r, a, r1) {
    var dx = x1 - x0, dy = y1 - y0, d = Math.sqrt(dx * dx + dy * dy), n = Math.max(1, Math.ceil(d / 4));
    if (r1 === undefined) r1 = r;
    for (var i = 1; i <= n; i++) stamp(x0 + dx * i / n, y0 + dy * i / n, r + (r1 - r) * i / n, a);
  }
  // the load swipe is a finger, not a rectangle: thin where it lands and lifts, lighter pressure
  function bandR(r, p) { return r * (.45 + .55 * Math.sin(PI * p)); }
  function stampBand() {
    if (!nameRect) return;
    var r = brushR() * 1.4, cy = (nameRect.top + nameRect.bottom) / 2, x0 = nameRect.left - 1.5 * r, x1 = nameRect.right + 1.5 * r;
    for (var i = 0; i < 24; i++) wipeLine(x0 + (x1 - x0) * i / 24, cy, x0 + (x1 - x0) * (i + 1) / 24, cy, bandR(r, i / 24), .8, bandR(r, (i + 1) / 24));
  }
  // user wipe (hero coords)
  function wipeAt(x, y) {
    var r = brushR();
    if (lastWX < 0) { stamp(x, y, r); }
    else {
      var dx = x - lastWX, dy = y - lastWY, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 220) { stamp(x, y, r); } else { wipeLine(lastWX, lastWY, x, y, r); wipeTravel += d; }
    }
    lastWX = x; lastWY = y; lastWipe = now;
    if (wipeTravel >= 120) {
      wipeTravel = 0;
      if (now - spawnAt > 1000) { spawnBudget = 6; spawnAt = now; }
      if (spawnBudget >= 2) { spawnBudget -= 2; spawnSmall(x + rr(-r, r), y + rr(-r, r)); spawnSmall(x + rr(-r, r), y + rr(-r, r)); }
    }
    if (reduced) { drawStill(); }
    if (hooks.onWipe) hooks.onWipe();
  }
  function endWipe() { lastWX = -1; lastWY = -1; }
  function spawnSmall(x, y) {
    var best = -1, bi = -1, i, o;
    for (i = 0; i < dropN; i++) { o = i * 6; if (drops[o + 4] === 3) { bi = i; break; } }
    if (bi < 0) { for (i = 0; i < dropN; i++) { o = i * 6; if (drops[o + 4] === 0 && (best < 0 || drops[o + 2] < drops[best * 6 + 2])) best = i; } bi = best; }
    if (bi < 0) return;
    o = bi * 6; drops[o] = clamp(x, 4, W - 4); drops[o + 1] = clamp(y, 4, H - 4); drops[o + 2] = rr(2, 3); drops[o + 3] = 0; drops[o + 4] = 0; drops[o + 5] = now + rr(3000, 12000);
  }

  /* ---------- wind ---------- */
  function updateWind() {
    var base = Math.sin(tAcc / 70000 * PI * 2) * .12, g = 0;
    if (gustStart < 0) { if (now >= nextGust) { gustStart = now; gustDir = rand() < .5 ? -.35 : .35; } }
    if (gustStart >= 0) {
      var e = now - gustStart;
      if (e < 1000) g = gustDir * easeInOut(e / 1000);
      else if (e < 4000) g = gustDir;
      else if (e < 6000) g = gustDir * (1 - easeInOut((e - 4000) / 2000));
      else { gustStart = -1; nextGust = now + rr(40000, 90000); }
    }
    wind = base + g;
  }

  /* ---------- frame ---------- */
  function frame(t) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    var rawDt = t - lastT, dt = Math.min(rawDt, 50); lastT = t; now = t; tAcc += dt;
    var dts = dt / 1000;
    updateWind();
    intensity += (targetI - intensity) * Math.min(1, dts / .9);
    // burst (急雨)
    if (burstStart < 0 && now >= nextBurst) { burstStart = now; gustStart = now; gustDir = wind >= 0 ? .35 : -.35; if (hooks.onBurst) hooks.onBurst(true); }
    if (burstStart >= 0) {
      var be = now - burstStart;
      burst = be < 2000 ? easeInOut(be / 2000) : be < 7000 ? 1 : be < 10000 ? 1 - easeInOut((be - 7000) / 3000) : 0;
      if (be >= 10000) { burstStart = -1; nextBurst = now + rr(50000, 100000); if (hooks.onBurst) hooks.onBurst(false); }
    }
    var I = clamp(intensity + burst * .3, 0, 1);
    // lightning
    if (now >= nextFlash) {
      if (scene === 'hero' && theme === 'night' && !document.hidden) { flashAt = now; if (hooks.onFlash) hooks.onFlash(); }
      nextFlash = now + rr(35000, 80000);
    }
    var fe = now - flashAt; flash = fe < 120 ? fe / 120 : fe < 920 ? 1 - (fe - 120) / 800 : 0;
    // parallax lerp
    if (fine) {
      px += (tpx - px) * .06; py += (tpy - py) * .06;
      cityC.style.transform = 'translate(' + (px * 12).toFixed(2) + 'px,' + (py * 8).toFixed(2) + 'px)';
      if (lampEl && lampX >= 0) { lampX += (lampTX - lampX) * .18; lampY += (lampTY - lampY) * .18; lampEl.style.transform = 'translate(' + lampX.toFixed(1) + 'px,' + lampY.toFixed(1) + 'px)'; }
    }
    var x = paneX;
    x.clearRect(0, 0, W, H);
    drawStreaks(dts, I);
    drawRipples();
    // fog: refill, composite
    if (!reduced && tier < 2) {
      if (!fogFull) {
        if (now - lastWipe > 12000) { fillFog(1); refillAcc = 0; }
        else {
          refillAcc += 1 - Math.pow(1 - .0048, dt / 16.667);
          if (refillAcc >= .03) { fillFog(refillAcc); refillAcc = 0; }
        }
      }
    }
    x.globalAlpha = pal.fogD; x.drawImage(fogLayer(), 0, 0, W, H); x.globalAlpha = 1;
    updateDrops(dts, I);
    drawDrops();
    // watchdog
    ftimes[fi] = Math.min(rawDt, 100); fi = (fi + 1) % 120; if (ffill < 120) ffill++;
    if (ffill === 120 && (fi & 15) === 0) {
      var s = 0; for (var i = 0; i < 120; i++) s += ftimes[i]; s /= 120;
      if (s > 24) {
        if (tier === 0) {
          tier = 1; tierAt = now;
          // the fog/pane composite is fill-bound: drop the pane to 1x once, then keep going
          if (dpr > 1) { dprCap = 1; size(W, H); }
        } else if (tier === 1 && now - tierAt > 5000) {
          tier = 2;
          var oldCap = rippleCap; rippleCap = Math.max(4, rippleCap >> 1);
          for (var k = rippleCap; k < oldCap; k++) ripples[k * 4 + 3] = 0;
          rippleUse = 0; for (k = 0; k < rippleCap; k++) if (ripples[k * 4 + 3] !== 0) rippleUse++;
        }
      } else if (tier === 1) tierAt = now;
    }
  }

  function drawStreaks(dts, I) {
    var x = paneX, active = Math.round(streakN * (.3 + .7 * I) * (tier === 0 ? 1 : tier === 1 ? .65 : .5));
    var aMul = .6 + .4 * I, lw = dpr >= 1.5 ? 1.25 : 1, i, o, k, b;
    for (k = 0; k < litN; k++) { litX[k] = lit[k].x + px * 7; litY[k] = lit[k].y + py * 5; litR2[k] = lit[k].r * lit[k].r; }
    for (b = 0; b < 5; b++) batchN[b] = 0;
    // update + classify into 5 batches: 0 far, 1 near, 2 amber-lit, 3 cold-lit, 4 cyan-lit
    for (i = 0; i < active; i++) {
      o = i * 6;
      var sx = streaks[o], sy = streaks[o + 1], len = streaks[o + 2], sp = streaks[o + 3], far = streaks[o + 5] === 0;
      var ny = sy + sp * dts, nx = sx + wind * sp * dts;
      if (!far && sy < bandTop && ny >= bandTop && rand() < .34) spawnRipple(nx + wind * 12, bandTop + rr(0, H * .12));
      if (ny - len > H) { ny = -len - rand() * H * .3; nx = rr(-margin, W + margin); }
      if (nx < -margin) nx += W + margin * 2; else if (nx > W + margin) nx -= W + margin * 2;
      streaks[o] = nx; streaks[o + 1] = ny;
      b = far ? 0 : 1;
      for (k = 0; k < litN; k++) { var dx = nx - litX[k], dy = ny - litY[k]; if (dx * dx + dy * dy < litR2[k]) { b = 2 + lit[k].c; break; } }
      batch[b][batchN[b]++] = i;
    }
    x.save(); x.translate(px * 5, py * 3); x.lineWidth = lw; x.lineCap = 'round';
    var alphas = [.13 * aMul, .28 * aMul, 0, 0, 0], litA = Math.min(.8, .28 * aMul * 2.2);
    var cols = [pal.rain, pal.rain, pal.amber, pal.cold, pal.cyan];
    for (b = 0; b < 5; b++) {
      var n = batchN[b]; if (!n) continue;
      x.beginPath();
      var arr = batch[b];
      for (i = 0; i < n; i++) { o = arr[i] * 6; var qx = streaks[o], qy = streaks[o + 1], ql = streaks[o + 2]; x.moveTo(qx, qy); x.lineTo(qx - wind * ql, qy - ql); }
      x.strokeStyle = 'rgba(' + cols[b] + ',' + (b < 2 ? alphas[b] : litA).toFixed(3) + ')';
      x.stroke();
    }
    x.restore();
  }

  function spawnRipple(rx, ry) {
    if (rippleUse >= rippleCap) return;
    for (var i = 0; i < rippleCap; i++) { var o = i * 4; if (ripples[o + 3] === 0) { ripples[o] = rx; ripples[o + 1] = ry; ripples[o + 2] = now; ripples[o + 3] = 1; rippleUse++; break; } }
    for (var d = 0; d < 3 && dotsN < 48; d++) { dotsX[dotsN] = rx + rr(-6, 6); dotsY[dotsN] = ry - rr(1, 5); dotsN++; }
  }
  function drawRipples() {
    var x = paneX, i, o, b, any = 0;
    for (i = 0; i < rippleCap; i++) { o = i * 4; if (ripples[o + 3] !== 0) { if (now - ripples[o + 2] >= 700) { ripples[o + 3] = 0; rippleUse--; } else any++; } }
    x.lineWidth = 1;
    if (any) for (b = 0; b < 4; b++) {
      var n = 0;
      x.beginPath();
      for (i = 0; i < rippleCap; i++) {
        o = i * 4; if (ripples[o + 3] === 0) continue;
        var p = (now - ripples[o + 2]) / 700, bk = Math.min(3, Math.floor((1 - p) * 4));
        if (bk !== b) continue;
        var rx = Math.max(0, 26 * easeOut(Math.max(0, p)));
        x.moveTo(ripples[o] + rx, ripples[o + 1]);
        x.ellipse(ripples[o], ripples[o + 1], rx, rx * .3, 0, 0, PI * 2); n++;
      }
      if (n) { x.strokeStyle = 'rgba(' + pal.ripple + ',' + (pal.rippleA * (b + .5) / 4).toFixed(3) + ')'; x.stroke(); }
    }
    if (dotsN) { x.fillStyle = 'rgba(' + pal.ripple + ',' + pal.rippleA + ')'; for (i = 0; i < dotsN; i++) x.fillRect(dotsX[i], dotsY[i], 1, 1); dotsN = 0; }
  }

  function updateDrops(dts, I) {
    var i, o, k, j, oj;
    var sliders = 0; for (k = 0; k < sliderCap; k++) if (slots[k] >= 0) sliders++;
    for (i = 0; i < dropN; i++) {
      o = i * 6; var st = drops[o + 4];
      if (st === 0) {
        drops[o + 2] += .12 * I * dts;
        if (now > drops[o + 5]) { drops[o + 2] += rr(-.15, .25); drops[o] += rr(-.6, .6); drops[o + 5] = now + rr(3000, 12000); }
        if (drops[o + 2] > 6.5) {
          if (rand() < .7 && sliders < sliderCap) {
            for (k = 0; k < sliderCap; k++) if (slots[k] < 0) { slots[k] = i; break; }
            sliders++; drops[o + 4] = 1; drops[o + 3] = 40 + (drops[o + 2] - 6) * 30; drops[o + 5] = 0;
          } else { placeDrop(i, true); }
        }
      } else if (st === 1) {
        var r = drops[o + 2], vy = drops[o + 3];
        var vx = wind * 25 + rr(-1.5, 1.5) * 4;
        var ox = drops[o], oy = drops[o + 1];
        drops[o] = ox + vx * dts; drops[o + 1] = oy + vy * dts;
        // swallow
        for (j = 0; j < dropN; j++) {
          if (j === i) continue; oj = j * 6; if (drops[oj + 4] !== 0) continue;
          var dx = drops[oj] - drops[o], dy = drops[oj + 1] - drops[o + 1], rs = r + drops[oj + 2];
          if (dx * dx + dy * dy < rs * rs) {
            r = Math.min(14, Math.sqrt(r * r + drops[oj + 2] * drops[oj + 2]));
            drops[o + 2] = r; drops[o + 3] = vy = 40 + (r - 6) * 30;
            drops[oj + 4] = 2; drops[oj + 5] = now + rr(1000, 3000);
          }
        }
        // trail every 6px
        drops[o + 5] += Math.abs(drops[o + 1] - oy) + Math.abs(drops[o] - ox);
        if (drops[o + 5] >= 6) {
          drops[o + 5] = 0;
          for (k = 0; k < sliderCap; k++) if (slots[k] === i) break;
          if (k < sliderCap) { var th = trailHead[k], to = (k * trailPts + th) * 4; trails[to] = drops[o]; trails[to + 1] = drops[o + 1]; trails[to + 2] = r * .5; trails[to + 3] = now; trailHead[k] = (th + 1) % trailPts; }
        }
        // name refraction hook
        if (nameRect && drops[o] >= nameRect.left && drops[o] <= nameRect.right && drops[o + 1] >= nameRect.top && drops[o + 1] <= nameRect.bottom && now - nameCrossAt > 1200) { nameCrossAt = now; if (hooks.onNameCross) hooks.onNameCross(); }
        if (drops[o + 1] > H + r) {
          for (k = 0; k < sliderCap; k++) if (slots[k] === i) slots[k] = -1;
          placeDrop(i, true);
        }
      } else if (st === 2) {
        if (now >= drops[o + 5]) placeDrop(i, true);
      }
    }
  }
  function drawDrops() {
    var x = paneX, i, o, k;
    // trails
    for (k = 0; k < sliderCap; k++) {
      for (i = 0; i < trailPts; i++) {
        o = (k * trailPts + i) * 4; var age = now - trails[o + 3]; if (age >= 2500 || age < 0) continue;
        var f = 1 - age / 2500, r = trails[o + 2] * (.5 + .5 * f);
        x.globalAlpha = .22 * f; x.drawImage(sprDrop, trails[o] - r, trails[o + 1] - r, r * 2, r * 2);
      }
    }
    x.globalAlpha = 1;
    var refract = refractOn && fine && tier === 0 && !reduced, nref = 0;
    for (i = 0; i < dropN; i++) {
      o = i * 6; var st = drops[o + 4]; if (st !== 0 && st !== 1) continue;
      var dx = drops[o], dy = drops[o + 1], dr = drops[o + 2];
      if (refract && dr > 5 && nref < 12) {
        nref++;
        x.save(); x.beginPath(); x.arc(dx, dy, dr - .5, 0, PI * 2); x.clip();
        x.translate(dx, dy); x.scale(1, -1); x.globalAlpha = .85;
        var sr = dr / .6;
        x.drawImage(cityC, (dx - sr) * dprA, (dy - sr) * dprA, sr * 2 * dprA, sr * 2 * dprA, -dr, -dr, dr * 2, dr * 2);
        x.restore();
      }
      x.drawImage(sprDrop, dx - dr, dy - dr, dr * 2, dr * 2);
      if (flash > 0 && dr > 4) { x.globalAlpha = .3 * flash; x.drawImage(sprHi, dx - dr, dy - dr, dr * 2, dr * 2); x.globalAlpha = 1; }
    }
  }

  /* ---------- reduced-motion still frame ---------- */
  var stillSeed = null;
  function drawStill() {
    var x = paneX, i;
    if (!stillSeed || stillSeed.w !== W || stillSeed.h !== H) {
      stillSeed = { w: W, h: H, s: [], d: [], r: [] };
      for (i = 0; i < 60; i++) stillSeed.s.push([rr(0, W), rr(-40, H), rr(50, 130)]);
      for (i = 0; i < 30; i++) stillSeed.d.push([rr(8, W - 8), rr(8, H - 8), rr(2.5, 7), rand() < .35 ? rr(20, 90) : 0]);
      for (i = 0; i < 5; i++) stillSeed.r.push([rr(W * .1, W * .9), rr(H * .88, H * .98), rr(6, 24), rr(.1, .35)]);
    }
    x.clearRect(0, 0, W, H);
    x.lineWidth = 1; x.strokeStyle = 'rgba(' + pal.rain + ',.08)';
    var p = new Path2D();
    for (i = 0; i < 60; i++) { var s = stillSeed.s[i]; p.moveTo(s[0], s[1]); p.lineTo(s[0] - 3, s[1] - s[2]); }
    x.stroke(p);
    for (i = 0; i < 5; i++) { var rp = stillSeed.r[i]; x.strokeStyle = 'rgba(' + pal.ripple + ',' + rp[3] + ')'; x.beginPath(); x.ellipse(rp[0], rp[1], rp[2], rp[2] * .3, 0, 0, PI * 2); x.stroke(); }
    x.globalAlpha = pal.fogD; x.drawImage(fogLayer(), 0, 0, W, H); x.globalAlpha = 1;
    for (i = 0; i < 30; i++) {
      var d = stillSeed.d[i], r = d[2];
      if (d[3]) { for (var t = 6; t < d[3]; t += 6) { var f = 1 - t / d[3]; x.globalAlpha = .22 * f; var tr = r * .5 * (.5 + .5 * f); x.drawImage(sprDrop, d[0] - tr, d[1] - t - tr, tr * 2, tr * 2); } x.globalAlpha = 1; }
      x.drawImage(sprDrop, d[0] - r, d[1] - r, r * 2, r * 2);
    }
  }

  /* ---------- load wipe ---------- */
  function runLoadWipe() {
    if (!nameRect || reduced) { if (reduced) stampBand(); return; }
    var r = brushR() * 1.4, cy = (nameRect.top + nameRect.bottom) / 2;
    var x0 = nameRect.left - 1.5 * r, x1 = nameRect.right + 1.5 * r, t0 = performance.now(), lx = x0, ly = cy;
    var le = 0;
    stamp(x0, cy, bandR(r, 0), .8);
    function step(t) {
      var p = Math.min(1, (t - t0) / 900), e = easeInOut(p);
      var cx = x0 + (x1 - x0) * e, cyy = cy + Math.sin(p * PI * 2) * 4;
      wipeLine(lx, ly, cx, cyy, bandR(r, le), .8, bandR(r, e)); lx = cx; ly = cyy; le = e; lastWipe = t;
      if (p < 1) requestAnimationFrame(step);
      else { for (var i = 0; i < 3; i++) spawnSmall(cx - r * rr(.6, 1.1), cyy + rr(-r * .5, r * .6)); }
    }
    requestAnimationFrame(step);
  }

  /* ---------- public API ---------- */
  R.init = function (opts) {
    hero = opts.hero; cityC = opts.city; paneC = opts.pane; lampEl = opts.lamp || null;
    hooks = opts.hooks || {};
    reduced = !!opts.reduced; fine = !!opts.fine;
    cityX = cityC.getContext('2d'); paneX = paneC.getContext('2d', { alpha: true });
    fogC = mk(2, 2); fogX = fogC.getContext('2d'); fogOut = mk(2, 2); fogOutX = fogOut.getContext('2d');
    fogTex = mk(2, 2); fogTexX = fogTex.getContext('2d'); blur1 = mk(2, 2); blur2 = mk(2, 2);
    now = performance.now(); lastT = now;
    nextGust = now + rr(20000, 50000); nextBurst = now + rr(50000, 100000); nextFlash = now + rr(35000, 80000);
    readPalette(); buildSprites();
    size(opts.width, opts.height);
  };
  R.resize = function (w, h) { if (w === W && h === H) return; size(w, h); };
  R.setNameRect = function (r) { nameRect = r; };
  R.loadWipe = function () { runLoadWipe(); };
  R.stampBand = function () { stampBand(); if (reduced) drawStill(); };
  R.wipe = wipeAt; R.endWipe = endWipe;
  R.start = function () {
    if (reduced) { drawStill(); return; }
    if (running) return;
    running = true; lastT = performance.now(); now = lastT;
    nextFlash = Math.max(nextFlash, now + 35000);
    rafId = requestAnimationFrame(frame);
  };
  R.stop = function () { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
  R.isRunning = function () { return running; };
  R.setScene = function (s, i) { scene = s; targetI = i; };
  R.setPointer = function (nx, ny, lx, ly) { tpx = nx; tpy = ny; if (lx >= 0) { if (lampX < 0) { lampX = lx; lampY = ly; } lampTX = lx; lampTY = ly; } };
  R.setTheme = function () { readPalette(); buildSprites(); drawCity(); makeFogTexture(); recolorFog(); if (reduced) drawStill(); };
  R.setReduced = function (v) {
    reduced = !!v;
    if (reduced) { R.stop(); fillFog(1); stampBand(); drawStill(); }
    else if (!document.hidden) R.start();
  };
  R.getTier = function () { return tier; };
  R.perf = function () { var n = ffill || 1, t = 0; for (var i = 0; i < n; i++) t += ftimes[i]; return { avgMs: +(t / n).toFixed(2), tier: tier, streaks: streakN, drops: dropN, W: W, H: H, dpr: dpr }; };
  R.setRefraction = function (v) { refractOn = !!v; };
  R.getLit = function () { return lit; };
  R.visible = function () { if (!reduced) nextFlash = Math.max(nextFlash, performance.now() + 35000); };

  window.Rain = R;
})();
