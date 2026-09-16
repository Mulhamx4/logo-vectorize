#!/usr/bin/env python3
"""
Trace a flat-color raster logo (PNG/JPG/WebP) into layered vector paths and export
SVG, PDF, EPS and PNG in several color variants, plus a comparison image, a JSON
report and a self-contained HTML preview page.

Usage:
  python3 vectorize_logo.py INPUT --out DIR [--name slug] [--colors "#hex,#hex"]
         [--bg auto|transparent|#hex] [--max-colors 6] [--scale auto|N]
         [--fill-enclosed] [--no-crop] [--png-widths 1000,4000] [--lang ar|en]

How it works (short):
  1. Background = transparent alpha, or the median color of the image border.
  2. Palette   = k-means on "flat" pixels only (anti-aliased edges are excluded),
                 merged and cleaned. Override with --colors when detection is off.
  3. Upscale (Lanczos) so potrace has room for smooth curves.
  4. Every pixel is explained as either one palette color or a blend of two;
     a blend goes to whichever side it is closer to. This stops edge halos from
     being misread as a third color (e.g. navy+white edges looking "gold").
  5. Layers are stacked: layer i = color i plus every color above it. Top layers
     paint their exact shape over lower ones, so there are never gaps between colors.
  6. potrace each layer, assemble SVG, export, render back and measure fidelity.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, zipfile, colorsys
import numpy as np
from PIL import Image, ImageFilter

try:
    import cv2
except ImportError:
    cv2 = None

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- helpers
def hex2rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def rgb2hex(c):
    c = np.clip(np.round(c), 0, 255).astype(int)
    return '#{:02X}{:02X}{:02X}'.format(*c)


def luminance(c):
    c = np.asarray(c, float) / 255
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return float(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])


def snap(c):
    if (c >= 243).all():
        return np.array([255, 255, 255.])
    if (c <= 12).all():
        return np.array([0, 0, 0.])
    return c


def slugify(s):
    s = re.sub(r'[^A-Za-z0-9\-]+', '-', s).strip('-').lower()
    return s or 'logo'


# ---------------------------------------------------------------- analysis
def detect_background(rgb, alpha, forced):
    if forced == 'transparent':
        return None
    if forced and forced != 'auto':
        return hex2rgb(forced)
    if alpha is not None and (alpha < 128).mean() > 0.02:
        return None
    h, w, _ = rgb.shape
    b = max(2, int(min(h, w) * 0.02))
    border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
                             rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    return snap(np.median(border, axis=0))


def flat_pixels(rgb, alpha):
    """Pixels whose neighbourhood is uniform -> real fills, not anti-aliased edges."""
    h, w, _ = rgb.shape
    f = min(1.0, 1600 / max(h, w))
    small = np.array(Image.fromarray(rgb.astype(np.uint8)).resize(
        (max(1, int(w * f)), max(1, int(h * f))), Image.BOX)).astype(float)
    a_small = None
    if alpha is not None:
        a_small = np.array(Image.fromarray(alpha.astype(np.uint8)).resize(small.shape[1::-1], Image.BOX))
    grad = np.zeros(small.shape[:2])
    for ch in range(3):
        gy, gx = np.gradient(small[..., ch])
        grad = np.maximum(grad, np.hypot(gx, gy))
    # a pixel is flat if its whole 3x3 neighbourhood is low-gradient
    g = Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    mask = np.array(g) < 10
    if a_small is not None:
        mask &= a_small > 250
    return small[mask], small


def kmeans(data, k, iters=25, seed=0):
    rng = np.random.default_rng(seed)
    if len(data) > 120000:
        data = data[rng.choice(len(data), 120000, replace=False)]
    if cv2 is not None:
        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
        _, lab, cen = cv2.kmeans(data.astype(np.float32), k, None, crit, 4, cv2.KMEANS_PP_CENTERS)
        return cen.astype(float), np.bincount(lab.ravel(), minlength=k)
    cen = data[rng.choice(len(data), k, replace=False)]
    for _ in range(iters):
        d = ((data[:, None, :] - cen[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        cen = np.array([data[lab == i].mean(0) if (lab == i).any() else cen[i] for i in range(k)])
    return cen, np.bincount(lab, minlength=k)


def detect_palette(rgb, alpha, bg, max_colors, warnings):
    flat, _ = flat_pixels(rgb, alpha)
    if len(flat) < 200:
        warnings.append('very few flat-color areas; the image may be a photo, gradient or heavily blurred')
        flat = rgb.reshape(-1, 3)
    if bg is not None:
        flat = flat[np.linalg.norm(flat - bg, axis=1) > 36]   # foreground fills only
    if len(flat) < 20:
        raise SystemExit('No foreground colors detected. Pass --colors "#hex,..." and/or --bg.')
    k = int(min(12, max(3, max_colors + 4), len(flat)))
    cen, _ = kmeans(flat, k)
    cen = list(cen)
    # second pass: small but clearly different accents (thin gold lines, dots) get
    # swallowed by k-means because they are rare — look for them in the leftovers
    for _ in range(2):
        d = np.min([np.linalg.norm(flat - c, axis=1) for c in cen], axis=0)
        rest = flat[d > 45]
        if len(rest) < 15:
            break
        kk = int(min(4, len(rest)))
        c2, _ = kmeans(rest, kk)
        cen += list(c2)

    def assign(cs):
        dd = np.stack([np.linalg.norm(flat - c, axis=1) for c in cs])
        return dd.argmin(0), dd.min(0)
    # merge near-duplicates, recompute centers from members
    lab, _ = assign(cen)
    groups = []
    for i in np.argsort(-np.bincount(lab, minlength=len(cen))):
        c, nmem = cen[i], int((lab == i).sum())
        if nmem == 0:
            continue
        for g in groups:
            if np.linalg.norm(g[0] - c) < 32:
                g[0] = (g[0] * g[1] + c * nmem) / (g[1] + nmem); g[1] += nmem
                break
        else:
            groups.append([np.array(c, float), nmem])
    cs = [g[0] for g in groups]
    lab, dist = assign(cs)
    total = len(flat)
    fg = []
    for i, c in enumerate(cs):
        m = (lab == i) & (dist < 40)
        nmem = int(m.sum())
        if nmem < max(12, total * 0.0004):
            continue
        fg.append([snap(np.median(flat[m], axis=0)), nmem])
    fg.sort(key=lambda x: -x[1])
    if len(fg) > max_colors:
        warnings.append(f'{len(fg)} colors found, kept the {max_colors} most used; pass --colors to control this')
        fg = fg[:max_colors]
    if not fg:
        raise SystemExit('No foreground colors detected. Pass --colors "#hex,..." and/or --bg.')
    unexplained = float((dist > 40).mean())
    if unexplained > 0.08:
        warnings.append(f'{unexplained:.0%} of fill pixels match no palette color: likely gradients, shadows or texture — tracing flattens these')
    return [c for c, _ in fg], [n for _, n in fg]


def classify(img, alpha_up, palette, has_bg):
    """Label each pixel with a palette index, treating edge pixels as 2-color blends."""
    P = np.array(palette, np.float32)
    K = len(P)
    H, W, _ = img.shape
    labels = np.empty((H, W), np.uint8)
    pairs = [(i, j) for i in range(K) for j in range(i + 1, K)]
    for y0 in range(0, H, 384):
        x = img[y0:y0 + 384].reshape(-1, 3).astype(np.float32)
        best = np.full(len(x), np.inf, np.float32)
        lab = np.zeros(len(x), np.uint8)
        for i in range(K):
            d = ((x - P[i]) ** 2).sum(1)
            m = d < best; best[m] = d[m]; lab[m] = i
        for i, j in pairs:
            v = P[j] - P[i]
            vv = float(v @ v)
            if vv < 1:
                continue
            t = np.clip(((x - P[i]) @ v) / vv, 0, 1)
            r = x - (P[i] + t[:, None] * v)
            d = (r ** 2).sum(1) * 1.15  # small bias toward single-color explanations
            m = d < best
            best[m] = d[m]
            lab[m] = np.where(t[m] < 0.5, i, j)
        labels[y0:y0 + 384] = lab.reshape(-1, W)
    if alpha_up is not None:
        labels[alpha_up < 128] = 255
    return labels


# ---------------------------------------------------------------- tracing
def trace_mask(mask, tmp, name, turd):
    bmp = os.path.join(tmp, name + '.bmp')
    svg = os.path.join(tmp, name + '.svg')
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).convert('1').save(bmp)
    subprocess.run(['potrace', bmp, '-s', '-o', svg, '-t', str(turd), '-a', '1.0',
                    '-O', '0.4', '--flat'], check=True)
    s = open(svg).read()
    tr = re.search(r'<g transform="([^"]+)"', s)
    paths = re.findall(r'<path d="([^"]+)"', s, re.S)
    d = ' '.join(p.replace('\n', ' ') for p in paths)
    return (tr.group(1) if tr else ''), re.sub(r'\s+', ' ', d).strip()


# ---------------------------------------------------------------- output
def build_svg(W, H, S, layers, fills, bg=None, pad=0, title='logo'):
    vw, vh = W + 2 * pad, H + 2 * pad
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}" '
         f'width="{vw / S:.0f}" height="{vh / S:.0f}">', f'<title>{title}</title>']
    if bg:
        o.append(f'<rect id="background" width="{vw}" height="{vh}" fill="{bg}"/>')
    o.append(f'<g transform="translate({pad},{pad})">')
    for i, (L, f) in enumerate(zip(layers, fills)):
        if f is None or not L['d']:
            continue
        o.append(f'<g id="layer-{i + 1}" transform="{L["transform"]}"><path fill="{f}" d="{L["d"]}"/></g>')
    o.append('</g></svg>')
    return '\n'.join(o)


def make_variants(fg_hex, bg_hex, areas):
    """Color variants. A recolored variant is only produced when it cannot merge two
    layers into the same color (which would erase detail, e.g. a dark icon inside a
    white disc) and when the recolored layers actually carry the logo."""
    n = len(fg_hex)
    lum = [luminance(hex2rgb(h)) for h in fg_hex]
    bg_l = luminance(hex2rgb(bg_hex)) if bg_hex else None
    total = float(sum(areas)) or 1.0
    darkest = fg_hex[int(np.argmin(lum))]

    def safe(repl_idx, new_color):
        kept = [fg_hex[i] for i in range(n) if i not in repl_idx]
        return all(np.linalg.norm(hex2rgb(k) - hex2rgb(new_color)) > 60 for k in kept)

    V = []
    if bg_hex:
        V.append(dict(id='color-on-background', fills=fg_hex, bg=bg_hex, preview=bg_hex, padded=True))
    V.append(dict(id='color-transparent', fills=fg_hex,
                  preview=bg_hex or ('#FFFFFF' if min(lum) < 0.4 else '#1E1E1E')))
    light = [i for i in range(n) if lum[i] > 0.7]
    if light and (bg_l is None or bg_l < 0.45):
        share = sum(areas[i] for i in light) / total
        rep = bg_hex if (bg_hex and bg_l < 0.45) else (darkest if min(lum) < 0.3 else '#1A1A1A')
        if (bg_hex or share >= 0.4) and safe(light, rep):
            V.append(dict(id='color-for-light-backgrounds', preview='#FFFFFF',
                          fills=[rep if i in light else h for i, h in enumerate(fg_hex)]))
    dark = [i for i in range(n) if lum[i] < 0.12]
    if dark and (bg_l is None or bg_l > 0.5):
        share = sum(areas[i] for i in dark) / total
        if (bg_hex or share >= 0.4) and safe(dark, '#FFFFFF'):
            V.append(dict(id='color-for-dark-backgrounds', preview='#161616',
                          fills=['#FFFFFF' if i in dark else h for i, h in enumerate(fg_hex)]))
    V.append(dict(id='mono-black', fills=['#000000'] + [None] * (n - 1), preview='#FFFFFF'))
    V.append(dict(id='mono-white', fills=['#FFFFFF'] + [None] * (n - 1), preview='#161616'))
    return V


TXT = {
    'ar': dict(dir='rtl', title='{name} — الشعار بصيغة فيكتور', sub='{nv} نسخ · SVG · PDF · EPS · PNG',
               variant='النسخة', background='الخلفية', size='الحجم', variants='النسخ',
               variants_lead='كل نسخة على الخلفية اللي تناسبها. نفس الأسماء موجودة في كل مجلد صيغة.',
               small='اختبار الأحجام الصغيرة', small_lead='الشعار كامل بأحجام تنازلية، عشان تشوف متى تبدأ التفاصيل تضيع.',
               colors='الألوان', colors_lead='مستخرجة من الصورة الأصلية. اضغط اللون لنسخ الكود.',
               files='الملفات', fmt='الصيغة', when='متى تستخدمها', path='المسار',
               svg='المواقع والتطبيقات، وتفتح في Illustrator وFigma', pdf='المطابع، ويفتح في Illustrator كفيكتور قابل للتعديل',
               eps='المطابع القديمة وبرامج القص والتطريز', png='السوشال والعروض والمستندات — شفاف ما عدا نسخة الخلفية',
               note='الشعار متتبَّع آليًا من صورة نقطية.', copied='تم نسخ', transparent='شفاف',
               fidelity='نسبة التطابق مع الأصل: {f}%'),
    'en': dict(dir='ltr', title='{name} — vector logo', sub='{nv} variants · SVG · PDF · EPS · PNG',
               variant='Variant', background='Background', size='Size', variants='Variants',
               variants_lead='Each variant on the background it was made for. File names match across format folders.',
               small='Small-size check', small_lead='The full logo at decreasing widths, to see where detail starts to break down.',
               colors='Colors', colors_lead='Sampled from the original image. Click a color to copy its code.',
               files='Files', fmt='Format', when='Use it for', path='Path',
               svg='Web and apps; opens in Illustrator and Figma', pdf='Print; opens in Illustrator as editable vectors',
               eps='Older print workflows, cutting and embroidery software', png='Social, slides and documents — transparent except the background variant',
               note='Traced automatically from a raster image.', copied='Copied', transparent='Transparent',
               fidelity='Match with original: {f}%'),
}

VARIANT_NAMES = {
    'ar': {'color-on-background': 'بالألوان على الخلفية', 'color-transparent': 'بالألوان — شفاف',
           'color-for-light-backgrounds': 'للخلفيات الفاتحة', 'color-for-dark-backgrounds': 'للخلفيات الداكنة',
           'mono-black': 'أسود — لون واحد', 'mono-white': 'أبيض — لون واحد'},
    'en': {'color-on-background': 'Color on background', 'color-transparent': 'Color — transparent',
           'color-for-light-backgrounds': 'For light backgrounds', 'color-for-dark-backgrounds': 'For dark backgrounds',
           'mono-black': 'Black — one color', 'mono-white': 'White — one color'},
}


def build_html(name, slug, lang, W, H, layers, variants, fg_hex, bg_hex, fidelity, warnings, png_widths):
    t = TXT[lang]
    tpl = open(os.path.join(HERE, '..', 'assets', 'preview_template.html'), encoding='utf-8').read()
    defs = '\n'.join(f'<path id="L{i}" transform="{L["transform"]}" d="{L["d"]}"/>' for i, L in enumerate(layers))
    vjs = [dict(id=v['id'], name=VARIANT_NAMES[lang][v['id']], fills=v['fills'],
                bg=v.get('bg'), preview=v['preview']) for v in variants]
    swatches = []
    for c in ([bg_hex] if bg_hex else []) + fg_hex + ['#FFFFFF', '#000000']:
        if c not in swatches:
            swatches.append(c)
    notes = [t['note'], t['fidelity'].format(f=fidelity)] + warnings
    data = dict(name=name, slug=slug, W=W, H=H, variants=vjs, swatches=swatches,
                palette=[dict(hex=h, rgb=' '.join(str(int(x)) for x in hex2rgb(h))) for h in ([bg_hex] if bg_hex else []) + fg_hex],
                t=t, notes=notes, pngw=png_widths)
    html = (tpl.replace('__LANG__', lang).replace('__DIR__', t['dir'])
            .replace('__TITLE__', t['title'].format(name=name))
            .replace('__DEFS__', defs)
            .replace('__DATA__', json.dumps(data, ensure_ascii=False)))
    return html


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('--out', required=True)
    ap.add_argument('--name')
    ap.add_argument('--display-name', help='Human name shown in the preview page and SVG <title>')
    ap.add_argument('--colors', help='comma-separated foreground hex colors (skips detection)')
    ap.add_argument('--bg', default='auto')
    ap.add_argument('--max-colors', type=int, default=6)
    ap.add_argument('--scale', default='auto')
    ap.add_argument('--fill-enclosed', action='store_true',
                    help='regions of background color fully enclosed by the logo become a solid layer')
    ap.add_argument('--no-crop', action='store_true')
    ap.add_argument('--png-widths', default='1000,4000')
    ap.add_argument('--lang', default='ar', choices=['ar', 'en'])
    a = ap.parse_args()

    if not shutil.which('potrace'):
        sys.exit('potrace missing — run scripts/setup.sh first')
    import cairosvg

    warnings = []
    src = Image.open(a.input)
    src.load()
    has_alpha = src.mode in ('RGBA', 'LA', 'PA') or (src.mode == 'P' and 'transparency' in src.info)
    rgba = np.array(src.convert('RGBA')).astype(float)
    rgb, alpha = rgba[..., :3], (rgba[..., 3] if has_alpha else None)
    if alpha is not None and (alpha < 250).mean() < 0.001:
        alpha = None
    h0, w0 = rgb.shape[:2]
    if max(h0, w0) < 600:
        warnings.append(f'source is small ({w0}×{h0}px); fine details will be approximate')

    bg = detect_background(rgb, alpha, a.bg)
    if a.colors:
        fg = [hex2rgb(c) for c in a.colors.split(',') if c.strip()]
        counts = None
    else:
        fg, counts = detect_palette(rgb, alpha, bg, a.max_colors, warnings)

    # crop to content
    if a.no_crop:
        x0, y0, x1, y1 = 0, 0, w0, h0
    else:
        if bg is None:
            content = alpha > 128
        else:
            dmin = min(np.linalg.norm(c - bg) for c in fg)
            content = np.linalg.norm(rgb - bg, axis=2) > max(20, dmin * 0.35)
        ys, xs = np.where(content)
        if len(xs) == 0:
            sys.exit('Nothing but background found.')
        m = int(max(w0, h0) * 0.012) + 2
        x0, y0 = max(0, xs.min() - m), max(0, ys.min() - m)
        x1, y1 = min(w0, xs.max() + m + 1), min(h0, ys.max() + m + 1)
    crop = Image.fromarray(rgba[y0:y1, x0:x1].astype(np.uint8), 'RGBA')
    cw, ch = crop.size

    if a.scale == 'auto':
        S = int(np.clip(round(8000 / max(cw, ch)), 1, 8))
    else:
        S = int(a.scale)
    while (cw * S) * (ch * S) > 36e6 and S > 1:
        S -= 1
    W, H = cw * S, ch * S

    big = crop.resize((W, H), Image.LANCZOS)
    if S > 1:
        big = big.filter(ImageFilter.GaussianBlur(0.3 * S))
    arr = np.array(big).astype(np.float32)
    alpha_up = arr[..., 3] if alpha is not None else None

    palette = ([bg] if bg is not None else []) + list(fg)
    labels = classify(arr[..., :3], alpha_up, palette, bg is not None)
    off = 1 if bg is not None else 0
    n = len(fg)
    area = [int((labels == i + off).sum()) for i in range(n)]
    order = sorted(range(n), key=lambda i: -area[i])       # biggest at bottom
    fg = [fg[i] for i in order]
    fg_idx = [order[k] + off for k in range(n)]

    extra_inner = None
    if a.fill_enclosed and bg is not None and cv2 is not None:
        bgm = (labels == 0).astype(np.uint8)
        nlab, cc = cv2.connectedComponents(bgm, connectivity=4)
        edge = set(np.unique(np.concatenate([cc[0], cc[-1], cc[:, 0], cc[:, -1]])))
        inner = (bgm == 1) & ~np.isin(cc, list(edge))
        if inner.any():
            extra_inner = inner

    turd = max(2, int(S * S * 0.4))
    layers = []
    tmp = tempfile.mkdtemp()
    for k in range(n):
        mask = np.isin(labels, fg_idx[k:])
        if extra_inner is not None and k == 0:
            mask |= extra_inner
        tr, d = trace_mask(mask, tmp, f'L{k}', turd)
        layers.append(dict(transform=tr, d=d))
    fg_hex = [rgb2hex(c) for c in fg]
    areas = [area[i] for i in order]
    if extra_inner is not None:
        tr, d = trace_mask(extra_inner & ~np.isin(labels, fg_idx), tmp, 'inner', turd)
        # inner fills sit right above the bottom layer
        layers.insert(1, dict(transform=tr, d=d))
        fg_hex.insert(1, rgb2hex(bg))
        areas.insert(1, int(extra_inner.sum()))
    bg_hex = rgb2hex(bg) if bg is not None else None

    # one-color silhouette: colors that contrast with the background are ink, colors
    # close to it (e.g. a white disc on a white-intended logo) are knocked out so inner
    # detail survives instead of becoming a solid blob
    lum_fg = [luminance(c) for c in fg]
    if bg is not None:
        ref_l = luminance(bg)
    else:
        mean_l = sum(l * ar for l, ar in zip(lum_fg, areas)) / max(1, sum(areas))
        ref_l = 1.0 if mean_l < 0.5 else 0.0
    contrast = lambda l: (max(l, ref_l) + 0.05) / (min(l, ref_l) + 0.05)
    ink = [fg_idx[k] for k in range(n) if contrast(lum_fg[k]) >= 1.8]
    union_mask = np.isin(labels, fg_idx)
    mono_mask = np.isin(labels, ink) if ink else union_mask
    if (ink and len(ink) < n) or extra_inner is not None:
        tr, d = trace_mask(mono_mask, tmp, 'mono', turd)
        mono_layer = dict(transform=tr, d=d)
    else:
        mono_layer = dict(layers[0])

    name = slugify(a.name or os.path.splitext(os.path.basename(a.input))[0])
    title = a.display_name or name
    variants = make_variants(fg_hex, bg_hex, areas)
    layers.append(mono_layer)
    for v in variants:
        if v['id'].startswith('mono'):
            v['fills'] = [None] * len(fg_hex) + [v['fills'][0]]
        else:
            v['fills'] = list(v['fills']) + [None]

    out = os.path.abspath(a.out)
    for sub in ('SVG', 'PDF', 'EPS', 'PNG'):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    pad = int(min(W, H) * 0.3)
    widths = [int(x) for x in a.png_widths.split(',') if x.strip()]
    files = []
    for v in variants:
        svg = build_svg(W, H, S, layers, v['fills'], bg=v.get('bg'), pad=pad if v.get('padded') else 0, title=title)
        base = f'{name}-{v["id"]}'
        p = os.path.join(out, 'SVG', base + '.svg'); open(p, 'w').write(svg); files.append(p)
        cairosvg.svg2pdf(bytestring=svg.encode(), write_to=os.path.join(out, 'PDF', base + '.pdf'))
        cairosvg.svg2eps(bytestring=svg.encode(), write_to=os.path.join(out, 'EPS', base + '.eps'))
        for wpx in widths:
            cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(out, 'PNG', f'{base}-{wpx}px.png'), output_width=wpx)

    # fidelity: render full color back at crop size and compare with the source
    ref_bg = bg_hex or '#FFFFFF'
    svg_cmp = build_svg(W, H, S, layers, fg_hex + [None], bg=ref_bg, title=title)
    png = cairosvg.svg2png(bytestring=svg_cmp.encode(), output_width=cw, output_height=ch)
    import io
    traced = np.array(Image.open(io.BytesIO(png)).convert('RGB')).astype(float)
    orig = np.array(crop).astype(float)
    if alpha is not None:
        a_ = orig[..., 3:4] / 255
        orig_rgb = orig[..., :3] * a_ + hex2rgb(ref_bg) * (1 - a_)
    else:
        orig_rgb = orig[..., :3]
    diff = np.abs(traced - orig_rgb).mean(2)
    # measured over logo pixels only (background would inflate the score);
    # a 1px erosion ignores anti-aliasing seams along every edge
    refc = hex2rgb(ref_bg)
    content = (np.abs(orig_rgb - refc).mean(2) > 40) | (np.abs(traced - refc).mean(2) > 40)
    wrong = Image.fromarray((diff > 40).astype(np.uint8) * 255).filter(ImageFilter.MinFilter(3))
    wrong = (np.array(wrong) > 0) & content
    fidelity = float(round(100 * (1 - wrong.sum() / max(1, content.sum())), 2))
    heat = 255 - (255 - orig_rgb.mean(2, keepdims=True).repeat(3, 2)) * 0.15
    heat[diff > 40] = [230, 30, 30]
    sheet = np.concatenate([orig_rgb, traced, heat], axis=0 if cw > ch * 1.2 else 1).astype(np.uint8)
    Image.fromarray(sheet).save(os.path.join(out, 'compare.png'))

    # small-detail warning: tiny connected parts in the original crop scale
    if cv2 is not None:
        union = cv2.resize(union_mask.astype(np.uint8), (cw, ch), interpolation=cv2.INTER_AREA)
        nc, _, stats, _ = cv2.connectedComponentsWithStats(union, connectivity=8)
        hs = stats[1:, cv2.CC_STAT_HEIGHT]
        tiny = int(((hs >= 4) & (hs < 28)).sum())
        if tiny >= 6:
            warnings.append(f'{tiny} small parts under ~28px tall in the source (small text/details): '
                            'expect slight wobble when enlarged; for big print, reset that text in its real font')
    if fidelity < 98.5:
        warnings.append(f'fidelity {fidelity}% is lowish — inspect compare.png; try --colors or --bg')

    html = build_html(title, name, a.lang, W, H, layers, variants, fg_hex, bg_hex, fidelity, warnings, widths)
    open(os.path.join(out, f'{name}-preview.html'), 'w', encoding='utf-8').write(html)

    report = dict(name=name, source=os.path.basename(a.input), source_size=[w0, h0], crop=[int(x0), int(y0), int(x1), int(y1)],
                  scale=S, background=bg_hex, colors=fg_hex, layer_sizes_kb=[round(len(L['d']) / 1024, 1) for L in layers[:-1]], mono_knockout=bool((ink and len(ink) < n) or extra_inner is not None),
                  variants=[v['id'] for v in variants], fidelity_percent=fidelity, warnings=warnings)
    json.dump(report, open(os.path.join(out, 'report.json'), 'w'), indent=2, ensure_ascii=False)

    zpath = os.path.join(os.path.dirname(out), f'{name}-logo.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, fs in os.walk(out):
            for f in fs:
                if f in ('compare.png', 'report.json'):
                    continue
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, out))
    report['zip'] = zpath
    report['preview'] = os.path.join(out, f'{name}-preview.html')
    report['compare'] = os.path.join(out, 'compare.png')
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
