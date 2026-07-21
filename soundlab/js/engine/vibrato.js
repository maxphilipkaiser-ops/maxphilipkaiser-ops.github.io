// SYNTH vibrato: an LFO modulating a source node's `detune` AudioParam (cents).
// Works on top of any sample, vib-recorded or not.
// Params: { rate 4-7 Hz, depth 0-50 cents, onset delay 0-1 s, ramp-in 0-1 s }.

import { randRange } from '../util.js';

export function applySynthVibrato(ctx, srcNode, vib, t0, rateOverride) {
  const rate = rateOverride != null ? rateOverride : vib.rate;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = rate;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0;
  lfo.connect(lfoGain);
  lfoGain.connect(srcNode.detune);

  const onset = vib.onset || 0;
  const ramp = Math.max(0.01, vib.ramp || 0.2);
  lfoGain.gain.setValueAtTime(0, t0);
  lfoGain.gain.setValueAtTime(0, t0 + onset);
  lfoGain.gain.linearRampToValueAtTime(vib.depth, t0 + onset + ramp);

  lfo.start(t0);
  return { lfo, lfoGain };
}

// A per-voice rate, used so stacked ensemble voices have decorrelated (independent)
// vibrato phase without pitch drift.
export function jitteredRate(baseRate) {
  return baseRate + randRange(-0.5, 0.5);
}
