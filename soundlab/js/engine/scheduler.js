// Phrase scheduler with gapless look-ahead looping.

export class Scheduler {
  constructor(engine) {
    this.engine = engine;
    this.timer = null;
    this.playing = false;
  }

  play(phrase, { tempo, loop, instrumentId }) {
    this.stop();
    const ctx = this.engine.ctx;
    this.playing = true;
    this.phrase = phrase;
    this.instrumentId = instrumentId;
    this.beat = 60 / tempo;
    this.iterDur = phrase.lengthBeats * this.beat;
    this.loop = loop;

    this.nextTime = ctx.currentTime + 0.12;
    this.scheduleIteration(this.nextTime);
    this.nextTime += this.iterDur;

    if (loop) {
      this.timer = setInterval(() => this.tick(), 25);
    } else {
      // auto-clear playing state after the phrase finishes
      const ms = (this.iterDur + 2) * 1000;
      this.timer = setTimeout(() => { this.playing = false; }, ms);
    }
  }

  scheduleIteration(startTime) {
    const root = this.engine.rootMidi;
    for (const n of this.phrase.notes) {
      const midi = root + n.midi;
      const when = startTime + n.startBeat * this.beat;
      const dur = n.durBeats * this.beat;
      this.engine.triggerNote(this.instrumentId, midi, n.velocity != null ? n.velocity : 0.8, when, dur);
    }
  }

  tick() {
    if (!this.playing) return;
    const ct = this.engine.ctx.currentTime;
    while (this.nextTime < ct + 0.25) {
      this.scheduleIteration(this.nextTime);
      this.nextTime += this.iterDur;
    }
  }

  stop() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.engine.stopAllVoices();
  }
}
