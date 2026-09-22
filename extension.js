// DOCXMD — VS Code extension host
// Custom text editor for Markdown with live preview + export to .docx.
// Reuses the app's md2docx.js / marked / docx inside the webview.
"use strict";
const vscode = require("vscode");
const path = require("path");
const https = require("https");

const VIEW_TYPE = "docxmd.editor";

// ---- DeepL translation (performed in the host; the webview can't reach DeepL) ----
let _deeplKey = null;
async function getDeeplKey() {
  if (_deeplKey) return _deeplKey;
  const cfg = vscode.workspace.getConfiguration("docxmd").get("deeplApiKey");
  if (cfg && String(cfg).trim()) { _deeplKey = String(cfg).trim(); return _deeplKey; }
  const k = await vscode.window.showInputBox({
    prompt: "Enter your DeepL API key (saved to settings: docxmd.deeplApiKey)",
    password: true, ignoreFocusOut: true, placeHolder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
  });
  if (k && k.trim()) {
    _deeplKey = k.trim();
    try { await vscode.workspace.getConfiguration("docxmd").update("deeplApiKey", _deeplKey, vscode.ConfigurationTarget.Global); } catch (e) {}
    return _deeplKey;
  }
  return null;
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
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    };
    webview.html = this._html(webview);

    activePanel = webviewPanel;
    let fromWebview = false;

    const postUpdate = () => webview.postMessage({ type: "update", text: document.getText() });

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
      if (webviewPanel.active) activePanel = webviewPanel;
    });

    webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.type === "ready") postUpdate();
      else if (msg.type === "edit") applyEdit(msg.text);
      else if (msg.type === "saveDocx") saveDocx(msg.dataBase64, msg.name);
      else if (msg.type === "info") vscode.window.showInformationMessage(msg.text);
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
            const translations = await deeplRequest(msg.text, msg.target, msg.source, key);
            webview.postMessage({ type: "deeplResult", id: msg.id, translations: translations });
          } catch (e) {
            if (e && (e.status === 401 || e.status === 403)) _deeplKey = null; // bad key → prompt again next time
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
      if (activePanel === webviewPanel) activePanel = null;
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https: data: blob:; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src ${csp} 'unsafe-eval';">
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
      <span class="sep"></span>
      <button class="tb" data-cmd="h1">H1</button>
      <button class="tb" data-cmd="h2">H2</button>
      <button class="tb" data-cmd="h3">H3</button>
      <span class="sep"></span>
      <button class="tb" data-cmd="quote">&#8220;</button>
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
  <script src="${v("translate.js")}"></script>
  <script src="${v("vendor", "katex.min.js")}"></script>
  <script src="${v("webview.js")}"></script>
</body>
</html>`;
  }
}

module.exports = { activate, deactivate() {} };
