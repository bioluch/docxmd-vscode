/* DOCXMD — resize images right in the preview.
   Hover an image → a handle appears at its bottom-right corner; drag it and the
   image follows live; on release the width is written into the Markdown source
   ({width=NN%} after ![](…), width="…" on <img>). Double-click the handle resets
   the image to its natural size; ←/→ on the focused handle step by 5 % (10 px).
   Units: % of the text column; px for images inside tables and for images that
   already use an absolute width.
   Shared by the PWA (js/app.js) and the VS Code webview (media/webview.js).
   Exposes: window.DOCXMDImageResize.attach({ preview, getText, applyEdit, label })
            -> { refresh() }   (call refresh() after every preview render) */
(function (global) {
  "use strict";

  const CSS =
    ".img-rs-handle{position:fixed;z-index:60;width:14px;height:14px;padding:0;margin:0;border:2px solid #fff;border-radius:3px;" +
    "background:var(--accent,#0984e3);box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:nwse-resize;touch-action:none;display:none}" +
    ".img-rs-handle:focus-visible{outline:2px solid var(--accent,#0984e3);outline-offset:2px}" +
    ".img-rs-badge{position:fixed;z-index:61;padding:2px 7px;border-radius:5px;font:600 12px/1.5 system-ui,sans-serif;" +
    "background:rgba(20,20,20,.82);color:#fff;pointer-events:none;display:none;white-space:nowrap}" +
    ".img-rs-active{outline:2px dashed var(--accent,#0984e3);outline-offset:2px}" +
    "body.img-rs-dragging,body.img-rs-dragging *{cursor:nwse-resize!important;user-select:none!important}";

  const norm = (s) => { try { return decodeURI(s); } catch (e) { return s; } };
  const same = (a, b) => a != null && b != null && (a === b || norm(a) === norm(b));

  function attach(o) {
    const M = global.MD2DOCX;
    if (!o || !o.preview || !M || !M.imageRanges) return { refresh() {} };
    const preview = o.preview, label = o.label || (() => "");
    if (!document.getElementById("img-rs-style")) {
      const st = document.createElement("style"); st.id = "img-rs-style"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    const handle = document.createElement("button");
    handle.type = "button"; handle.className = "img-rs-handle";
    const badge = document.createElement("div"); badge.className = "img-rs-badge";
    document.body.append(handle, badge);

    // preview <img> → its src exactly as written in the Markdown (before any
    // blob: rewriting of local images)
    let srcOf = new WeakMap();
    let cur = null, drag = null;

    function refresh() {
      srcOf = new WeakMap();
      preview.querySelectorAll("img").forEach((img) => srcOf.set(img, img.getAttribute("src")));
      hide();
    }
    function hide() {
      if (drag) return;
      if (cur) cur.classList.remove("img-rs-active");
      cur = null; handle.style.display = "none"; badge.style.display = "none";
    }
    // the element that scrolls the preview (#preview itself or its pane)
    function scroller() {
      for (let n = preview; n && n !== document.body; n = n.parentElement) if (/auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
      return preview;
    }
    function place() {
      if (!cur || !cur.isConnected) { hide(); return; }
      const r = cur.getBoundingClientRect(), p = scroller().getBoundingClientRect();
      // keep the handle hidden while the image corner is scrolled out of view
      const vis = r.bottom > p.top && r.bottom < p.bottom + 1 && r.right > p.left && r.right < p.right + 8;
      handle.style.display = vis ? "block" : "none";
      handle.style.left = (r.right - 9) + "px"; handle.style.top = (r.bottom - 9) + "px";
      if (drag) { badge.style.display = "block"; badge.style.left = Math.max(4, r.right - badge.offsetWidth) + "px"; badge.style.top = (r.bottom + 10) + "px"; }
    }
    function show(img) {
      if (drag || img === cur) return;
      if (!srcOf.has(img)) return;              // welcome screen etc.
      if (cur) cur.classList.remove("img-rs-active");
      cur = img; cur.classList.add("img-rs-active");
      handle.title = label("img.resize");
      place();
    }

    // Source range of a preview image: the k-th image with the same src
    function locate(img) {
      const src = srcOf.get(img); if (src == null) return null;
      const k = Array.from(preview.querySelectorAll("img")).filter((i) => same(srcOf.get(i), src)).indexOf(img);
      const rs = M.imageRanges(o.getText()).filter((r) => same(r.src, src));
      return k >= 0 && rs[k] ? rs[k] : null;
    }
    function currentWidth(r) {
      if (r.kind === "md") { const m = r.attr && /\bwidth\s*=\s*"?([\d.]+(?:%|px|cm|mm|in)?)"?/.exec(r.attr.text); return m ? m[1] : ""; }
      const st = /\sstyle\s*=\s*["'][^"']*?\bwidth\s*:\s*([\d.]+(?:%|px|cm|mm|in))/i.exec(r.tag);
      const a = /\swidth\s*=\s*["']?([\d.]+%?)/i.exec(r.tag);
      return st ? st[1] : a ? a[1] : "";
    }
    // the box a CSS percentage width refers to: the nearest block ancestor
    function column(img) {
      let n = img.parentElement;
      while (n && n !== preview && /^inline/.test(getComputedStyle(n).display)) n = n.parentElement;
      n = n || preview;
      const cs = getComputedStyle(n);
      return Math.max(1, n.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
    }
    function unitFor(img, r) {
      if (img.closest("td,th")) return "px";
      const w = currentWidth(r);
      return w && !/%$/.test(w) ? "px" : "%";
    }
    function value(px, unit, col) {
      return unit === "%" ? Math.max(1, Math.min(100, Math.round(px / col * 100))) + "%" : Math.max(8, Math.round(px)) + "px";
    }
    function commit(img, width) {
      const r = locate(img);
      if (!r) return false;
      const e = M.imageWidthEdit(r, width);
      if (e && o.getText().slice(e.start, e.end) !== e.text) o.applyEdit(e.start, e.end, e.text);
      return true;
    }

    preview.addEventListener("pointerover", (e) => { if (e.target.nodeName === "IMG" && preview.contains(e.target)) show(e.target); });
    preview.addEventListener("click", (e) => { if (e.target.nodeName === "IMG") show(e.target); }); // touch
    document.addEventListener("pointermove", (e) => {
      if (!cur || drag) return;
      const t = e.target;
      if (t === cur || t === handle) return;
      const r = cur.getBoundingClientRect(); // grace zone around the corner handle
      if (e.clientX > r.left - 12 && e.clientX < r.right + 12 && e.clientY > r.top - 12 && e.clientY < r.bottom + 12) return;
      hide();
    }, { passive: true });
    document.addEventListener("scroll", () => { if (cur) place(); }, true);
    global.addEventListener("resize", () => { if (cur) place(); });

    handle.addEventListener("pointerdown", (e) => {
      if (!cur || e.button > 0) return;
      const r = locate(cur);
      if (!r) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const col = column(cur), w0 = cur.getBoundingClientRect().width;
      drag = { x: e.clientX, w0, col, unit: unitFor(cur, r), prev: cur.style.width, moved: false };
      document.body.classList.add("img-rs-dragging");
      badge.textContent = value(w0, drag.unit, col);
      place();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const w = Math.max(16, Math.min(drag.col, drag.w0 + (e.clientX - drag.x)));
      if (Math.abs(e.clientX - drag.x) > 2) drag.moved = true;
      cur.style.width = w + "px"; cur.style.height = "auto";
      badge.textContent = value(w, drag.unit, drag.col) + (drag.unit === "%" ? " · " + Math.round(w) + "px" : "");
      place();
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      document.body.classList.remove("img-rs-dragging");
      badge.style.display = "none";
      try { handle.releasePointerCapture(e.pointerId); } catch (x) {}
      if (!d.moved) { cur.style.width = d.prev; return; }
      const img = cur;
      if (!commit(img, value(img.getBoundingClientRect().width, d.unit, d.col))) img.style.width = d.prev;
      place();
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("dblclick", (e) => { e.preventDefault(); if (cur) { commit(cur, null); cur.style.width = ""; } });
    handle.addEventListener("keydown", (e) => {
      if (!cur || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const r = locate(cur); if (!r) return;
      const unit = unitFor(cur, r), col = column(cur), w = cur.getBoundingClientRect().width;
      const step = (e.key === "ArrowRight" ? 1 : -1) * (unit === "%" ? col * 0.05 : 10);
      const nw = Math.max(16, Math.min(col, w + step));
      cur.style.width = nw + "px";
      commit(cur, value(nw, unit, col));
      place();
    });

    return { refresh };
  }

  global.DOCXMDImageResize = { attach };
})(typeof window !== "undefined" ? window : this);
