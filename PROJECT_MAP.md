# PROJECT_MAP — logo-vectorize

Last updated: 2026-09-17 · Mode of last change: EXECUTE

## [TECH_STACK]

| Package / tool | Version | Why it's here | Verified |
| --- | --- | --- | --- |
| esm-potrace-wasm | 0.5.1 | potrace in WebAssembly — the tracer | ✅ npm 2026-09-16 |
| jsPDF | 4.2.1 | PDF container | ✅ npm 2026-09-16 |
| svg2pdf.js | 2.8.1 | SVG → vector PDF paths | ✅ npm 2026-09-16 |
| fflate | 0.8.3 | ZIP | ✅ npm 2026-09-16 |
| potrace (CLI) + cairosvg | 1.16 / pip latest | Python skill only | ✅ 2026-09-16 |
| Playwright (Python) | pip latest | e2e tests in Chromium, Firefox, WebKit | ✅ 2026-09-17 |
| axe-core | 4.13.0 | WCAG 2.2 A/AA checks in e2e (vendored in `tests/vendor/`, MPL-2.0) | ✅ npm 2026-09-17 |
| GitHub Actions | checkout v7, setup-python v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5 | CI + Pages, all Node 24 | ✅ 2026-09-17 |

All web dependencies are vendored in `site/lib/vendor/` — no install, no build step.
Runtime: evergreen Chrome/Edge, Firefox, Safari 16.4+ (module workers, OffscreenCanvas, IndexedDB optional). Deploy: GitHub Pages from `site/` via `.github/workflows/pages.yml`, after e2e passes in all three engines.
npm: `package.json` defines `logo-vectorizer` (site/lib only). Packed and installed into Vite 8.3 + React 19.3 + TS 6.0.3 on 2026-09-17; not published (#3).

## [SYSTEM_FLOW]

```
1. Land on /                      → upload step, drop zone, privacy line
   persist on + saved batch <24 h → "Continue where you left off" card: Resume (re-trace saved files) / Discard
2. Choose / drop / paste images   → checkFile each: vector file, wrong type, >25 MB, >60 MP, unreadable → named inline error,
                                    the other files are kept; more than 20 → tooManyFiles
3. Files accepted                 → list with thumbnails + remove, "Add logos", ownership checkbox; Start disabled until ticked
4. Start                          → for each logo in turn: worker decode → palette → upscale → classify → trace → fidelity
                                    progress reads "Logo i of n · step"
   Cancel                         → worker terminated; review if any logo traced, else upload with the list kept
   One logo fails                 → marked failed, the rest continue; all fail → upload with the first error named
5. Review                         → strip to switch logos (2+); failed logo shows reason + Trace again / Remove
                                    before/after divider (pointer + arrow keys), diff overlay, preview backgrounds, fidelity %,
                                    warnings; edit background / colors / fill-enclosed / corners → "Trace again" (that logo only)
                                    persist on → traced batch saved (files as bytes + applied options)
6. Download                       → per logo: pick variants, file name; shared: formats, PNG widths
                                    "Download <logo>" → ZIP; "Download all logos (n)" → one ZIP, folder per logo
   Embedded with host-action-label → extra button emits `lv-use` with the current logo's selected SVGs
7. "New logo"                     → state cleared, worker freed, saved batch deleted
Refresh at any point              → upload step; resume offered if persist is on and a batch was saved
```

## [ARCHITECTURE]

```
site/
  index.html, app.js          — standalone page: header, language + theme (localStorage), footer links
  embed.html                  — host-page example of <logo-vectorizer> + lv-use
  lib/                        — the portable unit; copy as a whole
    worker.js                 — analysis + tracing (port of scripts/vectorize_logo.py)
    vectorizer.js (+ .d.ts)   — worker bridge, limits, SVG/PDF/EPS/PNG/ZIP, fidelity
    ui.js (+ .d.ts)           — the whole UI; mount(root, opts); batch state (items[], active)
    session.js (+ .d.ts)      — last batch in IndexedDB (bytes + options, 24 h TTL, 64 MB cap), opt-in via persist
    logo-vectorizer.js        — custom element wrapper around mount()
    logo-vectorizer.css       — all styles under .lv, --lv-* tokens
    i18n/ar.js, en.js         — every UI string
    vendor/                   — potrace.js, jspdf, svg2pdf, fflate
scripts/, SKILL.md, assets/   — the Claude skill (Python)
examples/react, font-page     — integration examples (built and run in Chromium on 2026-09-16, not in CI)
tests/e2e.py                  — Playwright checks per engine (arg: chromium|firefox|webkit), synthetic logos only;
                                generates tall/wide/large PNGs at run time
tests/vendor/axe.min.js       — axe-core for the a11y checks
package.json                  — npm package definition (exports site/lib); not used by the site itself
```

**State ownership:** `ui.js` holds all UI state; `worker.js` is stateless per job; `session.js` persists only when the host passes `persist` (standalone page does); the standalone page also stores `lv-lang` / `lv-theme` in localStorage.
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
| GOAL-12 | Works on real iOS Safari and Firefox | manual on devices ([#2](https://github.com/Mulhamx4/logo-vectorize/issues/2)) | engines verified in CI (GOAL-17); real devices unverified |
| GOAL-13 | Up to 20 logos traced in one batch; a failing logo doesn't stop the others; one ZIP with a folder per logo | e2e "batch: …" | verified 3 engines |
| GOAL-14 | After a reload the last batch can be resumed with its applied settings; "New logo" clears it; embeds don't persist unless opted in | e2e "resume: …", "embed: no resume offer…" | verified 3 engines |
| GOAL-15 | Corner style changes the trace: sharp > balanced > rounded in straight segments, fidelity stays ≥ 99 | e2e "corners: …" | verified 3 engines |
| GOAL-16 | No WCAG 2.2 A/AA violations on upload, review (en/ar/dark), resume and batch screens | e2e axe checks | verified 3 engines |
| GOAL-17 | Full e2e passes in Chromium, Firefox and WebKit | CI matrix | verified (PR #1) |
| GOAL-18 | Original and vector share one box and overlay within 2 px on tall, wide, 4200 px and phone-width sources | e2e `stage_fits` | verified 3 engines |
| GOAL-19 | Installed as an npm package in Vite + React + TS: type-checks, builds, dev server works, traces and exports | packed tarball in a scratch Vite 8.3 app, Chromium | verified 2026-09-17 (manual, not in CI) |

## [ORPHANS_AND_PENDING]

| Item | Why it's here | Blocking? |
| --- | --- | --- |
| GOAL-12 real-device check | needs physical devices — [#2](https://github.com/Mulhamx4/logo-vectorize/issues/2) | no |
| npm publish | needs the owner's npm account — [#3](https://github.com/Mulhamx4/logo-vectorize/issues/3) | no |
| Brand Kit + font page wiring | other repos, placement decisions — [#4](https://github.com/Mulhamx4/logo-vectorize/issues/4) | no |
| Live preview while editing | design decision — [#5](https://github.com/Mulhamx4/logo-vectorize/issues/5) | no |
| Share a result | conflicts with the privacy promise — [#6](https://github.com/Mulhamx4/logo-vectorize/issues/6) | no |
| Python `--corners` | same table as the worker, compiles; potrace CLI not installed here, so not run end to end | no |

## [INCIDENT_LOG]

```
2026-09-16 — Stack overflow when embedded as <logo-vectorizer>
  Root cause: render() set the `lang` attribute, which re-entered attributeChangedCallback → setLang → render
  Fix: attributes written only when they change; setLang ignores the current language (ui.js)
  Verified: e2e embed test passes with no page errors
  Regression test: tests/e2e.py › "embed: host receives variants via lv-use" + "no page errors"

2026-09-16 — Original image oversized/cropped in the review compare stage
  Root cause: .lv-stage canvas relied on `width:100%; height:100%; object-fit:contain` inside a CSS Grid
  `place-items:center` parent to letterbox the original canvas. The inline <svg> layer self-corrects via its
  own viewBox + default preserveAspectRatio regardless of the box it's given, so it always looked fine; the
  <canvas> layer has no such self-correction and depends entirely on object-fit, which is not reliable for
  <canvas> across engines — so on some large/non-square sources the original rendered stretched past its
  frame while the vector stayed correctly contained
  Fix: `.lv-layer` switched to flex centering; canvas/svg switched to `max-width:100%; max-height:100%;
  width:auto; height:auto` — the standard aspect-ratio-preserving replaced-element pattern, which does not
  depend on object-fit support at all (logo-vectorizer.css)
  Verified: manually reproduced and fixed with a 4200×2400 synthetic source (tight-cropped to 1105×1105) —
  canvas CSS box stayed within its layer box at the correct aspect ratio in both cases
  Regression test: tests/e2e.py › stage_fits (added 2026-09-17) on peak, bloom, tall 1:6, wide 7:1, 4200 px and
  phone width, in all three engines

2026-09-17 — Resume never saved in WebKit
  Root cause: session.js stored the source File objects in IndexedDB; WebKit rejects Blob values in private
  browsing, and Playwright's WebKit contexts behave the same way, so the put transaction aborted silently
  Fix: files stored as { bytes: ArrayBuffer, type, fileName, lastModified } and rebuilt as File on load; a generation
  counter stops a save that is still reading files from rewriting a session cleared by "New logo" (session.js)
  Verified: round trip + save/clear race in WebKit and Chromium; CI matrix green in all three engines
  Regression test: tests/e2e.py › "resume: session saved with the applied settings" in the webkit job
```
