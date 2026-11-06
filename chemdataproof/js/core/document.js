// Split a whole characterisation section (from a .docx or pasted text) into one entry per compound.
// Positions are kept so that findings can later be anchored to the exact text in the Word file.
import { normalize } from './parse.js';

const DATA_RE = /(1H|13C|19F|31P|11B)\s*(?:\{[^}]*\})?\s*-?\s*NMR|\bHR-?MS\b|\bHRESIMS\b/;
const PROSE_RE = /\b(synthesi[sz]ed|prepared|procedure|yield|was|were|obtained|added|stirred|according|purified|using|following|solution|mixture)\b/i;
const LABEL_RE = /\s*[([]\s*([A-Z]{0,2}\d{1,3}[a-z]{0,2}'?|[A-Z]\d{0,3}[a-z]?)\s*[)\]]\s*[:.]?\s*$/;

/** Clean a title line into { name, label }: "4-Phenylbutan-2-one (1a)" -> name "4-Phenylbutan-2-one", label "1a". */
export function cleanTitle(line) {
  let s = normalize(line).replace(/[*_¶]/g, '').replace(/\s+/g, ' ').trim();
  let label = '';
  const lead = s.match(/^(?:compound\s+)?([\dA-Z]{1,3}[a-z]?)\s*[:.)]\s+(?=\S)/i);
  const lm = s.match(LABEL_RE);
  if (lm) { label = lm[1]; s = s.slice(0, lm.index).trim(); }
  else if (lead && /\d/.test(lead[1])) { label = lead[1]; s = s.slice(lead[0].length).trim(); }
  s = s.replace(/[:.]$/, '').trim();
  return { name: s, label };
}

function isTitle(p) {
  if (DATA_RE.test(p)) return false;
  const words = p.split(/\s+/).length;
  if (p.length > 250 || words > 25) return false;
  if (PROSE_RE.test(p)) return false;
  if (/^\(?\d+\)\s/.test(p)) return false;            // reference list "(1) A. Author"
  if (/\.\s*$/.test(p) && !LABEL_RE.test(p)) return false; // sentences end with a full stop
  return /[a-z]/i.test(p);
}

/** Guess the compound name from text before the first NMR header (single-entry use). */
export function extractName(text) {
  const t = normalize(text);
  const h = t.search(DATA_RE);
  const before = h >= 0 ? t.slice(0, h) : '';
  for (let line of before.split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (!isTitle(line.replace(/[:]\s*$/, ''))) return '';
    return cleanTitle(line).name;
  }
  return '';
}

/**
 * Split paragraphs into compound entries.
 * @param {string[]} paras paragraph texts (one per Word paragraph or text line)
 * @returns entries: { index, title, name, label, text, title_loc: {para, offset, length} | null,
 *                     parts: [{ para, offset, length, start }] }  (start = position in entry.text)
 */
export function splitParagraphs(paras) {
  const entries = [];
  let pending = null;   // { text, para, offset }
  let cur = null;
  paras.forEach((raw, pi) => {
    const norm = normalize(raw);
    const lead = norm.length - norm.trimStart().length;
    const p = norm.trim();
    if (!p) return;
    if (DATA_RE.test(p)) {
      const idx = p.search(DATA_RE);
      const prefix = p.slice(0, idx).replace(/[:\s]+$/, '');
      let dataOffset = lead;
      if (prefix && isTitle(prefix)) {
        pending = { text: prefix, para: pi, offset: lead };
        dataOffset = lead + idx;
      }
      if (pending !== null || !cur) {
        const t = pending ? cleanTitle(pending.text) : { name: '', label: '' };
        cur = {
          title: pending ? pending.text : '', name: t.name, label: t.label,
          title_loc: pending ? { para: pending.para, offset: pending.offset, length: pending.text.length } : null,
          parts: [],
        };
        entries.push(cur);
        pending = null;
      }
      cur.parts.push({ para: pi, offset: dataOffset, text: norm.slice(dataOffset).trimEnd() });
    } else if (isTitle(p)) {
      pending = { text: p, para: pi, offset: lead };
    }
  });
  return entries.map((e, i) => {
    let pos = 0;
    const parts = e.parts.map(pt => {
      const out = { para: pt.para, offset: pt.offset, length: pt.text.length, start: pos };
      pos += pt.text.length + 1;
      return out;
    });
    return {
      index: i + 1, title: e.title, name: e.name, label: e.label, title_loc: e.title_loc,
      text: e.parts.map(p => p.text).join('\n'), parts,
    };
  });
}

/** Split plain text (pasted, or raw text of a document) into compound entries. */
export function splitEntries(rawText) {
  return splitParagraphs(String(rawText || '').replace(/\r\n?/g, '\n').split('\n'));
}

/** Map a [start, end) range in entry.text to a paragraph range (clamped to one paragraph). */
export function locate(entry, start, end) {
  const part = entry.parts.find(p => start >= p.start && start <= p.start + p.length) || entry.parts[0];
  if (!part) return null;
  const s = Math.max(0, start - part.start);
  const e = Math.min(part.length, Math.max(s + 1, end - part.start));
  return { para: part.para, start: part.offset + s, end: part.offset + e };
}
