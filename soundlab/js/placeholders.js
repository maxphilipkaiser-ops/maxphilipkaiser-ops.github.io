// Runtime-synthesised placeholder candidates so the whole UI is exercisable with
// zero sample files. Two candidates:
//   A "Karplus Pluck"  -> natural-decay plucked string, no loop points, vib:false.
//   B "Bowed Sustain"  -> looped sustain (loop + crossfade path) + a fake "-section", vib:false.
// Both are vib:false only, so the SYNTH vibrato path is what the UI drives.

import { Candidate } from './engine/candidate.js';
import { midiToFreq, mulberry32, clamp } from './util.js';

const RANGES = {
  violin: [55, 96],
  viola: [48, 84],
  cello: [36, 72],
  flute: [60, 96],
};
const DYN = {
  p: { gain: 0.5, bright: 0.28 },
  mf: { gain: 0.72, bright: 0.52 },
  f: { gain: 1.0, bright: 0.82 },
};
const DYN_IDX = { p: 0, mf: 1, f: 2 };

function buildZones(lo, hi) {
  const zones = [];
  for (let root = lo; root <= hi; root += 4) {
    for (const dyn of ['p', 'mf', 'f']) {
      for (const rr of [1, 2]) {
        zones.push({
          rootMidi: root,
          loKey: root - 2,
          hiKey: root + 2,
          dynamic: dyn,
          vib: false,
          rr,
          gainDb: 0,
          // loopStart/loopEnd are populated at generation time for the bowed synth.
        });
      }
    }
  }
  // widen the extreme zones so the whole range is covered
  zones.forEach((z) => {
    if (z.rootMidi <= lo + 1) z.loKey = lo - 4;
    if (z.rootMidi >= hi - 3) z.hiKey = hi + 4;
  });
  return zones;
}

function buildInstrument(displayName, kind, synth, lo, hi) {
  return {
    displayName,
    kind,
    sampledVibrato: false,
    transposeSemis: 0,
    synth,
    zones: buildZones(lo, hi),
  };
}

function buildManifest(id, name, shortName, synth, withSection, gainOffsetDb) {
  const instruments = {
    violin: buildInstrument('Violin', 'solo', synth, ...RANGES.violin),
    cello: buildInstrument('Cello', 'solo', synth, ...RANGES.cello),
    flute: buildInstrument('Flute', 'solo', synth, ...RANGES.flute),
  };
  if (withSection) {
    // Only this candidate carries a section + viola, so the UI demonstrates both the
    // "True Section disabled for a side that lacks it" rule and the A/B availability dots.
    instruments['viola'] = buildInstrument('Viola', 'solo', synth, ...RANGES.viola);
    instruments['violin-section'] = buildInstrument('Violin (Section)', 'section', synth, ...RANGES.violin);
  }
  return {
    id,
    name,
    shortName,
    license: 'Synthesised (placeholder)',
    sourceUrl: '',
    gainOffsetDb,
    instruments,
  };
}

// ---- DSP renderers ----------------------------------------------------------

// Karplus-Strong plucked string. Natural decay, no loop.
function renderKarplus(ctx, midi, dyn, seed) {
  const sr = ctx.sampleRate;
  const freq = midiToFreq(midi);
  const dur = clamp(1.9 - (midi - 36) * 0.012, 0.7, 1.9);
  const len = Math.floor(sr * dur);
  const N = Math.max(2, Math.round(sr / freq));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);

  const rng = mulberry32(seed);
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = rng() * 2 - 1;

  // brighter dynamics => less damping (string rings longer/brighter)
  const damp = 0.5 - 0.06 * dyn.bright; // 0.44..0.5 averaging weight toward "current"
  const decay = 0.9965 + 0.0025 * dyn.bright;
  let idx = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    d[i] = cur;
    const nxt = line[(idx + 1) % N];
    line[idx] = decay * (damp * cur + (1 - damp) * nxt);
    idx = (idx + 1) % N;
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
  }
  // normalise + apply dynamic gain + short attack + end fade
  const norm = (peak > 0 ? 0.9 / peak : 1) * dyn.gain;
  const atk = Math.floor(sr * 0.004);
  const fade = Math.floor(sr * 0.02);
  for (let i = 0; i < len; i++) {
    let g = norm;
    if (i < atk) g *= i / atk;
    if (i > len - fade) g *= (len - i) / fade;
    d[i] *= g;
  }
  return buf;
}

// Additive bowed-string-ish sustain with a stable loop region + decay tail.
function renderBowed(ctx, midi, dyn, seed, loopInfo) {
  const sr = ctx.sampleRate;
  const freq = midiToFreq(midi);
  const attack = 0.06;
  const sustain = 1.2;
  const tail = 0.7;
  const len = Math.floor(sr * (attack + sustain + tail));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);

  const rng = mulberry32(seed);
  const nH = Math.floor(6 + dyn.bright * 6);
  const phase = [];
  const amp = [];
  let ampSum = 0;
  for (let h = 1; h <= nH; h++) {
    phase.push(rng() * Math.PI * 2);
    // gentle rolloff, brighter dynamics keep more high harmonics
    const a = (1 / h) * (1 - (1 - dyn.bright) * (h / nH) * 0.6);
    amp.push(a);
    ampSum += a;
  }
  const attackS = Math.floor(sr * attack);
  const sustainEndS = Math.floor(sr * (attack + sustain));
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    for (let h = 1; h <= nH; h++) s += Math.sin(2 * Math.PI * freq * h * t + phase[h - 1]) * amp[h - 1];
    // slow amplitude shimmer (bow noise), NOT pitch vibrato (that is the SYNTH-vibrato test's job)
    const shimmer = 1 + 0.025 * Math.sin(2 * Math.PI * 4.7 * t + phase[0]);
    let env;
    if (i < attackS) env = i / attackS;
    else if (i < sustainEndS) env = 1;
    else env = Math.max(0, 1 - (i - sustainEndS) / (len - sustainEndS));
    d[i] = (s / ampSum) * env * shimmer;
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
  }
  const norm = (peak > 0 ? 0.92 / peak : 1) * dyn.gain;
  for (let i = 0; i < len; i++) d[i] *= norm;

  // Loop region sits well inside the steady sustain; frames, per the manifest contract.
  loopInfo.loopStart = Math.floor(sr * (attack + 0.15));
  loopInfo.loopEnd = Math.floor(sr * (attack + sustain - 0.1));
  return buf;
}

// Generator plugged into Candidate.loadInstrument for placeholders.
async function generate(ctx, inst, onProgress) {
  const zones = inst.zones;
  let done = 0;
  for (const z of zones) {
    const dyn = DYN[z.dynamic];
    const seed = z.rootMidi * 131 + z.rr * 977 + DYN_IDX[z.dynamic] * 17 + (inst.id.length);
    if (inst.synth === 'bowed') {
      const info = {};
      z.buffer = renderBowed(ctx, z.rootMidi, dyn, seed, info);
      z.loopStart = info.loopStart;
      z.loopEnd = info.loopEnd;
    } else {
      z.buffer = renderKarplus(ctx, z.rootMidi, dyn, seed);
    }
    done++;
    if (done % 8 === 0) {
      if (onProgress) onProgress(done / zones.length);
      await new Promise((r) => setTimeout(r, 0)); // yield so the progress bar paints
    }
  }
  if (onProgress) onProgress(1);
}

export function makePlaceholders() {
  const a = new Candidate(buildManifest('ph-karplus', 'Karplus Pluck (placeholder)', 'Pluck', 'karplus', false, 0), {
    placeholder: true,
    generate,
  });
  const b = new Candidate(buildManifest('ph-bowed', 'Bowed Sustain (placeholder)', 'Bowed', 'bowed', true, -1.0), {
    placeholder: true,
    generate,
  });
  return [a, b];
}
