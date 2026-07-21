// Small shared helpers. No dependencies.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-6, g));
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const semisToRate = (s) => Math.pow(2, s / 12);
export const randRange = (a, b) => a + Math.random() * (b - a);

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiToName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const isBlackKey = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

// Percent-encode each PATH SEGMENT of a relative URL, leaving the "/" separators intact.
// Manifests store raw human-readable filenames (e.g. "F#4_f_vib_rr1.flac"); the "#" is a
// URL fragment delimiter, so it MUST be escaped before fetch (encodeURIComponent -> %23).
// encodeURIComponent is a no-op on plain ASCII note names like "A4" / "violin-section".
// (Do NOT use encodeURI — it leaves "#" unescaped.)
export function encodePath(relPath) {
  return String(relPath).split('/').map(encodeURIComponent).join('/');
}

// Deterministic PRNG so placeholder round-robins / seeds are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Map a 0..1 velocity to a dynamic-layer name.
export function velToDynamic(v) {
  if (v < 0.45) return 'p';
  if (v < 0.8) return 'mf';
  return 'f';
}

// Velocity -> playback gain multiplier (in addition to dynamic-layer choice).
export function velToGain(v) {
  return 0.45 + 0.55 * clamp(v, 0, 1);
}
