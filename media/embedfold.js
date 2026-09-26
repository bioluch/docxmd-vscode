/* DOCXMD — embedded pictures folded out of the editor text.

   A picture pasted as a data-URI (or imported from Word) is tens or hundreds of KB of
   base64 inside the Markdown. The browser has to lay out all of that text in the editor
   after every keystroke, so a document with a few dozen pictures becomes very slow.
   The editor therefore keeps a short token instead of each long data-URI —
       ![](data:image/png;base64,iVBORw0KG…130 KB…)   →   ![](#embedded-image-3)
   and the data itself in a store (one per window, shared by all tabs). Everything that
   leaves the editor — saving, Word / HTML export, copy, history, drafts — gets the full
   data back (expand), so the .md on disk stays an ordinary self-contained file.

   Exposes: window.DOCXMDFold = { store(), fold(text, st), expand(text, st), has(text),
     isToken(src), dataOf(st, src), blobOf(st, src), urlOf(st, src), add(st, uri),
     used(text), entries(st), MIN } */
(function (global) {
  "use strict";
  const MIN = 2048;                                              // shorter data-URIs stay in the text
  const PREFIX = "#embedded-image-";
  const DATA_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{2048,}/gi;
  const TOKEN_RE = /#embedded-image-(\d+)\b/g;

  // a quick, stable fingerprint of a data-URI (drafts keep each picture once, by hash)
  function hash(s) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i += 7) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995); }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
  }
  function store() { return { byId: new Map(), byUri: new Map(), urls: new Map(), next: 1 }; }
  // register a data-URI → its token (the same picture always gets the same token)
  function add(st, uri) {
    let id = st.byUri.get(uri);
    if (id == null) {
      id = st.next++;
      st.byId.set(id, { uri, hash: hash(uri) });
      st.byUri.set(uri, id);
    }
    return PREFIX + id;
  }
  // put a known picture back under its id (restoring drafts)
  function put(st, id, uri, h) {
    id = +id;
    st.byId.set(id, { uri, hash: h || hash(uri) });
    st.byUri.set(uri, id);
    if (id >= st.next) st.next = id + 1;
  }
  const has = (text) => !!text && text.indexOf("data:image/") !== -1 && (DATA_RE.lastIndex = 0, DATA_RE.test(text));
  function fold(text, st) {
    if (!text || text.indexOf("data:image/") === -1) return text;
    DATA_RE.lastIndex = 0;
    return text.replace(DATA_RE, (uri) => add(st, uri));
  }
  function expand(text, st) {
    if (!text || text.indexOf(PREFIX) === -1) return text;
    return text.replace(TOKEN_RE, (tok, id) => { const e = st.byId.get(+id); return e ? e.uri : tok; });
  }
  const idOf = (src) => { const m = /^#embedded-image-(\d+)$/.exec(String(src || "").trim()); return m ? +m[1] : null; };
  const isToken = (src) => idOf(src) != null;
  function dataOf(st, src) { const e = st.byId.get(idOf(src)); return e ? e.uri : null; }
  function blobOf(st, src) {
    const uri = dataOf(st, src); if (!uri) return null;
    const i = uri.indexOf(","), mime = /^data:([^;,]+)/.exec(uri)[1];
    const bin = atob(uri.slice(i + 1)), u8 = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    return new Blob([u8], { type: mime });
  }
  // object URL for the preview (made once per picture)
  function urlOf(st, src) {
    const id = idOf(src); if (id == null) return null;
    if (st.urls.has(id)) return st.urls.get(id);
    const b = blobOf(st, src); if (!b) return null;
    const u = URL.createObjectURL(b);
    st.urls.set(id, u);
    return u;
  }
  // ids referenced by a text
  function used(text) {
    const out = new Set(); if (!text) return out;
    TOKEN_RE.lastIndex = 0; let m;
    while ((m = TOKEN_RE.exec(text))) out.add(+m[1]);
    return out;
  }
  const entries = (st) => Array.from(st.byId.entries()).map(([id, e]) => ({ id, uri: e.uri, hash: e.hash }));

  global.DOCXMDFold = { store, fold, expand, has, isToken, dataOf, blobOf, urlOf, add, put, used, entries, hash, MIN, PREFIX };
})(typeof window !== "undefined" ? window : this);
