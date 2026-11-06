// Exchangeable protons (OH, NH, SH, ...) and how they behave in common NMR solvents.
// Shift ranges are typical values for ¹H NMR at room temperature; they vary with concentration,
// temperature, water content and hydrogen bonding, so they are used for guidance only.

/** Solvent classes. */
export const SOLVENTS = {
  cdcl3: { name: 'CDCl₃', cls: 'aprotic-weak' },
  cd2cl2: { name: 'CD₂Cl₂', cls: 'aprotic-weak' },
  c6d6: { name: 'C₆D₆', cls: 'aprotic-weak' },
  'toluene-d8': { name: 'toluene-d₈', cls: 'aprotic-weak' },
  'dmso-d6': { name: 'DMSO-d₆', cls: 'aprotic-hbond' },
  'acetone-d6': { name: 'acetone-d₆', cls: 'aprotic-hbond' },
  cd3cn: { name: 'CD₃CN', cls: 'aprotic-hbond' },
  'thf-d8': { name: 'THF-d₈', cls: 'aprotic-hbond' },
  'dmf-d7': { name: 'DMF-d₇', cls: 'aprotic-hbond' },
  cd3od: { name: 'CD₃OD', cls: 'protic' },
  d2o: { name: 'D₂O', cls: 'protic' },
  'tfa-d': { name: 'TFA-d', cls: 'protic' },
};

const SYN = {
  cdcl3: 'cdcl3', 'chloroform-d': 'cdcl3', 'chloroform-d1': 'cdcl3', 'deuterochloroform': 'cdcl3',
  cd2cl2: 'cd2cl2', 'dichloromethane-d2': 'cd2cl2', 'methylenechloride-d2': 'cd2cl2',
  c6d6: 'c6d6', 'benzene-d6': 'c6d6', 'toluene-d8': 'toluene-d8', 'c7d8': 'toluene-d8',
  'dmso-d6': 'dmso-d6', 'dmso': 'dmso-d6', '(cd3)2so': 'dmso-d6', 'd6-dmso': 'dmso-d6', 'dimethylsulfoxide-d6': 'dmso-d6',
  'acetone-d6': 'acetone-d6', '(cd3)2co': 'acetone-d6', 'd6-acetone': 'acetone-d6',
  cd3cn: 'cd3cn', 'acetonitrile-d3': 'cd3cn', 'thf-d8': 'thf-d8', 'dmf-d7': 'dmf-d7',
  cd3od: 'cd3od', 'methanol-d4': 'cd3od', 'methanol-d': 'cd3od', 'd4-methanol': 'cd3od', 'cd3oh': 'cd3od',
  d2o: 'd2o', 'deuteriumoxide': 'd2o', 'tfa-d': 'tfa-d', 'cf3cood': 'tfa-d',
};

/** "Chloroform-d" / "CDCl₃" / "DMSO-d6" -> key in SOLVENTS (or null). */
export function solventKey(raw) {
  if (!raw) return null;
  const k = String(raw).replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080)).replace(/\s/g, '').toLowerCase();
  return SYN[k] || null;
}

/**
 * Exchangeable-proton groups. `visible` says how likely the signal is to be observed per solvent class:
 * 'usually' | 'variable' | 'often-missing' | 'exchanged'. Shift ranges [min, max] in ppm per class.
 * More specific patterns come first; each atom is counted once.
 */
export const GROUPS = [
  { id: 'cooh', label: 'carboxylic acid OH', smarts: '[CX3](=O)[OX2H1]',
    visible: { 'aprotic-weak': 'often-missing', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [9.5, 13.5], 'aprotic-hbond': [11.5, 13.5] } },
  { id: 'boh', label: 'boronic acid B(OH)', smarts: '[BX3][OX2H1]',
    visible: { 'aprotic-weak': 'often-missing', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [4.5, 6.5], 'aprotic-hbond': [7.5, 8.5] } },
  { id: 'phenol', label: 'phenol OH', smarts: '[c,n][OX2H1]',
    visible: { 'aprotic-weak': 'variable', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [4.0, 8.0], 'aprotic-hbond': [8.5, 10.5] } },
  { id: 'oxime', label: 'oxime/hydroxylamine OH', smarts: '[NX2,NX3][OX2H1]',
    visible: { 'aprotic-weak': 'variable', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [6.5, 10.0], 'aprotic-hbond': [10.0, 11.5] } },
  { id: 'alcohol', label: 'alcohol OH', smarts: '[CX4,CX3;!$(C=O)][OX2H1]',
    visible: { 'aprotic-weak': 'variable', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [0.8, 5.5], 'aprotic-hbond': [4.0, 6.0] } },
  { id: 'amide', label: 'amide/carbamate NH', smarts: '[NX3;!H0][CX3]=[OX1]',
    visible: { 'aprotic-weak': 'usually', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [4.5, 9.0], 'aprotic-hbond': [6.5, 11.0] } },
  { id: 'sulfonamide', label: 'sulfonamide NH', smarts: '[NX3;!H0][SX4](=O)=O',
    visible: { 'aprotic-weak': 'usually', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [4.0, 8.0], 'aprotic-hbond': [7.0, 10.5] } },
  { id: 'aromnh', label: 'indole/pyrrole/azole NH', smarts: '[nH]',
    visible: { 'aprotic-weak': 'usually', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [7.5, 13.5], 'aprotic-hbond': [10.0, 14.0] } },
  { id: 'ammonium', label: 'ammonium NH⁺', smarts: '[NX4+;!H0]',
    visible: { 'aprotic-weak': 'variable', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [7.0, 10.0], 'aprotic-hbond': [7.5, 9.5] } },
  { id: 'aniline', label: 'aniline NH', smarts: '[NX3;!H0;!$(N[CX3]=[OX1]);!$(N[SX4](=O)=O)]c',
    visible: { 'aprotic-weak': 'usually', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [3.0, 6.0], 'aprotic-hbond': [4.5, 6.5] } },
  { id: 'amine', label: 'amine NH', smarts: '[NX3;!H0;!$(N[CX3]=[OX1]);!$(N[SX4](=O)=O);!$(Nc);!$(N[#7,#8])]',
    visible: { 'aprotic-weak': 'often-missing', 'aprotic-hbond': 'variable', protic: 'exchanged' },
    shift: { 'aprotic-weak': [0.5, 3.0], 'aprotic-hbond': [1.0, 4.0] } },
  { id: 'thiol', label: 'thiol SH', smarts: '[SX2H1]',
    visible: { 'aprotic-weak': 'usually', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: { 'aprotic-weak': [1.0, 4.0], 'aprotic-hbond': [2.0, 5.5] } },
  { id: 'otherNH', label: 'other NH', smarts: '[#7;!H0;!$([NX4+])]',
    visible: { 'aprotic-weak': 'variable', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: {} },
  { id: 'otherOH', label: 'other OH', smarts: '[#8;!H0]',
    visible: { 'aprotic-weak': 'variable', 'aprotic-hbond': 'usually', protic: 'exchanged' },
    shift: {} },
];

/** Find exchangeable groups in a molecule (RDKit MinimalLib mol). Each heteroatom is counted once. */
export function findExchangeable(RDKit, mol, explicitHByAtom) {
  const used = new Set();
  const out = [];
  for (const g of GROUPS) {
    let q;
    try { q = RDKit.get_qmol(g.smarts); } catch { continue; }
    if (!q) continue;
    try {
      let matches = JSON.parse(mol.get_substruct_matches(q) || '[]');
      if (!Array.isArray(matches)) matches = matches && matches.atoms ? [matches] : [];
      let nH = 0, n = 0;
      for (const m of matches) {
        // the exchangeable heteroatom is the matched atom that carries H: N, O, S (or n)
        const het = m.atoms.find(a => explicitHByAtom.has(a) && explicitHByAtom.get(a).hetero && !used.has(a));
        if (het === undefined) continue;
        used.add(het);
        nH += explicitHByAtom.get(het).h;
        n++;
      }
      if (n) out.push({ id: g.id, label: g.label, count: n, nH, group: g });
    } finally { q.delete(); }
  }
  return out;
}

/** Subsets of groups (as H counts) that add up to exactly `missing`. Returns the first matching combination. */
export function explainMissing(groups, missing) {
  // expand to unit protons per group, keeping group order (most likely to be missing first)
  const units = [];
  for (const g of groups) for (let i = 0; i < g.count; i++) units.push({ g, h: g.nH / g.count });
  let best = null;
  const n = units.length;
  for (let mask = 1; mask < (1 << Math.min(n, 12)); mask++) {
    let s = 0; const pick = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { s += units[i].h; pick.push(units[i].g); }
    if (Math.abs(s - missing) < 1e-6) {
      const score = pick.reduce((a, g) => a + ({ 'often-missing': 0, variable: 1, usually: 3, exchanged: 0 }[g._vis] ?? 2), 0);
      if (!best || score < best.score) best = { score, pick };
    }
  }
  return best ? best.pick : null;
}
