/* ============================================================
   DOCXMD — Markdown-safe translation
   Providers:
     - deepl : high quality, via same-origin proxy (api/translate),
               user supplies their own DeepL key (stored locally).
     - chrome: on-device Chrome Translator API (offline, free).
   Exposes: window.MDTranslate = { run, detect, chromeAvailability, LANGS }
   ============================================================ */
(function (global) {
  "use strict";

  const LANGS = ["en", "uk", "es", "zh"];
  const DEEPL = { en: "EN", uk: "UK", es: "ES", zh: "ZH" };

  // ---- inline protection -------------------------------------------------
  const OPEN = "", CLOSE = "";
  function protect(text) {
    const store = [];
    const push = (m) => { store.push(m); return OPEN + (store.length - 1) + CLOSE; };
    let s = text;
    s = s.replace(/`[^`]+`/g, push);                       // inline code
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, push);          // images
    s = s.replace(/\]\(([^)]+)\)/g, (m, url) => "]" + push("(" + url + ")")); // link URLs (keep text)
    s = s.replace(/<[^>\s][^>]*>/g, push);                 // html tags
    s = s.replace(/(?:https?|mailto):\/?\/?\S+/g, push);   // bare URLs
    s = s.replace(/\$[^$\n]+\$/g, push);                   // inline math
    s = s.replace(/\[\^[^\]\s]+\]:?/g, push);              // footnote refs / definitions
    s = s.replace(/\{#[a-z]+:[^}\n]*\}/g, push);            // {#fig:id} {#tbl:id} {#sec:id}
    s = s.replace(/\[?@(?:fig|tbl|sec):[A-Za-z0-9_-]+\]?/g, push); // cross-references
    s = s.replace(/^\[TOC\]$/gi, push);                     // table of contents
    s = s.replace(/==(?:[A-Za-z\u0400-\u04FF]+:)?(?=\S)|(?<=\S)==/g, push); // ==highlight== / ==red:…== markers
    return { s, store };
  }
  // Split a string into ordered chunks LOCALLY: { text } is prose to translate,
  // { keep } is passed through verbatim. Crucially, placeholders are resolved
  // here — nothing but plain prose is ever sent to the MT engine. Earlier code
  // sent U+E000/U+E001-wrapped placeholders to DeepL/Chrome, which strip those
  // sentinels, so the raw index numbers leaked into the output and protected
  // parts (inline code, links, table tags) were lost.
  function makeChunks(text) {
    const { s, store } = protect(text);
    const re = new RegExp(OPEN + "(\\d+)" + CLOSE, "g");
    const chunks = [];
    let last = 0, m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) chunks.push({ text: s.slice(last, m.index) });
      chunks.push({ keep: store[+m[1]] != null ? store[+m[1]] : "" });
      last = m.index + m[0].length;
    }
    if (last < s.length) chunks.push({ text: s.slice(last) });
    return chunks;
  }
  const renderChunks = (chunks) => chunks.map((c) => (c.keep != null ? c.keep : c.text)).join("");
  // Push a translate job for every prose chunk that carries real content.
  function jobifyChunks(chunks, jobs) {
    chunks.forEach((c) => { if (c.keep == null && c.text.trim()) jobs.push({ text: c.text, set: (tr) => { c.text = tr; } }); });
  }

  // ---- segment markdown into translatable jobs ---------------------------
  // YAML front matter: keys stay, only the values of these keys are translated
  const FM_TRANSLATE = /^(title|subtitle|subject|description|abstract|header|footer|page-numbers|keywords)$/i;
  function segment(md) {
    const lines = md.split("\n");
    const out = new Array(lines.length);
    const jobs = [];
    let fence = null;
    const fm = global.MD2DOCX && global.MD2DOCX.parseFrontMatter ? global.MD2DOCX.parseFrontMatter(md) : null;
    const fmLines = fm ? fm.raw.replace(/\r?\n$/, "").split("\n").length : 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i < fmLines) {
        const kv = /^([A-Za-z_][\w-]*[ \t]*:[ \t]*)(["']?)(.*?)(\2)[ \t]*$/.exec(line);
        if (i > 0 && i < fmLines - 1 && kv && FM_TRANSLATE.test(kv[1].replace(/[\s:]+$/, "")) && kv[3].trim()) {
          const chunks = makeChunks(kv[3].replace(/\{[nN]\}|\{(?:title|author|date|subject)\}/g, "`$&`"));
          chunks.forEach((c) => { if (c.keep != null) c.keep = c.keep.replace(/^`|`$/g, ""); });
          jobifyChunks(chunks, jobs);
          out[i] = { render: () => kv[1] + kv[2] + renderChunks(chunks) + kv[4] };
        } else out[i] = line;
        continue;
      }
      if (fence) {
        out[i] = line;
        if (new RegExp("^\\s*" + fence + "+\\s*$").test(line)) fence = null;
        continue;
      }
      const fm = line.match(/^\s*(```+|~~~+)/);
      if (fm) { fence = fm[1][0]; out[i] = line; continue; }
      if (!line.trim()) { out[i] = line; continue; }
      // colour-box fences  :::red … :::  stay verbatim
      if (/^\s*:::/.test(line)) { out[i] = line; continue; }
      // table separator row  | --- | :--: |
      if (/-{2,}/.test(line) && /^[\s|:\-]+$/.test(line)) { out[i] = line; continue; }
      // table data row (starts with optional spaces then |)
      if (/^\s*\|/.test(line)) {
        const cells = line.split("|").map((cell) => {
          if (!cell.trim()) return { raw: cell };
          const lead = cell.match(/^\s*/)[0], trail = cell.match(/\s*$/)[0];
          const chunks = makeChunks(cell.trim());
          jobifyChunks(chunks, jobs);
          return { lead, trail, chunks };
        });
        out[i] = { render: () => cells.map((co) => (co.raw != null ? co.raw : co.lead + renderChunks(co.chunks) + co.trail)).join("|") };
        continue;
      }
      // normal line: keep leading markdown markers, translate the rest
      const pm = line.match(/^(\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)*)/);
      const prefix = pm ? pm[1] : "";
      const content = line.slice(prefix.length);
      if (!content.trim()) { out[i] = line; continue; }
      const chunks = makeChunks(content);
      jobifyChunks(chunks, jobs);
      out[i] = { render: () => prefix + renderChunks(chunks) };
    }
    return { out, jobs };
  }

  // ---- providers ---------------------------------------------------------
  async function deeplBatch(texts, target, source, key, onProgress) {
    const CH = 40, res = [];
    for (let i = 0; i < texts.length; i += CH) {
      const chunk = texts.slice(i, i + CH);
      // VS Code webview: the extension host performs the DeepL call (a webview can't
      // reach DeepL or api/translate) and asks for the API key when none is saved.
      // The PWA never defines __deeplTransport, so it keeps using its proxy.
      // Keep this hook: the extension ships a verbatim copy of this file.
      if (global.__deeplTransport) {
        const arr2 = await global.__deeplTransport(chunk, DEEPL[target], source ? DEEPL[source] : undefined);
        arr2.forEach((t) => res.push(typeof t === "string" ? t : t.text));
        if (onProgress) onProgress((i + chunk.length) / texts.length);
        continue;
      }
      const r = await fetch("api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key, text: chunk, target: DEEPL[target], source: source ? DEEPL[source] : undefined })
      });
      if (!r.ok) {
        let msg = r.status + "";
        try { msg = (await r.json()).error || msg; } catch (e) { try { msg = (await r.text()).slice(0, 140); } catch (e2) {} }
        const err = new Error("DeepL: " + msg);
        // 456 = quota exceeded (DeepL); also match the textual message.
        if (r.status === 456 || /quota/i.test(String(msg))) err.code = "QUOTA";
        else err.code = "DEEPL";
        throw err;
      }
      const data = await r.json();
      const arr = data.translations || (data.data && data.data.translations) || [];
      arr.forEach((t) => res.push(typeof t === "string" ? t : t.text));
      if (onProgress) onProgress((i + chunk.length) / texts.length);
    }
    return res;
  }

  function getTranslatorAPI() { return global.Translator || (global.translation) || null; }

  function tErr(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

  async function chromeCreate(source, target) {
    const API = getTranslatorAPI();
    if (!API) throw tErr("NO_ENGINE", "Chrome Translator API unavailable");
    const avail = await chromeAvailability(source, target);
    if (avail === "unavailable" || avail === "no") throw tErr("UNSUPPORTED", "Language pair not supported on-device");
    const opts = {
      sourceLanguage: source, targetLanguage: target,
      monitor(m) { try { m.addEventListener("downloadprogress", function () {}); } catch (e) {} }
    };
    try {
      if (typeof API.create === "function") return await API.create(opts);
      if (typeof API.createTranslator === "function") return await API.createTranslator(opts);
    } catch (err) {
      throw tErr((err && err.name === "NotSupportedError") ? "UNSUPPORTED" : "CREATE_FAILED", err && err.message);
    }
    throw tErr("NO_ENGINE", "Chrome Translator API unavailable");
  }

  async function translateWith(tr, texts, onProgress, base, span) {
    const res = [];
    for (let i = 0; i < texts.length; i++) {
      res.push(await tr.translate(texts[i]));
      if (onProgress) onProgress(base + span * ((i + 1) / texts.length));
    }
    return res;
  }

  async function chromeBatch(texts, target, source, onProgress) {
    let tr;
    try {
      tr = await chromeCreate(source || "en", target);
    } catch (e) {
      // Try pivoting through English if the direct pair is unsupported
      if (e.code === "UNSUPPORTED" && source && source !== "en" && target !== "en") {
        const a = await chromeCreate(source, "en");
        const mid = await translateWith(a, texts, onProgress, 0, 0.5);
        if (a.destroy) try { a.destroy(); } catch (x) {}
        const b = await chromeCreate("en", target);
        const out = await translateWith(b, mid, onProgress, 0.5, 0.5);
        if (b.destroy) try { b.destroy(); } catch (x) {}
        return out;
      }
      throw e;
    }
    const res = await translateWith(tr, texts, onProgress, 0, 1);
    if (tr.destroy) try { tr.destroy(); } catch (e) {}
    return res;
  }

  async function chromeAvailability(source, target) {
    const API = getTranslatorAPI();
    if (!API) return "unavailable";
    try {
      if (typeof API.availability === "function") return await API.availability({ sourceLanguage: source, targetLanguage: target });
      if (typeof API.canTranslate === "function") return await API.canTranslate({ sourceLanguage: source, targetLanguage: target });
    } catch (e) {}
    return "unknown";
  }

  // ---- language detection ------------------------------------------------
  async function detect(sample) {
    try {
      const D = global.LanguageDetector || (global.translation && global.translation);
      if (global.LanguageDetector && global.LanguageDetector.create) {
        const det = await global.LanguageDetector.create();
        const r = await det.detect(sample.slice(0, 2000));
        if (r && r[0] && r[0].detectedLanguage) return r[0].detectedLanguage.slice(0, 2);
      } else if (global.translation && global.translation.createDetector) {
        const det = await global.translation.createDetector();
        const r = await det.detect(sample.slice(0, 2000));
        if (r && r[0] && r[0].detectedLanguage) return r[0].detectedLanguage.slice(0, 2);
      }
    } catch (e) {}
    // crude fallback by script
    if (/[一-鿿]/.test(sample)) return "zh";
    if (/[Ѐ-ӿ]/.test(sample)) return "uk";
    if (/[áéíóúñ¿¡]/i.test(sample)) return "es";
    return "en";
  }

  // ---- main --------------------------------------------------------------
  async function run(md, opts, onProgress) {
    opts = opts || {};
    const target = opts.target;
    const provider = opts.provider; // 'deepl' | 'chrome'
    // DeepL auto-detects the source language, so only run on-device detection
    // for the Chrome engine (which requires an explicit sourceLanguage).
    let source = opts.source || null;
    if (provider !== "deepl") {
      const detected = source || await detect(md);
      source = (detected && detected !== target) ? detected : null;
    }
    const { out, jobs } = segment(md);
    const texts = jobs.map((j) => j.text);
    if (onProgress) onProgress(0.02);
    let translated;
    if (provider === "deepl") {
      translated = await deeplBatch(texts, target, source, opts.key, (p) => onProgress && onProgress(0.02 + p * 0.95));
    } else {
      translated = await chromeBatch(texts, target, source || "en", (p) => onProgress && onProgress(0.02 + p * 0.95));
    }
    translated.forEach((tr, k) => { if (jobs[k]) jobs[k].set(tr); });
    for (let i = 0; i < out.length; i++) if (out[i] && typeof out[i].render === "function") out[i] = out[i].render();
    if (onProgress) onProgress(1);
    return out.join("\n");
  }

  global.MDTranslate = { run, detect, chromeAvailability, hasChrome: () => !!getTranslatorAPI(), LANGS };
})(typeof window !== "undefined" ? window : this);
