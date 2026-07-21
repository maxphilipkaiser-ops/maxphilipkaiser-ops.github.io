// A Candidate wraps one manifest (real or placeholder) and owns its audio routing.
// Buffers are lazy-loaded per instrument and cached.

import { dbToGain, encodePath } from '../util.js';
import { bakeCrossfadeLoop } from './sampler.js';

export class Candidate {
  constructor(manifest, opts = {}) {
    this.manifest = manifest;
    this.id = manifest.id;
    this.name = manifest.name;
    this.shortName = manifest.shortName || manifest.name;
    this.license = manifest.license || '';
    this.sourceUrl = manifest.sourceUrl || '';
    this.gainOffsetDb = manifest.gainOffsetDb || 0;
    this.placeholder = !!opts.placeholder;
    // generator(ctx, instrument, onProgress) -> fills instrument.zones[].buffer (placeholders only)
    this.generate = opts.generate || null;
    // baseUrl for resolving relative sample paths (defaults to page base)
    this.baseUrl = opts.baseUrl || null;

    this.instruments = {};
    for (const [id, inst] of Object.entries(manifest.instruments || {})) {
      this.instruments[id] = {
        id,
        displayName: inst.displayName || id,
        kind: inst.kind || 'solo',
        sampledVibrato: !!inst.sampledVibrato,
        transposeSemis: inst.transposeSemis || 0,
        synth: inst.synth || null, // placeholder generator hint
        zones: (inst.zones || []).map((z) => ({ ...z, buffer: null })),
        loaded: false,
        loading: false,
        rr: {},
      };
    }

    this.ctx = null;
    this.input = null; // fixed loudness-match gain (gainOffsetDb)
    this.abGain = null; // A/B crossfade gain
  }

  attach(ctx, destination) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.gain.value = dbToGain(this.gainOffsetDb);
    this.abGain = ctx.createGain();
    this.abGain.gain.value = 0;
    this.input.connect(this.abGain);
    this.abGain.connect(destination);
  }

  hasInstrument(id) {
    return !!this.instruments[id];
  }

  // Non "-section" instrument ids, for the UI picker.
  soloInstrumentIds() {
    return Object.keys(this.instruments).filter((id) => !id.endsWith('-section'));
  }

  resolveUrl(file) {
    // Encode each path segment so literal "#" (sharp notes) etc. survive fetch.
    const encoded = encodePath(file);
    if (this.baseUrl) return new URL(encoded, this.baseUrl).href;
    return encoded; // relative to document base
  }

  async loadInstrument(id, onProgress) {
    const inst = this.instruments[id];
    if (!inst || inst.loaded || inst.loading) return;
    inst.loading = true;
    try {
      if (this.placeholder) {
        await this.generate(this.ctx, inst, onProgress);
      } else {
        const files = [...new Set(inst.zones.map((z) => z.file))];
        const bufMap = {};
        let done = 0;
        for (const f of files) {
          const resp = await fetch(this.resolveUrl(f));
          if (!resp.ok) throw new Error(`fetch ${f} -> ${resp.status}`);
          const arr = await resp.arrayBuffer();
          bufMap[f] = await this.ctx.decodeAudioData(arr);
          done++;
          if (onProgress) onProgress(done / files.length);
        }
        for (const z of inst.zones) z.buffer = bufMap[z.file];
      }
      // Bake an equal-power crossfade into every looped zone's seam (click-free loops).
      for (const z of inst.zones) {
        if (z.buffer && z.loopStart != null && z.loopEnd != null && z.loopEnd > z.loopStart) {
          z.buffer = bakeCrossfadeLoop(this.ctx, z.buffer, z.loopStart, z.loopEnd);
        }
      }
      inst.loaded = true;
    } finally {
      inst.loading = false;
    }
  }
}
