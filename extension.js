// DOCXMD — VS Code extension host
// Custom text editor for Markdown with live preview + export to .docx.
// Reuses the app's md2docx.js / marked / docx inside the webview.
"use strict";
const vscode = require("vscode");
const path = require("path");

const VIEW_TYPE = "docxmd.editor";
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
    </div>
    <span class="spacer"></span>
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
  <div class="panes" id="panes">
    <textarea id="source" spellcheck="true"></textarea>
    <div id="preview" class="markdown-body"></div>
  </div>
  <script src="${v("vendor", "marked.min.js")}"></script>
  <script src="${v("vendor", "purify.min.js")}"></script>
  <script src="${v("vendor", "highlight.min.js")}"></script>
  <script src="${v("vendor", "docx.umd.js")}"></script>
  <script src="${v("md2docx.js")}"></script>
  <script src="${v("webview.js")}"></script>
</body>
</html>`;
  }
}

module.exports = { activate, deactivate() {} };
