# PROJECT_MAP — logo-vectorize

Last updated: 2026-09-16 · Mode of last change: EXECUTE

## [TECH_STACK]

| Package / tool | Version | Why it's here | Verified |
| --- | --- | --- | --- |
| esm-potrace-wasm | 0.5.1 | potrace in WebAssembly — the tracer | ✅ npm 2026-09-16 |
| jsPDF | 4.2.1 | PDF container | ✅ npm 2026-09-16 |
| svg2pdf.js | 2.8.1 | SVG → vector PDF paths | ✅ npm 2026-09-16 |
| fflate | 0.8.3 | ZIP | ✅ npm 2026-09-16 |
| potrace (CLI) + cairosvg | 1.16 / pip latest | Python skill only | ✅ 2026-09-16 |
| Playwright (Python) | pip latest | e2e tests | ✅ 2026-09-16 |

All web dependencies are vendored in `site/lib/vendor/` — no install, no build step.
Runtime: evergreen Chrome/Edge, Firefox, Safari 16.4+ (module workers, OffscreenCanvas). Deploy: GitHub Pages from `site/` via `.github/workflows/pages.yml`.

## [SYSTEM_FLOW]

```
1. Land on /                      → upload step, drop zone, privacy line
2. Choose / drop / paste image    → checkFile: vector file, wrong type, >25 MB, >60 MP, unreadable → inline error, stay
3. File accepted                  → thumbnail + ownership checkbox; "Start" disabled until ticked
4. Start                          → worker: decode → palette → upscale → classify → trace → main thread: fidelity
   Cancel                         → worker terminated, back to previous stage, no error shown
   Failure                        → back to upload (or review if a result exists) with a coded error
5. Review                         → before/after divider (pointer + arrow keys), diff overlay, preview backgrounds,
                                    fidelity %, warnings; edit background mode / colors / fill-enclosed → "Trace again" enabled
6. Download                       → pick variants, formats, PNG widths, file name → ZIP; per-variant SVG button
   Embedded with host-action-label → extra button emits `lv-use` with selected SVGs
7. "New logo"                     → state cleared, worker freed
Refresh at any point              → fresh upload step (nothing persisted except language and theme)
```

## [ARCHITECTURE]

```
site/
  index.html, app.js          — standalone page: header, language + theme (localStorage), footer links
  embed.html                  — host-page example of <logo-vectorizer> + lv-use
  lib/                        — the portable unit; copy as a whole
    worker.js                 — analysis + tracing (port of scripts/vectorize_logo.py)
    vectorizer.js (+ .d.ts)   — worker bridge, limits, SVG/PDF/EPS/PNG/ZIP, fidelity
    ui.js (+ .d.ts)           — the whole UI; mount(root, opts)
    logo-vectorizer.js        — custom element wrapper around mount()
    logo-vectorizer.css       — all styles under .lv, --lv-* tokens
    i18n/ar.js, en.js         — every UI string
    vendor/                   — potrace.js, jspdf, svg2pdf, fflate
scripts/, SKILL.md, assets/   — the Claude skill (Python)
examples/react, font-page     — integration examples (built and run in Chromium on 2026-09-16, not in CI)
tests/e2e.py                  — Playwright checks, synthetic logos only
```

**State ownership:** `ui.js` holds all UI state; `worker.js` is stateless per job; nothing persists except `lv-lang` / `lv-theme` in the standalone page.
**Boundaries:** `vectorizer.js` never touches UI; `ui.js` never imports vendor files; hosts only use `lib/` exports and `--lv-*` tokens.

## [VERIFIABLE_GOALS]

| ID | Goal (observable behavior) | Verify by | Status |
| --- | --- | --- | --- |
| GOAL-1 | A 3-color transparent logo is traced with its exact colors and ≥99% match | `python tests/e2e.py` (peak) | verified |
| GOAL-2 | ZIP contains SVG, PDF, EPS, PNG for every selected variant | e2e (zip listing) + ghostscript render of EPS, pdfium object check of PDF (paths only) | verified |
| GOAL-3 | Recolor variants that would erase detail are not offered | e2e (peak → 3 variants) | verified |
| GOAL-4 | Changing an option enables "Trace again" and applies it | e2e (bloom fill-enclosed) | verified |
| GOAL-5 | Vector input is refused with a reason | e2e | verified |
| GOAL-6 | Arabic is RTL, English LTR; theme toggles and persists | e2e + screenshots | verified |
| GOAL-7 | No horizontal overflow at 390px | e2e (mobile) | verified |
| GOAL-8 | Host page receives selected variants via `lv-use` | e2e (embed.html) | verified |
| GOAL-9 | Builds and runs inside Vite 8 + React 19 + TS 6 host | `examples/react` built with `tsc --noEmit && vite build`, traced + exported in Chromium | verified |
| GOAL-10 | Lazy-loaded from the font page path on the same origin | `examples/font-page` served beside `site/`, traced in Chromium | verified |
| GOAL-11 | Web output matches the Python skill | same 3 logos: identical variants, colors within ±3, fidelity within 0.3% | verified |
| GOAL-12 | Works on real iOS Safari and Firefox | manual on devices | unverified — needs devices |

## [ORPHANS_AND_PENDING]

| Item | Why it's here | Blocking? |
| --- | --- | --- |
| GOAL-12 real-device check | CI and this environment run Chromium only | no |
| Font page link to this tool | lives in the arabic-font-merge repo; snippet in INTEGRATION.md | no |
| Brand Kit wiring | lives in the Brand Kit repo; component + steps in INTEGRATION.md | no |

## [INCIDENT_LOG]

```
2026-09-16 — Stack overflow when embedded as <logo-vectorizer>
  Root cause: render() set the `lang` attribute, which re-entered attributeChangedCallback → setLang → render
  Fix: attributes written only when they change; setLang ignores the current language (ui.js)
  Verified: e2e embed test passes with no page errors
  Regression test: tests/e2e.py › "embed: host receives variants via lv-use" + "no page errors"
```
