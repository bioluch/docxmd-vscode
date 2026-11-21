/* DOCXMD for VS Code — spell-checking worker: Hunspell (WebAssembly, vendor/hunspell/hunspell.iife.js).
   A webview cannot start a worker from its own files, so webview.js joins the Hunspell build and this
   file into one blob. The dictionaries come from the extension host (downloaded once from
   docxmd.pp.ua/models/dict/ and kept in the extension's storage): the worker asks the page for them.
     → {type:"check", id, lang, words:[...]}    ← {type:"checked", id, bad:[...]}
     → {type:"suggest", id, lang, word}          ← {type:"suggested", id, list:[...]}
     ← {type:"error", id, message}
     ← {type:"dict", rid, lang}                  → {type:"dictData", rid, aff, dic} / {type:"dictData", rid, error}
*/
(function () {
  "use strict";
  let factoryP = null, rseq = 0;
  const spellers = new Map(), dictWait = new Map();
  // Hunspell's WebAssembly runtime; an abort while it starts would leave loadModule() pending for ever,
  // so it gets 30 s — and a failed start is tried again next time
  function startFactory() {
    const p = Promise.race([self.HunspellAsm.loadModule(), new Promise((_, rej) => setTimeout(() => rej(new Error("Hunspell did not start")), 30000))]);
    p.catch(() => { if (factoryP === p) factoryP = null; });
    return p;
  }
  function dictionary(lang) {
    return new Promise((resolve, reject) => {
      const rid = ++rseq;
      dictWait.set(rid, { resolve, reject });
      postMessage({ type: "dict", rid, lang });
    });
  }
  function speller(lang) {
    if (!spellers.has(lang)) {
      const p = (async () => {
        factoryP = factoryP || startFactory();
        const [factory, d] = await Promise.all([factoryP, dictionary(lang)]);
        return factory.create(factory.mountBuffer(new Uint8Array(d.aff), lang + ".aff"), factory.mountBuffer(new Uint8Array(d.dic), lang + ".dic"));
      })();
      p.catch(() => spellers.delete(lang));       // a failed load can be tried again
      spellers.set(lang, p);
    }
    return spellers.get(lang);
  }
  self.onmessage = async (e) => {
    const m = e.data || {};
    if (m.type === "dictData") {
      const w = dictWait.get(m.rid); if (!w) return;
      dictWait.delete(m.rid);
      if (m.error || !m.aff || !m.dic) w.reject(new Error(m.error || "no dictionary")); else w.resolve(m);
      return;
    }
    try {
      const h = await speller(m.lang);
      if (m.type === "check") {
        const bad = [];
        for (const w of m.words || []) { try { if (!h.spell(w)) bad.push(w); } catch (x) { /* odd input: skip */ } }
        postMessage({ type: "checked", id: m.id, bad });
      } else if (m.type === "suggest") {
        let list = [];
        try { list = h.suggest(m.word) || []; } catch (x) { list = []; }
        postMessage({ type: "suggested", id: m.id, list: list.slice(0, 7) });
      }
    } catch (err) {
      postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
    }
  };
})();
