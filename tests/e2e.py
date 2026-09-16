"""End-to-end check of the web tool in headless Chromium.

    pip install playwright && python -m playwright install chromium
    python tests/e2e.py

Uses only the synthetic logos in tests/. Exits non-zero on any failure.
"""
import functools, http.server, os, socketserver, sys, tempfile, threading, zipfile
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE, TESTS = os.path.join(ROOT, 'site'), os.path.join(ROOT, 'tests')


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'

failures, errors = [], []
def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))
    if not ok: failures.append(name)

def listen(page, tag):
    page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
    page.on('console', lambda m: errors.append(f'{tag}: {m.text}') if m.type == 'error' and 'fonts.g' not in (m.location or {}).get('url', '') and '403' not in m.text else None)

def trace(page, file):
    page.set_input_files('.lv-drop input', os.path.join(TESTS, file))
    page.wait_for_selector('.lv-picked')
    check(f'{file}: start disabled until acknowledged', page.is_disabled('.lv-picked ~ .lv-row .lv-btn-primary'))
    page.check('.lv-check input')
    page.click('.lv-picked ~ .lv-row .lv-btn-primary')
    page.wait_for_selector('.lv-stage', timeout=180000)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)

    page = ctx.new_page(); listen(page, 'page')
    page.goto(BASE + '/index.html?lang=en')
    trace(page, 'peak-transparent.png')
    colors = page.locator('.lv-color code').all_inner_texts()
    check('peak: three colors detected', sorted(colors) == ['#141821', '#D62839', '#FFFFFF'], str(colors))
    score = float(page.inner_text('.lv-score b').rstrip('%'))
    check('peak: fidelity >= 99', score >= 99, str(score))
    check('peak: detail-erasing recolor variants skipped', page.locator('.lv-card').count() == 3)
    with page.expect_download() as dl:
        page.click('.lv-download .lv-btn-primary')
    names = zipfile.ZipFile(dl.value.path()).namelist()
    check('peak: zip has svg/pdf/eps/png for 3 variants', len(names) == 15 and any(n.endswith('.eps') for n in names), str(len(names)))

    page.goto(BASE + '/index.html?lang=ar')
    check('arabic page is rtl', page.evaluate('document.documentElement.dir') == 'rtl')
    trace(page, 'bloom.jpg')
    check('bloom: background detected white', '#FFFFFF' in page.inner_text('.lv-panel'))
    page.click('.lv-panel .lv-switch input')
    check('bloom: option change marks retrace', page.is_enabled('.lv-panel > .lv-btn-primary'))
    page.click('.lv-panel > .lv-btn-primary'); page.wait_for_selector('.lv-stage', timeout=180000)
    check('bloom: fill enclosed keeps 4 variants', page.locator('.lv-card').count() == 4)

    page.goto(BASE + '/index.html?lang=en')
    svg = os.path.join(tempfile.mkdtemp(), 'already.svg'); open(svg, 'w').write('<svg xmlns="http://www.w3.org/2000/svg"/>')
    page.set_input_files('.lv-drop input', svg); page.wait_for_selector('.lv-notice')
    check('vector input is refused with a reason', 'already vector' in page.inner_text('.lv-notice'))

    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True).new_page(); listen(mobile, 'mobile')
    mobile.goto(BASE + '/index.html?lang=ar'); trace(mobile, 'bloom.jpg')
    check('mobile: no horizontal overflow', not mobile.evaluate('document.documentElement.scrollWidth > innerWidth'))

    embed = ctx.new_page(); listen(embed, 'embed')
    embed.goto(BASE + '/embed.html'); trace(embed, 'peak-transparent.png')
    embed.click('text=Add to brand kit'); embed.wait_for_function('document.title.startsWith("received")')
    check('embed: host receives variants via lv-use', embed.title() == 'received:3', embed.title())

    browser.close()

check('no page errors', not errors, '; '.join(errors[:3]))
sys.exit(1 if failures else 0)
