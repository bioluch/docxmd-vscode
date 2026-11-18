/* DOCXMD — diagrams from a document (or a selected fragment), rule-based, offline.
   DOCXMDDocDiagram.analyze(markdown, { title, lang }) → [{ id, kind, title, code, score }]
   What it recognises:
     headings                         → mind map of the structure
     ASCII trees (├─ └─) / arrows (A → B → C) in code blocks or paragraphs → flowchart
     ASCII box diagrams (┌─┐ │ ▼)    → flowchart with a group per box
     numbered steps                    → flowchart; steps with recurring actors → sequence diagram
     nested bullet lists               → mind map of the list
     tables with durations (2–3 days)  → Gantt chart (tasks one after another)
     tables with numbers / a status column → pie chart
     objects / classes in code (name = { a(x) → y, … }) → class diagram
     lines or rows starting with a year / date → timeline
   Shared with the VS Code extension; needs marked (lexer) only. */
(function (global) {
  "use strict";
  const MAXL = 46;
  const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); n = n || MAXL; return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
  // plain text of inline Markdown: `code`, **bold**, [link](url), <tags>, \(math\)
  const plain = (s) => String(s || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/<\/?(?:a|b|i|u|s|em|strong|span|div|p|br|sub|sup|mark|img|code|small|font|center|kbd|del|ins)\b[^>]*>/gi, "").replace(/\\[()[\]]/g, "").replace(/\{#[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  const noNum = (s) => s.replace(/^\s*(?:\d+(?:\.\d+)*[.)]?|[IVXLC]+\.)\s+/, "");
  // labels in each syntax
  const qLabel = (s) => '"' + clip(s).replace(/"/g, "'").replace(/[\[\]{}|<>]/g, " ").replace(/\s+/g, " ").trim() + '"';   // flowchart ["…"]
  const mmLabel = (s) => clip(s, 40).replace(/[()[\]{}"`<>]/g, " ").replace(/^[-+*#:\s]+/, "").replace(/\s+/g, " ").trim() || "…";
  const ganttName = (s) => clip(s, 40).replace(/[:#;]/g, " ").replace(/\s+/g, " ").trim() || "task";
  const seqText = (s) => clip(s, 52).replace(/[;#:]/g, " ").replace(/\s+/g, " ").trim() || "…";
  const ident = (s, i) => (String(s || "").replace(/[^A-Za-z0-9_]/g, "") || "C") + "_" + i;

  /* ---------------- headings → mind map ---------------- */
  function outline(tokens, title) {
    const hs = tokens.filter((t) => t.type === "heading" && t.depth <= 4);
    if (hs.length < 3) return null;
    const top = Math.min.apply(null, hs.map((h) => h.depth));
    let rootText = title;
    let list = hs;
    if (!rootText && hs[0].depth === top && hs.filter((h) => h.depth === top).length === 1) { rootText = plain(hs[0].text); list = hs.slice(1); }
    if (!list.length) return null;
    const base = Math.min.apply(null, list.map((h) => h.depth));
    const lines = ["mindmap", "  root((" + mmLabel(noNum(rootText || "Document")) + "))"];
    const count = {};
    list.forEach((h) => {
      const lvl = Math.min(3, h.depth - base + 1);
      count[lvl] = (count[lvl] || 0) + 1;
      if (lvl > 2 && count[lvl] > 40) return;
      lines.push("  ".repeat(lvl + 1) + mmLabel(noNum(plain(h.text))));
    });
    return { kind: "mindmap", code: lines.join("\n"), score: 4, size: list.length };
  }

  /* ---------------- arrows: A → B → C ---------------- */
  const ARROW = /\s*(?:→|⟶|->|⇒|↓|▼|⟹)\s*/;
  // program code: its "=>", "->" and "→" in comments are not a process
  const looksCode = (text) => { const ls = String(text).split("\n").filter((l) => l.trim()); return ls.filter((l) => /[{};]\s*$|^\s*(?:const|let|var|function|return|if|for|import|export|class|td\.|\w+\.\w+\()|=\s*[({\['"]|\)\s*=>/.test(l)).length > ls.length * 0.3; };
  function splitArrows(ln) {
    const out = []; let depth = 0, cur = "";
    const re = /(→|⟶|->|⇒|↓|▼|⟹)|([([{«])|([)\]}»])|([^→⟶⇒↓▼⟹([{«)\]}»-]+|-)/g;
    let m;
    while ((m = re.exec(ln))) {
      if (m[1] && depth === 0) { out.push(cur); cur = ""; continue; }
      if (m[2]) depth++;
      if (m[3]) depth = Math.max(0, depth - 1);
      cur += m[0];
    }
    out.push(cur);
    return out;
  }
  function chainFlow(lines, dir) {
    const nodes = new Map(), edges = [];
    const id = (label) => { const k = label.toLowerCase(); if (!nodes.has(k)) nodes.set(k, { id: "n" + (nodes.size + 1), label }); return nodes.get(k).id; };
    let prev = null;
    lines.forEach((ln) => {
      const startsWithArrow = /^\s*(?:→|⟶|->|=>|⇒|↓|▼)/.test(ln);
      const parts = splitArrows(ln).map((x) => plain(x.replace(/\/\/.*$/, "")).replace(/^[\s:,;.–—-]+|[\s:,;–—-]+$/g, "")).filter((x) => x.length > 1 && !/^[│|]+$/.test(x));
      if (!parts.length) return;
      if (!startsWithArrow) prev = null;
      parts.forEach((p) => { const n = id(p); if (prev && prev !== n) edges.push([prev, n]); prev = n; });
    });
    if (nodes.size < 3 || !edges.length) return null;
    const out = ["flowchart " + (dir || (nodes.size > 5 ? "TD" : "LR"))];
    nodes.forEach((n) => out.push("  " + n.id + "[" + qLabel(n.label) + "]"));
    edges.forEach((e) => out.push("  " + e[0] + " --> " + e[1]));
    return { kind: "flowchart", code: out.join("\n"), score: 5, size: nodes.size };
  }
  function arrowLines(text) {
    const ls = String(text).split("\n");
    if (ls.filter((l) => ARROW.test(l)).length < 2 && !(ls.length === 1 && (ls[0].match(/→|->|⟶/g) || []).length >= 2)) return null;
    return ls.filter((l) => l.trim());
  }

  /* ---------------- ASCII tree (├─ └─) ---------------- */
  function asciiTree(text) {
    const ls = String(text).split("\n");
    if (ls.filter((l) => /[├└]─/.test(l)).length < 2) return null;
    const rootLine = ls.find((l) => l.trim() && !/^[\s│├└─]*$/.test(l) && !/[├└]─/.test(l));
    if (!rootLine) return null;
    const items = [];
    ls.forEach((l) => {
      const m = /^([\s│]*)[├└]─+\s*(.+)$/.exec(l);
      if (m) { items.push({ depth: m[1].replace(/│/g, " ").length, text: plain(m[2].replace(/\/\/.*$/, "")), notes: [] }); return; }
      const b = /^[\s│]*[•·*-]\s+(.+)$/.exec(l);
      if (b && items.length) items[items.length - 1].notes.push(plain(b[1]));
    });
    if (items.length < 2) return null;
    const minD = Math.min.apply(null, items.map((x) => x.depth));
    const out = ["flowchart TD", "  r0[" + qLabel(plain(rootLine)) + "]"];
    let prevTop = "r0";
    const stack = [];
    items.forEach((it, i) => {
      const id = "s" + (i + 1);
      const label = it.text + (it.notes.length ? " — " + it.notes.slice(0, 2).join("; ") : "");
      out.push("  " + id + "[" + qLabel(clip(label, 70)) + "]");
      if (it.depth <= minD) { out.push("  " + prevTop + " --> " + id); prevTop = id; stack.length = 0; stack.push({ id, depth: it.depth }); }
      else {
        while (stack.length && stack[stack.length - 1].depth >= it.depth) stack.pop();
        out.push("  " + (stack.length ? stack[stack.length - 1].id : prevTop) + " -.-> " + id);
        stack.push({ id, depth: it.depth });
      }
    });
    return { kind: "flowchart", code: out.join("\n"), score: 6, size: items.length + 1 };
  }

  /* ---------------- indented tree (a folder listing) → mind map ---------------- */
  function indentTree(text) {
    const ls = String(text).split("\n").filter((l) => l.trim());
    if (ls.length < 5 || ls.filter((l) => /\/\s*(?:#.*)?$/.test(l)).length < 2) return null;
    if (ls.filter((l) => /^\s*[^\s#][^#]*?(?:\s+#.*)?$/.test(l) && !/[{};=]/.test(l)).length < ls.length * 0.8) return null;
    const ind = (l) => l.match(/^\s*/)[0].length;
    const base = ind(ls[0]);
    const out = ["mindmap", "  root((" + mmLabel(ls[0].replace(/#.*$/, "").trim()) + "))"];
    const stack = [base];
    ls.slice(1, 60).forEach((l) => {
      const d = ind(l);
      while (stack.length > 1 && stack[stack.length - 1] >= d) stack.pop();
      stack.push(d);
      const name = l.replace(/\s+#.*$/, "").replace(/^\s*(?:→\s*)?/, "").trim();
      out.push("  ".repeat(Math.min(stack.length, 6)) + mmLabel(name.replace(/→/g, "-")));
    });
    return { kind: "mindmap", code: out.join("\n"), score: 4, size: ls.length };
  }

  /* ---------------- ASCII boxes (┌──┐ … └──┘ with ▼ between) ---------------- */
  function asciiBoxes(text) {
    const ls = String(text).split("\n");
    const boxes = [];
    let cur = null;
    ls.forEach((l) => {
      const top = /┌[─\s]*(.*?)[─\s]*┐/.exec(l);
      if (top) { cur = { title: plain(top[1].replace(/─+/g, " ")), lines: [] }; boxes.push(cur); return; }
      if (/└[─┬┴\s]*┘/.test(l)) { cur = null; return; }
      if (cur) { const m = /│(.*)│/.exec(l); if (m && m[1].trim()) cur.lines.push(m[1]); }
    });
    if (boxes.length < 2) return null;
    const out = ["flowchart TB"];
    boxes.forEach((b, i) => {
      const items = [];
      b.lines.forEach((raw) => {
        const s = raw.trim();
        if (/^[•·*-]\s+/.test(s)) items.push(s.replace(/^[•·*-]\s+/, ""));
        else if (/^↳/.test(s) && items.length) items[items.length - 1] += " (" + s.replace(/^↳\s*/, "") + ")";
        else if (!items.length || !/^\s{3,}/.test(raw)) items.push(s);
      });
      const title = b.title || plain(items.shift() || "Part " + (i + 1));
      out.push("  subgraph B" + i + " [" + qLabel(title) + "]");
      items.slice(0, 6).forEach((x, j) => out.push("    B" + i + "_" + j + "[" + qLabel(plain(x).replace(/\s*\/\/.*$/, "")) + "]"));
      if (!items.length) out.push("    B" + i + "_0[" + qLabel(title) + "]");
      out.push("  end");
    });
    for (let i = 1; i < boxes.length; i++) out.push("  B" + (i - 1) + " --> B" + i);
    return { kind: "flowchart", code: out.join("\n"), score: 6, size: boxes.length * 3 };
  }

  /* ---------------- numbered steps → flowchart, or sequence when actors recur ---------------- */
  const itemHead = (it) => {
    const raw = it.text.split("\n")[0];
    const b = /^\s*\*\*([^*]+)\*\*/.exec(raw) || /^\s*__([^_]+)__/.exec(raw);
    if (b) return plain(b[1]).replace(/[:.]$/, "");
    const p = plain(raw);
    const cut = p.search(/[:.](\s|$)/);
    return cut > 8 && cut < 70 ? p.slice(0, cut) : p;
  };
  function steps(list) {
    const items = list.items.filter((it) => plain(it.text));
    if (items.length < 3) return null;
    const out = ["flowchart TD"];
    items.slice(0, 14).forEach((it, i) => {
      out.push("  p" + (i + 1) + "[" + qLabel((list.ordered ? (i + (+list.start || 1)) + ". " : "") + itemHead(it)) + "]");
      if (i) out.push("  p" + i + " --> p" + (i + 1));
    });
    return { kind: "flowchart", code: out.join("\n"), score: list.ordered ? 4 : 2, size: items.length };
  }
  function sequence(list) {
    if (!list.ordered || list.items.length < 3) return null;
    const firsts = list.items.map((it) => { const m = /^\s*([\p{Lu}][\p{L}\p{N}_-]*(?:\s+[\p{Lu}][\p{L}\p{N}_-]*)?)\s+(.+)$/u.exec(plain(it.text.split("\n")[0])); return m ? { who: m[1], rest: m[2] } : null; });
    const n = {};
    firsts.forEach((f) => { if (f) n[f.who] = (n[f.who] || 0) + 1; });
    const actors = Object.keys(n).filter((k) => n[k] >= 2);
    if (actors.length < 2) return null;
    let who = actors[0];
    const seq = firsts.map((f, i) => { if (f && actors.indexOf(f.who) >= 0) { who = f.who; return { who, text: f.rest }; } return { who, text: plain(list.items[i].text.split("\n")[0]) }; });
    const pid = (a) => "A" + actors.indexOf(a);
    const out = ["sequenceDiagram", "  autonumber"];
    actors.forEach((a) => out.push("  participant " + pid(a) + " as " + seqText(a)));
    seq.forEach((s, i) => {
      const to = seq[i + 1] ? seq[i + 1].who : s.who;
      out.push("  " + pid(s.who) + (to === s.who ? "->>" : "->>") + pid(to) + ": " + seqText(s.text));
    });
    return { kind: "sequence", code: out.join("\n"), score: 5, size: seq.length };
  }
  /* a numbered list of stages with options → a scenario: inline "a / b / c" or "a, b, c" → a decision with
     branches; a nested list of short items → a group of parallel options; long items → a group of details;
     a "result" stage (or the last one) → a decision whose branches are end results */
  function splitTop(s, sep) {
    const out = []; let d = 0, cur = "";
    for (const ch of s) {
      if ("([{«".includes(ch)) d++;
      if (")]}»".includes(ch)) d = Math.max(0, d - 1);
      if (ch === sep && d === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function inlineOptions(text) {
    const first = plain(String(text).split("\n")[0]);
    if (/[{}=]|=>/.test(first)) return null;                        // code, not a list of choices
    const i = first.indexOf(":"); if (i < 0) return null;
    let rest = first.slice(i + 1).trim().split(/\.\s+(?=\p{Lu})/u)[0].replace(/[.;]\s*$/, "");
    let parts = rest.split(/\s+\/\s+/), slash = parts.length >= 2;
    if (!slash) parts = splitTop(rest, ",");
    parts = parts.map((x) => x.trim()).filter(Boolean);
    // choices are short names: "a / b" or at least three "x, y, z" of up to four words each (not a sentence)
    const words = (x) => x.replace(/\([^)]*\)/g, "").trim().split(/\s+/).length;
    if (parts.length < (slash ? 2 : 3) || parts.length > 8 || parts.some((x) => x.length > 60 || words(x) > 4)) return null;
    return parts;
  }
  const RESULT = /^(?:результат|результати|вихід|output|outputs|result|results|resultado|resultados|结果|输出)(?![\p{L}\p{N}])/iu;
  function scenario(list) {
    if (!list.ordered || list.items.length < 3) return null;
    const stages = list.items.map((it) => {
      const head = itemHead(it);
      const sub = (it.tokens || []).find((t) => t.type === "list");
      if (sub && sub.items.length >= 2) {
        const heads = sub.items.map(itemHead).map((h) => h.replace(/[;.]$/, ""));
        return { head, kind: heads.every((h) => h.length <= 60) ? "group" : "details", opts: heads };
      }
      const io = inlineOptions(it.text);
      return io ? { head, kind: "choice", opts: io } : { head, kind: "step" };
    });
    if (stages.filter((x) => x.kind !== "step").length < 2) return null;
    const out = ["flowchart TD"];
    let prev = [];
    stages.forEach((st, i) => {
      const isResult = (st.kind === "group" || st.kind === "details") && (RESULT.test(st.head) || (st.kind === "group" && i === stages.length - 1));
      let entry, exits;
      if (st.kind === "step") {
        out.push("  S" + i + "[" + qLabel(st.head) + "]"); entry = exits = ["S" + i];
      } else if (st.kind === "choice" || isResult) {
        out.push("  D" + i + "{" + qLabel(st.head.replace(/[?:]$/, "") + "?") + "}");
        st.opts.slice(0, 8).forEach((o, j) => {
          out.push("  O" + i + "_" + j + (isResult ? "([" + qLabel(o) + "])" : "[" + qLabel(o) + "]"));
          out.push("  D" + i + " --> O" + i + "_" + j);
        });
        entry = ["D" + i];
        exits = isResult ? ["D" + i] : st.opts.slice(0, 8).map((o, j) => "O" + i + "_" + j);
      } else {
        out.push("  subgraph G" + i + " [" + qLabel(st.head) + "]");
        if (st.kind === "group") out.push("    direction LR");
        st.opts.slice(0, 8).forEach((o, j) => out.push("    G" + i + "_" + j + "[" + qLabel(o) + "]"));
        out.push("  end");
        entry = exits = ["G" + i];
      }
      prev.forEach((p) => entry.forEach((e) => out.push("  " + p + " --> " + e)));
      prev = exits;
    });
    return { kind: "flowchart", tkey: "scenario", code: out.join("\n"), score: 7, size: out.length };
  }
  function listMindmap(list, title) {
    let deep = false, count = 0;
    const walk = (items, lvl, out) => items.forEach((it) => {
      if (count > 40) return;
      count++;
      out.push("  ".repeat(lvl + 1) + mmLabel(itemHead(it)));
      const sub = (it.tokens || []).filter((t) => t.type === "list");
      sub.forEach((l) => { deep = true; walk(l.items, lvl + 1, out); });
    });
    const out = ["mindmap", "  root((" + mmLabel(title || "List") + "))"];
    walk(list.items, 1, out);
    if (!deep || count < 4) return null;
    return { kind: "mindmap", code: out.join("\n"), score: 3, size: count };
  }

  /* ---------------- tables ---------------- */
  const DUR = /(\d+(?:[.,]\d+)?)(?:\s*[–—-]\s*(\d+(?:[.,]\d+)?))?\s*(дн|день|дні|днів|d\b|day|days|тиж|тижн|week|weeks|wk|w\b|міс|month|months|год|h\b|hour|hours)/i;
  function durDays(s) {
    const m = DUR.exec(plain(s)); if (!m) return null;
    const v = parseFloat((m[2] || m[1]).replace(",", "."));
    const u = m[3].toLowerCase();
    if (/^(тиж|тижн|week|weeks|wk|w)/.test(u)) return Math.round(v * 5);
    if (/^(міс|month)/.test(u)) return Math.round(v * 21);
    if (/^(год|h|hour)/.test(u)) return Math.max(1, Math.ceil(v / 8));
    return Math.max(1, Math.round(v));
  }
  const cellText = (c) => plain(c && (c.text != null ? c.text : c));
  const NUM = /^[-+]?\d[\d\s.,]*\s*%?$/;
  const numOf = (s) => { const v = parseFloat(String(s).replace(/\s/g, "").replace(",", ".").replace("%", "")); return isFinite(v) ? v : null; };
  function nextMonday() { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10); }
  function tables(t, title) {
    const head = t.header.map(cellText), rows = t.rows.map((r) => r.map(cellText));
    if (rows.length < 2) return [];
    const out = [];
    const cols = head.length;
    // Gantt: a column of durations
    for (let c = 0; c < cols; c++) {
      const daysHead = /дн|день|days?\b|тривал|duration|оцінк|estimate|días|天/i.test(head[c] || ""), weeksHead = /тиж|weeks?\b|semanas|周/i.test(head[c] || "");
      const ds = rows.map((r) => {
        const d = durDays(r[c] || ""); if (d) return d;
        const m = (daysHead || weeksHead) && /^\s*(\d+(?:[.,]\d+)?)(?:\s*[–—-]\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(r[c] || "");
        return m ? Math.max(1, Math.round(parseFloat((m[2] || m[1]).replace(",", ".")) * (weeksHead ? 5 : 1))) : null;
      });
      if (ds.filter((x) => x).length < Math.max(2, rows.length * 0.7)) continue;
      const nameCols = [];
      for (let k = 0; k < cols && nameCols.length < 2; k++) if (k !== c && rows.some((r) => (r[k] || "").length > 1 && !NUM.test(r[k]))) nameCols.push(k);
      if (!nameCols.length) nameCols.push(c === 0 ? 1 : 0);
      const g = ["gantt", "  title " + ganttName(title || head[c]), "  dateFormat YYYY-MM-DD", "  axisFormat %d.%m", "  section " + ganttName(head[nameCols[0]] || "Plan")];
      let prev = null;
      const TOTAL = /^\s*(?:\S+\s+)?(?:разом|всього|усього|итого|total|sum|сума|загалом|в сумі)\b/i;
      rows.forEach((r, i) => {
        if (!ds[i] || r.some((x, k) => k !== c && TOTAL.test(x || ""))) return;
        const short = /^\s*[\dA-Za-zА-Яа-яІіЇїЄє]{1,3}\s*$/.test(r[nameCols[0]] || "") && nameCols[1] != null;
        const name = short ? (r[nameCols[0]] + " " + r[nameCols[1]]) : (r[nameCols[0]] || "task " + (i + 1));
        g.push("  " + ganttName(name) + " :t" + (i + 1) + ", " + (prev ? "after " + prev : nextMonday()) + ", " + ds[i] + "d");
        prev = "t" + (i + 1);
      });
      out.push({ kind: "gantt", code: g.join("\n"), score: 6, size: rows.length });
      break;
    }
    // pie: a numeric column + a label column
    for (let c = 1; c < cols; c++) {
      if (!rows.every((r) => NUM.test(r[c] || ""))) continue;
      const lc = rows.some((r) => !NUM.test(r[0] || "")) ? 0 : -1;
      if (lc < 0 || rows.length > 12) continue;
      const vals = rows.map((r) => numOf(r[c]));
      if (vals.some((v) => v == null || v < 0)) continue;
      out.push({ kind: "pie", code: ["pie title " + seqText(head[c] || title || "Share")].concat(rows.map((r, i) => '  "' + clip(r[lc], 30).replace(/"/g, "'") + '" : ' + vals[i])).join("\n"), score: 3, size: rows.length });
      break;
    }
    // pie: a status column (few distinct values, repeated)
    for (let c = 0; c < cols; c++) {
      const vals = rows.map((r) => (r[c] || "").replace(/\s+/g, " ").trim()).filter(Boolean);
      const keyOf = (v) => (/^\s*(\p{Extended_Pictographic}|[✅⚠❌✔✖☑])/u.exec(v) || [v])[0].trim() || v;
      const freq = new Map();
      vals.forEach((v) => { const k = keyOf(v); freq.set(k, (freq.get(k) || 0) + 1); });
      if (vals.length < 4 || freq.size < 2 || freq.size > 6 || freq.size === vals.length) continue;
      const label = (k) => { const ex = vals.find((v) => keyOf(v) === k) || k; return k === ex ? k : k + " " + plain(ex.slice(k.length)).split(/[;,(]/)[0]; };
      out.push({ kind: "pie", code: ["pie title " + seqText(head[c] || "Status")].concat(Array.from(freq).map(([k, n]) => '  "' + clip(label(k), 30).replace(/"/g, "'") + '" : ' + n)).join("\n"), score: 2, size: vals.length });
      break;
    }
    const api = apiTable(head, rows, title);
    if (api) out.push(api);
    else if (!out.length) { const pr = pairsTable(head, rows); if (pr) out.push(pr); }
    return out;
  }

  /* ---------------- code: objects / classes → class diagram ---------------- */
  function classes(code, section) {
    const ls = String(code).split("\n");
    const found = [];
    let cur = null, depth = 0;
    ls.forEach((l) => {
      const open = /(?:^|\s)(?:class\s+([A-Za-z_$][\w$]*)|(?:const|let|var)?\s*([A-Za-z_$][\w$.]*)\s*=\s*\{|export\s+default\s*\{|interface\s+([A-Za-z_$][\w$]*))/.exec(l);
      if (!cur && open && /\{/.test(l)) {
        cur = { name: (open[1] || open[2] || open[3] || plain(section || "") || "Module").split(".").pop(), members: [] }; depth = 0;
      }
      if (cur) {
        const before = depth;
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        if (before === 1 || (before === 0 && depth === 1 && !open)) {
          const m = /^\s*(?:(?:public|private|static|async|readonly)\s+)*\+?([A-Za-z_$][\w$]*)\s*(?:\??:\s*(?:async\s*)?\(([^)]*)\)\s*=>|(\(([^)]*)\))|:\s*([^,{]+))?\s*(?:(?:→|=>|->)\s*([^,;/]+))?/.exec(l);
          if (m && m[1] && !/^(if|for|return|const|let|var|function|while|switch)$/.test(m[1])) {
            const isFn = m[2] != null || m[3] != null;
            const args = (m[2] != null ? m[2] : m[4] || "").replace(/\s+/g, " ").trim();
            const ret = (m[6] || "").replace(/[{}[\]"'`]/g, "").replace(/\s+/g, " ").trim();
            cur.members.push(isFn ? "+" + m[1] + "(" + clip(args, 28).replace(/[{}]/g, "") + ")" + (ret ? " " + clip(ret, 24).split(" ")[0] : "") : "+" + m[1]);
          }
        }
        if (depth <= 0 && /\}/.test(l)) { if (cur.members.length >= 2) found.push(cur); cur = null; }
      }
    });
    if (cur && cur.members.length >= 2) found.push(cur);
    if (!found.length) return null;
    const out = ["classDiagram"];
    found.slice(0, 6).forEach((c, i) => {
      const id = ident(c.name, i);
      out.push("  class " + id + '["' + clip(c.name, 30).replace(/"/g, "'") + '"] {');
      c.members.slice(0, 14).forEach((m) => out.push("    " + m.replace(/[{}~]/g, "")));
      out.push("  }");
    });
    return { kind: "class", code: out.join("\n"), score: 5, size: found.reduce((n, c) => n + c.members.length, 0) };
  }

  /* ---------------- more patterns: percentages, "label (N)" lists, API tables, pairs, file lists, cases, checklists ---------------- */
  // "… готова приблизно на 70%" → pie done / left
  function percentPie(text, T) {
    const p = plain(text);
    const m = /([^.;:!?]{6,90}?)\s(?:на|at|al|达到|by)?\s*~?(\d{1,2}(?:[.,]\d)?)\s?%/.exec(p);
    if (!m) return null;
    const v = parseFloat(m[2].replace(",", "."));
    if (!(v > 0 && v < 100)) return null;
    const head = clip(m[1].replace(/^[-–—•*\s]+/, ""), 50).replace(/"/g, "'");
    return { kind: "pie", tkey: "share", code: ["pie showData", "  title " + seqText(head)].concat(['  "' + T.done + '" : ' + v, '  "' + T.left + '" : ' + +(100 - v).toFixed(1)]).join("\n"), score: 4, size: 2 };
  }
  // "ядро cloud.js (2), Google Drive (3), інтерфейс та i18n (1–2)" → pie
  function numberedParts(text) {
    const p = plain(text);
    const out = [], re = /([^,;:()\n]{2,60}?)\s*\((\d+(?:[.,]\d+)?)(?:\s*[–—-]\s*(\d+(?:[.,]\d+)?))?\)/g;
    let m;
    while ((m = re.exec(p))) out.push([m[1].replace(/^\s*(?:і|та|and|y|和)\s+/i, "").trim(), parseFloat((m[3] || m[2]).replace(",", "."))]);
    if (out.length < 3) return null;
    return { kind: "pie", tkey: "share", code: ["pie showData", "  title " + seqText(p.split(":")[0].slice(0, 60))].concat(out.slice(0, 10).map((x) => '  "' + clip(x[0], 30).replace(/"/g, "'") + '" : ' + x[1])).join("\n"), score: 4, size: out.length };
  }
  // a table of API requests (GET / POST / PUT …) → sequence App ↔ API
  const VERB = /\b(GET|POST|PUT|PATCH|DELETE)\b\s+([^\s`|]+)?/;
  function apiTable(head, rows, title) {
    let c = -1;
    for (let k = 0; k < head.length; k++) if (rows.filter((r) => VERB.test(r[k] || "")).length >= Math.max(2, rows.length * 0.5)) { c = k; break; }
    if (c < 0) return null;
    const a = c === 0 ? 1 : 0;
    const api = seqText((head[c] || "API").replace(/^(запит до|request to|petición a|请求)\s*/i, "") || "API");
    const out = ["sequenceDiagram", "  participant A as DOCXMD", "  participant S as " + api];
    rows.forEach((r) => {
      const all = []; let m; const re = new RegExp(VERB.source, "g");
      while ((m = re.exec(r[c] || ""))) all.push(m[1] + " " + (m[2] || "").replace(/[?#].*$/, "").slice(0, 38));
      if (!all.length) return;
      out.push("  Note over A,S: " + seqText(r[a]));
      all.slice(0, 3).forEach((x) => { out.push("  A->>S: " + seqText(x)); });
      out.push("  S-->>A: OK");
    });
    return out.length > 4 ? { kind: "sequence", tkey: "api", code: out.join("\n"), score: 5, size: rows.length } : null;
  }
  // a table of pairs (risk → what to do, place → what changes) → flowchart LR
  function pairsTable(head, rows) {
    if (rows.length < 3 || head.length < 2 || head.length > 4) return null;
    if (rows.some((r) => NUM.test(r[0] || "") || !(r[0] || "").trim())) return null;
    const last = head.length - 1;
    const out = ["flowchart LR"];
    rows.slice(0, 12).forEach((r, i) => {
      out.push("  R" + i + "[" + qLabel(r[0]) + "] --> M" + i + "[" + qLabel(r[last]) + "]");
    });
    out.push("  classDef q fill:#fde8e6,stroke:#c0392b", "  classDef a fill:#e6f4ea,stroke:#2e7d32");
    out.push("  class " + rows.slice(0, 12).map((r, i) => "R" + i).join(",") + " q", "  class " + rows.slice(0, 12).map((r, i) => "M" + i).join(",") + " a");
    return { kind: "flowchart", tkey: "pairs", code: out.join("\n"), score: 3, size: rows.length };
  }
  // a code block listing files: "js/cloud.js     ядро: …" → modules grouped by folder
  function fileList(text) {
    const ls = String(text).split("\n").filter((l) => l.trim());
    const items = ls.map((l) => /^\s*([\w.@-]+(?:\/[\w.@-]+)+\/?|[\w-]+\.[\w]{1,5})\s{2,}(.+)$/.exec(l)).filter(Boolean);
    if (items.length < 3 || items.length < ls.length * 0.7) return null;
    const groups = new Map();
    items.forEach((m) => { const p = m[1], dir = p.indexOf("/") > 0 ? p.slice(0, p.lastIndexOf("/") + 1) : "./"; if (!groups.has(dir)) groups.set(dir, []); groups.get(dir).push([p.slice(dir === "./" ? 0 : dir.length), plain(m[2])]); });
    const out = ["flowchart TB"];
    let g = 0, n = 0;
    groups.forEach((files, dir) => {
      out.push("  subgraph G" + g + " [" + qLabel(dir) + "]");
      files.slice(0, 10).forEach((f) => { out.push("    F" + n + "[" + '"' + clip(f[0], 30).replace(/"/g, "'") + "<br/>" + clip(f[1], 34).replace(/["[\]{}|<>]/g, " ") + '"]'); n++; });
      out.push("  end");
      g++;
    });
    return { kind: "flowchart", tkey: "modules", code: out.join("\n"), score: 4, size: n };
  }
  // "- **.md**: …  - **.docx**: …" → a decision with one branch per case (arrows in a case become its chain)
  function cases(list, section) {
    const items = list.items.map((it) => { const raw = it.text.split("\n")[0]; const m = /^\s*\*\*([^*]{1,60})\*\*\s*[:—–-]?\s*(.*)$/.exec(raw); return m ? [plain(m[1]).replace(/[:.]$/, ""), m[2]] : null; });
    const ok = items.filter(Boolean);
    if (ok.length < 2 || ok.length < items.length * 0.6) return null;
    const out = ["flowchart TD", "  Q{" + qLabel(clip(section || "?", 40) + "?") + "}"];
    ok.slice(0, 8).forEach((c, i) => {
      out.push("  C" + i + "[" + qLabel(c[0]) + "]", "  Q --> C" + i);
      const parts = splitArrows(plain(c[1])).map((x) => x.trim().replace(/^[\s:,;.–—-]+|[\s:,;–—-]+$/g, "")).filter((x) => x.length > 1);
      let prev = "C" + i;
      (parts.length > 1 ? parts.slice(0, 5) : parts.slice(0, 1)).forEach((x, j) => { const id = "C" + i + "_" + j; out.push("  " + id + "[" + qLabel(x) + "]", "  " + prev + " --> " + id); prev = id; });
    });
    return { kind: "flowchart", tkey: "cases", code: out.join("\n"), score: 4, size: ok.length * 2 };
  }
  // list items that are arrow chains ("A → B → C") → one flowchart
  function listArrows(list) {
    const ls = list.items.map((it) => plain(it.text.split("\n")[0])).filter((l) => (l.match(/→|->|⟶|⇒/g) || []).length >= 1);
    if (ls.length < 2) return null;
    return chainFlow(ls.map((l) => l.replace(/^[^:]{1,40}:\s*(?=\S)/, (h) => h.replace(/:\s*$/, " → "))));
  }
  // a check list "- [ ] …" → mind map of the checks
  function checklist(list, section) {
    const items = list.items.filter((it) => it.task);
    if (items.length < 4) return null;
    const out = ["mindmap", "  root((" + mmLabel(section || "Checks") + "))"];
    items.slice(0, 24).forEach((it) => out.push("    " + mmLabel((it.checked ? "✓ " : "") + itemHead(it))));
    return { kind: "mindmap", tkey: "checks", code: out.join("\n"), score: 3, size: items.length };
  }

  /* ---------------- years / dates → timeline ---------------- */
  function timeline(lines, title) {
    const ev = [];
    lines.forEach((l) => {
      const m = /^\s*(?:[-*+]|\d+[.)])?\s*\**((?:19|20)\d{2}(?:[-–.]\d{1,2})?(?:[-–.]\d{1,2})?|Q[1-4]\s*(?:19|20)\d{2})\**\s*[:—–-]\s*(.+)$/.exec(l);
      if (m) ev.push([m[1], plain(m[2])]);
    });
    if (ev.length < 3) return null;
    return { kind: "timeline", code: ["timeline", "  title " + seqText(title || "Timeline")].concat(ev.slice(0, 20).map((e) => "  " + e[0].replace(/:/g, ".") + " : " + seqText(e[1]))).join("\n"), score: 4, size: ev.length };
  }

  /* ---------------- analyze ---------------- */
  const TITLES = {
    en: { mindmap: "Structure", flowchart: "Process", sequence: "Sequence", gantt: "Schedule", pie: "Shares", class: "Components", timeline: "Timeline", list: "List", scenario: "Scenario", existing: "In the document", done: "Done", left: "Remaining", share: "Share", api: "Requests", pairs: "Mapping", modules: "Modules", cases: "Cases", checks: "Checks" },
    uk: { mindmap: "Структура", flowchart: "Процес", sequence: "Послідовність", gantt: "Графік", pie: "Частки", class: "Компоненти", timeline: "Хронологія", list: "Список", scenario: "Сценарій", existing: "З документа", done: "Готово", left: "Залишилось", share: "Частка", api: "Запити", pairs: "Відповідності", modules: "Модулі", cases: "Варіанти", checks: "Перевірки" },
    es: { mindmap: "Estructura", flowchart: "Proceso", sequence: "Secuencia", gantt: "Calendario", pie: "Proporciones", class: "Componentes", timeline: "Cronología", list: "Lista", scenario: "Escenario", existing: "Del documento", done: "Hecho", left: "Restante", share: "Proporción", api: "Peticiones", pairs: "Correspondencias", modules: "Módulos", cases: "Casos", checks: "Comprobaciones" },
    pt: { mindmap: "Estrutura", flowchart: "Processo", sequence: "Sequência", gantt: "Cronograma", pie: "Proporções", class: "Componentes", timeline: "Linha do tempo", list: "Lista", scenario: "Cenário", existing: "Do documento", done: "Concluído", left: "Restante", share: "Proporção", api: "Requisições", pairs: "Correspondências", modules: "Módulos", cases: "Casos", checks: "Verificações" },
    ja: { mindmap: "構造", flowchart: "プロセス", sequence: "シーケンス", gantt: "スケジュール", pie: "割合", class: "構成要素", timeline: "タイムライン", list: "リスト", scenario: "シナリオ", existing: "ドキュメント内の図", done: "完了", left: "残り", share: "割合", api: "リクエスト", pairs: "対応関係", modules: "モジュール", cases: "ケース", checks: "チェック" },
    "zh-Hant": { mindmap: "結構", flowchart: "流程", sequence: "時序", gantt: "進度", pie: "佔比", class: "元件", timeline: "時間線", list: "清單", scenario: "情境", existing: "文件中的圖表", done: "已完成", left: "剩餘", share: "佔比", api: "請求", pairs: "對應關係", modules: "模組", cases: "情況", checks: "檢查" },
    zh: { mindmap: "结构", flowchart: "流程", sequence: "时序", gantt: "进度", pie: "占比", class: "组件", timeline: "时间线", list: "列表", scenario: "场景", existing: "文档中的图表", done: "已完成", left: "剩余", share: "占比", api: "请求", pairs: "对应关系", modules: "模块", cases: "情况", checks: "检查" }
  };
  function analyze(md, opts) {
    opts = opts || {};
    const M = global.marked; if (!M || !M.lexer) return [];
    let text = String(md || "");
    let docTitle = opts.title || "";
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (fm) { const tm = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]); if (tm && !docTitle) docTitle = tm[1]; text = text.slice(fm[0].length); }
    let tokens;
    try { tokens = M.lexer(text); } catch (e) { return []; }
    const T = TITLES[opts.lang] || TITLES.en;
    const res = [];
    const add = (c, where) => { if (c) { c.title = (T[c.tkey] || T[c.kind] || T.flowchart) + (where ? ": " + clip(where, 50) : ""); res.push(c); } };
    add(outline(tokens, docTitle), docTitle);
    let section = docTitle;
    const walk = (list) => list.forEach((t) => {
      if (t.type === "heading") { section = noNum(plain(t.text)); return; }
      if (t.type === "code") {
        if (/^mermaid\b/.test(t.lang || "")) {           // a diagram already written in the document: offered as it is
          const first = (String(t.text).split("\n").find((l) => l.trim() && !/^\s*%%/.test(l)) || "").trim().split(/\s+/)[0];
          const kind = { flowchart: "flowchart", graph: "flowchart", sequenceDiagram: "sequence", classDiagram: "class", "stateDiagram-v2": "state", stateDiagram: "state", erDiagram: "er", gantt: "gantt", pie: "pie", mindmap: "mindmap", timeline: "timeline" }[first] || "diagram";
          add({ kind, tkey: "existing", code: String(t.text).replace(/\s+$/, ""), score: 9, size: 20 }, section);
          return;
        }
        const shaped = asciiBoxes(t.text) || asciiTree(t.text) || fileList(t.text) || indentTree(t.text);   // a drawn diagram: its arrows are part of it
        if (shaped) add(shaped, section);
        else if (!looksCode(t.text)) { const al = arrowLines(t.text); if (al) add(chainFlow(al), section); }
        if (!t.lang || /^(js|javascript|ts|typescript|json5?|java|kotlin|swift|python|py|csharp|cs|cpp|c\+\+)$/i.test(t.lang)) add(classes(t.text, section), section);
        return;
      }
      if (t.type === "paragraph") {
        const al = arrowLines(t.text); if (al) add(chainFlow(al), section);
        add(numberedParts(t.text) || percentPie(t.text, T), section);
        return;
      }
      if (t.type === "list") {
        add(scenario(t), section);
        add(sequence(t), section);
        add(steps(t), section);
        add(listMindmap(t, section), section);
        add(timeline(t.items.map((it) => it.raw.split("\n")[0]), section), section);
        add(cases(t, section), section);
        add(listArrows(t), section);
        add(checklist(t, section), section);
        t.items.forEach((it) => {
          add(numberedParts(it.text.split("\n")[0]) || percentPie(it.text.split("\n")[0], T), section);
          walk((it.tokens || []).filter((x) => x.type === "list"));          // lists inside list items
        });
        return;
      }
      if (t.type === "table") { tables(t, section).forEach((c) => add(c, section)); return; }
      if (t.tokens && t.type !== "paragraph") walk(t.tokens);
    });
    walk(tokens);
    // the same diagram twice (a list that is both "steps" and "mind map" stays, identical codes do not)
    const seen = new Set();
    const uniq = res.filter((c) => { if (seen.has(c.code)) return false; seen.add(c.code); return true; });
    uniq.forEach((c, i) => { c.id = "d" + (i + 1); c.order = i; });
    // best first: score, then size (bigger diagrams carry more of the document), then the document order
    return uniq.sort((a, b) => (b.score - a.score) || (Math.min(b.size, 20) - Math.min(a.size, 20)) || (a.order - b.order)).slice(0, opts.max || 40);
  }

  global.DOCXMDDocDiagram = { analyze, plain };
})(typeof window !== "undefined" ? window : this);
