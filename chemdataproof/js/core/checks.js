// The checks: turn parsed data + structure into findings.
// Every finding: { level: 'error' | 'warning' | 'info' | 'ok', section, title, detail }

import {
  parseFormula, formatFormula, formulasEqual, addFormulas, parseAdduct, ionMz, ISOTOPE_MASS,
} from './formula.js';
import {
  segment, splitNmrHeader, parseProtonData, parsePeakList, parseHRMS, expectedJCount, decimalsOf,
} from './parse.js';
import { analyzeSmiles, compareStructures } from './structure.js';

export const DEFAULTS = { ppmTol: 5, jTol: 0.3 };

const f2 = x => x.toFixed(4);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Run all checks.
 * @param {object} input { text, smiles?, formula?, options? }
 * @param {object|null} RDKit initialised RDKit.js module (needed only when smiles is given)
 */
export function runChecks(input, RDKit = null) {
  const opt = { ...DEFAULTS, ...(input.options || {}) };
  const F = [];
  const add = (level, section, title, detail = '') => F.push({ level, section, title, detail });

  // ---------- Structure ----------
  let struct = null, compound = null;
  if (input.smiles && input.smiles.trim()) {
    if (!RDKit) add('warning', 'Structure', 'RDKit is not loaded, structure checks skipped');
    else {
      try {
        struct = analyzeSmiles(RDKit, input.smiles.trim());
        compound = struct.formula;
      } catch (e) {
        add('error', 'Structure', 'Could not read the SMILES', e.message);
      }
    }
  }
  if (input.formula && input.formula.trim()) {
    try {
      const given = parseFormula(input.formula);
      if (compound && !formulasEqual(given, compound)) {
        add('error', 'Structure', 'Formula does not match the structure',
          `You entered ${formatFormula(given)}, the SMILES gives ${formatFormula(compound)}.`);
      }
      if (!compound) compound = given;
    } catch (e) {
      add('error', 'Structure', 'Could not read the formula', e.message);
    }
  }
  // Name (via OPSIN) vs. structure
  if (input.nameSmiles && struct && RDKit) {
    const cmp = compareStructures(RDKit, input.nameSmiles, struct.smiles);
    const nm = input.name ? `"${input.name}"` : 'The name';
    if (cmp.result === 'same') add('ok', 'Structure', 'Name and structure describe the same compound');
    else if (cmp.result === 'stereo') {
      const why = cmp.stereoA && !cmp.stereoB ? 'The name specifies stereochemistry that the structure lacks.'
        : !cmp.stereoA && cmp.stereoB ? 'The structure has stereochemistry but the name has no stereodescriptor (fine for a racemate if the drawing says so).'
        : 'Both specify stereochemistry, but differently (e.g. R vs S).';
      add('warning', 'Structure', 'Name and structure differ only in stereochemistry', why);
    } else if (cmp.result === 'different') {
      let detail = '';
      try {
        const nf = analyzeSmiles(RDKit, input.nameSmiles).formula;
        detail = `${nm} gives ${formatFormula(nf)} (${input.nameSmiles}); the structure is ${formatFormula(struct.formula)}.`;
      } catch { /* ignore */ }
      add('error', 'Structure', 'Name and structure describe different compounds', detail);
    }
  }
  if (struct && struct.fragments > 1) {
    add('info', 'Structure', `Structure has ${struct.fragments} components (salt or solvate)`,
      'H, C and HRMS checks use the full formula; for HRMS the charged component alone is also tried as M.');
  }

  // ---------- Sections ----------
  const sections = segment(input.text || '');
  if (!sections.length) {
    add('warning', 'General', 'No data sections recognised',
      'Expected headers such as "1H NMR", "13C NMR", "19F NMR" or "HRMS".');
  }
  const parsed = { H: [], C: [], F: [], P: [], HRMS: [] };
  for (const s of sections) {
    if (s.type === '1H') {
      const h = splitNmrHeader(s.header);
      parsed.H.push({ ...h, signals: parseProtonData(h.data) });
    } else if (['13C', '19F', '31P'].includes(s.type)) {
      const h = splitNmrHeader(s.header);
      const key = s.type === '13C' ? 'C' : s.type === '19F' ? 'F' : 'P';
      parsed[key].push({ ...h, peaks: parsePeakList(h.data) });
    } else if (s.type === 'HRMS') {
      parsed.HRMS.push({ raw: s.raw, ...parseHRMS(s.header) });
    }
  }

  // No structure or formula given: derive the compound formula from the HRMS ion (clearly flagged).
  let fromHRMS = false;
  if (!compound) {
    for (const m of parsed.HRMS) {
      const a = m.adductRaw ? parseAdduct(m.adductRaw) : null;
      if (!m.formulaRaw || !a) continue;
      try {
        const f = addFormulas(parseFormula(m.formulaRaw), a.add, -1);
        if (Object.values(f).every(v => v > 0) && f.C) {
          compound = f; fromHRMS = true;
          add('info', 'Structure', `No structure given: using ${formatFormula(f)} from the HRMS ion formula`,
            'The H count is checked against this formula. Give a structure or name for the full checks.');
          break;
        }
      } catch { /* unreadable formula */ }
    }
  }

  for (const h of parsed.H) checkProton(h, compound, struct, opt, add);
  for (const c of parsed.C) checkCarbon(c, compound, struct, add);
  for (const f of parsed.F) checkHetero(f, '19F', 'F', struct ? struct.fluorineEnv : null, compound, add);
  for (const p of parsed.P) checkHetero(p, '31P', 'P', struct ? struct.phosphorusEnv : null, compound, add);
  for (const m of parsed.HRMS) checkHRMS(m, fromHRMS ? null : compound, struct, opt, add);
  checkCrossSection(parsed, add);

  return { findings: F, structure: struct, compound, compoundFromHRMS: fromHRMS, parsed };
}

// ---------- ¹H ----------
function checkProton(h, compound, struct, opt, add) {
  const S = '1H NMR';
  const commas = h.data.match(/(?<![\d.,])\d{1,2},\d{2}(?![\d.])/g);
  if (commas) {
    add('error', S, `Decimal comma instead of a point: ${commas.join(', ')}`, 'Probably a typo; it was read as a decimal point for the other checks.');
    h = { ...h, signals: parseProtonData(h.data.replace(/(?<![\d.,])(\d{1,2}),(\d{2})(?![\d.])/g, '$1.$2')) };
  }
  const sig = h.signals;
  if (!sig.length) { add('warning', S, 'No signals could be read', 'Expected entries like "7.26 (d, J = 8.0 Hz, 2H)".'); return; }

  // Integrations
  const noInt = sig.filter(s => s.nH === null);
  if (noInt.length) add('warning', S, `${plural(noInt.length, 'signal')} without an integration`, noInt.map(s => s.raw).join('; '));
  const sum = sig.reduce((a, s) => a + (s.nH || 0), 0);
  if (compound) {
    const expH = compound.H || 0;
    const diff = Math.round((expH - sum) * 100) / 100;
    const exch = struct ? struct.exchangeableH : null;
    if (diff === 0) add('ok', S, `Integrations sum to ${sum} H, matching the formula`);
    else if (diff > 0 && exch !== null && diff <= exch) {
      add('info', S, `Integrations sum to ${sum} H; formula has ${expH} H`,
        `The ${plural(diff, 'missing proton')} could be OH/NH/SH (${exch} exchangeable in the structure). Fine if not observed, but consider stating it.`);
    } else {
      add('error', S, `Integrations sum to ${sum} H, but the formula has ${expH} H`,
        diff > 0 ? `${plural(diff, 'proton')} missing.` : `${plural(-diff, 'proton')} too many.`);
    }
  }

  // Multiplicity vs number of J values
  for (const s of sig) {
    const k = expectedJCount(s.code);
    const n = s.J.length;
    if (k === null) continue;
    if (k === 0 && n > 0) {
      if (s.code === 's') add('warning', S, `Singlet with a coupling constant at δ ${s.shiftRaw.join('-')}`, s.raw);
      else add('info', S, `Multiplet with a J value at δ ${s.shiftRaw.join('-')}`, `${s.raw}. Usually "m" is given without J; use a defined multiplicity if J was measured.`);
    } else if (k > 0 && n === 0) {
      add('error', S, `"${s.code}" without a coupling constant at δ ${s.shiftRaw.join('-')}`, s.raw);
    } else if (k > 0 && n !== k) {
      add('warning', S, `"${s.code}" needs ${plural(k, 'J value')}, ${n} given at δ ${s.shiftRaw.join('-')}`, s.raw);
    }
    if (s.code && /^d+$/.test(s.code) && n === k && k > 1) {
      const vals = s.J.map(j => j.value);
      for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) {
        if (Math.abs(vals[i] - vals[j]) < 0.05) {
          add('info', S, `"${s.code}" with two identical J values at δ ${s.shiftRaw.join('-')}`, `${s.raw}. Two equal couplings normally appear as a triplet-type pattern.`);
          i = vals.length; break;
        }
      }
    }
  }

  // J partners
  const hasF = compound && (compound.F || 0) > 0;
  const hasP = compound && (compound.P || 0) > 0;
  const all = [];
  sig.forEach((s, i) => s.J.forEach(j => all.push({ i, v: j.value, raw: j.raw, s })));
  const lonely = all.filter(a => !all.some(b => b.i !== a.i && Math.abs(b.v - a.v) <= opt.jTol));
  if (all.length && !lonely.length) add('ok', S, 'Every coupling constant has a partner signal');
  else if (lonely.length) {
    add('info', S, `${plural(lonely.length, 'coupling constant')} without a matching partner (±${opt.jTol} Hz)`,
      lonely.map(l => `J = ${l.raw} Hz at δ ${l.s.shiftRaw.join('-')}`).join('; ') +
      (sig.some(x => x.code === 'm' || x.code === null)
        ? '. Probably the partners are reported as multiplets'
        : '. No multiplets to explain it') + (hasF || hasP ? ', or the coupling is to ' + [hasF && '¹⁹F', hasP && '³¹P'].filter(Boolean).join('/') : '') + '. Worth a quick look for typos.');
  }

  // Order, ranges, decimals, plausibility
  const firsts = sig.map(s => Math.max(s.shift, s.shiftEnd ?? -Infinity));
  if (firsts.some((v, i) => i > 0 && v > firsts[i - 1] + 1e-9)) add('info', S, 'Signals are not listed in descending order of shift');
  const lowHigh = sig.filter(s => s.shiftEnd !== null && s.shiftEnd > s.shift);
  if (lowHigh.length) add('info', S, `${plural(lowHigh.length, 'range')} written low-to-high`, lowHigh.map(s => s.shiftRaw.join('-')).join(', ') + '. Most journals list ranges high-to-low, consistent with the listing order.');
  const badDec = sig.flatMap(s => s.shiftRaw).filter(r => decimalsOf(r) !== 2);
  if (badDec.length) add('info', S, `${plural(badDec.length, 'shift')} not given to two decimals`, badDec.join(', '));
  const badJ = sig.flatMap(s => s.J).filter(j => decimalsOf(j.raw) !== 1);
  if (badJ.length) add('info', S, `${plural(badJ.length, 'J value')} not given to one decimal`, badJ.map(j => j.raw).join(', '));
  const odd = sig.filter(s => s.shift < -1 || s.shift > 16);
  if (odd.length) add('warning', S, 'Shift outside the usual ¹H range (−1 to 16 ppm)', odd.map(s => s.raw).join('; '));

  // Environments (information only)
  if (struct) {
    const env = struct.protonEnv.length;
    const hetero = struct.protonEnv.filter(g => g.onHetero).length;
    let detail = `Constitutionally distinct H environments: ${env}${hetero ? ` (${hetero} on O/N/S)` : ''}. Expected integrations by symmetry: ${struct.protonEnv.map(g => g.nH).sort((a, b) => b - a).join(', ')}.`;
    if ((struct.stereoCenters > 0 || struct.hasStereo) && struct.ch2Count > 0) detail += ' The structure is stereogenic, so CH₂ protons may be diastereotopic and give extra signals.';
    detail += ' Overlap reduces, and diastereotopicity increases, the observed count; this is for orientation only.';
    add('info', S, `${plural(sig.length, 'signal')} reported, ${env} H environments in the structure`, detail);
  }
}

// ---------- ¹³C ----------
function checkCarbon(c, compound, struct, add) {
  const S = '13C NMR';
  const pk = c.peaks;
  if (!pk.length) { add('warning', S, 'No peaks could be read'); return; }
  const hasF = compound && (compound.F || 0) > 0;
  const hasP = compound && (compound.P || 0) > 0;

  if (struct) {
    const exp = struct.carbonEnv.length;
    const max = Math.max(struct.carbonEnvMax || exp, exp);
    const n = pk.length;
    const range = max > exp ? `${exp}–${max}` : `${exp}`;
    if (n >= exp && n <= max) {
      add('ok', S, `${n} peaks reported, matching ${range} carbon environments` + (max > exp ? ' (diastereotopic carbons counted)' : ''));
    } else if (n < exp) {
      add('info', S, `${n} peaks reported, ${range} carbon environments expected`,
        `${plural(exp - n, 'peak')} fewer. Normal if signals overlap or quaternary carbons were not observed; consider annotating overlapping peaks (e.g. "(2C)") or noting missing ones.`);
    } else {
      const why = [];
      if (hasF) why.push('C–F coupling lines listed separately');
      if (hasP) why.push('C–P coupling lines listed separately');
      if (struct.stereoCenters > 1) why.push('a diastereomer mixture');
      why.push('rotamers', 'an impurity or solvent', 'a copy-paste error');
      add('warning', S, `${n} peaks reported, but the structure has at most ${max} carbon environments`,
        `Check for ${why.join(', ')}.`);
    }
  }
  if (compound && compound.C) {
    const annotated = pk.some(p => /\d\s*C\b/.test(p.inner));
    const total = pk.reduce((a, p) => a + p.count, 0);
    if (annotated && total > compound.C) add('warning', S, `Peak annotations add up to ${total} C, but the formula has ${compound.C} C`);
  }

  const seen = new Map();
  for (const p of pk) { const k = p.shiftRaw[0]; seen.set(k, (seen.get(k) || 0) + 1); }
  const dups = [...seen].filter(([, v]) => v > 1).map(([k]) => k);
  if (dups.length) add('warning', S, `Same shift listed more than once: ${dups.join(', ')}`, 'Possible copy-paste duplicate. If two carbons coincide, list once and annotate "(2C)".');

  const shifts = pk.map(p => p.shift);
  if (shifts.some((v, i) => i > 0 && v > shifts[i - 1] + 1e-9)) add('info', S, 'Peaks are not listed in descending order of shift');
  const odd = pk.filter(p => p.shift < -10 || p.shift > 240);
  if (odd.length) add('warning', S, 'Shift outside the usual ¹³C range (−10 to 240 ppm)', odd.map(p => p.raw).join('; '));
  const decs = new Set(pk.map(p => decimalsOf(p.shiftRaw[0])));
  if (decs.size > 1) {
    const maxDec = Math.max(...decs);
    const precise = pk.filter(p => decimalsOf(p.shiftRaw[0]) === maxDec);
    const justified = precise.every(p => pk.some(q => q !== p && Math.abs(q.shift - p.shift) < 0.1));
    if (!justified) add('info', S, 'Mixed number of decimals in the peak list', 'Use one decimal (or two) consistently; extra decimals are fine for resolving close peaks.');
  }

  if (hasF) {
    const coupled = pk.filter(p => p.code && p.code !== 's' && p.J.length);
    if (!coupled.length) add('info', S, 'The compound contains fluorine but no C–F couplings are reported', 'Carbons near F usually appear as d/q with J(C–F); journals expect these to be given.');
    for (const p of pk) {
      if (p.code === 'q' && p.J.length && hasF && (compound.F || 0) < 3) {
        add('warning', S, `Quartet at δ ${p.shiftRaw[0]} but fewer than three F atoms in the formula`, p.raw);
      }
    }
  }
}

// ---------- ¹⁹F / ³¹P ----------
function checkHetero(sec, S, el, env, compound, add) {
  const label = `${S} NMR`;
  const pk = sec.peaks;
  if (compound && !(compound[el] > 0)) { add('error', label, `${S} data given, but the formula contains no ${el}`); return; }
  if (!pk.length) { add('warning', label, 'No peaks could be read'); return; }
  if (env) {
    if (pk.length > env.length) add('warning', label, `${pk.length} peaks reported, ${env.length} ${el} environments in the structure`, 'Check for diastereomers, rotamers or an impurity.');
    else if (pk.length < env.length) add('info', label, `${pk.length} peaks reported, ${env.length} ${el} environments in the structure`, 'Fewer peaks: overlap or a missing signal.');
    else add('ok', label, `${pk.length} peak${pk.length === 1 ? '' : 's'}, matching the ${el} environments`);
  }
}

// ---------- HRMS ----------
function checkHRMS(m, compound, struct, opt, add) {
  const S = 'HRMS';
  if (!m.formulaRaw) add('warning', S, 'No ion formula found', 'Expected e.g. "calcd for C10H13O2 [M+H]+".');
  if (m.calc === null) add('warning', S, 'No calculated m/z found');
  if (m.found === null) add('warning', S, 'No found m/z found');

  const adduct = m.adductRaw ? parseAdduct(m.adductRaw) : null;
  if (m.adductRaw && !adduct) add('warning', S, `Could not interpret the ion label "${m.adductRaw}"`);
  if (!m.adductRaw) add('info', S, 'No ion type given', 'State the ion, e.g. [M+H]+ or [M+Na]+. A charge of +1 is assumed.');
  const z = adduct ? adduct.charge : 1;

  let ion = null;
  if (m.formulaRaw) {
    try { ion = parseFormula(m.formulaRaw); } catch (e) { add('error', S, 'Could not read the ion formula', e.message); }
  }

  // 1) Does the ion formula match the compound + adduct? Determine the correct ion formula.
  let expectedIon = null;
  if (compound && adduct) {
    const candidates = [{ f: compound, note: '' }];
    if (struct && struct.components.length > 1) {
      for (const c of struct.components) if (c.charge !== 0) candidates.push({ f: c.formula, note: ' (charged component)' });
    }
    const valid = candidates.filter(c => Object.values(addFormulas(c.f, adduct.add)).every(v => v >= 0));
    const match = ion && valid.find(c => formulasEqual(addFormulas(c.f, adduct.add), ion));
    if (match) {
      expectedIon = ion;
      add('ok', S, `Ion formula ${formatFormula(ion)} matches the structure${match.note} as ${adduct.label}`);
    } else if (valid.length) {
      // for salts prefer the charged component
      const pick = valid.find(c => c.note) || valid[0];
      expectedIon = addFormulas(pick.f, adduct.add);
      if (ion) {
        const commons = { '[M+H]+': { H: 1 }, '[M+Na]+': { Na: 1 }, '[M+K]+': { K: 1 }, '[M+NH4]+': { N: 1, H: 4 }, '[M]+': {}, '[M-H]-': { H: -1 } };
        let other = null;
        for (const [lab, a] of Object.entries(commons)) {
          if (formulasEqual(addFormulas(compound, a), ion)) { other = lab; break; }
        }
        const exp = formatFormula(expectedIon);
        if (other === '[M]+' && adduct.label !== '[M]+') {
          add('error', S, `Ion formula ${formatFormula(ion)} is the neutral compound, not the ${adduct.label} ion`, `Expected ${exp}.`);
        } else if (other) {
          const otherSign = other.endsWith('-') ? -1 : 1;
          if (Math.sign(z) === otherSign) {
            // Only the label is wrong: formula, calc and found are judged against the written ion.
            expectedIon = ion;
            add('error', S, `Ion label ${adduct.label} should be ${other}`, `The formula ${formatFormula(ion)} is the compound as ${other}. Correct the label; the m/z values are checked for ${other} below.`);
          } else {
            add('error', S, `Ion formula ${formatFormula(ion)} corresponds to ${other}, but the label says ${adduct.label}`, `For ${adduct.label} expected ${exp}.`);
          }
        } else {
          add('error', S, `Ion formula ${formatFormula(ion)} does not match the compound`, `Compound ${formatFormula(compound)} as ${adduct.label} gives ${exp}.`);
        }
      }
    }
  }

  // 2) Is the calculated value right for the stated formula (or the correct one)?
  const refIon = expectedIon || ion;
  let trueCalc = refIon ? ionMz(refIon, z, true) : null;
  if (ion && m.calc !== null) {
    const tol = 0.5 * Math.pow(10, -decimalsOf(m.calcRaw)) + 1e-7;
    const near = (target) => Math.abs(m.calc - target) <= tol;
    const forStated = { withE: ionMz(ion, z, true), noE: ionMz(ion, z, false) };
    const forRef = { withE: ionMz(refIon, z, true), noE: ionMz(refIon, z, false) };
    const statedOk = formulasEqual(ion, refIon);
    const sign = z > 0 ? '⁺' : '⁻';
    if (near(forRef.withE)) {
      add('ok', S, `Calculated m/z ${m.calcRaw} is correct for ${formatFormula(refIon)}${sign} (electron mass included)`);
      if (!statedOk) add('info', S, 'The calculated value fits the correct ion, so only the written formula needs fixing');
    } else if (near(forRef.noE)) {
      add('info', S, `Calculated m/z ${m.calcRaw} ignores the electron mass`,
        `With the electron mass it is ${f2(forRef.withE)} (difference ${(Math.abs(forRef.withE - forRef.noE) * 1000).toFixed(2)} mDa). Accepted by many journals, but correcting it is better practice.`);
      if (!statedOk) add('info', S, 'The calculated value fits the correct ion, so only the written formula needs fixing');
    } else if (!statedOk && (near(forStated.withE) || near(forStated.noE))) {
      add('error', S, `Calculated m/z ${m.calcRaw} was computed for the wrong formula ${formatFormula(ion)}`,
        `For ${formatFormula(refIon)}${sign} it is ${f2(forRef.withE)}.`);
    } else {
      let explained = false;
      for (const [el, d, iso] of [['Br', 80.9162906 - ISOTOPE_MASS.Br, '⁸¹Br'], ['Cl', 36.96590259 - ISOTOPE_MASS.Cl, '³⁷Cl']]) {
        for (let k = 1; k <= (refIon[el] || 0) && !explained; k++) {
          for (const base of [forRef.withE, forRef.noE]) {
            if (near(base + k * d / Math.abs(z))) {
              add('info', S, `Calculated m/z corresponds to the isotopologue with ${k} × ${iso}`, 'Fine if that peak was measured; say so in the text.');
              explained = true; trueCalc = forRef.withE + k * d / Math.abs(z);
              break;
            }
          }
        }
        if (explained) break;
      }
      if (!explained) {
        add('error', S, `Calculated m/z ${m.calcRaw} is wrong for ${formatFormula(refIon)}${sign}`,
          `Correct value: ${f2(forRef.withE)} (or ${f2(forRef.noE)} without the electron mass). Difference: ${((m.calc - forRef.withE) * 1000).toFixed(1)} mDa.`);
      }
    }
  }

  // 3) Found vs the correct calculated value
  if (m.found !== null && (trueCalc !== null || m.calc !== null)) {
    const ref = trueCalc ?? m.calc;
    const dppm = (m.found - ref) / ref * 1e6;
    const dmda = (m.found - ref) * 1000;
    const msg = `Δ = ${dmda.toFixed(1)} mDa (${dppm.toFixed(1)} ppm) vs. ${f2(ref)}${refIon ? ` for ${formatFormula(refIon)}` : ''}`;
    if (Math.abs(dppm) <= opt.ppmTol) add('ok', S, `Found ${m.foundRaw} within ${opt.ppmTol} ppm`, msg);
    else add('error', S, `Found ${m.foundRaw} is outside ${opt.ppmTol} ppm of the correct calculated value`, msg);
    if (m.calc !== null && m.found === m.calc) add('info', S, 'Found value is identical to the calculated value', 'Possible, but double-check that the measured value was entered.');
    if (decimalsOf(m.foundRaw) < 4) add('info', S, 'Found value has fewer than four decimals');
  }
}

// ---------- Cross-section ----------
function checkCrossSection(parsed, add) {
  const H = parsed.H[0], C = parsed.C[0], Fl = parsed.F[0];
  const ratio = { C: 0.25145, F: 0.94077, P: 0.40481 };
  if (H && H.freq) {
    for (const [k, sec, name] of [['C', C, '13C'], ['F', Fl, '19F'], ['P', parsed.P[0], '31P']]) {
      if (sec && sec.freq) {
        const exp = H.freq * ratio[k];
        if (Math.abs(sec.freq - exp) / exp > 0.03) {
          add('warning', 'General', `${name} frequency ${sec.freq} MHz does not fit ¹H at ${H.freq} MHz`, `Expected about ${Math.round(exp)} MHz on the same spectrometer. Fine if a different instrument was used.`);
        }
      }
    }
  }
  const SYN = { 'chloroform-d': 'cdcl3', 'chloroform-d1': 'cdcl3', 'cdcl3': 'cdcl3', 'dmso-d6': 'dmso-d6', '(cd3)2so': 'dmso-d6',
    'methanol-d4': 'cd3od', 'cd3od': 'cd3od', 'acetone-d6': 'acetone-d6', '(cd3)2co': 'acetone-d6', 'benzene-d6': 'c6d6', 'c6d6': 'c6d6',
    'acetonitrile-d3': 'cd3cn', 'cd3cn': 'cd3cn', 'deuteriumoxide': 'd2o', 'd2o': 'd2o', 'dichloromethane-d2': 'cd2cl2', 'cd2cl2': 'cd2cl2' };
  const raw = [H, C, Fl, parsed.P[0]].filter(x => x && x.solvent).map(x => x.solvent.trim());
  const key = r => { const k = r.replace(/\s/g, '').toLowerCase(); return SYN[k] || k; };
  if (new Set(raw.map(key)).size > 1) add('info', 'General', 'Different solvents across NMR experiments', `${[...new Set(raw)].join(' / ')}. Fine if intended; otherwise a copy-paste slip.`);
  else if (new Set(raw).size > 1) add('info', 'General', `Same solvent written in different ways: ${[...new Set(raw)].join(' / ')}`, 'Use one notation throughout.');
}
