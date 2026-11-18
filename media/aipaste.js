/* DOCXMD — "Paste from AI": an answer copied from ChatGPT / Claude / Gemini / Copilot /
   Perplexity / DeepSeek / Grok becomes clean Markdown — formulas keep their LaTeX
   (KaTeX <annotation>, MathJax, data-math, MathML), tables are repaired, the chat UI
   ("Copy code", "ChatGPT said:", 【4†source】 …) is dropped, numbered sources become
   real footnotes.
   Pure functions except htmlToMarkdown() (DOMParser + Turndown via DOCXMDEdit), so the
   same file works in the PWA, on the landing pages and in the VS Code webview.

   window.DOCXMDAIPaste = {
     detect(html, plain)        → { source, ai, math, prefer: "plain"|"html", score }
     htmlToMarkdown(html)       → md | null
     normalize(md, opts)        → { md, changes: [{rule, from, to}], counts: {rule: n}, total }
     convert(html, plain, opts) → { md, source, via, changes, counts, total } | null
     RULES, SIGNATURES, mmlToTex(mathElement)
   } */
(function (global) {
  "use strict";

  // Where an answer came from. Checked against the clipboard HTML (and plain text);
  // kept in one table so a changed chat UI needs one edit here.
  const SIGNATURES = [
    { source: "chatgpt", html: /data-message-author-role|\sdata-start="\d+"\s+data-end="\d+"|chatgpt\.com|chat\.openai\.com|oaicite/i, plain: /:contentReference\[oaicite|【\d+†|\uE200cite|^ChatGPT said:/m },
    { source: "claude", html: /font-claude-(?:message|response)|claude\.ai|data-is-streaming/i, plain: /^Claude said:/m },
    { source: "gemini", html: /<message-content|model-response|gemini\.google\.com|class="[^"]*\bmath-(?:inline|block)\b[^"]*"[^>]*data-math=/i, plain: /^(?:Show drafts|Export to Docs|Sources and related content)\s*$/m },
    { source: "copilot", html: /copilot\.microsoft\.com|cib-message|bing\.com\/chat/i },
    { source: "perplexity", html: /perplexity\.ai/i },
    { source: "deepseek", html: /chat\.deepseek\.com|ds-markdown/i },
    { source: "grok", html: /grok\.com|x\.ai\/grok/i }
  ];
  const HTML_MATH_RE = /class="[^"]*\b(?:katex|katex-display|MathJax|math-inline|math-block|mwe-math-element)\b|<mjx-container|<math[\s>]|application\/x-tex|math\/tex|\bdata-(?:math|latex|tex)=/i;
  const PLAIN_MATH_RE = /\\\(|\\\[|\$\$|\\begin\{|^[ \t]*\[[ \t]*$/m;
  const PLAIN_ARTIFACT_RE = /:contentReference\[oaicite|【\d+†|\uE200|oaicite:\d+/;

  // Markdown signals in text/plain (the chat's own "Copy" button gives Markdown there)
  function mdScore(plain) {
    const s = String(plain || "");
    let n = 0;
    if (/\\\(|\\\[|\$\$|(?:^|[^\\$\w])\$[^\s$][^$\n]*\$/m.test(s)) n++;
    if (/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*\|/m.test(s)) n++;
    if (/^[ \t]*(?:```|~~~)/m.test(s)) n++;
    if (/^#{1,6}[ \t]+\S/m.test(s)) n++;
    if (/\*\*[^*\n]+\*\*/.test(s)) n++;
    if (/^[ \t]*(?:[-*+]|\d+\.)[ \t]+\S/m.test(s) && /\n/.test(s)) n += 0.5;
    return n;
  }

  function detect(html, plain) {
    html = String(html || ""); plain = String(plain || "");
    let source = null;
    for (const sg of SIGNATURES) {
      if ((sg.html && html && sg.html.test(html)) || (sg.plain && sg.plain.test(plain))) { source = sg.source; break; }
    }
    const math = !!html && HTML_MATH_RE.test(html);
    const score = mdScore(plain);
    const artifacts = PLAIN_ARTIFACT_RE.test(plain);
    const plainMath = PLAIN_MATH_RE.test(plain);
    let prefer = "plain";
    if (html && /<[a-z]/i.test(html)) {
      if (score >= 2) prefer = "plain";
      else if (math || source) prefer = "html";
    }
    const ai = !!(source || math || artifacts || plainMath);
    return { source: source || (ai ? "generic" : null), ai, math, prefer, score };
  }

  /* ---------------- MathML → LaTeX (MathJax / bare <math> without an annotation) ---------------- */
  const UNI_TEX = {
    "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∮": "\\oint", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx",
    "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "⋅": "\\cdot", "·": "\\cdot", "∞": "\\infty", "→": "\\to", "←": "\\leftarrow",
    "⇒": "\\Rightarrow", "⇔": "\\Leftrightarrow", "↔": "\\leftrightarrow", "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊆": "\\subseteq",
    "∪": "\\cup", "∩": "\\cap", "∀": "\\forall", "∃": "\\exists", "∂": "\\partial", "∇": "\\nabla", "≡": "\\equiv", "∼": "\\sim",
    "∝": "\\propto", "…": "\\ldots", "⋯": "\\cdots", "∘": "\\circ", "′": "'", "−": "-", "⁡": "", "⁢": "", "⁣": "", "\u2061": "", "{": "\\{", "}": "\\}"
  };
  const FUNCS = /^(?:sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lg|exp|lim|max|min|sup|inf|det|dim|ker|deg|gcd|arg|Pr)$/;
  const ACCENTS = { "^": "\\hat", "ˆ": "\\hat", "¯": "\\bar", "‾": "\\overline", "→": "\\vec", "⃗": "\\vec", "~": "\\tilde", "˜": "\\tilde", "˙": "\\dot", "¨": "\\ddot", "ˇ": "\\check", "⏞": "\\overbrace", "⏟": "\\underbrace", "_": "\\underline" };
  function joinTex(parts) {
    let out = "";
    for (const p of parts) {
      if (!p) continue;
      if (/\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z0-9]/.test(p)) out += " ";
      out += p;
    }
    return out;
  }
  const grp = (s) => (s.length === 1 ? s : "{" + s + "}");
  const base = (s) => (/^\\[a-zA-Z]+$/.test(s) ? s : grp(s));
  const scr = (s) => "{" + s + "}";
  function mmlToTex(n) {
    if (!n) return "";
    if (n.nodeType === 3) return String(n.nodeValue || "").trim();
    if (n.nodeType !== 1) return "";
    const name = (n.localName || n.nodeName || "").toLowerCase().replace(/^m:/, "");
    const kids = Array.from(n.children || []);
    const k = (i) => mmlToTex(kids[i]);
    const txt = () => String(n.textContent || "").trim();
    const all = () => joinTex(kids.map(mmlToTex));
    switch (name) {
      case "math": {
        const alt = n.getAttribute && n.getAttribute("alttext");
        if (alt) return alt.replace(/^\{\\displaystyle\s*([\s\S]*)\}$/, "$1").trim();
        return all();
      }
      case "semantics": {
        const ann = kids.find((c) => /annotation/i.test(c.localName) && /tex/i.test(c.getAttribute("encoding") || ""));
        return ann ? ann.textContent.trim() : k(0);
      }
      case "annotation": case "annotation-xml": case "mprescripts": case "none": return "";
      case "mi": { const t = txt(); return FUNCS.test(t) ? "\\" + t : t.length > 1 ? "\\mathrm{" + t + "}" : (UNI_TEX[t] != null ? UNI_TEX[t] : t); }
      case "mn": return txt();
      case "mo": { const t = txt(); return UNI_TEX[t] != null ? UNI_TEX[t] : FUNCS.test(t) ? "\\" + t : t; }
      case "mtext": { const t = n.textContent || ""; return t.trim() ? "\\text{" + t.replace(/([{}])/g, "\\$1") + "}" : " "; }
      case "ms": return "\\text{\"" + txt() + "\"}";
      case "mspace": return "\\,";
      case "msup": return base(k(0)) + "^" + scr(k(1));
      case "msub": return base(k(0)) + "_" + scr(k(1));
      case "msubsup": return base(k(0)) + "_" + scr(k(1)) + "^" + scr(k(2));
      case "mfrac": return (n.getAttribute("linethickness") === "0" ? "\\binom{" : "\\frac{") + k(0) + "}{" + k(1) + "}";
      case "msqrt": return "\\sqrt{" + all() + "}";
      case "mroot": return "\\sqrt[" + k(1) + "]{" + k(0) + "}";
      case "munder": {
        const b = k(0), u = kids[1] ? kids[1].textContent.trim() : "";
        if (ACCENTS[u] && (u === "_" || u === "⏟")) return ACCENTS[u] + "{" + b + "}";
        if (/^\\(?:sum|prod|lim|max|min|sup|inf|int|bigcup|bigcap)$/.test(b) || /^\\lim/.test(b)) return b + "_" + scr(k(1));
        return "\\underset{" + k(1) + "}{" + b + "}";
      }
      case "mover": {
        const b = k(0), o = kids[1] ? kids[1].textContent.trim() : "";
        if (ACCENTS[o]) return ACCENTS[o] + "{" + b + "}";
        if (/^\\(?:sum|prod|int)$/.test(b)) return b + "^" + scr(k(1));
        return "\\overset{" + k(1) + "}{" + b + "}";
      }
      case "munderover": return base(k(0)) + "_" + scr(k(1)) + "^" + scr(k(2));
      case "mtable": return "\\begin{matrix}" + kids.map((r) => Array.from(r.children).map(mmlToTex).join(" & ")).join(" \\\\ ") + "\\end{matrix}";
      case "mtr": case "mlabeledtr": return kids.map(mmlToTex).join(" & ");
      case "mfenced": {
        const o = n.getAttribute("open") == null ? "(" : n.getAttribute("open"), c = n.getAttribute("close") == null ? ")" : n.getAttribute("close");
        const fix = (x) => (x === "{" ? "\\{" : x === "}" ? "\\}" : x || ".");
        return "\\left" + fix(o) + kids.map(mmlToTex).join(n.getAttribute("separators") || ",") + "\\right" + fix(c);
      }
      case "menclose": return "\\boxed{" + all() + "}";
      case "mphantom": return "";
      default: return all();
    }
  }

  /* ---------------- Clipboard HTML → Markdown (AI rules on top of DOCXMDEdit) ---------------- */
  const MATH_SEL = ".katex-display, .katex, mjx-container, .MathJax_Display, .MathJax, .MathJax_SVG, .math-inline, .math-block, .mwe-math-element, [data-math], [data-latex], [data-tex], math";
  const TEX_ANN = 'annotation[encoding="application/x-tex"], annotation[encoding="TeX"], annotation[encoding="text/x-latex"], annotation[encoding="application/x-latex"]';
  function texOf(n) {
    const a = n.querySelector && n.querySelector(TEX_ANN);
    if (a && a.textContent.trim()) return a.textContent;
    for (const at of ["data-math", "data-latex", "data-tex", "data-formula"]) { const v = n.getAttribute && n.getAttribute(at); if (v) return v; }
    const m = (n.localName || "").toLowerCase() === "math" ? n : n.querySelector && n.querySelector("math");
    if (m) return mmlToTex(m);
    return null;
  }
  function isDisplay(n) {
    if (n.closest && n.closest(".katex-display, .MathJax_Display, .math-block, .math-display")) return true;
    if (/^(?:true|block)$/i.test(n.getAttribute("display") || "")) return true;
    const m = n.querySelector && n.querySelector("math");
    if (m && /^block$/i.test(m.getAttribute("display") || "")) return true;
    return (n.localName || "").toLowerCase() === "div";
  }
  // Text of a code block as the chat shows it (no line-number gutters, no "Copy code")
  function codeLang(pre, code) {
    const m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec((code && code.className) || "") || /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(pre.className || "");
    if (m) return m[1];
    const dl = pre.getAttribute("data-language") || (code && code.getAttribute("data-language"));
    if (dl) return dl;
    // ChatGPT: <pre><div><div>python <button>Copy code</button></div><div><code>…
    let lang = "";
    pre.querySelectorAll("div, span").forEach((d) => {
      if (lang || (code && (d.contains(code) || code.contains(d)))) return;
      const t = (d.textContent || "").replace(/\b(?:Copy(?: code)?|Edit|Run)\b/g, "").trim();
      if (/^[A-Za-z][\w+#.-]{0,19}$/.test(t)) lang = t.toLowerCase();
    });
    return lang;
  }

  function prepare(doc, store) {
    const body = doc.body;
    // MathJax 2: <script type="math/tex; mode=display">…</script> next to its rendered spans
    body.querySelectorAll('script[type^="math/tex"]').forEach((sc) => {
      const disp = /mode=display/.test(sc.getAttribute("type") || "");
      let p = sc.previousElementSibling;
      while (p && /\bMathJax(?:_Preview|_Display|_SVG|_CHTML)?\b/.test(p.className || "")) { const q = p.previousElementSibling; p.remove(); p = q; }
      const ph = doc.createElement(disp ? "div" : "span");
      ph.setAttribute("data-aitex", String(store.push({ tex: sc.textContent, display: disp }) - 1)); ph.textContent = "m";
      sc.replaceWith(ph);
    });
    // KaTeX / MathJax 3 / Gemini data-math / Wikipedia / bare MathML: outermost nodes only
    const nodes = Array.from(body.querySelectorAll(MATH_SEL)).filter((n) => !(n.parentElement && n.parentElement.closest(MATH_SEL)));
    nodes.forEach((n) => {
      const tex = texOf(n);
      if (tex == null || !String(tex).trim()) return;
      const disp = isDisplay(n);
      const ph = doc.createElement(disp ? "div" : "span");
      ph.setAttribute("data-aitex", String(store.push({ tex: String(tex), display: disp }) - 1)); ph.textContent = "m";
      n.replaceWith(ph);
    });
    // UI chrome: buttons, icons, screen-reader-only labels, toolbars, avatars
    body.querySelectorAll('button, svg, nav, textarea, select, .sr-only, .visually-hidden, [role="button"], [role="toolbar"], [data-testid*="copy"], [data-testid*="action"], [aria-label="Copy"], [class*="copy-button"], [class*="CopyButton"]').forEach((n) => n.remove());
    body.querySelectorAll('[aria-hidden="true"]').forEach((n) => { if (!n.querySelector("img")) n.remove(); });
    // code blocks: plain text + language, nothing of the chat's header
    body.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      const lang = codeLang(pre, code);
      const src = code ? code.textContent : Array.from(pre.childNodes).filter((x) => x.nodeType === 3 || !/^(?:BUTTON|SVG)$/i.test(x.nodeName)).map((x) => x.textContent).join("");
      const npre = doc.createElement("pre"), nc = doc.createElement("code");
      if (lang) nc.className = "language-" + lang;
      nc.textContent = src.replace(/\n$/, "");
      npre.appendChild(nc);
      pre.replaceWith(npre);
    });
    // Turndown keeps "<br>" inside table cells only through its own rule — leave as is
  }

  function htmlToMarkdown(html) {
    const E = global.DOCXMDEdit;
    if (!E || !E.htmlToMarkdown || !html) return null;
    const store = [];
    return E.htmlToMarkdown(html, {
      force: true,
      prepare: (doc) => prepare(doc, store),
      rules(td) {
        td.addRule("aiTex", {
          filter: (n) => n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-aitex"),
          replacement(content, n) {
            const m = store[+n.getAttribute("data-aitex")]; if (!m) return content;
            const tex = String(m.tex).trim();
            if (m.display) return "\n\n$$\n" + tex.replace(/\n[ \t]*\n/g, "\n") + "\n$$\n\n";
            return "\\(" + tex.replace(/\s*\n\s*/g, " ") + "\\)";
          }
        });
      }
    });
  }

  /* ---------------- Markdown normalisation (each rule can be switched off) ---------------- */
  const RULES = [
    { id: "invisibles", on: true },
    { id: "uiChrome", on: true },
    { id: "citeChatGPT", on: true },
    { id: "tableUnfence", on: true },
    { id: "mathBrackets", on: true },
    { id: "mathDisplayFix", on: true },
    { id: "mathInlineSpace", on: true },
    { id: "mathPipes", on: true },
    { id: "tableSeparator", on: true },
    { id: "tableDedent", on: true },
    { id: "citeToFootnotes", on: true },
    { id: "headingEmoji", on: false },
    { id: "frontMatter", on: false }
  ];
  const UI_LINES = /^(?:ChatGPT said:|You said:|Claude said:|Gemini said:|Copilot said:|Copy code|Copy|Copy table|Edit|Share|Retry|Regenerate|Show drafts|Export to Docs|Sources and related content|Artifact|Thought for \d+\s*s(?:econds)?|Was this response helpful\?|Searched \d+ sites?|Reasoned for \d+\s*s(?:econds)?)[ \t]*$/i;
  const LANGS = /^(?:python|py|javascript|js|typescript|ts|jsx|tsx|java|c|cpp|c\+\+|c#|csharp|go|rust|ruby|php|swift|kotlin|scala|r|matlab|octave|julia|sql|bash|sh|shell|zsh|powershell|ps1|html|css|scss|json|yaml|yml|xml|toml|ini|markdown|md|latex|tex|dockerfile|makefile|lua|perl|haskell|dart|vb|vba|plaintext|text|mermaid|bibtex|diff)$/i;
  const TEX_SIGN = /\\[a-zA-Z]+|[_^]\{|[_^][A-Za-z0-9]/;
  const TABLE_LINE = /^[ \t]*\|.*\|[ \t]*$/;
  const SEP_LINE = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;
  const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/);

  // Split into code / text segments (fenced code, front matter are never touched)
  function segments(md) {
    const lines = md.split("\n"), segs = [];
    let cur = { code: false, lines: [] }, fence = null, i = 0;
    const fm = /^---[ \t]*$/.test(lines[0] || "") ? lines.indexOf("---", 1) : -1;
    if (fm > 0) { segs.push({ code: true, fm: true, lines: lines.slice(0, fm + 1) }); i = fm + 1; }
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (!fence) {
        const m = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/.exec(l);
        if (m) {
          if (cur.lines.length) segs.push(cur);
          fence = m[2]; cur = { code: true, lang: m[3] || "", open: l, lines: [], indent: m[1] };
          continue;
        }
        cur.lines.push(l);
      } else {
        const c = new RegExp("^[ \\t]*" + fence[0] + "{" + fence.length + ",}[ \\t]*$").exec(l);
        if (c) { cur.close = l; segs.push(cur); cur = { code: false, lines: [] }; fence = null; continue; }
        cur.lines.push(l);
      }
    }
    if (cur.lines.length || cur.code) segs.push(cur);
    return segs;
  }
  function joinSegs(segs) {
    return segs.map((s) => (s.code && !s.fm ? [s.open].concat(s.lines, s.close != null ? [s.close] : []) : s.lines).join("\n")).join("\n");
  }
  // inline `code` is masked while text rules run
  function maskCode(text) {
    const kept = [];
    const t = text.replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)|(`+)(?!`)\S\2(?!`)/g, (m) => "\u0001" + (kept.push(m) - 1) + "\u0001");
    return { t, back: (x) => x.replace(/\u0001(\d+)\u0001/g, (m, i) => kept[+i]) };
  }

  function normalize(md, opts) {
    opts = opts || {};
    const on = {};
    RULES.forEach((r) => { on[r.id] = opts.rules && opts.rules[r.id] != null ? !!opts.rules[r.id] : r.on; });
    const changes = [], counts = {};
    const note = (rule, from, to) => { counts[rule] = (counts[rule] || 0) + 1; if (changes.length < 400) changes.push({ rule, from: String(from).slice(0, 160), to: String(to).slice(0, 160) }); };
    let text = String(md == null ? "" : md);

    // invisibles: CRLF, zero-width characters, no-break spaces
    if (on.invisibles) {
      text = text.replace(/\r\n?/g, "\n");
      // U+200C / U+200D stay: Persian / Indic shaping and emoji sequences (👩‍💻) need them
      text = text.replace(/[\u200B\u2060\uFEFF]+/g, (m) => { note("invisibles", "U+" + m.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"), "∅"); return ""; });
      text = text.replace(/[\u00A0\u202F]/g, (m) => { note("invisibles", m === "\u00A0" ? "NBSP" : "NNBSP", "␠"); return " "; });
    }

    let segs = segments(text);

    // a GFM table that the chat wrapped in ``` → plain table again
    if (on.tableUnfence) {
      segs = segs.map((s) => {
        if (!s.code || s.fm || !/^(?:|md|markdown|text|plaintext|table)$/i.test(s.lang)) return s;
        const body = s.lines.filter((l) => l.trim());
        if (body.length >= 2 && body.every((l) => TABLE_LINE.test(l) || SEP_LINE.test(l)) && body.some((l) => SEP_LINE.test(l))) {
          note("tableUnfence", s.open + " …", "| … |");
          return { code: false, lines: [""].concat(s.lines.map((l) => l.replace(/^[ \t]+/, "")), [""]) };
        }
        return s;
      });
    }
    // language label on its own line right above a fence without one ("python" / ```)
    if (on.uiChrome) {
      for (let i = 1; i < segs.length; i++) {
        const s = segs[i], p = segs[i - 1];
        if (!s.code || s.fm || s.lang || p.code) continue;
        let j = p.lines.length - 1; while (j >= 0 && !p.lines[j].trim()) j--;
        if (j >= 0 && LANGS.test(p.lines[j].trim()) && (j === 0 || !p.lines[j - 1].trim() || UI_LINES.test(p.lines[j - 1].trim()))) {
          const lang = p.lines[j].trim().toLowerCase();
          note("uiChrome", lang + " / " + s.open.trim(), s.open.trim() + lang);
          s.open = s.open.replace(/(`{3,}|~{3,})[ \t]*$/, "$1" + lang); s.lang = lang;
          p.lines.splice(j, 1);
        }
      }
    }

    segs.forEach((s) => {
      if (s.code) return;
      const mk = maskCode(s.lines.join("\n"));
      let t = mk.t;

      if (on.uiChrome) {
        t = t.split("\n").filter((l) => { if (UI_LINES.test(l.trim())) { note("uiChrome", l.trim(), "∅"); return false; } return true; }).join("\n");
      }
      if (on.citeChatGPT) {
        t = t.replace(/[ \t]*(?::contentReference\[oaicite:\d+\]\{index=\d+\}|【\d+(?::\d+)?†[^】\n]*】|\uE200[^\uE201\n]*\uE201|\[oaicite:\d+\])/g, (m) => { note("citeChatGPT", m.trim(), "∅"); return ""; });
        t = t.replace(/[\uE200-\uE206]/g, "");
      }
      if (on.mathBrackets) {
        // [            x = \frac{a}{b} ]   (ChatGPT text copy lost the backslashes)
        // x = \frac{a}{b}  →  $$ … $$
        // ]
        t = t.replace(/^([ \t]*)\[[ \t]*\n((?:(?![ \t]*\][ \t]*$)[^\n]*\n){1,30}?)\1?[ \t]*\][ \t]*$/gm, (m, ind, inner) => {
          if (!TEX_SIGN.test(inner)) return m;
          const to = ind + "$$\n" + inner.replace(/\n$/, "").split("\n").map((l) => ind + l.trim()).join("\n") + "\n" + ind + "$$";
          note("mathBrackets", m.replace(/\s+/g, " ").trim(), "$$…$$"); return to;
        });
        t = t.replace(/^([ \t]*)\[[ \t]+([^\n\[\]]*?)[ \t]+\][ \t]*$/gm, (m, ind, inner) => {
          if (!TEX_SIGN.test(inner)) return m;
          note("mathBrackets", m.trim(), "$$" + inner + "$$"); return ind + "$$\n" + ind + inner.trim() + "\n" + ind + "$$";
        });
        // ( \alpha ) → \( \alpha \)   — only with a LaTeX command inside and blanks at both ends
        t = t.replace(/(^|[^\\\w])\([ \t]+((?:[^()\n]|\([^()\n]*\))*?\\[a-zA-Z]+(?:[^()\n]|\([^()\n]*\))*?)[ \t]+\)/g, (m, pre, inner) => {
          if (/\]\($/.test(pre) || /^\s*https?:/.test(inner)) return m;
          note("mathBrackets", "( " + inner + " )", "\\(" + inner + "\\)"); return pre + "\\(" + inner + "\\)";
        });
      }
      if (on.mathDisplayFix) {
        // \[ … \] in the middle of a line → $$…$$ (rendered as a displayed formula without breaking the paragraph)
        t = t.replace(/(\S[^\n]*?)[ \t]*\\\[([^\n]+?)\\\]/g, (m, before, inner) => {
          note("mathDisplayFix", "…\\[" + inner + "\\]", "$$" + inner.trim() + "$$"); return before + " $$" + inner.trim() + "$$";
        });
        t = t.replace(/\\\[([^\n]+?)\\\][ \t]*(?=\S)/g, (m, inner) => { note("mathDisplayFix", "\\[" + inner + "\\]…", "$$" + inner.trim() + "$$"); return "$$" + inner.trim() + "$$ "; });
        // blank lines inside \[ … \], $$ … $$ and \begin{…} … \end{…}
        t = t.replace(/(\\\[|\$\$|\\begin\{(\w+\*?)\})([\s\S]*?)(\\\]|\$\$|\\end\{\2\})/g, (m, a, env, inner, b) => {
          if ((a === "\\[" && b !== "\\]") || (a === "$$" && b !== "$$") || (env && b !== "\\end{" + env + "}")) return m;
          if (!/\n[ \t]*\n/.test(inner)) return m;
          note("mathDisplayFix", a + "…␤␤…" + b, a + "…" + b); return a + inner.replace(/\n(?:[ \t]*\n)+/g, "\n") + b;
        });
        // \[ indented 4+ spaces outside a list would be a code block
        t = t.replace(/(^|\n\n)( {4,})(\\\[|\$\$)/g, (m, a, sp, d) => { note("mathDisplayFix", sp.length + "␠" + d, d); return a + d; });
      }
      if (on.mathInlineSpace) {
        t = t.replace(/(^|[^\\$\w])\$([ \t]*)([^$\n]+?)([ \t]*)\$(?![\d$])/gm, (m, pre, s1, inner, s2) => {
          if (!s1 && !s2) return m;
          if (!/[\\^_=]/.test(inner) || /^\d/.test(inner.trim()) && !/[\\^_]/.test(inner)) return m;
          note("mathInlineSpace", "$" + s1 + inner + s2 + "$", "$" + inner.trim() + "$"); return pre + "$" + inner.trim() + "$";
        });
      }
      if (on.mathPipes) {
        t = t.split("\n").map((l) => {
          if (!TABLE_LINE.test(l)) return l;
          return l.replace(/\\\((.+?)\\\)|(?<![\\$])\$([^$\n]+?)\$(?!\d)/g, (m, a, b) => {
            const inner = a != null ? a : b;
            if (!/\|/.test(inner)) return m;
            const fixed = inner.replace(/\\\|/g, "\\Vert ").replace(/\|/g, "\\vert ").replace(/(\\[vV]ert) (?![A-Za-z])/g, "$1").replace(/\s+$/, "");
            note("mathPipes", m, a != null ? "\\(" + fixed + "\\)" : "$" + fixed + "$");
            return a != null ? "\\(" + fixed + "\\)" : "$" + fixed + "$";
          });
        }).join("\n");
      }
      if (on.tableDedent || on.tableSeparator) {
        const L = t.split("\n");
        for (let i = 0; i < L.length; i++) {
          if (!TABLE_LINE.test(L[i]) || (i > 0 && TABLE_LINE.test(L[i - 1]))) continue;
          let j = i; while (j + 1 < L.length && (TABLE_LINE.test(L[j + 1]) || SEP_LINE.test(L[j + 1]))) j++;
          if (j === i) continue;
          // indented table outside a list → flush left
          const ind = /^[ \t]*/.exec(L[i])[0];
          let k = i - 1; while (k >= 0 && !L[k].trim()) k--;
          const inList = k >= 0 && /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/.test(L[k]) || (k >= 0 && /^[ \t]{2,}\S/.test(L[k]));
          if (on.tableDedent && ind.replace(/\t/g, "    ").length >= 4 && !inList) {
            for (let q = i; q <= j; q++) L[q] = L[q].replace(/^[ \t]+/, "");
            note("tableDedent", ind.length + "␠| …", "| …");
          }
          // no |---| row: add one after the first row
          let hasSep = false; for (let q = i; q <= j; q++) if (SEP_LINE.test(L[q])) hasSep = true;
          if (on.tableSeparator && !hasSep) {
            const n = cellsOf(L[i]).length, lead = /^[ \t]*/.exec(L[i])[0];
            L.splice(i + 1, 0, lead + "|" + Array(n).fill(" --- ").join("|") + "|");
            note("tableSeparator", L[i].trim().slice(0, 60), "+ |---|");
            j++;
          }
          // a table glued to the paragraph above it
          if (i > 0 && L[i - 1].trim() && !TABLE_LINE.test(L[i - 1]) && !/^[ \t]*(?:[-*+]|\d+[.)])[ \t]/.test(L[i - 1]) && !inList) { L.splice(i, 0, ""); j++; }
          i = j;
        }
        t = L.join("\n");
      }
      if (on.headingEmoji) {
        t = t.replace(/^(#{1,6}[ \t]+)((?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]+[ \t]*)+)/gmu, (m, h, e) => { note("headingEmoji", m.trim(), h.trim()); return h; });
      }
      t = t.replace(/\n{3,}/g, "\n\n");          // extra blank lines — only in text, never inside code
      s.lines = mk.back(t).split("\n");
    });

    text = joinSegs(segs);

    // [1] [2] … + a numbered list of sources at the end → Word footnotes [^1]
    if (on.citeToFootnotes) text = sourcesToFootnotes(text, note);

    if (on.frontMatter && !/^---[ \t]*\n/.test(text)) {
      const h = /^#[ \t]+(.+)$/m.exec(text);
      const d = new Date(), ds = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const title = h ? h[1].replace(/["\\]/g, "").trim() : "";
      const fm = "---\n" + (title ? 'title: "' + title + '"\n' : "") + "date: " + ds + "\n---\n\n";
      note("frontMatter", "∅", fm.trim().replace(/\n/g, " ")); text = fm + text;
    }
    let total = 0; Object.keys(counts).forEach((k) => { total += counts[k]; });
    return { md: text, changes, counts, total };
  }

  const SRC_HEAD = /^[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*)?(?:Sources|Source|References|Citations|Джерела|Посилання|Список джерел|Fuentes|Referencias|来源|参考资料|参考文献)(?:\*\*)?[ \t]*:?[ \t]*$/i;
  const SRC_ITEM = /^[ \t]*(?:\[(\d{1,3})\]:?|(\d{1,3})[.)])[ \t]+(\S.*)$/;
  function sourcesToFootnotes(text, note) {
    const segs = segments(text);
    // the last text segment holds the list
    let si = segs.length - 1; while (si >= 0 && segs[si].code) si--;
    if (si < 0) return text;
    const L = segs[si].lines;
    let end = L.length - 1; while (end >= 0 && !L[end].trim()) end--;
    let start = end, defs = {};
    while (start >= 0 && (SRC_ITEM.test(L[start]) || !L[start].trim())) start--;
    const headAt = start >= 0 && SRC_HEAD.test(L[start]) ? start : -1;
    const items = L.slice(start + 1, end + 1).filter((l) => l.trim());
    if (!items.length || !items.every((l) => SRC_ITEM.test(l))) return text;
    // a plain "1. 2. 3." list needs the heading (it may be just a list); "[1] …" does not
    if (headAt < 0 && !items.every((l) => /^[ \t]*\[\d+\]/.test(l))) return text;
    items.forEach((l) => { const m = SRC_ITEM.exec(l); defs[m[1] || m[2]] = m[3].trim(); });
    // markers in the text before the list
    const ids = new Set(Object.keys(defs));
    let used = 0;
    const re = /(?<![!\]\\^\w])((?:\[\d{1,3}\])+)(?![(:])/g;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]; if (s.code) continue;
      const upto = i === si ? (headAt >= 0 ? headAt : start + 1) : s.lines.length;
      for (let q = 0; q < upto; q++) {
        if (SRC_ITEM.test(s.lines[q]) && i === si && q > start) continue;
        // `[1]` inside inline code stays literal
        const mk = maskCode(s.lines[q]);
        s.lines[q] = mk.back(mk.t.replace(re, (m) => {
          const ns = m.slice(1, -1).split("][");
          if (!ns.every((n) => ids.has(n))) return m;
          used += ns.length; const to = ns.map((n) => "[^" + n + "]").join("");
          note("citeToFootnotes", m, to); return to;
        }));
      }
    }
    if (!used) return text;
    const defLines = Object.keys(defs).map((n) => "[^" + n + "]: " + defs[n].replace(/^<(.*)>$/, "$1"));
    L.splice(headAt >= 0 ? headAt : start + 1, L.length, ...defLines);
    note("citeToFootnotes", "Sources (" + defLines.length + ")", "[^n]: …");
    return joinSegs(segs);
  }

  function convert(html, plain, opts) {
    opts = opts || {};
    const det = detect(html, plain);
    let md = null, via = "plain";
    if (det.prefer === "html" && html) { md = htmlToMarkdown(html); if (md != null) via = "html"; }
    if (md == null) { md = String(plain || ""); via = "plain"; }
    if (!md.trim()) return null;
    const r = normalize(md, opts);
    return { md: r.md.trim() + "\n", source: det.source, ai: det.ai, via, changes: r.changes, counts: r.counts, total: r.total, math: det.math };
  }

  global.DOCXMDAIPaste = { detect, htmlToMarkdown, normalize, convert, mmlToTex, RULES, SIGNATURES };
})(typeof window !== "undefined" ? window : this);
