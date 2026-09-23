# DOCXMD for VS Code

Edit Markdown with a live neumorphic preview, export to Word (`.docx`) and import Word back to Markdown — directly inside VS Code.

> **New in 0.1.10:** when the DeepL quota is used up (or the key is rejected) a dialog lets you **enter another API key** and the translation continues; new command **DOCXMD: Set DeepL API key**.
>
> **Fixed in 0.1.9:** translating a document asks for your DeepL API key again (0.1.7–0.1.8 showed *“Translate failed: Failed to fetch”* instead).
>
> **New in 0.1.8:** **footnotes**, **numbered figures & tables with cross-references**, **table of contents** and **numbered headings**; **callout blocks** `:::warning Title` and GitHub alerts `> [!NOTE]`, **x² / x₂** buttons (`Ctrl+.` / `Ctrl+,`), a **Ω symbols panel** (Greek, operators, arrows, indices, units; optional LaTeX), and **nicer tables** (numeric columns right-aligned, sticky header, zebra, `:::table-compact` / `:::table-full`). See [What's new in 0.1.8](#whats-new-in-018).
>
> **New in 0.1.7:** import Word (`.docx`) → Markdown with **table colours & alignment**, **colour boxes** `:::red … :::`, inline math `$…$`, superscript/subscript citations, coloured table cells and full-fidelity quotes in DOCX export. See [What's new in 0.1.7](#whats-new-in-017).

DOCXMD provides a dedicated Markdown editor with live preview, formatting tools, multiple themes, and direct Word document export.

Companion to the [DOCXMD PWA](https://docxmd.pp.ua/). The web app remains fully independent; this extension includes local copies of its converter and required libraries in `media/`.

## Features

- Custom editor for `.md` and `.markdown` files — DOCXMD Editor is the default editor for these file types.
- Live preview with synchronized Markdown source and rendered document.
- Formatting toolbar for common Markdown editing operations.
- **Text & image alignment** (left / center / right / justify) — renders in the preview and is honoured on DOCX export.
- **Insert images** by pasting (`Ctrl+V`) or dragging a file onto the editor — embedded inline as a data-URI.
- **Find & replace** (`Ctrl+F`) with every match highlighted in both the source and the preview.
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
- Two-way synchronization with the VS Code document.
- External file changes automatically refresh the editor.
- The built-in VS Code Markdown editor remains available through **Open With…** when needed.

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

Press `Ctrl+F` (or the 🔍 button) to open the find bar. Type a query and press `Enter`; every match is highlighted — the current one in the accent colour, the rest in yellow — in the source and the preview. `Enter` / `Shift+Enter` move to the next / previous match. Use the second field and **Replace all** to replace.

### Alignment & images

Use the alignment buttons in the toolbar to wrap the current block in `<div align="…">` (left / center / right / justify). Paste an image from the clipboard with `Ctrl+V`, or drag an image file onto the editor — it is embedded inline as a data-URI, so the document stays self-contained.

### LaTeX math

Formulas render live with **KaTeX** (bundled, works offline). Use inline `\(…\)` or `$…$` and display `\[…\]` or `$$…$$`, e.g. `\[ E = mc^2 \]`. For `$…$` the Pandoc rules apply: no space right after the opening `$` or before the closing one, and no digit right after it — so prices like "$5 and $10" stay plain text; write `\$` for a literal dollar.

### Translate

Pick a target language from the **🌐 Translate…** menu in the toolbar (English · Українська · Español · 中文). The translation preserves the Markdown structure, tables, links and code, and opens as a new untitled document.

Translation uses **DeepL** and requires your own API key. On first use you will be asked for it; it is stored in the `docxmd.deeplApiKey` setting and sent only to DeepL. If the key's monthly quota is used up (or the key is rejected), a dialog lets you enter another key and the translation continues; you can also run **DOCXMD: Set DeepL API key** at any time. Get a free key at <https://www.deepl.com/pro-api>.

### Help

Click the **?** button to open the full illustrated guide (screenshots and HTML-styling recipes) at <https://docxmd.pp.ua/?help=1> in your browser.

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
