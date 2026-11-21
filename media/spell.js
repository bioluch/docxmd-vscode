/* DOCXMD — own spell-checking (Hunspell in js/spell-worker.js), independent of the browser's settings:
     • the document preview: misspelled words get a red wavy underline; a click opens the suggestions;
     • a text field (dictation original / translation): the same underline over the text and a row of
       "possible mistakes" under it, each one a button with the suggestions.
   Dictionaries: uk, ru, en (US), en-GB, es, pt, de, fr, pl, it. Words in Cyrillic are checked as Ukrainian or
   Russian, words in Latin letters in the text's language (English otherwise); languages without a dictionary,
   Japanese and Chinese are not checked. Words the user adds are kept per dictionary in this browser.
   Shared with the VS Code extension (vscode-extension/media/spell.js).
*/
(function () {
  "use strict";
  // dictionaries on this site (models/dict/<code>)
  const DICTS = ["uk", "ru", "en", "en-GB", "es", "pt", "de", "fr", "pl", "it"];
  const LATIN = ["en", "es", "pt", "de", "fr", "pl", "it"];
  // languages not written in Latin letters: their Latin words are quotes — English (US or GB)
  const NONLATIN = ["uk", "ru", "be", "bg", "sr", "mk", "kk", "ja", "zh", "ko", "el", "ar", "he", "hi", "th", "ka", "hy"];
  const LS_ON = "docxmd:spell", LS_USER = "docxmd:spell:user:";
  const WORD = /[\p{L}\p{M}]+(?:['’ʼ-][\p{L}\p{M}]+)*/gu;
  const SKIP = "code,pre,kbd,samp,script,style,svg,math,.katex,.katex-display,.mmd-fig,.mermaid,.footnotes-sep,.fm-card,.toc,.cite,.csl-bib-body,.refs-title,.fn-ref,.fn-back,[data-nospell],.sp-err,.pe-handle";
  const SKIP_WORDS = SKIP.replace(",.sp-err", "");   // the words to check include the ones underlined last time
  let worker = null, seq = 0, ui = { t: (k) => k, esc: (s) => s };
  const wait = new Map(), known = new Map();     // lang → Map(word → correct?)

  // the worker: js/spell-worker.js here; the VS Code extension passes its own (configure({ makeWorker }))
  function getWorker() {
    if (!worker) {
      worker = Promise.resolve(ui.makeWorker ? ui.makeWorker() : new Worker("js/spell-worker.js", { type: "module" })).then((w) => {
        w.onmessage = (e) => { const d = e.data || {}, p = wait.get(d.id); if (!p) return; wait.delete(d.id); if (d.type === "error") p.reject(new Error(d.message)); else p.resolve(d); };
        w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); wait.forEach((p) => p.reject(new Error("spell worker"))); wait.clear(); worker = null; };
        return w;
      });
      worker.catch(() => { worker = null; });   // a failed start can be tried again
    }
    return worker;
  }
  const call = (msg) => new Promise((resolve, reject) => {
    const id = ++seq; wait.set(id, { resolve, reject });
    getWorker().then((w) => w.postMessage(Object.assign({ id }, msg)), (e) => { wait.delete(id); reject(e); });
  });
  const norm = (w) => w.replace(/[’ʼ`]/g, "'");
  const base = (lang) => String(lang || "").toLowerCase().slice(0, 2);
  const enabled = () => { try { return localStorage.getItem(LS_ON) !== "0"; } catch (e) { return true; } };
  function setEnabled(on) { try { localStorage.setItem(LS_ON, on ? "1" : "0"); } catch (e) { /* private mode */ } }
  // which dictionaries check this word in a text of `lang` — a word is right when ANY of them accepts it;
  // [] = not checked (no dictionary for that language: better nothing than every word marked)
  function dictsFor(word, lang) {
    const b = base(lang), region = String(lang || "").split(/[-_]/)[1] || "";
    if (/[\u0400-\u04ff]/.test(word)) {
      if (b === "uk" || b === "ru") return [b];
      if (NONLATIN.includes(b)) return [];                  // Belarusian, Bulgarian… : no dictionary
      return ["uk", "ru"];                                  // a Cyrillic quote in a Latin text
    }
    if (!/^[\p{Script=Latin}\p{M}'’ʼ-]+$/u.test(word)) return [];
    if (b === "en") return region.toUpperCase() === "GB" ? ["en-GB"] : region.toUpperCase() === "US" ? ["en"] : ["en", "en-GB"];
    if (LATIN.includes(b)) return [b];
    if (NONLATIN.includes(b) || !b) return ["en", "en-GB"];  // an English term in a Ukrainian / Japanese… text
    return [];                                              // Dutch, Czech… : no dictionary yet
  }
  // not words to check: one letter, digits, ALL CAPS (abbreviations), camelCase / mixed case inside
  const skipWord = (w) => w.length < 2 || /\d/.test(w) || (w === w.toUpperCase() && w.length > 1) || /\p{Ll}\p{Lu}/u.test(w);
  function userWords(dict) { try { return new Set(JSON.parse(localStorage.getItem(LS_USER + dict) || "[]")); } catch (e) { return new Set(); } }
  // a word the user calls right is right in every dictionary that may check it together with this one
  // (en + en-GB, uk + ru), now and after a reload
  const SHARED = { en: ["en", "en-GB"], "en-GB": ["en", "en-GB"], uk: ["uk", "ru"], ru: ["uk", "ru"] };
  function addUserWord(dict, word) {
    const w = norm(word);
    for (const d of SHARED[dict] || [dict]) {
      const s = userWords(d); s.add(w);
      try { localStorage.setItem(LS_USER + d, JSON.stringify([...s])); } catch (e) { /* private mode */ }
      if (known.has(d)) known.get(d).set(w, true);
    }
  }

  // words → Map(misspelled word → the dictionary to ask for suggestions)
  async function check(words, lang) {
    const todo = new Map(), uniq = new Set(words), plan = new Map();
    for (const raw of uniq) {
      if (skipWord(raw)) continue;
      const ds = dictsFor(raw, lang); if (!ds.length) continue;
      plan.set(raw, ds);
      const w = norm(raw);
      for (const d of ds) {
        if (!known.has(d)) known.set(d, new Map());
        if (known.get(d).has(w)) continue;
        if (!todo.has(d)) todo.set(d, new Set());
        todo.get(d).add(w);
      }
    }
    await Promise.all([...todo].map(async ([d, set]) => {
      const list = [...set], r = await call({ type: "check", lang: d, words: list });
      const bad = new Set(r.bad), user = userWords(d), k = known.get(d);
      list.forEach((w) => k.set(w, !bad.has(w) || user.has(w)));
    }));
    const out = new Map();
    plan.forEach((ds, raw) => {
      const w = norm(raw);
      if (ds.every((d) => known.get(d) && known.get(d).get(w) === false)) out.set(raw, ds[0]);
    });
    return out;
  }
  async function suggest(word, dict) {
    const r = await call({ type: "suggest", lang: dict, word: norm(word) });
    return r.list || [];
  }

  // The language of a text for spell-checking: the browser's detector where there is one (any language),
  // else by the alphabet and the most frequent little words. "" = unknown.
  const STOP = {
    en: ["the", "and", "of", "to", "is", "in", "that", "with", "for", "this", "are", "was", "be", "it", "on"],
    de: ["der", "die", "und", "das", "ist", "nicht", "mit", "den", "ein", "eine", "zu", "von", "auf", "für", "sich"],
    fr: ["le", "la", "les", "et", "des", "est", "une", "du", "que", "dans", "pour", "pas", "sur", "au", "avec"],
    es: ["el", "la", "los", "las", "y", "de", "que", "en", "es", "por", "con", "para", "una", "del", "se"],
    pt: ["o", "a", "os", "as", "e", "de", "que", "em", "do", "da", "não", "para", "com", "uma", "é"],
    it: ["il", "la", "le", "e", "di", "che", "è", "per", "un", "una", "con", "non", "del", "della", "sono"],
    pl: ["i", "w", "nie", "się", "na", "jest", "że", "z", "do", "to", "jak", "czy", "przez", "od", "dla", "jutro", "o", "są", "oraz", "ale", "po", "już", "tak", "co", "być"]
  };
  let detP = null;
  async function detectLang(sample) {
    const text = String(sample || "").slice(0, 4000);
    try {
      if (window.LanguageDetector && window.LanguageDetector.create) {
        detP = detP || window.LanguageDetector.create().catch(() => null);   // created once, reused for every render
        const det = await Promise.race([detP, new Promise((res) => setTimeout(() => res(null), 2000))]);
        const r = det && await Promise.race([det.detect(text), new Promise((res) => setTimeout(() => res(null), 1500))]);
        if (r && r[0] && r[0].detectedLanguage && r[0].detectedLanguage !== "und" && (r[0].confidence == null || r[0].confidence > 0.5)) return r[0].detectedLanguage;
      }
    } catch (e) { /* by the alphabet below */ }
    if (/[\u3040-\u30ff]/.test(text)) return "ja";
    if (/[\u4e00-\u9fff]/.test(text)) return "zh";
    const cyr = (text.match(/[\u0400-\u04ff]/g) || []).length, lat = (text.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
    if (cyr > lat) return /[іїєґ]/i.test(text) ? "uk" : /[ыэъё]/i.test(text) ? "ru" : "uk";
    if (!lat) return "";
    const words = text.toLowerCase().match(/[\p{L}]+/gu) || [], score = {};
    for (const l in STOP) { const set = new Set(STOP[l]); score[l] = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0); }
    // letters only one of these languages has weigh more than the little words
    const LETTERS = { pl: /[ąćęłńśźż]/g, de: /[äöüß]/g, fr: /[œëïûî]/g, es: /[ñ¿¡]/g, pt: /[ãõ]/g };
    for (const l in LETTERS) score[l] += 2 * Math.min(5, (text.toLowerCase().match(LETTERS[l]) || []).length);
    const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    return score[best] >= 2 ? best : "en";
  }

  /* ---------- the suggestions menu ---------- */
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", onKey, true); } }
  const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } };
  function openMenu(anchor, word, dict, onPick) {
    closeMenu();
    menu = document.createElement("div");
    menu.className = "sp-menu embossed";
    menu.setAttribute("role", "menu");
    menu.innerHTML = '<div class="sp-word">' + ui.esc(word) + '</div><div class="sp-list"><span class="sp-wait">' + ui.esc(ui.t("spell.wait")) + "</span></div>" +
      '<button type="button" class="sp-add">' + ui.esc(ui.t("spell.add")) + "</button>";
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect(), mw = Math.min(260, innerWidth - 16);
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + "px";
    const below = r.bottom + 6, h = menu.offsetHeight || 160;
    menu.style.top = (below + h < innerHeight ? below : Math.max(8, r.top - h - 6)) + "px";
    menu.querySelector(".sp-add").addEventListener("click", () => { addUserWord(dict, word); closeMenu(); onPick(null); });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey, true);
    const m = menu;
    suggest(word, dict).then((list) => {
      if (menu !== m) return;
      const box = m.querySelector(".sp-list");
      box.innerHTML = list.length ? "" : '<span class="sp-wait">' + ui.esc(ui.t("spell.none")) + "</span>";
      list.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "sp-sug"; b.textContent = s;
        b.addEventListener("click", () => { closeMenu(); onPick(s); });
        box.appendChild(b);
      });
      const f = box.querySelector("button"); if (f) f.focus();
    }).catch(() => { if (menu === m) m.querySelector(".sp-list").innerHTML = '<span class="sp-wait">' + ui.esc(ui.t("spell.none")) + "</span>"; });
  }

  /* ---------- the document preview ---------- */
  function textNodes(root, skip) {
    const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!n.nodeValue.trim() || (n.parentElement && n.parentElement.closest(skip || SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }
  function unmark(root) {
    root.querySelectorAll("span.sp-err").forEach((s) => s.replaceWith(document.createTextNode(s.textContent)));
    root.normalize();
  }
  // underline the misspelled words of `root` (written in `lang`); isStale() true = a newer render came
  async function markPreview(root, lang, isStale) {
    if (!enabled() || !root) return 0;
    const b = base(lang);
    if (b === "ja" || b === "zh") return 0;
    const words = [];
    textNodes(root, SKIP_WORDS).forEach((n) => { const m = n.nodeValue.match(WORD); if (m) words.push(...m); });
    let bad = new Map();
    if (words.length) { try { bad = await check(words, lang); } catch (e) { return 0; } }
    if (isStale && isStale()) return bad.size;
    // the marks of an earlier pass (another language, a word added to the dictionary since) go first
    if (root.querySelector("span.sp-err")) unmark(root);
    if (!bad.size) return 0;
    for (const n of textNodes(root)) {
      if (!n.isConnected) continue;
      const v = n.nodeValue;
      let last = 0, frag = null;
      for (const m of v.matchAll(WORD)) {
        const d = bad.get(m[0]); if (!d) continue;
        frag = frag || document.createDocumentFragment();
        if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)));
        const s = document.createElement("span");
        s.className = "sp-err"; s.dataset.spDict = d; s.textContent = m[0];
        frag.appendChild(s);
        last = m.index + m[0].length;
      }
      if (frag) { if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last))); n.replaceWith(frag); }
    }
    return bad.size;
  }
  // the clicked underlined word is the n-th occurrence of that word in the preview's checked text
  function occurrence(root, span) {
    let n = 0, at = -1;
    for (const t of textNodes(root).concat([...root.querySelectorAll("span.sp-err")].map((s) => s.firstChild)).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))) {
      if (t === span.firstChild) at = n;
      for (const m of (t.nodeValue || "").matchAll(WORD)) if (m[0] === span.textContent) n++;
    }
    return at < 0 ? n : at;
  }
  // how many times the preview shows `word` as checked text
  function count(root, word) {
    let n = 0;
    for (const t of textNodes(root, SKIP_WORDS)) for (const m of (t.nodeValue || "").matchAll(WORD)) if (m[0] === word) n++;
    return n;
  }

  // where the n-th checked occurrence of `word` is in the Markdown source: the same occurrences the preview
  // shows as text, so front matter, code, link / image addresses, URLs and HTML tags are not counted;
  // null when it cannot be found (then nothing is replaced — never another occurrence)
  const NOT_PROSE = [
    /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g,   // front matter
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[ \t]*(?=\n|$)|$)/gm,       // fenced code
    /(`+)[\s\S]*?\1/g,                                                  // inline code
    /\]\([^)\s]*(?:\s+"[^"]*")?\)/g, /^\s*\[[^\]]+\]:\s*\S+.*$/gm,  // link / image addresses, reference definitions
    /<(code|pre|kbd|samp|script|style|math|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,     // code in HTML: tag and content
    /<[a-zA-Z\/!][^>]*>/g, /\bhttps?:\/\/[^\s<>()]+/g, /\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g,   // HTML tags, URLs, formulas
    /&#?\w+;/g                                                             // character references
  ];
  // total: how many such words the preview shows — when the source has another number (a word written with
  // character references, a word made by HTML), the n-th cannot be trusted and nothing is replaced
  function sourceRange(text, word, nth, total) {
    const skip = [];
    for (const re of NOT_PROSE) { re.lastIndex = 0; let m; while ((m = re.exec(text))) { skip.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; } }
    // a word written with character references (te&#104;) shows as text the source does not have: ambiguous
    if (/[\p{L}\p{M}]&#?\w+;|&#?\w+;[\p{L}\p{M}]/u.test(text)) return null;
    const hits = [];
    for (const m of text.matchAll(WORD)) {                // the same words the check sees (also 'quoted')
      if (m[0] !== word) continue;
      const a = m.index, b = a + m[0].length;
      if (!skip.some(([x, y]) => a < y && b > x)) hits.push([a, b]);
    }
    if (total != null && hits.length !== total) return null;
    return hits[nth] || null;
  }

  /* ---------- a text field: "possible mistakes" under it ---------- */
  function attachField(ta, getLang, onChange) {
    const bar = document.createElement("div");
    bar.className = "sp-bar"; bar.hidden = true;
    ta.insertAdjacentElement("afterend", bar);
    // a textarea cannot underline its own words: a transparent copy of its text lies over it
    // (same box, font and scroll) and only the misspelled words in it are drawn — with a red wavy line
    const mir = document.createElement("div");
    mir.className = "sp-mirror"; mir.setAttribute("aria-hidden", "true"); mir.hidden = true;
    const host = ta.parentElement;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(mir);
    let marked = null;                                  // Map word → dict of the last check, for the text shown
    function layout() {
      if (mir.hidden) return;
      const cs = getComputedStyle(ta);
      ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textAlign", "tabSize", "textIndent",
        "paddingTop", "paddingLeft", "paddingBottom", "borderTopWidth", "borderLeftWidth", "borderBottomWidth", "borderRightWidth", "boxSizing"]
        .forEach((k) => { mir.style[k] = cs[k]; });
      const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
      const sb = Math.max(0, ta.offsetWidth - ta.clientWidth - bl - br);   // the textarea's scrollbar
      mir.style.paddingRight = (parseFloat(cs.paddingRight) || 0) + sb + "px";
      mir.style.left = ta.offsetLeft + "px"; mir.style.top = ta.offsetTop + "px";
      mir.style.width = ta.offsetWidth + "px"; mir.style.height = ta.offsetHeight + "px";
      mir.scrollTop = ta.scrollTop;
    }
    const escT = (x) => x.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    function draw() {
      const v = ta.value;
      if (!marked || !marked.size || !v || ta.hidden || !enabled()) { mir.hidden = true; mir.textContent = ""; return; }
      let html = "", last = 0;
      for (const m of v.matchAll(WORD)) {
        if (!marked.has(m[0])) continue;
        html += escT(v.slice(last, m.index)) + '<span class="sp-u">' + escT(m[0]) + "</span>";
        last = m.index + m[0].length;
      }
      mir.innerHTML = html + escT(v.slice(last)) + "\u200b";   // a last empty line keeps its height
      mir.hidden = false;
      layout();
    }
    ta.addEventListener("scroll", () => { mir.scrollTop = ta.scrollTop; });
    ["focus", "blur"].forEach((ev) => ta.addEventListener(ev, () => requestAnimationFrame(layout)));
    if (window.ResizeObserver) new ResizeObserver(() => layout()).observe(ta);
    let timer = 0, gen = 0;
    function clear() { clearTimeout(timer); gen++; marked = null; bar.hidden = true; bar.innerHTML = ""; draw(); }
    async function refresh() {
      clearTimeout(timer);
      const g = ++gen;
      if (!enabled() || !ta.value.trim()) { clear(); return; }
      const lang = getLang(), b = base(lang);
      if (b === "ja" || b === "zh") { clear(); return; }
      let bad;
      try { bad = await check(ta.value.match(WORD) || [], lang); } catch (e) { return; }
      if (g !== gen) return;
      marked = bad; draw();
      bar.innerHTML = "";
      if (!bad.size) { bar.hidden = true; return; }
      const lbl = document.createElement("span"); lbl.className = "sp-lbl"; lbl.textContent = ui.t("spell.found");
      bar.appendChild(lbl);
      bad.forEach((dict, word) => {
        const chip = document.createElement("button");
        chip.type = "button"; chip.className = "sp-chip"; chip.textContent = word;
        chip.addEventListener("click", () => openMenu(chip, word, dict, (rep) => {
          if (rep != null) {
            ta.value = ta.value.replace(WORD, (w) => (w === word ? rep : w));   // whole words, as the check sees them
            ta.dispatchEvent(new Event("input", { bubbles: true }));   // the dictation re-translates an edited original
            if (onChange) onChange();
          }
          refresh();
        }));
        bar.appendChild(chip);
      });
      bar.hidden = false;
    }
    // while typing, the old underlines would sit under shifted text: they go until the next check
    ta.addEventListener("input", () => { clearTimeout(timer); gen++; mir.hidden = true; timer = setTimeout(refresh, 500); });   // gen++: a check still running is for the old text
    return { refresh, clear, bar };
  }

  window.DOCXMDSpell = {
    configure(o) { ui = Object.assign(ui, o || {}); },
    enabled, setEnabled, check, suggest, markPreview, unmark, occurrence, count, sourceRange, openMenu, closeMenu, attachField,
    detectLang,
    supported: (lang) => DICTS.includes(base(lang)),
    WORD
  };
})();
