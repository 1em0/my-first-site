/* script.js — theme, clock verse, scene narrative, reveals, staging, interactions.
   Only two strings are generated here: the clock verse and document.title. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement, body = doc.body;
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }

  var hero = $('.hero'), h1 = $('#name'), cityC = $('#city'), paneC = $('#pane'), lampEl = $('.hero-lamp');
  var head = $('.site-head'), btnAudio = $('#btn-audio'), btnTheme = $('#btn-theme'), veil = $('.veil');
  var flashEl = $('.sky-flash'), hint = $('.hint'), footer = $('footer.dawn');
  var rmq = matchMedia('(prefers-reduced-motion: reduce)');
  var fineQ = matchMedia('(hover: hover) and (pointer: fine)');
  var reduced = rmq.matches, fine = fineQ.matches;
  var Rain = window.Rain, Audio = window.RainAudio;
  var heroW = 0, heroH = 0, heroTop = 0, staged = false, wiped = false, scene = 'hero';
  var INT = { hero: .7, about: .4, interests: .55, contact: .25, dawn: 0 };
  var LAMP = { hero: 1, about: .9, interests: 1, contact: .6, dawn: 0 };
  // one scalar drives canvas, CSS and audio: --intensity (and its derived --lamp-strength / --rain-shadow)
  function exposeScene(s) {
    var i = INT[s] != null ? INT[s] : .7;
    root.style.setProperty('--intensity', i);
    root.style.setProperty('--lamp-strength', LAMP[s] != null ? LAMP[s] : 1);
    root.style.setProperty('--rain-shadow', Math.min(1, i * 1.6).toFixed(2));
  }

  /* ---------- theme ---------- */
  var manual = false;
  try { var st = localStorage.getItem('1em0-theme'); manual = st === 'night' || st === 'day'; } catch (e) {}
  function themeNow() { return root.getAttribute('data-theme') === 'day' ? 'day' : 'night'; }
  function labelTheme() {
    btnTheme.setAttribute('aria-label', themeNow() === 'day' ? '切换到雨夜' : '切换到阴雨白昼');
  }
  function sceneBg() {
    var tok = { hero: '--sky-bottom', about: '--bg-about', interests: '--bg-interests', contact: '--bg-contact', dawn: '--bg-dawn-top' }[scene] || '--bg-about';
    return getComputedStyle(root).getPropertyValue(tok).trim();
  }
  function applyTheme(t, persist) {
    if (t === themeNow()) return;
    var old = sceneBg() || (themeNow() === 'day' ? '#C9D2DA' : '#0D1322');
    veil.style.background = old;
    veil.classList.add('is-on');            /* solid old colour, no transition */
    void veil.offsetWidth;                  /* commit it before the swap */
    root.setAttribute('data-theme', t);
    root.classList.add('is-theming');
    labelTheme();
    if (Rain) Rain.setTheme();
    requestAnimationFrame(function () { requestAnimationFrame(function () { veil.classList.remove('is-on'); }); });
    setTimeout(function () { root.classList.remove('is-theming'); }, 700);
    if (persist) { manual = true; try { localStorage.setItem('1em0-theme', t); } catch (e) {} }
    updateClock();
  }
  btnTheme.addEventListener('click', function () { applyTheme(themeNow() === 'day' ? 'night' : 'day', true); });
  var pcs = matchMedia('(prefers-color-scheme: light)');
  if (pcs.addEventListener) pcs.addEventListener('change', function (e) { if (!manual) applyTheme(e.matches ? 'day' : 'night', false); });
  labelTheme();

  /* ---------- audio ---------- */
  function syncAudioUI() {
    var onNow = Audio && Audio.isOn() && Audio.state() === 'running';
    btnAudio.setAttribute('aria-pressed', onNow ? 'true' : 'false');
    btnAudio.setAttribute('aria-label', onNow ? '关闭雨声' : '开启雨声');
  }
  if (Audio) {
    Audio.onState = syncAudioUI;
    btnAudio.addEventListener('click', function () {
      Audio.toggle();
      Audio.setScene(scene, INT[scene]);
      syncAudioUI();
      var c = Audio.ctx();
      if (c && c.state !== 'running') c.resume().then(syncAudioUI, syncAudioUI);
      setTimeout(syncAudioUI, 1300);
    });
  }

  /* ---------- clock verse (JS-generated text; not personal info) ---------- */
  var clockTimer = 0;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function updateClock() {
    var d = new Date(), h = d.getHours(), line, hour;
    if (h >= 17 && h < 20) { line = '黄昏，雨刚开始'; hour = 'dusk'; }
    else if (h >= 20 || h < 2) { line = '雨还在下'; hour = 'night'; }
    else if (h < 5) { line = '夜最深的时候'; hour = 'predawn'; }
    else if (h < 8) { line = '快天亮了'; hour = 'predawn'; }
    else { line = '你那里是白天，这里一直是夜里'; hour = 'none'; }
    if (themeNow() === 'day') line = '阴雨白昼';
    var time = pad(h) + ':' + pad(d.getMinutes());
    $$('.clock-time').forEach(function (el) { el.textContent = time; });
    $$('.clock-line').forEach(function (el) { el.textContent = line; });
    root.setAttribute('data-hour', hour);
    clearTimeout(clockTimer);
    clockTimer = setTimeout(updateClock, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
  }
  updateClock();

  /* ---------- scene narrative ---------- */
  var sections = { hero: hero, about: $('#about'), interests: $('#interests'), contact: $('#contact'), dawn: footer };
  var keys = Object.keys(sections), cover = {};
  function keyOf(el) { for (var i = 0; i < keys.length; i++) if (sections[keys[i]] === el) return keys[i]; return null; }
  function setScene(s) {
    if (s === scene) return;
    scene = s;
    body.setAttribute('data-scene', s);
    exposeScene(s);
    if (Rain) Rain.setScene(s, INT[s]);
    if (Audio) Audio.setScene(s, INT[s]);
    if (s === 'dawn') { footer.classList.add('is-dawn'); } else { footer.classList.remove('is-dawn'); }
  }
  exposeScene(scene);
  if ('IntersectionObserver' in window) {
    var sceneIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var vh = en.rootBounds ? en.rootBounds.height : innerHeight, k = keyOf(en.target);
        if (k) cover[k] = Math.max(en.intersectionRatio, en.intersectionRect.height / Math.max(1, vh));
      });
      var best = null, bv = 0;
      for (var i = 0; i < keys.length; i++) { var v = cover[keys[i]] || 0; if (v > bv) { bv = v; best = keys[i]; } }
      if (best && bv >= .45) setScene(best);
    }, { threshold: [0, .15, .3, .45, .6, .75, .9, 1] });
    for (var ki = 0; ki < keys.length; ki++) sceneIO.observe(sections[keys[ki]]);

    // hero visibility: loop control (header solidity is scroll-driven below)
    new IntersectionObserver(function (entries) {
      var en = entries[0];
      if (!Rain) return;
      if (en.isIntersecting) { if (!doc.hidden) Rain.start(); } else Rain.stop();
    }, { threshold: 0 }).observe(hero);

    // reveals (once)
    var revIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); revIO.unobserve(en.target); } });
    }, { threshold: .18 });
    $$('.reveal').forEach(function (el) { revIO.observe(el); });

    // is-live: ambient CSS animations only while in view
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle('is-live', en.isIntersecting); });
    }, { threshold: 0 }).observe($('#about'));
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle('is-live', en.isIntersecting); });
    }, { threshold: 0 }).observe($('#interests'));
  } else {
    $$('.reveal').forEach(function (el) { el.classList.add('is-in'); });
  }
  /* header goes fully opaque the moment the page is scrolled, so hero chrome never shows through it */
  var hTick = false;
  function headSolid() { head.classList.toggle('is-solid', scrollY > 8); }
  addEventListener('scroll', function () {
    if (hTick) return; hTick = true;
    requestAnimationFrame(function () { hTick = false; headSolid(); });
  }, { passive: true });
  headSolid();

  /* ---------- scroll var (desktop only) ---------- */
  if (fine && innerWidth >= 900 && !reduced) {
    var sTick = false;
    addEventListener('scroll', function () {
      if (sTick) return; sTick = true;
      requestAnimationFrame(function () { sTick = false; var y = Math.min(scrollY, heroH || innerHeight); hero.style.setProperty('--scroll', y.toFixed(0)); });
    }, { passive: true });
  }

  /* ---------- hero geometry + staging ---------- */
  function measure() {
    var hr = hero.getBoundingClientRect();
    heroW = root.clientWidth; heroH = Math.round(hr.height); heroTop = hr.top + scrollY;
    var nr = h1.getBoundingClientRect();
    // the band is measured from the h1 rect, hero-relative; letter-spacing offsets are compensated so
    // the final glyph box (ls 0) is what we store
    var rect = { left: nr.left - hr.left, top: nr.top - hr.top, right: nr.right - hr.left, bottom: nr.bottom - hr.top };
    if (staged && !h1.classList.contains('is-closed')) { /* mid-animation: estimate from centre */
      var cx = (rect.left + rect.right) / 2, w = rect.right - rect.left;
      rect = { left: cx - w / 2, right: cx + w / 2, top: rect.top, bottom: rect.bottom };
    }
    if (Rain) Rain.setNameRect(rect);
  }
  function stage() {
    measure();
    hero.classList.add('is-staged'); root.classList.add('is-staged'); staged = true;
    h1.addEventListener('animationend', function () { h1.classList.add('is-closed'); }, { once: true });
    if (reduced) { h1.classList.add('is-closed'); if (Rain) Rain.stampBand(); }
    else if (Rain) setTimeout(function () { Rain.loadWipe(); }, 300);
    // first-visit hint
    var seen = false; try { seen = !!localStorage.getItem('1em0-hint'); } catch (e) {}
    if (!seen) setTimeout(function () { if (!wiped) hint.classList.add('is-shown'); }, 6000);
  }

  var engineOK = false;
  try {
    if (Rain) {
      Rain.init({
        hero: hero, city: cityC, pane: paneC, lamp: fine && !reduced ? lampEl : null,
        width: root.clientWidth, height: Math.round(hero.getBoundingClientRect().height),
        reduced: reduced, fine: fine && innerWidth >= 900,
        hooks: {
          onFlash: function () {
            flashEl.classList.add('is-flashing');
            setTimeout(function () { flashEl.classList.remove('is-flashing'); }, 120);
            if (Audio && Audio.isOn()) setTimeout(function () { Audio.thunder(); }, 1600 + Math.random() * 600);
          },
          onBurst: function (b) { if (Audio) Audio.setBurst(b); },
          onNameCross: function () {
            if (reduced) return;
            h1.classList.add('is-refracting');
            setTimeout(function () { h1.classList.remove('is-refracting'); }, 300);
          },
          onWipe: function () {
            if (wiped) return; wiped = true;
            hint.classList.remove('is-shown');
            try { localStorage.setItem('1em0-hint', '1'); } catch (e) {}
          }
        }
      });
      engineOK = true;
    }
  } catch (e) { engineOK = false; if (window.console) console.error(e); }

  requestAnimationFrame(function () {
    stage();
    if (engineOK && !doc.hidden) Rain.start();
  });

  /* ---------- resize: debounced 150ms, ignore height-only deltas < 120px ---------- */
  var rsTimer = 0, lastW = root.clientWidth, lastH = Math.round(hero.getBoundingClientRect().height);
  function onResize() {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(function () {
      var w = root.clientWidth, h = Math.round(hero.getBoundingClientRect().height);
      if (w === lastW && Math.abs(h - lastH) < 120) return;
      lastW = w; lastH = h;
      if (engineOK) Rain.resize(w, h);
      measure();
    }, 150);
  }
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(hero);
  else addEventListener('resize', onResize);

  /* ---------- wipe + gaze (passive, never preventDefault) ---------- */
  function heroXY(cx, cy) { return [cx, cy + scrollY - heroTop]; }
  if (engineOK) {
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var p = heroXY(e.clientX, e.clientY);
      Rain.wipe(p[0], p[1]);
      if (fine) Rain.setPointer((e.clientX / heroW) * 2 - 1, (p[1] / heroH) * 2 - 1, p[0], p[1]);
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { Rain.endWipe(); }, { passive: true });
    hero.addEventListener('touchstart', function (e) { var t = e.touches[0]; if (!t) return; var p = heroXY(t.clientX, t.clientY); Rain.endWipe(); Rain.wipe(p[0], p[1]); }, { passive: true });
    hero.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (!t) return; var p = heroXY(t.clientX, t.clientY); Rain.wipe(p[0], p[1]); }, { passive: true });
    hero.addEventListener('touchend', function () { Rain.endWipe(); }, { passive: true });
  }

  /* ---------- interest cells / lamps: pointer-origin ripple, tap states ---------- */
  function setOrigin(el, e) {
    var r = el.getBoundingClientRect();
    el.style.setProperty('--rx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    el.style.setProperty('--ry', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
  }
  $$('.cell').forEach(function (cell) {
    cell.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') setOrigin(cell, e); }, { passive: true });
    cell.addEventListener('pointerdown', function (e) {
      setOrigin(cell, e);
      if (e.pointerType === 'touch') { cell.classList.remove('is-tapped'); void cell.offsetWidth; cell.classList.add('is-tapped'); setTimeout(function () { cell.classList.remove('is-tapped'); }, 1400); }
    }, { passive: true });
  });
  $$('.lamps li').forEach(function (li) {
    li.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      li.classList.add('is-tapped'); $('.lamp', li).classList.add('is-tapped');
      setTimeout(function () { li.classList.remove('is-tapped'); $('.lamp', li).classList.remove('is-tapped'); }, 1400);
    }, { passive: true });
  });

  /* ---------- visibility ---------- */
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) {
      doc.title = '雨还在下 · 1em0';
      if (engineOK) Rain.stop();
      if (Audio) Audio.hidden();
    } else {
      doc.title = '1em0 · 雨夜';
      if (engineOK) { Rain.visible(); if (scrollY < heroH) Rain.start(); }
      if (Audio) { Audio.visible(); setTimeout(syncAudioUI, 300); }
      updateClock();
    }
  });

  /* ---------- reduced-motion live change ---------- */
  function onRM() {
    reduced = rmq.matches;
    if (engineOK) Rain.setReduced(reduced);
    if (reduced) h1.classList.add('is-closed');
  }
  if (rmq.addEventListener) rmq.addEventListener('change', onRM);
})();
