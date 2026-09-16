// Logo tracing worker. Port of scripts/vectorize_logo.py — keep the two in step.
// Input:  { id, file: Blob, options }   Output: progress / result / error messages.
import { potrace, init } from './vendor/potrace.js';

const post = (id, type, data) => self.postMessage({ id, type, ...data });

// ---------------------------------------------------------------- color helpers
const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const parseHex = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const snap = c => c.every(v => v >= 243) ? [255, 255, 255] : c.every(v => v <= 12) ? [0, 0, 0] : c;

function medianRGB(list) {           // list: flat Float32Array/Array of rgb triples
  const n = list.length / 3, out = [];
  for (let ch = 0; ch < 3; ch++) {
    const hgram = new Uint32Array(256);
    for (let i = 0; i < n; i++) hgram[Math.round(list[i * 3 + ch])]++;
    let acc = 0, m = 0; while (m < 255 && (acc += hgram[m]) < n / 2) m++;
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- analysis
function detectBackground(px, w, h, hasAlpha, forced) {
  if (forced === 'transparent') return null;
  if (forced && forced !== 'auto') return parseHex(forced);
  if (hasAlpha) {
    let t = 0; for (let i = 3; i < px.length; i += 4) if (px[i] < 128) t++;
    if (t / (w * h) > 0.02) return null;
  }
  const b = Math.max(2, Math.floor(Math.min(w, h) * 0.02)), acc = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (y >= b && y < h - b && x >= b && x < w - b) { x = w - b - 1; continue; }
    const p = (y * w + x) * 4; acc.push(px[p], px[p + 1], px[p + 2]);
  }
  return snap(medianRGB(acc));
}

// pixels in uniform neighbourhoods only — anti-aliased edges would invent fake colors
function flatPixels(bitmap, hasAlpha) {
  const f = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * f)), h = Math.max(1, Math.round(bitmap.height * f));
  const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bitmap, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data;
  const grad = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    const xl = x > 0 ? p - 4 : p, xr = x < w - 1 ? p + 4 : p, yu = y > 0 ? p - 4 * w : p, yd = y < h - 1 ? p + 4 * w : p;
    const sx = (xl !== p && xr !== p) ? 2 : 1, sy = (yu !== p && yd !== p) ? 2 : 1;
    let g = 0;
    for (let c = 0; c < 3; c++) {
      const gx = (px[xr + c] - px[xl + c]) / sx, gy = (px[yd + c] - px[yu + c]) / sy;
      g = Math.max(g, Math.hypot(gx, gy));
    }
    grad[i] = g;
  }
  const out = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let mx = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mx = Math.max(mx, grad[(y + dy) * w + x + dx]);
    const p = (y * w + x) * 4;
    if (mx < 10 && (!hasAlpha || px[p + 3] > 250)) out.push(px[p], px[p + 1], px[p + 2]);
  }
  return out;
}

function kmeans(data, k, seed = 7) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let n = data.length / 3, idx = [...Array(n).keys()];
  if (n > 60000) { idx = []; for (let i = 0; i < 60000; i++) idx.push(Math.floor(rnd() * n)); }
  const pt = i => [data[idx[i] * 3], data[idx[i] * 3 + 1], data[idx[i] * 3 + 2]];
  const m = idx.length;
  k = Math.min(k, m);
  const cen = [pt(Math.floor(rnd() * m))], d = new Float64Array(m).fill(Infinity);
  while (cen.length < k) {                                   // k-means++
    let sum = 0;
    for (let i = 0; i < m; i++) { d[i] = Math.min(d[i], dist2(pt(i), cen[cen.length - 1])); sum += d[i]; }
    if (sum === 0) break;
    let r = rnd() * sum, j = 0; while (j < m - 1 && (r -= d[j]) > 0) j++;
    cen.push(pt(j));
  }
  const lab = new Uint8Array(m);
  for (let it = 0; it < 20; it++) {
    const acc = cen.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < m; i++) {
      const p = pt(i); let best = Infinity, L = 0;
      for (let c = 0; c < cen.length; c++) { const dd = dist2(p, cen[c]); if (dd < best) { best = dd; L = c; } }
      lab[i] = L; const a = acc[L]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++;
    }
    for (let c = 0; c < cen.length; c++) if (acc[c][3]) cen[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
  }
  return cen;
}

function detectPalette(bitmap, hasAlpha, bg, maxColors, warn) {
  let flat = flatPixels(bitmap, hasAlpha);
  if (flat.length / 3 < 200) warn.push({ code: 'fewFlat' });
  if (bg) { const f = []; for (let i = 0; i < flat.length; i += 3) { const p = [flat[i], flat[i + 1], flat[i + 2]]; if (Math.sqrt(dist2(p, bg)) > 36) f.push(...p); } flat = f; }
  const n = flat.length / 3;
  if (n < 20) throw Object.assign(new Error('noForeground'), { code: 'noForeground' });
  const P = i => [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]];
  const nearest = cs => { const lab = new Uint8Array(n), dd = new Float32Array(n); for (let i = 0; i < n; i++) { const p = P(i); let b = Infinity, L = 0; cs.forEach((c, j) => { const v = dist2(p, c); if (v < b) { b = v; L = j; } }); lab[i] = L; dd[i] = Math.sqrt(b); } return { lab, dd }; };

  let cen = kmeans(flat, Math.min(12, Math.max(3, maxColors + 4)));
  for (let pass = 0; pass < 2; pass++) {                    // rare accents hide in the leftovers
    const { dd } = nearest(cen), rest = [];
    for (let i = 0; i < n; i++) if (dd[i] > 45) rest.push(...P(i));
    if (rest.length / 3 < 15) break;
    cen = cen.concat(kmeans(rest, Math.min(4, rest.length / 3), 11 + pass));
  }
  let { lab } = nearest(cen);
  const counts = cen.map((_, j) => lab.reduce((a, l) => a + (l === j), 0));
  const groups = [];
  [...cen.keys()].sort((a, b) => counts[b] - counts[a]).forEach(j => {
    if (!counts[j]) return;
    const g = groups.find(g => Math.sqrt(dist2(g.c, cen[j])) < 32);
    if (g) { const t = g.n + counts[j]; g.c = g.c.map((v, i) => (v * g.n + cen[j][i] * counts[j]) / t); g.n = t; }
    else groups.push({ c: cen[j].slice(), n: counts[j] });
  });
  const cs = groups.map(g => g.c), r = nearest(cs);
  let fg = cs.map((c, j) => {
    const mem = [];
    for (let i = 0; i < n; i++) if (r.lab[i] === j && r.dd[i] < 40) mem.push(...P(i));
    return { c: mem.length ? snap(medianRGB(mem)) : c, n: mem.length / 3 };
  }).filter(g => g.n >= Math.max(12, n * 0.0004)).sort((a, b) => b.n - a.n);
  if (fg.length > maxColors) { warn.push({ code: 'tooManyColors', found: fg.length, kept: maxColors }); fg = fg.slice(0, maxColors); }
  if (!fg.length) throw Object.assign(new Error('noForeground'), { code: 'noForeground' });
  const unexplained = r.dd.reduce((a, v) => a + (v > 40), 0) / n;
  if (unexplained > 0.08) warn.push({ code: 'unexplained', percent: Math.round(unexplained * 100) });
  return fg.map(g => g.c.map(Math.round));
}

// separable box blur, alpha included — smooths the stair-steps of upscaling
function boxBlur(px, w, h, r) {
  if (r < 1) return;
  const tmp = new Uint8ClampedArray(px.length), inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {                               // horizontal: px -> tmp
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      let sum = px[row + c] * (r + 1);
      for (let i = 1; i <= r; i++) sum += px[row + Math.min(w - 1, i) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[row + x * 4 + c] = sum * inv;
        sum += px[row + Math.min(w - 1, x + r + 1) * 4 + c] - px[row + Math.max(0, x - r) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {                               // vertical: tmp -> px
    for (let c = 0; c < 4; c++) {
      const at = y => (y * w + x) * 4 + c;
      let sum = tmp[at(0)] * (r + 1);
      for (let i = 1; i <= r; i++) sum += tmp[at(Math.min(h - 1, i))];
      for (let y = 0; y < h; y++) {
        px[(y * w + x) * 4 + c] = sum * inv;
        sum += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] - tmp[(Math.max(0, y - r) * w + x) * 4 + c];
      }
    }
  }
}

function classify(px, W, H, palette, hasAlpha) {
  const K = palette.length, lab = new Uint8Array(W * H), P = palette;
  const pairs = []; for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
    const v = [P[j][0] - P[i][0], P[j][1] - P[i][1], P[j][2] - P[i][2]], vv = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
    if (vv >= 1) pairs.push([i, j, v, vv]);
  }
  for (let i = 0, p = 0; i < lab.length; i++, p += 4) {
    if (hasAlpha && px[p + 3] < 128) { lab[i] = 255; continue; }
    const r = px[p], g = px[p + 1], b = px[p + 2];
    let best = Infinity, L = 0;
    for (let a = 0; a < K; a++) { const d = (r - P[a][0]) ** 2 + (g - P[a][1]) ** 2 + (b - P[a][2]) ** 2; if (d < best) { best = d; L = a; } }
    for (const [a, c, v, vv] of pairs) {                   // pixel as a blend of two colors
      let t = ((r - P[a][0]) * v[0] + (g - P[a][1]) * v[1] + (b - P[a][2]) * v[2]) / vv;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = ((r - P[a][0] - t * v[0]) ** 2 + (g - P[a][1] - t * v[1]) ** 2 + (b - P[a][2] - t * v[2]) ** 2) * 1.15;
      if (d < best) { best = d; L = t < 0.5 ? a : c; }
    }
    lab[i] = L;
  }
  return lab;
}

// background regions not connected to the border (4-connected flood fill)
function enclosedMask(lab, W, H, bgLabel) {
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
  let sp = 0;
  const push = i => { if (!seen[i] && lab[i] === bgLabel) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W); if (i < W * (H - 1)) push(i + W);
  }
  const inner = new Uint8Array(W * H); let any = false;
  for (let i = 0; i < inner.length; i++) if (lab[i] === bgLabel && !seen[i]) { inner[i] = 1; any = true; }
  return any ? inner : null;
}

let mask;                                                   // reused ImageData buffer
async function trace(W, H, test, turd) {
  if (!mask || mask.width !== W || mask.height !== H) mask = new ImageData(W, H);
  const d = mask.data;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) { const v = test(i) ? 0 : 255; d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255; }
  const out = await potrace(mask, { turdsize: turd, turnpolicy: 4, alphamax: 1, opticurve: 1, opttolerance: 0.4, pathonly: true, extractcolors: false, posterizelevel: 1, posterizationalgorithm: 0 });
  return (Array.isArray(out) ? out.join(' ') : String(out)).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- variants
function makeVariants(fg, bg, areas) {
  const n = fg.length, L = fg.map(h => lum(parseHex(h))), bgL = bg ? lum(parseHex(bg)) : null;
  const total = areas.reduce((a, b) => a + b, 0) || 1, darkest = fg[L.indexOf(Math.min(...L))];
  const safe = (idx, color) => fg.every((h, i) => idx.includes(i) || Math.sqrt(dist2(parseHex(h), parseHex(color))) > 60);
  const V = [];
  if (bg) V.push({ id: 'color-on-background', fills: fg, bg, preview: bg, padded: true });
  V.push({ id: 'color-transparent', fills: fg, preview: bg || (Math.min(...L) < 0.4 ? '#FFFFFF' : '#161616') });
  const light = L.flatMap((l, i) => l > 0.7 ? [i] : []);
  if (light.length && (bgL === null || bgL < 0.45)) {
    const share = light.reduce((a, i) => a + areas[i], 0) / total;
    const rep = bg && bgL < 0.45 ? bg : Math.min(...L) < 0.3 ? darkest : '#1A1A1A';
    if ((bg || share >= 0.4) && safe(light, rep)) V.push({ id: 'color-for-light-backgrounds', preview: '#FFFFFF', fills: fg.map((h, i) => light.includes(i) ? rep : h) });
  }
  const dark = L.flatMap((l, i) => l < 0.12 ? [i] : []);
  if (dark.length && (bgL === null || bgL > 0.5)) {
    const share = dark.reduce((a, i) => a + areas[i], 0) / total;
    if ((bg || share >= 0.4) && safe(dark, '#FFFFFF')) V.push({ id: 'color-for-dark-backgrounds', preview: '#161616', fills: fg.map((h, i) => dark.includes(i) ? '#FFFFFF' : h) });
  }
  V.push({ id: 'mono-black', mono: '#000000', preview: '#FFFFFF' });
  V.push({ id: 'mono-white', mono: '#FFFFFF', preview: '#161616' });
  return V;
}

// ---------------------------------------------------------------- main
async function run(id, file, opt) {
  const t0 = performance.now(), warn = [];
  const step = (key, pct) => post(id, 'progress', { step: key, pct });
  step('decode', 2);
  const bitmap = await createImageBitmap(file);
  const w0 = bitmap.width, h0 = bitmap.height;
  const cv = new OffscreenCanvas(w0, h0), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bitmap, 0, 0);
  const src = cx.getImageData(0, 0, w0, h0).data;
  let hasAlpha = false; for (let i = 3; i < src.length; i += 4) if (src[i] < 250) { hasAlpha = true; break; }
  if (Math.max(w0, h0) < 600) warn.push({ code: 'smallSource', w: w0, h: h0 });

  step('palette', 8);
  const bg = detectBackground(src, w0, h0, hasAlpha, opt.background);
  const fg = opt.colors?.length ? opt.colors.map(parseHex) : detectPalette(bitmap, hasAlpha, bg, opt.maxColors || 6, warn);

  // crop to content
  let x0 = 0, y0 = 0, x1 = w0, y1 = h0;
  {
    const dmin = bg ? Math.min(...fg.map(c => Math.sqrt(dist2(c, bg)))) : 0, thr = Math.max(20, dmin * 0.35);
    let minx = w0, miny = h0, maxx = -1, maxy = -1;
    for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
      const p = (y * w0 + x) * 4;
      const on = bg ? Math.sqrt(dist2([src[p], src[p + 1], src[p + 2]], bg)) > thr : src[p + 3] > 128;
      if (on) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    }
    if (maxx < 0) throw Object.assign(new Error('onlyBackground'), { code: 'onlyBackground' });
    const m = Math.floor(Math.max(w0, h0) * 0.012) + 2;
    x0 = Math.max(0, minx - m); y0 = Math.max(0, miny - m); x1 = Math.min(w0, maxx + m + 1); y1 = Math.min(h0, maxy + m + 1);
  }
  const cw = x1 - x0, ch = y1 - y0;
  const cropPixels = new Uint8ClampedArray(cx.getImageData(x0, y0, cw, ch).data);

  let S = Math.max(1, Math.min(8, Math.round(8000 / Math.max(cw, ch))));
  while (cw * S * ch * S > (opt.maxPixels || 24e6) && S > 1) S--;
  const W = cw * S, H = ch * S;

  step('upscale', 18);
  const up = new OffscreenCanvas(W, H), ux = up.getContext('2d', { willReadFrequently: true });
  ux.imageSmoothingEnabled = true; ux.imageSmoothingQuality = 'high';
  ux.drawImage(bitmap, x0, y0, cw, ch, 0, 0, W, H);
  bitmap.close();
  const px = ux.getImageData(0, 0, W, H).data;
  boxBlur(px, W, H, Math.round(0.3 * S));

  step('classify', 34);
  const palette = bg ? [bg, ...fg] : fg, off = bg ? 1 : 0, n = fg.length;
  const lab = classify(px, W, H, palette, hasAlpha);
  const area = fg.map((_, i) => { let c = 0; for (let j = 0; j < lab.length; j++) if (lab[j] === i + off) c++; return c; });
  const order = [...fg.keys()].sort((a, b) => area[b] - area[a]);   // biggest at the bottom
  const fgSorted = order.map(i => fg[i]), idx = order.map(i => i + off), areas = order.map(i => area[i]);
  const rank = new Int16Array(256).fill(-1); idx.forEach((l, k) => rank[l] = k);

  const inner = opt.fillEnclosed && bg ? enclosedMask(lab, W, H, 0) : null;
  const turd = Math.max(2, Math.floor(S * S * 0.4));
  await init();
  const layers = [];
  for (let k = 0; k < n; k++) {
    step('trace', 45 + Math.round(40 * k / (n + 1)));
    layers.push(await trace(W, H, i => rank[lab[i]] >= k || (k === 0 && inner && inner[i]), turd));
  }
  let colors = fgSorted.map(hex);
  if (inner) {
    layers.splice(1, 0, await trace(W, H, i => inner[i] && rank[lab[i]] < 0, turd));
    colors.splice(1, 0, hex(bg)); areas.splice(1, 0, inner.reduce((a, v) => a + v, 0));
  }

  // one-color silhouette: parts close to the background are knocked out
  const refL = bg ? lum(bg) : (fgSorted.reduce((a, c, k) => a + lum(c) * areas[k], 0) / Math.max(1, areas.reduce((a, b) => a + b, 0)) < 0.5 ? 1 : 0);
  const contrast = l => (Math.max(l, refL) + 0.05) / (Math.min(l, refL) + 0.05);
  const ink = new Uint8Array(256); let inkCount = 0;
  fgSorted.forEach((c, k) => { if (contrast(lum(c)) >= 1.8) { ink[idx[k]] = 1; inkCount++; } });
  step('trace', 88);
  const monoKnockout = (inkCount > 0 && inkCount < n) || !!inner;
  const monoPath = monoKnockout ? await trace(W, H, i => inkCount ? ink[lab[i]] === 1 : rank[lab[i]] >= 0, turd) : layers[0];

  // small-detail check at source scale: count short connected parts of the logo
  let tiny = 0;
  {
    const seen = new Uint8Array(cw * ch), onAt = (x, y) => { const l = lab[(y * S + (S >> 1)) * W + x * S + (S >> 1)]; return l !== 255 && rank[l] >= 0; };
    const st = [];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x; if (seen[i] || !onAt(x, y)) continue;
      let miny = y, maxy = y; seen[i] = 1; st.push(i);
      while (st.length) {
        const j = st.pop(), jx = j % cw, jy = (j / cw) | 0; if (jy < miny) miny = jy; if (jy > maxy) maxy = jy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const q = ny * cw + nx; if (!seen[q] && onAt(nx, ny)) { seen[q] = 1; st.push(q); }
        }
      }
      const hh = maxy - miny + 1; if (hh >= 4 && hh < 28) tiny++;
    }
  }
  if (tiny >= 6) warn.push({ code: 'smallParts', count: tiny });

  step('done', 100);
  return {
    source: { width: w0, height: h0, name: file.name || 'logo' },
    crop: [x0, y0, x1, y1], width: cw, height: ch, scale: S, W, H,
    transform: `translate(0,${H}) scale(0.1,-0.1)`,
    background: bg ? hex(bg) : null, colors, areas, layers, monoLayer: monoPath, monoKnockout,
    variants: makeVariants(colors, bg ? hex(bg) : null, areas),
    cropPixels, warnings: warn, ms: Math.round(performance.now() - t0),
    options: { background: opt.background || 'auto', colors: opt.colors || null, fillEnclosed: !!opt.fillEnclosed },
  };
}

self.onmessage = async e => {
  const { id, file, options } = e.data;
  try {
    const result = await run(id, file, options || {});
    self.postMessage({ id, type: 'result', result }, [result.cropPixels.buffer]);
  } catch (err) {
    post(id, 'error', { code: err.code || 'failed', message: String(err.message || err) });
  }
};
