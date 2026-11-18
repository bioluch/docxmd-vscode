/* DOCXMD — citations and bibliography (BibTeX / RIS / CSL-JSON + CSL styles).
   Pandoc-compatible syntax:
     ---
     bibliography: refs.bib        # or [refs.bib, more.json]; "inline" = ```bibtex blocks in the text
     csl: dstu-8302-2015           # built-in id (see STYLES) or a path to a .csl file
     lang: uk                      # CSL locale
     link-citations: true          # citation → link to its entry (default true)
     reference-section-title: Список використаних джерел
     nocite: [@smith2020, @*]
     ---
     [@kovalenko2021, с. 33]   [@smith2020; @doe2019, p. 5–7]   [-@doe2019]   @kovalenko2021 says …
     [BIB]  or  ::: {#refs}\n:::  — where the list goes (otherwise at the end)
   Data: files next to the .md (resolver from the host), ```bibtex / ```csl-json / ```ris
   blocks in the document, and the attached library ("My library", host callback).
   Formatting: citeproc-js (js/vendor/citeproc/, loaded on first use; CPAL/AGPL, unmodified).
   Rendering is synchronous (marked); until the engine and data are loaded citations show as
   grey [@key] and onChange() asks the host to render again.

   window.DOCXMDCite = { configure, extensions, collect, process, ensure, last, parse, parseBibtex,
     htmlSegments, entryParts, stats, items, STYLES, styleId, localeOf, keyFor, invalidate } */
(function (global) {
  "use strict";

  const STYLES = [
    { id: "dstu-8302-2015", title: "ДСТУ 8302:2015", numeric: true },
    { id: "apa", title: "APA 7th" },
    { id: "ieee", title: "IEEE", numeric: true },
    { id: "vancouver", title: "Vancouver (NLM)", numeric: true },
    { id: "harvard-cite-them-right", title: "Harvard (Cite Them Right)" },
    { id: "chicago-author-date", title: "Chicago (author-date)" },
    { id: "modern-language-association", title: "MLA 9th" }
  ];
  const ALIAS = { dstu: "dstu-8302-2015", "dstu-8302": "dstu-8302-2015", "dstu8302": "dstu-8302-2015", mla: "modern-language-association",
    harvard: "harvard-cite-them-right", chicago: "chicago-author-date", nlm: "vancouver", "nlm-citation-sequence": "vancouver", "apa7": "apa" };
  const LOCALES = { uk: "uk-UA", en: "en-US", es: "es-ES", pt: "pt-BR", ja: "ja-JP", zh: "zh-CN", "zh-hant": "zh-TW" };
  const BIB_WORD = { en: "References", uk: "Список використаних джерел", es: "Referencias", pt: "Referências", ja: "参考文献", zh: "参考文献", "zh-TW": "參考文獻" };
  const AND_WORD = { en: "and", uk: "і", es: "y", pt: "e", ja: "と", zh: "和" };
  const ETAL_WORD = { en: "et al.", uk: "та ін.", es: "et al.", pt: "et al.", ja: "ほか", zh: "等" };
  const DATA_LANG = /^(?:bibtex|biblatex|bib|csl-json|csljson|ris)$/i;
  const CROSSREF_KEY = /^(?:fig|tbl|sec|eq|lst):/;

  const cfg = { base: "js/vendor/citeproc/", resolve: null, library: null, onChange: null, scope: () => "", uiLang: () => (global.I18N && global.I18N.lang) || "en" };
  function configure(o) { Object.assign(cfg, o || {}); }

  /* ---------------- text helpers ---------------- */
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»" };
  const decodeEnt = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m));
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stripTags = (h) => decodeEnt(String(h || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ":" + s.length; }

  /* ---------------- BibTeX ---------------- */
  const LATEX_ACC = { "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇", u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", r: "̊", d: "̣", b: "̱" };
  const LATEX_SYM = { ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", o: "ø", O: "Ø", l: "ł", L: "Ł", i: "ı", j: "ȷ", aa: "å", AA: "Å", dh: "ð", th: "þ", textendash: "–", textemdash: "—", textquoteleft: "‘", textquoteright: "’", textquotedblleft: "“", textquotedblright: "”", S: "§", P: "¶", copyright: "©", textregistered: "®", dag: "†", ldots: "…", textellipsis: "…", textasciitilde: "~", textbackslash: "\\", textunderscore: "_", textbar: "|", euro: "€", pounds: "£", guillemotleft: "«", guillemotright: "»", No: "№" };
  function latexToText(s) {
    s = String(s);
    s = s.replace(/\\([`'^"~=.uvHckrdb])\s*\{\\?([a-zA-Z])\}|\\([`'^"~=.])\\?([a-zA-Z])|\\([uvHckrdb])\s+\\?([a-zA-Z])/g, (m, a1, c1, a2, c2, a3, c3) => {
      const a = a1 || a2 || a3, c = c1 || c2 || c3;
      return (c + LATEX_ACC[a]).normalize("NFC");
    });
    s = s.replace(/\\([a-zA-Z]+)\b\s?(?:\{\})?/g, (m, n) => (LATEX_SYM[n] != null ? LATEX_SYM[n] : /^(?:textit|emph|textbf|textsc|textrm|textsf|texttt|mathrm|url|href|textup|mbox|text|uppercase|lowercase)$/.test(n) ? "" : m));
    s = s.replace(/\\([&%$#_{}])/g, "$1").replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ").replace(/``|''/g, '"');
    s = s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    return s;
  }
  // "Last, First and First Last and {Org Name}" → CSL names
  function bibNames(v) {
    const parts = []; let depth = 0, cur = "";
    const s = String(v).replace(/\s+/g, " ");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "{") depth++; else if (c === "}") depth--;
      if (!depth && /^ and /i.test(s.slice(i, i + 5))) { parts.push(cur); cur = ""; i += 4; continue; }
      cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => {
      p = p.trim();
      if (/^\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}$/.test(p)) return { literal: latexToText(p) };
      if (/^others$/i.test(p)) return { literal: "others" };
      const commas = splitTop(p, ",");
      if (commas.length >= 2) return { family: latexToText(commas[0]), given: latexToText(commas.slice(commas.length === 3 ? 2 : 1).join(" ")), suffix: commas.length === 3 ? latexToText(commas[1]) : undefined };
      const words = splitTop(p, " ").filter(Boolean);
      if (words.length === 1) return { family: latexToText(words[0]) };
      // von part: first lowercase word starts the family name
      let k = words.findIndex((w, i) => i > 0 && i < words.length - 1 && /^[a-z]/.test(w));
      if (k < 0) k = words.length - 1;
      return { given: latexToText(words.slice(0, k).join(" ")), family: latexToText(words.slice(k).join(" ")) };
    }).map((n) => { if (n.suffix === undefined) delete n.suffix; return n; });
  }
  function splitTop(s, sep) {
    const out = []; let depth = 0, cur = "";
    for (const c of s) { if (c === "{") depth++; else if (c === "}") depth--; if (c === sep && !depth) { out.push(cur.trim()); cur = ""; } else cur += c; }
    out.push(cur.trim());
    return out;
  }
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function dateParts(y, m, d) {
    const s = String(y || "").trim();
    let iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:\/(\d{4})(?:-(\d{1,2}))?)?/.exec(s);
    if (!iso) { const yy = /\d{4}/.exec(s); if (!yy) return s ? { literal: s } : null; iso = [yy[0], yy[0]]; }
    const p = [+iso[1]];
    const mm = iso[2] ? +iso[2] : m ? (MONTHS[String(m).toLowerCase().slice(0, 3)] || +m || 0) : 0;
    if (mm) { p.push(mm); const dd = iso[3] ? +iso[3] : d ? +d : 0; if (dd) p.push(dd); }
    const out = { "date-parts": [p] };
    if (iso[4]) out["date-parts"].push([+iso[4]].concat(iso[5] ? [+iso[5]] : []));
    return out;
  }
  const BIB_TYPE = { article: "article-journal", book: "book", mvbook: "book", booklet: "pamphlet", inbook: "chapter", incollection: "chapter", inreference: "entry-encyclopedia",
    inproceedings: "paper-conference", conference: "paper-conference", proceedings: "book", collection: "book", phdthesis: "thesis", mastersthesis: "thesis", thesis: "thesis",
    techreport: "report", report: "report", manual: "book", misc: "document", online: "webpage", electronic: "webpage", www: "webpage", standard: "standard",
    patent: "patent", dataset: "dataset", software: "software", unpublished: "manuscript", periodical: "periodical", legislation: "legislation", law: "legislation", jurisdiction: "legal_case" };
  function parseBibtex(text) {
    const items = [], strings = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December" };
    const s = String(text);
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function braced() { let depth = 0, start = i + 1; for (; i < s.length; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === "{") depth++; else if (s[i] === "}") { depth--; if (!depth) { i++; return s.slice(start, i - 1); } } } return s.slice(start); }
    function quoted() { let depth = 0, start = ++i; for (; i < s.length; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === "{") depth++; else if (s[i] === "}") depth--; else if (s[i] === '"' && !depth) { i++; return s.slice(start, i - 1); } } return s.slice(start); }
    function value() {
      let out = "";
      for (;;) {
        ws();
        if (s[i] === "{") out += braced();
        else if (s[i] === '"') out += quoted();
        else { const m = /^[^\s,#}\)]+/.exec(s.slice(i)); if (!m) break; i += m[0].length; out += /^\d+$/.test(m[0]) ? m[0] : (strings[m[0].toLowerCase()] != null ? strings[m[0].toLowerCase()] : m[0]); }
        ws(); if (s[i] === "#") { i++; continue; } break;
      }
      return out;
    }
    while (i < s.length) {
      const at = s.indexOf("@", i); if (at < 0) break;
      i = at + 1;
      const tm = /^([a-zA-Z]+)\s*([{(])/.exec(s.slice(i)); if (!tm) continue;
      const type = tm[1].toLowerCase(); i += tm[0].length;
      const closeCh = tm[2] === "{" ? "}" : ")";
      if (type === "comment") { i--; if (tm[2] === "{") braced(); continue; }
      if (type === "preamble") { value(); continue; }
      if (type === "string") {
        ws(); const nm = /^[^\s=]+/.exec(s.slice(i)); if (!nm) continue; i += nm[0].length; ws(); if (s[i] === "=") i++;
        strings[nm[0].toLowerCase()] = value(); ws(); if (s[i] === closeCh) i++; continue;
      }
      ws(); const km = /^[^,\s}]+/.exec(s.slice(i)); if (!km) continue;
      const key = km[0]; i += key.length; ws(); if (s[i] === ",") i++;
      const f = {};
      for (;;) {
        ws(); if (i >= s.length || s[i] === closeCh) { i++; break; }
        const fm = /^([^\s=,}]+)\s*=/.exec(s.slice(i)); if (!fm) { i++; continue; }
        i += fm[0].length;
        f[fm[1].toLowerCase()] = value();
        ws(); if (s[i] === ",") i++;
      }
      items.push(bibToCsl(type, key, f));
    }
    return items;
  }
  function bibToCsl(type, key, f) {
    const t = (v) => (v == null ? undefined : latexToText(v));
    const it = { id: key, type: BIB_TYPE[type] || "document" };
    if (type === "misc" && (f.url || f.howpublished && /\\url/.test(f.howpublished))) it.type = "webpage";
    if (type === "mastersthesis") it.genre = "Master's thesis";
    if (type === "phdthesis") it.genre = "PhD thesis";
    if (f.author) it.author = bibNames(f.author);
    if (f.editor) it.editor = bibNames(f.editor);
    if (f.translator) it.translator = bibNames(f.translator);
    if (f.title) it.title = t(f.title);
    if (f.subtitle) it.title = (it.title || "") + ": " + t(f.subtitle);
    const cont = f.journal || f.journaltitle || f.booktitle || f.maintitle;
    if (cont) it["container-title"] = t(cont);
    if (f.series) it["collection-title"] = t(f.series);
    if (f.publisher || f.school || f.institution || f.organization) it.publisher = t(f.publisher || f.school || f.institution || f.organization);
    if (f.address || f.location) it["publisher-place"] = t(f.address || f.location);
    const issued = dateParts(f.date || f.year, f.month, f.day); if (issued) it.issued = issued;
    if (f.urldate) { const a = dateParts(f.urldate); if (a) it.accessed = a; }
    if (f.volume) it.volume = t(f.volume);
    if (f.number || f.issue) { if (it.type === "article-journal" || f.issue) it.issue = t(f.issue || f.number); else it.number = t(f.number); }
    if (f.pages) it.page = t(f.pages).replace(/\s*[-–—]+\s*/g, "–");
    if (f.pagetotal) it["number-of-pages"] = t(f.pagetotal);
    if (f.edition) it.edition = t(f.edition);
    if (f.chapter) it["chapter-number"] = t(f.chapter);
    if (f.doi) it.DOI = String(f.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
    if (f.url) it.URL = String(f.url).replace(/^\\url\{|\}$/g, "").trim();
    if (f.isbn) it.ISBN = t(f.isbn);
    if (f.issn) it.ISSN = t(f.issn);
    if (f.note || f.howpublished) it.note = t(f.note || f.howpublished);
    if (f.language || f.langid) it.language = t(f.language || f.langid);
    if (f.type) it.genre = t(f.type);
    if (f.abstract) it.abstract = t(f.abstract);
    if (f.keywords) it.keyword = t(f.keywords);
    return it;
  }

  /* ---------------- RIS ---------------- */
  const RIS_TYPE = { JOUR: "article-journal", JFULL: "article-journal", EJOUR: "article-journal", MGZN: "article-magazine", NEWS: "article-newspaper", BOOK: "book", EBOOK: "book", EDBOOK: "book", CHAP: "chapter", ECHAP: "chapter", CONF: "paper-conference", CPAPER: "paper-conference", THES: "thesis", RPRT: "report", ELEC: "webpage", WEB: "webpage", STAND: "standard", PAT: "patent", DATA: "dataset", COMP: "software", UNPB: "manuscript", MAP: "map", GEN: "document" };
  function parseRis(text) {
    const items = []; let cur = null;
    String(text).split(/\r?\n/).forEach((line) => {
      const m = /^([A-Z][A-Z0-9])  - ?(.*)$/.exec(line); if (!m) return;
      const tag = m[1], v = m[2].trim();
      if (tag === "TY") { cur = { _: {}, type: RIS_TYPE[v] || "document", author: [], editor: [] }; return; }
      if (!cur) return;
      if (tag === "ER") { items.push(finishRis(cur)); cur = null; return; }
      const name = (x) => { const p = x.split(","); return p.length > 1 ? { family: p[0].trim(), given: p.slice(1).join(",").trim() } : { literal: x }; };
      switch (tag) {
        case "AU": case "A1": cur.author.push(name(v)); break;
        case "A2": case "ED": case "A3": cur.editor.push(name(v)); break;
        case "TI": case "T1": cur.title = v; break;
        case "T2": case "JO": case "JF": case "JA": case "BT": if (!cur["container-title"] || tag === "T2" || tag === "JF") cur["container-title"] = v; break;
        case "PY": case "Y1": case "DA": if (!cur.issued || tag === "DA") { const d = dateParts(v.replace(/\//g, "-").replace(/-+$/, "")); if (d) cur.issued = d; } break;
        case "VL": cur.volume = v; break;
        case "IS": cur.issue = v; break;
        case "SP": cur._.sp = v; break;
        case "EP": cur._.ep = v; break;
        case "PB": cur.publisher = v; break;
        case "CY": cur["publisher-place"] = v; break;
        case "DO": cur.DOI = v.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""); break;
        case "UR": if (!cur.URL) cur.URL = v; break;
        case "SN": cur.ISBN = v; break;
        case "ET": cur.edition = v; break;
        case "ID": cur.id = v; break;
        case "LA": cur.language = v; break;
        case "N1": cur.note = v; break;
        case "AB": cur.abstract = v; break;
      }
    });
    return items;
  }
  function finishRis(c) {
    if (c._.sp) c.page = c._.sp + (c._.ep ? "–" + c._.ep : "");
    delete c._;
    if (!c.author.length) delete c.author;
    if (!c.editor.length) delete c.editor;
    return c;
  }

  /* ---------------- any format ---------------- */
  function parse(text, hint) {
    const s = String(text || "").replace(/^﻿/, "").trim();
    if (!s) return [];
    const h = String(hint || "").toLowerCase();
    let items;
    if (/json$/.test(h) || /^[\[{]/.test(s)) {
      try { const j = JSON.parse(s); items = Array.isArray(j) ? j : Array.isArray(j.items) ? j.items : [j]; } catch (e) { items = []; }
    } else if (/ris$/.test(h) || /^TY  - /m.test(s)) items = parseRis(s);
    else items = parseBibtex(s);
    const seen = new Set();
    return items.filter((it) => it && typeof it === "object").map((it) => {
      it = Object.assign({}, it);
      if (it.id == null || it.id === "") it.id = keyFor(it);
      it.id = String(it.id);
      let k = it.id, n = 1; while (seen.has(k)) k = it.id + "_" + (++n);
      it.id = k; seen.add(k);
      return it;
    });
  }
  // kovalenko2021: first author's family name (Latin letters only, Cyrillic transliterated) + year
  const TRANSLIT = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ё: "e", ъ: "" };
  function keyFor(it) {
    const a = (it.author && it.author[0]) || (it.editor && it.editor[0]) || {};
    let name = String(a.family || a.literal || (it.title || "ref").split(/\s+/)[0] || "ref").toLowerCase();
    name = name.replace(/[а-яєіїґёыэъ]/g, (c) => TRANSLIT[c] != null ? TRANSLIT[c] : c).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    const y = it.issued && it.issued["date-parts"] && it.issued["date-parts"][0] ? it.issued["date-parts"][0][0] : "";
    return (name || "ref") + (y || "");
  }

  /* ---------------- Markdown syntax (marked extensions) ---------------- */
  // keys as BibTeX allows them, in any script: @kovalenko2021, @Шевченко2020
  const KEY_RE = /@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~\/]*)/u;
  const trimKey = (k) => k.replace(/[.:?#$%&\-+<>~\/]+$/, "");
  const LOC_LABEL = [
    [/^(?:pp?|pages?|с|стор|s|S|стр)\.?$/, "page"], [/^(?:ch|chap|chapter|розд|гл)\.?$/, "chapter"], [/^(?:sec|section|§|ст)\.?$/, "section"],
    [/^(?:fig|figure|рис)\.?$/, "figure"], [/^(?:vol|vols|т|том)\.?$/, "volume"], [/^(?:para|¶|п)\.?$/, "paragraph"], [/^(?:l|line|ll|рядок)\.?$/, "line"],
    [/^(?:n|note|nn|прим)\.?$/, "note"], [/^(?:col|column|стовп)\.?$/, "column"], [/^(?:bk|book|кн)\.?$/, "book"], [/^(?:no|№)\.?$/, "issue"]
  ];
  function parseItem(piece) {
    const m = /^([\s\S]*?)(-?)@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~\/]*)([\s\S]*)$/u.exec(piece);
    if (!m) return null;
    let key = m[3], rest = m[4];
    const tk = trimKey(key); rest = key.slice(tk.length) + rest; key = tk;
    if (!key || CROSSREF_KEY.test(key)) return null;
    const it = { id: key };
    if (m[2]) it["suppress-author"] = true;
    const pre = m[1].trim(); if (pre) it.prefix = pre + " ";
    // , p. 33   , с. 33–35   , 33   , chap. 2 and more
    const loc = /^\s*,\s*(?:([^\s\d,;]{1,8}\.?)\s*)?(\d[\w\-–—,.]*?(?:\s*[-–—]\s*\d+)?)(?=\s*(?:[,;]|$|\s+\D))([\s\S]*)$/.exec(rest);
    if (loc) {
      let label = "page";
      if (loc[1]) { const L = LOC_LABEL.find((x) => x[0].test(loc[1])); if (L) label = L[1]; else return Object.assign(it, rest.trim() ? { suffix: rest.replace(/^\s*,?\s*/, ", ").replace(/\s+$/, "") } : {}); }
      it.locator = loc[2].replace(/\s*[-–—]\s*/g, "–").replace(/,$/, ""); it.label = label;
      const suf = loc[3].replace(/^\s*,?\s*/, "").trim(); if (suf) it.suffix = ", " + suf;
    } else if (rest.trim()) it.suffix = " " + rest.trim().replace(/^,\s*/, ", ").replace(/^, /, ", ");
    if (it.suffix && /^ ,/.test(it.suffix)) it.suffix = it.suffix.slice(1);
    return it;
  }
  function extensions() {
    return [
      // [BIB] or ::: {#refs} ::: (Pandoc) or <div id="refs"></div> — the bibliography goes here
      { name: "refsBlock", level: "block",
        start(src) { const m = /(^|\n)(?:\[BIB\]|:::+[ \t]*\{#refs[^}]*\}|<div[^>\n]*\bid=["']refs["'])/i.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = /^\[BIB\][ \t]*(?:\n+|$)/i.exec(src) || /^:::+[ \t]*\{#refs[^}\n]*\}[ \t]*\n(?:[ \t]*\n)*:::+[ \t]*(?:\n+|$)/.exec(src) ||
            /^<div[^>\n]*\bid=["']refs["'][^>\n]*>\s*<\/div>[ \t]*(?:\n+|$)/i.exec(src);
          if (m) return { type: "refsBlock", raw: m[0] };
        },
        renderer(t) {
          const L = LAST, list = renderBibHtml();
          return t.auto && list && L && L.rec ? '<h2 class="refs-title">' + escHtml(L.title) + "</h2>\n" + list : list;
        } },
      { name: "bibData", level: "block", renderer() { return ""; } },
      { name: "citation", level: "inline",
        start(src) { const m = /\[[^\[\]\n]*?-?@[\p{L}\p{N}_]|(?:^|[\s(])@[\p{L}\p{N}_]/u.exec(src); return m ? m.index + (m[0][0] === "[" ? 0 : m[0].indexOf("@")) : undefined; },
        tokenizer(src) {
          if (src[0] === "[") {
            const m = /^\[([^\[\]\n]*?@[^\[\]\n]*?)\](?![(\[:])/.exec(src); if (!m) return;
            const pieces = m[1].split(";"), items = [];
            for (const p of pieces) { const it = parseItem(p); if (!it) return; items.push(it); }
            if (!items.length) return;
            return { type: "citation", raw: m[0], items, narrative: false };
          }
          if (src[0] === "@") {
            const m = /^@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~\/]*)/u.exec(src); if (!m) return;
            const key = trimKey(m[1]);
            if (!key || CROSSREF_KEY.test(key) || /^[\w.-]+\.[a-z]{2,}$/i.test(key) && /\./.test(key)) return;   // @fig:… / @domain.com
            // Pandoc: @key [p. 33] — the bracket right after the key is its locator / suffix
            const loc = /^[ \t]*\[([^\[\]\n@]+)\](?![(\[:])/.exec(src.slice(1 + key.length));
            if (loc) {
              const it = parseItem("@" + key + ", " + loc[1].trim()) || { id: key };
              return { type: "citation", raw: "@" + key + loc[0], items: [it], narrative: true };
            }
            return { type: "citation", raw: "@" + key, items: [{ id: key }], narrative: true };
          }
        },
        renderer(t) { return renderCiteHtml(t); } }
    ];
  }

  /* ---------------- document state (filled by md2docx analyzeDoc / processAllTokens) ---------------- */
  // collect(token, D) is called for every token while md2docx walks the document
  function collect(t, D) {
    if (!D.cites) { D.cites = []; D.bibInline = []; D.hasRefs = false; D.afterRefs = false; }
    if (t.type === "citation") D.cites.push(t);
    else if (t.type === "refsBlock") { D.hasRefs = true; D.afterRefs = true; }
    else if ((t.type === "code" || t.type === "bibData") && DATA_LANG.test(String(t.lang || "").trim())) { t._afterRefs = !!D.afterRefs; D.bibInline.push(t); }
  }

  function metaList(v) { return (Array.isArray(v) ? v : v == null || v === "" ? [] : String(v).split(/\s*,\s*/)).map((x) => String(x).trim()).filter(Boolean); }
  function localeOf(meta) {
    const l = String((meta && meta.lang) || cfg.uiLang() || "en").toLowerCase();
    const p = /^zh[-_](hant|tw|hk|mo)/.test(l) ? "zh-hant" : l.slice(0, 2);
    return LOCALES[p] || (/^[a-z]{2}-[a-z]{2}$/i.test(l) ? l.slice(0, 2) + "-" + l.slice(3).toUpperCase() : "en-US");
  }
  function styleId(meta) {
    let s = String((meta && (meta.csl || meta["citation-style"])) || "").trim();
    if (!s) return localeOf(meta) === "uk-UA" ? "dstu-8302-2015" : "apa";
    s = s.replace(/\.csl$/i, "");
    const low = s.toLowerCase();
    if (ALIAS[low]) return ALIAS[low];
    if (STYLES.some((x) => x.id === low)) return low;
    return s;        // a path to a .csl file (resolved by the host)
  }
  const isBuiltin = (id) => STYLES.some((x) => x.id === id);

  /* ---------------- engine loading ---------------- */
  const S = {
    files: new Map(),       // path → { text|null } (resolved bibliography files)
    styles: new Map(),      // style id/path → xml|null
    locales: new Map(),     // en-US → xml
    library: undefined,     // text|null (undefined: not asked yet)
    libVer: 0,
    gen: 0,                 // bumped by invalidate(): reads started before it never fill the caches
    engines: new Map(),     // sig → { engine, items, ids:Set, numeric, missing:[] }
    loading: new Map(),     // what → Promise
    scriptP: null,
    errors: []
  };
  let LAST = null;          // result of the last process() (rendered by refsBlock)

  function loadScript() {
    if (global.CSL && global.CSL.Engine) return Promise.resolve();
    if (S.scriptP) return S.scriptP;
    S.scriptP = new Promise((res, rej) => {
      if (typeof document === "undefined") { rej(new Error("no document")); return; }
      // citeproc.js ends with "module.exports = CSL" (CommonJS build, kept unmodified)
      const had = Object.prototype.hasOwnProperty.call(global, "module"), old = global.module;
      global.module = { exports: {} };
      const sc = document.createElement("script");
      sc.src = cfg.base + "citeproc.js";
      sc.onload = () => { const C = global.module.exports; if (had) global.module = old; else delete global.module; if (!global.CSL && C && C.Engine) global.CSL = C; global.CSL ? res() : rej(new Error("citeproc")); };
      sc.onerror = () => { if (had) global.module = old; else delete global.module; S.scriptP = null; rej(new Error("citeproc.js not loaded")); };
      document.head.appendChild(sc);
    });
    return S.scriptP;
  }
  async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }
  function once(key, fn) {
    if (S.loading.has(key)) return S.loading.get(key);
    const p = Promise.resolve().then(fn).finally(() => S.loading.delete(key));
    S.loading.set(key, p);
    return p;
  }
  // built-in styles by id; a .csl file of the document by folder + path (same name, other folder = other style)
  async function getStyle(id, p) {
    const builtin = isBuiltin(id);
    const key = builtin ? id : (p ? p.scope : cfg.scope()) + "\u0000" + id;
    if (S.styles.has(key)) return S.styles.get(key);
    const resolve = p ? p.resolve : cfg.resolve;
    return once("style:" + key, async () => {
      let xml = null;
      try {
        if (builtin) xml = await fetchText(cfg.base + "styles/" + id + ".csl");
        else if (resolve) xml = await resolve(/\.csl$/i.test(id) ? id : id + ".csl");
      } catch (e) { xml = null; }
      S.styles.set(key, xml);
      return xml;
    });
  }
  async function getLocale(tag) {
    if (S.locales.has(tag)) return S.locales.get(tag);
    return once("loc:" + tag, async () => {
      let xml = null;
      try { xml = await fetchText(cfg.base + "locales/locales-" + tag + ".xml"); } catch (e) { xml = null; }
      S.locales.set(tag, xml);
      return xml;
    });
  }
  // files are cached per document folder (cfg.scope): refs.bib of two folders are two files
  async function getFile(path, p) {
    const key = (p ? p.scope : cfg.scope()) + "\u0000" + path;
    if (S.files.has(key)) return S.files.get(key);
    const resolve = p ? p.resolve : cfg.resolve, gen = S.gen;
    return once("file:" + gen + "\u0000" + key, async () => {
      let text = null;
      try { text = resolve ? await resolve(path) : null; } catch (e) { text = null; }
      if (gen === S.gen) S.files.set(key, text);
      return text;
    });
  }
  async function getLibrary() {
    if (S.library !== undefined) return S.library;
    const gen = S.gen;
    return once("library:" + gen, async () => {
      let text = null;
      try { text = cfg.library ? await cfg.library() : null; } catch (e) { text = null; }
      if (gen === S.gen) S.library = text || null;
      return text || null;
    });
  }
  // forget cached files / library (after the user attached a new one or the folder changed)
  function invalidate(what) {
    if (!what || what === "library") { S.library = undefined; S.libVer++; }
    if (!what || what === "files") S.files.clear();
    if (!what || what === "styles" || what === "files") Array.from(S.styles.keys()).forEach((k) => { if (!isBuiltin(k)) S.styles.delete(k); });
    S.engines.clear();
    S.gen++;
  }

  function plan(meta, D) {
    const styleKey = styleId(meta), loc = localeOf(meta);
    const paths = metaList(meta && meta.bibliography).filter((p) => !/^inline$/i.test(p));
    const inline = (D && D.bibInline || []).map((t) => ({ lang: String(t.lang || "").trim().toLowerCase(), text: t.text }));
    // the document's folder and resolver, taken now: an await later the user may be in another tab
    const scope = cfg.scope(), resolve = cfg.resolve;
    const local = paths.length || !isBuiltin(styleKey);
    const sig = [styleKey, loc, local ? scope + "|" + paths.join("|") : "", hash(inline.map((x) => x.lang + x.text).join("\u0000")), S.libVer, S.gen].join("\u0001");
    return { styleKey, loc, paths, inline, sig, scope, resolve };
  }
  // the entries a document can cite: ```bibtex blocks, bibliography: files, My library
  async function gather(p) {
    const items = new Map(), missing = [];
    const add = (it) => { if (!items.has(it.id)) items.set(it.id, it); };
    p.inline.forEach((b) => parse(b.text, b.lang).forEach(add));
    for (const path of p.paths) {
      const txt = await getFile(path, p);
      if (txt == null) { missing.push(path); continue; }
      parse(txt, path.split(".").pop()).forEach(add);
    }
    const lib = await getLibrary();
    if (lib) parse(lib).forEach(add);
    return { items, missing };
  }
  // for the citation picker: meta = front matter, md = the document text
  async function available(meta, md) {
    const inline = [];
    String(md || "").replace(/^[ \t]*(`{3,}|~{3,})[ \t]*(bibtex|biblatex|bib|csl-json|csljson|ris)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gim, (m, f, lang, body) => { inline.push({ type: "code", lang, text: body }); return m; });
    const p = plan(meta || {}, { bibInline: inline });
    const r = await gather(p);
    return { items: Array.from(r.items.values()), missing: r.missing };
  }

  // load everything a document needs; resolves to the engine record (or null)
  async function build(p) {
    if (S.engines.has(p.sig)) return S.engines.get(p.sig);
    return once("engine:" + p.sig, async () => {
      await loadScript();
      const [style, locMain, locEn] = await Promise.all([getStyle(p.styleKey, p), getLocale(p.loc), getLocale("en-US")]);
      let styleXml = style, styleUsed = p.styleKey;
      if (!styleXml) { styleUsed = "apa"; styleXml = await getStyle("apa"); }
      const { items, missing } = await gather(p);
      const locales = { "en-US": locEn }; locales[p.loc] = locMain;
      const sys = {
        retrieveLocale: (lang) => { const l = String(lang); const k = locales[l] ? l : Object.keys(locales).find((x) => x.slice(0, 2) === l.slice(0, 2)); return (k && locales[k]) || locEn; },
        retrieveItem: (id) => items.get(String(id))
      };
      const engine = new global.CSL.Engine(sys, styleXml, p.loc, true);
      engine.opt.development_extensions.wrap_url_and_doi = false;
      const numeric = /citation-format="numeric"/.test(styleXml);
      const note = /class="note"/.test(styleXml);
      const rec = { engine, items, numeric, note, missing, styleUsed, styleFallback: styleUsed !== p.styleKey ? p.styleKey : null, cacheKey: null, cacheVal: null };
      if (p.sig.split("\u0001").pop() === String(S.gen)) S.engines.set(p.sig, rec);   // not after an invalidate()
      if (S.engines.size > 6) S.engines.delete(S.engines.keys().next().value);
      return rec;
    });
  }

  // export: wait until everything is loaded (true when the document cites anything)
  async function ensure(meta, D) {
    if (!D || (!(D.cites && D.cites.length) && !(meta && meta.nocite))) return false;
    try { await build(plan(meta, D)); return true; } catch (e) { S.errors.push(String(e.message || e)); return false; }
  }

  /* ---------------- formatting ---------------- */
  function authorText(it, lang) {
    const names = (it && (it.author || it.editor)) || [];
    const fam = (n) => n.literal || n.family || "";
    const l = String(lang).slice(0, 2);
    if (!names.length) return (it && it.title) || "";
    if (names.length === 1) return fam(names[0]);
    if (names.length === 2) return fam(names[0]) + " " + (AND_WORD[l] || "and") + " " + fam(names[1]);
    return fam(names[0]) + " " + (ETAL_WORD[l] || "et al.");
  }
  // Formats the citations of D (sync). Returns false while the engine / data are still loading.
  function process(D, meta) {
    LAST = null;
    if (!D || !D.cites) return false;
    const nocite = metaList(meta && meta.nocite);
    if (!D.cites.length && !nocite.length) return false;
    const p = plan(meta, D);
    const rec = S.engines.get(p.sig);
    if (!rec) {
      build(p).then(() => { if (cfg.onChange) cfg.onChange(); }, (e) => { S.errors.push(String(e.message || e)); });
      D.citeState = "loading";
      LAST = { loading: true, D };
      return false;
    }
    const known = (id) => rec.items.has(id);
    const citations = [], map = [];
    D.cites.forEach((t, i) => {
      const its = t.items.filter((x) => known(x.id));
      t._missing = t.items.filter((x) => !known(x.id)).map((x) => x.id);
      if (!its.length) { map.push(null); return; }
      const ci = its.map((x) => { const o = Object.assign({}, x); if (t.narrative) o["suppress-author"] = true; return o; });
      map.push(citations.length);
      citations.push({ citationID: "c" + i, citationItems: ci, properties: { noteIndex: rec.note ? i + 1 : 0 } });
    });
    let uncited = [];
    if (nocite.length) uncited = nocite.some((x) => /^@?\*$/.test(x)) ? Array.from(rec.items.keys()) : nocite.map((x) => x.replace(/^@/, "")).filter(known);
    const key = p.sig + "\u0002" + JSON.stringify(citations) + "\u0002" + uncited.join(",");
    let res;
    if (rec.cacheKey === key) res = rec.cacheVal;
    else {
      let out = [], bib = null;
      try {
        rec.engine.updateUncitedItems(uncited);
        out = citations.length ? rec.engine.rebuildProcessorState(citations, "html") : [];
        if (!citations.length) rec.engine.updateItems([]);
        rec.engine.updateUncitedItems(uncited);
        bib = rec.engine.makeBibliography();
      } catch (e) { S.errors.push(String(e.message || e)); out = []; bib = null; }
      const byId = {}; out.forEach((r) => { byId[r[0]] = r[2]; });
      const entries = [];
      if (bib && bib[1]) bib[1].forEach((html, k) => { const id = bib[0].entry_ids[k] && bib[0].entry_ids[k][0]; entries.push({ id: String(id), html: String(html) }); });
      res = { byId, params: bib ? bib[0] : {}, entries };
      rec.cacheKey = key; rec.cacheVal = res;
    }
    const lang = p.loc;
    D.cites.forEach((t, i) => {
      if (map[i] == null) { t._out = null; return; }
      let html = res.byId["c" + i] || "";
      const cluster = html;
      let who = "";
      // narrative @key: "Kovalenko (2021)" / "Kovalenko [3]"
      if (t.narrative) {
        who = escHtml(authorText(rec.items.get(t.items[0].id), lang));
        if (!rec.numeric && !/^\(/.test(stripTags(html))) html = "(" + html + ")";
        html = who + " " + html;
      }
      t._out = { html, text: stripTags(html), who, cluster: t.narrative && !rec.numeric && !/^\(/.test(stripTags(cluster)) ? "(" + cluster + ")" : cluster, ids: t.items.filter((x) => known(x.id)).map((x) => x.id) };
    });
    const linkOff = meta && /^(?:false|no|off|0)$/i.test(String(meta["link-citations"] == null ? "" : meta["link-citations"]));
    D.citeState = "ready";
    LAST = { D, rec, res, meta, links: !linkOff, title: refsTitle(meta, lang) };
    return true;
  }
  function refsTitle(meta, loc) {
    const t = meta && (meta["reference-section-title"] || meta["references-title"]);
    if (t) return String(Array.isArray(t) ? t.join(", ") : t);
    return BIB_WORD[String(loc || "")] || BIB_WORD[String(loc || "en").slice(0, 2)] || BIB_WORD.en;
  }
  // [1] … / Author, Title … of one bibliography entry
  function entryParts(html) {
    const left = /<div class="csl-left-margin">([\s\S]*?)<\/div>/.exec(html);
    const right = /<div class="csl-right-inline">([\s\S]*?)<\/div>/.exec(html);
    if (left || right) return { left: left ? left[1].trim() : "", body: (right ? right[1] : html.replace(/<div class="csl-left-margin">[\s\S]*?<\/div>/, "")).replace(/<\/?div[^>]*>/g, "").trim() };
    return { left: "", body: html.replace(/<\/?div[^>]*>/g, "").trim() };
  }

  const anchorId = (id) => "ref-" + String(id).replace(/[\s"'<>&#]/g, "_");
  function renderCiteHtml(t) {
    const L = LAST;
    if (!L || !L.rec) {
      if (t.narrative) return escHtml(t.raw);
      return '<span class="cite cite-wait" title="' + escHtml(L && L.loading ? "…" : "") + '">' + escHtml(t.raw) + "</span>";
    }
    if (!t._out) {
      if (t.narrative) return escHtml(t.raw);   // "@twitter" that is no citation
      return '<span class="cite-missing" title="' + escHtml((t._missing || []).join(", ") + " ?") + '">' + escHtml(t.raw) + "</span>";
    }
    const miss = t._missing && t._missing.length ? '<span class="cite-missing" title="?">' + escHtml(t._missing.map((x) => "@" + x).join("; ")) + "?</span>" : "";
    const tip = t._out.ids.map((id) => { const e = L.res.entries.find((x) => x.id === id); return e ? stripTags(entryParts(e.html).left + " " + entryParts(e.html).body) : id; }).join("\n");
    const inner = t._out.html;
    if (!L.links) return '<span class="cite" title="' + escHtml(tip) + '">' + inner + "</span>" + miss;
    return '<a class="cite" href="#' + escHtml(anchorId(t._out.ids[0])) + '" title="' + escHtml(tip) + '">' + inner + "</a>" + miss;
  }
  function renderBibHtml() {
    const L = LAST;
    if (!L || !L.rec || !L.res.entries.length) return L && L.loading ? '<div id="refs" class="csl-bib-body csl-wait">…</div>\n' : "";
    const hang = L.res.params && L.res.params.hangingindent;
    return '<div id="refs" class="csl-bib-body' + (L.rec.numeric ? " csl-numeric" : "") + (hang ? " csl-hanging" : "") + '">' + L.res.entries.map((e) => {
      const p = entryParts(e.html);
      return '<div class="csl-entry" id="' + escHtml(anchorId(e.id)) + '">' + (p.left ? '<span class="csl-left-margin">' + p.left + "</span>" : "") + '<span class="csl-body">' + p.body + "</span></div>";
    }).join("") + "</div>\n";
  }

  /* ---------------- citeproc HTML → styled text pieces (for Word runs) ---------------- */
  function htmlSegments(html) {
    const out = [], st = [{}];
    const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g; let m;
    while ((m = re.exec(String(html || "")))) {
      if (m[4] != null) { const t = decodeEnt(m[4]); if (t) out.push(Object.assign({ text: t }, st[st.length - 1])); continue; }
      const tag = m[2].toLowerCase(), attrs = m[3] || "";
      if (tag === "br") { out.push({ text: "\n" }); continue; }
      if (m[1]) { if (st.length > 1) st.pop(); continue; }
      if (/^(?:img|hr|input|meta|wbr)$/.test(tag) || /\/\s*$/.test(attrs)) continue;
      const cur = Object.assign({}, st[st.length - 1]);
      if (tag === "i" || tag === "em") cur.i = true;
      else if (tag === "b" || tag === "strong") cur.b = true;
      else if (tag === "sup") cur.sup = true;
      else if (tag === "sub") cur.sub = true;
      else if (tag === "u") cur.u = true;
      else if (tag === "a") { const h = /\bhref\s*=\s*"([^"]*)"/.exec(attrs); if (h) cur.href = decodeEnt(h[1]); }
      const style = (/\bstyle\s*=\s*"([^"]*)"/.exec(attrs) || [])[1] || "";
      if (/font-style:\s*italic/.test(style)) cur.i = true;
      if (/font-style:\s*normal/.test(style)) cur.i = false;
      if (/font-weight:\s*(?:bold|[6-9]00)/.test(style)) cur.b = true;
      if (/font-weight:\s*normal/.test(style)) cur.b = false;
      if (/font-variant:\s*small-caps/.test(style)) cur.sc = true;
      if (/text-decoration:\s*underline/.test(style)) cur.u = true;
      if (/vertical-align:\s*super/.test(style)) cur.sup = true;
      if (/vertical-align:\s*sub/.test(style)) cur.sub = true;
      st.push(cur);
    }
    return out;
  }

  /* ---------------- Zotero: live citation fields in the exported .docx ---------------- */
  // Zotero's Word plugin reads these fields (Refresh, Add/Edit Citation, Bibliography) and
  // keeps working with the document; items without a library entry stay "embedded" (itemData).
  const ZOTERO_STYLE = { "dstu-8302-2015": "http://www.zotero.org/styles/dstu-8302-2015", apa: "http://www.zotero.org/styles/apa", ieee: "http://www.zotero.org/styles/ieee",
    vancouver: "http://www.zotero.org/styles/vancouver", "harvard-cite-them-right": "http://www.zotero.org/styles/harvard-cite-them-right",
    "chicago-author-date": "http://www.zotero.org/styles/chicago-author-date", "modern-language-association": "http://www.zotero.org/styles/modern-language-association" };
  const CSL_SCHEMA = "https://github.com/citation-style-language/schema/raw/master/csl-citation.json";
  const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let zseq = 0;
  const rid = () => (Date.now().toString(36) + (++zseq).toString(36) + Math.random().toString(36).slice(2, 6)).slice(-8);
  // the field code of one citation (null when nothing to write)
  // part: "author" (author-only field of a narrative @key), "rest" (its suppress-author field) or none
  function zoteroCitationCode(t, part) {
    const L = LAST;
    if (!L || !L.rec || !t._out) return null;
    const items = t.items.filter((x) => L.rec.items.has(x.id)).map((x) => {
      const data = Object.assign({}, L.rec.items.get(x.id));
      // Zotero matches repeated citations by uris and reads uris.length for embedded items:
      // the item's real Zotero URIs when the import kept them, else a stable local one
      const known = data.custom && Array.isArray(data.custom.uris) ? data.custom.uris.filter(Boolean) : [];
      // the fallback names the work, not the document's key: two documents' "smith2020" for
      // different works get different URIs, repeated citations of one work the same one
      const work = [data.type, data.title, data["container-title"], data["collection-title"], data.issued, data.author || data.editor, data.edition, data.volume, data.issue,
        data.number, data.page, data.publisher, data["publisher-place"], data.DOI, data.ISBN, data.ISSN, data.URL];
      const o = { id: x.id, uris: known.length ? known : ["http://zotero.org/users/local/docxmd/items/" + hash(JSON.stringify(work)).replace(":", "-")], itemData: data };
      ["locator", "label", "prefix", "suffix", "suppress-author"].forEach((k) => { if (x[k] != null) o[k] = typeof x[k] === "string" ? x[k].trim() : x[k]; });
      if (part === "author") { o["author-only"] = true; delete o["suppress-author"]; }
      else if (part === "rest" || t.narrative) o["suppress-author"] = true;
      return o;
    });
    if (!items.length) return null;
    const shown = part === "author" ? t._out.who : part === "rest" ? t._out.cluster : t._out.html;
    const json = { citationID: rid(), properties: { formattedCitation: shown, plainCitation: stripTags(shown), noteIndex: 0 }, citationItems: items, schema: CSL_SCHEMA };
    return " ADDIN ZOTERO_ITEM CSL_CITATION " + JSON.stringify(json) + " ";
  }
  const ZOTERO_BIBL = ' ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY ';
  // OOXML of the field pieces: begin + code (split in short instrText runs) + separate / end
  function fieldXml(part, code) {
    const W = ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    if (part === "begin") {
      let x = "<w:r" + W + '><w:fldChar w:fldCharType="begin"/></w:r>';
      return [x].concat((String(code).match(/[\s\S]{1,240}/g) || []).map((c) => "<w:r" + W + '><w:instrText xml:space="preserve">' + xmlEsc(c) + "</w:instrText></w:r>"),
        ["<w:r" + W + '><w:fldChar w:fldCharType="separate"/></w:r>']);
    }
    return ["<w:r" + W + '><w:fldChar w:fldCharType="end"/></w:r>'];
  }
  // docProps/custom.xml ZOTERO_PREF_1 … (document preferences: style, locale, field type)
  function zoteroPrefs(meta) {
    const L = LAST, id = (L && L.rec && L.rec.styleUsed) || styleId(meta);
    const url = ZOTERO_STYLE[id] || (/^https?:/.test(id) ? id : "http://www.zotero.org/styles/" + String(id).replace(/^.*\//, "").replace(/\.csl$/i, ""));
    const xml = '<data data-version="3" zotero-version="7.0"><session id="' + rid() + '"/><style id="' + xmlEsc(url) + '" locale="' + xmlEsc(localeOf(meta)) +
      '" hasBibliography="1" bibliographyStyleHasBeenSet="1"/><prefs><pref name="fieldType" value="Field"/><pref name="automaticJournalAbbreviations" value="true"/></prefs></data>';
    return (xml.match(/[\s\S]{1,240}/g) || []).map((v, i) => ({ name: "ZOTERO_PREF_" + (i + 1), value: v }));
  }

  /* ---------------- Word import: Zotero / Mendeley / Word citations → [@key] ---------------- */
  const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const NS_B = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";
  const MARK = (n) => "ZQCITE" + n + "ZQ", BIB_MARK = "ZQBIBZQ";
  // Word "Source Manager" entry (customXml b:Sources) → CSL-JSON
  const WORD_TYPE = { Book: "book", BookSection: "chapter", JournalArticle: "article-journal", ArticleInAPeriodical: "article-magazine", ConferenceProceedings: "paper-conference",
    Report: "report", InternetSite: "webpage", DocumentFromInternetSite: "webpage", ElectronicSource: "webpage", Art: "graphic", SoundRecording: "song", Performance: "speech",
    Film: "motion_picture", Interview: "interview", Patent: "patent", Case: "legal_case", Misc: "document" };
  function wordSources(xml) {
    const out = [];
    if (!xml || typeof DOMParser === "undefined") return out;
    const d = new DOMParser().parseFromString(xml, "application/xml");
    const kid = (el, n) => el && Array.from(el.childNodes).find((c) => c.nodeType === 1 && c.localName === n);
    const txt = (el, n) => { const k = kid(el, n); return k ? k.textContent.trim() : ""; };
    const names = (src, role) => {
      const a = kid(kid(src, "Author"), role); if (!a) return undefined;
      const corp = kid(a, "Corporate"); if (corp) return [{ literal: corp.textContent.trim() }];
      const nl = kid(a, "NameList"); if (!nl) return undefined;
      return Array.from(nl.childNodes).filter((p) => p.nodeType === 1 && p.localName === "Person").map((p) => ({ family: txt(p, "Last"), given: [txt(p, "First"), txt(p, "Middle")].filter(Boolean).join(" ") }));
    };
    Array.from(d.getElementsByTagNameNS(NS_B, "Source")).forEach((s) => {
      const it = { id: txt(s, "Tag") || "", type: WORD_TYPE[txt(s, "SourceType")] || "document" };
      const au = names(s, "Author"), ed = names(s, "Editor"), tr = names(s, "Translator");
      if (au) it.author = au; if (ed) it.editor = ed; if (tr) it.translator = tr;
      const set = (k, v) => { if (v) it[k] = v; };
      set("title", txt(s, "Title"));
      set("container-title", txt(s, "JournalName") || txt(s, "BookTitle") || txt(s, "ConferenceName") || txt(s, "PeriodicalTitle") || txt(s, "InternetSiteTitle"));
      set("publisher", txt(s, "Publisher") || txt(s, "Institution"));
      set("publisher-place", txt(s, "City"));
      set("volume", txt(s, "Volume")); set("issue", txt(s, "Issue")); set("page", txt(s, "Pages").replace(/\s*[-–]\s*/g, "–"));
      set("edition", txt(s, "Edition")); set("URL", txt(s, "URL")); set("DOI", txt(s, "DOI")); set("ISBN", txt(s, "StandardNumber"));
      const y = txt(s, "Year"); if (y) { const dp = dateParts(y, txt(s, "Month"), txt(s, "Day")); if (dp) it.issued = dp; }
      const ya = txt(s, "YearAccessed"); if (ya) { const dp = dateParts(ya, txt(s, "MonthAccessed"), txt(s, "DayAccessed")); if (dp) it.accessed = dp; }
      if (!it.id) it.id = keyFor(it);
      out.push(it);
    });
    return out;
  }
  // " CITATION Smi20 \l 1033 \p 33 \m Doe19 " → [{ tag, locator }]
  function wordCitation(instr) {
    const out = [];
    const m = /^\s*CITATION\s+(\S+)([\s\S]*)$/i.exec(instr); if (!m) return out;
    const first = { tag: m[1] };
    const pg = /\\p\s+"?([^"\\]+?)"?\s*(?:\\|$)/.exec(m[2]); if (pg) { first.locator = pg[1].trim(); first.label = "page"; }
    out.push(first);
    m[2].replace(/\\m\s+(\S+)/g, (x, t) => { out.push({ tag: t }); return x; });
    return out;
  }
  // Rewrites word/document.xml: every citation field / Mendeley content control becomes a marker run,
  // the bibliography a marker paragraph. → { ab, cites: [[{id,…}]], items: Map, style } | null
  async function importPrepare(ab) {
    const Z = global.DOCXMDZip;
    if (!Z || typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return null;
    let files;
    try { files = await Z.read(ab); } catch (e) { return null; }
    if (!files.get("word/document.xml")) return null;
    // the body, footnotes and endnotes: a citation in a note becomes [@key] there as well. Parts
    // are picked by structure (fields, content controls): a field code may be split over runs
    // ("CITA" + "TION …"), so its words are only checked after the runs are joined
    const FIELD_RE = /<w:fldChar\b|<w:fldSimple\b|<w:sdt\b/;
    const parts = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"].filter((n) => files.get(n) && FIELD_RE.test(Z.text(files.get(n))));
    if (!parts.length) return null;
    // Word sources (customXml)
    const sources = new Map();
    for (const [name, data] of files) if (/^customXml\/item\d+\.xml$/i.test(name)) { const x = Z.text(data); if (/bibliography/.test(x)) wordSources(x).forEach((it) => sources.set(it.id, it)); }
    const cites = [], items = new Map();
    let bib = false;
    const addCsl = (ci) => {
      const out = [];
      (ci.citationItems || []).forEach((c) => {
        const data = c.itemData || {};
        const uris = [].concat(c.uris || c.uri || []).filter((u) => typeof u === "string" && u);
        const uri = uris[0] || "";
        // two works may share title, author and year: the field's item id tells them apart
        const iid = c.id != null ? c.id : data.id;
        const sig = uri || data.DOI || JSON.stringify([iid == null ? null : String(iid), data.title, data.issued, (data.author || [])[0]]);
        let key = null;
        for (const [k, v] of items) if (v._sig === sig) { key = k; break; }
        if (!key) {
          let base = keyFor(data), k2 = base, i = 1;
          while (items.has(k2)) k2 = base + String.fromCharCode(97 + i++);
          key = k2;
          const it = Object.assign({}, data, { id: key }); Object.defineProperty(it, "_sig", { value: sig, enumerable: false });
          if (uris.length) it.custom = Object.assign({}, data.custom, { uris });   // kept for the next Zotero export
          items.set(key, it);
        }
        const o = { id: key };
        ["locator", "label", "prefix", "suffix", "suppress-author", "author-only"].forEach((k) => { if (c[k] != null && c[k] !== "") o[k] = c[k]; });
        out.push(o);
      });
      return out;
    };
    const handle = (instr) => {
      const zi = /(?:ZOTERO_ITEM\s+)?CSL_CITATION\s+(\{[\s\S]*\})\s*$/.exec(instr);
      if (zi) { try { const its = addCsl(JSON.parse(zi[1])); if (its.length) { cites.push(its); return MARK(cites.length - 1); } } catch (e) {} return null; }
      if (/^\s*CITATION\s/i.test(instr)) {
        const its = wordCitation(instr).map((x) => { const src = sources.get(x.tag); if (!src) return null; const it = Object.assign({}, src); if (!items.has(it.id)) items.set(it.id, it); const o = { id: it.id }; if (x.locator) { o.locator = x.locator; o.label = x.label; } return o; }).filter(Boolean);
        if (its.length) { cites.push(its); return MARK(cites.length - 1); }
        return null;
      }
      if (/ZOTERO_BIBL|CSL_BIBLIOGRAPHY|^\s*BIBLIOGRAPHY\b/i.test(instr)) { bib = true; return BIB_MARK; }
      return null;
    };
    let doc = null, W = null;
    const markerRun = (text) => { const r = W("r"), t = W("t"); t.setAttribute("xml:space", "preserve"); t.textContent = text; r.appendChild(t); return r; };
    const markerPara = (text) => { const p = W("p"); p.appendChild(markerRun(text)); return p; };
    const paraOf = (n) => { while (n && !(n.localName === "p" && n.namespaceURI === NS_W)) n = n.parentNode; return n; };
    const runsOf = (p) => Array.from(p.getElementsByTagNameNS(NS_W, "r"));
    const hasText = (rs) => rs.some((r) => Array.from(r.getElementsByTagNameNS(NS_W, "t")).some((t) => (t.textContent || "").trim()));
    for (const name of parts) {
    doc = new DOMParser().parseFromString(Z.text(files.get(name)), "application/xml");
    W = (n) => doc.createElementNS(NS_W, "w:" + n);
    const body = name === "word/document.xml" ? doc.getElementsByTagNameNS(NS_W, "body")[0] : doc.documentElement;
    if (!body) continue;
    // 1) complex fields: begin … instrText … separate … end
    const runs = Array.from(body.getElementsByTagNameNS(NS_W, "r"));
    const stack = [], fields = [];
    runs.forEach((r) => {
      Array.from(r.childNodes).forEach((c) => {
        if (c.nodeType !== 1 || c.namespaceURI !== NS_W) return;
        if (c.localName === "fldChar") {
          const tp = c.getAttributeNS(NS_W, "fldCharType") || c.getAttribute("w:fldCharType");
          if (tp === "begin") stack.push({ begin: r, instr: "" });
          else if (tp === "end" && stack.length) { const f = stack.pop(); f.end = r; if (!stack.length) fields.push(f); }
        } else if (c.localName === "instrText" && stack.length) stack[stack.length - 1].instr += c.textContent;
      });
    });
    fields.forEach((f) => {
      const mark = handle(f.instr); if (!mark) return;
      const pb = paraOf(f.begin), pe = paraOf(f.end);
      if (mark === BIB_MARK && pb && pe && pb !== pe && pb.parentNode === pe.parentNode) {
        // the bibliography spans paragraphs: one marker paragraph instead; prose before the field
        // in its first paragraph and after it in its last one stays
        const parent = pb.parentNode, rb = runsOf(pb), re = runsOf(pe);
        const ia = rb.indexOf(f.begin), ie = re.indexOf(f.end);
        // prose before the begin character / after the end character (in other runs or in the same run)
        const sideText = (r, tp, before) => { const kids = Array.from(r.childNodes), at = kids.findIndex((c) => c.nodeType === 1 && c.localName === "fldChar" && (c.getAttributeNS(NS_W, "fldCharType") || c.getAttribute("w:fldCharType")) === tp); return kids.some((c, k) => (before ? k < at : k > at) && c.nodeType === 1 && c.localName === "t" && (c.textContent || "").trim()); };
        const keepB = ia >= 0 && (hasText(rb.slice(0, ia)) || sideText(f.begin, "begin", true)), keepE = ie >= 0 && (hasText(re.slice(ie + 1)) || sideText(f.end, "end", false));
        const mid = []; for (let p = pb.nextSibling; p && p !== pe; p = p.nextSibling) mid.push(p);
        parent.insertBefore(markerPara(mark), keepB ? pb.nextSibling : pb);
        mid.forEach((x) => x.parentNode && x.parentNode.removeChild(x));
        // a boundary run may hold prose next to its field character: only the field side goes
        const fieldChar = (r, tp) => Array.from(r.childNodes).find((c) => c.nodeType === 1 && c.localName === "fldChar" && (c.getAttributeNS(NS_W, "fldCharType") || c.getAttribute("w:fldCharType")) === tp);
        const trimRun = (r, tp, after) => {
          const fc = fieldChar(r, tp), kids = Array.from(r.childNodes), at = kids.indexOf(fc);
          if (at < 0) { r.parentNode && r.parentNode.removeChild(r); return; }
          kids.forEach((c, k) => { if (c.nodeType === 1 && c.localName !== "rPr" && (after ? k >= at : k <= at)) r.removeChild(c); });
          // only a run left with nothing but its properties goes (a drawing or tab after the field stays)
          if (!Array.from(r.childNodes).some((c) => c.nodeType === 1 && c.localName !== "rPr")) r.parentNode && r.parentNode.removeChild(r);
        };
        if (keepB) { trimRun(rb[ia], "begin", true); rb.slice(ia + 1).forEach((r) => r.parentNode && r.parentNode.removeChild(r)); } else pb.parentNode && pb.parentNode.removeChild(pb);
        if (keepE) { re.slice(0, ie).forEach((r) => r.parentNode && r.parentNode.removeChild(r)); trimRun(re[ie], "end", false); } else pe.parentNode && pe.parentNode.removeChild(pe);
        return;
      }
      if (!pb || pb !== pe) return;
      const all = Array.from(pb.getElementsByTagNameNS(NS_W, "r"));
      const a = all.indexOf(f.begin), b = all.indexOf(f.end);
      if (a < 0 || b < a) return;
      f.begin.parentNode.insertBefore(markerRun(mark), f.begin);
      for (let i = a; i <= b; i++) if (all[i].parentNode) all[i].parentNode.removeChild(all[i]);
    });
    // 2) simple fields <w:fldSimple w:instr="…">
    Array.from(body.getElementsByTagNameNS(NS_W, "fldSimple")).forEach((fs) => {
      const mark = handle(fs.getAttributeNS(NS_W, "instr") || fs.getAttribute("w:instr") || ""); if (!mark) return;
      fs.parentNode.replaceChild(markerRun(mark), fs);
    });
    // 3) Mendeley Cite: content controls tagged MENDELEY_CITATION_v3_<base64 JSON> / MENDELEY_BIBLIOGRAPHY
    Array.from(body.getElementsByTagNameNS(NS_W, "sdt")).forEach((sdt) => {
      if (!sdt.parentNode) return;
      // the control's own w:sdtPr/w:tag — not the tag of a citation nested inside it
      const pr = Array.from(sdt.childNodes).find((c) => c.nodeType === 1 && c.localName === "sdtPr" && c.namespaceURI === NS_W);
      const tag = pr ? Array.from(pr.childNodes).find((c) => c.nodeType === 1 && c.localName === "tag" && c.namespaceURI === NS_W) : null;
      const v = tag ? tag.getAttributeNS(NS_W, "val") || tag.getAttribute("w:val") || "" : "";
      let mark = null;
      const mc = /^MENDELEY_CITATION_v3_(.+)$/.exec(v);
      if (mc) { try { const bin = atob(mc[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const its = addCsl(JSON.parse(new TextDecoder().decode(u))); if (its.length) { cites.push(its); mark = MARK(cites.length - 1); } } catch (e) {} }
      else if (/^MENDELEY_BIBLIOGRAPHY/.test(v)) { bib = true; mark = BIB_MARK; }
      if (!mark) return;
      const inPara = sdt.parentNode.localName === "p";
      sdt.parentNode.replaceChild(inPara ? markerRun(mark) : markerPara(mark), sdt);
    });
    files.set(name, Z.bytes(new XMLSerializer().serializeToString(doc)));
    }
    if (!cites.length && !bib) return null;
    // the style chosen in Zotero / Mendeley (document properties)
    let style = null;
    const custom = files.get("docProps/custom.xml");
    if (custom) {
      const cx = Z.text(custom);
      const parts = []; cx.replace(/name="ZOTERO_PREF_(\d+)"[^>]*>\s*<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/g, (m, i, v) => { parts[+i] = v; return m; });
      const pref = decodeEnt(parts.join(""));
      const sm = /<style id="([^"]+)"/.exec(pref);
      if (sm) style = sm[1];
      else { const mm = /name="Mendeley Recent Style Id 0_1"[^>]*>\s*<vt:lpwstr>([^<]+)</.exec(cx); if (mm) style = decodeEnt(mm[1]); }
    }
    const out = await Z.write(files);
    return { ab: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), cites, items, style, bib };
  }
  const LABEL_ABBR = { page: ["p.", "с."], chapter: ["chap.", "розд."], section: ["sec.", "§"], figure: ["fig.", "рис."], volume: ["vol.", "т."], paragraph: ["para.", "п."], line: ["l.", "рядок"], note: ["n.", "прим."], column: ["col.", "стовп."], book: ["bk.", "кн."], issue: ["no.", "№"] };
  // markers → [@key, p. 33]; the bibliography → [BIB]; the entries as a ```csl-json block at the end
  function importFinish(md, pre) {
    const plain = String(md).replace(/ZQ(?:CITE\d+|BIB)ZQ/g, "").replace(/```[\s\S]*?```/g, "").replace(/\]\([^)]*\)/g, "]");
    const uk = (plain.match(/[а-яієїґ]/gi) || []).length > 0.5 * (plain.match(/[a-z]/gi) || []).length;
    const cite = (its) => "[" + its.map((x) => {
      let s = (x.prefix ? String(x.prefix).trim() + " " : "") + (x["suppress-author"] ? "-" : "") + "@" + x.id;
      if (x.locator) { const ab = LABEL_ABBR[x.label || "page"]; s += ", " + (ab ? ab[uk ? 1 : 0] + " " : "") + x.locator; }
      if (x.suffix) s += (/^[,;\s]/.test(x.suffix) ? "" : " ") + String(x.suffix).trim().replace(/^,\s*/, ", ");
      return s;
    }).join("; ") + "]";
    // Zotero's narrative form: an author-only field + a suppress-author field of the same item → @key
    const one = (i) => { const c = pre.cites[+i]; return c && c.length === 1 ? c[0] : null; };
    let out = String(md).replace(/ZQCITE(\d+)ZQ(\s*)ZQCITE(\d+)ZQ/g, (m, a, sp, b) => {
      const x = one(a), y = one(b);
      if (x && y && x["author-only"] && y["suppress-author"] && x.id === y.id) {
        // Pandoc's narrative form keeps the locator: @key [p. 33]
        let tail = "";
        if (y.locator) { const ab = LABEL_ABBR[y.label || "page"]; tail = (ab ? ab[uk ? 1 : 0] + " " : "") + y.locator; }
        if (y.suffix) tail += (tail ? ", " : "") + String(y.suffix).replace(/^[,;\s]+/, "").trim();
        return "@" + x.id + (tail ? " [" + tail.replace(/[\[\]]/g, "") + "]" : "");
      }
      return m;
    });
    out = out.replace(/ZQCITE(\d+)ZQ/g, (m, i) => { const x = one(i); if (x && x["author-only"]) return "@" + x.id; return pre.cites[+i] ? cite(pre.cites[+i]) : ""; });
    let hasBib = /ZQBIBZQ/.test(out);
    out = out.replace(/^[ \t]*ZQBIBZQ[ \t]*$/m, "[BIB]").replace(/ZQBIBZQ/g, "");
    if (!hasBib && pre.cites.length) out = out.replace(/\s*$/, "\n\n[BIB]\n");
    const list = Array.from(pre.items.values());
    if (list.length) out = out.replace(/\s*$/, "") + "\n\n```csl-json\n" + JSON.stringify(list, null, 2) + "\n```\n";   // concatenated: "$&" in a title stays literal
    const meta = {};
    if (pre.style) {
      const id = String(pre.style).replace(/^https?:\/\/www\.zotero\.org\/styles\//, "").replace(/^https?:\/\/[^/]+\/.*\//, "");
      meta.csl = ALIAS[id] || id;
    }
    return { md: out, meta: Object.keys(meta).length ? meta : null };
  }

  /* ---------------- diagnostics / UI helpers ---------------- */
  function stats(D) {
    const L = LAST;
    const cites = (D && D.cites) || [];
    const used = new Set(), unknown = new Set();
    cites.forEach((t) => t.items.forEach((x) => { (L && L.rec && L.rec.items.has(x.id) ? used : unknown).add(x.id); if (!(L && L.rec)) unknown.delete(x.id); }));
    const total = L && L.rec ? L.rec.items.size : 0;
    const uncited = L && L.rec ? Array.from(L.rec.items.keys()).filter((k) => !used.has(k)) : [];
    return { citations: cites.length, sources: used.size, library: total, unknown: L && L.rec ? Array.from(unknown) : [], uncited,
      missingFiles: L && L.rec ? L.rec.missing.slice() : [], style: L && L.rec ? L.rec.styleUsed : null, styleFallback: L && L.rec ? L.rec.styleFallback : null,
      loading: !!(L && L.loading), errors: S.errors.slice(-3) };
  }
  // all known items for the current document (citation picker); null while loading
  function items() { const L = LAST; return L && L.rec ? Array.from(L.rec.items.values()) : null; }

  global.DOCXMDCite = { configure, extensions, collect, process, ensure, last: () => LAST, parse, parseBibtex, parseRis, htmlSegments, entryParts,
    stats, items, available, STYLES, styleId, localeOf, keyFor, invalidate, anchorId, refsTitle, authorText, DATA_LANG,
    getLibraryText: () => getLibrary(), zoteroCitationCode, ZOTERO_BIBL, fieldXml, zoteroPrefs, importPrepare, importFinish, wordSources };
})(typeof window !== "undefined" ? window : this);
