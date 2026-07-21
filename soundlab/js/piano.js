// On-screen piano strip (2.5 octaves) + computer-keyboard mapping.

import { isBlackKey, midiToName } from './util.js';

// Computer-key -> semitone offset from the current base octave's C.
const KEYMAP = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16,
};

export function buildPiano(container, { lowMidi = 55, octaves = 2.5, onDown, onUp }) {
  const highMidi = lowMidi + Math.round(octaves * 12);
  container.innerHTML = '';
  const strip = document.createElement('div');
  strip.className = 'piano-strip';
  container.appendChild(strip);

  const whiteEls = [];
  const keyEls = {}; // midi -> element
  const whites = [];
  for (let m = lowMidi; m <= highMidi; m++) if (!isBlackKey(m)) whites.push(m);

  // white keys as flex children
  for (const m of whites) {
    const el = document.createElement('div');
    el.className = 'pkey white';
    el.dataset.midi = m;
    el.title = midiToName(m);
    strip.appendChild(el);
    whiteEls.push(el);
    keyEls[m] = el;
  }
  // black keys positioned over the gaps
  const wWidthPct = 100 / whites.length;
  whites.forEach((m, i) => {
    const bm = m + 1;
    if (bm <= highMidi && isBlackKey(bm)) {
      const el = document.createElement('div');
      el.className = 'pkey black';
      el.dataset.midi = bm;
      el.title = midiToName(bm);
      el.style.left = `${(i + 1) * wWidthPct}%`;
      strip.appendChild(el);
      keyEls[bm] = el;
    }
  });

  const pressed = new Set();
  function press(midi, fromKeyboard) {
    if (pressed.has(midi)) return;
    pressed.add(midi);
    const el = keyEls[midi];
    if (el) el.classList.add('active');
    onDown && onDown(midi);
  }
  function release(midi) {
    if (!pressed.has(midi)) return;
    pressed.delete(midi);
    const el = keyEls[midi];
    if (el) el.classList.remove('active');
    onUp && onUp(midi);
  }

  // mouse / touch on the strip
  let mouseDown = false;
  strip.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pkey');
    if (!el) return;
    mouseDown = true;
    press(+el.dataset.midi);
    e.preventDefault();
  });
  strip.addEventListener('pointerup', (e) => {
    const el = e.target.closest('.pkey');
    if (el) release(+el.dataset.midi);
    mouseDown = false;
  });
  strip.addEventListener('pointerenter', (e) => {}, true);
  strip.addEventListener('pointerover', (e) => {
    if (!mouseDown) return;
    const el = e.target.closest('.pkey');
    if (el) press(+el.dataset.midi);
  });
  strip.addEventListener('pointerout', (e) => {
    if (!mouseDown) return;
    const el = e.target.closest('.pkey');
    if (el) release(+el.dataset.midi);
  });
  window.addEventListener('pointerup', () => {
    mouseDown = false;
    [...pressed].forEach((m) => { if (keyEls[m]) release(m); });
  });

  // computer keyboard
  let octaveBase = lowMidi - (lowMidi % 12) + 12; // a C near the low end
  const heldKeys = new Set();
  function onKeyDown(e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { octaveBase = Math.max(24, octaveBase - 12); return; }
    if (k === 'x') { octaveBase = Math.min(96, octaveBase + 12); return; }
    if (!(k in KEYMAP)) return;
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const midi = octaveBase + KEYMAP[k];
    heldKeys.add(k);
    press(midi, true);
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (!(k in KEYMAP)) return;
    heldKeys.delete(k);
    const midi = octaveBase + KEYMAP[k];
    release(midi);
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  return { keyEls };
}
