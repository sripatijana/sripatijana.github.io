import { runChecks, formatFormula, monoisotopicMass } from './core/index.js';
import { EXAMPLES } from './examples.js';
import { setupOcsr, imageState } from './ocsr.js';
import { setupName, resolveName, nameState } from './name.js';
import { setupBatch } from './batch.js';

const $ = id => document.getElementById(id);
let RDKit = null;
let last = null;
let smilesSource = 'typed'; // 'typed' | 'image' | 'name'

const LEVEL = {
  error: { label: 'Error', order: 0 },
  warning: { label: 'Check', order: 1 },
  info: { label: 'Note', order: 2 },
  ok: { label: 'Passed', order: 3 },
};
const SECTION_ORDER = ['Structure', '1H NMR', '13C NMR', '19F NMR', '31P NMR', 'HRMS', 'General'];

async function loadRDKit() {
  try {
    RDKit = await window.initRDKitModule({
      locateFile: () => 'https://cdn.jsdelivr.net/npm/@rdkit/rdkit@2026.9.2/dist/RDKit_minimal.wasm',
    });
    $('status').textContent = `Ready. RDKit ${RDKit.version()} loaded.`;
  } catch (e) {
    $('status').textContent = 'RDKit could not be loaded (offline?). Formula-based checks still work.';
    $('status').classList.add('warn');
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function run() {
  // Resolve the compound name first (if any); use it as the structure when no SMILES is given.
  if ($('name').value.trim()) {
    await resolveName();
    if (nameState.smiles && (!$('smiles').value.trim() || smilesSource === 'name')) {
      $('smiles').value = nameState.smiles; smilesSource = 'name';
    }
  }
  const input = {
    text: $('data').value,
    smiles: $('smiles').value,
    formula: $('formula').value,
    name: $('name').value.trim(),
    nameSmiles: smilesSource !== 'name' ? nameState.smiles : '',
    options: { ppmTol: parseFloat($('ppm').value) || 5, jTol: parseFloat($('jtol').value) || 0.3 },
  };
  if (input.smiles.trim() && !RDKit) {
    $('status').textContent = 'RDKit is still loading. Try again in a moment.';
    return;
  }
  last = runChecks(input, RDKit);
  if (smilesSource === 'name' && input.smiles.trim()) {
    last.findings.unshift({ level: 'info', section: 'Structure', title: 'Structure taken from the compound name (OPSIN)',
      detail: 'Add the drawing (image or SMILES) as well to check that name and structure agree.' });
  } else if (input.name && nameState.error && nameState.error !== 'no server' && nameState.error !== 'server unreachable') {
    last.findings.unshift({ level: 'warning', section: 'Structure', title: 'The compound name could not be interpreted',
      detail: `OPSIN: ${nameState.error} Check the name for typos, or ignore this for trivial names and abbreviations.` });
  }
  if (smilesSource === 'image' && imageState.active && !imageState.confirmed && input.smiles.trim()) {
    last.findings.unshift({ level: 'warning', section: 'Structure', title: 'Structure from the image is not confirmed yet',
      detail: 'Compare the recognised drawing with your image and tick the box. All checks depend on the structure being right.' });
  }
  render();
}

function render() {
  if (!last) return;
  const { findings, structure, compound } = last;

  // Structure card
  const sbox = $('structure');
  if (structure && structure.svg) {
    sbox.classList.remove('empty');
    sbox.innerHTML = `<div class="svg">${structure.svg}</div>` + compoundFacts(compound, structure);
  } else if (compound) {
    sbox.classList.remove('empty');
    sbox.innerHTML = compoundFacts(compound, null);
  } else {
    sbox.classList.add('empty');
    sbox.textContent = 'No structure or formula given: only internal checks run.';
  }

  // Summary
  const n = l => findings.filter(f => f.level === l).length;
  const word = { error: ['error', 'errors'], warning: ['to check', 'to check'], info: ['note', 'notes'], ok: ['passed', 'passed'] };
  $('summary').innerHTML = ['error', 'warning', 'info', 'ok']
    .map(l => `<span class="pill ${l}">${n(l)} ${word[l][n(l) === 1 ? 0 : 1]}</span>`).join('');

  // Findings grouped by section
  const showOk = $('show-ok').checked, showInfo = $('show-info').checked;
  const visible = findings.filter(f => (showOk || f.level !== 'ok') && (showInfo || f.level !== 'info'));
  const bySec = new Map();
  for (const f of visible) { if (!bySec.has(f.section)) bySec.set(f.section, []); bySec.get(f.section).push(f); }
  const secs = [...bySec.keys()].sort((a, b) => (SECTION_ORDER.indexOf(a) + 99) % 99 - (SECTION_ORDER.indexOf(b) + 99) % 99);
  $('results').innerHTML = secs.map(sec => {
    const items = bySec.get(sec).sort((a, b) => LEVEL[a.level].order - LEVEL[b.level].order);
    return `<h3>${esc(sec)}</h3><ul>` + items.map(f => `
      <li class="f ${f.level}">
        <span class="badge">${LEVEL[f.level].label}</span>
        <div><div class="t">${esc(f.title)}</div>${f.detail ? `<div class="d">${esc(f.detail)}</div>` : ''}</div>
      </li>`).join('') + '</ul>';
  }).join('') || '<p class="empty-msg">Nothing to show with the current filters.</p>';
  $('copy').disabled = false;
}

function compoundFacts(f, s) {
  const rows = [['Formula', formatFormula(f)]];
  try { rows.push(['Monoisotopic mass', monoisotopicMass(f).toFixed(4)]); } catch { /* unknown element */ }
  if (s) {
    rows.push(['C environments', s.carbonEnv.length]);
    rows.push(['H environments', `${s.protonEnv.length} (${s.exchangeableH} exchangeable H)`]);
    if (s.fluorineEnv.length) rows.push(['F environments', s.fluorineEnv.length]);
    if (s.stereoCenters) rows.push(['Stereocentres', s.stereoCenters]);
  }
  return `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

function reportText() {
  const lines = ['ChemDataProof report', ''];
  if (last.compound) lines.push(`Compound: ${formatFormula(last.compound)}${$('smiles').value.trim() ? '  ' + $('smiles').value.trim() : ''}`, '');
  for (const f of last.findings) {
    lines.push(`[${LEVEL[f.level].label}] ${f.section}: ${f.title}${f.detail ? ' (' + f.detail + ')' : ''}`);
  }
  return lines.join('\n');
}

function loadExample(key) {
  const ex = EXAMPLES[key];
  imageState.active = false; document.getElementById('ocsr').hidden = true;
  smilesSource = 'typed'; $('name').value = ex.name || ''; nameState.auto = false;
  $('smiles').value = ex.smiles; $('formula').value = ex.formula || ''; $('data').value = ex.text;
  run();
}

$('run').addEventListener('click', run);
$('ex-good').addEventListener('click', () => loadExample('clean'));
$('ex-bad').addEventListener('click', () => loadExample('mistakes'));
$('show-ok').addEventListener('change', render);
$('show-info').addEventListener('change', render);
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(reportText()); $('copy').textContent = 'Copied'; }
  catch { $('copy').textContent = 'Copy failed'; }
  setTimeout(() => { $('copy').textContent = 'Copy report'; }, 1500);
});
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run(); });

setupOcsr({
  getRDKit: () => RDKit,
  onSmiles: smi => { $('smiles').value = smi; $('formula').value = ''; smilesSource = 'image'; },
});
setupName({});
$('smiles').addEventListener('input', () => { smilesSource = imageState.active ? 'image' : 'typed'; });
$('name-go').addEventListener('click', async () => {
  const st = await resolveName();
  if (st.smiles) { $('smiles').value = st.smiles; smilesSource = 'name'; $('formula').value = ''; }
});
$('ocsr-ok').addEventListener('change', () => { if (last) run(); });

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('tab-single').hidden = name !== 'single';
  $('tab-batch').hidden = name !== 'batch';
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

setupBatch({
  getRDKit: () => RDKit,
  openInSingle: (entry, smiles) => {
    showTab('single');
    imageState.active = false; $('ocsr').hidden = true; $('cropper').hidden = true;
    $('name').value = entry.name || ''; nameState.auto = false;
    $('data').value = (entry.title ? entry.title + '\n' : '') + entry.text;
    $('smiles').value = smiles || ''; $('formula').value = '';
    smilesSource = smiles ? 'name' : 'typed';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    run();
  },
});

loadRDKit();
