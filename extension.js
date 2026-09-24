// DOCXMD — VS Code extension host
// Custom text editor for Markdown with live preview + export to .docx.
// Reuses the app's md2docx.js / marked / docx inside the webview.
"use strict";
const vscode = require("vscode");
const path = require("path");
const https = require("https");

const VIEW_TYPE = "docxmd.editor";
// Notation clean-up rules — the same module as the web app (media/sciclean.js)
const SciClean = require("./media/sciclean.js").DOCXMDSciClean;
let activeDocument = null;      // the document of the DOCXMD editor in focus

// ---- pasted / dropped images → <folder of the .md>/images/image-001.png ----
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" };
async function saveImageNextTo(document, dataBase64, mime, name) {
  if (document.uri.scheme !== "file" && document.uri.scheme !== "vscode-remote") return null;   // untitled → embed
  const mode = vscode.workspace.getConfiguration("docxmd").get("pastedImages", "folder");
  if (mode === "embed") return null;
  const docDir = vscode.Uri.joinPath(document.uri, "..");
  const imgDir = vscode.Uri.joinPath(docDir, "images");
  await vscode.workspace.fs.createDirectory(imgDir);
  let taken = new Set();
  try { taken = new Set((await vscode.workspace.fs.readDirectory(imgDir)).map(([n]) => n.toLowerCase())); } catch (e) {}
  const ext = IMG_EXT[mime] || (String(name || "").split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  let n = 1, file;
  do { file = "image-" + String(n++).padStart(3, "0") + "." + ext; } while (taken.has(file));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(imgDir, file), new Uint8Array(Buffer.from(String(dataBase64), "base64")));
  return "images/" + file;
}

// ---- DOCXMD: Clean up scientific notation (QuickPick review, one undoable edit) ----
async function cleanNotation() {
  const doc = activeDocument || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
  if (!doc || !/\.(md|markdown)$/i.test(doc.fileName || "") && doc.languageId !== "markdown") {
    vscode.window.showInformationMessage("Open a Markdown document first."); return;
  }
  const text = doc.getText();
  const fmt = await vscode.window.showQuickPick([
    { label: "<sub> / <sup> tags", description: "recommended — real indices in Word", value: "html" },
    { label: "Unicode ₂ ²", description: "where Unicode has the character; otherwise tags", value: "unicode" }
  ], { title: "DOCXMD: Clean up scientific notation — indices as", ignoreFocusOut: true });
  if (!fmt) return;
  const cfg = vscode.workspace.getConfiguration("docxmd");
  const res = SciClean.scan(text, { format: fmt.value, dict: cfg.get("notationDictionary") || SciClean.DEFAULT_DICT });
  const groups = new Map();
  res.changes.forEach((c) => {
    const k = c.rule + "\u0000" + c.from + "\u0000" + c.to;
    if (!groups.has(k)) groups.set(k, { rule: c.rule, from: c.from, to: c.to, items: [] });
    groups.get(k).items.push(c);
  });
  const RULE = { math: "formula $…$", script: "index _{} ^{}", dict: "dictionary", units: "units" };
  const items = Array.from(groups.values()).map((g) => ({
    label: g.from.replace(/\n/g, " ") + "  →  " + g.to.replace(/\u00A0/g, "·"),
    description: RULE[g.rule] + (g.items.length > 1 ? "  ×" + g.items.length : ""),
    detail: "line " + (doc.positionAt(g.items[0].start).line + 1), picked: true, g
  }));
  if (!items.length) {
    vscode.window.showInformationMessage("Nothing to clean up." + (res.skipped ? " " + res.skipped + " complex formulas are left unchanged." : "")); return;
  }
  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true, ignoreFocusOut: true, matchOnDescription: true,
    title: "DOCXMD: Clean up scientific notation — " + res.changes.length + " changes" + (res.skipped ? " (" + res.skipped + " complex formulas left unchanged)" : ""),
    placeHolder: "Untick what should stay as it is, then press Enter"
  });
  if (!chosen || !chosen.length) return;
  if (doc.getText() !== text) { vscode.window.showWarningMessage("The document changed — run the command again."); return; }
  const list = chosen.flatMap((it) => it.g.items).sort((a, b) => a.start - b.start);
  const edit = new vscode.WorkspaceEdit();
  let last = -1;
  list.forEach((c) => { if (c.start < last) return; edit.replace(doc.uri, new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end)), SciClean.insertText(c)); last = c.end; });
  await vscode.workspace.applyEdit(edit);
  vscode.window.showInformationMessage("Applied " + list.length + " changes. Undo (Ctrl+Z) restores the text.");
}

// ---- DeepL translation (performed in the host; the webview can't reach DeepL) ----
let _deeplKey = null;
const KEY_PLACEHOLDER = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx";
async function saveDeeplKey(k) {
  _deeplKey = k;
  try { await vscode.workspace.getConfiguration("docxmd").update("deeplApiKey", k, vscode.ConfigurationTarget.Global); } catch (e) {}
}
async function getDeeplKey() {
  // Settings are the source of truth, so a key changed there is used right away.
  const cfg = vscode.workspace.getConfiguration("docxmd").get("deeplApiKey");
  if (cfg && String(cfg).trim()) { _deeplKey = String(cfg).trim(); return _deeplKey; }
  if (_deeplKey) return _deeplKey;
  const k = await vscode.window.showInputBox({
    prompt: "Enter your DeepL API key (saved to settings: docxmd.deeplApiKey)",
    password: true, ignoreFocusOut: true, placeHolder: KEY_PLACEHOLDER
  });
  if (k && k.trim()) { await saveDeeplKey(k.trim()); return _deeplKey; }
  return null;
}
// Quota exhausted (456) or key rejected (401/403): explain, and let the user enter
// another key — the translation is then retried with it. One prompt at a time.
let _keyPrompt = null;
function askForAnotherKey(status) {
  if (_keyPrompt) return _keyPrompt;
  _keyPrompt = (async () => {
    const why = status === 456
      ? "DeepL: the monthly character quota of this API key is used up (HTTP 456)."
      : "DeepL rejected this API key (HTTP " + status + ") — it is invalid, disabled or for another account.";
    const pick = await vscode.window.showWarningMessage(why,
      { modal: true, detail: "Enter another DeepL API key to continue translating. It replaces the saved key (setting docxmd.deeplApiKey). Free keys end with “:fx”." },
      "Enter another key", "Open Settings", "DeepL account");
    if (pick === "Enter another key") {
      const k = await vscode.window.showInputBox({
        prompt: "New DeepL API key (replaces the saved one)", password: true, ignoreFocusOut: true, placeHolder: KEY_PLACEHOLDER,
        validateInput: (v) => (v && v.trim() ? null : "Paste a DeepL API key")
      });
      if (k && k.trim()) { await saveDeeplKey(k.trim()); return _deeplKey; }
    } else if (pick === "Open Settings") {
      vscode.commands.executeCommand("workbench.action.openSettings", "docxmd.deeplApiKey");
    } else if (pick === "DeepL account") {
      vscode.env.openExternal(vscode.Uri.parse("https://www.deepl.com/your-account/usage"));
    }
    return null;
  })();
  return _keyPrompt.finally(() => { _keyPrompt = null; });
}
function deeplRequest(texts, target, source, key) {
  return new Promise((resolve, reject) => {
    const host = /:fx$/.test(key) ? "api-free.deepl.com" : "api.deepl.com";
    const body = { text: texts, target_lang: target };
    if (source) body.source_lang = source;
    const payload = JSON.stringify(body);
    const req = https.request({
      host: host, path: "/v2/translate", method: "POST",
      headers: { "Authorization": "DeepL-Auth-Key " + key, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, (res) => {
      let d = ""; res.on("data", (c) => d += c); res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve((JSON.parse(d).translations || []).map((t) => t.text)); }
          catch (e) { reject(new Error("Bad DeepL response")); }
        } else {
          let m = String(res.statusCode); try { m = JSON.parse(d).message || m; } catch (e) {}
          const err = new Error("DeepL " + res.statusCode + ": " + m); err.status = res.statusCode; reject(err);
        }
      });
    });
    req.on("error", reject); req.write(payload); req.end();
  });
}
let activePanel = null; // the most recently focused DOCXMD editor panel (for the export command)
// .docx files waiting to be converted by the webview of their target .md (uri → base64)
const pendingImports = new Map();

// Word → Markdown: pick a .docx, choose the .md to create, then let the DOCXMD
// webview convert it (mammoth + table formatting + turndown, as in the PWA).
async function importDocx(uri) {
  try {
    let src = uri;
    if (!src) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { "Word document": ["docx"] }, openLabel: "Import to Markdown" });
      if (!picked || !picked.length) return;
      src = picked[0];
    }
    const bytes = await vscode.workspace.fs.readFile(src);
    const target = await vscode.window.showSaveDialog({
      defaultUri: src.with({ path: src.path.replace(/\.docx$/i, "") + ".md" }),
      filters: { "Markdown": ["md"] }, saveLabel: "Create Markdown"
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new Uint8Array(0));
    pendingImports.set(target.toString(), Buffer.from(bytes).toString("base64"));
    await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
  } catch (e) {
    vscode.window.showErrorMessage("DOCXMD import failed: " + e.message);
  }
}

function activate(context) {
  const provider = new DocxmdEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    })
  );

  // Open a .md with the DOCXMD editor (explorer context / palette)
  context.subscriptions.push(
    vscode.commands.registerCommand("docxmd.openWith", (uri) => {
      const target = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (target) vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
      else vscode.window.showInformationMessage("Open a Markdown file first.");
    })
  );

  // Enter / replace the DeepL API key at any time (e.g. after the quota is used up)
  context.subscriptions.push(vscode.commands.registerCommand("docxmd.setDeeplKey", async () => {
    const k = await vscode.window.showInputBox({
      prompt: "DeepL API key for DOCXMD translation (saved to settings: docxmd.deeplApiKey)", password: true, ignoreFocusOut: true,
      placeHolder: KEY_PLACEHOLDER, validateInput: (v) => (v && v.trim() ? null : "Paste a DeepL API key")
    });
    if (k && k.trim()) { await saveDeeplKey(k.trim()); vscode.window.showInformationMessage("DeepL API key saved."); }
  }));

  // Import a Word document as Markdown (palette / explorer context on .docx)
  context.subscriptions.push(vscode.commands.registerCommand("docxmd.importDocx", (uri) => importDocx(uri)));
  context.subscriptions.push(vscode.commands.registerCommand("docxmd.cleanNotation", () => cleanNotation()));

  // Ask the active DOCXMD editor to export to .docx
  context.subscriptions.push(
    vscode.commands.registerCommand("docxmd.exportDocx", () => {
      if (activePanel) activePanel.webview.postMessage({ type: "requestExport" });
      else vscode.window.showInformationMessage('Open a Markdown file with "DOCXMD: Open in DOCXMD Editor" first.');
    })
  );
}

class DocxmdEditorProvider {
  constructor(context) { this.context = context; }

  resolveCustomTextEditor(document, webviewPanel) {
    const webview = webviewPanel.webview;
    // the document's folder (and the workspace) can be read by the preview: relative images
    const docDir = vscode.Uri.joinPath(document.uri, "..");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media"), docDir]
        .concat((vscode.workspace.workspaceFolders || []).map((f) => f.uri))
    };
    webview.html = this._html(webview);
    const docBase = document.uri.scheme === "untitled" ? "" : webview.asWebviewUri(docDir).toString().replace(/\/?$/, "/");

    activePanel = webviewPanel;
    activeDocument = document;
    let fromWebview = false;

    const postUpdate = () => webview.postMessage({ type: "update", text: document.getText(), base: docBase });

    const applyEdit = (text) => {
      if (text === document.getText()) return;
      const edit = new vscode.WorkspaceEdit();
      const full = new vscode.Range(0, 0, document.lineCount, 0);
      edit.replace(document.uri, full, text);
      fromWebview = true;
      return vscode.workspace.applyEdit(edit).then(() => { fromWebview = false; });
    };

    const saveDocx = async (dataBase64, suggested) => {
      try {
        const bytes = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ""), "base64");
        const base = document.uri.path.replace(/\.(md|markdown)$/i, "");
        const defaultUri = document.uri.with({ path: base + ".docx" });
        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { "Word document": ["docx"] }
        });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, new Uint8Array(bytes));
        const open = await vscode.window.showInformationMessage(
          "Exported " + path.basename(target.fsPath), "Reveal"
        );
        if (open === "Reveal") vscode.commands.executeCommand("revealFileInOS", target);
      } catch (e) {
        vscode.window.showErrorMessage("DOCXMD export failed: " + e.message);
      }
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && !fromWebview) postUpdate();
    });

    const viewSub = webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) { activePanel = webviewPanel; activeDocument = document; }
    });

    webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.type === "ready") {
        postUpdate();
        const key = document.uri.toString();
        if (pendingImports.has(key)) {
          webview.postMessage({ type: "importDocx", dataBase64: pendingImports.get(key) });
          pendingImports.delete(key);
        }
      }
      else if (msg.type === "imported") {
        Promise.resolve(applyEdit(String(msg.text || ""))).then(() => document.save()).then(() =>
          vscode.window.showInformationMessage("Imported Word document → " + path.basename(document.uri.fsPath)));
      }
      else if (msg.type === "edit") applyEdit(msg.text);
      else if (msg.type === "saveDocx") saveDocx(msg.dataBase64, msg.name);
      else if (msg.type === "info") vscode.window.showInformationMessage(msg.text);
      else if (msg.type === "saveImage") {
        saveImageNextTo(document, msg.dataBase64, msg.mime, msg.name)
          .then((p) => webview.postMessage({ type: "imageSaved", id: msg.id, path: p }))
          .catch((e) => { webview.postMessage({ type: "imageSaved", id: msg.id, path: null }); vscode.window.showWarningMessage("Could not save the image next to the document (" + e.message + ") — it was embedded instead."); });
      }
      else if (msg.type === "cleanNotation") cleanNotation();
      else if (msg.type === "error") vscode.window.showErrorMessage(msg.text);
      else if (msg.type === "openExternal" && /^https:\/\//.test(msg.url || "")) vscode.env.openExternal(vscode.Uri.parse(msg.url));
      else if (msg.type === "deepl") {
        (async () => {
          try {
            const key = await getDeeplKey();
            if (!key) {
              webview.postMessage({ type: "deeplResult", id: msg.id, error: "No DeepL API key set." });
              vscode.window.showWarningMessage(
                "DOCXMD translation needs a DeepL API key (the on-device translator is not available in VS Code).",
                "Get a free key", "Open Settings"
              ).then((sel) => {
                if (sel === "Get a free key") vscode.env.openExternal(vscode.Uri.parse("https://www.deepl.com/pro-api"));
                else if (sel === "Open Settings") vscode.commands.executeCommand("workbench.action.openSettings", "docxmd.deeplApiKey");
              });
              return;
            }
            let useKey = key, translations = null;
            for (let attempt = 0; ; attempt++) {
              try { translations = await deeplRequest(msg.text, msg.target, msg.source, useKey); break; }
              catch (e) {
                const st = e && e.status;
                if (!(st === 456 || st === 401 || st === 403) || attempt >= 3) throw e;
                if (useKey !== _deeplKey && _deeplKey) { useKey = _deeplKey; continue; } // another chunk already got a new key
                const next = await askForAnotherKey(st);
                // cancelled: the webview stays quiet (the dialog already explained it)
                if (!next) { webview.postMessage({ type: "deeplResult", id: msg.id, error: "No DeepL API key set (" + st + ")." }); return; }
                useKey = next;
              }
            }
            webview.postMessage({ type: "deeplResult", id: msg.id, translations: translations });
          } catch (e) {
            webview.postMessage({ type: "deeplResult", id: msg.id, error: String(e && e.message || e) });
          }
        })();
      }
      else if (msg.type === "openTranslated") {
        (async () => {
          try {
            const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: String(msg.text || "") });
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.window.showInformationMessage("Translated to " + String(msg.lang || "").toUpperCase() + " — review and save the new document. Use “DOCXMD: Open in DOCXMD Editor” for the live preview.");
          } catch (e) { vscode.window.showErrorMessage("Open translated failed: " + e.message); }
        })();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      viewSub.dispose();
      if (activePanel === webviewPanel) { activePanel = null; activeDocument = null; }
    });
  }

  _uri(webview, ...p) {
    return webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", ...p));
  }

  _html(webview) {
    const csp = webview.cspSource;
    const v = (...p) => this._uri(webview, ...p);
    return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https: data: blob:; connect-src ${csp} https: data: blob:; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src ${csp} 'unsafe-eval';">
<link rel="stylesheet" href="${v("themes.css")}" />
<link id="hljsLight" rel="stylesheet" href="${v("vendor", "hljs-github.css")}" disabled />
<link id="hljsDark" rel="stylesheet" href="${v("vendor", "hljs-github-dark.css")}" />
<link rel="stylesheet" href="${v("vendor", "katex.min.css")}" />
<link rel="stylesheet" href="${v("webview.css")}" />
</head>
<body>
  <div class="bar">
    <div class="tools" id="toolbar">
      <button class="tb" data-cmd="bold"><b>B</b></button>
      <button class="tb" data-cmd="italic"><i>I</i></button>
      <button class="tb" data-cmd="strike"><s>S</s></button>
      <button class="tb" data-cmd="sup" title="Superscript (Ctrl+.)">x<sup>2</sup></button>
      <button class="tb" data-cmd="sub" title="Subscript (Ctrl+,)">x<sub>2</sub></button>
      <button class="tb" data-cmd="highlight" title="Highlight ==text== (Ctrl+Shift+H)"><span style="background:#fff176;color:#1a1a1a;padding:0 .2em;border-radius:3px;font-weight:700;font-size:.8rem">ab</span></button>
      <button class="tb" data-cmd="symbols" title="Symbols">&Omega;</button>
      <button class="tb" data-cmd="cleanNotation" title="Clean up scientific notation (indices, formulas, units)"><svg viewBox="0 0 24 24"><path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.2A1.8 1.8 0 0 0 6.1 21h11.8a1.8 1.8 0 0 0 1.5-2.8L14 9.5V3"/><path d="M7.5 14h9"/></svg></button>
      <span class="sep"></span>
      <button class="tb" data-cmd="h1">H1</button>
      <button class="tb" data-cmd="h2">H2</button>
      <button class="tb" data-cmd="h3">H3</button>
      <span class="sep"></span>
      <button class="tb" data-cmd="quote">&#8220;</button>
      <button class="tb" data-cmd="callout" title="Callout block"><svg viewBox="0 0 24 24"><path d="M4 4h16v12H9l-5 4z"/><line x1="12" y1="8" x2="12" y2="10.5"/><line x1="12" y1="13" x2="12.01" y2="13"/></svg></button>
      <button class="tb" data-cmd="code">&lt;/&gt;</button>
      <button class="tb" data-cmd="ul">&#8226;</button>
      <button class="tb" data-cmd="ol">1.</button>
      <button class="tb" data-cmd="task">&#10003;</button>
      <button class="tb" data-cmd="link">🔗</button>
      <button class="tb" data-cmd="table">▦</button>
      <span class="sep"></span>
      <button class="tb" data-cmd="alignLeft" title="Align left"><svg viewBox="0 0 24 24"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg></button>
      <button class="tb" data-cmd="alignCenter" title="Align center"><svg viewBox="0 0 24 24"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg></button>
      <button class="tb" data-cmd="alignRight" title="Align right"><svg viewBox="0 0 24 24"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg></button>
      <button class="tb" data-cmd="alignJustify" title="Justify"><svg viewBox="0 0 24 24"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg></button>
    </div>
    <span class="spacer"></span>
    <button class="tb" id="findBtn" title="Find & replace (Ctrl+F)"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
    <button class="tb" id="helpBtn" title="Help &amp; guide (opens in browser)"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>
    <select id="translate" class="sel" title="Translate document (DeepL)">
      <option value="">🌐 Translate…</option>
      <option value="en">English</option>
      <option value="uk">Українська</option>
      <option value="es">Español</option>
      <option value="zh">中文</option>
    </select>
    <select id="mode" class="sel" title="View">
      <option value="split">Split</option>
      <option value="source">Source</option>
      <option value="preview">Preview</option>
    </select>
    <select id="theme" class="sel" title="Theme">
      <option value="dark">Dark</option>
      <option value="white">White</option>
      <option value="blue">Dark Blue</option>
      <option value="green">Dark Green</option>
    </select>
    <button class="btn" id="exportBtn">DOCX</button>
  </div>
  <div class="findbar" id="findbar">
    <input id="findInput" placeholder="Find" />
    <input id="replaceInput" placeholder="Replace" />
    <span class="count" id="findCount"></span>
    <button class="tb" id="findPrev" title="Previous">&#8593;</button>
    <button class="tb" id="findNext" title="Next">&#8595;</button>
    <button class="tb ra" id="replaceAllBtn">Replace all</button>
    <button class="tb" id="findClose">&#10005;</button>
  </div>
  <div class="panes" id="panes">
    <div class="pane-editor"><textarea id="source" spellcheck="true"></textarea></div>
    <div id="preview" class="markdown-body"></div>
  </div>
  <div class="statusbar" id="statusbar">
    <span class="st"><b id="stWords">0</b>&nbsp;words</span>
    <span class="st"><b id="stChars">0</b>&nbsp;chars</span>
    <span class="st"><b id="stLines">0</b>&nbsp;lines</span>
    <span class="st"><b id="stRead">0</b>&nbsp;min read</span>
    <span class="spacer"></span>
    <span class="st navjump">
      <button class="navbtn" id="navTop" title="Go to start">&#10514;</button>
      <span class="posbar" id="posbar"><span class="posfill" id="posfill"></span></span>
      <button class="navbtn" id="navBottom" title="Go to end">&#10515;</button>
      <b id="stPos">0%</b>
    </span>
  </div>
  <script src="${v("vendor", "marked.min.js")}"></script>
  <script src="${v("vendor", "purify.min.js")}"></script>
  <script src="${v("vendor", "highlight.min.js")}"></script>
  <script src="${v("vendor", "docx.umd.js")}"></script>
  <script src="${v("md2docx.js")}"></script>
  <script src="${v("docxfmt.js")}"></script>
  <script src="${v("imgresize.js")}"></script>
  <script src="${v("vendor", "mammoth.browser.min.js")}"></script>
  <script src="${v("vendor", "turndown.min.js")}"></script>
  <script src="${v("vendor", "turndown-plugin-gfm.js")}"></script>
  <script src="${v("translate.js")}"></script>
  <script src="${v("vendor", "katex.min.js")}"></script>
  <script src="${v("webview.js")}"></script>
</body>
</html>`;
  }
}

module.exports = { activate, deactivate() {} };
