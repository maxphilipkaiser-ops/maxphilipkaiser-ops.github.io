// Ensemble voice-layout logic.
// Returns an array of per-voice parameter objects consumed by the sampler.
//
// Modes:
//   solo    -> 1 voice, no spread.
//   section -> handled by the sampler (uses the "X-section" instrument); 1 layout voice.
//   virtual -> N stacked solo voices with detune spread, pan spread, onset jitter,
//              independent vibrato rate/phase, and staggered round-robins.

import { clamp, randRange } from '../util.js';

export function buildVoiceLayout(ens, vibRate) {
  if (ens.mode === 'virtual') {
    return buildVirtualVoices(ens, vibRate);
  }
  // solo or section -> a single centered voice at unity gain.
  return [{ detune: 0, pan: 0, jitterMs: 0, rr: 0, lfoRate: vibRate, gainMul: 1 }];
}

function buildVirtualVoices(ens, vibRate) {
  const N = clamp(Math.round(ens.voices), 2, 8);
  const out = [];
  for (let i = 0; i < N; i++) {
    // spread voices symmetrically across [-1, 1]
    const frac = N > 1 ? (i / (N - 1)) * 2 - 1 : 0;
    const detune = frac * ens.detune + randRange(-1.5, 1.5);
    const pan = clamp(frac * ens.width + randRange(-0.04, 0.04), -1, 1);
    out.push({
      detune,
      pan,
      jitterMs: Math.random() * ens.jitter,
      rr: i, // staggered round-robin so voices pick different samples where available
      lfoRate: vibRate + randRange(-0.5, 0.5), // decorrelated vibrato
      // incoherent-sum normalisation keeps a section from being N times louder than solo
      gainMul: 1 / Math.sqrt(N),
    });
  }
  return out;
}
