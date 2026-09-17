# logo-vectorize

English · **[العربية ↓](#logo-vectorize-عربي)**

[![test and deploy](https://github.com/Mulhamx4/logo-vectorize/actions/workflows/pages.yml/badge.svg)](https://github.com/Mulhamx4/logo-vectorize/actions/workflows/pages.yml)
[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/logo-vectorizer.svg)](https://www.npmjs.com/package/logo-vectorizer)

Turn a flat-color raster logo (PNG, JPG, WebP) into clean layered vectors and a ready-to-send logo pack: **SVG, PDF, EPS and PNG** in every useful color variant.

It ships in two forms:

- **A web tool** — `site/`, deployed to <https://mulhamx4.github.io/logo-vectorize/>. Runs entirely in the browser; the logo never leaves the device.
- **A Claude skill** — `SKILL.md` + `scripts/`, the Python original the web tool is ported from.

## Features

- **One logo or up to 20 at once.** Each keeps its own settings; a strip switches between them, and one ZIP holds a folder per logo.
- **Review before you download:** a before/after divider, a red difference overlay, and the match with the original as a percentage.
- **Adjust and trace again:** colors, background, filling enclosed areas, and corner style (sharp, balanced, rounded).
- **Resume after a refresh.** The last batch stays in this browser for 24 hours; “New logo” clears it. Nothing is uploaded.
- Arabic and English, light and dark, phone-width layout.

## What you get

| Variant | When it is created |
| --- | --- |
| Color on background | the source had a solid background |
| Color — transparent | always |
| For light backgrounds | light parts are recolored for white-on-dark logos |
| For dark backgrounds | dark parts turn white |
| Black / White — one color | always; parts close to the background are knocked out so inner detail survives |

A recolored variant is skipped when it would merge two layers into one color and erase detail (a dark icon inside a white disc, for example).

## How it works

1. **Background** — transparency, or the median color of the image border.
2. **Palette** — k-means on *flat* pixels only, so anti-aliased edges don't invent in-between colors; a second pass finds rare accents such as thin gold rules.
3. **Upscale** — so potrace has room for smooth curves.
4. **Blend-aware classification** — each pixel is one palette color or a blend of two, assigned to the nearer side. This stops navy/white edges from being read as "gold".
5. **Stacked layers** — layer *n* is its color plus every color above it, so there are never hairline gaps between colors.
6. **Trace** each layer with potrace, then render the result back and measure how closely it matches the original.

The web tool shows that match as a percentage, with a before/after divider and a red difference overlay, and lets you edit colors, background, enclosed-area filling and corner style before tracing again. Corner style sets potrace's `alphamax` and `opttolerance`: *sharp* keeps geometric corners crisp, *rounded* smooths round or hand-drawn marks.

## Browser limits

| | Desktop | Phone |
| --- | --- | --- |
| Working resolution | up to 24 MP | up to 12 MP (iOS Safari caps canvases near 16.7 MP) |
| File size | 25 MB | 25 MB |
| Typical time | 1–4 s per logo | 3–10 s per logo |
| Logos per batch | 20 | 20 |

Vector inputs (SVG, PDF, AI, EPS) are refused with a reason: tracing a vector only lowers its quality.

Every change is tested in Chromium, Firefox and WebKit (Playwright, on Linux). Real iPhone, Android and desktop Firefox have not been checked yet.

## Use the web tool elsewhere

The tool is a set of plain ES modules with no build step. Embed it as an element, mount the UI, or call the core directly — see **[INTEGRATION.md](INTEGRATION.md)** for Brand Kit Builder (React + Vite) and the Arabic font merge page. It is also on npm as [`logo-vectorizer`](https://www.npmjs.com/package/logo-vectorizer): `npm install logo-vectorizer` (with Vite, add the `optimizeDeps.exclude` line from INTEGRATION.md).

```html
<script type="module" src="/logo-vectorize/lib/logo-vectorizer.js"></script>
<logo-vectorizer lang="ar" host-action-label="أضف إلى الهوية"></logo-vectorizer>
```

## Use the skill

```bash
bash scripts/setup.sh
python3 scripts/vectorize_logo.py logo.png --out build/out --name brand --display-name "Brand" --lang en
```

For Claude, zip the repository contents (without `site/` and `tests/`) and upload it as a skill.

## Develop

```bash
cd site && python3 -m http.server 8000   # any static server; module workers need http, not file://
pip install playwright && python -m playwright install chromium firefox webkit
python tests/e2e.py chromium             # or firefox / webkit
```

The suite traces synthetic logos only. It checks colors, variants and exports; batch and resume; corner styles; that the original and the vector line up in the compare stage (tall, wide, large and phone-width sources); and WCAG 2.2 A/AA with axe-core.

`worker.js` is a port of `scripts/vectorize_logo.py`. Change both together.

## Dependencies (vendored in `site/lib/vendor/`)

| Package | Version | Role | License |
| --- | --- | --- | --- |
| esm-potrace-wasm | 0.5.1 | potrace compiled to WebAssembly | GPL-2.0 |
| jsPDF | 4.2.1 | PDF document | MIT |
| svg2pdf.js | 2.8.1 | SVG → vector PDF | MIT |
| fflate | 0.8.3 | ZIP | MIT |
| axe-core (tests only, `tests/vendor/`) | 4.13.0 | accessibility checks | MPL-2.0 |

## License

GPL-2.0-or-later, because the tracer is [Potrace](https://potrace.sourceforge.net/), which is GPL. You may use, modify and host the tool freely; if you distribute a modified version, its source must be available under the same license.

**This does not license any logo.** Only process logos you own or are permitted to use.

---

<div dir="rtl" id="logo-vectorize-عربي">

# logo-vectorize (عربي)

**[English ↑](#logo-vectorize)** · العربية

أداة تحوّل الشعار النقطي بألوان مسطحة (PNG أو JPG أو WebP) إلى فيكتور نظيف بطبقات، وتطلع باقة شعار جاهزة: **SVG وPDF وEPS وPNG** بكل النسخ اللونية المفيدة.

المستودع فيه نسختين:

- **أداة ويب** في مجلد `site/`، ومنشورة على <https://mulhamx4.github.io/logo-vectorize/>. كل المعالجة داخل المتصفح، والشعار ما يطلع من جهاز المستخدم.
- **مهارة Claude** في `SKILL.md` و`scripts/`، وهي النسخة الأصلية بـ Python اللي انبنت منها أداة الويب.

## المزايا

- **شعار واحد أو حتى 20 شعار بالمرة.** كل شعار له إعداداته، وتتنقل بينها من شريط أعلى المراجعة، وتحمّلها كلها في ZIP واحد فيه مجلد لكل شعار.
- **راجع قبل التحميل:** فاصل للمقارنة بين الأصل والفيكتور، وطبقة حمراء للفروقات، ونسبة التطابق مع الأصل.
- **عدّل وأعد التتبع:** الألوان، والخلفية، وتعبئة المساحات المحصورة، وشكل الزوايا (حادة، متوازنة، ناعمة).
- **كمّل بعد تحديث الصفحة.** آخر مجموعة شعارات تبقى في متصفحك 24 ساعة، وزر «شعار جديد» يمسحها. ما يُرفع أي شي.
- عربي وإنجليزي، فاتح وداكن، ومتجاوبة مع الجوال.

## النسخ اللي تطلع

| النسخة | متى تنعمل |
| --- | --- |
| بالألوان على الخلفية | لو الصورة الأصلية لها خلفية ثابتة |
| بالألوان — شفاف | دائمًا |
| للخلفيات الفاتحة | للشعارات الفاتحة المصممة على خلفية داكنة |
| للخلفيات الداكنة | الأجزاء الداكنة تصير بيضاء |
| أسود / أبيض بلون واحد | دائمًا، والأجزاء القريبة من لون الخلفية تنفرّغ عشان التفاصيل الداخلية تظل واضحة |

النسخة المعاد تلوينها تنتخطى لو بتدمج طبقتين في لون واحد وتمسح تفاصيل (مثل أيقونة داكنة داخل قرص أبيض).

## كيف تشتغل

1. **الخلفية** — شفافة، أو لون الوسيط لحدود الصورة.
2. **الباليت** — k-means على البكسلات *المسطحة* بس، عشان الحواف المموّهة (anti-aliased) ما تخترع ألوان وسيطة؛ ومرحلة ثانية تلقط الألوان النادرة مثل خطوط ذهبية رفيعة.
3. **التكبير** — عشان يكون فيه مساحة كافية لـ potrace يرسم منحنيات ناعمة.
4. **تصنيف واعٍ بالمزج** — كل بكسل يتحدد إما بلون واحد من الباليت أو مزيج من لونين، وينسب للأقرب. هذا يمنع حواف الكحلي/الأبيض من تُقرأ على إنها "ذهبي".
5. **طبقات متراصّة** — الطبقة رقم *n* فيها لونها زائد كل الألوان اللي فوقها، عشان ما تصير فجوات شعرية بين الألوان.
6. **تتبع** كل طبقة بـ potrace، وبعدين إعادة رسم النتيجة ومقارنتها بالأصل لقياس مدى التطابق.

أداة الويب تعرض هذا التطابق كنسبة مئوية، مع فاصل تسحبه للمقارنة بين قبل وبعد وطبقة حمراء تبيّن الفروقات، وتقدر تعدّل الألوان والخلفية وتعبئة المساحات المحصورة وشكل الزوايا قبل ما تعيد التتبع. شكل الزوايا يضبط `alphamax` و`opttolerance` في potrace: *الحادة* تحافظ على زوايا الأشكال الهندسية، و*الناعمة* تنعّم الشعارات الدائرية أو المرسومة باليد.

## حدود المتصفح

| | كمبيوتر | جوال |
| --- | --- | --- |
| دقة المعالجة | حتى 24 ميجابكسل | حتى 12 ميجابكسل (Safari آيفون يوقف عند حوالي 16.7 ميجابكسل) |
| حجم الملف | 25 م.ب | 25 م.ب |
| الوقت المعتاد | 1–4 ث للشعار | 3–10 ث للشعار |
| عدد الشعارات بالمرة | 20 | 20 |

ملفات الفيكتور (SVG وPDF وAI وEPS) ترفضها الأداة مع ذكر السبب، لأن تتبع ملف فيكتور أصلًا يقلل جودته بس.

كل تعديل يُختبر آليًا على Chromium وFirefox وWebKit (عبر Playwright على Linux). ما تم بعد اختبارها على آيفون أو أندرويد حقيقي، ولا على Firefox في كمبيوتر حقيقي.

## استخدام أداة الويب في مكان ثاني

الأداة عبارة عن وحدات ES عادية بدون أي خطوة بناء (build). تقدر تضمّنها كعنصر HTML، أو تركّب الواجهة بنفسك، أو تستدعي المحرك مباشرة — راجع **[INTEGRATION.md](INTEGRATION.md)** لتفاصيل الدمج في Brand Kit Builder (React + Vite) وصفحة دمج الخطوط العربية. والأداة منشورة كذلك على npm باسم [`logo-vectorizer`](https://www.npmjs.com/package/logo-vectorizer): `npm install logo-vectorizer` (مع Vite أضف سطر `optimizeDeps.exclude` من INTEGRATION.md).

```html
<script type="module" src="/logo-vectorize/lib/logo-vectorizer.js"></script>
<logo-vectorizer lang="ar" host-action-label="أضف إلى الهوية"></logo-vectorizer>
```

## استخدام المهارة (skill)

```bash
bash scripts/setup.sh
python3 scripts/vectorize_logo.py logo.png --out build/out --name brand --display-name "Brand" --lang ar
```

لاستخدامها كمهارة Claude، اضغط محتوى المستودع بصيغة zip (بدون `site/` و`tests/`) وارفعه كمهارة.

## التطوير

```bash
cd site && python3 -m http.server 8000   # أي خادم ملفات ثابتة؛ الـ module workers تحتاج http مو file://
pip install playwright && python -m playwright install chromium firefox webkit
python tests/e2e.py chromium             # أو firefox / webkit
```

الاختبارات تستخدم شعارات وهمية فقط، وتتحقق من: الألوان والنسخ والتصدير، والمعالجة الجماعية والاستكمال، وأشكال الزوايا، وتطابق الأصل مع الفيكتور في شاشة المقارنة (صور طويلة وعريضة وكبيرة وعلى عرض الجوال)، ومعايير الوصولية WCAG 2.2 A/AA عبر axe-core.

`worker.js` نسخة مطابقة لـ `scripts/vectorize_logo.py`، لازم تتعدّل النسختين مع بعض.

## الاعتماديات (مضمّنة في `site/lib/vendor/`)

| الحزمة | الإصدار | دورها | الترخيص |
| --- | --- | --- | --- |
| esm-potrace-wasm | 0.5.1 | محرك potrace مترجم لـ WebAssembly | GPL-2.0 |
| jsPDF | 4.2.1 | إنشاء ملف PDF | MIT |
| svg2pdf.js | 2.8.1 | تحويل SVG إلى مسارات فيكتور داخل PDF | MIT |
| fflate | 0.8.3 | ضغط ZIP | MIT |
| axe-core (للاختبارات فقط، `tests/vendor/`) | 4.13.0 | فحص الوصولية | MPL-2.0 |

## الترخيص

GPL-2.0-or-later، لأن محرك التتبع [Potrace](https://potrace.sourceforge.net/) مرخّص كذا. تقدر تستخدم الأداة وتعدّلها وتستضيفها بحرية، ولو وزّعت نسخة معدّلة لازم يكون كودها متاح بنفس الترخيص.

**هذا الترخيص ما يشمل أي شعار.** استخدم الأداة فقط مع شعارات تملكها أو عندك إذن باستخدامها.

</div>
