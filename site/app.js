// Standalone page: header controls (language, theme) around the shared UI.
import { mount } from './lib/ui.js';

const html = document.documentElement;
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const qs = new URLSearchParams(location.search).get('lang');
let lang = ['ar', 'en'].includes(qs) ? qs : store.get('lv-lang') || 'ar';
const theme = store.get('lv-theme'); if (theme) html.dataset.theme = theme;

const app = mount(document.getElementById('tool'), { lang });
const $ = id => document.getElementById(id);

function paintChrome() {
  const t = app.strings();
  html.lang = lang; html.dir = t.dir;
  document.title = t.appName;
  $('title').textContent = t.appName;
  $('tagline').textContent = t.tagline;
  $('lang').textContent = t.langSwitch;
  $('footer-text').textContent = t.footer;
  $('source').textContent = t.source;
  $('other').textContent = t.otherTools + ':';
  $('font-tool').textContent = t.fontTool;
  const dark = html.dataset.theme ? html.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('theme').textContent = dark ? t.themeLight : t.themeDark;
  $('theme').setAttribute('aria-label', `${t.themeLabel}: ${dark ? t.themeDark : t.themeLight}`);
}
$('lang').onclick = () => { lang = lang === 'ar' ? 'en' : 'ar'; store.set('lv-lang', lang); app.setLang(lang); paintChrome(); };
$('theme').onclick = () => {
  const dark = html.dataset.theme ? html.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  html.dataset.theme = dark ? 'light' : 'dark'; store.set('lv-theme', html.dataset.theme); paintChrome();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintChrome);
paintChrome();
