---
name: logo-vectorize
description: Convert a raster logo (PNG, JPG, WebP, screenshot) into clean layered vector paths and deliver a full logo pack — SVG, PDF, EPS and PNG in several color variants (full color, transparent, for light/dark backgrounds, one-color black and white) — plus a ZIP and an interactive HTML preview page for checking it on different backgrounds and sizes. Use this skill whenever someone uploads a logo image and wants it as vector, SVG, AI/EPS/PDF, "high quality", "for print", "without background", in multiple formats, or asks to recreate/trace/clean up a logo — including Arabic requests like «حوّل الشعار لفيكتور»، «أبغى الشعار SVG»، «شعار بدقة عالية»، «شيل خلفية الشعار»، «أعطني الشعار بكل الصيغ»، «ملف مفتوح للشعار»، «تتبع الشعار». Trigger even when the user only uploads a logo and says "vector" or "للمطبعة" with no other detail.
---

# Logo → vector pack

Turns a flat-color logo image into real vector shapes and a ready-to-send logo pack. The heavy lifting is in `scripts/vectorize_logo.py`; your job is to triage the input, run it, check the result with your own eyes, and tell the user honestly what they got.

## 1. Triage the input first

Look at the image before running anything:

- **Already vector** (user gave .svg / .pdf / .ai / .eps): don't trace — tracing a vector only loses quality. Convert formats instead: SVG → `cairosvg` for PDF/EPS/PNG; PDF/AI → `pdftocairo -svg file.pdf out.svg` then the same. Offer the preview page by running the script on a high-res PNG render only if they want the variants.
- **Flat colors** (typical logo: solid fills, 1–6 colors, text): ideal. Continue.
- **Gradients, shadows, glow, textures, 3D, photos inside the logo**: tracing flattens these into solid bands. Say so up front in one sentence, and still run it if the user wants — the script warns when many pixels don't match the palette.
- **Tiny or blurry source** (under ~600px, heavy JPG blocks): it will work but small text wobbles. Ask if a larger original exists only if it's clearly too small to be usable; otherwise proceed and mention it.
- **Mockup photo of a logo** (on a sign, cup, shirt with perspective): not traceable as-is; ask for a flat version.

## 2. Setup (once per session)

```bash
bash /mnt/skills/user/logo-vectorize/scripts/setup.sh   # adjust path to where the skill lives
```
Installs `potrace`, `cairosvg`, `opencv`. Safe to re-run.

## 3. Run

```bash
python3 <skill>/scripts/vectorize_logo.py INPUT \
  --out /home/claude/<slug>/out --name <slug> \
  --display-name "Brand name as written" --lang ar
```

- `--name`: ASCII slug for file names (`acme-coffee`). `--display-name`: shown in the preview and the SVG `<title>`, may be Arabic.
- `--lang ar|en`: preview page language. Match the user's language.
- Everything else is auto-detected. Override only after looking at the result:
  - `--colors "#28357B,#FFFFFF"`: exact foreground colors (use the brand's official hex codes if the user gave them — better than sampled colors).
  - `--bg transparent|#hex`: when the background detection is wrong (e.g. the logo touches the image edge).
  - `--fill-enclosed`: background-colored areas fully enclosed by the logo become a solid fill instead of a hole (a white letter inside an orange box stays white on any background). It also fills letter counters (the inside of o, a, e), so only use it when that's desired or the logo has no such text.
  - `--max-colors N`, `--scale N`, `--no-crop`, `--png-widths 1000,4000`.

It prints a JSON report: detected background and colors, variants created, `fidelity_percent`, `mono_knockout`, and warnings.

### What it produces
```
out/SVG/<slug>-<variant>.svg      layered paths, one <g id="layer-N"> per color
out/PDF/  out/EPS/                same variants, true vector
out/PNG/<slug>-<variant>-1000px.png / -4000px.png
out/<slug>-preview.html           self-contained preview page
out/compare.png                   original | traced | red = differences
out/report.json
<slug>-logo.zip                   everything except compare/report
```
Variants (created only when they make sense):
`color-on-background` (only if the source had a solid background), `color-transparent`, `color-for-light-backgrounds` (light parts recolored — for white-on-dark logos), `color-for-dark-backgrounds` (dark parts turned white), `mono-black`, `mono-white`. Recolored variants are skipped automatically if they would merge two layers into one color and erase detail. The one-color variants knock out parts close to the background color, so a dark icon inside a white disc stays visible instead of becoming a solid blob.

## 4. Verify — always look

1. `view` `out/compare.png`. Red marks disagreement. Thin red outlines along edges are normal anti-aliasing; red *filled areas* mean a wrong or missing color.
2. Check the colors in the report against the image. A small accent (thin gold line, dots) missing from `colors` → rerun with `--colors`.
3. Render a zoom of the smallest text from a 4000px PNG and view it; that's where tracing is weakest.
4. `fidelity_percent` ≥ 99 is excellent, 98.5–99 is typical when there is small text, below that investigate.
5. Optionally screenshot the preview page with Playwright to be sure it renders (the Google Fonts request failing inside the sandbox is harmless).

Fix and rerun rather than delivering something you saw was wrong.

## 5. Deliver

- **Preview page**: if the conversation has an Artifact/publish tool, publish `out/<slug>-preview.html` (it is fully self-contained, inline SVG, no downloads needed). Otherwise present it as a file.
- **Files**: `present_files` with the ZIP first, then the main SVG (usually `color-transparent`) and its PDF so they can grab those without unzipping.
- Keep the message short, in the user's language: what's in the pack (formats and variants in a few words), the detected colors as hex, and honest caveats that apply to *this* logo — e.g. small text slightly wavy when enlarged (suggest resetting that line in the original font for large print), gradients flattened, source was low-res, enclosed areas are holes unless re-run with filling.
- Don't narrate the script's internals or list every file; the preview page and the ZIP already show them.

## Why the script works the way it does (for when you need to adjust it)

- **Palette from flat pixels only.** Anti-aliased edge pixels are blends; including them in k-means invents fake in-between colors. A second pass looks at leftovers so rare accents aren't swallowed by big clusters.
- **Blend-aware classification.** Each pixel is explained as a single color or a mix of two, and assigned to the nearer side. Without this, the halo between navy and white can be closer to gold than to either, and you get gold outlines around white text.
- **Stacked layers.** Layer N = its color plus all colors above it, so upper colors paint their exact shape over a slightly larger base. No hairline gaps between colors in any renderer.
- **Upscale before tracing** (auto ~8000px long side, capped by memory) gives potrace room for smooth curves; turd size scales with it to drop JPG speckles.
