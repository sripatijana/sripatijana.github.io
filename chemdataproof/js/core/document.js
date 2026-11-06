// Split a whole characterisation section (from a .docx or pasted text) into one entry per compound.
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
 * Split text into compound entries.
 * A title is a short, non-sentence paragraph; it starts an entry once data (NMR/HRMS) follows it.
 * Returns [{ title, name, label, text, index }].
 */
export function splitEntries(rawText) {
  const paras = normalize(rawText).split(/\n\s*\n|\n(?=\s*\S)/).map(p => p.trim()).filter(Boolean);
  const entries = [];
  let pending = null;   // last title candidate not yet used
  let cur = null;
  for (const p of paras) {
    if (DATA_RE.test(p)) {
      // "Name (1a): 1H NMR ..." in one paragraph
      const idx = p.search(DATA_RE);
      const prefix = p.slice(0, idx).replace(/[:\s]+$/, '');
      if (prefix && isTitle(prefix)) { pending = prefix; }
      const data = prefix && pending === prefix ? p.slice(idx) : p;
      if (pending !== null || !cur) {
        const t = pending ? cleanTitle(pending) : { name: '', label: '' };
        cur = { title: pending || '', name: t.name, label: t.label, parts: [] };
        entries.push(cur);
        pending = null;
      }
      cur.parts.push(data);
    } else if (isTitle(p)) {
      pending = p;
    }
    // other prose (procedures, yields) is ignored
  }
  return entries.map((e, i) => ({
    index: i + 1, title: e.title, name: e.name, label: e.label,
    text: e.parts.join('\n'),
  }));
}
