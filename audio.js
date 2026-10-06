/* audio.js — 听雨. Off on every load; the AudioContext is created and resumed
   synchronously inside the click handler. Nothing here auto-starts. */
(function () {
  'use strict';
  var A = {};
  var ctx = null, bed = null, lowpass = null, highpass = null, bedGain = null, master = null, noiseBuf = null;
  var on = false, dripTimer = 0, burst = false, scene = 'hero', inten = .7, sceneCut = 1300;
  var CUT = { hero: 1300, about: 800, interests: 1000, contact: 600, dawn: 300 };
  var hasPanner = typeof StereoPannerNode !== 'undefined';

  function makeNoise(c) {
    var sr = c.sampleRate, L = Math.floor(sr * 6), F = Math.floor(sr * .4);
    var buf = c.createBuffer(2, L, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), n = new Float32Array(L + F), i;
      for (i = 0; i < L + F; i++) n[i] = Math.random() * 2 - 1;
      for (i = 0; i < L; i++) d[i] = n[i];
      // equal-power crossfade baked into the loop point: tail blends into the head
      for (i = 0; i < F; i++) {
        var p = i / F, a = Math.cos(p * Math.PI / 2), b = Math.sin(p * Math.PI / 2);
        d[L - F + i] = n[L - F + i] * a + n[i] * b;
      }
    }
    return buf;
  }

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 220;
    lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = CUT[scene] || 1300; lowpass.Q.value = .5;
    bedGain = ctx.createGain(); bedGain.gain.value = 0;
    noiseBuf = makeNoise(ctx);
    bed = ctx.createBufferSource(); bed.buffer = noiseBuf; bed.loop = true;
    bed.connect(highpass); highpass.connect(lowpass); lowpass.connect(bedGain); bedGain.connect(master);
    bed.start();
    ctx.addEventListener('statechange', function () { if (A.onState) A.onState(ctx.state === 'running' && on); });
  }

  function target() { return scene === 'dawn' ? 0 : .14 * (.4 + .6 * inten); }
  function apply(fast) {
    if (!ctx) return;
    var t = ctx.currentTime, tau = scene === 'dawn' ? 1.3 : .6;
    lowpass.frequency.setTargetAtTime(Math.max(200, sceneCut - (burst ? 200 : 0)), t, .6);
    if (on) bedGain.gain.setTargetAtTime(target(), t, fast ? .3 : tau);
  }

  function drip() {
    if (!on || !ctx || ctx.state !== 'running') { dripTimer = 0; return; }
    var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 1200 + Math.random() * 1400;
    g.gain.setValueAtTime(.025 * (scene === 'dawn' ? .2 : 1), t);
    g.gain.exponentialRampToValueAtTime(.0005, t + .06);
    o.connect(g);
    if (hasPanner) { var p = ctx.createStereoPanner(); p.pan.value = (Math.random() * 2 - 1) * .6; g.connect(p); p.connect(master); }
    else g.connect(master);
    o.start(t); o.stop(t + .08);
    dripTimer = setTimeout(drip, 400 + Math.random() * 1200);
  }

  A.toggle = function () {
    if (!ctx) { try { build(); } catch (e) { return false; } }
    if (!on) {
      on = true;
      ctx.resume();
      apply(true);
      if (!dripTimer) dripTimer = setTimeout(drip, 600);
    } else {
      on = false;
      var t = ctx.currentTime;
      bedGain.gain.cancelScheduledValues(t);
      bedGain.gain.setTargetAtTime(0, t, .4);
      clearTimeout(dripTimer); dripTimer = 0;
      setTimeout(function () { if (!on && ctx && ctx.state === 'running') ctx.suspend(); }, 1200);
    }
    return on;
  };
  A.isOn = function () { return on; };
  A.state = function () { return ctx ? ctx.state : 'none'; };
  A.ctx = function () { return ctx; };
  A.setScene = function (s, i) { scene = s; inten = i; sceneCut = CUT[s] || 1300; apply(false); };
  A.setBurst = function (b) { burst = b; apply(false); };
  A.thunder = function () {
    if (!on || !ctx || ctx.state !== 'running') return;
    var t = ctx.currentTime, src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; lp.type = 'lowpass'; lp.frequency.value = 110;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .15); g.gain.setTargetAtTime(0, t + .15, .6);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t, Math.random() * 3); src.stop(t + 2.4);
  };
  A.hidden = function () { if (ctx && ctx.state === 'running') ctx.suspend(); clearTimeout(dripTimer); dripTimer = 0; };
  A.visible = function () { if (on && ctx) { ctx.resume(); if (!dripTimer) dripTimer = setTimeout(drip, 400); } };

  window.RainAudio = A;
})();
