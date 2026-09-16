// <logo-vectorizer lang="ar" host-action-label="أضف إلى الهوية"></logo-vectorizer>
// Events: `lv-result` (detail: trace result), `lv-use` (detail: { name, colors, background, variants:[{id,label,svg}] }).
import { mount } from './ui.js';

const CSS_URL = new URL('./logo-vectorizer.css', import.meta.url).href;
function ensureStyles() {
  if (document.querySelector(`link[data-lv-css]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS_URL; l.dataset.lvCss = ''; document.head.append(l);
}

class LogoVectorizer extends HTMLElement {
  static observedAttributes = ['lang'];
  connectedCallback() {
    ensureStyles();
    if (this._app) return;
    this._app = mount(this, { lang: this.getAttribute('lang') || document.documentElement.lang || 'ar', hostActionLabel: this.getAttribute('host-action-label') || undefined });
  }
  disconnectedCallback() { this._app?.destroy(); this._app = null; }
  attributeChangedCallback(name, _, value) { if (name === 'lang') this._app?.setLang(value); }
}
if (!customElements.get('logo-vectorizer')) customElements.define('logo-vectorizer', LogoVectorizer);
export { LogoVectorizer };
