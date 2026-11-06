// Parsers for characterisation paragraphs as written in Supporting Information.
// Pure functions, no dependencies.

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Normalise unicode quirks from Word/ChemDraw/PDF copy-paste. */
export function normalize(text) {
  return String(text || '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUP[c])
    .replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080))
    .replace(/⁺/g, '+').replace(/⁻/g, '-')
    .replace(/[−‒–—‐‑]/g, '-')
    .replace(/[     ]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

const HEADER_RE = new RegExp([
  String.raw`(?<nmr>1H|13C|19F|31P|11B|29Si|15N)\s*(?:\{[^}]*\})?\s*-?\s*NMR`,
  String.raw`(?<hrms>HR-?MS|HRESIMS|HR-?ESI-?MS|ESI-?HRMS|HR-?EI-?MS|HR-?APCI-?MS)`,
  String.raw`(?<other>\bIR\b|\bFT-?IR\b|\bm\.?\s?p\.?(?=\s|:|\d)|\bR\s?f\b|\[\s*α\s*\]|\bAnal\.|\bEA\b|\bHPLC\b|\bSFC\b|\bUV-?Vis)`,
].join('|'), 'g');

/** Split a characterisation paragraph into sections keyed by technique. */
export function segment(text) {
  const t = normalize(text);
  const hits = [];
  let m;
  HEADER_RE.lastIndex = 0;
  while ((m = HEADER_RE.exec(t)) !== null) {
    let type;
    if (m.groups.nmr) type = m.groups.nmr;
    else if (m.groups.hrms) type = 'HRMS';
    else type = 'other';
    hits.push({ type, start: m.index, headerEnd: HEADER_RE.lastIndex, label: m[0] });
  }
  const sections = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const end = i + 1 < hits.length ? hits[i + 1].start : t.length;
    sections.push({ type: h.type, label: h.label, header: t.slice(h.headerEnd, end), raw: t.slice(h.start, end) });
  }
  return sections;
}

/** Read the "(400 MHz, CDCl3)" part that follows an NMR header and return the remaining data string. */
export function splitNmrHeader(body) {
  let s = body;
  let freq = null, solvent = null;
  const pm = s.match(/^\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/);
  if (pm) {
    const parts = pm[1].split(/[,;]/).map(x => x.trim()).filter(Boolean);
    const rest = [];
    for (const p of parts) {
      const f = p.match(/(\d+(?:\.\d+)?)\s*MHz/i);
      if (f) freq = parseFloat(f[1]);
      else if (!/^\d+(\.\d+)?\s*(K|°\s*C|oC)$/i.test(p)) rest.push(p);
    }
    if (rest.length) solvent = rest.join(', ');
    s = s.slice(pm[0].length);
  }
  s = s.replace(/^[\s:,]*(?:δ|d)?\s*(?:\(ppm\))?\s*[=:]?\s*/, '');
  s = s.replace(/[\s.;]+$/, '');
  return { freq, solvent, data: s };
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

function readBalanced(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function decimalsOf(str) {
  const d = String(str).split('.')[1];
  return d ? d.length : 0;
}

// Multiplicity: number of J values each code implies.
const NAMED_MULT = { s: 0, m: 0, quint: 1, quin: 1, sext: 1, sept: 1, hept: 1, sex: 1, h: 1, hex: 1, sx: 1, non: 1 };

export function expectedJCount(code) {
  if (!code) return null;
  if (code in NAMED_MULT) return NAMED_MULT[code];
  if (/^[dtqp]+$/.test(code)) return code.length;
  return null; // unknown code (ABq, AB, ...): not checked
}

function parseMultiplicity(inner) {
  const tokens = inner.split(/[,;]/).map(x => x.trim());
  for (const tok of tokens) {
    const m = tok.match(/^((?:br\.?|broad|app\.?|apparent|pseudo-?)\s*)*([a-z]+)\.?$/i);
    if (!m) continue;
    const code = m[2].toLowerCase();
    if (code in NAMED_MULT || /^[dtqp]+$/.test(code) || /^(ab|abq|abx)$/.test(code)) {
      return { mult: tok, code, broad: /br|broad/i.test(tok) };
    }
  }
  return { mult: null, code: null, broad: false };
}

function parseJ(inner) {
  const first = inner.search(/\d*J/);
  if (first < 0) return [];
  const last = inner.lastIndexOf('Hz');
  if (last < first) return [];
  let sub = inner.slice(first, last);
  sub = sub.replace(/\d*J[A-Za-z0-9,\-]*\s*(\([^)]*\))?\s*=/g, ' ');
  return (sub.match(/\d+(?:\.\d+)?/g) || []).map(x => ({ value: parseFloat(x), raw: x }));
}

/** Parse ¹H NMR data: "7.26 (d, J = 8.0 Hz, 2H), 3.80 (s, 3H), 2.31-2.25 (m, 1H)". */
export function parseProtonData(data) {
  const out = [];
  const re = new RegExp(String.raw`(${NUM})(?:\s*-\s*(${NUM}))?\s*\(`, 'g');
  let m;
  while ((m = re.exec(data)) !== null) {
    const open = re.lastIndex - 1;
    const close = readBalanced(data, open);
    if (close < 0) break;
    const inner = data.slice(open + 1, close);
    const integ = inner.match(/(\d+(?:\.\d+)?)\s*H\b/);
    const { mult, code, broad } = parseMultiplicity(inner);
    out.push({
      raw: data.slice(m.index, close + 1),
      shift: parseFloat(m[1]),
      shiftEnd: m[2] !== undefined ? parseFloat(m[2]) : null,
      shiftRaw: [m[1], m[2]].filter(x => x !== undefined),
      mult, code, broad,
      J: parseJ(inner),
      nH: integ ? parseFloat(integ[1]) : null,
      inner,
    });
    re.lastIndex = close + 1;
  }
  return out;
}

/** Parse a peak list (¹³C, ¹⁹F, ³¹P): "158.0, 129.8 (2C), 124.1 (q, J = 272 Hz), 55.3". */
export function parsePeakList(data) {
  const out = [];
  let i = 0;
  const re = new RegExp(String.raw`(${NUM})(?:\s*-\s*(${NUM}))?`, 'y');
  while (i < data.length) {
    const c = data[i];
    if (/[\s,;]/.test(c)) { i++; continue; }
    if (data.startsWith('and', i)) { i += 3; continue; }
    re.lastIndex = i;
    const m = re.exec(data);
    if (!m) {
      // skip unknown word up to next separator
      const nxt = data.slice(i).search(/[,;]/);
      if (nxt < 0) break;
      i += nxt + 1;
      continue;
    }
    i = re.lastIndex;
    let inner = '';
    const ws = data.slice(i).match(/^\s*\(/);
    if (ws) {
      const open = i + ws[0].length - 1;
      const close = readBalanced(data, open);
      if (close > 0) { inner = data.slice(open + 1, close); i = close + 1; }
    }
    const nC = inner.match(/(\d+)\s*(C|F|P)\b/);
    const { mult, code } = parseMultiplicity(inner);
    out.push({
      raw: m[0] + (inner ? ` (${inner})` : ''),
      shift: parseFloat(m[1]),
      shiftEnd: m[2] !== undefined ? parseFloat(m[2]) : null,
      shiftRaw: [m[1], m[2]].filter(x => x !== undefined),
      mult, code,
      J: parseJ(inner),
      count: nC ? parseInt(nC[1], 10) : 1,
      inner,
    });
  }
  return out;
}

/** Parse an HRMS sentence. */
export function parseHRMS(body) {
  const s = body;
  const res = { ionization: null, adductRaw: null, formulaRaw: null, calc: null, found: null, calcRaw: null, foundRaw: null };
  const ion = s.match(/\b(ESI|APCI|EI|CI|FAB|MALDI|APPI|DART|FI|FD|nanoESI)\b/i);
  if (ion) res.ionization = ion[1].toUpperCase();

  const add = s.match(/\[\s*M[^\]]*\]\s*\d*\s*[+\-⁺⁻](?:•)?|\(\s*M[^)]*\)\s*\d*\s*[+\-⁺⁻]|\bM\s*[+\-⁺⁻](?:•)?(?![A-Za-z0-9.])/);
  if (add) res.adductRaw = add[0].trim();

  const fm = s.match(/\bfor\s*:?\s*\[?\s*((?:[A-Z][a-z]?\d*|\(|\)\d*)+)\s*\]?\s*\d*[+\-⁺⁻]?/);
  let afterFormula = 0;
  if (fm) { res.formulaRaw = fm[1]; afterFormula = fm.index + fm[0].length; }

  const foundIdx = s.search(/\bfound\b|\bobs(erved|d)?\b|\bmeas(ured)?\b/i);
  const decRe = /(\d+\.\d{2,})/g;
  if (foundIdx >= 0) {
    const fpart = s.slice(foundIdx).match(/(\d+\.\d{2,})/);
    if (fpart) { res.found = parseFloat(fpart[1]); res.foundRaw = fpart[1]; }
    const cpart = s.slice(afterFormula, foundIdx).match(/(\d+\.\d{2,})/) || s.slice(0, foundIdx).match(/(\d+\.\d{2,})/);
    if (cpart) { res.calc = parseFloat(cpart[1]); res.calcRaw = cpart[1]; }
  } else {
    const all = s.slice(afterFormula).match(decRe) || [];
    if (all[0]) { res.calc = parseFloat(all[0]); res.calcRaw = all[0]; }
    if (all[1]) { res.found = parseFloat(all[1]); res.foundRaw = all[1]; }
  }
  return res;
}

export { decimalsOf };
