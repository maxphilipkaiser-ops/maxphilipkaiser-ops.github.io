# Sound Lab

A standalone, build-free A/B audition site for comparing instrument **sample-library
candidates** at maximum playback quality. Designed for an ear-training app: load two
candidates, play the same phrase through both, and flip between them instantly (mid-phrase,
gapless) to judge which sounds better. Blind mode removes bias.

No framework, no build step: vanilla ES modules + one CSS file + `index.html`.
Targets Chrome/Edge desktop. All asset/fetch URLs are **relative**, so the site can be
deployed under any subpath (e.g. `/soundlab/`).

Until real samples are added, the page synthesises **two placeholder candidates** at runtime
so every feature is fully exercisable with zero sample files.

---

## Run locally

Serve the `site/` folder over plain HTTP (ES modules + `fetch` need http, not `file://`):

```bash
cd site
npx serve -l 5173          # or:  python -m http.server 5173
```

Open <http://localhost:5173/>. Click any phrase button (a user gesture) to start audio —
the header shows `audio: running` once the AudioContext resumes.

---

## Using the app

- **Left column** — assign a candidate to slot **A** and slot **B** (dropdowns list every
  loaded manifest plus the placeholders). Each shows load status, a load-progress bar, and a
  license / source footnote. **Blind mode** relabels the switch to neutral **1 / 2** and
  randomly maps them to A/B; **Reveal** shows the mapping afterwards. The big **A/B** buttons
  cross-fade between the two candidates in ~10 ms — both play in sync, so the swap is instant
  and never restarts the phrase.
- **Center** — pick an **instrument** (union of both candidates; a chip shows `A`/`B`
  availability dots and is disabled only if neither side has it). Trigger a **phrase**, set
  **tempo / loop**, or **stop**. The **piano strip** at the bottom is playable by mouse and
  by computer keyboard (`A W S E D F T G Y H U J …` = white/black keys, `Z` / `X` shift
  octave down/up).
- **Right column** — **Vibrato** (Off / Sampled / Synth + synth rate·depth·onset·ramp),
  **Ensemble** (Solo / True Section / Virtual + voices·detune·width·jitter), **Reverb/FX**
  (IR picker, wet mix, tilt EQ), and **Master** (volume + safety-limiter toggle).

---

## Adding a real candidate (for the sample-prep agent)

1. Put decoded-friendly audio (FLAC or WAV) under `samples/<candidateId>/<instrument>/…`.
2. Write a manifest under `manifests/<candidateId>.json` (contract below).
3. Add its path to `candidates.json`:

```json
{
  "candidates": ["manifests/vsco2ce.json", "manifests/spitfire-labs.json"],
  "irs": [
    { "id": "hall", "name": "Concert Hall", "file": "irs/hall.wav" },
    { "id": "room", "name": "Small Room",   "file": "irs/room.wav" }
  ]
}
```

That's it — reload the page. Placeholders remain in the list (clearly labelled) so you can
A/B a real library against them. See `manifests/example-candidate.json` for a working
template.

### Path rules

- **All paths in `candidates.json` and in every manifest are relative to the site root**
  (the folder containing `index.html`) — e.g. `"samples/vsco2ce/violin/A4_mf_rr1.flac"`,
  `"irs/hall.wav"`. Do **not** use leading `/` (that breaks the `/soundlab/` subpath deploy).
- If `candidates.json` is missing/empty, or a manifest fails to load, the app falls back to
  placeholders and logs a console warning (not a fatal error).
- If `irs` is empty, only a runtime-synthesised **"Synthetic Hall"** IR is offered.

---

## Manifest contract

```jsonc
{
  "id": "vsco2ce",                     // unique candidate id
  "name": "VSCO 2 CE — Solo",          // full label (dropdown)
  "shortName": "VSCO2",                // short label (blind reveal)
  "license": "CC0",                    // shown as a footnote
  "sourceUrl": "https://...",          // shown as a footnote link
  "gainOffsetDb": 0.0,                 // loudness-match trim applied to EVERYTHING in this
                                       //   candidate (set so all candidates match in level;
                                       //   this is the key to a FAIR comparison)

  "instruments": {
    "violin": {                        // standard ids: violin, viola, cello, flute, oboe,
                                       //   clarinet, trumpet, horn, piano
      "displayName": "Violin",
      "kind": "solo",                  // "solo" | "section"
      "sampledVibrato": true,          // true only if zones include BOTH vib:true and
                                       //   vib:false variants; enables the "Sampled" vibrato
                                       //   button for this instrument
      "transposeSemis": 0,             // shift phrases into this instrument's comfortable
                                       //   register (keep equal across candidates for the
                                       //   same instrument so A/B stays pitch-matched)

      "zones": [
        {
          "file": "samples/vsco2ce/violin/A4_mf_rr1.flac",  // relative to SITE ROOT
          "rootMidi": 69,              // the recorded pitch (MIDI note number)
          "loKey": 67, "hiKey": 71,    // key range this zone covers (repitched to fill gaps)
          "dynamic": "mf",             // "p" | "mf" | "f"  (velocity picks the layer)
          "vib": true,                 // vibrato recorded in the sample?
          "rr": 1,                     // round-robin index (1-based; multiple = alternated)

          "loopStart": 22050,          // OPTIONAL — sustain-loop start, in SAMPLE FRAMES
          "loopEnd":   96000,          // OPTIONAL — sustain-loop end, in SAMPLE FRAMES
                                       //   present  -> sustain loops (equal-power crossfade),
                                       //              note-off releases the natural tail
                                       //   omitted  -> plays the natural decay
          "gainDb": 0,                 // OPTIONAL — per-zone trim
          "tuneCents": 0               // OPTIONAL — per-zone pitch micro-correction, in CENTS.
                                       //   Default 0. SAME SIGN AS SFZ `tune=`:
                                       //   POSITIVE = play the sample that many cents HIGHER
                                       //   (e.g. SFZ `tune=+20` -> "tuneCents": 20). Range
                                       //   typically ±35. Applied as a constant detune that
                                       //   SUMS with the repitch and the synth-vibrato LFO
                                       //   (all on source.detune) — never overwrites them.
        }
      ]
    },

    "violin-section": {                // CONVENTION: a real recorded section for instrument X
      "displayName": "Violin (Section)",   //   uses the id  "X-section".  The Ensemble panel's
      "kind": "section",                   //   "True Section" mode uses it when present, and is
      "sampledVibrato": false,             //   disabled for a side that lacks it.
      "transposeSemis": 0,
      "zones": [ /* … */ ]
    }
  }
}
```

### Zone-selection rules the engine applies (so you can prep samples effectively)

For a requested note the sampler picks, in order:
1. zones whose `[loKey,hiKey]` contains the note (else: any loaded zone, then repitched);
2. zones matching the requested **vibrato** preference (`vib`) — falls back if none;
3. zones matching the velocity-derived **dynamic** (`p`<0.45 ≤ `mf`<0.8 ≤ `f`) — else nearest;
4. the **nearest `rootMidi`** (minimises repitch);
5. **round-robin** across the surviving `rr` variants.

Once a zone is chosen, its optional **`tuneCents`** is applied as a constant pitch offset on
top of the repitch (positive = higher; see the contract). Carry across per-region `tune=`
values from source SFZs verbatim — some libraries (e.g. VPO) rely on ±35-cent corrections and
notes play audibly out of tune without them.

More zones = better quality. Practical guidance: sample roughly every 2–4 semitones per
dynamic, provide 2+ round-robins, include loop points for sustaining instruments
(strings, winds) but omit them for plucked/struck ones so the natural decay plays, and copy
any per-region `tune=` corrections into `tuneCents`.

---

## Placeholder candidates (runtime-generated, no files needed)

| Candidate | Synthesis | Loop points | Vibrato zones | Section | Purpose |
|---|---|---|---|---|---|
| **Karplus Pluck (placeholder)** | Karplus-Strong plucked string | none (natural decay) | `vib:false` only | no | exercises natural-decay path + repitch + round-robins |
| **Bowed Sustain (placeholder)** | additive bowed-string sustain | yes (loop + crossfade) | `vib:false` only | `violin-section` | exercises sustain-loop, release-tail, true-section, and loudness offset (`gainOffsetDb -1.0`) |

Both cover **violin / cello / flute** with zones every 4 semitones × 3 dynamics (`p/mf/f`) ×
2 round-robins. Because both are `vib:false` only, the **Sampled** vibrato button is disabled
and the **Synth** vibrato path is what you hear — demonstrating that synth vibrato works on
top of any non-vib sample. Only the Bowed candidate has `violin-section`, so **True Section**
is enabled only when a side that owns it is selected (the Karplus side shows a dimmed `A`/`B`
availability dot).

---

## Architecture

```
site/
  index.html
  candidates.json                 # candidate + IR registry (starts empty)
  css/styles.css
  js/
    main.js                       # DOM wiring / orchestration
    phrases.js                    # phrase library (offsets from tonic)
    placeholders.js               # runtime synth candidates (Karplus + additive bowed)
    piano.js                      # on-screen + computer-keyboard input
    util.js                       # dsp/midi helpers
    engine/
      audio.js                    # Engine: AudioContext, A/B slots, note triggering
      candidate.js                # Candidate: manifest + lazy buffer loading + routing
      sampler.js                  # zone selection + voice creation (attack/loop/release)
      vibrato.js                  # synth-vibrato LFO on source.detune
      ensemble.js                 # solo / section / virtual voice layout
      fx.js                       # convolver reverb + tilt EQ + limiter + master
      scheduler.js                # gapless look-ahead phrase player
  manifests/  samples/  irs/      # dropped in by the sample-prep agent
```

**Fair-comparison design:** every note is scheduled on *both* candidates simultaneously,
each routed through its own gain node; the A/B switch only cross-fades those gains (~10 ms),
so switching is instant, in sync, and never restarts the phrase. Each candidate's
`gainOffsetDb` is applied to its whole signal path for level-matched auditioning.
