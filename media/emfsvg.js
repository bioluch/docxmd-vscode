/* DOCXMD — EMF (Windows Enhanced Metafile) → SVG, in the browser
   Word documents keep Visio drawings, plans and charts as EMF, which browsers cannot show. This draws the
   GDI records that such pictures use: polygons / polylines / Béziers (16 and 32 bit, poly-poly), move/line,
   rectangles, rounded rectangles, ellipses, paths (fill / stroke), pens (incl. extended), brushes, fonts and
   text (EXTTEXTOUTW with the per-character advances), world transforms, window / viewport mapping, saved
   DC states, and embedded bitmaps (STRETCHDIBITS / BITBLT / STRETCHBLT / SETDIBITSTODEVICE → PNG).
   EMF+ records (GDI+ comments) are skipped: files written with them also carry the GDI drawing.
   Exposes: window.DOCXMDEmf = { toSvg(u8) → Promise<string | null> } */
(function (global) {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const r2 = (v) => Math.round(v * 100) / 100;
  const colorref = (dv, o) => "#" + [dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2)].map((v) => v.toString(16).padStart(2, "0")).join("");
  const STOCK = {
    0: { t: "brush", style: 0, color: "#ffffff" }, 1: { t: "brush", style: 0, color: "#c0c0c0" }, 2: { t: "brush", style: 0, color: "#808080" },
    3: { t: "brush", style: 0, color: "#404040" }, 4: { t: "brush", style: 0, color: "#000000" }, 5: { t: "brush", style: 1 },
    6: { t: "pen", style: 0, width: 0, color: "#ffffff" }, 7: { t: "pen", style: 0, width: 0, color: "#000000" }, 8: { t: "pen", style: 5 },
    10: { t: "font", height: -12, weight: 400, face: "Courier New" }, 11: { t: "font", height: -12, weight: 400, face: "Courier New" },
    12: { t: "font", height: -12, weight: 400, face: "Arial" }, 13: { t: "font", height: -16, weight: 700, face: "Arial" },
    14: { t: "font", height: -12, weight: 400, face: "Arial" }, 16: { t: "font", height: -12, weight: 400, face: "Courier New" },
    17: { t: "font", height: -11, weight: 400, face: "Segoe UI, Arial" },
    18: { t: "brush", style: 0, color: "#ffffff" }, 19: { t: "pen", style: 0, width: 0, color: "#000000" }
  };
  const ID = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });          // x' = a·x + c·y + e, y' = b·x + d·y + f
  const mul = (A, B) => ({ a: A.a * B.a + A.b * B.c, b: A.a * B.b + A.b * B.d, c: A.c * B.a + A.d * B.c, d: A.c * B.b + A.d * B.d, e: A.e * B.a + A.f * B.c + B.e, f: A.e * B.b + A.f * B.d + B.f });

  // a DIB (BITMAPINFO + bits) → PNG data URI
  // src: the part of the bitmap the record transfers ({ x, y, w, h }; null = all of it). The ranges are
  // checked by the caller against the record; any failure here is just "no picture" (never a throw)
  async function dibPng(u8, start, offBmi, cbBmi, offBits, cbBits, src) {
    if (cbBmi < 40 || !cbBits || typeof createImageBitmap === "undefined") return null;
    try {
      const bmp = new Uint8Array(14 + cbBmi + cbBits), bv = new DataView(bmp.buffer);
      bmp[0] = 0x42; bmp[1] = 0x4D; bv.setUint32(2, bmp.length, true); bv.setUint32(10, 14 + cbBmi, true);
      bmp.set(u8.subarray(start + offBmi, start + offBmi + cbBmi), 14);
      bmp.set(u8.subarray(start + offBits, start + offBits + cbBits), 14 + cbBmi);
      const bm = await createImageBitmap(new Blob([bmp], { type: "image/bmp" }));
      let sx = 0, sy = 0, sw = bm.width, sh = bm.height;
      if (src && src.w > 0 && src.h > 0) {
        // a bottom-up DIB (positive height) counts ySrc from its lower edge; the decoded image from the top
        const bottomUp = new DataView(u8.buffer, u8.byteOffset + start + offBmi, 12).getInt32(8, true) > 0;
        const y0 = bottomUp ? bm.height - (src.y + src.h) : src.y;
        sx = Math.max(0, Math.min(bm.width - 1, src.x)); sy = Math.max(0, Math.min(bm.height - 1, y0));
        sw = Math.max(1, Math.min(bm.width - sx, src.w)); sh = Math.max(1, Math.min(bm.height - sy, src.h));
      }
      const cv = document.createElement("canvas"); cv.width = sw; cv.height = sh;
      cv.getContext("2d").drawImage(bm, sx, sy, sw, sh, 0, 0, sw, sh);
      return cv.toDataURL("image/png");
    } catch (e) { return null; }
  }

  async function toSvg(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 88 || dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464D4520) return null;   // " EMF"
    const B = { l: dv.getInt32(8, true), t: dv.getInt32(12, true), r: dv.getInt32(16, true), b: dv.getInt32(20, true) };
    const F = { l: dv.getInt32(24, true), t: dv.getInt32(28, true), r: dv.getInt32(32, true), b: dv.getInt32(36, true) };
    const devPx = { x: dv.getInt32(72, true), y: dv.getInt32(76, true) }, devMm = { x: dv.getInt32(80, true), y: dv.getInt32(84, true) };
    const pxPerMm = { x: devMm.x ? devPx.x / devMm.x : 96 / 25.4, y: devMm.y ? devPx.y / devMm.y : 96 / 25.4 };
    let st = {
      wOrg: { x: 0, y: 0 }, wExt: { x: 1, y: 1 }, vOrg: { x: 0, y: 0 }, vExt: { x: 1, y: 1 }, mapMode: 1, xf: ID(),
      pen: STOCK[7], brush: STOCK[0], font: STOCK[13], textColor: "#000000", align: 0, fillMode: 1, cur: { x: 0, y: 0 }
    };
    const stack = [], objs = {}, out = [];
    let path = null;                                          // the d of the current path (BEGINPATH … FILL / STROKE)
    let building = false;                                     // true only between BEGINPATH and ENDPATH
    // logical point → device point (reference device units, like rclBounds)
    const page = () => {
      const m = st.mapMode;
      if (m === 7 || m === 8) return { sx: st.wExt.x ? st.vExt.x / st.wExt.x : 1, sy: st.wExt.y ? st.vExt.y / st.wExt.y : 1 };
      const MM = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 }[m];   // LOMETRIC, HIMETRIC, LOENGLISH, HIENGLISH, TWIPS (mm per unit)
      if (MM) return { sx: MM * pxPerMm.x, sy: -MM * pxPerMm.y };
      return { sx: 1, sy: 1 };
    };
    const dev = (x, y) => {
      const X = st.xf, wx = X.a * x + X.c * y + X.e, wy = X.b * x + X.d * y + X.f, p = page();
      return [(wx - st.wOrg.x) * p.sx + st.vOrg.x - B.l, (wy - st.wOrg.y) * p.sy + st.vOrg.y - B.t];
    };
    const scale = () => { const p = page(), X = st.xf; return Math.sqrt(Math.abs((X.a * X.d - X.b * X.c) * p.sx * p.sy)) || 1; };
    const pt = (x, y) => { const d = dev(x, y); return r2(d[0]) + "," + r2(d[1]); };
    const strokeAttr = () => {
      const p = st.pen;
      if (!p || p.style === 5) return ' stroke="none"';
      const w = Math.max(p.width ? p.width * scale() : 1, 0.5);
      const ds = p.style === 1 ? [w * 4, w * 2] : p.style === 2 ? [w, w * 2] : p.style === 3 ? [w * 4, w * 2, w, w * 2] : p.style === 4 ? [w * 4, w * 2, w, w * 2, w, w * 2] : null;
      const cap = p.cap === 1 ? "square" : p.cap === 2 ? "butt" : "round", join = p.join === 1 ? "bevel" : p.join === 2 ? "miter" : "round";
      return ' stroke="' + p.color + '" stroke-width="' + r2(w) + '" stroke-linecap="' + cap + '" stroke-linejoin="' + join + '"' + (ds ? ' stroke-dasharray="' + ds.map(r2).join(",") + '"' : "");
    };
    const fillAttr = () => {
      const b = st.brush;
      if (!b || b.style === 1) return ' fill="none"';
      return ' fill="' + (b.color || "#000") + '"' + (st.fillMode === 2 ? ' fill-rule="nonzero"' : ' fill-rule="evenodd"');
    };
    const emit = (d, fill, stroke) => { if (d) out.push('<path d="' + d + '"' + (fill ? fillAttr() : ' fill="none"') + (stroke ? strokeAttr() : ' stroke="none"') + "/>"); };
    const points = (o, n, wide) => { const a = []; for (let k = 0; k < n; k++) a.push(wide ? [dv.getInt32(o + k * 8, true), dv.getInt32(o + k * 8 + 4, true)] : [dv.getInt16(o + k * 4, true), dv.getInt16(o + k * 4 + 2, true)]); return a; };
    const polyD = (pts, close) => (pts.length ? "M" + pts.map((p) => pt(p[0], p[1])).join(" L") + (close ? " Z" : "") : "");
    const bezD = (pts, from) => {
      let d = from ? "" : "M" + pt(pts[0][0], pts[0][1]);
      for (let k = from ? 0 : 1; k + 2 < pts.length; k += 3) d += " C" + pt(pts[k][0], pts[k][1]) + " " + pt(pts[k + 1][0], pts[k + 1][1]) + " " + pt(pts[k + 2][0], pts[k + 2][1]);
      return d;
    };
    const ellipseD = (l, t, r, b) => {
      const c = dev((l + r) / 2, (t + b) / 2), e1 = dev(r, (t + b) / 2), e2 = dev((l + r) / 2, b);
      const rx = Math.abs(e1[0] - c[0]) || Math.hypot(e1[0] - c[0], e1[1] - c[1]), ry = Math.abs(e2[1] - c[1]) || Math.hypot(e2[0] - c[0], e2[1] - c[1]);
      return "M" + r2(c[0] - rx) + "," + r2(c[1]) + " A" + r2(rx) + "," + r2(ry) + " 0 1,0 " + r2(c[0] + rx) + "," + r2(c[1]) + " A" + r2(rx) + "," + r2(ry) + " 0 1,0 " + r2(c[0] - rx) + "," + r2(c[1]) + " Z";
    };
    const shape = (d, fill, stroke) => { if (building) path += " " + d; else emit(d, fill, stroke); };
    const images = [];
    for (let i = 0; i + 8 <= u8.length;) {
      const type = dv.getUint32(i, true), size = dv.getUint32(i + 4, true);
      if (size < 8 || i + size > u8.length) break;
      const o = i;
      try {
        switch (type) {
          case 9: st.wExt = { x: dv.getInt32(o + 8, true), y: dv.getInt32(o + 12, true) }; break;           // SETWINDOWEXTEX
          case 10: st.wOrg = { x: dv.getInt32(o + 8, true), y: dv.getInt32(o + 12, true) }; break;          // SETWINDOWORGEX
          case 11: st.vExt = { x: dv.getInt32(o + 8, true), y: dv.getInt32(o + 12, true) }; break;          // SETVIEWPORTEXTEX
          case 12: st.vOrg = { x: dv.getInt32(o + 8, true), y: dv.getInt32(o + 12, true) }; break;          // SETVIEWPORTORGEX
          case 17: st.mapMode = dv.getUint32(o + 8, true); break;                                            // SETMAPMODE
          case 19: st.fillMode = dv.getUint32(o + 8, true); break;                                           // SETPOLYFILLMODE
          case 22: st.align = dv.getUint32(o + 8, true); break;                                              // SETTEXTALIGN
          case 24: st.textColor = colorref(dv, o + 8); break;                                                // SETTEXTCOLOR
          case 33: stack.push(JSON.parse(JSON.stringify(st))); break;                                        // SAVEDC
          case 34: { const n = dv.getInt32(o + 8, true); let k = n < 0 ? -n : stack.length - n; let s = null; while (k-- > 0 && stack.length) s = stack.pop(); if (s) st = s; break; }   // RESTOREDC
          case 35: st.xf = { a: dv.getFloat32(o + 8, true), b: dv.getFloat32(o + 12, true), c: dv.getFloat32(o + 16, true), d: dv.getFloat32(o + 20, true), e: dv.getFloat32(o + 24, true), f: dv.getFloat32(o + 28, true) }; break;
          case 36: {                                                                                          // MODIFYWORLDTRANSFORM
            const X = { a: dv.getFloat32(o + 8, true), b: dv.getFloat32(o + 12, true), c: dv.getFloat32(o + 16, true), d: dv.getFloat32(o + 20, true), e: dv.getFloat32(o + 24, true), f: dv.getFloat32(o + 28, true) };
            const mode = dv.getUint32(o + 32, true);
            st.xf = mode === 1 ? ID() : mode === 2 ? mul(X, st.xf) : mode === 3 ? mul(st.xf, X) : X; break;
          }
          case 38: objs[dv.getUint32(o + 8, true)] = { t: "pen", style: dv.getUint32(o + 12, true) & 0xF, width: dv.getInt32(o + 16, true), color: colorref(dv, o + 24) }; break;
          case 95: { const s = dv.getUint32(o + 28, true); objs[dv.getUint32(o + 8, true)] = { t: "pen", style: s & 0xF, cap: (s >> 8) & 0xF, join: (s >> 12) & 0xF, width: dv.getUint32(o + 32, true), color: colorref(dv, o + 40), nullBrush: dv.getUint32(o + 36, true) === 1 }; break; }
          case 39: objs[dv.getUint32(o + 8, true)] = { t: "brush", style: dv.getUint32(o + 12, true), color: colorref(dv, o + 16) }; break;
          case 82: {                                                                                          // EXTCREATEFONTINDIRECTW
            const L = o + 12; let face = "";
            for (let k = 0; k < 32; k++) { const ch = dv.getUint16(L + 28 + k * 2, true); if (!ch) break; face += String.fromCharCode(ch); }
            objs[dv.getUint32(o + 8, true)] = { t: "font", height: dv.getInt32(L, true), esc: dv.getInt32(L + 8, true), weight: dv.getInt32(L + 16, true), italic: dv.getUint8(L + 20), underline: dv.getUint8(L + 21), face: face || "Arial" };
            break;
          }
          case 37: {                                                                                          // SELECTOBJECT
            const ih = dv.getUint32(o + 8, true), ob = ih & 0x80000000 ? STOCK[ih & 0x7FFFFFFF] : objs[ih];
            if (ob) { if (ob.t === "pen") st.pen = ob.nullBrush ? Object.assign({}, ob, { style: 5 }) : ob; else if (ob.t === "brush") st.brush = ob; else if (ob.t === "font") st.font = ob; }
            break;
          }
          case 40: delete objs[dv.getUint32(o + 8, true)]; break;                                            // DELETEOBJECT
          case 27: st.cur = { x: dv.getInt32(o + 8, true), y: dv.getInt32(o + 12, true) }; if (building) path += " M" + pt(st.cur.x, st.cur.y); break;
          case 54: { const x = dv.getInt32(o + 8, true), y = dv.getInt32(o + 12, true);                      // LINETO
            if (building) path += " L" + pt(x, y); else emit("M" + pt(st.cur.x, st.cur.y) + " L" + pt(x, y), false, true);
            st.cur = { x, y }; break; }
          case 3: case 86: { const w = type === 3, n = dv.getUint32(o + 24, true); shape(polyD(points(o + 28, n, w), true), true, true); break; }   // POLYGON(16)
          case 4: case 87: { const w = type === 4, n = dv.getUint32(o + 24, true); shape(polyD(points(o + 28, n, w), false), false, true); break; } // POLYLINE(16)
          case 2: case 85: { const w = type === 2, n = dv.getUint32(o + 24, true); shape(bezD(points(o + 28, n, w), false), false, true); break; }  // POLYBEZIER(16)
          case 5: case 88: case 6: case 89: {                                                                 // POLYBEZIERTO / POLYLINETO (16)
            const w = type === 5 || type === 6, bz = type === 5 || type === 88, n = dv.getUint32(o + 24, true), pts = points(o + 28, n, w);
            const d = (building ? "" : "M" + pt(st.cur.x, st.cur.y)) + (bz ? bezD(pts, true) : pts.map((p) => " L" + pt(p[0], p[1])).join(""));
            if (building) path += d; else emit(d, false, true);
            if (pts.length) st.cur = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
            break;
          }
          case 7: case 8: case 90: case 91: {                                                                 // POLYPOLYLINE / POLYPOLYGON (16)
            const w = type === 7 || type === 8, close = type === 8 || type === 91;
            const np = dv.getUint32(o + 24, true), counts = []; for (let k = 0; k < np; k++) counts.push(dv.getUint32(o + 32 + k * 4, true));
            let p0 = o + 32 + np * 4, d = "";
            counts.forEach((c) => { d += " " + polyD(points(p0, c, w), close); p0 += c * (w ? 8 : 4); });
            shape(d.trim(), close, true); break;
          }
          case 43: { const l = dv.getInt32(o + 8, true), t = dv.getInt32(o + 12, true), r = dv.getInt32(o + 16, true), b = dv.getInt32(o + 20, true);   // RECTANGLE
            shape(polyD([[l, t], [r, t], [r, b], [l, b]], true), true, true); break; }
          case 44: { const l = dv.getInt32(o + 8, true), t = dv.getInt32(o + 12, true), r = dv.getInt32(o + 16, true), b = dv.getInt32(o + 20, true);   // ROUNDRECT
            const cw = dv.getInt32(o + 24, true) / 2, ch = dv.getInt32(o + 28, true) / 2;
            const d = "M" + pt(l + cw, t) + " L" + pt(r - cw, t) + " Q" + pt(r, t) + " " + pt(r, t + ch) + " L" + pt(r, b - ch) + " Q" + pt(r, b) + " " + pt(r - cw, b) +
              " L" + pt(l + cw, b) + " Q" + pt(l, b) + " " + pt(l, b - ch) + " L" + pt(l, t + ch) + " Q" + pt(l, t) + " " + pt(l + cw, t) + " Z";
            shape(d, true, true); break; }
          case 42: shape(ellipseD(dv.getInt32(o + 8, true), dv.getInt32(o + 12, true), dv.getInt32(o + 16, true), dv.getInt32(o + 20, true)), true, true); break;   // ELLIPSE
          case 59: path = ""; building = true; break;                                                         // BEGINPATH
          case 61: if (building) path += " Z"; break;                                                         // CLOSEFIGURE
          case 60: building = false; break;                                                                   // ENDPATH: the path is complete; later shapes draw at once
          case 62: if (path !== null) emit(path, true, false); path = null; building = false; break;          // FILLPATH
          case 63: if (path !== null) emit(path, true, true); path = null; building = false; break;           // STROKEANDFILLPATH
          case 64: if (path !== null) emit(path, false, true); path = null; building = false; break;          // STROKEPATH
          case 68: path = null; building = false; break;                                                      // ABORTPATH
          case 84: {                                                                                          // EXTTEXTOUTW
            const T = o + 36, x = dv.getInt32(T, true), y = dv.getInt32(T + 4, true), n = dv.getUint32(T + 8, true), offS = dv.getUint32(T + 12, true), opt = dv.getUint32(T + 16, true), offDx = dv.getUint32(T + 36, true);
            if (!n || o + offS + n * 2 > o + size) break;
            // ETO_GLYPH_INDEX: font glyph numbers, not characters — cannot be read without the font
            // (Word writes such text twice: the readable copy is drawn by its own record)
            if (opt & 0x10) break;
            let text = ""; for (let k = 0; k < n; k++) text += String.fromCharCode(dv.getUint16(o + offS + k * 2, true));
            text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
            // TA_UPDATECP: the text starts at the current position (not the record's point) and moves it on —
            // also for a record of spaces only, which draws nothing but still advances
            const upd = (st.align & 1) === 1, rx = upd ? st.cur.x : x, ry = upd ? st.cur.y : y;
            const f = st.font || STOCK[13];
            let adv = 0; if (offDx && o + offDx + n * 4 * ((opt & 0x2000) ? 2 : 1) <= o + size) for (let k = 0; k < n; k++) adv += dv.getInt32(o + offDx + k * 4 * ((opt & 0x2000) ? 2 : 1), true);
            if (upd) st.cur = { x: rx + (adv || Math.round(text.length * Math.abs(f.height || 12) * 0.5)), y: ry };
            if (!text.trim()) break;
            const p0 = dev(rx, ry), sc = scale();
            const fs = Math.max(1, Math.abs(f.height || 12) * sc * (f.height > 0 ? 0.82 : 1));
            const al = st.align, hor = (al & 6) === 6 ? "middle" : (al & 6) === 2 ? "end" : "start";
            const vert = (al & 24) === 24 ? "alphabetic" : (al & 8) ? "text-after-edge" : "text-before-edge";
            const ang = f.esc ? -f.esc / 10 : 0;
            const len = adv ? Math.abs(adv * sc) : 0;
            out.push('<text x="' + r2(p0[0]) + '" y="' + r2(p0[1]) + '" font-family="' + esc(f.face) + ', Arial, sans-serif" font-size="' + r2(fs) + '"' +
              (f.weight >= 600 ? ' font-weight="bold"' : "") + (f.italic ? ' font-style="italic"' : "") + (f.underline ? ' text-decoration="underline"' : "") +
              ' fill="' + st.textColor + '" text-anchor="' + hor + '" dominant-baseline="' + vert + '"' +
              (len > fs * 0.5 && hor === "start" ? ' textLength="' + r2(len) + '" lengthAdjust="spacingAndGlyphs"' : "") +
              (ang ? ' transform="rotate(' + r2(ang) + " " + r2(p0[0]) + " " + r2(p0[1]) + ')"' : "") + ' xml:space="preserve">' + esc(text) + "</text>");
            break;
          }
          case 81: case 80: case 76: case 77: {                                                               // bitmaps
            const F = { 81: [24, 28, 72, 76, 48], 80: [24, 28, 40, 44, 48], 76: [24, 28, 32, 36, 84], 77: [24, 28, 32, 36, 84] }[type];
            const xd = dv.getInt32(o + F[0], true), yd = dv.getInt32(o + F[1], true), cx = dv.getInt32(o + F[2], true), cy = dv.getInt32(o + F[3], true);
            const offBmi = dv.getUint32(o + F[4], true), cbBmi = dv.getUint32(o + F[4] + 4, true), offBits = dv.getUint32(o + F[4] + 8, true), cbBits = dv.getUint32(o + F[4] + 12, true);
            const a = dev(xd, yd), b = dev(xd + cx, yd + cy);
            if (!cbBmi) {
              // no bitmap: only PATCOPY (brush), WHITENESS and BLACKNESS paint — 0x00AA0029 (keep the destination) and the rest do nothing
              const rop = type === 76 || type === 77 ? dv.getUint32(o + 40, true) : 0;
              const fill = rop === 0x00F00021 ? (st.brush && st.brush.style !== 1 ? st.brush.color : null) : rop === 0x00FF0062 ? "#ffffff" : rop === 0x00000042 ? "#000000" : null;
              if (fill) out.push('<rect x="' + r2(Math.min(a[0], b[0])) + '" y="' + r2(Math.min(a[1], b[1])) + '" width="' + r2(Math.abs(b[0] - a[0])) + '" height="' + r2(Math.abs(b[1] - a[1])) + '" fill="' + fill + '"/>');
              break;
            }
            // the bitmap must lie inside this record — a broken one is skipped, the rest of the picture stays
            if (offBmi + cbBmi > size || offBits + cbBits > size || cbBmi < 40) break;
            const SRC = { 81: [32, 36, 40, 44], 80: [32, 36, 40, 44], 76: [44, 48, null, null], 77: [44, 48, 100, 104] }[type];
            const src = { x: dv.getInt32(o + SRC[0], true), y: dv.getInt32(o + SRC[1], true), w: SRC[2] ? dv.getInt32(o + SRC[2], true) : cx, h: SRC[3] ? dv.getInt32(o + SRC[3], true) : cy };
            const slot = out.length; out.push("");
            images.push(dibPng(u8, o, offBmi, cbBmi, offBits, cbBits, src).catch(() => null).then((href) => {
              if (href) out[slot] = '<image x="' + r2(Math.min(a[0], b[0])) + '" y="' + r2(Math.min(a[1], b[1])) + '" width="' + r2(Math.abs(b[0] - a[0])) + '" height="' + r2(Math.abs(b[1] - a[1])) + '" preserveAspectRatio="none" href="' + href + '"/>';
            }));
            break;
          }
          case 14: i = u8.length; continue;                                                                   // EOF
          default: break;
        }
      } catch (e) { /* a broken record: skip it */ }
      i += size;
    }
    await Promise.all(images);
    const body = out.filter(Boolean);
    if (!body.length) return null;
    const vw = Math.max(1, B.r - B.l + 1), vh = Math.max(1, B.b - B.t + 1);
    const pw = F.r > F.l ? (F.r - F.l) / 100 * 96 / 25.4 : vw, ph = F.b > F.t ? (F.b - F.t) / 100 * 96 / 25.4 : vh;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + vw + " " + vh + '" width="' + Math.round(pw) + '" height="' + Math.round(ph) + '">' + body.join("") + "</svg>";
  }

  global.DOCXMDEmf = { toSvg };
})(typeof window !== "undefined" ? window : this);
