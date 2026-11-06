// Molecular formula parsing, monoisotopic masses and HRMS adduct handling.
// Pure functions, no dependencies: runs in the browser and in Node.

// Monoisotopic mass of the most abundant isotope (u).
export const ISOTOPE_MASS = {
  H: 1.00782503207, D: 2.0141017778, Li: 7.01600455, B: 11.0093054, C: 12.0,
  N: 14.0030740048, O: 15.99491461956, F: 18.99840322, Na: 22.9897692809,
  Mg: 23.9850417, Al: 26.98153863, Si: 27.9769265325, P: 30.97376163,
  S: 31.972071, Cl: 34.96885268, K: 38.96370668, Ca: 39.96259098,
  Ti: 47.9479463, Cr: 51.9405075, Mn: 54.9380451, Fe: 55.9349375,
  Co: 58.933195, Ni: 57.9353429, Cu: 62.9295975, Zn: 63.9291422,
  Ga: 68.9255736, Ge: 73.9211778, As: 74.9215965, Se: 79.9165213,
  Br: 78.9183371, Ru: 101.9043493, Rh: 102.905504, Pd: 105.903486,
  Ag: 106.905097, Sn: 119.9021947, Sb: 120.9038157, Te: 129.9062244,
  I: 126.904473, Cs: 132.905451933, Ir: 192.962926, Pt: 194.964791,
  Au: 196.966552, Hg: 201.970643,
};

export const ELECTRON_MASS = 0.00054857990946;

/** Parse a formula such as "C12H14NaO2", "C6H5(CH3)", "[C10H13O2]+" into {El: n}. */
export function parseFormula(str) {
  if (!str) throw new Error('Empty formula');
  let s = String(str).trim()
    .replace(/[₀-₉]/g, d => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d)))
    .replace(/^\[|\][+\-−]*\d*[+\-−]*$/g, '')
    .replace(/[+\-−]+$/, '')
    .replace(/\s+/g, '');
  const stack = [{}];
  const re = /([A-Z][a-z]?)(\d*)|(\()|(\))(\d*)/g;
  let m, consumed = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index !== consumed) throw new Error(`Cannot read formula "${str}"`);
    consumed = re.lastIndex;
    if (m[1]) {
      if (!(m[1] in ISOTOPE_MASS)) throw new Error(`Unknown element "${m[1]}" in "${str}"`);
      const top = stack[stack.length - 1];
      top[m[1]] = (top[m[1]] || 0) + (m[2] ? parseInt(m[2], 10) : 1);
    } else if (m[3]) {
      stack.push({});
    } else if (m[4]) {
      if (stack.length < 2) throw new Error(`Unbalanced ")" in "${str}"`);
      const grp = stack.pop();
      const k = m[5] ? parseInt(m[5], 10) : 1;
      const top = stack[stack.length - 1];
      for (const [el, n] of Object.entries(grp)) top[el] = (top[el] || 0) + n * k;
    }
  }
  if (consumed !== s.length || stack.length !== 1 || !consumed) {
    throw new Error(`Cannot read formula "${str}"`);
  }
  return stack[0];
}

export function addFormulas(a, b, sign = 1) {
  const out = { ...a };
  for (const [el, n] of Object.entries(b)) out[el] = (out[el] || 0) + sign * n;
  for (const el of Object.keys(out)) if (out[el] === 0) delete out[el];
  return out;
}

export function formulasEqual(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] || 0) !== (b[k] || 0)) return false;
  return true;
}

/** Hill-order string, e.g. {C:10,H:13,O:2} -> "C10H13O2". */
export function formatFormula(f) {
  const els = Object.keys(f).filter(e => f[e] !== 0);
  const order = els.includes('C')
    ? ['C', 'H', ...els.filter(e => e !== 'C' && e !== 'H').sort()]
    : els.sort();
  return order.filter(e => f[e]).map(e => e + (f[e] === 1 ? '' : f[e])).join('');
}

export function monoisotopicMass(f) {
  let m = 0;
  for (const [el, n] of Object.entries(f)) {
    if (n < 0) throw new Error(`Negative count of ${el}`);
    m += ISOTOPE_MASS[el] * n;
  }
  return m;
}

/**
 * Parse an adduct label like "[M+H]+", "[M+Na]+", "[M-H]-", "[M]+", "M+",
 * "[M+NH4]+", "[M+2H]2+", "[M+H-H2O]+".
 * Returns { label, add: {El:n} (net change to M), charge: signed int }.
 */
export function parseAdduct(raw) {
  let s = String(raw).replace(/\s+/g, '')
    .replace(/[−–—]/g, '-').replace(/⁺/g, '+').replace(/⁻/g, '-')
    .replace(/[•·]/g, '').replace(/[()]/g, m => (m === '(' ? '[' : ']'));
  const m = s.match(/^\[?M((?:[+\-]\d*[A-Z][A-Za-z0-9]*)*)\]?(\d*)([+\-])$/);
  if (!m) return null;
  let add = {};
  const terms = m[1].match(/[+\-]\d*[A-Z][A-Za-z0-9]*/g) || [];
  for (const t of terms) {
    const sign = t[0] === '+' ? 1 : -1;
    const tm = t.slice(1).match(/^(\d*)(.*)$/);
    const k = tm[1] ? parseInt(tm[1], 10) : 1;
    let f;
    try { f = parseFormula(tm[2]); } catch { return null; }
    for (const el of Object.keys(f)) f[el] *= k;
    add = addFormulas(add, f, sign);
  }
  const z = (m[2] ? parseInt(m[2], 10) : 1) * (m[3] === '+' ? 1 : -1);
  return { label: `[M${m[1]}]${m[2] && m[2] !== '1' ? m[2] : ''}${m[3]}`, add, charge: z };
}

/** m/z for an ion formula with a given charge. withElectron=false ignores electron mass (common practice). */
export function ionMz(ionFormula, charge, withElectron = true) {
  const z = charge || 1;
  const m = monoisotopicMass(ionFormula) - (withElectron ? z * ELECTRON_MASS : 0);
  return m / Math.abs(z);
}
