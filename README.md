# DOCXMD for VS Code

Edit Markdown with a live neumorphic preview and export to Word (**.docx**) — inside VS Code.
Companion to the DOCXMD PWA (https://docxmd.pp.ua). The web app remains fully independent;
this extension only reuses copies of its converter/libraries in `media/`.

## Features
- **Custom editor** for `.md` / `.markdown` (opened on demand via *Open With… → DOCXMD Editor*; it does not replace the built-in Markdown editor).
- Live preview, formatting toolbar, 4 themes, split / source / preview modes.
- **Export to Word (.docx)** — command `DOCXMD: Export to Word (.docx)` or the DOCX button; reuses `md2docx.js`.
- Two-way sync with the VS Code document (edits go into the real file; external edits refresh the preview).

## Usage
1. Right-click a `.md` in the Explorer → **DOCXMD: Open in DOCXMD Editor** (or Command Palette → *DOCXMD: Open*).
2. Edit; the file is saved by VS Code as usual (Ctrl/Cmd+S).
3. Click **DOCX** (or run *DOCXMD: Export to Word (.docx)*) → choose where to save.

## Develop / run
Open this folder in VS Code and press **F5** (Extension Development Host).

See `DOCXMD_DOCS/integrity_DOCXMD_VSCode.md` for the full integration guide.
