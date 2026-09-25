# DOCXMD for VS Code

Edit Markdown with a live neumorphic preview, export to Word (`.docx`) and import Word back to Markdown — directly inside VS Code.

> **New in 0.3.0:** **font, font size and text colour** from the toolbar (**Aa** / size / **A**) — for the selected text (also in Preview mode) or, with nothing selected, for the whole document (front matter `font:` / `font-size:`, used by the preview and the Word export). **Word import** now keeps **font sizes**, **centred / right-aligned paragraphs and pictures**, and **table column widths** — pictures in tables no longer stick out of their column. See [What's new in 0.3.0](#whats-new-in-030).
>
> **New in 0.2.1:** the complete **smart editing in Preview mode** (it was missing from the 0.2.0 package on the Marketplace) — in the quick text edit `Enter` adds list items and splits paragraphs, `Tab` / `Shift+Tab` change list levels and move between table cells, `Alt+↑/↓` move items, rows and blocks, `Ctrl+B` / `Ctrl+I` and `* = ~` format the selection, pasted links and formatted text become Markdown; pasting formatted text keeps the spaces around links and bold text; nested task lists keep their parent's number in the preview; a full [Keyboard shortcuts](#keyboard-shortcuts) table. See [What's new in 0.2.1](#whats-new-in-021).
>
> **New in 0.2.0:** a smarter editor — **Enter continues lists, quotes and table rows**, **Tab / Shift+Tab** change list levels and move between table cells, **Alt+↑/↓** move lines, **Shift+Alt+↑/↓** duplicate them, **Ctrl+/** comments out, `* _ \` = ~ ( [` wrap the selection; text **pasted from Word or a web page becomes Markdown**, a URL pasted on selected text becomes a link; **Align table** (`Ctrl+Shift+T`); **Markdown syntax highlighting, line numbers and the current line** in the editor — and the same smart editing **in Preview mode** (new list items, list levels, table cells, splitting paragraphs, wrapping, smart paste). See [What's new in 0.2.0](#whats-new-in-020).
>
> **Fixed in 0.1.15:** escaped brackets such as `!\[\](images/…)` or `\[\[file\]\]` (typical after a Word import) are no longer taken for LaTeX display math — before, everything up to the next `\]` turned into a red formula error. See [What's new in 0.1.15](#whats-new-in-0115).
>
> **Fixed in 0.1.14:** importing Word no longer turns text like `<textarea>` or `&mdash;` into HTML (it could show up as a form field in the preview); inline code and code blocks survive a Markdown → Word → Markdown round trip (Word styles *Verbatim Char* / *Source Code*, as in Pandoc). See [What's new in 0.1.14](#whats-new-in-0114).
>
> **New in 0.1.13:** the editor catches up with the DOCXMD web app 1.5 — **interface in 4 languages** (follows VS Code's display language), **Outline** panel, **find & replace with regular expressions** (`$1`), match case and whole word, **synchronized scrolling**, **editing in the preview** (click text, ✎ / double-click a block), a **Document** menu (table of contents, numbered headings, footnote, caption, statistics, **HTML export**), six highlight colours; reliable sync with the VS Code document (no lost keystrokes, precise undo, `Ctrl+S` always saves the latest text). See [What's new in 0.1.13](#whats-new-in-0113).
>
> **New in 0.1.12:** pasted / dropped **images are saved to `images/image-001.png` next to the `.md`** (relative link instead of base64) and relative images now show in the preview and export to Word; **Clean up scientific notation** (`T _ { Core }`, `$R^2$`, `CO2`, `36.7°C` → T<sub>Core</sub>, R², CO₂, 36.7 °C) with a review list; **highlights** `==text==` / `==red:text==` (`Ctrl+Shift+H`); **YAML front matter → Word header, footer, page numbers and document properties**. See [What's new in 0.1.12](#whats-new-in-0112).
>
> **New in 0.1.11:** **resize images with the mouse** — hover an image in the preview and drag the handle at its corner; the width is written into the Markdown (`{width=60%}`) and carried into the exported `.docx`. Importing a `.docx` now keeps each picture's size from Word.
>
> **New in 0.1.10:** when the DeepL quota is used up (or the key is rejected) a dialog lets you **enter another API key** and the translation continues; new command **DOCXMD: Set DeepL API key**.
>
> **Fixed in 0.1.9:** translating a document asks for your DeepL API key again (0.1.7–0.1.8 showed *“Translate failed: Failed to fetch”* instead).
>
> **New in 0.1.8:** **footnotes**, **numbered figures & tables with cross-references**, **table of contents** and **numbered headings**; **callout blocks** `:::warning Title` and GitHub alerts `> [!NOTE]`, **x² / x₂** buttons (`Ctrl+.` / `Ctrl+,`), a **Ω symbols panel** (Greek, operators, arrows, indices, units; optional LaTeX), and **nicer tables** (numeric columns right-aligned, sticky header, zebra, `:::table-compact` / `:::table-full`). See [What's new in 0.1.8](#whats-new-in-018).
>
> **New in 0.1.7:** import Word (`.docx`) → Markdown with **table colours & alignment**, **colour boxes** `:::red … :::`, inline math `$…$`, superscript/subscript citations, coloured table cells and full-fidelity quotes in DOCX export. See [What's new in 0.1.7](#whats-new-in-017).

DOCXMD provides a dedicated Markdown editor with live preview, formatting tools, multiple themes, and direct Word document export.

![DOCXMD — Markdown source and live preview side by side](https://docxmd.pp.ua/help/img/overview.png)

## Screenshots

The extension's editor uses the same interface, themes and converter as the [DOCXMD web app](https://docxmd.pp.ua/); these screenshots come from its illustrated guide.

| | |
|---|---|
| ![Formatting toolbar](https://docxmd.pp.ua/help/img/toolbar.png) | ![Find highlights every match in the source and the preview](https://docxmd.pp.ua/help/img/find.png) |
| **Formatting toolbar** — bold, x² / x₂, Ω symbols, headings, callouts, lists, links, images, tables, alignment | **Find & replace** — every match highlighted in the source and the preview |
| ![Callout blocks](https://docxmd.pp.ua/help/img/callouts_en.png) | ![Colour boxes](https://docxmd.pp.ua/help/img/boxes_en.png) |
| **Callout blocks** `:::warning` / `> [!NOTE]` — kept as tinted boxes in Word | **Colour boxes** `:::red … :::` |
| ![Footnotes, numbered figures and tables, table of contents](https://docxmd.pp.ua/help/img/structure_en.png) | ![Styling Markdown with HTML](https://docxmd.pp.ua/help/img/styling.png) |
| **Footnotes, numbered figures & tables, cross-references, table of contents** | **HTML styling** — the source on the left, the result on the right |
| ![Translation dialog](https://docxmd.pp.ua/help/img/translate.png) | ![Themes and languages](https://docxmd.pp.ua/help/img/themes.png) |
| **Translate** into English · Українська · Español · 中文 | **4 themes · 4 interface languages** |

Companion to the [DOCXMD PWA](https://docxmd.pp.ua/). The web app remains fully independent; this extension includes local copies of its converter and required libraries in `media/`.

## Features

- Custom editor for `.md` and `.markdown` files — DOCXMD Editor is the default editor for these file types.
- **Smart editing** — `Enter` continues lists, quotes and table rows, `Tab` / `Shift+Tab` change list levels and move between table cells, `Alt+↑/↓` move lines, selected text is wrapped by `*` `=` `~` … — in the source **and in Preview mode**. See [Keyboard shortcuts](#keyboard-shortcuts).
- **Smart paste** — text copied from Word, Google Docs or a web page becomes Markdown; a URL pasted onto selected text becomes a link; `Ctrl+Shift+V` pastes plain text.
- **Markdown syntax highlighting, line numbers and the current line** in the editor (Document menu → Editor).
- **Align table** (`Ctrl+Shift+T`) — straight columns in the pipe table under the cursor.
- **Font, size and colour** (toolbar **Aa** / size / **A**) — selected text gets `<span style="font-size:14pt">…</span>` (a second choice updates the same span); nothing selected → the whole document via front matter `font:` / `font-size:`. Works in the source, the ✎ block editor and Preview mode; exported to Word as real run formatting and default font / size.
- Live preview with synchronized Markdown source and rendered document.
- Formatting toolbar for common Markdown editing operations.
- **Text & image alignment** (left / center / right / justify) — renders in the preview and is honoured on DOCX export.
- **Insert images** by pasting (`Ctrl+V`) or dragging a file onto the editor — saved to `images/` next to the document with a relative link (or embedded as a data-URI: setting `docxmd.pastedImages`, and always for untitled documents).
- **Clean up scientific notation** — MinerU/LaTeX leftovers, chemical formulas and units, reviewed in a list before anything changes.
- **Highlights** `==text==`, `==red:text==` — Word text highlighting in DOCX.
- **Front matter** — `header`, `footer`, `page-numbers`, `title`, `author` become a real Word header / footer, PAGE / NUMPAGES fields and document properties.
- **Find & replace** (`Ctrl+F`) with every match highlighted in both the source and the preview; regular expressions with `$1` groups, match case, whole word, **Replace** / **Replace all** (one `Ctrl+Z` undoes it).
- **Outline** panel (button at the left of the toolbar): all headings with their numbers, follows the scroll, click to jump.
- **Editing in the preview** (as in Typora): click a paragraph, heading, list item or table cell to edit its text in place; ✎, double-click or `Alt+click` edits the Markdown of a whole block.
- **Document menu**: table of contents `[TOC]`, numbered headings, footnote, figure / table caption, clean up notation, **statistics** (also a click on the word counter), **export to HTML** (formulas as MathML — no external files needed).
- **Interface in English, Українська, Español, 中文** — follows VS Code's display language.
- **Status bar** with live word / character / line / reading-time counts, a scroll-position indicator and quick navigation (start / end / click-to-jump).
- **LaTeX math** — inline `\(…\)` or `$…$` and display `\[…\]` / `$$…$$` formulas rendered with KaTeX (offline), and exported to Word as **native editable equations** (OMML).
- **Colour boxes** — wrap text or a quote in `:::red … :::` (or `:::green`, `:::#ff8800`, Ukrainian names like `:::червоний`) to give it a coloured bar in the preview and in Word.
- **Import Word (`.docx`) to Markdown** — keeps table cell fills, text colours and horizontal/vertical alignment, merged cells, superscripts/subscripts and images.
- **Styled tables** — HTML tables with inline `style` (background, colour, `text-align`, `vertical-align`, `colspan`/`rowspan`) export to Word with the same formatting.
- **Translate documents** into the interface languages (English · Українська · Español · 中文) with DeepL.
- **Help** button — opens the full illustrated guide in your browser.
- 4 themes for the editor and preview.
- Split / Source / Preview modes.
- Export to Word (`.docx`) — use the `DOCXMD: Export to Word (.docx)` command or the DOCX button.
- Import Word (`.docx`) — use the `DOCXMD: Import Word (.docx) to Markdown` command or the Explorer context menu on a `.docx` file.
- Two-way synchronization with the VS Code document — minimal edits, precise undo, no lost keystrokes.
- Synchronized scrolling of the source and the preview in Split mode.
- External file changes automatically refresh the editor.
- The built-in VS Code Markdown editor remains available through **Open With…** when needed.

## Keyboard shortcuts

On macOS use `Cmd` instead of `Ctrl`. Editing keys work in the Markdown source, in the ✎ block editor and — where noted — in the quick text edit of Preview mode.

| Keys | Action |
|---|---|
| `Ctrl+S` | Save the document (always the latest text) |
| `Ctrl+F` | Find & replace; `Enter` / `Shift+Enter` — next / previous match, `Ctrl+Enter` in the replace field — Replace all |
| `Alt+R` / `Alt+C` / `Alt+W` | In the find bar: regular expressions / match case / whole word |
| `Esc` | Close the find bar, a dialog or a menu |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo (VS Code's own undo stack, one step per edit) |
| `Ctrl+Shift+H` | Highlight the selection `==…==` |
| `Ctrl+.` / `Ctrl+,` | Superscript / subscript |
| `Enter` | Continue a list, task list, quote or table row; on an empty item — one level out / end the list. Preview: new list item, or split the paragraph |
| `Tab` / `Shift+Tab` | List item one level deeper / higher; next / previous table cell (a new row after the last one); indent / outdent selected lines; otherwise 4 spaces. Also in Preview |
| `Alt+↑` / `Alt+↓` | Move the current lines. Preview: move a list item, a table row or a whole block |
| `Shift+Alt+↑` / `Shift+Alt+↓` | Duplicate the current lines |
| `Ctrl+/` | Comment out / in with `<!-- -->` |
| `Ctrl+Shift+T` | Align the table under the cursor |
| `Ctrl+V` / `Ctrl+Shift+V` | Paste (images are saved to `images/`, formatted text becomes Markdown, a URL on selected text becomes a link) / paste plain text |
| `*` `_` `` ` `` `=` `~` `(` `[` `"` | With text selected: wrap it — `*…*`, `==…==`, `~~…~~`, `` `…` ``; another `*` makes it bold. In Preview also `Ctrl+B` / `Ctrl+I` |
| `Esc`, then `Tab` | Leave the editor with the keyboard (`Tab` is otherwise captured) |
| Click · ✎ / double-click / `Alt+click` | Preview: edit text in place · edit the Markdown of a whole block |
| `Shift+Enter` · `Ctrl+Enter` | Apply the quick edit · apply the block editor (`Esc` cancels) |

## Usage

### Open a Markdown file

Open any `.md` or `.markdown` file normally in VS Code. DOCXMD Editor is configured as the default editor, so a normal double-click opens the document in DOCXMD.

You can also right-click the file and select **Open With… → DOCXMD Editor**. To use the built-in VS Code Markdown editor instead, select it from **Open With…**.

### Edit Markdown

Edit the Markdown document directly in DOCXMD. Changes are synchronized with the underlying VS Code document and can be saved normally with:

- `Ctrl+S` on Windows/Linux
- `Cmd+S` on macOS

### Export to Word

Click **DOCX** in the editor toolbar, or open the Command Palette and run:

```
DOCXMD: Export to Word (.docx)
```

Choose the destination filename and save the generated Word document.

### Import Word (.docx)

Right-click a `.docx` file in the Explorer and choose **DOCXMD: Import Word (.docx) to Markdown**, or run the same command from the Command Palette. Pick where to save the new `.md`; it opens in DOCXMD with the converted content and is saved automatically.

Tables keep their look: cell fills, text colours and alignment (horizontal and vertical) are written as an HTML table with inline styles, because a Markdown pipe table cannot hold colours. Plain tables whose only formatting is per-column alignment stay pipe tables with `:-:` / `--:` markers. Quotes exported by DOCXMD come back as `>` quotes — or as `:::colour` boxes when their bar is coloured.

### Colour boxes

```markdown
:::red
> 1. **Core-Peripheral gradients:** one point is the core temperature.
:::

:::green
2. **Temperature range** — works without `>` too.
:::

:::#ff8800
> 3. **Statistical features:** mean and standard deviation.
:::
```

Names: `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`, `black` (and Ukrainian: `червоний`, `помаранчевий`, `жовтий`, `зелений`, `бірюзовий`, `синій`, `блакитний`, `фіолетовий`, `рожевий`, `сірий`, `чорний`), or any `#RRGGBB` / `#RGB`. A box around a `>` quote does not draw a second bar. An unknown name stays plain text. Plain `>` quotes use the accent colour of the current theme, in the preview and in the exported `.docx`.

### Find & replace

Press `Ctrl+F` (or the 🔍 button) to open the find bar. Type a query and press `Enter`; every match is highlighted — the current one in the accent colour, the rest in yellow — in the source and the preview. `Enter` / `Shift+Enter` move to the next / previous match. Toggle **.\*** (regular expression, `Alt+R`), **Aa** (match case, `Alt+C`) and **W** (whole word, `Alt+W`). In the replace field `Enter` replaces the current match, `Ctrl+Enter` replaces all; with regular expressions `$1`, `$<name>` and `$&` insert groups — e.g. find `T(Core|Periphery)`, replace `T<sub>$1</sub>`. Every replacement is undoable.

### Alignment & images

Use the alignment buttons in the toolbar to wrap the current block in `<div align="…">` (left / center / right / justify). Paste an image from the clipboard with `Ctrl+V`, or drag an image file onto the editor — it is written to `images/image-001.png` (the next free number) in the folder of the `.md` and a relative link `![…](images/image-001.png)` is inserted. Set `docxmd.pastedImages` to `embed` to keep the old behaviour (a base64 data-URI inside the text); untitled documents always embed.

### Clean up scientific notation

Run **DOCXMD: Clean up scientific notation** (or the flask button in the toolbar). Choose the output — `<sub>/<sup>` tags (recommended, real indices in Word) or Unicode ₂ ² — and review the proposed changes: identical changes are grouped (×N), untick what should stay. The rules: simple formulas `$T_{Core}$`, `$\Delta$`; MinerU index artefacts `T _ { Core }`, `R ^ { 2 }`, `R^2`; a dictionary (`CO2`, `SpO2`, `H2O`, `HbA1c`, `TCore`… — edit it in the `docxmd.notationDictionary` setting); a space between a number and its unit (`36.7°C` → `36.7 °C`). Code, `$$…$$`, links, URLs, HTML and front matter are never touched; complex formulas (`\frac`, roots, sums, nested indices) stay as they are. The whole clean-up is one edit — one `Ctrl+Z` restores the text.

### Highlights and front matter

`==important==` is highlighted in yellow; `==red:…==`, `==green:…==`, `==blue:…==`, `==pink:…==`, `==gray:…==` pick a colour (toolbar button or `Ctrl+Shift+H`). In Word they are real text highlights, and importing a `.docx` brings them back.

A YAML block at the very top of the file controls the Word document:

```yaml
---
title: Non-invasive biomarkers
author: KOLIBRI MEDICAL TECHNOLOGY
lang: en
header: KOLIBRI MEDICAL TECHNOLOGY — {title}
footer: Confidential • 2026
page-numbers: "Page {n} of {N}"
---
```

`header` / `footer` become the Word header and footer, `{n}` / `{N}` the PAGE / NUMPAGES fields (`page-numbers: true` prints just the number), `title` / `author` / `subject` / `keywords` the document properties, and `lang` the language of the "Figure / Table" words. The preview shows the block as a compact card. Importing a `.docx` turns its header, footer and page numbers back into front matter.

### LaTeX math

Formulas render live with **KaTeX** (bundled, works offline). Use inline `\(…\)` or `$…$` and display `\[…\]` or `$$…$$`, e.g. `\[ E = mc^2 \]`. For `$…$` the Pandoc rules apply: no space right after the opening `$` or before the closing one, and no digit right after it — so prices like "$5 and $10" stay plain text; write `\$` for a literal dollar.

### Translate

Pick a target language from the **🌐 Translate…** menu in the toolbar (English · Українська · Español · 中文). The translation preserves the Markdown structure, tables, links and code, and opens as a new untitled document.

Translation uses **DeepL** and requires your own API key. On first use you will be asked for it; it is stored in the `docxmd.deeplApiKey` setting and sent only to DeepL. If the key's monthly quota is used up (or the key is rejected), a dialog lets you enter another key and the translation continues; you can also run **DOCXMD: Set DeepL API key** at any time. Get a free key at <https://www.deepl.com/pro-api>.

### Help

Click the **?** button to open the full illustrated guide (screenshots, HTML-styling recipes, smart editing and all keyboard shortcuts) at <https://docxmd.pp.ua/?help=1> in your browser.

## What's new in 0.3.0

Shared with the DOCXMD web app 1.7 (new `media/textstyle.js`; updated `md2docx.js`, `docxfmt.js`, `mdedit.js`, `previewedit.js`):

- **Font, size, colour.** Three toolbar buttons: **Aa** — font (common Office / Windows fonts, “Default”), size — 8…72 pt, **A** — 20 colours, a custom colour, “Automatic”. With text selected (in the source, in the ✎ block editor, or in Preview mode — a quick edit or a plain selection inside a paragraph, list item or table cell, HTML tables included) only that text changes: `<span style="color:#C00000;font-size:14pt">…</span>`; choosing again updates the same span, “Default” / “Automatic” removes it. With nothing selected, font and size apply to the **whole document** — front matter `font: Georgia`, `font-size: 11pt`: the preview shows the body text in them (headings keep their size) and the Word export makes them the document's default font and size. Colour always needs a selection. Every change is one undoable edit.
- **Word export** understands `<span style="font-size / font-family / color">` and `<font>`, a table's `font-size`, `<colgroup>` column widths (fixed layout; pictures are scaled to their column) and `<div style="text-align:…">` inside cells.
- **Word import (DOCXMD: Import Word):**
  - **font sizes** — the size most paragraphs use becomes front matter `font-size:`; other sizes become `<span style="font-size:…pt">` (a cell or table written in one size carries it on `<td>` / `<table>`); headings keep their level's size;
  - **alignment** — centred / right-aligned paragraphs and pictures become `<div align="center">` around Markdown; in tables the cell (or a `<div style="text-align:center">` inside it) is centred;
  - **column widths** — Word's column grid becomes `<colgroup><col style="width:46%">…` on an HTML table with `table-layout:fixed`, so the preview and the export keep the proportions and **pictures never stick out of their column**;
  - the import pipeline is now one shared function (`DOCXFMT.toMarkdown`) — the extension and the web app convert identically.

## What's new in 0.2.1

- **Smart editing in Preview mode — complete.** The 0.2.0 package on the Marketplace was built before this part was finished; 0.2.1 contains it. In the quick text edit (click a paragraph, heading, list item or table cell): `Enter` in a list item adds a new item and keeps editing in it (`Enter` on an empty item ends the list), `Enter` in the middle of a paragraph splits it (no stray spaces left at the split); `Tab` / `Shift+Tab` change the list level or move to the next / previous table cell — empty cells and a new row included; `Alt+↑/↓` move a list item, a table row or a whole block (paragraph, heading, table) instead of merging paragraphs; `Ctrl+B` / `Ctrl+I` and `* _ ` = ~ ( [ "` format the selection; `Ctrl+/` comments out; `Ctrl+Shift+T` aligns the table; a URL pasted on selected text becomes a link and formatted text becomes Markdown. Each operation is one undoable edit. In the block editor (✎, double-click, `Alt+click`) all smart keys work as in the source.
- **Smart paste:** formatted text from Word or a web page keeps the spaces around links and bold / italic text; list and heading markers are normalised (`-   item` → `- item`).
- **Fix — nested task lists:** an ordinary list item that contains a nested task list (`2. text` followed by `   - [x] …`) lost its number or bullet in the preview. Word export was not affected.
- **Documentation:** a complete [Keyboard shortcuts](#keyboard-shortcuts) table; smart editing, smart paste, syntax highlighting and Align table in [Features](#features); the online guide (**?** button) has new sections *Smart editing* and *Highlighting & line numbers* and an updated shortcuts table in all four languages. Code examples in this README are no longer turned into GitHub links on the Marketplace page.

## What's new in 0.2.0

Shared with the DOCXMD web app 1.6 (`media/mdedit.js`, `media/mdhighlight.js`):

- **Smart editing:** `Enter` continues bullet, numbered and task lists (`3.` → `4.`, `- [x]` → `- [ ]`), quotes and table rows; `Enter` on an empty item moves it out one level or ends the list. `Tab` / `Shift+Tab` change the level of list items (a numbered item moved in starts at 1), move between table cells (after the last cell a new row is added) and indent / outdent selected lines. `Alt+↑/↓` move the current lines, `Shift+Alt+↑/↓` duplicate them, `Ctrl+/` wraps them in `<!-- -->` (and back). Typing `*`, `_`, `` ` ``, `=`, `~`, `(`, `[` or `"` with text selected wraps it (`=` → `==highlight==`, `~` → `~~strike~~`). `Esc`, then `Tab` still leaves the editor.
- **Paste:** formatted text from Word, Google Docs or a web page becomes Markdown (headings, lists, tables, bold / italic, links); a URL pasted onto selected text becomes `[text](url)`; `Ctrl+Shift+V` pastes plain text. Can be switched off in the Document menu.
- **Align table** (`Ctrl+Shift+T` or Document menu): pads the pipe table under the cursor into straight columns, keeping `:--:` alignment.
- **Smart editing in Preview mode.** In the block editor (✎, double-click, `Alt+click`) everything above works as in the source. In the quick text edit (click a paragraph, heading, list item or table cell): `Enter` in a list item adds a new item and continues editing in it (`Enter` on an empty item ends the list), `Enter` in the middle of a paragraph splits it; `Tab` / `Shift+Tab` change the list level or move to the next / previous table cell — empty cells and a new row included; `Alt+↑/↓` move a list item, a table row or a whole block (paragraph, heading, table); `Ctrl+B` / `Ctrl+I` and `* _ ` = ~ ( [ "` turn the selected text into real formatting; `Ctrl+/` comments out; `Ctrl+Shift+T` aligns the table; a URL pasted on selected text becomes a link and formatted text becomes Markdown. What you typed and the operation land in the source as one undoable edit.
- **Syntax highlighting** of Markdown in the editor (headings, emphasis, code, formulas, links, lists, tables, callout fences, HTML, footnotes), **line numbers** and the **current line** — switches in the Document menu. Only colours are used, so the text layout never shifts; rendering is incremental, so long documents stay fast.

## What's new in 0.1.15

- **Display math only where it can be display math:** `\[ … \]` and `$$ … $$` start a formula block only at the start of a line, never span a blank line, and `\]` must end its line. Markdown-escaped brackets in the middle of text — `!\[\](images/…)`, `\[\[file#section\]\]`, `\[1\] Reference` — stay text (they used to swallow the following paragraphs, headings and tables into one red KaTeX error).
- `$$…$$` in the middle of a sentence is shown as a displayed formula without breaking the paragraph.
- The same rules apply to Word export, translation (escaped brackets are translated as normal text) and *Clean up scientific notation*.

## What's new in 0.1.14

- **Word import keeps text as text:** `<tag>`-like text and `&entities;` typed in a Word document are escaped in the Markdown, so the preview no longer renders them as HTML (e.g. `<textarea>` appeared as an input box).
- **Code survives the round trip:** DOCX export marks inline code with the character style *Verbatim Char* and code blocks with the paragraph style *Source Code* (Pandoc's names); import turns them back into `` `code` `` and fenced blocks. Documents from Pandoc import the same way.
- Documents exported by 0.1.13 and earlier have no code styles — their code comes back as plain (now correctly escaped) text.

## What's new in 0.1.13

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

## What's new in 0.1.12

- **Images next to the document:** pasting (`Ctrl+V`) or dropping an image writes it to `images/image-001.png` (next free number) in the `.md`'s folder and inserts a relative link instead of base64. Setting `docxmd.pastedImages` = `folder` (default) | `embed`; untitled documents embed.
- **Relative images work:** `![](images/pic.png)` and `<img src="…">` with relative paths now display in the preview (the document's folder and the workspace are readable by the webview) and are embedded in the exported `.docx`.
- **DOCXMD: Clean up scientific notation** — a new command and toolbar button; review list (QuickPick) with grouped changes, one undoable edit; dictionary in the `docxmd.notationDictionary` setting. Shares its rules (`media/sciclean.js`) with the web app.
- **Highlights** `==text==` / `==red:text==` (toolbar button, `Ctrl+Shift+H`) → Word highlighting; imported back from `.docx`.
- **YAML front matter** → Word header / footer, PAGE / NUMPAGES page numbers (`page-numbers: "Page {n} of {N}"`), document properties; `lang:` sets the caption words. Shown as a card in the preview; `.docx` import restores it. Translation keeps the keys and translates only title / header / footer values.
- Exporting data-URI images no longer depends on the webview's fetch policy (`connect-src` added to the CSP).

## What's new in 0.1.11

- **Image size, live:** hover an image in the preview and drag the handle at its bottom-right corner — the image resizes as you drag, and on release the width is written into the source: `![](pic.png){width=60%}` (or `width="…"` on an HTML `<img>`). Double-click the handle for the original size; with the handle focused, `←`/`→` step by 5 %. Edits are ordinary undoable text edits.
- **Width syntax for every image:** `{width=50%}`, `{width=300px}`, `{width=8cm}` / `mm` / `in` work on any image, not only numbered figures. `%` is a share of the text column; images inside tables use px.
- **DOCX export honours the width** of `![](…){width=…}`, figures and HTML `<img width="…">` / `style="width:…"` (HTML images were previously exported at natural size or dropped).
- **DOCX import keeps picture sizes** from Word: body images get `{width=NN%}`, images in tables get px.
- **Table of contents links work:** clicking an entry of a Word TOC imported from `.docx` (or any `[text](#anchor)` link — GitHub-style `#my-heading` slugs included) scrolls to the heading. Import now writes exact anchors (`{#sec:…}` / `id="sec:…"`, also for headings inside tables); links in older imported files are matched to headings by their text. In the exported `.docx` these links are internal links to bookmarks.

## What's new in 0.1.10

- **DeepL quota / invalid key:** instead of *“Translate failed: DeepL 456: Quota exceeded”* a dialog explains the problem and offers **Enter another key** (the translation is retried with it and the key is saved), **Open Settings** or **DeepL account** (usage page). The same dialog appears when DeepL rejects the key (HTTP 401/403).
- **New command:** `DOCXMD: Set DeepL API key` — replace the saved key at any time.
- A key changed in *Settings → docxmd.deeplApiKey* is used immediately (no reload needed).

## What's new in 0.1.9

- **Fix — translation:** choosing a language in **🌐 Translate…** again opens the prompt for your DeepL API key (and then translates through the extension host). In 0.1.7–0.1.8 the webview tried to call DeepL directly and failed with *“Translate failed: Failed to fetch”*. If you close the prompt without a key, a single warning offers **Get a free key** / **Open Settings**.

## What's new in 0.1.8

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

## What's new in 0.1.7

- **Import Word (`.docx`) → Markdown** — new command and Explorer context-menu entry; table fills, text colours, alignment and merged cells are preserved.
- **Colour boxes** `:::colour … :::` — coloured quote bars in the preview and in DOCX export.
- **Quote bar colour** — plain quotes export with the current theme's accent colour instead of grey.
- **Inline math `$…$`** in the preview and in DOCX.
- **DOCX export fidelity:** `<sup>`/`<sub>` (e.g. citation numbers) become real Word superscript/subscript; quotes that contain lists, code, tables or nested quotes export completely; styled HTML tables keep their colours and alignment; numbered lists keep their start number (`3.` stays 3).
- Translation keeps `:::` fences untouched.

## Editor Modes

DOCXMD supports three editor modes:

- **Split** — Markdown source and live preview side by side.
- **Source** — Markdown source only.
- **Preview** — rendered document only.

## Themes

The editor includes four built-in visual themes for the editing and preview environment.

## Markdown Rendering

DOCXMD uses local copies of its Markdown rendering, syntax highlighting, sanitization, and document-conversion libraries bundled with the extension. The required libraries are included in the extension package and are loaded locally from the `media/` directory.

## Privacy

The extension is designed to perform Markdown editing, preview rendering, `.docx` generation and `.docx` import locally inside VS Code. The DOCXMD PWA does not need to be running for the extension to edit Markdown files or generate Word documents.

The only feature that uses the network is **translation**: when you translate a document, its text is sent to the DeepL API using your own API key. Nothing else leaves your machine. The **Help** button opens the online guide in your browser.

## Development

To run the extension from source:

1. Clone the repository.
2. Open the project folder in VS Code.
3. Press `F5` to launch the Extension Development Host.
4. Open a `.md` or `.markdown` file.
5. DOCXMD Editor will be used as the default editor for the Markdown file.

## Repository

Source code: https://github.com/bioluch/docxmd-vscode

## Documentation

See `DOCXMD_DOCS/integrity_DOCXMD_VSCode.md` for the full integration and integrity documentation.

## Companion Application

DOCXMD PWA: https://docxmd.pp.ua
