// Read a .docx and write Word comments into it, anchored to exact text.
// Dependencies are injected ({ JSZip, DOMParser, XMLSerializer }) so this runs in the browser and in Node.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const CT_COMMENTS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const SYMBOL_CHARS = { F064: 'δ', '0064': 'δ', F061: 'α', F062: 'β', F067: 'γ', F06C: 'λ', F06D: 'μ', F0B0: '°', F0B1: '±', F0AE: '→' };

const isW = (n, name) => n && n.nodeType === 1 && n.namespaceURI === W && n.localName === name;

function elementsW(root, name) {
  return Array.from(root.getElementsByTagNameNS(W, name));
}

function inFallback(node) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p.nodeType === 1 && p.namespaceURI === MC && p.localName === 'Fallback') return true;
  }
  return false;
}

function ownerParagraph(node) {
  for (let p = node.parentNode; p; p = p.parentNode) if (isW(p, 'p')) return p;
  return null;
}

function ownerRun(node) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (isW(p, 'r')) return p;
    if (isW(p, 'p')) return null;
  }
  return null;
}

/** Text pieces of one paragraph in order: [{ node, run, text }]. Only this paragraph's own runs (not nested text boxes). */
function pieces(p) {
  const out = [];
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (isW(c, 'p') || isW(c, 'txbxContent')) continue;            // nested paragraphs belong to themselves
      if (c.namespaceURI === MC && c.localName === 'Fallback') continue;
      if (isW(c, 't')) out.push({ node: c, run: ownerRun(c), text: c.textContent || '' });
      else if (isW(c, 'tab')) out.push({ node: c, run: ownerRun(c), text: '\t' });
      else if (isW(c, 'br') || isW(c, 'cr')) out.push({ node: c, run: ownerRun(c), text: ' ' });
      else if (isW(c, 'noBreakHyphen')) out.push({ node: c, run: ownerRun(c), text: '-' });
      else if (isW(c, 'sym')) {
        const ch = (c.getAttributeNS(W, 'char') || c.getAttribute('w:char') || '').toUpperCase();
        out.push({ node: c, run: ownerRun(c), text: SYMBOL_CHARS[ch] || '?' });
      } else if (isW(c, 'delText') || isW(c, 'instrText')) continue;
      else walk(c);
    }
  };
  walk(p);
  return out;
}

export async function readDocx(buffer, { JSZip, DOMParser }) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Not a Word document (word/document.xml missing)');
  const xml = await file.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = elementsW(doc, 'body')[0];
  if (!body) throw new Error('Could not read the document body');
  const paraEls = elementsW(body, 'p').filter(p => !inFallback(p));
  const paragraphs = paraEls.map(p => pieces(p).map(x => x.text).join(''));
  return { zip, doc, paraEls, paragraphs };
}

/** Split the run containing character `pos` so that a run boundary falls exactly at `pos`. */
function splitAt(p, pos) {
  const ps = pieces(p);
  let acc = 0;
  for (const pc of ps) {
    const len = pc.text.length;
    if (pos > acc && pos < acc + len && isW(pc.node, 't') && pc.run) {
      const k = pos - acc;
      const doc = p.ownerDocument;
      const run = pc.run;
      const t = pc.node;
      const head = pc.text.slice(0, k), tail = pc.text.slice(k);
      const newRun = doc.createElementNS(W, 'w:r');
      for (let c = run.firstChild; c; c = c.nextSibling) {
        if (isW(c, 'rPr')) { newRun.appendChild(c.cloneNode(true)); break; }
      }
      const newT = doc.createElementNS(W, 'w:t');
      newT.setAttribute('xml:space', 'preserve');
      newT.appendChild(doc.createTextNode(tail));
      // move everything after t (within the run) into the new run
      const tParent = t.parentNode;
      if (tParent !== run) return false;   // unusual nesting: leave as is
      newRun.appendChild(newT);
      while (t.nextSibling) newRun.appendChild(t.nextSibling);
      while (t.firstChild) t.removeChild(t.firstChild);
      t.appendChild(doc.createTextNode(head));
      t.setAttribute('xml:space', 'preserve');
      run.parentNode.insertBefore(newRun, run.nextSibling);
      return true;
    }
    acc += len;
  }
  return false;
}

/** First run starting at or after `pos`, and the last run ending at or before `end`. */
function runsFor(p, start, end) {
  const ps = pieces(p);
  let acc = 0, first = null, last = null;
  for (const pc of ps) {
    const s = acc, e = acc + pc.text.length;
    if (pc.run && e > start && s < end) { if (!first) first = pc.run; last = pc.run; }
    acc = e;
  }
  return { first, last };
}

function commentXml(doc, id, author, initials, date, text) {
  const c = doc.createElementNS(W, 'w:comment');
  c.setAttribute('w:id', String(id));
  c.setAttribute('w:author', author);
  c.setAttribute('w:initials', initials);
  c.setAttribute('w:date', date);
  const paras = String(text).split('\n');
  paras.forEach((line, i) => {
    const p = doc.createElementNS(W, 'w:p');
    if (i === 0) {
      const r0 = doc.createElementNS(W, 'w:r');
      const rpr = doc.createElementNS(W, 'w:rPr');
      const rs = doc.createElementNS(W, 'w:rStyle'); rs.setAttribute('w:val', 'CommentReference');
      rpr.appendChild(rs); r0.appendChild(rpr);
      r0.appendChild(doc.createElementNS(W, 'w:annotationRef'));
      p.appendChild(r0);
    }
    const r = doc.createElementNS(W, 'w:r');
    const t = doc.createElementNS(W, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(doc.createTextNode(line));
    r.appendChild(t); p.appendChild(r);
    c.appendChild(p);
  });
  return c;
}

/**
 * Add comments to the document and return the new .docx as Uint8Array.
 * comments: [{ para, start, end, text }]  (character offsets within the paragraph text from readDocx)
 */
export async function annotateDocx(ctx, comments, { JSZip, DOMParser, XMLSerializer }, opts = {}) {
  const { zip, doc, paraEls } = ctx;
  const author = opts.author || 'ChemDataProof';
  const initials = opts.initials || 'CDP';
  const date = (opts.date || new Date().toISOString()).replace(/\.\d+Z$/, 'Z');

  // comments part (create or extend)
  let cdoc, cRoot, nextId = 0;
  const existing = zip.file('word/comments.xml');
  if (existing) {
    cdoc = new DOMParser().parseFromString(await existing.async('string'), 'application/xml');
    cRoot = cdoc.documentElement;
    for (const c of elementsW(cdoc, 'comment')) nextId = Math.max(nextId, +(c.getAttributeNS(W, 'id') || c.getAttribute('w:id')) + 1);
  } else {
    cdoc = new DOMParser().parseFromString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}"></w:comments>`, 'application/xml');
    cRoot = cdoc.documentElement;
  }
  // also respect ids already used in the document body
  for (const n of elementsW(doc, 'commentRangeStart').concat(elementsW(doc, 'commentReference'))) {
    nextId = Math.max(nextId, +(n.getAttributeNS(W, 'id') || n.getAttribute('w:id')) + 1);
  }

  let placed = 0;
  for (const cm of comments) {
    const p = paraEls[cm.para];
    if (!p) continue;
    const len = pieces(p).map(x => x.text).join('').length;
    let start = Math.max(0, Math.min(cm.start ?? 0, len));
    let end = Math.max(start, Math.min(cm.end ?? len, len));
    if (end === start) { start = 0; end = len; }
    splitAt(p, end);
    splitAt(p, start);
    const { first, last } = runsFor(p, start, end);
    if (!first || !last) continue;
    const id = nextId++;
    const rs = doc.createElementNS(W, 'w:commentRangeStart'); rs.setAttribute('w:id', String(id));
    const re = doc.createElementNS(W, 'w:commentRangeEnd'); re.setAttribute('w:id', String(id));
    const refRun = doc.createElementNS(W, 'w:r');
    const rpr = doc.createElementNS(W, 'w:rPr');
    const rst = doc.createElementNS(W, 'w:rStyle'); rst.setAttribute('w:val', 'CommentReference');
    rpr.appendChild(rst); refRun.appendChild(rpr);
    const ref = doc.createElementNS(W, 'w:commentReference'); ref.setAttribute('w:id', String(id));
    refRun.appendChild(ref);
    first.parentNode.insertBefore(rs, first);
    last.parentNode.insertBefore(re, last.nextSibling);
    re.parentNode.insertBefore(refRun, re.nextSibling);
    cRoot.appendChild(commentXml(cdoc, id, author, initials, date, cm.text));
    placed++;
  }

  const ser = new XMLSerializer();
  zip.file('word/document.xml', ser.serializeToString(doc));
  zip.file('word/comments.xml', ser.serializeToString(cdoc));

  if (!existing) {
    // relationship
    const relPath = 'word/_rels/document.xml.rels';
    const rdoc = new DOMParser().parseFromString(await zip.file(relPath).async('string'), 'application/xml');
    const rels = rdoc.documentElement;
    const RNS = rels.namespaceURI;
    const relEls = Array.from(rels.getElementsByTagNameNS(RNS, 'Relationship'));
    if (!relEls.some(r => r.getAttribute('Type') === REL_COMMENTS)) {
      let n = 1; const ids = new Set(relEls.map(r => r.getAttribute('Id')));
      while (ids.has('rId' + n)) n++;
      const r = rdoc.createElementNS(RNS, 'Relationship');
      r.setAttribute('Id', 'rId' + n); r.setAttribute('Type', REL_COMMENTS); r.setAttribute('Target', 'comments.xml');
      rels.appendChild(r);
      zip.file(relPath, ser.serializeToString(rdoc));
    }
    // content type
    const ctPath = '[Content_Types].xml';
    const tdoc = new DOMParser().parseFromString(await zip.file(ctPath).async('string'), 'application/xml');
    const types = tdoc.documentElement;
    const TNS = types.namespaceURI;
    if (!Array.from(types.getElementsByTagNameNS(TNS, 'Override')).some(o => o.getAttribute('PartName') === '/word/comments.xml')) {
      const o = tdoc.createElementNS(TNS, 'Override');
      o.setAttribute('PartName', '/word/comments.xml'); o.setAttribute('ContentType', CT_COMMENTS);
      types.appendChild(o);
      zip.file(ctPath, ser.serializeToString(tdoc));
    }
  }
  // Rebuild without folder entries (some cloud services refuse .docx files that contain them).
  // [Content_Types].xml goes first, as Word itself writes it.
  const clean = new JSZip();
  const names = [];
  zip.forEach((path, f) => { if (!f.dir) names.push(path); });
  names.sort((a, b) => (b === '[Content_Types].xml') - (a === '[Content_Types].xml'));
  for (const n of names) clean.file(n, await zip.file(n).async('uint8array'), { createFolders: false });
  const out = await clean.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes: out, placed };
}

// ---------- From findings to comments ----------

const SECTION_TYPE = { '1H NMR': '1H', '13C NMR': '13C', '19F NMR': '19F', '31P NMR': '31P', HRMS: 'HRMS' };

/** Senior-reviewer style wording. */
const SUPS = { '+': '⁺', '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** "[M-H]-" -> "[M−H]⁻", "[M+Na]+" -> "[M+Na]⁺" */
export function prettyIons(text) {
  return String(text).replace(/\[M([^\]]*)\](\d*)([+-])/g, (_, inner, z, sign) =>
    `[M${inner.replace(/-/g, '−')}]${z.split('').map(d => SUPS[d]).join('')}${SUPS[sign]}`);
}

export function reviewText(f) {
  const lead = f.level === 'error' ? 'Please correct' : f.level === 'warning' ? 'Please check' : 'Minor';
  const title = f.title.replace(/\.$/, '');
  return prettyIons(`${lead} (${f.section}): ${title}.${f.detail ? ' ' + f.detail : ''}`);
}

/** Problems that occur in several compounds, for the summary comment. */
export function recurringIssues(results, min = 3) {
  const groups = new Map();
  for (const r of results) {
    const seen = new Set();
    for (const f of r.findings) {
      if (f.level === 'ok' || f.level === 'info' || f.fyi) continue;
      const key = f.section + '|' + f.title.replace(/\b[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)*\b/g, 'F').replace(/\d+(?:[.,]\d+)?/g, 'n');
      if (seen.has(key)) continue;
      seen.add(key);
      if (!groups.has(key)) groups.set(key, { title: f.title, section: f.section, n: 0 });
      groups.get(key).n++;
    }
  }
  return [...groups.values()].filter(g => g.n >= min).sort((a, b) => b.n - a.n);
}

/**
 * Turn the findings of one entry into anchored comments.
 * @param entry   from splitParagraphs (with parts/title_loc)
 * @param result  from runChecks (findings, sections)
 * @param locate  document.js locate()
 */
export function commentsForEntry(entry, result, locate, { includeNotes = true } = {}) {
  const out = [];
  const secs = result.sections || [];
  for (const f of result.findings) {
    if (f.level === 'ok' || f.fyi) continue;
    if (f.level === 'info' && !includeNotes) continue;
    let loc = null;
    if (f.section === 'Structure' && entry.title_loc) {
      loc = { para: entry.title_loc.para, start: entry.title_loc.offset, end: entry.title_loc.offset + entry.title_loc.length };
    } else {
      const type = SECTION_TYPE[f.section] || (f.anchorSection ? f.anchorSection : null);
      const sec = type ? secs.find(s => s.type === type) : null;
      const from = sec ? sec.start : 0, to = sec ? sec.end : entry.text.length;
      let a = -1;
      if (f.anchor) a = entry.text.indexOf(f.anchor, from);
      if (a >= 0 && a < to + 1) loc = locate(entry, a, a + f.anchor.length);
      else if (f.anchor && (a = entry.text.indexOf(f.anchor)) >= 0) loc = locate(entry, a, a + f.anchor.length);
      else if (sec) loc = locate(entry, sec.start, sec.end);
      else loc = locate(entry, 0, Math.min(entry.text.length, 20));
    }
    if (loc) out.push({ ...loc, text: reviewText(f), level: f.level });
  }
  return out;
}
