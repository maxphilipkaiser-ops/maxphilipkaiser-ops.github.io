// Phrase library. Note `midi` values are SEMITONE OFFSETS from the tonic
// (engine.rootMidi); the engine adds the tonic and each instrument's transposeSemis.
// Each phrase: { id, name, lengthBeats, notes: [{ midi, startBeat, durBeats, velocity }] }

function scaleSeq(offsets, startBeat, durBeats, vel) {
  return offsets.map((m, i) => ({ midi: m, startBeat: startBeat + i * durBeats, durBeats, velocity: vel }));
}

// (a) Long tone — one 4-beat note; the key vibrato/timbre test.
const longTone = {
  id: 'long',
  name: 'Long Tone',
  lengthBeats: 4,
  notes: [{ midi: 0, startBeat: 0, durBeats: 4, velocity: 0.7 }],
};

// (b) Major scale up + down, one octave.
const scale = {
  id: 'scale',
  name: 'Major Scale',
  lengthBeats: 15,
  notes: scaleSeq([0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0], 0, 1, 0.75),
};

// (c) Arpeggio — I chord up two octaves (and back).
const arpeggio = {
  id: 'arp',
  name: 'Arpeggio',
  lengthBeats: 13,
  notes: scaleSeq([0, 4, 7, 12, 16, 19, 24, 19, 16, 12, 7, 4, 0], 0, 1, 0.8),
};

// (d) Interval pairs — sequential m3, P5, M7 from the tonic (ear-training core).
const intervals = {
  id: 'intervals',
  name: 'Intervals (m3 P5 M7)',
  lengthBeats: 9,
  notes: [
    { midi: 0, startBeat: 0, durBeats: 1, velocity: 0.8 },
    { midi: 3, startBeat: 1, durBeats: 1, velocity: 0.8 },
    { midi: 0, startBeat: 3, durBeats: 1, velocity: 0.8 },
    { midi: 7, startBeat: 4, durBeats: 1, velocity: 0.8 },
    { midi: 0, startBeat: 6, durBeats: 1, velocity: 0.8 },
    { midi: 11, startBeat: 7, durBeats: 1, velocity: 0.8 },
  ],
};

// (e) Melody — "Ode to Joy", 8 bars in 4/4 (32 beats).
function odeNote(m, b, d, v = 0.8) {
  return { midi: m, startBeat: b, durBeats: d, velocity: v };
}
const melody = {
  id: 'melody',
  name: 'Ode to Joy',
  lengthBeats: 33,
  notes: [
    // bar 1-2
    odeNote(4, 0, 1), odeNote(4, 1, 1), odeNote(5, 2, 1), odeNote(7, 3, 1),
    odeNote(7, 4, 1), odeNote(5, 5, 1), odeNote(4, 6, 1), odeNote(2, 7, 1),
    // bar 3-4
    odeNote(0, 8, 1), odeNote(0, 9, 1), odeNote(2, 10, 1), odeNote(4, 11, 1),
    odeNote(4, 12, 1.5), odeNote(2, 13.5, 0.5), odeNote(2, 14, 2),
    // bar 5-6
    odeNote(4, 16, 1), odeNote(4, 17, 1), odeNote(5, 18, 1), odeNote(7, 19, 1),
    odeNote(7, 20, 1), odeNote(5, 21, 1), odeNote(4, 22, 1), odeNote(2, 23, 1),
    // bar 7-8
    odeNote(0, 24, 1), odeNote(0, 25, 1), odeNote(2, 26, 1), odeNote(4, 27, 1),
    odeNote(2, 28, 1.5), odeNote(0, 29.5, 0.5), odeNote(0, 30, 2),
  ],
};

// (f) Chord progression I-IV-V-I in 4-voice triads (polyphony + ensemble test).
function chord(offsets, startBeat, durBeats, vel = 0.75) {
  return offsets.map((m) => ({ midi: m, startBeat, durBeats, velocity: vel }));
}
const progression = {
  id: 'chords',
  name: 'I-IV-V-I Chords',
  lengthBeats: 16,
  notes: [
    ...chord([0, 4, 7, 12], 0, 4), // I:  C E G C
    ...chord([5, 9, 12, 17], 4, 4), // IV: F A C F
    ...chord([7, 11, 14, 19], 8, 4), // V:  G B D G
    ...chord([0, 4, 7, 12], 12, 4), // I:  C E G C
  ],
};

export const PHRASES = [longTone, scale, arpeggio, intervals, melody, progression];
