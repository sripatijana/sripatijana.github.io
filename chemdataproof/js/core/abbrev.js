// Expand common chemistry abbreviations in compound names so that OPSIN can read them,
// e.g. "4-OMe-benzaldehyde" -> "4-methoxybenzaldehyde", "2-naphthyl-OTf" -> "2-naphthyl triflate".
// OPSIN already understands many protecting-group words (Boc, Cbz, Fmoc, tosyl, triflate, TMS, "TFA salt");
// this only covers what it does not.

// Substituent abbreviations -> IUPAC prefixes
export const SUBSTITUENTS = {
  // alkyl / aryl
  Me: 'methyl', Me2: 'dimethyl', Me3: 'trimethyl', Et: 'ethyl', Et2: 'diethyl', Pr: 'propyl', nPr: 'propyl', 'n-Pr': 'propyl', iPr: 'isopropyl', 'i-Pr': 'isopropyl',
  Bu: 'butyl', nBu: 'butyl', 'n-Bu': 'butyl', tBu: 'tert-butyl', 't-Bu': 'tert-butyl', iBu: 'isobutyl', sBu: 'sec-butyl',
  Ph: 'phenyl', Bn: 'benzyl', Mes: '(2,4,6-trimethylphenyl)', PMP: '(4-methoxyphenyl)', PMB: '(4-methoxybenzyl)',
  Tr: 'trityl', Trt: 'trityl', Cy: 'cyclohexyl',
  // acyl / sulfonyl
  Ac: 'acetyl', Bz: 'benzoyl', Piv: '(2,2-dimethylpropanoyl)', Ts: 'tosyl', Ms: '(methylsulfonyl)',
  Tf: '((trifluoromethyl)sulfonyl)', Ns: '((4-nitrophenyl)sulfonyl)', Boc: '(tert-butoxycarbonyl)',
  Cbz: '((benzyloxy)carbonyl)', Alloc: '((allyloxy)carbonyl)', Troc: '((2,2,2-trichloroethoxy)carbonyl)',
  // silyl and acetal protecting groups
  TMS: '(trimethylsilyl)', TES: '(triethylsilyl)', TIPS: '(triisopropylsilyl)', TBS: '(tert-butyldimethylsilyl)',
  TBDMS: '(tert-butyldimethylsilyl)', TBDPS: '(tert-butyldiphenylsilyl)', MOM: '(methoxymethyl)',
  SEM: '((2-(trimethylsilyl)ethoxy)methyl)', THP: '(tetrahydro-2H-pyran-2-yl)',
  // boron
  Bpin: '(4,4,5,5-tetramethyl-1,3,2-dioxaborolan-2-yl)', BPin: '(4,4,5,5-tetramethyl-1,3,2-dioxaborolan-2-yl)',
  // O-, N-, S- groups
  OMe: 'methoxy', OEt: 'ethoxy', OiPr: 'isopropoxy', OtBu: 'tert-butoxy', OBn: '(benzyloxy)', OPh: 'phenoxy',
  OAc: 'acetoxy', OBz: '(benzoyloxy)', OPiv: '(pivaloyloxy)', OTf: '(((trifluoromethyl)sulfonyl)oxy)',
  OTs: '(tosyloxy)', OMs: '((methylsulfonyl)oxy)', OTBS: '((tert-butyldimethylsilyl)oxy)', TBSO: '((tert-butyldimethylsilyl)oxy)',
  OTBDMS: '((tert-butyldimethylsilyl)oxy)', OTIPS: '((triisopropylsilyl)oxy)', OTMS: '((trimethylsilyl)oxy)',
  OTBDPS: '((tert-butyldiphenylsilyl)oxy)', OMOM: '(methoxymethoxy)', OTHP: '((tetrahydro-2H-pyran-2-yl)oxy)',
  OCF3: '(trifluoromethoxy)', OCHF2: '(difluoromethoxy)', OH: 'hydroxy',
  NH2: 'amino', NHMe: '(methylamino)', NMe2: '(dimethylamino)', NEt2: '(diethylamino)', NHAc: 'acetamido',
  NHBoc: '((tert-butoxycarbonyl)amino)', NHCbz: '(((benzyloxy)carbonyl)amino)', NHTs: '(tosylamino)', NO2: 'nitro', N3: 'azido',
  SMe: '(methylthio)', SPh: '(phenylthio)', SCF3: '((trifluoromethyl)thio)', SO2Me: '(methylsulfonyl)',
  // carbon groups
  CF3: '(trifluoromethyl)', CHF2: '(difluoromethyl)', CN: 'cyano', CHO: 'formyl', COMe: 'acetyl',
  CO2Me: '(methoxycarbonyl)', CO2Et: '(ethoxycarbonyl)', CO2tBu: '(tert-butoxycarbonyl)', CO2H: 'carboxy',
  CONH2: 'carbamoyl', CCH: 'ethynyl', vinyl: 'vinyl',
  // halogens (only after a locant, see below)
  F: 'fluoro', Cl: 'chloro', Br: 'bromo', I: 'iodo',
};

const HALOGENS = new Set(['F', 'Cl', 'Br', 'I']);

// Anions / leaving groups written after the name, e.g. "2-naphthyl-OTf", "pyridinium OTf", "... · TFA"
const ESTER_SUFFIX = { OTf: 'triflate', OTs: 'tosylate', OMs: 'mesylate', OAc: 'acetate', ONf: 'nonaflate' };
const ANIONS = {
  OTf: 'triflate', TfO: 'triflate', OTs: 'tosylate', BF4: 'tetrafluoroborate', PF6: 'hexafluorophosphate',
  SbF6: 'hexafluoroantimonate', ClO4: 'perchlorate', NTf2: 'bis(trifluoromethanesulfonyl)imide', OAc: 'acetate',
  Cl: 'chloride', Br: 'bromide', I: 'iodide',
};
const SALTS = { TFA: 'TFA salt', HCl: 'hydrochloride', HBr: 'hydrobromide', TsOH: 'tosylate', MsOH: 'mesylate', H2O: '' };

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYS = Object.keys(SUBSTITUENTS).sort((a, b) => b.length - a.length).map(esc).join('|');
const MARK = '\u0001';

/**
 * Expand abbreviations. Returns { name, used: [[abbr, expansion], ...] }; name is unchanged if nothing applied.
 */
export function expandAbbreviations(input) {
  let s = String(input || '').trim();
  const used = [];

  // 1) salts and hydrates after a dot: "amine · TFA", "amine•HCl", "amine x 2 HCl"
  s = s.replace(/\s*[·•∙⋅]\s*(?:\d+\s*)?(TFA|HCl|HBr|TsOH|MsOH|H2O)\b\s*$/, (m, k) => { used.push([k, SALTS[k] || 'hydrate']); return SALTS[k] ? ' ' + SALTS[k] : ''; });
  // 2) ester/anion written as a suffix: "2-naphthyl-OTf", "phenyl OTs", "pyridinium BF4"
  s = s.replace(/[-\s](OTf|OTs|OMs|OAc|ONf)$/, (m, k) => { used.push([k, ESTER_SUFFIX[k]]); return ' ' + ESTER_SUFFIX[k]; });
  s = s.replace(/\s(TfO|BF4|PF6|SbF6|ClO4|NTf2)$/, (m, k) => { used.push([k, ANIONS[k]]); return ' ' + ANIONS[k]; });
  s = s.replace(/^(TfO|BF4|PF6)\s+(.*)$/, (m, k, rest) => { used.push([k, ANIONS[k]]); return rest + ' ' + ANIONS[k]; });
  s = s.replace(/^(Ph3P|PPh3)$/, () => { used.push(['PPh3', 'triphenylphosphane']); return 'triphenylphosphane'; });

  // 3) substituent tokens bounded by locants, hyphens, parentheses, commas or spaces
  const re = new RegExp(`(^|[\\s(\\[,\\-])(${KEYS})(?=$|[\\s)\\],\\-])`, 'g');
  s = s.replace(re, (m, pre, k, offset, whole) => {
    // halogens and very short tokens only right after a locant ("4-Cl-", "N-Me-") or inside parentheses
    const before = whole.slice(0, offset + pre.length);
    const afterLocant = /(?:\d'?|N|O|S|[α-ω])-$/.test(before) || /\(\s*$/.test(before);
    if ((HALOGENS.has(k) || k.length <= 2) && !afterLocant) return m;
    used.push([k, SUBSTITUENTS[k]]);
    let ex = SUBSTITUENTS[k];
    // "(TBSO)" -> "((tert-...)oxy)" would double the brackets: drop the expansion's own outer pair
    const next = whole[offset + m.length];
    if (pre === '(' && next === ')' && ex.startsWith('(') && ex.endsWith(')')) ex = ex.slice(1, -1);
    return pre + ex + MARK;
  });
  // "methoxy-benzaldehyde" -> "methoxybenzaldehyde"; keep hyphens before locants
  s = s.replace(new RegExp(MARK + '-(?=[a-z(])', 'g'), '').replace(new RegExp(MARK, 'g'), '');
  // "(methoxy)" -> "methoxy" when a whole parenthesis was just one simple expansion
  s = s.replace(/\(([a-z-]+)\)(?=[a-z])/g, (m, inner, off, whole) => (whole[off - 1] === '(' ? m : inner));
  return { name: s, used };
}
