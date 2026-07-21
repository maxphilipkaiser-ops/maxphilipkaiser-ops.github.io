// The Engine: owns the AudioContext, the master FX chain, the A/B candidate slots,
// note triggering, and live-play voice tracking.

import { FxChain, makeSyntheticIR } from './fx.js';
import { startNote, releaseVoice, hardStopVoice } from './sampler.js';
import { Scheduler } from './scheduler.js';
import { encodePath } from '../util.js';

export class Engine {
  constructor() {
    this.ctx = null;
    this.fx = null;
    this.slots = { A: null, B: null };
    this.activeSlot = 'A';
    this.rootMidi = 60; // C4 tonic for phrases
    this.currentInstrument = 'violin';

    this.settings = {
      vibrato: { mode: 'synth', rate: 5.5, depth: 22, onset: 0.25, ramp: 0.35 },
      ensemble: { mode: 'solo', voices: 4, detune: 8, width: 0.6, jitter: 18 },
    };

    this.activeVoices = [];
    this.liveVoices = {}; // key `${slot}:${midi}` -> handle array
    this._registry = []; // diagnostic: every voice ever created (pruned by ended flag)
    this.scheduler = new Scheduler(this);
    this._started = false;
  }

  // Create the context on first user gesture (autoplay policy) and build the graph.
  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.fx = new FxChain(this.ctx);
      // synthetic hall always available as a fallback IR
      this.fx.registerIR('synthetic', 'Synthetic Hall', makeSyntheticIR(this.ctx, 2.5));
      this.fx.setIR('synthetic');
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  async loadIRList(irs) {
    this.ensureContext();
    for (const ir of irs || []) {
      try {
        const resp = await fetch(encodePath(ir.file)); // encode segments (sharps/spaces safe)
        if (!resp.ok) throw new Error(String(resp.status));
        const buf = await this.ctx.decodeAudioData(await resp.arrayBuffer());
        this.fx.registerIR(ir.id, ir.name, buf);
      } catch (e) {
        console.warn(`IR ${ir.id} failed to load, skipping`, e);
      }
    }
  }

  attachCandidate(slot, candidate) {
    this.ensureContext();
    if (!candidate.input) candidate.attach(this.ctx, this.fx.input);
    this.slots[slot] = candidate;
    // reflect current A/B state on the freshly attached candidate
    const target = slot === this.activeSlot ? 1 : 0;
    candidate.abGain.gain.value = target;
  }

  setActiveSlot(slot) {
    this.activeSlot = slot;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const s of ['A', 'B']) {
      const c = this.slots[s];
      if (!c || !c.abGain) continue;
      const target = s === slot ? 1 : 0;
      c.abGain.gain.cancelScheduledValues(t);
      c.abGain.gain.setValueAtTime(c.abGain.gain.value, t);
      c.abGain.gain.linearRampToValueAtTime(target, t + 0.01); // ~10 ms instant swap
    }
  }

  trackVoice(h) {
    this.activeVoices.push(h);
    this._registry.push(h);
    // Cap memory by evicting ONLY voices that have finished sounding — never drop a
    // still-playing voice (that was the old Stop-button bug: dropped voices couldn't be
    // released and rang to their natural end).
    if (this.activeVoices.length > 512) this.activeVoices = this.activeVoices.filter((v) => !v.ended);
    if (this._registry.length > 4096) this._registry = this._registry.filter((v) => !v.ended);
  }

  // Diagnostic: how many voices are still sounding (started, not yet ended).
  soundingVoiceCount() {
    return this._registry.filter((v) => !v.ended).length;
  }

  // Play a note on BOTH loaded candidates in sync (so A/B swaps are instant, mid-phrase).
  triggerNote(instrumentId, midi, velocity, when, dur) {
    for (const slot of ['A', 'B']) {
      const c = this.slots[slot];
      if (!c || !c.hasInstrument(instrumentId)) continue;
      const inst = c.instruments[instrumentId];
      if (!inst.loaded) continue;
      const handles = startNote(this, c, instrumentId, midi, { velocity, when });
      const off = when + dur;
      for (const h of handles) releaseVoice(h, off);
    }
  }

  // Live play (piano / keyboard): sustain until noteOff.
  liveNoteOn(instrumentId, midi, velocity) {
    this.ensureContext();
    const when = this.ctx.currentTime + 0.02;
    for (const slot of ['A', 'B']) {
      const c = this.slots[slot];
      if (!c || !c.hasInstrument(instrumentId)) continue;
      const inst = c.instruments[instrumentId];
      if (!inst.loaded) continue;
      const key = `${slot}:${midi}`;
      // release any previous same-note voice first
      if (this.liveVoices[key]) this.liveVoices[key].forEach((h) => releaseVoice(h, when));
      this.liveVoices[key] = startNote(this, c, instrumentId, midi, { velocity, when });
    }
  }

  liveNoteOff(midi) {
    if (!this.ctx) return;
    const when = this.ctx.currentTime;
    for (const slot of ['A', 'B']) {
      const key = `${slot}:${midi}`;
      if (this.liveVoices[key]) {
        this.liveVoices[key].forEach((h) => releaseVoice(h, when));
        delete this.liveVoices[key];
      }
    }
  }

  stopAllVoices() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Hard-stop EVERY voice: phrase voices, look-ahead voices scheduled in the future,
    // and sustained live-play voices. Stop always means total silence.
    for (const h of this.activeVoices) hardStopVoice(h, now);
    for (const key of Object.keys(this.liveVoices)) {
      for (const h of this.liveVoices[key]) hardStopVoice(h, now);
    }
    this.activeVoices = [];
    this.liveVoices = {};
  }

  playPhrase(phrase, tempo, loop) {
    this.ensureContext();
    this.scheduler.play(phrase, { tempo, loop, instrumentId: this.currentInstrument });
  }

  stopPhrase() {
    this.scheduler.stop();
  }
}

export const engine = new Engine();
