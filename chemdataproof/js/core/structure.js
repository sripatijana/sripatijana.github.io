// Structure analysis on top of RDKit.js (MinimalLib).
// Takes an initialised RDKit module so it works both in the browser and in Node tests.

import { findExchangeable } from './exchangeable.js';

const SYMBOLS = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr',
  'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce',
  'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt',
  'Au', 'Hg'];

/** Build a heavy-atom graph from RDKit commonchem JSON. Explicit H atoms are folded into their neighbour's H count. */
export function graphFromRdkitJson(jsonStr) {
  const j = JSON.parse(jsonStr);
  const defA = j.defaults.atom, defB = j.defaults.bond;
  const mol = j.molecules[0];
  const atoms = mol.atoms.map(a => ({ ...defA, ...a }));
  const bonds = (mol.bonds || []).map(b => ({ ...defB, ...b }));
  const n = atoms.length;
  const adj = Array.from({ length: n }, () => []);
  for (const b of bonds) { const [x, y] = b.atoms; adj[x].push(y); adj[y].push(x); }
  const nodes = atoms.map((a, i) => ({ idx: i, z: a.z, el: SYMBOLS[a.z] || `Z${a.z}`, chg: a.chg, isotope: a.isotope, hH: a.impHs, hD: 0, nRad: a.nRad }));
  const keep = [];
  for (const node of nodes) {
    if (node.z === 1) {
      const nb = adj[node.idx][0];
      if (nb !== undefined && nodes[nb].z !== 1) {
        if (node.isotope === 2) nodes[nb].hD++; else nodes[nb].hH++;
        node.folded = true;
        continue;
      }
    }
    keep.push(node);
  }
  const heavyAdj = adj.map((l, i) => l.filter(k => !nodes[k].folded && !nodes[i].folded));
  return { nodes, heavyAdj, keep };
}

/**
 * Topological equivalence classes via iterative refinement (Weisfeiler–Lehman / Morgan-like).
 * Atoms in one class are constitutionally equivalent. Stereochemistry is ignored, so
 * diastereotopic groups are merged: counts are therefore an upper bound on what is "expected" by symmetry
 * only in the sense that real spectra can show more (diastereotopic) or fewer (overlap) signals.
 */
export function symmetryClasses(graph, seed = null) {
  const { nodes, heavyAdj, keep } = graph;
  let label = new Map();
  for (const n of keep) {
    label.set(n.idx, `${n.el}|${n.isotope}|${heavyAdj[n.idx].length}|${n.hH}|${n.hD}|${n.chg}|${n.nRad}` + (seed && seed.has(n.idx) ? `|${seed.get(n.idx)}` : ''));
  }
  const compress = (lab) => {
    const uniq = [...new Set(lab.values())].sort();
    const map = new Map(uniq.map((u, i) => [u, i]));
    const out = new Map();
    for (const [k, v] of lab) out.set(k, map.get(v));
    return { out, count: uniq.length };
  };
  let { out: cur, count } = compress(label);
  for (let it = 0; it < keep.length + 1; it++) {
    const next = new Map();
    for (const n of keep) {
      const nb = heavyAdj[n.idx].map(k => cur.get(k)).sort((a, b) => a - b).join(',');
      next.set(n.idx, `${cur.get(n.idx)}:${nb}`);
    }
    const c = compress(next);
    if (c.count === count) break;
    cur = c.out; count = c.count;
  }
  return cur;
}

/**
 * Split constitutionally equivalent groups that are diastereotopic: two equivalent substituents on a
 * prochiral sp3 centre (Cxxab) in a molecule that has a stereocentre (e.g. cyclohexyl C2/C6 or the two
 * CH3 of an isopropyl group next to a stereocentre). Gives the maximum number of distinguishable environments.
 */
export function diastereotopicClasses(graph, cls) {
  const seed = new Map();
  let cur = cls;
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const n of graph.keep) {
      const nb = graph.heavyAdj[n.idx];
      if (nb.length + n.hH + n.hD !== 4) continue;
      const subs = nb.map(k => `c${cur.get(k)}`).concat(Array(n.hH).fill('H'), Array(n.hD).fill('D'));
      const counts = {};
      for (const x of subs) counts[x] = (counts[x] || 0) + 1;
      const vals = Object.values(counts).sort();
      if (vals.join() !== '1,1,2') continue;               // exactly x,x,a,b
      const twin = Object.keys(counts).find(k => counts[k] === 2 && k.startsWith('c'));
      if (!twin) continue;
      const pair = nb.filter(k => `c${cur.get(k)}` === twin);
      if (pair.length === 2 && !seed.has(pair[0]) && cur.get(pair[0]) === cur.get(pair[1])) {
        seed.set(pair[0], `dia${n.idx}`); changed = true;
      }
    }
    if (!changed) break;
    cur = symmetryClasses(graph, seed);
  }
  return cur;
}

export function analyzeSmiles(RDKit, smiles) {
  const mol = RDKit.get_mol(smiles);
  if (!mol || !mol.is_valid()) { if (mol) mol.delete(); throw new Error('RDKit could not parse this SMILES'); }
  try {
    const graph = graphFromRdkitJson(mol.get_json());
    const cls = symmetryClasses(graph);
    const formula = {};
    let charge = 0, radicals = 0;
    for (const n of graph.keep) {
      formula[n.el] = (formula[n.el] || 0) + 1;
      if (n.hH) formula.H = (formula.H || 0) + n.hH;
      if (n.hD) formula.D = (formula.D || 0) + n.hD;
      charge += n.chg; radicals += n.nRad;
    }
    // Environments
    const envOf = (pred) => {
      const groups = new Map();
      for (const n of graph.keep) if (pred(n)) {
        const k = cls.get(n.idx);
        if (!groups.has(k)) groups.set(k, { atoms: [], nH: 0, el: n.el });
        const g = groups.get(k); g.atoms.push(n.idx); g.nH += n.hH;
      }
      return [...groups.values()];
    };
    const carbonEnv = envOf(n => n.el === 'C');
    const stereoTags = countStereoTags(mol);
    let carbonEnvMax = carbonEnv.length;
    if (stereoTags > 0 || /@/.test(smiles)) {
      const dcls = diastereotopicClasses(graph, cls);
      carbonEnvMax = new Set(graph.keep.filter(n => n.el === 'C').map(n => dcls.get(n.idx))).size;
    }
    const fluorineEnv = envOf(n => n.el === 'F');
    const phosphorusEnv = envOf(n => n.el === 'P');
    const protonEnv = envOf(n => n.hH > 0).map(g => ({ ...g, onHetero: g.el !== 'C' }));
    const exchangeableH = graph.keep.filter(n => ['O', 'N', 'S'].includes(n.el)).reduce((s, n) => s + n.hH, 0);
    const hMap = new Map(graph.keep.filter(n => n.hH > 0).map(n => [n.idx, { h: n.hH, hetero: ['O', 'N', 'S'].includes(n.el) }]));
    let exchangeable = [];
    try { exchangeable = findExchangeable(RDKit, mol, hMap); } catch { /* older RDKit.js without SMARTS support */ }
    const components = fragmentComponents(graph);
    const fragments = components.length;
    const ch2Count = graph.keep.filter(n => n.el === 'C' && n.hH === 2).length;
    const hasStereo = /@/.test(smiles) || /[\\/]/.test(smiles);
    let svg = null;
    try { svg = mol.get_svg(320, 220); } catch { /* ignore */ }
    return {
      smiles: mol.get_smiles(), formula, charge, radicals, carbonEnv, fluorineEnv, phosphorusEnv,
      protonEnv, exchangeableH, exchangeable, fragments, components, hasStereo, ch2Count, svg, carbonEnvMax,
      stereoCenters: stereoTags,
    };
  } finally {
    mol.delete();
  }
}

/** Connected components (e.g. cation + counter-anion of a salt) with their own formula and charge. */
function fragmentComponents(graph) {
  const seen = new Set();
  const comps = [];
  for (const n of graph.keep) {
    if (seen.has(n.idx)) continue;
    const formula = {}; let charge = 0;
    const st = [n.idx];
    while (st.length) {
      const x = st.pop(); if (seen.has(x)) continue; seen.add(x);
      const a = graph.nodes[x];
      formula[a.el] = (formula[a.el] || 0) + 1;
      if (a.hH) formula.H = (formula.H || 0) + a.hH;
      if (a.hD) formula.D = (formula.D || 0) + a.hD;
      charge += a.chg;
      st.push(...graph.heavyAdj[x]);
    }
    comps.push({ formula, charge });
  }
  return comps;
}

function countStereoTags(mol) {
  try {
    const t = JSON.parse(mol.get_stereo_tags());
    return (t.CIP_atoms || []).length;
  } catch { return 0; }
}

/** Compare two structures: 'same', 'stereo' (same constitution, different stereo) or 'different'. */
export function compareStructures(RDKit, smilesA, smilesB) {
  const canon = s => {
    const m = RDKit.get_mol(s);
    if (!m || !m.is_valid()) { if (m) m.delete(); return null; }
    try { return m.get_smiles(); } finally { m.delete(); }
  };
  const a = canon(smilesA), b = canon(smilesB);
  if (!a || !b) return { result: 'invalid' };
  if (a === b) return { result: 'same' };
  const flat = s => canon(s.replace(/[@\\/]/g, ''));
  if (flat(a) === flat(b)) {
    const stereoA = /[@\\/]/.test(a), stereoB = /[@\\/]/.test(b);
    return { result: 'stereo', stereoA, stereoB };
  }
  return { result: 'different' };
}
