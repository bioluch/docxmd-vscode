# Changelog

## 0.7.1

Fixes from a code review, shared with the DOCXMD web app 3.0.11:

- **Paste from AI** goes to the editor that has the focus: a native Markdown editor in another group gets the paste even while a DOCXMD panel is visible. HTML with equations is preferred over plain text in which they were flattened.
- **Citations:** live Zotero fields carry `uris` (Zotero 7 no longer fails on Refresh / Edit Citation for embedded items). Word import keeps two works with the same title, author and year apart, restores citations in footnotes and endnotes, handles nested Mendeley controls, keeps the text around a bibliography that spans paragraphs, and a `$&` in a title no longer breaks the bibliography. A changed `refs.bib` is always read again.
- **Mermaid:** an empty diagram no longer swallows the next paragraph; several diagrams in one Word paragraph are all restored; only the diagram's own caption is removed on import; a theme change keeps YAML front matter first; editing a diagram never changes a code example that shows one.
- **Translation:** `[@key]` and `@key` citations are not sent for translation; Traditional Chinese is detected as such.
- **UPPERCASE / lowercase** keeps link and image addresses unchanged.

## 0.7.0

- **Paste from AI → Word:** answers from ChatGPT, Claude, Gemini, Copilot, Perplexity and DeepSeek keep their formulas and tables when pasted. Chat buttons and citation marks are removed, and numbered sources become footnotes. New command **DOCXMD: Paste from AI**.
- **Exact Word equations:** matrices, cases, sums and integrals with limits, brackets, accents and `\mathbb`, written as native Word math.
- **Citations and bibliography:** `[@key]` with BibTeX, RIS or CSL-JSON. Styles: DSTU 8302:2015, APA, IEEE, Vancouver, Harvard, Chicago, MLA, or your own `.csl`. The reference list in Word is clickable. A new setting `docxmd.zoteroFields` exports live Zotero fields.
- **Mermaid diagrams** in the preview and in Word (vector, numbered, captioned). Diagrams return to Markdown on Word import.
- **Word import:** Zotero, Mendeley and Word citations become `[@key]` again.
- **Interface in 7 languages:** English, Ukrainian, Spanish, Portuguese (Brazil), Japanese, Chinese (Simplified) and Chinese (Traditional). Word captions, callout titles and translation targets follow them.
- Converter synced with the DOCXMD web app 3.0. New categories: Formatters and Other.

## 0.6.0

Shared with the DOCXMD web app 2.0 (updated `textstyle.js`, `previewedit.js`, `md2docx.js`, `i18n.js`):

- **Alignment always works.** Left / centre / right / justify replace an existing `<div align="…">` instead of wrapping it in another one — before, a second alignment was nested inside the first and had no visible effect, and *left* did nothing after *centre*. Old documents with nested wrappers are fixed by one click. Alignment written inside the block (e.g. `<p style="text-align:left">` from a Word import) is removed so the new one wins; table cells and pictures keep theirs.
- **Alignment in Preview mode:** the four buttons align the block under the preview caret or every block the selection touches (before they used the hidden source's selection). Clicking another alignment right after the first one works without selecting again.
- **Justify like Word:** lines that end in a hard line break (two spaces, `\`, `<br>`) are stretched too — in the preview and the HTML export (`MD2DOCX.justifyBreaks`). A one-line paragraph still looks left-aligned, as in Word.
- **UPPERCASE / lowercase:** new toolbar buttons **AA** / **aa** change the case of the selected text — in the source, the ✎ block editor and Preview mode. Only letters change: Markdown marks, HTML tags, entities and link / image addresses are kept; one `Ctrl+Z` undoes it.
- **Quick edit and hard line breaks:** text typed at the start of a line that follows a hard line break went to the end of the previous line; it now lands where the caret is (also after `\` and `<br>`, inside `*italic*` etc.). The caret keeps its line after Enter / Tab / Ctrl+B. `Enter` right before or after a hard line break splits the paragraph there and removes the break marker.
- **Help** opens the updated guide of DOCXMD 2.0 (alignment, case, app updates).

## 0.5.0

Shared with the DOCXMD web app 1.9 (updated `textstyle.js`, `previewedit.js`, `md2docx.js`, `i18n.js`):

- **Bold / italic in Preview:** the **B** and **I** toolbar buttons (and `Ctrl+B` / `Ctrl+I`) now work on the text selected in the preview and **toggle**: if all of the selection is bold, it becomes normal, otherwise bold (same for italic). In Markdown text they add or remove `**` / `*`; in HTML — tables, text imported from Word or PDF — they set `font-weight` / `font-style` on a `<span>` (“off” writes `normal`, so it also works inside a bold header cell). Before, in Preview these buttons wrapped the hidden source's selection instead.
- **Font, size and colour of a selection in Preview:** a selection in text made of several `<span>` runs (typical for PDF / Word imports) or across table cells is now found in the source reliably; each plain-text piece is styled on its own, so no tag boundary is ever wrapped and the formatting of the neighbouring text is not changed. After the change the same text is selected again — apply font, size, colour, B and I one after another. When selected text cannot be located, you get a message — the style is **never** applied to the whole document instead (before, the size could land in the front matter and the selection vanished).
- **Word export:** `font-weight: normal` / `font-style: normal` in a span turn bold / italic **off** (also inside bold headings or `**…**`); lists inside HTML table cells keep their levels (indented, hanging marker) and their markers (`circle`, `square`, `lower-alpha`, `<ol start>`…); a table with a width but no `<colgroup>` gets an even column grid.
- **Preview:** tables imported from PDF (`class="pdf-import-table"`) keep only their own shading (no zebra rows).

## 0.4.0

Shared with the DOCXMD web app 1.8 (new `media/tableedit.js`; updated `md2docx.js`, `docxfmt.js`, `previewedit.js`):

- **Column widths:** drag the border between two columns in the preview; a badge shows the shares (`45% · 55%`). Written as `<colgroup><col style="width:45%">…` with `table-layout:fixed`; pictures shrink to their column. Double-click a border: automatic widths.
- **Table width:** drag the right edge (15–100 % of the page) → `<table style="width:69%">`; double-click: automatic.
- **Row height:** drag the bottom edge of a row → `<tr style="height:80px">` (a minimum height in Word); double-click: automatic.
- **Position:** bar buttons left / centre / right → `margin-left / margin-right: auto` (Word: table alignment). A full-width table becomes 80 % so it can move.
- **Cell alignment:** click a cell (blue frame), then ▤ — scope *Cell / Row / Column / Whole table* and 9 positions (top / middle / bottom × left / centre / right) → `text-align` + `vertical-align`, for text and pictures; *Default alignment* removes it.
- **Equal columns** and **reset** (widths, heights, position).
- A Markdown pipe table can't hold these settings: the first change rewrites it as an HTML table (text and formatting kept). Every change is one undoable edit.
- **Big documents are fast** (`media/embedfold.js`): a picture embedded as base64 (hundreds of KB of text, e.g. after a Word import) is shown in the editor as a short token — `![](#embedded-image-3)`. The VS Code document, saving, the Word / HTML export, copy and translation always get the full data, so the `.md` file is unchanged. A document with 60 embedded pictures (15 MB) used to take ~8 s per keystroke in the editor; now ~70 ms.
- **Multi-line edits without freezing:** Chrome inserts multi-line text into a text box line by line, revealing the caret after each line — in a big document that cost seconds per line (half a minute for a table edit). The editor now changes only the part that really differs, stays pinned in place during such an insert and during Ctrl+Z / Ctrl+Y, and handles one change event instead of hundreds: aligning all 120 cells of a table ~0.4 s (was ~27 s), undo ~0.14 s (was ~9 s).
- **Word export / import:** table alignment (`w:jc`), minimum row heights (`w:trHeight`), widths without `<colgroup>`; importing a Word document restores the position and explicit row heights.

## 0.3.0

Shared with the DOCXMD web app 1.7 (new `media/textstyle.js`; updated `md2docx.js`, `docxfmt.js`, `mdedit.js`, `previewedit.js`):

- **Font, size, colour.** Three toolbar buttons: **Aa** — font (common Office / Windows fonts, “Default”), size — 8…72 pt, **A** — 20 colours, a custom colour, “Automatic”. With text selected (in the source, in the ✎ block editor, or in Preview mode — a quick edit or a plain selection inside a paragraph, list item or table cell, HTML tables included) only that text changes: `<span style="color:#C00000;font-size:14pt">…</span>`; choosing again updates the same span, “Default” / “Automatic” removes it. With nothing selected, font and size apply to the **whole document** — front matter `font: Georgia`, `font-size: 11pt`: the preview shows the body text in them (headings keep their size) and the Word export makes them the document's default font and size. Colour always needs a selection. Every change is one undoable edit.
- **Word export** understands `<span style="font-size / font-family / color">` and `<font>`, a table's `font-size`, `<colgroup>` column widths (fixed layout; pictures are scaled to their column) and `<div style="text-align:…">` inside cells.
- **Word import (DOCXMD: Import Word):**
  - **font sizes** — the size most paragraphs use becomes front matter `font-size:`; other sizes become `<span style="font-size:…pt">` (a cell or table written in one size carries it on `<td>` / `<table>`); headings keep their level's size;
  - **alignment** — centred / right-aligned paragraphs and pictures become `<div align="center">` around Markdown; in tables the cell (or a `<div style="text-align:center">` inside it) is centred;
  - **column widths** — Word's column grid becomes `<colgroup><col style="width:46%">…` on an HTML table with `table-layout:fixed`, so the preview and the export keep the proportions and **pictures never stick out of their column**;
  - the import pipeline is now one shared function (`DOCXFMT.toMarkdown`) — the extension and the web app convert identically.

## 0.2.1

- **Smart editing in Preview mode — complete.** The 0.2.0 package on the Marketplace was built before this part was finished; 0.2.1 contains it. In the quick text edit (click a paragraph, heading, list item or table cell): `Enter` in a list item adds a new item and keeps editing in it (`Enter` on an empty item ends the list), `Enter` in the middle of a paragraph splits it (no stray spaces left at the split); `Tab` / `Shift+Tab` change the list level or move to the next / previous table cell — empty cells and a new row included; `Alt+↑/↓` move a list item, a table row or a whole block (paragraph, heading, table) instead of merging paragraphs; `Ctrl+B` / `Ctrl+I` and `* _ ` = ~ ( [ "` format the selection; `Ctrl+/` comments out; `Ctrl+Shift+T` aligns the table; a URL pasted on selected text becomes a link and formatted text becomes Markdown. Each operation is one undoable edit. In the block editor (✎, double-click, `Alt+click`) all smart keys work as in the source.
- **Smart paste:** formatted text from Word or a web page keeps the spaces around links and bold / italic text; list and heading markers are normalised (`-   item` → `- item`).
- **Fix — nested task lists:** an ordinary list item that contains a nested task list (`2. text` followed by `   - [x] …`) lost its number or bullet in the preview. Word export was not affected.
- **Documentation:** a complete [Keyboard shortcuts](#keyboard-shortcuts) table; smart editing, smart paste, syntax highlighting and Align table in [Features](#features); the online guide (**?** button) has new sections *Smart editing* and *Highlighting & line numbers* and an updated shortcuts table in all four languages. Code examples in this README are no longer turned into GitHub links on the Marketplace page.

## 0.2.0

Shared with the DOCXMD web app 1.6 (`media/mdedit.js`, `media/mdhighlight.js`):

- **Smart editing:** `Enter` continues bullet, numbered and task lists (`3.` → `4.`, `- [x]` → `- [ ]`), quotes and table rows; `Enter` on an empty item moves it out one level or ends the list. `Tab` / `Shift+Tab` change the level of list items (a numbered item moved in starts at 1), move between table cells (after the last cell a new row is added) and indent / outdent selected lines. `Alt+↑/↓` move the current lines, `Shift+Alt+↑/↓` duplicate them, `Ctrl+/` wraps them in `<!-- -->` (and back). Typing `*`, `_`, `` ` ``, `=`, `~`, `(`, `[` or `"` with text selected wraps it (`=` → `==highlight==`, `~` → `~~strike~~`). `Esc`, then `Tab` still leaves the editor.
- **Paste:** formatted text from Word, Google Docs or a web page becomes Markdown (headings, lists, tables, bold / italic, links); a URL pasted onto selected text becomes `[text](url)`; `Ctrl+Shift+V` pastes plain text. Can be switched off in the Document menu.
- **Align table** (`Ctrl+Shift+T` or Document menu): pads the pipe table under the cursor into straight columns, keeping `:--:` alignment.
- **Smart editing in Preview mode.** In the block editor (✎, double-click, `Alt+click`) everything above works as in the source. In the quick text edit (click a paragraph, heading, list item or table cell): `Enter` in a list item adds a new item and continues editing in it (`Enter` on an empty item ends the list), `Enter` in the middle of a paragraph splits it; `Tab` / `Shift+Tab` change the list level or move to the next / previous table cell — empty cells and a new row included; `Alt+↑/↓` move a list item, a table row or a whole block (paragraph, heading, table); `Ctrl+B` / `Ctrl+I` and `* _ ` = ~ ( [ "` turn the selected text into real formatting; `Ctrl+/` comments out; `Ctrl+Shift+T` aligns the table; a URL pasted on selected text becomes a link and formatted text becomes Markdown. What you typed and the operation land in the source as one undoable edit.
- **Syntax highlighting** of Markdown in the editor (headings, emphasis, code, formulas, links, lists, tables, callout fences, HTML, footnotes), **line numbers** and the **current line** — switches in the Document menu. Only colours are used, so the text layout never shifts; rendering is incremental, so long documents stay fast.

## 0.1.15

- **Display math only where it can be display math:** `\[ … \]` and `$$ … $$` start a formula block only at the start of a line, never span a blank line, and `\]` must end its line. Markdown-escaped brackets in the middle of text — `!\[\](images/…)`, `\[\[file#section\]\]`, `\[1\] Reference` — stay text (they used to swallow the following paragraphs, headings and tables into one red KaTeX error).
- `$$…$$` in the middle of a sentence is shown as a displayed formula without breaking the paragraph.
- The same rules apply to Word export, translation (escaped brackets are translated as normal text) and *Clean up scientific notation*.

## 0.1.14

- **Word import keeps text as text:** `<tag>`-like text and `&entities;` typed in a Word document are escaped in the Markdown, so the preview no longer renders them as HTML (e.g. `<textarea>` appeared as an input box).
- **Code survives the round trip:** DOCX export marks inline code with the character style *Verbatim Char* and code blocks with the paragraph style *Source Code* (Pandoc's names); import turns them back into `` `code` `` and fenced blocks. Documents from Pandoc import the same way.
- Documents exported by 0.1.13 and earlier have no code styles — their code comes back as plain (now correctly escaped) text.

## 0.1.13

- **Localized interface** — toolbar tooltips, menus, find bar, status bar, outline and statistics in English, Українська, Español and 中文 (VS Code's display language); command titles localized too (`package.nls.*.json`).
- **Outline** panel with scroll-spy; **synchronized scrolling** in Split mode.
- **Find & replace Pro** — regular expressions with `$1`, match case, whole word, Replace one; replacing is now undoable (it used to reset the undo history).
- **Editing in the preview** — the same module as the web app (`media/previewedit.js`): quick text edit and a block editor; every change is one undoable edit.
- **Document menu** — `[TOC]`, numbered headings, footnote, caption, clean up notation, statistics, **Export to HTML** (also the command **DOCXMD: Export to HTML**), editing-in-preview switch; highlight button with six colours.
- **Reliable document sync** — edits are sent as minimal range replacements and our own edits are never echoed back, so fast typing is not overwritten; `Ctrl+S` saves the text you see.
- **Import Word into an open document** now converts in place (it used to empty the file and lose the import); the imported front matter no longer repeats the file name as the title.
- **Word export** keeps WebP, AVIF and SVG images (converted to PNG) and HTML entities like `&mdash;`; the preview is no longer re-rendered on every keystroke.
- **Translation** leaves display formulas and indented code untouched; DeepL requests time out after 60 s; English = `EN-GB`, Chinese = `ZH-HANS`.
- **Accessibility** — every toolbar button has a label; `Esc`, then `Tab` leaves the editor.

## 0.1.12

- **Images next to the document:** pasting (`Ctrl+V`) or dropping an image writes it to `images/image-001.png` (next free number) in the `.md`'s folder and inserts a relative link instead of base64. Setting `docxmd.pastedImages` = `folder` (default) | `embed`; untitled documents embed.
- **Relative images work:** `![](images/pic.png)` and `<img src="…">` with relative paths now display in the preview (the document's folder and the workspace are readable by the webview) and are embedded in the exported `.docx`.
- **DOCXMD: Clean up scientific notation** — a new command and toolbar button; review list (QuickPick) with grouped changes, one undoable edit; dictionary in the `docxmd.notationDictionary` setting. Shares its rules (`media/sciclean.js`) with the web app.
- **Highlights** `==text==` / `==red:text==` (toolbar button, `Ctrl+Shift+H`) → Word highlighting; imported back from `.docx`.
- **YAML front matter** → Word header / footer, PAGE / NUMPAGES page numbers (`page-numbers: "Page {n} of {N}"`), document properties; `lang:` sets the caption words. Shown as a card in the preview; `.docx` import restores it. Translation keeps the keys and translates only title / header / footer values.
- Exporting data-URI images no longer depends on the webview's fetch policy (`connect-src` added to the CSP).

## 0.1.11

- **Image size, live:** hover an image in the preview and drag the handle at its bottom-right corner — the image resizes as you drag, and on release the width is written into the source: `![](pic.png){width=60%}` (or `width="…"` on an HTML `<img>`). Double-click the handle for the original size; with the handle focused, `←`/`→` step by 5 %. Edits are ordinary undoable text edits.
- **Width syntax for every image:** `{width=50%}`, `{width=300px}`, `{width=8cm}` / `mm` / `in` work on any image, not only numbered figures. `%` is a share of the text column; images inside tables use px.
- **DOCX export honours the width** of `![](…){width=…}`, figures and HTML `<img width="…">` / `style="width:…"` (HTML images were previously exported at natural size or dropped).
- **DOCX import keeps picture sizes** from Word: body images get `{width=NN%}`, images in tables get px.
- **Table of contents links work:** clicking an entry of a Word TOC imported from `.docx` (or any `[text](#anchor)` link — GitHub-style `#my-heading` slugs included) scrolls to the heading. Import now writes exact anchors (`{#sec:…}` / `id="sec:…"`, also for headings inside tables); links in older imported files are matched to headings by their text. In the exported `.docx` these links are internal links to bookmarks.

## 0.1.10

- **DeepL quota / invalid key:** instead of *“Translate failed: DeepL 456: Quota exceeded”* a dialog explains the problem and offers **Enter another key** (the translation is retried with it and the key is saved), **Open Settings** or **DeepL account** (usage page). The same dialog appears when DeepL rejects the key (HTTP 401/403).
- **New command:** `DOCXMD: Set DeepL API key` — replace the saved key at any time.
- A key changed in *Settings → docxmd.deeplApiKey* is used immediately (no reload needed).

## 0.1.9

- **Fix — translation:** choosing a language in **🌐 Translate…** again opens the prompt for your DeepL API key (and then translates through the extension host). In 0.1.7–0.1.8 the webview tried to call DeepL directly and failed with *“Translate failed: Failed to fetch”*. If you close the prompt without a key, a single warning offers **Get a free key** / **Open Settings**.

## 0.1.8

- **Callout blocks** — `:::info`, `:::note`, `:::tip`, `:::success`, `:::important`, `:::warning`, `:::danger` with an optional title on the opening line (`:::warning Measurement conditions`). GitHub/Obsidian alerts `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]` render the same way. In Word a callout is a tinted box with a coloured bar and a bold title with its icon; importing that `.docx` gives `:::type` back. `:::quote-red` etc. are aliases of the colour boxes.
- **x² / x₂ toolbar buttons** (`Ctrl+.` / `Ctrl+,`) wrap the selection in `<sup>` / `<sub>`; pressing again removes it, and a subscript can be switched to a superscript.
- **Ω symbols panel** — Greek letters, operators, arrows & logic, Unicode indices and units, with *Recent* symbols and an *Insert as LaTeX* option (`\delta`) for use inside `$…$`.
- **Callout button** in the toolbar wraps the selected lines in `:::type … :::`.
- **Footnotes** `text[^1]` + `[^1]: note` — numbered in order of use, listed at the end of the preview, **real Word footnotes** in DOCX.
- **Numbered figures and tables with cross-references** (pandoc-crossref syntax): `![Caption](img.png){#fig:id width=60%}`, `Table: Caption {#tbl:id}`, `## Heading {#sec:id}`, and `@fig:id` / `@tbl:id` / `@sec:id` links that always show the current number. In DOCX: captions with bookmarks and internal hyperlinks.
- **Table of contents** `[TOC]` (Word TOC field in DOCX) and **numbered headings** via `<!-- docxmd: numbered-headings -->` (1, 1.1, 1.1.1).
- Importing a `.docx` made by DOCXMD restores footnotes, captions, references, `[TOC]` and the numbering directive.
- Embedded data-URI images are shown on a tinted band in the editor.
- **Tables** — rounded frame, zebra rows, row hover, sticky header; columns whose cells are all numbers (units, ranges, `<`/`≥` allowed) are right-aligned in the preview **and** in DOCX; `:::table-compact` (tighter, smaller text) and `:::table-full` (full width) wrappers. In Word: grey header, zebra rows, header repeated on every page.

## 0.1.7

- **Import Word (`.docx`) → Markdown** — new command and Explorer context-menu entry; table fills, text colours, alignment and merged cells are preserved.
- **Colour boxes** `:::colour … :::` — coloured quote bars in the preview and in DOCX export.
- **Quote bar colour** — plain quotes export with the current theme's accent colour instead of grey.
- **Inline math `$…$`** in the preview and in DOCX.
- **DOCX export fidelity:** `<sup>`/`<sub>` (e.g. citation numbers) become real Word superscript/subscript; quotes that contain lists, code, tables or nested quotes export completely; styled HTML tables keep their colours and alignment; numbered lists keep their start number (`3.` stays 3).
- Translation keeps `:::` fences untouched.
