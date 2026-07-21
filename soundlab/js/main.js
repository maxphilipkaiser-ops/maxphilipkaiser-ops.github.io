// Sound Lab — app wiring. Connects the DOM to the engine.

import { engine } from './engine/audio.js';
import { Candidate } from './engine/candidate.js';
import { makePlaceholders } from './placeholders.js';
import { PHRASES } from './phrases.js';
import { buildPiano } from './piano.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let allCandidates = [];
let irCfg = [];
const slotCand = { A: null, B: null };

let blind = false;
let blindMap = { A: 'A', B: 'B' }; // physical button -> logical slot
let activePhysical = 'A';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  engine.ensureContext(); // create (suspended) context so FX + IR list are ready
  allCandidates = await loadCandidateList();
  await engine.loadIRList(irCfg);

  populatePickers();
  populateIRSelect();
  buildPhraseButtons();
  buildInstrumentPicker();
  buildKeyboard();
  wireControls();
  wireSwitch();
  startStatusPoll();

  // default assignment: first two candidates
  $('#pickA').value = allCandidates[0].id;
  $('#pickB').value = allCandidates[1] ? allCandidates[1].id : '__none__';
  await assignSlot('A', allCandidates[0].id);
  if (allCandidates[1]) await assignSlot('B', allCandidates[1].id);

  // default instrument
  const firstInst = pickFirstAvailableInstrument() || 'violin';
  await selectInstrument(firstInst);
  selectPhysical('A');

  window.__soundlab = { engine, slotCand };
}

async function loadCandidateList() {
  let cfg = null;
  try {
    const r = await fetch('candidates.json');
    if (r.ok) cfg = await r.json();
  } catch (e) {
    console.warn('candidates.json not found; using placeholders only');
  }
  const cands = [];
  if (cfg && Array.isArray(cfg.candidates)) {
    for (const path of cfg.candidates) {
      try {
        const r = await fetch(path);
        if (!r.ok) throw new Error(String(r.status));
        const m = await r.json();
        cands.push(new Candidate(m)); // sample paths resolve relative to the site root
      } catch (e) {
        console.warn(`manifest ${path} failed to load; skipping`, e);
      }
    }
  }
  irCfg = (cfg && cfg.irs) || [];
  // Synthetic placeholder candidates were dev scaffolding. Now that real candidates exist
  // they are hidden by default. Show them only with ?debug in the URL, or as a last-resort
  // fallback when no real candidate loaded (so the tool is never empty).
  const showPlaceholders = new URLSearchParams(location.search).has('debug');
  if (showPlaceholders || cands.length === 0) cands.push(...makePlaceholders());
  return cands;
}

// ---------------------------------------------------------------------------
// Candidate pickers
// ---------------------------------------------------------------------------
function populatePickers() {
  for (const id of ['#pickA', '#pickB']) {
    const sel = $(id);
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '__none__';
    none.textContent = '(none)';
    sel.appendChild(none);
    for (const c of allCandidates) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
  }
  $('#pickA').addEventListener('change', (e) => assignSlot('A', e.target.value));
  $('#pickB').addEventListener('change', (e) => assignSlot('B', e.target.value));
}

async function assignSlot(slot, candId) {
  const c = candId === '__none__' ? null : allCandidates.find((x) => x.id === candId);
  slotCand[slot] = c;
  engine.slots[slot] = c;
  if (c) engine.attachCandidate(slot, c);
  updateFoot(slot);
  buildInstrumentPicker();
  updateModeAvailability();
  if (c) {
    // keep current instrument if the new candidate has it, else pick a shared one
    if (!c.hasInstrument(engine.currentInstrument)) {
      const inst = pickFirstAvailableInstrument();
      if (inst) { engine.currentInstrument = inst; highlightInstrument(inst); }
    }
    await ensureSlotInstrument(slot, engine.currentInstrument);
  } else {
    setStatus(slot, 'not loaded');
  }
}

function updateFoot(slot) {
  const c = slotCand[slot];
  const el = $(`#foot${slot}`);
  if (!c) { el.textContent = ''; return; }
  const bits = [];
  if (c.license) bits.push(c.license);
  el.innerHTML = '';
  el.appendChild(document.createTextNode(bits.join(' · ')));
  if (c.sourceUrl) {
    el.appendChild(document.createTextNode(' · '));
    const a = document.createElement('a');
    a.href = c.sourceUrl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'source';
    el.appendChild(a);
  }
}

// ---------------------------------------------------------------------------
// Instrument picker (union of both selected candidates)
// ---------------------------------------------------------------------------
function unionInstrumentIds() {
  const ids = new Set();
  for (const slot of ['A', 'B']) {
    const c = slotCand[slot];
    if (c) c.soloInstrumentIds().forEach((id) => ids.add(id));
  }
  // stable order by a canonical instrument list, then any extras
  // strings, then woodwinds (…clarinet, bassoon), then brass (…horn, trombone), then keys
  const order = ['violin', 'viola', 'cello', 'contrabass',
    'flute', 'oboe', 'clarinet', 'bassoon',
    'trumpet', 'horn', 'trombone', 'piano'];
  return [...ids].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

function pickFirstAvailableInstrument() {
  const ids = unionInstrumentIds();
  return ids.find((id) => (slotCand.A && slotCand.A.hasInstrument(id)) || (slotCand.B && slotCand.B.hasInstrument(id))) || ids[0];
}

function buildInstrumentPicker() {
  const box = $('#instruments');
  box.innerHTML = '';
  const ids = unionInstrumentIds();
  for (const id of ids) {
    const hasA = slotCand.A && slotCand.A.hasInstrument(id);
    const hasB = slotCand.B && slotCand.B.hasInstrument(id);
    const name = (slotCand.A && slotCand.A.instruments[id]?.displayName)
      || (slotCand.B && slotCand.B.instruments[id]?.displayName) || id;
    const chip = document.createElement('button');
    chip.className = 'chip instr';
    chip.dataset.id = id;
    if (id === engine.currentInstrument) chip.classList.add('active');
    if (!hasA && !hasB) chip.classList.add('missing');
    chip.innerHTML = `<span class="cname">${name}</span>` +
      `<span class="avail"><i class="${hasA ? 'on' : 'off'}">A</i><i class="${hasB ? 'on' : 'off'}">B</i></span>`;
    if (hasA || hasB) chip.addEventListener('click', () => selectInstrument(id));
    else chip.disabled = true;
    box.appendChild(chip);
  }
}

function highlightInstrument(id) {
  $$('#instruments .chip').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
}

async function selectInstrument(id) {
  engine.currentInstrument = id;
  highlightInstrument(id);
  updateModeAvailability();
  await Promise.all(['A', 'B'].map((slot) => ensureSlotInstrument(slot, id)));
}

async function ensureSlotInstrument(slot, id) {
  const c = slotCand[slot];
  if (!c) { setStatus(slot, 'not loaded'); return; }
  if (!c.hasInstrument(id)) { setStatus(slot, `no ${id}`); hideProg(slot); return; }
  const toLoad = [id];
  const sectionId = id + '-section';
  if (c.hasInstrument(sectionId)) toLoad.push(sectionId);
  setStatus(slot, 'loading…');
  showProg(slot, 0);
  try {
    for (let k = 0; k < toLoad.length; k++) {
      const iid = toLoad[k];
      await c.loadInstrument(iid, (p) => showProg(slot, (k + p) / toLoad.length));
    }
    setStatus(slot, `ready · ${c.instruments[id].displayName}`);
  } catch (e) {
    console.error('load failed', slot, id, e);
    setStatus(slot, 'load error');
  }
  hideProg(slot);
}

function setStatus(slot, text) { $(`#status${slot}`).textContent = text; }
function showProg(slot, p) {
  const el = $(`#prog${slot}`);
  el.classList.add('show');
  el.querySelector('.bar').style.width = `${Math.round(p * 100)}%`;
}
function hideProg(slot) {
  const el = $(`#prog${slot}`);
  el.classList.remove('show');
  el.querySelector('.bar').style.width = '0%';
}

// ---------------------------------------------------------------------------
// Phrases + transport
// ---------------------------------------------------------------------------
function buildPhraseButtons() {
  const box = $('#phrases');
  box.innerHTML = '';
  for (const p of PHRASES) {
    const b = document.createElement('button');
    b.className = 'chip phrase';
    b.textContent = p.name;
    b.addEventListener('click', () => {
      engine.ensureContext();
      const tempo = +$('#tempo').value;
      const loop = $('#loop').checked;
      engine.playPhrase(p, tempo, loop);
      flashActive(box, b);
    });
    box.appendChild(b);
  }
  $('#btnStop').addEventListener('click', () => { engine.stopPhrase(); flashActive(box, null); });
  $('#tempo').addEventListener('input', (e) => { $('#tempoVal').textContent = e.target.value; });
}

function flashActive(box, btn) {
  [...box.children].forEach((c) => c.classList.remove('playing'));
  if (btn) btn.classList.add('playing');
}

// ---------------------------------------------------------------------------
// Piano
// ---------------------------------------------------------------------------
function buildKeyboard() {
  buildPiano($('#piano'), {
    lowMidi: 55,
    octaves: 2.5,
    onDown: (midi) => { engine.ensureContext(); engine.liveNoteOn(engine.currentInstrument, midi, 0.85); },
    onUp: (midi) => engine.liveNoteOff(midi),
  });
}

// ---------------------------------------------------------------------------
// A/B switch + blind mode
// ---------------------------------------------------------------------------
function wireSwitch() {
  $('#btnA').addEventListener('click', () => selectPhysical('A'));
  $('#btnB').addEventListener('click', () => selectPhysical('B'));
  $('#blind').addEventListener('change', (e) => setBlind(e.target.checked));
  $('#btnReveal').addEventListener('click', revealBlind);
}

function selectPhysical(phys) {
  activePhysical = phys;
  engine.ensureContext();
  engine.setActiveSlot(blindMap[phys]);
  $('#btnA').classList.toggle('active', phys === 'A');
  $('#btnB').classList.toggle('active', phys === 'B');
}

function setBlind(on) {
  blind = on;
  if (on) {
    blindMap = Math.random() < 0.5 ? { A: 'A', B: 'B' } : { A: 'B', B: 'A' };
    $('#btnA').textContent = '1';
    $('#btnB').textContent = '2';
    $('#btnReveal').hidden = false;
    $('#btnReveal').textContent = 'Reveal';
  } else {
    blindMap = { A: 'A', B: 'B' };
    $('#btnA').textContent = 'A';
    $('#btnB').textContent = 'B';
    $('#btnReveal').hidden = true;
  }
  selectPhysical('A');
}

function revealBlind() {
  const name = (slot) => (slotCand[slot] ? slotCand[slot].shortName : '—');
  $('#btnReveal').textContent = `1 = ${name(blindMap.A)}  ·  2 = ${name(blindMap.B)}`;
}

// ---------------------------------------------------------------------------
// Right-column controls
// ---------------------------------------------------------------------------
function wireControls() {
  // segmented: vibrato mode
  segClick('#vibMode', (val) => {
    engine.settings.vibrato.mode = val;
    $('#vibSynth').style.display = val === 'synth' ? '' : 'none';
  });
  $('#vibSynth').style.display = 'none';
  bindSlider('#vibRate', 'vibRate', (v) => (engine.settings.vibrato.rate = v));
  bindSlider('#vibDepth', 'vibDepth', (v) => (engine.settings.vibrato.depth = v));
  bindSlider('#vibOnset', 'vibOnset', (v) => (engine.settings.vibrato.onset = v));
  bindSlider('#vibRamp', 'vibRamp', (v) => (engine.settings.vibrato.ramp = v));
  // synth is the default active mode
  $('#vibSynth').style.display = '';

  // segmented: ensemble mode
  segClick('#ensMode', (val) => {
    engine.settings.ensemble.mode = val;
    $('#ensVirtual').style.display = val === 'virtual' ? '' : 'none';
    if (val === 'section') ['A', 'B'].forEach((s) => ensureSlotInstrument(s, engine.currentInstrument));
  });
  $('#ensVirtual').style.display = 'none';
  bindSlider('#ensVoices', 'ensVoices', (v) => (engine.settings.ensemble.voices = v));
  bindSlider('#ensDetune', 'ensDetune', (v) => (engine.settings.ensemble.detune = v));
  bindSlider('#ensWidth', 'ensWidth', (v) => (engine.settings.ensemble.width = v));
  bindSlider('#ensJitter', 'ensJitter', (v) => (engine.settings.ensemble.jitter = v));

  // FX
  $('#irSelect').addEventListener('change', (e) => engine.fx.setIR(e.target.value));
  bindSlider('#reverbWet', 'reverbWet', (v) => engine.fx.setWet(v));
  bindSlider('#eqTilt', 'eqTilt', (v) => engine.fx.setEqTilt(v));
  bindSlider('#master', 'master', (v) => engine.fx.setMaster(v));
  $('#limiter').addEventListener('change', (e) => engine.fx.setLimiter(e.target.checked));
}

function segClick(sel, cb) {
  const box = $(sel);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('disabled')) return;
    [...box.children].forEach((c) => c.classList.remove('active'));
    b.classList.add('active');
    cb(b.dataset.val);
  });
}

function setVibMode(val) { setSeg('#vibMode', val); engine.settings.vibrato.mode = val; $('#vibSynth').style.display = val === 'synth' ? '' : 'none'; }
function setEnsMode(val) { setSeg('#ensMode', val); engine.settings.ensemble.mode = val; $('#ensVirtual').style.display = val === 'virtual' ? '' : 'none'; }
function setSeg(sel, val) {
  $$(`${sel} button`).forEach((b) => b.classList.toggle('active', b.dataset.val === val));
}

function bindSlider(sel, outKey, cb) {
  const el = $(sel);
  const out = document.querySelector(`[data-out="${outKey}"]`);
  const apply = () => {
    const v = parseFloat(el.value);
    if (out) out.textContent = el.step && +el.step < 1 ? v : v;
    cb(v);
  };
  el.addEventListener('input', apply);
  apply();
}

function updateModeAvailability() {
  const id = engine.currentInstrument;
  const a = slotCand.A, b = slotCand.B;
  const has = (c, iid) => c && c.hasInstrument(iid);
  const sampled = (has(a, id) && a.instruments[id].sampledVibrato) || (has(b, id) && b.instruments[id].sampledVibrato);
  setSegDisabled('#vibMode', 'sampled', !sampled);
  const sectionId = id + '-section';
  const hasSection = has(a, sectionId) || has(b, sectionId);
  setSegDisabled('#ensMode', 'section', !hasSection);
  if (!sampled && engine.settings.vibrato.mode === 'sampled') setVibMode('synth');
  if (!hasSection && engine.settings.ensemble.mode === 'section') setEnsMode('solo');
}

function setSegDisabled(sel, val, disabled) {
  const b = $(`${sel} button[data-val="${val}"]`);
  if (b) b.classList.toggle('disabled', disabled);
}

// ---------------------------------------------------------------------------
// IR select + status
// ---------------------------------------------------------------------------
function populateIRSelect() {
  const sel = $('#irSelect');
  sel.innerHTML = '';
  const ids = Object.keys(engine.fx.irs);
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = engine.fx.irs[id].name;
    sel.appendChild(o);
  }
  // Prefer a REAL recorded hall as the default when candidates.json provides one; the
  // synthetic hall is only a fallback (its band-limited noise is still cleaner now, but a
  // measured space sounds better and avoids any reverb-hiss impression).
  const def = ids.find((id) => id !== 'synthetic') || 'synthetic';
  sel.value = def;
  engine.fx.setIR(def);
}

function startStatusPoll() {
  const el = $('#ctx-status');
  setInterval(() => {
    const st = engine.ctx ? engine.ctx.state : 'idle';
    el.textContent = `audio: ${st}`;
    el.classList.toggle('running', st === 'running');
  }, 300);
  // resume on any gesture
  ['pointerdown', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => engine.ensureContext(), { passive: true }));
}

boot().catch((e) => console.error('boot failed', e));
