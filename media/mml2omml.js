/* DOCXMD — LaTeX → native Word equations (OMML) through KaTeX's MathML.
   KaTeX already understands the whole LaTeX that AI answers use (matrices, cases,
   aligned, \sum_{}^{} / \int / \lim, \left( \right), accents, \mathbb …); this file
   only maps its MathML onto Office Math. Own MIT code, no LGPL dependency.

   window.DOCXMDOmml = {
     fromTex(tex, display) → "<m:oMath>…</m:oMath>" | null   (null: KaTeX / DOMParser missing or a parse error)
     fromMathML(mathElement) → "<m:oMath>…</m:oMath>"
   }
   md2docx.js wraps the string with docx's ImportedXmlComponent; its old parseTex() stays
   as the fallback. */
(function (global) {
  "use strict";

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const INVISIBLE = /[\u2061\u2062\u2063\u2064\u200B]/g;
  const NARY = { "∑": 1, "∏": 1, "∐": 1, "∫": 1, "∬": 1, "∭": 1, "∮": 1, "∯": 1, "∰": 1, "⋃": 1, "⋂": 1, "⋁": 1, "⋀": 1, "⨁": 1, "⨂": 1, "⨀": 1, "⨄": 1 };
  const INTEGRAL = /[∫∬∭∮∯∰]/;
  // where the operand of ∑ / ∫ ends (outside brackets)
  const STOP = /^(?:=|<|>|≤|≥|≠|≈|≡|∼|≃|≅|∝|→|←|⇒|⇔|↔|\+|−|-|±|∓|,|;|\||∣|∈|∉|⊂|⊆)$/;
  const SIGN = /^(?:\+|−|-|±|∓)$/;
  const OPEN = /^[([{⟨⌊⌈|‖]$/, CLOSE = /^[)\]}⟩⌋⌉|‖]$/;
  const ACC = { "^": "\u0302", "ˆ": "\u0302", "̂": "\u0302", "~": "\u0303", "˜": "\u0303", "̃": "\u0303", "¯": "\u0304", "ˉ": "\u0304", "→": "\u20D7", "⃗": "\u20D7", "˙": "\u0307", "¨": "\u0308", "ˇ": "\u030C", "´": "\u0301", "`": "\u0300", "˘": "\u0306", "˚": "\u030A", "∘": "\u030A", "←": "\u20D6", "↔": "\u20E1" };
  const SCR = { "double-struck": "double-struck", script: "script", "bold-script": "script", fraktur: "fraktur", "bold-fraktur": "fraktur", "sans-serif": "sans-serif", "bold-sans-serif": "sans-serif", "sans-serif-italic": "sans-serif", "sans-serif-bold-italic": "sans-serif", monospace: "monospace" };
  const STY = { normal: "p", bold: "b", italic: "i", "bold-italic": "bi", "double-struck": "p", "bold-fraktur": "b", "bold-script": "b", "bold-sans-serif": "b", "sans-serif-bold-italic": "bi", "sans-serif-italic": "i", monospace: "p", "sans-serif": "p", fraktur: "p", script: "p" };

  const name = (n) => (n && n.nodeType === 1 ? String(n.localName || n.nodeName).toLowerCase().replace(/^m:/, "") : "");
  const kids = (n) => Array.from(n.children || []).filter((c) => name(c) !== "annotation" && name(c) !== "annotation-xml");
  const txt = (n) => String((n && n.textContent) || "").replace(INVISIBLE, "");
  const tag = (t, inner, pr) => "<m:" + t + ">" + (pr || "") + (inner || "") + "</m:" + t + ">";
  const e = (inner) => "<m:e>" + (inner || "") + "</m:e>";
  const val = (t, v) => "<m:" + t + ' m:val="' + esc(v) + '"/>';

  function run(text, n, kind) {
    text = String(text).replace(INVISIBLE, "");
    if (!text) return "";
    const mv = n && n.getAttribute ? n.getAttribute("mathvariant") : null;
    let pr = "";
    if (kind === "text") pr = "<m:nor/>" + val("sty", "p");
    else {
      if (mv && SCR[mv]) pr += val("scr", SCR[mv]);
      let sty = mv ? STY[mv] : null;
      if (!sty && kind === "mi" && [...text].length > 1) sty = "p";          // sin, log, lim, \operatorname
      if (!sty && kind === "mn") sty = "p";
      if (sty) pr += val("sty", sty);
    }
    return "<m:r>" + (pr ? "<m:rPr>" + pr + "</m:rPr>" : "") + '<m:t xml:space="preserve">' + esc(text) + "</m:t></m:r>";
  }

  // the operator character of an element, if it is a single <mo> (for ∑, fences …)
  function moChar(n) {
    if (!n) return null;
    if (name(n) === "mo") return txt(n).trim();
    if ((name(n) === "mrow" || name(n) === "mstyle") && kids(n).length === 1) return moChar(kids(n)[0]);
    return null;
  }
  const isNary = (n) => { const c = moChar(n); return !!(c && NARY[c]); };
  const isFence = (n) => name(n) === "mo" && (n.getAttribute("fence") === "true" || n.getAttribute("stretchy") === "true") && (OPEN.test(txt(n).trim()) || CLOSE.test(txt(n).trim()) || !txt(n).trim());

  // a sequence of siblings: ∑/∫ take the following items as their operand
  function seq(list) {
    let out = "";
    for (let i = 0; i < list.length; i++) {
      const n = list[i], nm = name(n);
      const base = (nm === "msub" || nm === "msup" || nm === "msubsup" || nm === "munder" || nm === "mover" || nm === "munderover") ? kids(n)[0] : n;
      if (isNary(base)) {
        let depth = 0, j = i + 1;
        for (; j < list.length; j++) {
          const c = moChar(list[j]);
          if (c && OPEN.test(c) && !(c === "|" && depth)) depth++;
          else if (c && CLOSE.test(c) && depth) depth--;
          else if (c && !depth && STOP.test(c) && !(j === i + 1 && SIGN.test(c))) break;   // ∫ −x dx: a leading sign is part of the operand
        }
        out += nary(n, base, seq(list.slice(i + 1, j)));
        i = j - 1;
        continue;
      }
      out += conv(n);
    }
    return out;
  }
  function nary(n, base, operand) {
    const nm = name(n), k = kids(n), chr = moChar(base);
    let sub = null, sup = null;
    if (nm === "msub" || nm === "munder") sub = k[1];
    else if (nm === "msup" || nm === "mover") sup = k[1];
    else if (nm === "msubsup" || nm === "munderover") { sub = k[1]; sup = k[2]; }
    const und = (nm === "munder" || nm === "mover" || nm === "munderover") || (!INTEGRAL.test(chr) && nm === "mo");
    const pr = "<m:naryPr>" + val("chr", chr) + val("limLoc", und && !INTEGRAL.test(chr) ? "undOvr" : "subSup") +
      (sub ? "" : val("subHide", "1")) + (sup ? "" : val("supHide", "1")) + "</m:naryPr>";
    return tag("nary", "<m:sub>" + (sub ? conv(sub) : "") + "</m:sub><m:sup>" + (sup ? conv(sup) : "") + "</m:sup>" + e(operand), pr);
  }

  function matrix(t) {
    const rows = kids(t).filter((r) => /^(?:mtr|mlabeledtr)$/.test(name(r)));
    const cols = Math.max(1, ...rows.map((r) => kids(r).length));
    const al = String(t.getAttribute("columnalign") || "").split(/\s+/).filter(Boolean);
    const jc = (i) => { const a = al.length ? al[Math.min(i, al.length - 1)] : "center"; return a === "left" ? "left" : a === "right" ? "right" : "center"; };
    let mcs = "";
    for (let i = 0; i < cols; i++) mcs += "<m:mc><m:mcPr>" + val("count", "1") + val("mcJc", jc(i)) + "</m:mcPr></m:mc>";
    const body = rows.map((r) => {
      const cells = kids(r).filter((c) => name(c) === "mtd");
      while (cells.length < cols) cells.push(null);
      return "<m:mr>" + cells.map((c) => e(c ? seq(kids(c)) : "")).join("") + "</m:mr>";
    }).join("");
    return "<m:m><m:mPr>" + val("baseJc", "center") + "<m:mcs>" + mcs + "</m:mcs></m:mPr>" + body + "</m:m>";
  }

  function conv(n) {
    const nm = name(n), k = kids(n);
    switch (nm) {
      case "math": case "semantics": case "mstyle": case "mpadded": case "merror":
        return nm === "semantics" ? conv(k[0]) : seq(k);
      case "mrow": {
        // \left( … \right) → delimiter object; KaTeX marks them fence="true"
        if (k.length >= 2 && isFence(k[0]) && isFence(k[k.length - 1])) {
          const inner = k.slice(1, -1);
          // a | b separators inside \left( … \middle| … \right)
          const parts = [[]];
          inner.forEach((c) => { if (isFence(c) && name(c) === "mo" && /^[|‖∣]$/.test(txt(c).trim()) && c.getAttribute("fence") === "true") parts.push([]); else parts[parts.length - 1].push(c); });
          const pr = "<m:dPr>" + val("begChr", txt(k[0]).trim()) + (parts.length > 1 ? val("sepChr", "|") : "") + val("endChr", txt(k[k.length - 1]).trim()) + "</m:dPr>";
          return tag("d", parts.map((p) => e(seq(p))).join(""), pr);
        }
        // \begin{cases}: "{" fence + the table, no closing delimiter
        if (k.length === 2 && isFence(k[0]) && OPEN.test(txt(k[0]).trim()) && name(k[1]) === "mtable")
          return tag("d", e(conv(k[1])), "<m:dPr>" + val("begChr", txt(k[0]).trim()) + val("endChr", "") + "</m:dPr>");
        return seq(k);
      }
      case "mi": return run(txt(n), n, "mi");
      case "mn": return run(txt(n), n, "mn");
      case "mo": { const t = txt(n); if (NARY[t.trim()]) return nary(n, n, ""); return run(t, n, "mo"); }
      case "mtext": case "ms": return run(txt(n), n, "text");
      case "mspace": { const w = parseFloat(n.getAttribute("width") || "0"); return w >= 0.5 ? run(" ", null, "text") : ""; }
      case "mfrac": {
        const lt = n.getAttribute("linethickness");
        const pr = lt != null && parseFloat(lt) === 0 ? "<m:fPr>" + val("type", "noBar") + "</m:fPr>" : "";
        return tag("f", "<m:num>" + conv(k[0]) + "</m:num><m:den>" + conv(k[1]) + "</m:den>", pr);
      }
      case "msqrt": return tag("rad", "<m:deg/>" + e(seq(k)), "<m:radPr>" + val("degHide", "1") + "</m:radPr>");
      case "mroot": return tag("rad", "<m:deg>" + conv(k[1]) + "</m:deg>" + e(conv(k[0])));
      case "msup": return tag("sSup", e(conv(k[0])) + "<m:sup>" + conv(k[1]) + "</m:sup>");
      case "msub": return tag("sSub", e(conv(k[0])) + "<m:sub>" + conv(k[1]) + "</m:sub>");
      case "msubsup": return tag("sSubSup", e(conv(k[0])) + "<m:sub>" + conv(k[1]) + "</m:sub><m:sup>" + conv(k[2]) + "</m:sup>");
      case "mmultiscripts": {
        // base (sub sup)* <mprescripts/> (presub presup)* — <none/> is an empty script
        const at = k.findIndex((c) => name(c) === "mprescripts");
        const post = at < 0 ? k.slice(1) : k.slice(1, at), pre = at < 0 ? [] : k.slice(at + 1);
        const sc = (c) => (c && name(c) !== "none" ? conv(c) : "");
        let x = conv(k[0]);
        for (let j = 0; j < post.length; j += 2) {
          const sb = sc(post[j]), sp = sc(post[j + 1]);
          if (sb && sp) x = tag("sSubSup", e(x) + "<m:sub>" + sb + "</m:sub><m:sup>" + sp + "</m:sup>");
          else if (sb) x = tag("sSub", e(x) + "<m:sub>" + sb + "</m:sub>");
          else if (sp) x = tag("sSup", e(x) + "<m:sup>" + sp + "</m:sup>");
        }
        for (let j = 0; j < pre.length; j += 2) {
          const sb = sc(pre[j]), sp = sc(pre[j + 1]);
          if (sb || sp) x = tag("sPre", "<m:sub>" + sb + "</m:sub><m:sup>" + sp + "</m:sup>" + e(x));
        }
        return x;
      }
      case "munder": {
        const u = moChar(k[1]);
        if (u === "⏟" || u === "︸") return tag("groupChr", e(conv(k[0])), "<m:groupChrPr>" + val("chr", "⏟") + val("pos", "bot") + val("vertJc", "top") + "</m:groupChrPr>");
        if (u === "_" || u === "‾" || u === "¯" || u === "―") return tag("bar", e(conv(k[0])), "<m:barPr>" + val("pos", "bot") + "</m:barPr>");
        // \underbrace{x}_{label}: munder(munder(x, ⏟), label)
        return tag("limLow", e(conv(k[0])) + "<m:lim>" + conv(k[1]) + "</m:lim>");
      }
      case "mover": {
        const o = moChar(k[1]);
        if (o === "⏞" || o === "︷") return tag("groupChr", e(conv(k[0])), "<m:groupChrPr>" + val("chr", "⏞") + val("pos", "top") + val("vertJc", "bot") + "</m:groupChrPr>");
        if (o === "‾" || o === "―") return tag("bar", e(conv(k[0])), "<m:barPr>" + val("pos", "top") + "</m:barPr>");
        // \hat \bar \vec \tilde \dot … (an arrow is an accent only when KaTeX says so: \vec, \overrightarrow)
        if (o && ACC[o] && (n.getAttribute("accent") === "true" || !/^[→←↔]$/.test(o))) return tag("acc", e(conv(k[0])), "<m:accPr>" + val("chr", ACC[o]) + "</m:accPr>");
        return tag("limUpp", e(conv(k[0])) + "<m:lim>" + conv(k[1]) + "</m:lim>");
      }
      case "munderover":
        return tag("limUpp", e(tag("limLow", e(conv(k[0])) + "<m:lim>" + conv(k[1]) + "</m:lim>")) + "<m:lim>" + conv(k[2]) + "</m:lim>");
      case "mtable": return matrix(n);
      case "mtr": case "mlabeledtr": return kids(n).map(conv).join("");
      case "mtd": return seq(k);
      case "mfenced": {
        const o = n.getAttribute("open"), c = n.getAttribute("close"), sp = n.getAttribute("separators");
        // separators: "," when absent, none when empty (OMML holds one character)
        const sep = sp == null ? "," : String(sp).replace(/\s+/g, "").charAt(0);
        return tag("d", k.map((x) => e(conv(x))).join(""), "<m:dPr>" + val("begChr", o == null ? "(" : o) + (k.length > 1 ? val("sepChr", sep) : "") + val("endChr", c == null ? ")" : c) + "</m:dPr>");
      }
      case "menclose": {
        // \boxed → box; \cancel / \bcancel / \xcancel / \sout → strike lines without a frame
        const nt = String(n.getAttribute("notation") || "box").split(/\s+/);
        const has = (x) => nt.indexOf(x) >= 0;
        // schema order: hideTop, hideBot, hideLeft, hideRight, strikeH, strikeV, strikeBLTR, strikeTLBR
        const strikes = (has("horizontalstrike") ? val("strikeH", "1") : "") + (has("verticalstrike") ? val("strikeV", "1") : "") +
          (has("updiagonalstrike") ? val("strikeBLTR", "1") : "") + (has("downdiagonalstrike") ? val("strikeTLBR", "1") : "");
        const framed = has("box") || has("roundedbox") || has("circle");
        const HIDE = { top: "hideTop", bottom: "hideBot", left: "hideLeft", right: "hideRight" };
        const sides = framed ? "" : Object.keys(HIDE).filter((x) => !has(x)).map((x) => val(HIDE[x], "1")).join("");
        const pr = sides || strikes ? "<m:borderBoxPr>" + sides + strikes + "</m:borderBoxPr>" : "";
        return tag("borderBox", e(seq(k)), pr);
      }
      case "mphantom": case "annotation": case "annotation-xml": case "none": case "mprescripts": return "";
      default: return k.length ? seq(k) : (txt(n) ? run(txt(n), n, "mi") : "");
    }
  }

  function fromMathML(math) { return "<m:oMath>" + conv(math) + "</m:oMath>"; }

  const cache = new Map();
  function fromTex(tex, display) {
    const K = global.katex;
    if (!K || typeof DOMParser === "undefined") return null;
    const key = (display ? "D" : "I") + tex;
    if (cache.has(key)) return cache.get(key);
    let out = null;
    try {
      const mml = K.renderToString(String(tex).trim(), { output: "mathml", throwOnError: true, displayMode: !!display, strict: false });
      const m = /<math[\s\S]*<\/math>/.exec(mml);
      if (m) {
        let doc = new DOMParser().parseFromString(m[0], "application/xml");
        if (doc.getElementsByTagName("parsererror").length) doc = new DOMParser().parseFromString(m[0], "text/html");
        const math = doc.getElementsByTagName("math")[0];
        if (math) out = fromMathML(math);
      }
    } catch (err) { out = null; }
    if (cache.size > 500) cache.clear();
    cache.set(key, out);
    return out;
  }

  global.DOCXMDOmml = { fromTex, fromMathML };
})(typeof window !== "undefined" ? window : this);
