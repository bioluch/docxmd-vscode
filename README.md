# DOCXMD for VS Code

Edit Markdown with a live neumorphic preview, export to Word (`.docx`) and import Word back to Markdown — directly inside VS Code.

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

Translation uses **DeepL** and requires your own API key. On first use you will be asked for it; it is stored in the `docxmd.deeplApiKey` setting and sent only to DeepL. Get a free key at <https://www.deepl.com/pro-api>.

### Help

Click the **?** button to open the full illustrated guide (screenshots and HTML-styling recipes) at <https://docxmd.pp.ua/?help=1> in your browser.

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
