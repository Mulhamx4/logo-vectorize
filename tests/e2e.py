"""End-to-end check of the web tool in a real browser engine.

    pip install playwright && python -m playwright install chromium   # or firefox / webkit
    python tests/e2e.py [chromium|firefox|webkit]

Uses only synthetic logos: the files in tests/ plus flat shapes generated at run time.
Exits non-zero on any failure.
"""
import functools, http.server, json, os, socketserver, struct, sys, tempfile, threading, zipfile, zlib
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE, TESTS = os.path.join(ROOT, 'site'), os.path.join(ROOT, 'tests')
AXE = os.path.join(TESTS, 'vendor', 'axe.min.js')
BROWSER = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get('BROWSER', 'chromium')).lower()
TMP = tempfile.mkdtemp()
TRACE_TIMEOUT = 240000


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'

failures, errors = [], []
def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
    if not ok: failures.append(name)

def listen(page, tag):
    page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
    page.on('console', lambda m: errors.append(f'{tag}: {m.text}') if m.type == 'error' and 'fonts.g' not in (m.location or {}).get('url', '') and '403' not in m.text else None)


def make_png(name, w, h, rects):
    """Flat RGBA PNG: a transparent canvas with (x0, y0, x1, y1, rgba) rectangles painted in order."""
    rows = []
    for y in range(h):
        row = bytearray(w * 4)
        for x0, y0, x1, y1, c in rects:
            if y0 <= y < y1: row[x0 * 4:x1 * 4] = bytes(c) * (x1 - x0)
        rows.append(b'\0' + bytes(row))
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    path = os.path.join(TMP, name)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(b''.join(rows), 6)) + chunk(b'IEND', b''))
    return path

NAVY, RED, WHITE, BLUE = (20, 24, 33, 255), (214, 40, 57, 255), (255, 255, 255, 255), (30, 110, 220, 255)
TALL = make_png('tall.png', 300, 1400, [(60, 80, 240, 1320, NAVY), (100, 200, 200, 600, RED)])
WIDE = make_png('wide.png', 2600, 360, [(80, 60, 2520, 300, NAVY), (300, 140, 2300, 220, WHITE)])
BIG = make_png('big.png', 4200, 2400, [(1500, 500, 2700, 1900, BLUE), (1900, 900, 2300, 1500, WHITE)])
EMPTY = make_png('empty.png', 200, 200, [])


def pick(page, files):
    page.set_input_files('.lv-drop input', [f if os.path.isabs(f) else os.path.join(TESTS, f) for f in files])

def trace(page, *files, label=None):
    """Pick files on a freshly loaded page, acknowledge, start, and wait for the review step."""
    pick(page, files)
    page.wait_for_selector('.lv-picked')
    check(f'{label or files[0]}: start disabled until acknowledged', page.is_disabled('.lv-start'))
    page.check('.lv-check input')
    page.click('.lv-start')
    page.wait_for_selector('.lv-stage, .lv-failed', timeout=TRACE_TIMEOUT)

def retrace(page):
    page.click('.lv-retrace')
    page.wait_for_selector('.lv-retrace[disabled]', timeout=TRACE_TIMEOUT)

STAGE_GEOMETRY = """() => {
  const stage = document.querySelector('.lv-stage');
  const canvas = stage.querySelector('.lv-orig canvas'), svg = stage.querySelector('.lv-vec:not(.lv-diff) svg');
  const layer = canvas.parentElement.getBoundingClientRect(), cb = canvas.getBoundingClientRect(), xb = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal, s = Math.min(xb.width / vb.width, xb.height / vb.height);
  const drawn = { left: xb.left + (xb.width - vb.width * s) / 2, top: xb.top + (xb.height - vb.height * s) / 2, width: vb.width * s, height: vb.height * s };
  const inside = b => b.left >= layer.left - 1 && b.top >= layer.top - 1 && b.left + b.width <= layer.right + 1 && b.top + b.height <= layer.bottom + 1;
  const ratio = canvas.width / canvas.height;
  return {
    inside: inside(cb) && inside(xb),
    ratioErr: Math.abs(cb.width / cb.height - ratio) / ratio,
    fills: Math.max(cb.width / layer.width, cb.height / layer.height),
    misalign: Math.max(Math.abs(cb.left - drawn.left), Math.abs(cb.top - drawn.top), Math.abs(cb.width - drawn.width), Math.abs(cb.height - drawn.height)),
    size: [Math.round(cb.width), Math.round(cb.height)], source: [canvas.width, canvas.height],
  };
}"""

def stage_fits(page, label):
    """The original (canvas) and the vector (svg) are contained in the same box and overlay exactly."""
    g = page.evaluate(STAGE_GEOMETRY)
    ok = g['inside'] and g['ratioErr'] < 0.02 and g['fills'] > 0.98 and g['misalign'] < 2
    check(f'{label}: original and vector fit the compare stage and line up', ok, json.dumps(g))

def axe(page, label):
    page.add_script_tag(path=AXE)
    found = page.evaluate("""async () => {
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
    }""")
    check(f'a11y {label}: no WCAG 2.2 A/AA violations', not found, json.dumps(found, ensure_ascii=False)[:900])

SAVED_CORNERS = """async () => new Promise(res => {
  const req = indexedDB.open('logo-vectorize');
  req.onerror = () => res(null);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('session')) { db.close(); return res(null); }
    const get = db.transaction('session').objectStore('session').get('last');
    get.onsuccess = () => { db.close(); res(get.result ? get.result.items.map(i => i.options.corners) : null); };
    get.onerror = () => { db.close(); res(null); };
  };
})"""

def wait_saved(page, expect):
    for _ in range(50):
        if page.evaluate(SAVED_CORNERS) == expect: return True
        page.wait_for_timeout(100)
    return False

LINE_SEGMENTS = "() => [...document.querySelectorAll('.lv-vec:not(.lv-diff) svg path')].reduce((n, p) => n + (p.getAttribute('d').match(/l/gi) || []).length, 0)"


print(f'browser: {BROWSER}', flush=True)
with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)

    # ---------------------------------------------------------------- single logo, export
    page = ctx.new_page(); listen(page, 'page')
    page.goto(BASE + '/index.html?lang=en')
    axe(page, 'upload (en)')
    trace(page, 'peak-transparent.png')
    colors = page.locator('.lv-color code').all_inner_texts()
    check('peak: three colors detected', sorted(colors) == ['#141821', '#D62839', '#FFFFFF'], str(colors))
    score = float(page.inner_text('.lv-score b').rstrip('%'))
    check('peak: fidelity >= 99', score >= 99, str(score))
    check('peak: detail-erasing recolor variants skipped', page.locator('.lv-card').count() == 3)
    stage_fits(page, 'peak')
    axe(page, 'review (en)')
    with page.expect_download() as dl:
        page.click('.lv-zip')
    names = zipfile.ZipFile(dl.value.path()).namelist()
    check('peak: zip has svg/pdf/eps/png for 3 variants', len(names) == 15 and any(n.endswith('.eps') for n in names), str(len(names)))

    # ---------------------------------------------------------------- corner styles
    balanced = page.evaluate(LINE_SEGMENTS)
    page.click('.lv-corners [data-corners="sharp"]')
    check('corners: changing the style marks retrace', page.is_enabled('.lv-retrace'))
    retrace(page); sharp = page.evaluate(LINE_SEGMENTS)
    page.click('.lv-corners [data-corners="smooth"]'); retrace(page); smooth = page.evaluate(LINE_SEGMENTS)
    check('corners: sharp keeps more corners, rounded fewer', sharp > balanced > smooth, f'sharp={sharp} balanced={balanced} rounded={smooth}')
    check('corners: rounded still matches the original', float(page.inner_text('.lv-score b').rstrip('%')) >= 99)

    # ---------------------------------------------------------------- resume after reload (standalone page persists)
    check('resume: session saved with the applied settings', wait_saved(page, ['smooth']))
    page.reload(); page.wait_for_selector('.lv-resume')
    check('resume: offer shown after reload', 'peak-transparent' in page.inner_text('.lv-resume'))
    axe(page, 'resume offer (en)')
    page.click('.lv-resume .lv-btn-primary'); page.wait_for_selector('.lv-stage', timeout=TRACE_TIMEOUT)
    check('resume: logo restored with its corner style', page.get_attribute('.lv-corners [data-corners="smooth"]', 'aria-pressed') == 'true')
    page.click('.lv-reset')
    check('resume: "New logo" clears the saved session', wait_saved(page, None))
    page.reload(); page.wait_for_selector('.lv-drop'); page.wait_for_timeout(400)
    check('resume: nothing offered after "New logo"', page.locator('.lv-resume').count() == 0)

    # ---------------------------------------------------------------- arabic, options
    page.goto(BASE + '/index.html?lang=ar')
    check('arabic page is rtl', page.evaluate('document.documentElement.dir') == 'rtl')
    trace(page, 'bloom.jpg')
    check('bloom: background detected white', '#FFFFFF' in page.inner_text('.lv-panel'))
    stage_fits(page, 'bloom')
    axe(page, 'review (ar)')
    page.click('.lv-panel .lv-switch input')
    check('bloom: option change marks retrace', page.is_enabled('.lv-retrace'))
    retrace(page)
    check('bloom: fill enclosed keeps 4 variants', page.locator('.lv-card').count() == 4)

    # ---------------------------------------------------------------- compare stage geometry (P0-1 regression)
    for label, f in [('tall 1:6', TALL), ('wide 7:1', WIDE), ('large 4200px', BIG)]:
        page.goto(BASE + '/index.html?lang=en')
        trace(page, f, label=label)
        stage_fits(page, label)

    # ---------------------------------------------------------------- refusals
    page.goto(BASE + '/index.html?lang=en')
    svg = os.path.join(TMP, 'already.svg'); open(svg, 'w').write('<svg xmlns="http://www.w3.org/2000/svg"/>')
    pick(page, [svg]); page.wait_for_selector('.lv-notice')
    check('vector input is refused with a reason', 'already vector' in page.inner_text('.lv-notice'))

    # ---------------------------------------------------------------- batch
    page.goto(BASE + '/index.html?lang=en')
    pick(page, ['peak-transparent.png', svg]); page.wait_for_selector('.lv-picked')
    check('batch: a refused file is named and the rest are kept', page.locator('.lv-picked').count() == 1 and 'already.svg' in page.inner_text('.lv-notice'))
    page.set_input_files('.lv-add input', [os.path.join(TESTS, 'bloom.jpg'), EMPTY]); page.wait_for_function("document.querySelectorAll('.lv-picked').length === 3")
    check('batch: start button counts the logos', '3' in page.inner_text('.lv-start'))
    page.check('.lv-check input'); page.click('.lv-start')
    page.wait_for_selector('.lv-strip', timeout=TRACE_TIMEOUT)
    states = page.eval_on_selector_all('.lv-strip-item', 'els => els.map(e => e.dataset.state)')
    check('batch: every logo traced, the unusable one marked failed', states == ['ok', 'ok', 'failed'], str(states))
    axe(page, 'batch review (en)')
    page.click('.lv-strip-item >> nth=1')
    check('batch: switching logos shows that logo', page.get_attribute('.lv-strip-item >> nth=1', 'aria-current') == 'true' and '#FFFFFF' in page.inner_text('.lv-panel'))
    stage_fits(page, 'batch bloom')
    page.click('.lv-strip-item >> nth=2'); page.wait_for_selector('.lv-failed')
    check('batch: failed logo explains why', page.locator('.lv-failed [role="alert"]').count() == 1)
    page.click('.lv-failed .lv-btn-quiet')
    check('batch: removing the failed logo keeps the others', page.locator('.lv-strip-item').count() == 2)
    with page.expect_download() as dl:
        page.click('.lv-all')
    names = zipfile.ZipFile(dl.value.path()).namelist()
    folders = sorted({n.split('/')[0] for n in names})
    check('batch: one zip with a folder per logo', folders == ['bloom', 'peak-transparent'] and all(n.count('/') == 2 for n in names), str(folders))

    # ---------------------------------------------------------------- mobile, dark, embed
    mobile_opts = {'viewport': {'width': 390, 'height': 844}, 'has_touch': True}
    if BROWSER != 'firefox': mobile_opts['is_mobile'] = True     # Firefox has no mobile emulation
    mobile = browser.new_context(**mobile_opts).new_page(); listen(mobile, 'mobile')
    mobile.goto(BASE + '/index.html?lang=ar'); trace(mobile, 'bloom.jpg')
    check('mobile: no horizontal overflow', not mobile.evaluate('document.documentElement.scrollWidth > innerWidth'))
    stage_fits(mobile, 'mobile bloom')

    dark = browser.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark').new_page(); listen(dark, 'dark')
    dark.goto(BASE + '/index.html?lang=en'); trace(dark, 'peak-transparent.png')
    axe(dark, 'review (dark)')

    embed = ctx.new_page(); listen(embed, 'embed')
    embed.goto(BASE + '/embed.html'); trace(embed, 'peak-transparent.png')
    embed.click('text=Add to brand kit'); embed.wait_for_function('document.title.startsWith("received")')
    check('embed: host receives variants via lv-use', embed.title() == 'received:3', embed.title())
    embed.reload(); embed.wait_for_selector('.lv-drop'); embed.wait_for_timeout(400)
    check('embed: no resume offer unless the host opts in', embed.locator('.lv-resume').count() == 0)

    browser.close()

check('no page errors', not errors, '; '.join(errors[:3]))
print(f'{len(failures)} failed' if failures else 'all passed', flush=True)
sys.exit(1 if failures else 0)
