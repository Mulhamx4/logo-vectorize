// The tool's UI. One implementation, mounted by the standalone page and by <logo-vectorizer>.
import * as LV from './vectorizer.js';
import ar from './i18n/ar.js';
import en from './i18n/en.js';

const DICT = { ar, en };
const FORMATS = ['svg', 'pdf', 'eps', 'png'];
const WIDTHS = [1000, 2000, 4000];

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
 * @param {{lang?:'ar'|'en', hostActionLabel?:string, onUse?:(payload)=>void, onResult?:(result)=>void}} opts
 * @returns {{setLang:(l)=>void, destroy:()=>void}}
 */
export function mount(root, opts = {}) {
  const S = {
    lang: DICT[opts.lang] ? opts.lang : 'ar',
    stage: 'upload',               // upload | tracing | review
    file: null, fileURL: null, ack: false, error: null,
    progress: { step: 'decode', pct: 0 },
    result: null, options: { background: 'auto', colors: null, fillEnclosed: false }, dirty: false,
    split: 50, previewBg: null, showDiff: false,
    selected: null, formats: new Set(FORMATS), widths: new Set([1000, 4000]), name: 'logo',
    building: null, notice: null,
  };
  const t = () => DICT[S.lang];
  root.classList.add('lv');

  // ---------------------------------------------------------------- actions
  async function pick(file) {
    if (!file) return;
    S.error = null;
    const problem = await LV.checkFile(file);
    if (problem) { S.error = problem; render(); return; }
    if (S.fileURL) URL.revokeObjectURL(S.fileURL);
    S.file = file; S.fileURL = URL.createObjectURL(file); S.name = LV.slugify(file.name || 'logo');
    S.options = { background: 'auto', colors: null, fillEnclosed: false };
    render();
  }

  async function trace() {
    S.stage = 'tracing'; S.error = null; S.progress = { step: 'decode', pct: 0 }; render();
    const t0 = performance.now();
    try {
      const r = await LV.vectorize(S.file, S.options, (step, pct) => { S.progress = { step: step === 'done' ? 'check' : step, pct }; updateProgress(); });
      r.seconds = ((performance.now() - t0) / 1000).toFixed(1);
      S.result = r; S.stage = 'review'; S.dirty = false;
      S.selected = new Set(r.variants.map(v => v.id));
      S.previewBg = r.background || r.variants.find(v => v.id === 'color-transparent').preview;
      opts.onResult?.(r);
      root.dispatchEvent(new CustomEvent('lv-result', { detail: r, bubbles: true }));
    } catch (e) {
      S.stage = S.result ? 'review' : 'upload';
      if (e.code !== 'cancelled') S.error = { code: e.code || 'failed', message: e.message };
    }
    render();
  }

  function setOption(patch) { Object.assign(S.options, patch); S.dirty = true; render(); }

  async function exportZip() {
    const variants = S.result.variants.filter(v => S.selected.has(v.id));
    const formats = FORMATS.filter(f => S.formats.has(f));
    if (!variants.length || !formats.length) return;
    S.building = 0; render();
    try {
      const files = await LV.buildFiles(S.result, { name: S.name, title: S.name, variants, formats, pngWidths: [...S.widths].sort((a, b) => a - b) }, p => { S.building = p; updateBuilding(); });
      LV.download(LV.zip(files), `${LV.slugify(S.name)}-logo.zip`);
    } catch (e) { S.notice = { kind: 'error', text: fmt(t().errors.failed, { message: e.message }) }; }
    S.building = null; render();
  }

  function useInHost() {
    const variants = S.result.variants.filter(v => S.selected.has(v.id));
    const payload = {
      name: S.name, background: S.result.background, colors: S.result.colors, fidelity: S.result.fidelity,
      variants: variants.map(v => ({ id: v.id, label: t().variants[v.id], svg: LV.buildSVG(S.result, v, { title: S.name }) })),
      result: S.result,
    };
    opts.onUse?.(payload);
    root.dispatchEvent(new CustomEvent('lv-use', { detail: payload, bubbles: true }));
  }

  function reset() {
    LV.cancel();
    if (S.fileURL) URL.revokeObjectURL(S.fileURL);
    Object.assign(S, { stage: 'upload', file: null, fileURL: null, result: null, error: null, dirty: false, notice: null });
    render();
  }

  // ---------------------------------------------------------------- views
  function steps() {
    const idx = S.stage === 'upload' ? 0 : S.stage === 'tracing' ? 1 : 2;
    return h('ol', { class: 'lv-steps' }, t().steps.map((s, i) => h('li', { 'data-state': i < idx ? 'done' : i === idx || (idx === 2 && i === 3) ? 'current' : 'todo', 'aria-current': i === idx ? 'step' : null }, s)));
  }

  function errorBox() {
    if (!S.error) return null;
    return h('p', { class: 'lv-notice', 'data-kind': 'error', role: 'alert' }, fmt(t().errors[S.error.code] || t().errors.failed, S.error));
  }

  function uploadView() {
    const input = h('input', { type: 'file', accept: LV.LIMITS.types.join(','), 'aria-label': t().dropTitle, onchange: e => pick(e.target.files[0]) });
    if (!S.file) {
      const drop = h('div', { class: 'lv-drop' },
        input,
        h('div', {}, h('strong', {}, t().dropTitle), h('p', { class: 'lv-muted' }, t().dropHint), h('p', { class: 'lv-muted lv-small' }, fmt(t().dropLimits, { mb: Math.round(LV.LIMITS.maxFileBytes / 1048576) }))));
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.dataset.over = ''; }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); delete drop.dataset.over; }));
      drop.addEventListener('drop', e => pick(e.dataTransfer.files[0]));
      return [drop, errorBox(), h('p', { class: 'lv-hint', style: { marginTop: '10px' } }, t().privacy)];
    }
    const replace = h('label', { class: 'lv-btn lv-btn-quiet', style: { position: 'relative' } }, t().replace,
      h('input', { type: 'file', accept: LV.LIMITS.types.join(','), style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }, onchange: e => pick(e.target.files[0]) }));
    return [
      h('div', { class: 'lv-picked' }, h('img', { src: S.fileURL, alt: '' }), h('div', {}, h('b', {}, S.file.name), h('span', { class: 'lv-muted lv-small' }, `${(S.file.size / 1024).toFixed(0)} KB`)), replace),
      h('label', { class: 'lv-check' }, h('input', { type: 'checkbox', checked: S.ack, onchange: e => { S.ack = e.target.checked; startBtn.disabled = !S.ack; } }), h('span', {}, t().ack)),
      errorBox(),
      h('div', { class: 'lv-row' }, (startBtn = h('button', { class: 'lv-btn lv-btn-primary', disabled: !S.ack, onclick: trace }, t().start))),
      h('p', { class: 'lv-hint', style: { marginTop: '10px' } }, t().privacy),
    ];
  }
  let startBtn;

  let barEl, labelEl;
  function tracingView() {
    barEl = h('i', {}); labelEl = h('p', { 'aria-live': 'polite' });
    const box = h('div', { class: 'lv-progress' }, labelEl, h('div', { class: 'lv-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, barEl),
      h('button', { class: 'lv-btn', onclick: () => LV.cancel() }, t().cancel));
    queueMicrotask(updateProgress);
    return [box];
  }
  function updateProgress() {
    if (!barEl) return;
    barEl.style.width = S.progress.pct + '%';
    barEl.parentElement.setAttribute('aria-valuenow', S.progress.pct);
    labelEl.textContent = t().progress[S.progress.step] || '';
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
    stage.append(orig, vec, diff, divider, h('span', { class: 'lv-stage-tag lv-tag-left' }, t().original), h('span', { class: 'lv-stage-tag lv-tag-right' }, t().vector));
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

  function panelView(r) {
    const o = S.options;
    const colors = o.colors || r.colors.filter((c, i) => !(r.options.fillEnclosed && i === 1 && c === r.background));
    const setColors = list => setOption({ colors: list.length ? list : null });
    const colorRows = colors.map((c, i) => h('div', { class: 'lv-color' },
      h('label', { style: { background: c }, title: fmt(t().editColor, { c }) }, h('input', { type: 'color', value: c.toLowerCase(), 'aria-label': fmt(t().editColor, { c }), onchange: e => { const n = [...colors]; n[i] = e.target.value.toUpperCase(); setColors(n); } })),
      h('code', {}, c),
      colors.length > 1 ? h('button', { class: 'lv-btn lv-btn-quiet', 'aria-label': fmt(t().removeColor, { c }), onclick: () => setColors(colors.filter((_, j) => j !== i)) }, '✕') : null));
    const addInput = h('input', { type: 'color', value: '#888888', style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }, 'aria-label': t().addColor, onchange: e => setColors([...colors, e.target.value.toUpperCase()]) });

    const bgMode = o.background === 'auto' ? 'auto' : o.background === 'transparent' ? 'transparent' : 'color';
    const seg = (mode, label, value) => h('button', { class: 'lv-chip', 'aria-pressed': String(bgMode === mode), onclick: () => setOption({ background: value }) }, label);
    const bgColorInput = h('input', { type: 'color', value: (bgMode === 'color' ? o.background : r.background || '#FFFFFF').toLowerCase(), 'aria-label': t().bgColor, style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }, onchange: e => setOption({ background: e.target.value.toUpperCase() }) });

    return h('aside', { class: 'lv-panel' },
      h('section', {},
        h('h3', {}, t().backgroundTitle),
        h('p', { class: 'lv-small lv-muted' }, r.background ? [`${t().detectedBg}: `, h('bdi', { dir: 'ltr' }, r.background)] : t().noBg),
        h('div', { class: 'lv-seg' }, seg('auto', t().bgAuto, 'auto'), seg('transparent', t().bgTransparent, 'transparent'),
          h('label', { class: 'lv-chip', 'aria-pressed': String(bgMode === 'color'), style: { position: 'relative' } }, bgMode === 'color' ? h('i', { class: 'lv-sw', style: { width: '14px', height: '14px', background: o.background } }) : null, t().bgColor, bgColorInput)),
        (r.background || (bgMode === 'color'))
          ? h('label', { class: 'lv-switch' }, h('input', { type: 'checkbox', checked: o.fillEnclosed, onchange: e => setOption({ fillEnclosed: e.target.checked }) }), t().fillEnclosed)
          : null,
        (r.background || bgMode === 'color') ? h('p', { class: 'lv-hint' }, t().fillEnclosedHint) : null),
      h('section', {},
        h('h3', {}, t().colorsTitle),
        h('div', { class: 'lv-colors' }, colorRows),
        h('label', { class: 'lv-btn', style: { position: 'relative', justifySelf: 'start' } }, '+ ' + t().addColor, addInput)),
      S.dirty ? h('p', { class: 'lv-notice', role: 'status' }, t().optionsChanged) : null,
      h('button', { class: 'lv-btn ' + (S.dirty ? 'lv-btn-primary' : ''), disabled: !S.dirty, onclick: trace }, t().retrace),
      r.warnings.length ? h('ul', { class: 'lv-warnings' }, r.warnings.map(w => h('li', {}, fmt(t().warn[w.code], w)))) : null,
      errorBox());
  }

  let buildLabel;
  function downloadView(r) {
    const cards = r.variants.map(v => h('div', { class: 'lv-card' },
      h('div', { class: 'lv-thumb', style: { background: v.bg || v.preview } }, svgNode(LV.previewSVG(r, v, t().variants[v.id]))),
      h('button', { class: 'lv-card-svg', 'aria-label': `${t().downloadSvg} — ${t().variants[v.id]}`, onclick: () => LV.download(LV.buildSVG(r, v, { title: S.name }), `${LV.slugify(S.name)}-${v.id}.svg`, 'image/svg+xml') }, '↓ ' + t().downloadSvg),
      h('footer', {},
        h('label', {}, h('input', { type: 'checkbox', checked: S.selected.has(v.id), onchange: e => { e.target.checked ? S.selected.add(v.id) : S.selected.delete(v.id); refreshDownloadState(); } }), h('span', {}, t().variants[v.id])))));
    const formatChips = FORMATS.map(f => h('label', { class: 'lv-chip', title: t().formatUse[f] }, h('input', { type: 'checkbox', checked: S.formats.has(f), onchange: e => { e.target.checked ? S.formats.add(f) : S.formats.delete(f); widthField.hidden = !S.formats.has('png'); refreshDownloadState(); } }), f.toUpperCase()));
    const widthField = h('div', { class: 'lv-field', hidden: !S.formats.has('png') }, h('span', {}, t().pngWidths),
      h('div', { class: 'lv-seg' }, WIDTHS.map(w => h('label', { class: 'lv-chip' }, h('input', { type: 'checkbox', checked: S.widths.has(w), onchange: e => { e.target.checked ? S.widths.add(w) : S.widths.delete(w); refreshDownloadState(); } }), `${w}px`))));
    buildLabel = h('span', { class: 'lv-small lv-muted', 'aria-live': 'polite' }, S.building != null ? fmt(t().building, { p: S.building }) : '');
    zipBtn = h('button', { class: 'lv-btn lv-btn-primary', onclick: exportZip }, t().downloadZip);
    hostBtn = opts.hostActionLabel ? h('button', { class: 'lv-btn', onclick: useInHost }, opts.hostActionLabel) : null;
    const view = h('section', { class: 'lv-download' },
      h('div', { class: 'lv-row lv-spread' }, h('h2', {}, t().variantsTitle)),
      h('div', { class: 'lv-grid' }, cards),
      h('div', { class: 'lv-opts' },
        h('div', { class: 'lv-field' }, h('span', {}, t().formatsTitle), h('div', { class: 'lv-seg' }, formatChips), h('ul', { class: 'lv-legend' }, FORMATS.map(f => h('li', {}, h('bdi', { dir: 'ltr' }, f.toUpperCase()), ' ', t().formatUse[f])))),
        widthField,
        h('label', { class: 'lv-field' }, h('span', {}, t().fileName), h('input', { class: 'lv-input', value: S.name, spellcheck: 'false', oninput: e => { S.name = e.target.value; } }))),
      S.notice ? h('p', { class: 'lv-notice', 'data-kind': S.notice.kind, role: 'alert' }, S.notice.text) : null,
      h('div', { class: 'lv-actions' }, zipBtn, hostBtn, buildLabel, h('span', { style: { flex: 1 } }), h('button', { class: 'lv-btn lv-btn-quiet', onclick: reset }, t().startOver)));
    queueMicrotask(refreshDownloadState);
    return view;
  }
  let zipBtn, hostBtn;
  function refreshDownloadState() {
    if (!zipBtn) return;
    const pngOk = !S.formats.has('png') || S.widths.size > 0;
    const ok = S.selected.size > 0 && S.formats.size > 0 && pngOk && S.building == null;
    zipBtn.disabled = !ok;
    if (hostBtn) hostBtn.disabled = !(S.selected.size > 0);
    buildLabel.textContent = S.building != null ? fmt(t().building, { p: S.building }) : (!ok && S.building == null ? t().noSelection : '');
  }
  function updateBuilding() { if (buildLabel) buildLabel.textContent = fmt(t().building, { p: S.building }); }

  function render() {
    if (root.getAttribute('dir') !== t().dir) root.setAttribute('dir', t().dir);
    if (root.getAttribute('lang') !== S.lang) root.setAttribute('lang', S.lang);
    zipBtn = hostBtn = barEl = null;
    const body = [];
    if (!supported()) body.push(h('p', { class: 'lv-notice', 'data-kind': 'error' }, t().errors.notSupported));
    else if (S.stage === 'upload') body.push(...uploadView());
    else if (S.stage === 'tracing') body.push(...tracingView());
    else body.push(h('div', { class: 'lv-review' }, stageView(S.result), panelView(S.result)), downloadView(S.result));
    root.replaceChildren(steps(), ...body.filter(Boolean));
  }

  const onPaste = e => {
    if (S.stage !== 'upload') return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { const f = item.getAsFile(); pick(new File([f], `pasted.${f.type.split('/')[1] || 'png'}`, { type: f.type })); }
  };
  document.addEventListener('paste', onPaste);
  render();

  return {
    setLang(l) { if (DICT[l] && l !== S.lang) { S.lang = l; render(); } },
    destroy() { document.removeEventListener('paste', onPaste); LV.cancel(); if (S.fileURL) URL.revokeObjectURL(S.fileURL); root.replaceChildren(); root.classList.remove('lv'); },
    strings: () => t(),
  };
}

function luminance(hex) {
  if (!hex || hex[0] !== '#') return 1;
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
