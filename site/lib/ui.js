// The tool's UI. One implementation, mounted by the standalone page and by <logo-vectorizer>.
import * as LV from './vectorizer.js';
import { saveSession, loadSession, clearSession } from './session.js';
import ar from './i18n/ar.js';
import en from './i18n/en.js';

const DICT = { ar, en };
const FORMATS = ['svg', 'pdf', 'eps', 'png'];
const WIDTHS = [1000, 2000, 4000];
const CORNERS = ['sharp', 'balanced', 'smooth'];
export const MAX_BATCH = 20;
const defaultOptions = () => ({ background: 'auto', colors: null, fillEnclosed: false, corners: 'balanced' });

const fmt = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const svgNode = markup => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };

export function supported() {
  return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

/**
 * Mount the tool into `root`.
 * @param {HTMLElement} root
 * @param {{lang?:'ar'|'en', hostActionLabel?:string, onUse?:(payload)=>void, onResult?:(result)=>void, persist?:boolean}} opts
 * @returns {{setLang:(l)=>void, destroy:()=>void}}
 */
export function mount(root, opts = {}) {
  const S = {
    lang: DICT[opts.lang] ? opts.lang : 'ar',
    stage: 'upload',               // upload | tracing | review
    items: [], active: 0,          // item: { file, url, name, options, result, error, selected, dirty }
    ack: false, error: null, resume: null,
    progress: { step: 'decode', pct: 0, index: 0, count: 1 },
    split: 50, previewBg: null, showDiff: false,
    formats: new Set(FORMATS), widths: new Set([1000, 4000]),
    building: null, notice: null,
  };
  const t = () => DICT[S.lang];
  const cur = () => S.items[S.active];
  const traced = () => S.items.filter(it => it.result);
  root.classList.add('lv');

  const errText = err => {
    const message = fmt(t().errors[err.code] || t().errors.failed, err);
    return err.name ? fmt(t().fileProblem, { name: err.name, message }) : message;
  };

  // ---------------------------------------------------------------- actions
  function newItem(file, name, options) {
    return { file, url: URL.createObjectURL(file), name: name || LV.slugify(file.name || 'logo'), options: { ...defaultOptions(), ...options }, result: null, error: null, selected: null, dirty: false };
  }

  async function addFiles(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    S.error = null; S.resume = null;
    for (const file of files) {
      if (S.items.length >= MAX_BATCH) { S.error = { code: 'tooManyFiles', max: MAX_BATCH }; break; }
      const problem = await LV.checkFile(file);
      if (problem) S.error = { ...problem, name: file.name };
      else S.items.push(newItem(file));
    }
    render();
  }

  function removeItem(i) {
    const [it] = S.items.splice(i, 1);
    if (!it) return;
    URL.revokeObjectURL(it.url);
    if (S.active >= S.items.length) S.active = Math.max(0, S.items.length - 1);
    if (S.stage === 'review') {
      if (!traced().length) S.stage = 'upload';
      else { activate(S.active); persist(); }
    }
    render();
  }

  function activate(i) {
    S.active = Math.max(0, i);
    const r = cur()?.result;
    if (r) S.previewBg = r.background || r.variants.find(v => v.id === 'color-transparent').preview;
  }

  async function traceItems(list) {
    S.stage = 'tracing'; S.error = null; S.notice = null; render();
    let cancelled = false;
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      S.progress = { step: 'decode', pct: 0, index: k, count: list.length }; updateProgress();
      const t0 = performance.now();
      try {
        const r = await LV.vectorize(it.file, it.options, (step, pct) => { S.progress = { ...S.progress, step: step === 'done' ? 'check' : step, pct }; updateProgress(); });
        r.seconds = ((performance.now() - t0) / 1000).toFixed(1);
        Object.assign(it, { result: r, error: null, dirty: false, selected: new Set(r.variants.map(v => v.id)) });
        opts.onResult?.(r);
        root.dispatchEvent(new CustomEvent('lv-result', { detail: r, bubbles: true }));
      } catch (e) {
        if (e.code === 'cancelled') { cancelled = true; break; }
        it.error = { code: e.code || 'failed', message: e.message };   // a failed retrace keeps the previous result
      }
    }
    if (traced().length) {
      S.stage = 'review';
      // a single retrace stays on its logo (even if it failed); a batch opens on a traced one
      activate(list.length === 1 || cur()?.result ? S.active : S.items.findIndex(it => it.result));
      persist();
    } else {
      S.stage = 'upload';
      const failed = S.items.find(it => it.error);
      if (failed && !cancelled) S.error = { ...failed.error, name: failed.name };
    }
    render();
  }

  function setOption(patch) { Object.assign(cur().options, patch); cur().dirty = true; render(); }

  function persist() {
    if (!opts.persist) return;
    const done = traced();
    if (!done.length) { clearSession(); return; }
    saveSession({ items: done.map(it => ({ file: it.file, name: it.name, options: it.result.options })), active: Math.max(0, done.indexOf(cur())) });
  }

  function resume() {
    const s = S.resume; if (!s) return;
    S.items = s.items.map(x => newItem(x.file, x.name, x.options));
    S.active = s.active < S.items.length ? s.active : 0;
    S.ack = true; S.resume = null;
    traceItems(S.items);
  }

  function discardResume() { S.resume = null; clearSession(); render(); }

  const pickedFormats = () => FORMATS.filter(f => S.formats.has(f));
  const pngWidths = () => [...S.widths].sort((a, b) => a - b);

  async function exportZip() {
    const it = cur(), variants = it.result.variants.filter(v => it.selected.has(v.id)), formats = pickedFormats();
    if (!variants.length || !formats.length) return;
    S.building = 0; render();
    try {
      const files = await LV.buildFiles(it.result, { name: it.name, title: it.name, variants, formats, pngWidths: pngWidths() }, p => { S.building = p; updateBuilding(); });
      LV.download(LV.zip(files), `${LV.slugify(it.name)}-logo.zip`);
    } catch (e) { S.notice = { kind: 'error', text: fmt(t().errors.failed, { message: e.message }) }; }
    S.building = null; render();
  }

  // one ZIP, one folder per logo, each with that logo's own variant selection
  async function exportAll() {
    const done = traced().filter(it => it.selected.size), formats = pickedFormats();
    if (!done.length || !formats.length) return;
    S.building = 0; render();
    try {
      const files = {}, used = new Set();
      for (let k = 0; k < done.length; k++) {
        const it = done[k], base = LV.slugify(it.name);
        let folder = base; for (let n = 2; used.has(folder); n++) folder = `${base}-${n}`;
        used.add(folder);
        const variants = it.result.variants.filter(v => it.selected.has(v.id));
        const part = await LV.buildFiles(it.result, { name: it.name, title: it.name, variants, formats, pngWidths: pngWidths() }, p => { S.building = Math.round((k + p / 100) / done.length * 100); updateBuilding(); });
        for (const [path, data] of Object.entries(part)) files[`${folder}/${path}`] = data;
      }
      LV.download(LV.zip(files), 'logos.zip');
    } catch (e) { S.notice = { kind: 'error', text: fmt(t().errors.failed, { message: e.message }) }; }
    S.building = null; render();
  }

  function useInHost() {
    const it = cur(), variants = it.result.variants.filter(v => it.selected.has(v.id));
    const payload = {
      name: it.name, background: it.result.background, colors: it.result.colors, fidelity: it.result.fidelity,
      variants: variants.map(v => ({ id: v.id, label: t().variants[v.id], svg: LV.buildSVG(it.result, v, { title: it.name }) })),
      result: it.result,
    };
    opts.onUse?.(payload);
    root.dispatchEvent(new CustomEvent('lv-use', { detail: payload, bubbles: true }));
  }

  function reset() {
    LV.cancel();
    S.items.forEach(it => URL.revokeObjectURL(it.url));
    Object.assign(S, { stage: 'upload', items: [], active: 0, error: null, notice: null, resume: null });
    if (opts.persist) clearSession();
    render();
  }

  // ---------------------------------------------------------------- views
  function steps() {
    const idx = S.stage === 'upload' ? 0 : S.stage === 'tracing' ? 1 : 2;
    return h('ol', { class: 'lv-steps' }, t().steps.map((s, i) => h('li', { 'data-state': i < idx ? 'done' : i === idx || (idx === 2 && i === 3) ? 'current' : 'todo', 'aria-current': i === idx ? 'step' : null }, s)));
  }

  function errorBox(err = S.error) {
    if (!err) return null;
    return h('p', { class: 'lv-notice', 'data-kind': 'error', role: 'alert' }, errText(err));
  }

  const fileInput = (extra = {}) => h('input', { type: 'file', multiple: true, accept: LV.LIMITS.types.join(','), onchange: e => { addFiles(e.target.files); e.target.value = ''; }, ...extra });

  function resumeView() {
    const s = S.resume;
    const mins = Math.max(0, Math.round((Date.now() - s.savedAt) / 60000));
    const rtf = new Intl.RelativeTimeFormat(S.lang, { numeric: 'auto' });
    const time = mins < 60 ? rtf.format(-mins, 'minute') : rtf.format(-Math.round(mins / 60), 'hour');
    const text = s.items.length > 1 ? fmt(t().resumeManyText, { n: s.items.length, time }) : fmt(t().resumeText, { name: s.items[0].name, time });
    return h('section', { class: 'lv-resume', 'aria-labelledby': 'lv-resume-title' },
      h('div', {}, h('h2', { id: 'lv-resume-title' }, t().resumeTitle), h('p', { class: 'lv-small lv-muted' }, text)),
      h('div', { class: 'lv-row' },
        h('button', { class: 'lv-btn lv-btn-primary', onclick: resume }, t().resume),
        h('button', { class: 'lv-btn lv-btn-quiet', onclick: discardResume }, t().discard)));
  }

  function privacyHint() {
    return h('p', { class: 'lv-hint', style: { marginTop: '10px' } }, opts.persist ? `${t().privacy} ${t().persistNote}` : t().privacy);
  }

  function uploadView() {
    if (!S.items.length) {
      const drop = h('div', { class: 'lv-drop' },
        fileInput({ 'aria-label': t().dropTitle }),
        h('div', {}, h('strong', {}, t().dropTitle), h('p', { class: 'lv-muted' }, t().dropHint), h('p', { class: 'lv-muted lv-small' }, fmt(t().dropLimits, { mb: Math.round(LV.LIMITS.maxFileBytes / 1048576), max: MAX_BATCH }))));
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.dataset.over = ''; }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); delete drop.dataset.over; }));
      drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
      return [S.resume ? resumeView() : null, drop, errorBox(), privacyHint()];
    }
    const n = S.items.length;
    return [
      h('ul', { class: 'lv-files', 'aria-label': t().logosTitle }, S.items.map((it, i) => h('li', { class: 'lv-picked' },
        h('img', { src: it.url, alt: '' }),
        h('div', {}, h('b', {}, it.file.name || it.name), h('span', { class: 'lv-muted lv-small' }, `${(it.file.size / 1024).toFixed(0)} KB`)),
        h('button', { class: 'lv-btn lv-btn-quiet', 'aria-label': fmt(t().removeFile, { name: it.file.name || it.name }), onclick: () => removeItem(i) }, '✕')))),
      n < MAX_BATCH ? h('label', { class: 'lv-btn lv-btn-quiet lv-add', style: { position: 'relative' } }, '+ ' + t().addMore,
        fileInput({ style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' } })) : null,
      h('label', { class: 'lv-check' }, h('input', { type: 'checkbox', checked: S.ack, onchange: e => { S.ack = e.target.checked; startBtn.disabled = !S.ack; } }), h('span', {}, t().ack)),
      errorBox(),
      h('div', { class: 'lv-row' }, (startBtn = h('button', { class: 'lv-btn lv-btn-primary lv-start', disabled: !S.ack, onclick: () => traceItems(S.items) }, n > 1 ? fmt(t().startMany, { n }) : t().start))),
      privacyHint(),
    ];
  }
  let startBtn;

  let barEl, labelEl;
  function tracingView() {
    barEl = h('i', {}); labelEl = h('p', { 'aria-live': 'polite' });
    const box = h('div', { class: 'lv-progress' }, labelEl, h('div', { class: 'lv-bar', role: 'progressbar', 'aria-label': t().progressLabel, 'aria-valuemin': 0, 'aria-valuemax': 100 }, barEl),
      h('button', { class: 'lv-btn', onclick: () => LV.cancel() }, t().cancel));
    queueMicrotask(updateProgress);
    return [box];
  }
  function updateProgress() {
    if (!barEl) return;
    const { pct, step, index, count } = S.progress;
    barEl.style.width = pct + '%';
    barEl.parentElement.setAttribute('aria-valuenow', pct);
    const label = t().progress[step] || '';
    labelEl.textContent = count > 1 ? fmt(t().progressMany, { i: index + 1, n: count, step: label }) : label;
  }

  function stripView() {
    if (S.items.length < 2) return null;
    return h('nav', { class: 'lv-strip', 'aria-label': t().logosTitle }, S.items.map((it, i) =>
      h('button', { class: 'lv-strip-item', 'aria-current': i === S.active ? 'true' : null, 'data-state': it.result ? 'ok' : 'failed', onclick: () => { activate(i); render(); } },
        h('img', { src: it.url, alt: '' }),
        h('span', {}, h('b', {}, it.name), h('small', {}, it.result ? `${it.result.fidelity}%` : t().notTraced)))));
  }

  function stageView(r) {
    const stage = h('div', { class: 'lv-stage', style: { '--lv-ratio': `${r.width} / ${r.height}`, '--lv-split': S.split + '%' } });
    const setBgClass = () => {
      stage.classList.toggle('lv-checker', S.previewBg === 'checker');
      stage.style.backgroundColor = S.previewBg === 'checker' ? '' : S.previewBg;
      const L = S.previewBg === 'checker' ? 1 : luminance(S.previewBg);
      stage.style.setProperty('--lv-divider', L > 0.5 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.7)');
    };
    setBgClass();
    const orig = h('div', { class: 'lv-layer lv-orig' }, LV.originalCanvas(r));
    const vec = h('div', { class: 'lv-layer lv-vec' }, svgNode(LV.previewSVG(r, { fills: r.colors }, t().vector)));
    const diff = h('div', { class: 'lv-layer lv-vec lv-diff', hidden: !S.showDiff }, LV.diffCanvas(r));
    const divider = h('div', { class: 'lv-divider', 'aria-hidden': 'true' }, h('span', {}, '⟷'));
    stage.append(orig, vec, diff, divider, h('span', { class: 'lv-stage-tag lv-tag-left', 'aria-hidden': 'true' }, t().original), h('span', { class: 'lv-stage-tag lv-tag-right', 'aria-hidden': 'true' }, t().vector));
    stage.setAttribute('role', 'slider'); stage.setAttribute('tabindex', '0'); stage.setAttribute('aria-label', t().compareHint);
    stage.setAttribute('aria-valuemin', 0); stage.setAttribute('aria-valuemax', 100); stage.setAttribute('aria-valuenow', S.split);
    const move = x => { const b = stage.getBoundingClientRect(); S.split = Math.round(Math.max(0, Math.min(100, (x - b.left) / b.width * 100))); stage.style.setProperty('--lv-split', S.split + '%'); stage.setAttribute('aria-valuenow', S.split); };
    stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); move(e.clientX); });
    stage.addEventListener('pointermove', e => { if (stage.hasPointerCapture(e.pointerId)) move(e.clientX); });
    stage.addEventListener('keydown', e => {
      const d = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0; if (!d) return;
      e.preventDefault(); const b = stage.getBoundingClientRect(); move(b.left + b.width * (S.split + d) / 100);
    });

    const swatchColors = [...new Set([r.background, ...r.colors, '#FFFFFF', '#000000'].filter(Boolean)), 'checker'];
    const swatches = h('div', { class: 'lv-swatches', role: 'group', 'aria-label': t().previewBg }, swatchColors.map(c => {
      const b = h('button', { class: 'lv-sw' + (c === 'checker' ? ' lv-checker' : ''), 'aria-label': c === 'checker' ? t().transparent : c, 'aria-pressed': String(S.previewBg === c), style: c === 'checker' ? {} : { background: c } });
      b.onclick = () => { S.previewBg = c; setBgClass(); swatches.querySelectorAll('.lv-sw').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
      return b;
    }));
    const diffToggle = h('label', { class: 'lv-switch' }, h('input', { type: 'checkbox', checked: S.showDiff, onchange: e => { S.showDiff = e.target.checked; diff.hidden = !S.showDiff; } }), t().showDiff);
    const score = h('div', { class: 'lv-score' }, h('b', {}, `${r.fidelity}%`), h('span', { class: 'lv-muted lv-small' }, `${t().fidelity} · ${fmt(t().timing, { s: r.seconds })}`));
    return h('div', { class: 'lv-stage-wrap' }, stage, h('div', { class: 'lv-toolbar' }, score, h('div', { class: 'lv-row' }, swatches, diffToggle)));
  }

  function panelView(it) {
    const r = it.result, o = it.options;
    const colors = o.colors || r.colors.filter((c, i) => !(r.options.fillEnclosed && i === 1 && c === r.background));
    const setColors = list => setOption({ colors: list.length ? list : null });
    const colorRows = colors.map((c, i) => h('div', { class: 'lv-color' },
      h('label', { style: { background: c }, title: fmt(t().editColor, { c }) }, h('input', { type: 'color', value: c.toLowerCase(), 'aria-label': fmt(t().editColor, { c }), onchange: e => { const n = [...colors]; n[i] = e.target.value.toUpperCase(); setColors(n); } })),
      h('code', {}, c),
      colors.length > 1 ? h('button', { class: 'lv-btn lv-btn-quiet', 'aria-label': fmt(t().removeColor, { c }), onclick: () => setColors(colors.filter((_, j) => j !== i)) }, '✕') : null));
    const addInput = h('input', { type: 'color', value: '#888888', style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }, 'aria-label': t().addColor, onchange: e => setColors([...colors, e.target.value.toUpperCase()]) });

    const bgMode = o.background === 'auto' ? 'auto' : o.background === 'transparent' ? 'transparent' : 'color';
    const seg = (mode, label, value) => h('button', { class: 'lv-chip', 'aria-pressed': String(bgMode === mode), onclick: () => setOption({ background: value }) }, label);
    const bgColorInput = h('input', { type: 'color', value: (bgMode === 'color' ? o.background : r.background || '#FFFFFF').toLowerCase(), 'aria-label': bgMode === 'color' ? `${t().bgColor}: ${o.background}` : t().bgColor, style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }, onchange: e => setOption({ background: e.target.value.toUpperCase() }) });

    return h('aside', { class: 'lv-panel', 'aria-label': t().settingsTitle },
      h('section', {},
        h('h3', {}, t().backgroundTitle),
        h('p', { class: 'lv-small lv-muted' }, r.background ? [`${t().detectedBg}: `, h('bdi', { dir: 'ltr' }, r.background)] : t().noBg),
        h('div', { class: 'lv-seg' }, seg('auto', t().bgAuto, 'auto'), seg('transparent', t().bgTransparent, 'transparent'),
          h('label', { class: 'lv-chip', 'data-pressed': String(bgMode === 'color'), style: { position: 'relative' } }, bgMode === 'color' ? h('i', { class: 'lv-sw', style: { width: '14px', height: '14px', background: o.background } }) : null, t().bgColor, bgColorInput)),
        (r.background || (bgMode === 'color'))
          ? h('label', { class: 'lv-switch' }, h('input', { type: 'checkbox', checked: o.fillEnclosed, onchange: e => setOption({ fillEnclosed: e.target.checked }) }), t().fillEnclosed)
          : null,
        (r.background || bgMode === 'color') ? h('p', { class: 'lv-hint' }, t().fillEnclosedHint) : null),
      h('section', {},
        h('h3', {}, t().colorsTitle),
        h('div', { class: 'lv-colors' }, colorRows),
        h('label', { class: 'lv-btn', style: { position: 'relative', justifySelf: 'start' } }, '+ ' + t().addColor, addInput)),
      h('section', { class: 'lv-corners' },
        h('h3', { id: 'lv-corners-title' }, t().cornersTitle),
        h('div', { class: 'lv-seg', role: 'group', 'aria-labelledby': 'lv-corners-title' }, CORNERS.map(c =>
          h('button', { class: 'lv-chip', 'data-corners': c, 'aria-pressed': String((o.corners || 'balanced') === c), onclick: () => setOption({ corners: c }) }, t().corners[c]))),
        h('p', { class: 'lv-hint' }, t().cornersHint)),
      it.dirty ? h('p', { class: 'lv-notice', role: 'status' }, t().optionsChanged) : null,
      h('button', { class: 'lv-btn lv-retrace ' + (it.dirty ? 'lv-btn-primary' : ''), disabled: !it.dirty, onclick: () => traceItems([it]) }, t().retrace),
      r.warnings.length ? h('ul', { class: 'lv-warnings' }, r.warnings.map(w => h('li', {}, fmt(t().warn[w.code], w)))) : null,
      errorBox(it.error));
  }

  function failedView(it) {
    return h('section', { class: 'lv-failed' },
      h('img', { src: it.url, alt: '' }),
      h('div', {}, h('b', {}, it.name), it.error ? errorBox(it.error) : h('p', { class: 'lv-notice' }, t().notTraced)),
      h('div', { class: 'lv-row' },
        h('button', { class: 'lv-btn lv-btn-primary', onclick: () => traceItems([it]) }, t().retrace),
        h('button', { class: 'lv-btn lv-btn-quiet', onclick: () => removeItem(S.active) }, t().removeLogo)));
  }

  let buildLabel;
  function downloadView(it) {
    const r = it.result, done = traced();
    const cards = r.variants.map(v => h('div', { class: 'lv-card' },
      h('div', { class: 'lv-thumb', style: { background: v.bg || v.preview } }, svgNode(LV.previewSVG(r, v, t().variants[v.id]))),
      h('button', { class: 'lv-card-svg', 'aria-label': `${t().downloadSvg} — ${t().variants[v.id]}`, onclick: () => LV.download(LV.buildSVG(r, v, { title: it.name }), `${LV.slugify(it.name)}-${v.id}.svg`, 'image/svg+xml') }, '↓ ' + t().downloadSvg),
      h('footer', {},
        h('label', {}, h('input', { type: 'checkbox', checked: it.selected.has(v.id), onchange: e => { e.target.checked ? it.selected.add(v.id) : it.selected.delete(v.id); refreshDownloadState(); } }), h('span', {}, t().variants[v.id])))));
    const formatChips = FORMATS.map(f => h('label', { class: 'lv-chip', title: t().formatUse[f] }, h('input', { type: 'checkbox', checked: S.formats.has(f), onchange: e => { e.target.checked ? S.formats.add(f) : S.formats.delete(f); widthField.hidden = !S.formats.has('png'); refreshDownloadState(); } }), f.toUpperCase()));
    const widthField = h('div', { class: 'lv-field', hidden: !S.formats.has('png') }, h('span', { id: 'lv-widths-title' }, t().pngWidths),
      h('div', { class: 'lv-seg', role: 'group', 'aria-labelledby': 'lv-widths-title' }, WIDTHS.map(w => h('label', { class: 'lv-chip' }, h('input', { type: 'checkbox', checked: S.widths.has(w), onchange: e => { e.target.checked ? S.widths.add(w) : S.widths.delete(w); refreshDownloadState(); } }), `${w}px`))));
    buildLabel = h('span', { class: 'lv-small lv-muted', 'aria-live': 'polite' }, S.building != null ? fmt(t().building, { p: S.building }) : '');
    zipBtn = h('button', { class: 'lv-btn lv-btn-primary lv-zip', onclick: exportZip }, done.length > 1 ? fmt(t().downloadOne, { name: it.name }) : t().downloadZip);
    allBtn = done.length > 1 ? h('button', { class: 'lv-btn lv-all', onclick: exportAll }, fmt(t().downloadAll, { n: done.length })) : null;
    hostBtn = opts.hostActionLabel ? h('button', { class: 'lv-btn', onclick: useInHost }, opts.hostActionLabel) : null;
    const view = h('section', { class: 'lv-download', 'aria-labelledby': 'lv-variants-title' },
      h('div', { class: 'lv-row lv-spread' }, h('h2', { id: 'lv-variants-title' }, t().variantsTitle)),
      h('div', { class: 'lv-grid' }, cards),
      h('div', { class: 'lv-opts' },
        h('div', { class: 'lv-field' }, h('span', { id: 'lv-formats-title' }, t().formatsTitle), h('div', { class: 'lv-seg', role: 'group', 'aria-labelledby': 'lv-formats-title' }, formatChips), h('ul', { class: 'lv-legend' }, FORMATS.map(f => h('li', {}, h('bdi', { dir: 'ltr' }, f.toUpperCase()), ' ', t().formatUse[f])))),
        widthField,
        h('label', { class: 'lv-field' }, h('span', {}, t().fileName), h('input', { class: 'lv-input', value: it.name, spellcheck: 'false', oninput: e => { it.name = e.target.value; } }))),
      S.notice ? h('p', { class: 'lv-notice', 'data-kind': S.notice.kind, role: 'alert' }, S.notice.text) : null,
      h('div', { class: 'lv-actions' }, zipBtn, allBtn, hostBtn, buildLabel, h('span', { style: { flex: 1 } }), h('button', { class: 'lv-btn lv-btn-quiet lv-reset', onclick: reset }, t().startOver)));
    queueMicrotask(refreshDownloadState);
    return view;
  }
  let zipBtn, allBtn, hostBtn;
  function refreshDownloadState() {
    if (!zipBtn) return;
    const it = cur();
    const common = S.formats.size > 0 && (!S.formats.has('png') || S.widths.size > 0) && S.building == null;
    const ok = common && it.selected.size > 0;
    zipBtn.disabled = !ok;
    if (allBtn) allBtn.disabled = !(common && traced().some(x => x.selected.size));
    if (hostBtn) hostBtn.disabled = !(it.selected.size > 0);
    buildLabel.textContent = S.building != null ? fmt(t().building, { p: S.building }) : (!ok && S.building == null ? t().noSelection : '');
  }
  function updateBuilding() { if (buildLabel) buildLabel.textContent = fmt(t().building, { p: S.building }); }

  function render() {
    if (root.getAttribute('dir') !== t().dir) root.setAttribute('dir', t().dir);
    if (root.getAttribute('lang') !== S.lang) root.setAttribute('lang', S.lang);
    zipBtn = allBtn = hostBtn = barEl = null;
    const body = [];
    if (!supported()) body.push(h('p', { class: 'lv-notice', 'data-kind': 'error' }, t().errors.notSupported));
    else if (S.stage === 'upload') body.push(...uploadView());
    else if (S.stage === 'tracing') body.push(...tracingView());
    else {
      const it = cur();
      body.push(stripView());
      if (it.result) body.push(h('div', { class: 'lv-review' }, stageView(it.result), panelView(it)), downloadView(it));
      else body.push(failedView(it));
    }
    root.replaceChildren(steps(), ...body.filter(Boolean));
  }

  const onPaste = e => {
    if (S.stage !== 'upload') return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { const f = item.getAsFile(); addFiles([new File([f], `pasted.${f.type.split('/')[1] || 'png'}`, { type: f.type })]); }
  };
  document.addEventListener('paste', onPaste);
  render();
  if (opts.persist) loadSession().then(s => { if (s && S.stage === 'upload' && !S.items.length) { S.resume = s; render(); } });

  return {
    setLang(l) { if (DICT[l] && l !== S.lang) { S.lang = l; render(); } },
    destroy() { document.removeEventListener('paste', onPaste); LV.cancel(); S.items.forEach(it => URL.revokeObjectURL(it.url)); root.replaceChildren(); root.classList.remove('lv'); },
    strings: () => t(),
  };
}

function luminance(hex) {
  if (!hex || hex[0] !== '#') return 1;
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
