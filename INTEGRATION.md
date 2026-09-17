# INTEGRATION — دمج الأداة في مشاريع ثانية

الأداة كلها ملفات ES modules بدون خطوة بناء، داخل مجلد واحد: `site/lib/`.
فيه ثلاث طرق للاستخدام، من الأسهل للأعمق:

| الطريقة | متى | الملف |
| --- | --- | --- |
| عنصر `<logo-vectorizer>` | صفحة HTML عادية (مثل صفحة دمج الخطوط) | `lib/logo-vectorizer.js` |
| `mount(root, options)` | تطبيق React/Vue يبي يتحكم باللغة ويستقبل النتيجة | `lib/ui.js` |
| الدوال مباشرة | واجهة خاصة بالكامل | `lib/vectorizer.js` |

الأنواع لـ TypeScript جاهزة بجانب كل ملف: `ui.d.ts`، `vectorizer.d.ts`، `session.d.ts`.

### من npm (جاهز، ما انتشر بعد)

`package.json` في جذر المستودع يعرّف حزمة باسم `logo-vectorizer` تحتوي `site/lib/` فقط. تم اختبارها كحزمة مثبّتة داخل مشروع Vite 8.3 + React 19.3 + TypeScript 6.0.3: نجح `tsc --noEmit` و`vite build` وخادم التطوير، واشتغل تتبع عدة شعارات وتصدير PDF وزر المضيف.

| المسار | المحتوى |
| --- | --- |
| `logo-vectorizer` | الدوال (`vectorize`, `buildFiles`, …) |
| `logo-vectorizer/ui` | `mount` |
| `logo-vectorizer/element` | عنصر `<logo-vectorizer>` |
| `logo-vectorizer/session` | حفظ آخر مجموعة واسترجاعها |
| `logo-vectorizer/style.css` | التنسيق |

مع Vite لازم تستثني الحزمة من التجميع المسبق، وإلا ما يلقى خادم التطوير ملف الـ worker:

```ts
// vite.config.ts
export default defineConfig({ plugins: [react()], optimizeDeps: { exclude: ['logo-vectorizer'] } });
```

## القواعد الثابتة

- **انسخ `site/lib/` كاملًا بدون تعديل** (أو ثبّت الحزمة بعد نشرها). التحديث = إعادة نسخ المجلد من المستودع. أي تعديل داخله يضيع مع أول تحديث.
- **الـ Worker لازم يكون من نفس الـ origin.** المتصفح يمنع تشغيل worker من دومين ثاني. لهذا ما ينفع تستورد الأداة من CDN خارجي.
- **ما تحتاج `file://`.** لازم خادم (حتى `python3 -m http.server`).
- **الترخيص GPL** بسبب potrace. الاستخدام الداخلي والاستضافة بدون قيود. لو تحوّل المشروع المضيف لمنتج يتوزّع، لازم يكون متوافق مع GPL.

## الأحداث والبيانات

| الحدث | متى | `detail` |
| --- | --- | --- |
| `lv-result` | بعد كل تتبع ناجح، **مرة لكل شعار** لما يرفع المستخدم عدة شعارات | نتيجة كاملة `TraceResult` |
| `lv-use` | لما يضغط المستخدم زر المضيف (يظهر فقط لو حددت `host-action-label`) | الشعار المعروض حاليًا فقط: `{ name, colors, background, fidelity, variants: [{ id, label, svg }] }` |

الأحداث تنطلق من عنصر الأداة وتصعد (`bubbles`).

## الخيارات

| الخيار | في `mount()` | في العنصر | الافتراضي | الأثر |
| --- | --- | --- | --- | --- |
| اللغة | `lang` | `lang` | `ar` | `ar` أو `en`، وتتبدل مباشرة |
| زر المضيف | `hostActionLabel` | `host-action-label` | بدون | يظهر زر يطلق `lv-use` |
| الاستكمال | `persist: true` | `persist` | مطفأ | يحفظ آخر مجموعة شعارات (الملفات الأصلية + الإعدادات المطبّقة) في IndexedDB على نفس الجهاز لمدة 24 ساعة، ويعرض «كمّل من حيث وقفت» بعد التحديث. «شعار جديد» يمسحها. المجموعات فوق 64 م.ب ما تنحفظ. |

- **عدد الشعارات بالمرة:** حتى 20 (`MAX_BATCH` من `ui.js`). كل شعار له إعداداته، وزر «حمّل كل الشعارات» يطلع ZIP فيه مجلد لكل شعار.
- **الاستكمال مطفأ في العنصر افتراضيًا** لأن المضيف غالبًا عنده تخزينه الخاص. الصفحة المستقلة (`site/app.js`) تفعّله.
- **شكل الزوايا:** خيار `corners` في `vectorize()` بقيم `sharp` و`balanced` (الافتراضي) و`smooth`، ويظهر في لوحة الإعدادات للمستخدم.

## التنسيق

كل التنسيق تحت `.lv` ومبني على متغيرات `--lv-*`. غيّر المتغيرات فقط، ولا تكتب CSS يستهدف كلاسات الأداة الداخلية.

```css
logo-vectorizer, .brand-kit .lv {
  --lv-font: "IBM Plex Sans Arabic", system-ui, sans-serif;
  --lv-paper: …; --lv-surface: …; --lv-ink: …; --lv-line: …;
  --lv-radius: 12px;
}
```

الوضع الداكن يشتغل تلقائيًا مع `prefers-color-scheme`، أو بـ `data-theme="dark"` على `<html>` أو على عنصر الأداة نفسه.

---

## 1) صفحة دمج الخطوط العربية — `mulhamx4.github.io/arabic-font-merge/`

الصفحتين على نفس الـ origin (`mulhamx4.github.io`)، فتقدر تستورد الأداة مباشرة من مسار نشرها **بدون نسخ أي ملف**:

```html
<details id="lv-section">
  <summary>حوّل شعار لفيكتور</summary>
  <logo-vectorizer lang="ar"></logo-vectorizer>
</details>
<script type="module">
  // تحميل كسول: ما ينزل أي كود إلا لما يفتح المستخدم القسم
  const s = document.getElementById('lv-section');
  s.addEventListener('toggle', () => { if (s.open) import('/logo-vectorize/lib/logo-vectorizer.js'); }, { once: true });
</script>
```

- لتبديل اللغة مع الصفحة: `document.querySelector('logo-vectorizer').setAttribute('lang', 'en')`.
- مثال كامل مجرّب: `examples/font-page/index.html`.
- لو انتقلت صفحة الخطوط لدومين خاص، انسخ `site/lib/` داخلها واستورد من المسار المحلي.

## 2) Brand Kit Builder — React 19 + Vite + TypeScript

**1. انسخ المجلد** إلى:

```
src/features/logo-vectorize/lib/   ← نسخة من site/lib/ كما هي
```

Vite يتعامل مع كل شي تلقائيًا: الـ worker، ملفات jsPDF/svg2pdf كـ assets، وملف CSS. ما تحتاج أي إعداد إضافي في `vite.config`. (تحذير Vite عن `module` داخل `vendor/potrace.js` متوقع وما يأثر.)

**2. استخدم المكوّن** `examples/react/LogoVectorizePanel.tsx` (مبني ومجرّب على Vite 8.3 + React 19.3 + TypeScript 6.0.3):

```tsx
<LogoVectorizePanel
  lang={lang}
  onAddLogos={(files, { colors, background }) => importLogoFiles(files)}
/>
```

`files` هي ملفات SVG من نوع `File`، وحدة لكل نسخة اختارها المستخدم.

**3. مرّرها لنفس مسار الاستيراد اللي يستخدمه DropZone.** لا تكتبها في IndexedDB مباشرة: مسار الاستيراد هو اللي يتحقق من الملف وينظّف الـ SVG، والملفات هنا لازم تمر بنفس التحقق مثل أي شعار مرفوع. `importLogoFiles` في المثال فوق تعني دالة الاستيراد الموجودة في Brand Kit، بأي اسم كانت.

**4. الألوان** (`colors` و`background`) تقدر تعرضها كاقتراح لقسم الألوان في الهوية، لكن لا تضيفها تلقائيًا: هي مستخرجة من صورة، وألوان الهوية الرسمية يحددها المصمم.

**5. نقاط للمراجعة داخل Brand Kit**

- لا تفعّل `persist` داخل Brand Kit إلا لو قررت إن الشعارات الأصلية تنحفظ في المتصفح؛ Brand Kit عنده مسار تخزينه الخاص.
- مع الحزمة من npm استورد `logo-vectorizer/ui` و`logo-vectorizer/style.css` بدل المسارات المحلية، وأضف `optimizeDeps.exclude`.

- واجهة الأداة ثنائية اللغة وتتبع `lang`. مرّر لغة التطبيق وحدّثها مع كل تبديل (المكوّن يسويها).
- اربط `--lv-*` بتوكنز `docs/05-DESIGN-SYSTEM.md`.
- الأداة تستمع لحدث `paste` على `document` بس وهي في مرحلة الرفع. لو عند Brand Kit لصق عام، اعرض الأداة داخل لوحة أو نافذة مستقلة.

---

## 3) استخدام الدوال مباشرة

```js
import { checkFile, vectorize, buildFiles, zip, download } from './lib/vectorizer.js';

const problem = await checkFile(file);            // null أو { code }
if (problem) throw problem;
const result = await vectorize(file, { background: 'auto', corners: 'balanced' }, (step, pct) => {});
const files = await buildFiles(result, { name: 'brand', formats: ['svg', 'pdf'] });
download(zip(files), 'brand-logo.zip');
```

لو المضيف يحمّل jsPDF وsvg2pdf.js من npm أصلًا، يقدر يمرّرهم بدل النسخ المضمّنة:

```js
import { setPdfLoader } from './lib/vectorizer.js';
setPdfLoader(async () => { const { jsPDF } = await import('jspdf'); await import('svg2pdf.js'); return { jsPDF }; });
```
