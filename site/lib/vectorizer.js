// logo-vectorize core — framework-agnostic. Used by the standalone page, the
// <logo-vectorizer> element, and any host app (Brand Kit Builder, font tool).
import { zipSync, strToU8 } from './vendor/fflate.js';

const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent + (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform) ? ' iPad' : ''));

// iOS Safari refuses canvases above ~16.7M pixels; desktop has room but memory is not free
export const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxSourcePixels: 60e6,
  maxWorkPixels: isMobile ? 12e6 : 24e6,
  types: ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'],
};

// ---------------------------------------------------------------- worker bridge
let worker, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id); if (!job) return;
    if (data.type === 'progress') job.onProgress?.(data.step, data.pct);
    else { pending.delete(data.id); data.type === 'result' ? job.resolve(data.result) : job.reject(Object.assign(new Error(data.message), { code: data.code })); }
  };
  worker.onerror = e => { for (const j of pending.values()) j.reject(Object.assign(new Error(e.message || 'worker'), { code: 'failed' })); pending.clear(); worker = null; };
  return worker;
}

/** Stop any running job and free the worker's memory. */
export function cancel() {
  if (!worker) return;
  worker.terminate(); worker = null;
  for (const j of pending.values()) j.reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
  pending.clear();
}

/** Check a file before tracing. Returns null when fine, or { code, ... }. */
export async function checkFile(file) {
  if (!file) return { code: 'noFile' };
  if (/svg|pdf|postscript|illustrator|eps/i.test(file.type) || /\.(svg|pdf|ai|eps)$/i.test(file.name || '')) return { code: 'alreadyVector' };
  if (file.type && !LIMITS.types.includes(file.type)) return { code: 'badType' };
  if (file.size > LIMITS.maxFileBytes) return { code: 'tooLarge', mb: Math.round(LIMITS.maxFileBytes / 1048576) };
  try {
    const bm = await createImageBitmap(file); const px = bm.width * bm.height; bm.close();
    if (px > LIMITS.maxSourcePixels) return { code: 'tooManyPixels' };
  } catch { return { code: 'unreadable' }; }
  return null;
}

/**
 * Trace a raster logo.
 * @param {Blob} file
 * @param {{background?:'auto'|'transparent'|string, colors?:string[], fillEnclosed?:boolean, corners?:'sharp'|'balanced'|'smooth', maxColors?:number}} options
 * @param {(step:string, pct:number)=>void} onProgress
 */
export function vectorize(file, options = {}, onProgress) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, file, options: { maxPixels: LIMITS.maxWorkPixels, ...options } });
  }).then(async result => {
    result.fidelity = await measureFidelity(result);
    if (result.fidelity < 98.5) result.warnings.push({ code: 'lowFidelity', value: result.fidelity });
    return result;
  });
}

// ---------------------------------------------------------------- SVG
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fillsFor(result, variant) {
  return variant.mono ? null : variant.fills;
}

/** Complete, standalone SVG for one variant. */
export function buildSVG(result, variant, { title = 'logo' } = {}) {
  const { W, H, scale: S, transform } = result;
  const pad = variant.padded ? Math.round(Math.min(W, H) * 0.3) : 0, vw = W + 2 * pad, vh = H + 2 * pad;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${Math.round(vw / S)}" height="${Math.round(vh / S)}">`, `<title>${esc(title)}</title>`];
  if (variant.bg) o.push(`<rect id="background" width="${vw}" height="${vh}" fill="${variant.bg}"/>`);
  o.push(`<g transform="translate(${pad},${pad})">`);
  const fills = fillsFor(result, variant);
  if (fills) result.layers.forEach((d, i) => { if (d) o.push(`<g id="layer-${i + 1}" transform="${transform}"><path fill="${fills[i]}" d="${d}"/></g>`); });
  else o.push(`<g id="layer-1" transform="${transform}"><path fill="${variant.mono}" d="${result.monoLayer}"/></g>`);
  o.push('</g></svg>');
  return o.join('\n');
}

/** Lightweight inline SVG for previews — no padding/background, fills the box. */
export function previewSVG(result, variant, label = '') {
  const fills = fillsFor(result, variant);
  const body = fills ? result.layers.map((d, i) => `<path fill="${fills[i]}" d="${d}"/>`).join('') : `<path fill="${variant.mono}" d="${result.monoLayer}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.W} ${result.H}" role="img" aria-label="${esc(label)}"><g transform="${result.transform}">${body}</g></svg>`;
}

// ---------------------------------------------------------------- raster
function loadSVGImage(svg) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('svg render')); };
    img.src = url;
  });
}

export async function toPNG(svg, width, aspect) {
  const img = await loadSVGImage(svg);
  const h = Math.round(width * (aspect || img.naturalHeight / img.naturalWidth));
  const c = document.createElement('canvas'); c.width = width; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, width, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// render the traced logo back at source size and compare with the original crop
async function measureFidelity(result) {
  const { width: cw, height: ch, cropPixels: orig } = result;
  const refBg = result.background || '#FFFFFF';
  const svg = buildSVG(result, { id: 'check', fills: result.colors, bg: refBg });
  const img = await loadSVGImage(svg);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, cw, ch);
  const tr = x.getImageData(0, 0, cw, ch).data;
  const rb = [1, 3, 5].map(i => parseInt(refBg.slice(i, i + 2), 16));
  const wrong = new Uint8Array(cw * ch), content = new Uint8Array(cw * ch);
  const diffMap = new Uint8ClampedArray(cw * ch);
  for (let i = 0, p = 0; i < cw * ch; i++, p += 4) {
    const a = orig[p + 3] / 255;
    let dOrig = 0, dTr = 0, diff = 0;
    for (let k = 0; k < 3; k++) {
      const o = orig[p + k] * a + rb[k] * (1 - a);
      diff += Math.abs(o - tr[p + k]); dOrig += Math.abs(o - rb[k]); dTr += Math.abs(tr[p + k] - rb[k]);
    }
    content[i] = dOrig / 3 > 40 || dTr / 3 > 40; wrong[i] = diff / 3 > 40; diffMap[i] = wrong[i];
  }
  let bad = 0, total = 0;
  for (let y = 0; y < ch; y++) for (let xx = 0; xx < cw; xx++) {       // 1px erosion ignores AA seams
    const i = y * cw + xx; if (!content[i]) continue; total++;
    if (!wrong[i]) continue;
    let all = true;
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ny = y + dy, nx = xx + dx; if (ny < 0 || nx < 0 || ny >= ch || nx >= cw || !wrong[ny * cw + nx]) { all = false; break; }
    }
    if (all) bad++;
  }
  result.diffMap = diffMap;
  return Math.round(10000 * (1 - bad / Math.max(1, total))) / 100;
}

/** Original crop as a canvas (for before/after comparison). */
export function originalCanvas(result) {
  const c = document.createElement('canvas'); c.width = result.width; c.height = result.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.cropPixels), result.width, result.height), 0, 0);
  return c;
}

/** Red overlay of pixels that differ between original and trace. */
export function diffCanvas(result) {
  const c = document.createElement('canvas'); c.width = result.width; c.height = result.height;
  const img = new ImageData(result.width, result.height);
  result.diffMap.forEach((v, i) => { if (v) { img.data.set([230, 40, 40, 255], i * 4); } });
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- PDF
// literal `new URL('./…', import.meta.url)` so bundlers (Vite) copy the vendor files
const PDF_SCRIPTS = [new URL('./vendor/jspdf.umd.min.js', import.meta.url).href, new URL('./vendor/svg2pdf.umd.min.js', import.meta.url).href];
let pdfLoader = async () => {
  for (const src of PDF_SCRIPTS) {
    if (document.querySelector(`script[data-lv="${src}"]`)) continue;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.dataset.lv = src; s.onload = res; s.onerror = rej; document.head.append(s); });
  }
  return { jsPDF: window.jspdf.jsPDF };
};
let pdfLib;
/** Hosts that bundle jsPDF + svg2pdf.js themselves can supply them here. */
export function setPdfLoader(fn) { pdfLoader = fn; pdfLib = null; }

export async function toPDF(svg) {
  pdfLib ||= await pdfLoader();
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const w = +el.getAttribute('width'), h = +el.getAttribute('height');
  const holder = document.createElement('div'); holder.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden';
  holder.append(el); document.body.append(holder);
  try {
    const doc = new pdfLib.jsPDF({ unit: 'pt', format: [w, h], orientation: w >= h ? 'l' : 'p', compress: true });
    await doc.svg(el, { x: 0, y: 0, width: w, height: h });
    return new Uint8Array(doc.output('arraybuffer'));
  } finally { holder.remove(); }
}

// ---------------------------------------------------------------- EPS
// potrace paths are already in bottom-up units (×10), which is PostScript's orientation
function pathToPS(d, f, ox, oy) {
  const out = [], tok = d.match(/[MmLlCcZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const num = () => +tok[i++], P = (a, b) => `${(ox + a * f).toFixed(3)} ${(oy + b * f).toFixed(3)}`;
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); sx = x; sy = y; out.push(P(x, y) + ' m'); cmd = 'L'; break;
      case 'm': x += num(); y += num(); sx = x; sy = y; out.push(P(x, y) + ' m'); cmd = 'l'; break;
      case 'L': x = num(); y = num(); out.push(P(x, y) + ' l'); break;
      case 'l': x += num(); y += num(); out.push(P(x, y) + ' l'); break;
      case 'C': { const a = [num(), num(), num(), num(), num(), num()]; out.push(`${P(a[0], a[1])} ${P(a[2], a[3])} ${P(a[4], a[5])} c`); x = a[4]; y = a[5]; break; }
      case 'c': { const a = [num(), num(), num(), num(), num(), num()]; out.push(`${P(x + a[0], y + a[1])} ${P(x + a[2], y + a[3])} ${P(x + a[4], y + a[5])} c`); x += a[4]; y += a[5]; break; }
      case 'Z': case 'z': out.push('h'); x = sx; y = sy; if (i < tok.length && !/[A-Za-z]/.test(tok[i])) i++; break;
      default: i++;
    }
  }
  return out.join('\n');
}

export function toEPS(result, variant, { title = 'logo' } = {}) {
  const { W, H, scale: S } = result;
  const pad = variant.padded ? Math.round(Math.min(W, H) * 0.3) : 0;
  const pw = (W + 2 * pad) / S, ph = (H + 2 * pad) / S, f = 0.1 / S, o = pad / S;
  const rgb = h => [1, 3, 5].map(k => (parseInt(h.slice(k, k + 2), 16) / 255).toFixed(4)).join(' ');
  const L = ['%!PS-Adobe-3.0 EPSF-3.0', `%%BoundingBox: 0 0 ${Math.ceil(pw)} ${Math.ceil(ph)}`, `%%HiResBoundingBox: 0 0 ${pw.toFixed(3)} ${ph.toFixed(3)}`,
    `%%Title: ${title.replace(/[^\x20-\x7E]/g, '')}`, '%%Creator: logo-vectorize', '%%LanguageLevel: 2', '%%EndComments',
    '/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def /h {closepath} bind def', 'gsave'];
  if (variant.bg) L.push(`${rgb(variant.bg)} setrgbcolor 0 0 ${pw.toFixed(3)} ${ph.toFixed(3)} rectfill`);
  const paint = (d, color) => { if (d) L.push(`${rgb(color)} setrgbcolor newpath`, pathToPS(d, f, o, o), 'fill'); };
  if (variant.mono) paint(result.monoLayer, variant.mono);
  else result.layers.forEach((d, i) => paint(d, variant.fills[i]));
  L.push('grestore', 'showpage', '%%EOF');
  return L.join('\n');
}

// ---------------------------------------------------------------- pack
export const slugify = s => (String(s).normalize('NFKD').replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'logo');

/** Build every file for the chosen variants. Returns { [path]: Uint8Array }. */
export async function buildFiles(result, { name = 'logo', title = name, variants = result.variants, formats = ['svg', 'pdf', 'eps', 'png'], pngWidths = [1000, 4000] } = {}, onProgress) {
  const files = {}, slug = slugify(name), steps = variants.length * formats.length; let done = 0;
  const tick = () => onProgress?.(Math.round(100 * ++done / steps));
  for (const v of variants) {
    const base = `${slug}-${v.id}`, svg = buildSVG(result, v, { title });
    if (formats.includes('svg')) { files[`SVG/${base}.svg`] = strToU8(svg); tick(); }
    if (formats.includes('pdf')) { files[`PDF/${base}.pdf`] = await toPDF(svg); tick(); }
    if (formats.includes('eps')) { files[`EPS/${base}.eps`] = strToU8(toEPS(result, v, { title })); tick(); }
    if (formats.includes('png')) { for (const w of pngWidths) files[`PNG/${base}-${w}px.png`] = await toPNG(svg, w); tick(); }
  }
  return files;
}

export function zip(files) {
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
