# DOCXMD: план реалізації «Paste from AI → Word»

План складено на основі аналізу коду, опублікованого на https://docxmd.pp.ua (версія Service Worker `docxmd-v2.0.13`): `js/app.js`, `js/mdedit.js`, `js/md2docx.js`, `js/docxfmt.js`, `js/sciclean.js`, `js/previewedit.js`, `manifest.webmanifest`. Номери рядків наведено за мініфікованою опублікованою версією й можуть відрізнятися від вихідного коду.

---

## 1. Що вже є в коді

| Можливість | Де | Стан |
|---|---|---|
| Рендер формул `\( \)`, `\[ \]`, `$ $`, `$$ $$` (KaTeX) | `app.js` ~71–113, розширення marked `mathBlock` / `mathInline` | ✅ працює |
| Експорт формул у Word як нативні рівняння (OMML) | `md2docx.js` ~189–262, `mathToOmml()` + власний `parseTex()` | ⚠️ лише базовий LaTeX |
| Вставка HTML → Markdown (Turndown + GFM + правила DOCXFMT) | `mdedit.js` `htmlToMarkdown()`, `app.js` ~2262 обробник `paste` | ✅ увімкнено за замовчуванням (`docxmd:ed.pasteHtml = 1`) |
| Ctrl+Shift+V — вставка «як є» | `app.js` `plainPaste` | ✅ |
| Share Target (Android «Поділитися» з ChatGPT/Gemini) | `manifest` `share_target`, `app.js` `takeShared()` ~2948 | ✅ текст відкривається як `shared.md` |
| Діалог перегляду змін (знайти → показати список → застосувати) | `sciclean.js` (`scan` / `apply`), `app.js` `openSciClean()` | ✅ готовий шаблон UX для повторного використання |
| Ярлики `?action=…` з кнопкою-підтвердженням (user gesture) | `app.js` ~2965–3009 | ✅ можна додати `?action=aipaste` |
| KaTeX з виводом MathML | `app.js` `mathOutput = "mathml"` (HTML-експорт) | ✅ основа для якісного OMML |

Висновок: базові інструменти вже є. Бракує шару, який розпізнає й нормалізує вставку з AI, а також потужнішого конвертера формул для Word.

---

## 2. Чому вставка з AI ламається зараз

### G1. Формули губляться при вставці HTML (найкритичніше)
Коли користувач виділяє відповідь у ChatGPT, Claude, Gemini чи Copilot і натискає Ctrl+V, у буфері опиняється `text/html` з розміткою KaTeX/MathJax:
```html
<span class="katex"><span class="katex-mathml"><math>…<annotation encoding="application/x-tex">E=mc^2</annotation></math></span>
<span class="katex-html" aria-hidden="true">…десятки span…</span></span>
```
`isRichHtml()` бачить `<p>`/`<strong>`, і HTML іде в Turndown. Правила для `.katex` / `<math>` немає, тож формула перетворюється на дубльований текст (MathML-текст плюс видимий HTML), наприклад `E=mc2E=mc^2`. Вихідний LaTeX у `<annotation>` при цьому втрачається.

Кнопка «Copy» у самих AI-сервісах дає Markdown у `text/plain`, а в деяких версіях ще й `text/html`. У такому разі DOCXMD обирає HTML, хоча Markdown з `\( \)` був би кращим.

### G2. Межі формул, які видають AI, не завжди збігаються з правилами парсера
Регулярні вирази `mathBlock` вимагають, щоб `\[` стояв на початку рядка з відступом не більше 3 пробілів, `\]` закінчував рядок, а всередині не було порожніх рядків. Типові відповіді AI:
- `\[ … \]` всередині вкладеного списку з відступом 4+ пробіли;
- `\[` посеред речення (`…отже \[ x = 2 \] звідки…`);
- порожній рядок усередині `\begin{aligned} … \end{aligned}`;
- формули без зворотних слешів після копіювання відрендереного тексту: `[ x = \frac{a}{b} ]` або `( \alpha )`; так часто буває при копіюванні з ChatGPT;
- `$…$` з пробілом після `$`, який правило Pandoc/Typora `INLINE_DOLLAR` навмисно не приймає.

### G3. Експорт формул у Word обмежений
`parseTex()` у `md2docx.js` підтримує `\frac`, `\sqrt`, `^`, `_`, `\text`/`\mathrm`, грецькі літери й близько 50 операторів. Немає підтримки:
- `\begin{…}`: `matrix`, `pmatrix`, `bmatrix`, `cases`, `aligned`, `align`, `array`;
- n-арних операторів з межами (`\sum_{i=1}^{n}`, `\int_a^b`, `\lim_{x\to0}`), які стають звичайними індексами, а не `m:nary` / `m:limLow`;
- акцентів `\hat`, `\bar`, `\vec`, `\tilde`, `\dot`, `\overline`, `\underline`;
- `\mathbb`, `\mathcal`, `\boldsymbol`, `\binom`, `\pmod`, `\xrightarrow`;
- `\left( … \right)` як `m:d` (дужки зараз просто стають текстом).

Невідома команда виводиться як текст: `\mathbb{R}` перетворюється на `mathbbR`. Саме такі конструкції найчастіше трапляються у відповідях AI з математики, фізики й статистики.

### G4. Таблиці
- GFM-таблиці від AI здебільшого коректні, але ламаються, коли `|` стоїть усередині формули (`\(|x|\)`, `\| v \|`): комірка розбивається.
- Таблиця з відступом усередині списку або без рядка-розділювача `|---|` не розпізнається.
- Gemini іноді обгортає таблицю в блок коду ```` ``` ````.
- HTML-таблиці з буфера з `colspan`/`rowspan` уже обробляє правило `docxmdHtmlTable`, але кнопок «Copy table» і заголовків від AI-інтерфейсу ніхто не прибирає.

### G5. Артефакти AI-інтерфейсів
- ChatGPT: `【4†source】`, `:contentReference[oaicite:0]{index=0}`, `oaicite`, рядок «ChatGPT said:», а також «Copy code» / назва мови над блоком коду при копіюванні HTML.
- Claude: «Copy», «Artifact», заголовки артефактів.
- Gemini: «Show drafts», «Export to Docs», «Sources and related content».
- Perplexity: маркери `[1]`, `[2]`, які варто перетворити на виноски `[^1]`.
- Загальне: `\u200B`, `\u00A0`, «розумні» лапки в коді, емодзі в заголовках, `---` між розділами.

---

## 3. Архітектура рішення

Новий модуль `js/aipaste.js` за зразком `sciclean.js`: чисті функції без DOM-залежностей, щоб той самий код працював у VS Code-розширенні.

```
window.DOCXMDAIPaste = {
  detect(html, plain)        → { source: "chatgpt"|"claude"|"gemini"|"copilot"|"perplexity"|"deepseek"|"generic"|null, confidence, prefer: "plain"|"html" }
  htmlToMarkdown(html, td)   → md            // Turndown з AI-правилами (KaTeX/MathJax → LaTeX)
  normalize(md, opts)        → { md, changes: [{rule, from, to, at}], stats }
  RULES                      // список правил з id, назвою (i18n-ключ), увімкнено/вимкнено
}
```

### 3.1. Конвеєр вставки

```
ClipboardEvent / navigator.clipboard.read()
   │
   ├─ detect(html, plain)
   │     • сигнатури HTML: class="katex", <math>, data-message-author-role (ChatGPT),
   │       class="font-claude-message", <message-content>/model-response (Gemini),
   │       mjx-container (MathJax: Copilot, DeepSeek), hostname у <base>/SourceURL (Windows CF_HTML)
   │     • сигнатури plain: \( \) \[ \], $$, |---|, ```, ### , **…**
   │
   ├─ prefer === "plain" (plain схожий на Markdown) → md = plain
   │  інакше → md = htmlToMarkdown(html)  // з правилами 3.2
   │
   ├─ normalize(md)  // правила 3.3, кожна зміна записується в changes
   │
   └─ показати діалог перегляду (як у sciclean) або застосувати мовчки (налаштування)
```

Ключове евристичне правило: якщо `plain` містить ознаки Markdown (≥2 із: `\(`/`\[`/`$$`, `|---`, ```` ``` ````, `^#{1,6} `, `**`), бере пріоритет `plain`. Інакше використовується HTML з AI-правилами.

### 3.2. Нові правила Turndown (для HTML)

```js
// KaTeX: беремо вихідний LaTeX з <annotation>
td.addRule("aiKatex", {
  filter: (n) => n.nodeType === 1 && (n.classList.contains("katex") || n.classList.contains("katex-display")),
  replacement: (_, n) => {
    const ann = n.querySelector('annotation[encoding="application/x-tex"]');
    if (!ann) return n.textContent;
    const tex = ann.textContent.trim();
    const display = n.classList.contains("katex-display") || !!n.closest(".katex-display");
    return display ? "\n\n$$\n" + tex + "\n$$\n\n" : "\\(" + tex + "\\)";
  }
});
// MathJax 3: <mjx-container> + <script type="math/tex"> або data-latex / aria-label
td.addRule("aiMathJax", { filter: (n) => n.nodeName === "MJX-CONTAINER" || (n.nodeName === "SCRIPT" && /math\/tex/.test(n.type)), replacement: … });
// Голий <math> (MathML): спершу <annotation>, інакше залишити MathML як HTML-блок
td.addRule("aiMathML", { filter: "math", replacement: … });
// Службові елементи інтерфейсу
td.remove((n) => n.nodeType === 1 && (n.matches?.('button, [aria-hidden="true"]:not(.katex-html), .sr-only, [data-testid*="copy"], nav') ));
// Блок коду ChatGPT: заголовок "python  Copy code" → мова в ```python
td.addRule("aiCodeBlock", { filter: (n) => n.nodeName === "PRE", replacement: … });
```
`.katex-html` слід видаляти лише після того, як `aiKatex` спрацював на батьківському елементі. Через `td.addRule` правило стає першим, тому порядок коректний.

Правила реєструються всередині `htmlToMarkdown()` у `mdedit.js` перед `DOCXFMT.markdownRules(td)`, але тільки коли `detect()` повернув AI-джерело. Так звичайна вставка з Word і вебсторінок не зміниться.

### 3.3. Правила `normalize(md)` (для тексту)

Кожне правило окремо вмикається й вимикається, а його зміни показуються в діалозі.

| id | Що робить | Приклад |
|---|---|---|
| `mathBrackets` | Відновлює слеші: рядок, що весь складається з `[ … ]` з LaTeX-командою всередині → `\[ … \]`; `( \alpha )` → `\( \alpha \)` | `[ x=\frac{a}{b} ]` → `$$x=\frac{a}{b}$$` |
| `mathDisplayFix` | Переносить `\[ … \]` у вигляді `$$` на окремі рядки, прибирає зайвий відступ (зберігаючи вкладеність списку), видаляє порожні рядки всередині формули | — |
| `mathInlineSpace` | `$ x $` → `$x$` (тільки якщо всередині є LaTeX-ознака: `\`, `^`, `_`, `=`) | — |
| `mathPipes` | `|` усередині формули в рядку таблиці → `\vert` / `\|` → `\Vert` | `\(|x|\)` → `\(\vert x\vert\)` |
| `tableUnfence` | Знімає ```` ``` ```` навколо блоку, який є GFM-таблицею | — |
| `tableSeparator` | Додає пропущений рядок `|---|`, вирівнює кількість комірок | — |
| `tableDedent` | Прибирає відступ таблиці, щоб її розпізнав GFM | — |
| `citeChatGPT` | Видаляє `【n†…】`, `:contentReference[oaicite:n]{…}`, `oaicite` | — |
| `citeToFootnotes` | `[1]`, `[2]` + список «Sources» у кінці → `[^1]` і `[^1]: …` (уже підтримується `md2docx.js` як справжні виноски Word) | Perplexity, Copilot |
| `uiChrome` | Видаляє «ChatGPT said:», «Copy code», «Show drafts», «Export to Docs» і подібне | — |
| `invisibles` | `\u200B`, `\u00A0` → пробіл, `\r\n` → `\n` | — |
| `headingEmoji` | (вимкнено за замовчуванням) прибирає емодзі з заголовків | `## 🚀 План` → `## План` |
| `frontMatter` | (опційно) додає YAML з `title:` (перший `#`) і `date:`, щоб Word отримав властивості документа (функція вже є в `md2docx`) | — |

Важливо: правила не чіпають код (`inFence`), front matter, URL. Тут можна повторно використати допоміжні функції з `sciclean.js` і `mdedit.js` (`inFence`, `lineStart`).

---

## 4. Покращення експорту формул у Word

Без цього кроку вставка з AI виглядатиме добре в Preview, але в Word складні формули будуть зламані (див. G3).

Пропонована схема: LaTeX → MathML (KaTeX, вже в проєкті) → OMML (`mathml2omml`) → вставка XML у docx.

```js
function mathToOmmlRich(D, tex, display) {
  try {
    const mml = katex.renderToString(tex, { output: "mathml", throwOnError: true, displayMode: display });
    const math = mml.match(/<math[\s\S]*<\/math>/)[0];
    const omml = mml2omml(math);                       // <m:oMath>…</m:oMath>
    return D.ImportedXmlComponent.fromXmlString(omml); // або власний XmlComponent-обгортник
  } catch (e) {
    return mathToOmml(D, tex);                         // поточний parseTex — запасний варіант
  }
}
```

Що врахувати:
- Бібліотека `mathml2omml` (fiduswriter) працює на чистому JS без XSLT: https://github.com/fiduswriter/mathml2omml. Вона розповсюджується під LGPL-3.0, тож її краще тримати окремим файлом `js/vendor/mathml2omml.js`, не об'єднаним з кодом застосунку, і згадати ліцензію у «Про програму». Це вимога LGPL до замінюваної бібліотеки.
- Альтернатива KaTeX → MathML — Temml (MIT), який дає чистіший MathML. Його використовує, зокрема, PptxGenJS: https://shbernal.github.io/PptxGenJS/math-latex. Втім, KaTeX уже є в проєкті, тому почати варто з нього.
- Треба перевірити, як вбудований `docx.umd.js` вставляє сирий OMML: через `ImportedXmlComponent.fromXmlString` чи власний `XmlComponent`. Потрібно, щоб `m:oMath` у рядковій формулі потрапив у `w:p`, а у блоковій — у `m:oMathPara`.
- Перемикач у налаштуваннях експорту: «Формули: точні (MathML→OMML) / сумісні (базові)». На старті краще залишити старий режим як запасний.
- Перевірка: Word 365 (Windows / Mac), Word Online, LibreOffice Writer, Google Docs (імпорт .docx).

---

## 5. Інтерфейс

1. **Кнопка «Вставити з AI»** на панелі поруч із «Імпорт Word». Іконка ✨ + 📋 або текст «AI → Word» на широких екранах.
   - Натискання викликає `navigator.clipboard.read()` (потрібна дія користувача; кнопка її забезпечує). Береться `text/html` і `text/plain`, далі працює конвеєр 3.1.
   - Якщо `clipboard.read()` недоступний (Firefox, частина Safari), з'являється модальне вікно «Натисніть Ctrl+V тут» з полем, яке ловить подію `paste`.
2. **Автовизначення під час звичайного Ctrl+V.** У поточному обробнику `paste` (`app.js` ~2262), перед гілкою `ED.pasteHtml()`, викликається `detect()`. Якщо джерело — AI, вставка проходить конвеєр і з'являється тост: «Виправлено 7 формул і 2 таблиці з ChatGPT · Переглянути · Скасувати». Скасування працює через `history.js` snapshot, як у `sciclean`.
3. **Діалог перегляду** — на основі `openSciClean()`: список змін, згрупований за правилами, з галочками й кнопками «Застосувати» / «Скасувати». У налаштуваннях є опція «Не питати, виправляти автоматично».
4. **Режими вставки** (випадаюче меню кнопки):
   - «Вставити в курсор»;
   - «Відкрити як новий документ» (`openDocument({ text, name: "ai-answer.md", dirty: true })`);
   - «Одразу в Word»: новий документ і одразу `actions.docx()`. Це головний сценарій для лендингу.
5. **Ярлик у маніфесті:** `{ "name": "Paste from AI", "url": "./index.html?action=aipaste" }`. Він використовує вже наявний механізм `?action=` з кнопкою підтвердження.
6. **Share Target:** у `takeShared()` текст, що прийшов зі спільного доступу, проганяється через `normalize()`. Це відповідає сценарію Android → ChatGPT/Gemini → «Поділитися» → DOCXMD.
7. **Демо-документ** «Welcome» доповнюється прикладом відповіді AI з формулами й таблицею та кнопкою «Спробувати Вставити з AI».
8. **i18n:** нові ключі (`ai.paste`, `ai.fixed`, `ai.rule.*`, `ai.dialog.*`) додаються в `i18n.js` для всіх наявних мов (EN, UK, ES, ZH тощо).

---

## 6. Тестування

1. **Корпус фікстур** (`tests/aipaste/`). Для кожного з ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok збираються пари `html` + `plain` у двох варіантах: кнопка «Copy» і ручне виділення. Теми: алгебра, матриці, cases, інтеграли й суми, статистика (\bar x, \hat\beta), хімія, таблиці з формулами, код, списки з вкладеними формулами. Разом приблизно 60–100 фікстур.
2. **Golden-тести** (Node + jsdom, або Vitest): `normalize(htmlToMarkdown(html))` порівнюється з очікуваним `.md`; md → docx → розпакований `document.xml` перевіряється на наявність `m:oMath`, `m:nary`, `m:m` (матриця), `m:d`.
3. **Регресія.** Звичайна вставка з Word, Google Docs і вебсторінок має дати той самий результат, що й до змін. Для цього варто зберегти поточні фікстури.
4. **Ручна перевірка в Word / LibreOffice / Google Docs** на 10 еталонних документах.
5. **Метрики** (анонімно, якщо є згода — у вас є `consent.js`): кількість натискань «Вставити з AI», частка скасувань, кількість експортів DOCX після вставки, розподіл за джерелами.

---

## 7. Лендинг «AI → Word»

### 7.1. Структура URL
- `https://docxmd.pp.ua/chatgpt-to-word/` — основна сторінка (EN)
- `/uk/chatgpt-to-word/`, `/de/…`, `/es/…`, `/pt/…`, `/fr/…` з `hreflang`
- Сателіти під окремі запити: `/claude-to-word/`, `/gemini-to-word/`, `/latex-equations-to-word/`, `/markdown-table-to-word/`

Сторінки мають бути статичним HTML, а не частиною SPA, щоб пошуковики індексували текст. Їх треба додати в `sitemap.xml` (вже існує). Service Worker не повинен віддавати замість них `index.html`.

### 7.2. Структура сторінки
1. **H1:** «Перетворіть відповідь ChatGPT на Word — з формулами й таблицями». Підзаголовок: «Безкоштовно, офлайн, без завантаження на сервер».
2. **Вбудований міні-конвертер:** поле «Вставте відповідь AI» і кнопка «Завантажити .docx». Можна взяти `aipaste.js` + `md2docx.js`, без повного редактора. Користувач отримує результат за 10 секунд, і це головний чинник конверсії.
3. **До / після:** скриншот «ChatGPT → Word звичайним копіюванням» (зламані формули) проти «через DOCXMD» (рівняння Word).
4. **3 кроки:** Copy → Paste → Download, з GIF або коротким відео до 15 с.
5. **Переваги:** нативні рівняння Word (можна редагувати), таблиці, виноски з джерел, колонтитули й нумерація сторінок, приватність (усе в браузері), офлайн, безкоштовно.
6. **Підтримувані AI:** ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok.
7. **FAQ** з розміткою `FAQPage`, наприклад: «Чому формули з ChatGPT ламаються у Word?», «Як скопіювати таблицю з ChatGPT у Word?», «Чи безпечно?», «Чи працює на телефоні?».
8. **CTA:** «Відкрити повний редактор» і бейджі Microsoft Store, Google Play, VS Code Marketplace.

### 7.3. SEO
- `title` до 60 символів, наприклад «ChatGPT to Word Converter — Keep Equations & Tables | DOCXMD».
- Schema.org: `SoftwareApplication` (`applicationCategory: "ProductivityApplication"`, `offers.price: 0`), `FAQPage`, `HowTo`.
- Ключові запити для перевірки в Google Keyword Planner або Ahrefs: «chatgpt to word», «copy chatgpt to word with equations», «chatgpt latex to word», «chatgpt table to word», «convert chatgpt answer to docx», а також українські відповідники «перенести відповідь chatgpt у word» і «формули chatgpt у word».
- Open Graph-зображення 1200×630 з порівнянням «до / після».
- Внутрішні посилання з головної сторінки й `help.js` на лендинг.

---

## 8. Етапи й орієнтовні терміни (один розробник)

| Етап | Зміст | Оцінка |
|---|---|---|
| 0 | Зібрати корпус фікстур (6–7 AI), зафіксувати поточну поведінку | 1–2 дні |
| 1 | `aipaste.js`: `detect`, правила Turndown для KaTeX/MathJax, пріоритет plain-Markdown | 2–3 дні |
| 2 | `normalize`: формули, таблиці, артефакти, виноски + unit-тести | 3–4 дні |
| 3 | UI: кнопка, автовизначення в `paste`, тост з «Скасувати», діалог перегляду (на базі sciclean), режими вставки, ярлик маніфесту, Share Target, i18n | 3–4 дні |
| 4 | Точний експорт формул: KaTeX MathML → `mathml2omml` → OMML, запасний старий парсер, тести в Word / LibreOffice | 3–5 днів |
| 5 | Лендинг EN + UK з міні-конвертером, SEO-розмітка, OG-зображення, відео | 3–4 дні |
| 6 | Перенести `aipaste.js` у VS Code-розширення (команда «DOCXMD: Paste from AI»), оновити описи в MS Store, Google Play і Marketplace | 1–2 дні |
| 7 | Запуск: Product Hunt, Reddit (r/ChatGPT, r/academia, r/GradSchool), статті «How to copy ChatGPT to Word with equations» | 2–3 дні |

Мінімальна версія для швидкого запуску: етапи 0–3 і 5, приблизно 2–2,5 тижня. Етап 4 можна випустити окремим оновленням, але бажано до активного просування, бо саме формули в Word — головна обіцянка лендингу.

---

## 9. Ризики

- **Розмітка AI-сервісів змінюється.** Сигнатури в `detect()` потрібно винести в окремий об'єкт (`SIGNATURES`) і перевіряти щомісяця на фікстурах. Основний шлях через `<annotation>` KaTeX стабільний і не залежить від конкретного сайту.
- **Хибні спрацьовування `mathBrackets`.** Правило застосовується лише тоді, коли всередині дужок є LaTeX-команда (`\frac`, `\sum`, `^{`, `_{`), і завжди показується в діалозі перегляду.
- **Ліцензія LGPL для `mathml2omml`:** окремий файл і примітка в «Про програму». Альтернатива — власна реалізація MathML → OMML для обмеженого набору елементів.
- **Розмір бандла.** `mathml2omml` невеликий, але його варто завантажувати ліниво, лише при першому експорті з формулами, і додати в `CORE` Service Worker для офлайн-режиму.
- **Firefox і Safari** мають обмежений `navigator.clipboard.read()`; запасний варіант — модальне поле з Ctrl+V (див. розділ 5).
