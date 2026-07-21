// Master FX chain: reverb (convolver) + tilt EQ + safety limiter + master volume.
// Signal flow:
//   input -> dry -----------------------------\
//   input -> convolver -> wet ----------------> sum -> eq -> [limiterOn -> comp]\
//                                                             \-> limiterOff ---> preMaster -> master -> destination

export class FxChain {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();

    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.sum = ctx.createGain();

    this.eq = ctx.createBiquadFilter();
    this.eq.type = 'highshelf';
    this.eq.frequency.value = 3500;
    this.eq.gain.value = 0;

    this.limiterOn = ctx.createGain();
    this.limiterOff = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -6;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 12;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.15;

    this.preMaster = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;

    // wiring
    this.input.connect(this.dry);
    this.dry.connect(this.sum);
    this.input.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(this.sum);

    this.sum.connect(this.eq);
    this.eq.connect(this.limiterOn);
    this.limiterOn.connect(this.comp);
    this.comp.connect(this.preMaster);
    this.eq.connect(this.limiterOff);
    this.limiterOff.connect(this.preMaster);

    this.preMaster.connect(this.master);
    this.master.connect(ctx.destination);

    this.irs = {}; // id -> { name, buffer }
    this.setWet(0.22);
    this.setLimiter(true);
  }

  setWet(w) {
    // Equal-power dry/wet mix.
    this._wet = w;
    this.wet.gain.value = Math.sin((w * Math.PI) / 2);
    this.dry.gain.value = Math.cos((w * Math.PI) / 2);
  }

  setLimiter(on) {
    this._limiter = on;
    this.limiterOn.gain.value = on ? 1 : 0;
    this.limiterOff.gain.value = on ? 0 : 1;
  }

  setEqTilt(db) {
    this.eq.gain.value = db;
  }

  setMaster(v) {
    this.master.gain.value = v;
  }

  registerIR(id, name, buffer) {
    this.irs[id] = { name, buffer };
  }

  setIR(id) {
    const ir = this.irs[id];
    if (ir) this.convolver.buffer = ir.buffer;
  }
}

// Synthetic stereo hall. A RAW white-noise IR sounds like broadband hiss/"static" (its
// energy is flat to Nyquist), which is very audible on bright sources and accumulates into
// continuous hiss when a phrase loops. A real hall's tail rolls off HF strongly (air
// absorption). So we band-limit the noise with a one-pole low-pass whose cutoff FALLS as the
// tail decays — turning the hiss into a smooth, dark, hall-like tail.
export function makeSyntheticIR(ctx, seconds = 2.5) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const tau = seconds * 0.32;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    let peak = 1e-9;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t / tau);
      const early = t < 0.08 ? 0.4 * Math.exp(-t / 0.02) : 0;
      // one-pole LP coefficient: brighter early (~0.4), progressively darker into the tail
      const a = Math.max(0.05, 0.4 - 0.34 * (t / seconds));
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * (env + early);
      const abs = Math.abs(d[i]);
      if (abs > peak) peak = abs;
    }
    // normalise (low-passing lowers the level) so the wet/dry mix stays meaningful
    const norm = 0.9 / peak;
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  return buf;
}
