/* ============================================================
   DOCXMD — "Clean up scientific notation" rules (shared with the VS Code extension)
   Finds notation left over by PDF→Markdown converters (MinerU, marker…) and plain
   typing, and proposes replacements; nothing is changed without the user's consent.

     $T_{Core}$, T _ { Core }   → T<sub>Core</sub>
     $R^2$, R ^ { 2 }, R^2      → R<sup>2</sup>
     $ \delta $, $\Delta$       → δ, Δ
     CO2, SpO2, TCore (dictionary) → CO<sub>2</sub>, SpO<sub>2</sub>, T<sub>Core</sub>
     36.7°C, 120mmHg            → 36.7 °C, 120 mmHg

   Never touches: fenced / inline code, display math, link and image URLs, bare URLs,
   HTML tags and comments, front matter, {#…} attributes, @refs, [^notes].
   Formulas that are more than "letters with one level of indices" ($\frac…$, sums,
   roots, nested indices) are left as they are and only counted.

   API: window.DOCXMDSciClean = { scan(text, opts), apply(text, changes), DEFAULT_DICT, parseDict }
   ============================================================ */
(function (global) {
  "use strict";

  // ---- dictionary --------------------------------------------------------
  // One entry per line: "FROM = TeX-like target" (T_{Core}, R^{2}, HbA_{1c}).
  // "FROM" alone: digits after letters become subscripts (chemical formula).
  const DEFAULT_DICT = [
    "SpO2 = SpO_{2}", "CO2 = CO_{2}", "O2 = O_{2}", "H2O = H_{2}O", "HbA1c = HbA_{1c}",
    "PaO2 = PaO_{2}", "PaCO2 = PaCO_{2}", "SaO2 = SaO_{2}", "EtCO2 = EtCO_{2}",
    "TCore = T_{Core}", "TPeriphery = T_{Periphery}", "TMean = T_{Mean}", "TStd = T_{Std}",
    "R2 = R^{2}"
  ].join("\n");

  function parseDict(text) {
    const out = [];
    String(text || "").split(/\r?\n/).forEach((line) => {
      line = line.replace(/\s+#.*$/, "").trim();
      if (!line || line[0] === "#") return;
      const m = /^(\S+)\s*(?:=|→|->)\s*(\S.*)$/.exec(line);
      const from = m ? m[1] : line.split(/\s+/)[0];
      const to = m ? m[2].trim() : from.replace(/([A-Za-z)\]])(\d+)/g, "$1_{$2}");
      if (from && to && from !== to) out.push({ from, to });
    });
    return out;
  }

  // ---- TeX subset → segments --------------------------------------------
  const SYM = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
    vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
    varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    ell: "ℓ", hbar: "ℏ", infty: "∞", partial: "∂", nabla: "∇", degree: "°", textdegree: "°", circ: "°", prime: "′",
    ldots: "…", dots: "…", cdots: "⋯", percent: "%", micro: "µ", textmu: "µ", AA: "Å", angstrom: "Å"
  };
  // operators that get a space on both sides
  const OPS = {
    "=": "=", "<": "<", ">": ">", "+": "+", "-": "-", pm: "±", mp: "∓", times: "×", cdot: "·", div: "÷",
    approx: "≈", sim: "~", simeq: "≃", neq: "≠", ne: "≠", leq: "≤", le: "≤", geq: "≥", ge: "≥", ll: "≪", gg: "≫",
    equiv: "≡", propto: "∝", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", leftrightarrow: "↔"
  };
  const SPACE_CMDS = /^(,|;|:|!| |quad|qquad|enspace|thinspace)$/;
  const TEXT_CMDS = /^(text|mathrm|textrm|rm|mathit|textit|mathsf|operatorname|mathup|up|textnormal|mbox)$/;
  const IGNORE_CMDS = /^(left|right|big|Big|bigl|bigr|Bigl|Bigr|displaystyle|textstyle|limits|nolimits)$/;
  const FN_CMDS = /^(sin|cos|tan|log|ln|exp|lg|max|min|lim|arg|det|mod)$/;

  // segments: [{ t: "text" | "sub" | "sup", v }] — null when the formula is too complex
  function texToSegs(tex, inScript) {
    const s = String(tex);
    const segs = [];
    let i = 0;
    const push = (t, v) => { if (!v) return; const l = segs[segs.length - 1]; if (l && l.t === t) l.v += v; else segs.push({ t, v }); };
    const op = (v) => {
      const l = segs[segs.length - 1];
      // unary minus / plus (nothing before, or right after another operator)
      const unary = (v === "-" || v === "+") && (!l || /[\s(=<>≤≥≈×·±\[]$/.test(l.v) && l.t === "text");
      if (unary || inScript) push("text", v);
      else { if (l && l.t === "text") l.v = l.v.replace(/ +$/, ""); push("text", " " + v + " "); }
    };
    function group() {           // after "{": read until the matching "}"
      let depth = 1; const start = i;
      while (i < s.length && depth) { if (s[i] === "\\") { i += 2; continue; } if (s[i] === "{") depth++; else if (s[i] === "}") depth--; i++; }
      if (depth) return null;
      return s.slice(start, i - 1);
    }
    function script(kind) {
      while (s[i] === " ") i++;
      let body;
      if (s[i] === "{") { i++; body = group(); if (body == null) return false; }
      else if (s[i] === "\\") { const m = /^\\([A-Za-z]+)/.exec(s.slice(i)); if (!m) return false; body = m[0]; i += m[0].length; }
      else if (i < s.length) { body = s[i]; i++; }
      else return false;
      const b = body.replace(/\s+/g, " ").trim();
      // ^{\circ} / ^\circ → "°" on the line; ^{\prime} → ′
      if (kind === "sup" && /^\\circ$/.test(b)) { push("text", "°"); return true; }
      if (kind === "sup" && /^(\\prime|')$/.test(b)) { push("text", "′"); return true; }
      if (inScript) return false;                        // nested index → too complex
      const inner = texToSegs(b, true);
      if (!inner) return false;
      const v = inner.map((x) => x.v).join("").trim();
      if (!v) return false;
      push(kind, v);
      return true;
    }
    while (i < s.length) {
      const c = s[i];
      if (c === " " || c === "\t" || c === "\n") {
        // spaces in TeX are not printed — keep one between words inside \text only
        i++; continue;
      }
      if (c === "_" || c === "^") { i++; if (!script(c === "_" ? "sub" : "sup")) return null; continue; }
      if (c === "{") { i++; const g = group(); if (g == null) return null; const inner = texToSegs(g, inScript); if (!inner) return null; inner.forEach((x) => push(x.t, x.v)); continue; }
      if (c === "}" || c === "&" || c === "#") return null;
      if (c === "~") { push("text", " "); i++; continue; }
      if (c === "\\") {
        const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
        if (!m) return null;
        const name = m[1]; i += m[0].length;
        if (SPACE_CMDS.test(name)) { push("text", " "); continue; }
        if (name === "%" || name === "$" || name === "_" || name === "&" || name === "#" || name === "{" || name === "}") { push("text", name); continue; }
        if (IGNORE_CMDS.test(name)) continue;
        if (TEXT_CMDS.test(name)) {
          while (s[i] === " ") i++;
          if (s[i] !== "{") return null;
          i++; const g = group(); if (g == null) return null;
          if (/[\\^_$]/.test(g.replace(/\\[,; ]/g, " "))) return null;
          push("text", g.replace(/\\[,; ]/g, " ").replace(/\s+/g, name === "text" || name === "textrm" || name === "mbox" || name === "textnormal" ? " " : ""));
          continue;
        }
        if (FN_CMDS.test(name)) { push("text", name); continue; }
        if (SYM[name]) { push("text", SYM[name]); continue; }
        if (OPS[name]) { op(OPS[name]); continue; }
        return null;                                      // \frac, \sqrt, \sum, \int, \begin…
      }
      if (c === "=" || c === "<" || c === ">" || c === "+" || c === "-") { op(c); i++; continue; }
      if (/[\p{L}\p{N}.,;:!?()\[\]\/|'*%°]/u.test(c)) { push("text", c); i++; continue; }
      return null;
    }
    // tidy: collapse doubled spaces
    segs.forEach((x) => { x.v = x.v.replace(/ {2,}/g, " "); });
    if (segs.length) { segs[0].v = segs[0].v.replace(/^ +/, ""); const l = segs[segs.length - 1]; l.v = l.v.replace(/ +$/, ""); }
    return segs.filter((x) => x.v);
  }

  // ---- output ------------------------------------------------------------
  const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
  const SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ" };
  const mdEscape = (x) => x.replace(/([*_`\\])/g, "\\$1").replace(/<(?=[A-Za-z\/!])/g, "&lt;");
  // → { text, html: boolean } — Unicode falls back to tags when a character has no
  // Unicode sub/superscript (e.g. T_{Core}); `unicodeFallback` tells the dialog.
  function render(segs, format, escapeText) {
    const esc = escapeText ? mdEscape : (x) => x;
    let fallback = false;
    const out = segs.map((x) => {
      if (x.t === "text") return esc(x.v);
      if (format === "unicode") {
        const map = x.t === "sub" ? SUB : SUP;
        if (x.v.split("").every((ch) => map[ch])) return x.v.split("").map((ch) => map[ch]).join("");
        fallback = true;
      }
      return "<" + x.t + ">" + esc(x.v) + "</" + x.t + ">";
    }).join("");
    return { text: out, fallback };
  }

  // ---- protected ranges ----------------------------------------------------
  function protectedRanges(text) {
    const R = [];
    const add = (s, e) => { if (e > s) R.push([s, e]); };
    const scanRe = (re) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) { add(m.index, m.index + m[0].length); if (!m[0].length) re.lastIndex++; } };
    // front matter
    const fm = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    if (fm) add(0, fm[0].length);
    // fenced code blocks (line based)
    const lines = text.split("\n");
    let pos = 0, fence = null, fStart = 0;
    for (const line of lines) {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) { add(fStart, pos + line.length); fence = null; } }
      else if (m) { fence = m[1]; fStart = pos; }
      pos += line.length + 1;
    }
    if (fence) add(fStart, text.length);
    scanRe(/(`+)[\s\S]*?[^`]\1(?!`)|(`+)[^`\n]\2(?!`)/g);     // inline code
    // display math (same rules as the preview: \[ at a line start, \] ends its line, no blank line inside)
    scanRe(/\$\$(?:(?!\n[ \t]*\n)[^$])+?\$\$|(?:^|\n)[ \t]{0,3}\\\[(?:(?!\n[ \t]*\n)[\s\S])+?\\\][ \t]*(?=\n|$)/g);
    scanRe(/<!--[\s\S]*?-->/g);                                // HTML comments
    scanRe(/<\/?[A-Za-z][^<>\n]*>/g);                          // HTML tags (+ attributes)
    scanRe(/\]\([^)\n]*\)|\]\[[^\]\n]*\]/g);                   // link / image targets
    scanRe(/^\s{0,3}\[(?!\^)[^\]\n]+\]:\s*\S+.*$/gm);           // reference definitions (not footnotes)
    scanRe(/<(?:https?|mailto|ftp):[^>\s]+>|(?:https?|ftp):\/\/[^\s<>()\]]+|www\.[^\s<>()\]]+/g); // URLs
    scanRe(/\{#[^}\n]*\}|\{[^}\n]*\bwidth\s*=[^}\n]*\}/g);     // {#fig:…} {width=…}
    scanRe(/\[?@(?:fig|tbl|sec):[A-Za-z0-9_-]+\]?|\[\^[^\]\s]+\]/g); // cross-refs, footnote ids
    scanRe(/^\s*:::[^\n]*$/gm);                                // ::: box fences
    scanRe(/!\[[^\]\n]*\]/g);                                  // image alt text
    R.sort((a, b) => a[0] - b[0]);
    return R;
  }
  function makeGuard(R) {
    // binary search over sorted (possibly overlapping) ranges
    const merged = [];
    R.forEach((r) => { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([r[0], r[1]]); });
    return (s, e) => {
      let lo = 0, hi = merged.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, r = merged[mid];
        if (r[1] <= s) lo = mid + 1; else if (r[0] >= e) hi = mid - 1; else return true;
      }
      return false;
    };
  }

  // ---- inline math spans ($…$ and \(…\)) -------------------------------------
  function mathSpans(text, isProtected) {
    const out = [];
    const re = /\\\(([^\n]+?)\\\)|(?<![\\$])\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g;
    let m;
    while ((m = re.exec(text))) {
      const s = m.index, e = s + m[0].length;
      if (isProtected(s, e)) continue;
      const body = m[1] != null ? m[1] : m[2];
      if (m[2] != null) {
        // "$5 and $10" is money, not math. Pandoc's rule — no space just inside the
        // dollars, no digit right after the closing one — is relaxed only for bodies
        // that are clearly TeX (MinerU writes "$ \delta $", "$ T _ { Core } $").
        const tex = /[\\_^{]/.test(body);
        if (/^\d/.test(text.slice(e, e + 1)) || (!tex && (/^\s|\s$/.test(body)))) { re.lastIndex = e - 1; continue; }
      }
      out.push({ start: s, end: e, body });
    }
    return out;
  }
  // prose written between dollars ("$ and some text $") is not a formula
  const looksLikeProse = (tex) => /(?:^|[^\\A-Za-z])[A-Za-zА-Яа-яІіЇїЄєҐґ]{3,}\s+[A-Za-zА-Яа-яІіЇїЄєҐґ]{3,}/.test(tex.replace(/\\(?:text|mathrm|operatorname|textrm|mbox)\s*\{[^}]*\}/g, ""));

  // ---- scan -----------------------------------------------------------------
  const UNITS = [
    "mmHg", "mm Hg", "mmol/L", "mmol/l", "µmol/L", "μmol/L", "mg/dL", "mg/dl", "mg/kg", "g/dL", "g/dl", "mL/min", "ml/min",
    "kPa", "Pa", "kHz", "MHz", "GHz", "Hz", "kcal", "bpm", "dB", "°C", "°F", "°С",
    "mmol", "µmol", "μmol", "nmol", "mg", "µg", "μg", "ng", "kg", "mL", "ml", "dL", "dl", "cm", "mm", "µm", "μm", "nm", "km",
    "ms", "min", "kW", "mW", "mV", "mA", "W", "V", "m", "g", "h", "L",
    "мм рт. ст.", "мм рт.ст.", "ммоль/л", "мг/дл", "кПа", "Гц", "уд/хв", "мкг", "мкм", "кг", "мг", "мл", "см", "мм", "км", "хв", "год", "г", "м"
  ];
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  const UNIT_RE = new RegExp("(?<=\\d)(" + UNITS.slice().sort((a, b) => b.length - a.length).map(escRe).join("|") + ")(?![\\p{L}\\p{N}])", "gu");

  /* opts: { format: "html"|"unicode", rules: { math, script, dict, units }, dict: string,
             nbsp: boolean (non-breaking space before units), percent: boolean (space before %) }
     → { changes: [{ start, end, from, to, rule, fallback }], skipped: n } */
  function scan(text, opts) {
    opts = opts || {};
    const rules = Object.assign({ math: true, script: true, dict: true, units: true }, opts.rules || {});
    const format = opts.format === "unicode" ? "unicode" : "html";
    text = String(text || "");
    const R = protectedRanges(text);
    const math = mathSpans(text, makeGuard(R));
    const guard = makeGuard(R.concat(math.map((x) => [x.start, x.end])));   // math is off-limits for the other rules
    const changes = [];
    const taken = [];
    const free = (s, e) => !taken.some((r) => s < r[1] && e > r[0]);
    const add = (c) => { if (c.from === c.to || !free(c.start, c.end)) return; taken.push([c.start, c.end]); changes.push(c); };
    let skipped = 0;

    // 1. inline formulas that are only letters, symbols and one level of indices
    math.forEach((mt) => {
      const segs = looksLikeProse(mt.body) ? null : texToSegs(mt.body, false);
      if (!segs || !segs.length) { skipped++; return; }
      if (!rules.math) return;
      const r = render(segs, format, true);
      add({ start: mt.start, end: mt.end, from: text.slice(mt.start, mt.end), to: r.text, rule: "math", fallback: r.fallback });
    });

    // 2. MinerU index / power artefacts in plain text: T _ { Core }, R ^ { 2 }, R^2, T_Core
    if (rules.script) {
      const re = /(?<=[\p{L}\p{N})])[ \t]*([_^])[ \t]*\{((?:[^{}\n$]|\{[^{}\n$]*\})+)\}|(?<=[\p{L}\p{N})])\^(-?\d+)(?![\p{L}\p{N}])|(?<=(?<![\p{L}\p{N}_])\p{Lu})_(\d+|[A-Za-z]{1,12})(?![\p{L}\p{N}_])/gu;
      let m;
      while ((m = re.exec(text))) {
        const s = m.index, e = s + m[0].length;
        if (guard(s, e)) continue;
        let tex;
        if (m[1]) tex = m[1] + "{" + m[2] + "}";
        else if (m[3]) tex = "^{" + m[3] + "}";
        else tex = "_{" + m[4] + "}";
        const segs = texToSegs(tex, false);
        if (!segs || !segs.length) continue;
        const r = render(segs, format, true);
        add({ start: s, end: e, from: m[0], to: r.text, rule: "script", fallback: r.fallback });
      }
    }

    // 3. dictionary: CO2, SpO2, TCore …
    if (rules.dict) {
      const dict = parseDict(opts.dict != null ? opts.dict : DEFAULT_DICT);
      if (dict.length) {
        const byFrom = new Map(dict.map((d) => [d.from, d.to]));
        const re = new RegExp("(?<![\\p{L}\\p{N}_])(?:" + dict.map((d) => d.from).sort((a, b) => b.length - a.length).map(escRe).join("|") + ")(?![\\p{L}\\p{N}])", "gu");
        let m;
        while ((m = re.exec(text))) {
          const s = m.index, e = s + m[0].length;
          if (guard(s, e)) continue;
          // already formatted: CO<sub>2</sub> never matches; skip inside <sub>…</sub> text
          if (/<su[bp]>$/.test(text.slice(Math.max(0, s - 5), s))) continue;
          const segs = texToSegs(byFrom.get(m[0]), false);
          if (!segs || !segs.length) continue;
          const r = render(segs, format, false);
          add({ start: s, end: e, from: m[0], to: r.text, rule: "dict", fallback: r.fallback });
        }
      }
    }

    // 4. a space between a number and its unit: 36.7°C → 36.7 °C, 120mmHg → 120 mmHg
    if (rules.units) {
      const sp = opts.nbsp ? "\u00A0" : " ";
      let m;
      UNIT_RE.lastIndex = 0;
      while ((m = UNIT_RE.exec(text))) {
        const s = m.index, e = s + m[0].length;
        if (guard(s - 1, e)) continue;
        // not part of an identifier (A4, 3D, T2mm): the number must start after a non-letter
        const before = text.slice(Math.max(0, s - 24), s);
        const num = /(?:^|[^\p{L}\p{N}_.,])([+\-−±]?\d+(?:[.,]\d+)*)$/u.exec(before);
        if (!num) continue;
        add({ start: s, end: e, from: text.slice(s - num[1].length, e), to: num[1] + sp + m[0], rule: "units", fallback: false, keep: num[1].length });
      }
      if (opts.percent) {
        const re = /(?<=\d)%/g;
        while ((m = re.exec(text))) {
          const s = m.index;
          if (guard(s - 1, s + 1)) continue;
          const before = text.slice(Math.max(0, s - 24), s);
          const num = /(?:^|[^\p{L}\p{N}_.,])([+\-−±]?\d+(?:[.,]\d+)*)$/u.exec(before);
          if (!num) continue;
          add({ start: s, end: s + 1, from: num[1] + "%", to: num[1] + sp + "%", rule: "units", fallback: false, keep: num[1].length });
        }
      }
    }
    changes.sort((a, b) => a.start - b.start);
    return { changes, skipped };
  }

  // Replacement text for one change as it is written into [start, end)
  // (unit changes show the number for context but only replace the unit).
  function insertText(c) { return c.keep ? c.to.slice(c.keep) : c.to; }

  // Apply the chosen changes → { text, first, last } (the changed range, for a single undo step)
  function apply(text, changes) {
    const list = changes.slice().sort((a, b) => a.start - b.start);
    let out = "", pos = 0, first = -1, last = -1;
    list.forEach((c) => {
      if (c.start < pos) return;
      if (first < 0) first = c.start;
      out += text.slice(pos, c.start) + insertText(c);
      pos = c.end; last = c.end;
    });
    out += text.slice(pos);
    return { text: out, first, last };
  }

  // Preview HTML of a change's result (for the dialog): tags rendered, text escaped
  function previewHtml(to) {
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return esc(to).replace(/&lt;(\/?)(sub|sup)&gt;/g, "<$1$2>").replace(/\u00A0/g, '<span class="sc-nbsp">·</span>').replace(/\\([*_`\\])/g, "$1");
  }

  global.DOCXMDSciClean = { scan, apply, insertText, previewHtml, parseDict, texToSegs, DEFAULT_DICT };
})(typeof window !== "undefined" ? window : this);
