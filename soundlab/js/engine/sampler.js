// Sampler: zone selection + voice creation (the heart of playback quality).

import { clamp, dbToGain, semisToRate, velToDynamic, velToGain } from '../util.js';
import { applySynthVibrato } from './vibrato.js';
import { buildVoiceLayout } from './ensemble.js';

const DYN_ORDER = { p: 0, mf: 1, f: 2 };
const ATTACK = 0.003; // ~3 ms de-click
const REL_NATURAL = 0.09; // note-off release for natural-decay zones
const REL_LOOPED = 0.28; // longer release so a looped sample's recorded tail bleeds through

// Pick the best zone for (midi, dynamic, vib) then round-robin among rr variants.
// rrOffset lets stacked ensemble voices pick different round-robins.
export function pickZone(inst, midi, dynamic, vibPref, rrOffset) {
  let cands = inst.zones.filter((z) => z.buffer && midi >= z.loKey && midi <= z.hiKey);
  if (!cands.length) cands = inst.zones.filter((z) => z.buffer); // out of range -> any loaded, repitch
  if (!cands.length) return null;

  // 1) vibrato preference (fall back to ignoring it if no match)
  const vibMatch = cands.filter((z) => !!z.vib === !!vibPref);
  if (vibMatch.length) cands = vibMatch;

  // 2) dynamic layer: exact, else nearest
  const exact = cands.filter((z) => z.dynamic === dynamic);
  if (exact.length) {
    cands = exact;
  } else {
    const target = DYN_ORDER[dynamic] ?? 1;
    let best = Infinity;
    for (const z of cands) best = Math.min(best, Math.abs((DYN_ORDER[z.dynamic] ?? 1) - target));
    cands = cands.filter((z) => Math.abs((DYN_ORDER[z.dynamic] ?? 1) - target) === best);
  }

  // 3) nearest rootMidi (minimise repitch)
  let best = Infinity;
  for (const z of cands) best = Math.min(best, Math.abs(z.rootMidi - midi));
  const nearest = cands.filter((z) => Math.abs(z.rootMidi - midi) === best);

  // 4) round-robin among the surviving rr variants
  const key = `${nearest[0].rootMidi}|${nearest[0].dynamic}|${nearest[0].vib}`;
  const c = inst.rr[key] || 0;
  const idx = (c + rrOffset) % nearest.length;
  if (rrOffset === 0) inst.rr[key] = c + 1; // advance once per note (primary voice)
  return nearest[idx];
}

// Create the audio nodes for a single sustaining voice. Returns a handle for release.
function spawnVoice(ctx, candidate, zone, midi, o) {
  const src = ctx.createBufferSource();
  src.buffer = zone.buffer;
  const semis = midi - zone.rootMidi;
  src.playbackRate.value = semisToRate(semis);
  // Detune (cents) is the SUM of: per-zone tuning micro-correction (tuneCents, +higher),
  // ensemble static detune, and — added live by the synth-vibrato LFO on this same param —
  // the vibrato modulation. Repitch (playbackRate) and this detune combine multiplicatively.
  src.detune.value = (o.detune || 0) + (zone.tuneCents || 0);

  let looped = false;
  if (zone.loopStart != null && zone.loopEnd != null && zone.loopEnd > zone.loopStart) {
    looped = true;
    src.loop = true;
    src.loopStart = zone.loopStart / ctx.sampleRate;
    src.loopEnd = zone.loopEnd / ctx.sampleRate;
  }

  const g = ctx.createGain();
  const panner = ctx.createStereoPanner();
  panner.pan.value = clamp(o.pan || 0, -1, 1);
  src.connect(g);
  g.connect(panner);
  panner.connect(candidate.input);

  const peak = dbToGain(zone.gainDb || 0) * (o.gainMul || 1) * velToGain(o.velocity);
  const t0 = o.when;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + ATTACK);

  let lfo = null;
  if (o.vibrato && o.vibrato.mode === 'synth') {
    ({ lfo } = applySynthVibrato(ctx, src, o.vibrato, t0, o.lfoRate));
  }

  src.start(t0);
  return { src, g, lfo, looped, ctx, released: false, ended: false };
}

// Apply the release envelope to a voice handle at (audio) time `when`.
export function releaseVoice(h, when) {
  if (!h || h.released) return;
  h.released = true;
  const { ctx, g, src, lfo } = h;
  g.gain.cancelScheduledValues(when);
  // hold current value so cancel doesn't jump
  g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), when);
  if (h.looped) {
    g.gain.setTargetAtTime(0.0001, when, REL_LOOPED / 3);
    // exit the loop so the recorded natural tail plays out
    const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
    setTimeout(() => {
      try { src.loop = false; } catch (e) { /* already stopped */ }
    }, delayMs);
    safeStop(src, when + 1.4);
    if (lfo) safeStop(lfo, when + 1.4);
  } else {
    // gentle ramp: smooth key-off that does not click a natural decay
    g.gain.setTargetAtTime(0.0001, when, REL_NATURAL / 3);
    safeStop(src, when + 0.6);
    if (lfo) safeStop(lfo, when + 0.6);
  }
}

function safeStop(node, when) {
  try { node.stop(when); } catch (e) { /* already scheduled/stopped */ }
}

// Bake a short equal-power crossfade into the loop seam so a native BufferSource
// loop wraps click-free. Returns a NEW buffer (the source may be shared across zones);
// samples after loopEnd (the natural release tail) are left untouched.
export function bakeCrossfadeLoop(ctx, buffer, loopStart, loopEnd, xfadeSec = 0.012) {
  const sr = ctx.sampleRate;
  const len = buffer.length;
  const ch = buffer.numberOfChannels;
  let X = Math.floor(xfadeSec * sr);
  X = Math.min(X, loopStart, Math.floor((loopEnd - loopStart) / 2));
  const out = ctx.createBuffer(ch, len, sr);
  for (let c = 0; c < ch; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src);
    if (X > 1) {
      for (let i = 0; i < X; i++) {
        const t = i / X;
        const wOut = Math.cos((t * Math.PI) / 2); // fade the loop-end material out
        const wIn = Math.sin((t * Math.PI) / 2); // fade in the pre-loopStart material
        const endIdx = loopEnd - X + i;
        const preIdx = loopStart - X + i;
        dst[endIdx] = src[endIdx] * wOut + src[preIdx] * wIn;
      }
    }
  }
  return out;
}

// Start a note on one candidate/instrument. Returns an array of voice handles
// (one per ensemble layout voice). Caller releases them at note-off.
export function startNote(engine, candidate, instrumentId, midi, opts) {
  const ctx = engine.ctx;
  const baseInst = candidate.instruments[instrumentId];
  if (!baseInst || !baseInst.loaded) return [];

  const s = engine.settings;
  const velocity = opts.velocity != null ? opts.velocity : 0.8;
  const when = opts.when != null ? opts.when : ctx.currentTime + 0.02;

  // Ensemble: choose the instrument to sample from.
  let playInst = baseInst;
  const sectionId = instrumentId + '-section';
  if (s.ensemble.mode === 'section' && candidate.instruments[sectionId] && candidate.instruments[sectionId].loaded) {
    playInst = candidate.instruments[sectionId];
  }

  const midiEff = midi + (playInst.transposeSemis || 0);
  const dynamic = velToDynamic(velocity);
  const vibPref = s.vibrato.mode === 'sampled'; // prefer vib:true zones only in SAMPLED mode
  const layout = buildVoiceLayout(s.ensemble, s.vibrato.rate);

  const handles = [];
  for (const vp of layout) {
    const zone = pickZone(playInst, midiEff, dynamic, vibPref, vp.rr);
    if (!zone) continue;
    const h = spawnVoice(ctx, candidate, zone, midiEff, {
      when: when + (vp.jitterMs || 0) / 1000,
      velocity,
      detune: vp.detune,
      pan: vp.pan,
      gainMul: vp.gainMul,
      vibrato: s.vibrato,
      lfoRate: vp.lfoRate,
    });
    handles.push(h);
    engine.trackVoice(h);
  }
  return handles;
}
