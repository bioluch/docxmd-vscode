/* DOCXMD — read and write a whole ZIP (.docx) in the browser.
   Used to post-process a generated .docx (vector Mermaid diagrams: svgBlip) and to
   rewrite word/document.xml before a Word import (Zotero / Mendeley / Word citation fields).
   Deflate via CompressionStream / DecompressionStream ("deflate-raw"); stored entries when missing.

   window.DOCXMDZip = {
     read(arrayBuffer)   → Promise<Map<name, Uint8Array>>   (insertion order = archive order)
     write(map)          → Promise<Uint8Array>
     text(u8) / bytes(str)
   } */
(function (global) {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder("utf-8");
  let CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function pipe(u8, stream) { return new Uint8Array(await new Response(new Response(u8).body.pipeThrough(stream)).arrayBuffer()); }
  const canDeflate = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

  async function read(ab) {
    const u8 = new Uint8Array(ab), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + csize);
      if (method === 0) out.set(name, data.slice());
      else if (method === 8) {
        if (!canDeflate()) throw new Error("DecompressionStream unsupported");
        out.set(name, await pipe(data, new DecompressionStream("deflate-raw")));
      } else throw new Error("zip method " + method);
    }
    return out;
  }

  async function write(map) {
    const parts = [], central = [];
    let offset = 0;
    const deflate = canDeflate();
    for (const [name, raw] of map) {
      const data = typeof raw === "string" ? enc.encode(raw) : raw;
      const nameB = enc.encode(name);
      const crc = crc32(data);
      // already compressed media gains nothing from deflate
      const store = !deflate || /\.(png|jpe?g|gif|webp|zip)$/i.test(name) || data.length < 64;
      const body = store ? data : await pipe(data, new CompressionStream("deflate-raw"));
      const method = store ? 0 : 8;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true);
      h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameB.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nameB, body);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, nameB.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nameB);
      offset += 30 + nameB.length + body.length;
    }
    const cdSize = central.reduce((n, x) => n + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, map.size, true); e.setUint16(10, map.size, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
    let o = 0; for (const x of all) { out.set(x, o); o += x.length; }
    return out;
  }

  global.DOCXMDZip = { read, write, crc32, text: (u8) => dec.decode(u8), bytes: (s) => enc.encode(s) };
})(typeof window !== "undefined" ? window : this);
