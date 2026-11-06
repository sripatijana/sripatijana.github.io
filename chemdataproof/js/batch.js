// Whole-SI mode: read a .docx (or pasted section), split into compounds, check each, report.
import { runChecks, splitEntries, formatFormula } from './core/index.js';
import { serverUrl } from './ocsr.js';

const $ = id => document.getElementById(id);
const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js';
const LEVEL_LABEL = { error: 'Error', warning: 'Check', info: 'Note', ok: 'Passed' };

const state = { fileName: '', text: '', entries: [], results: [] };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.mammoth) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the Word reader'));
    document.head.appendChild(s);
  });
}

async function readDocx(file) {
  await loadScript(MAMMOTH_URL);
  const buf = await file.arrayBuffer();
  const out = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return out.value;
}

function setSource(text, name) {
  state.text = text; state.fileName = name;
  state.entries = splitEntries(text);
  const n = state.entries.length;
  $('bstatus').textContent = n
    ? `${name}: ${n} compound${n === 1 ? '' : 's'} found.`
    : `${name}: no compound entries found (expected a title line followed by NMR/HRMS data).`;
  $('brun').disabled = !n;
}

async function lookupNames(names) {
  const url = serverUrl();
  if (!url) return { error: 'No structure server is set (see "Structure server" above).' };
  try {
    const r = await fetch(`${url}/names`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) });
    if (!r.ok) throw new Error(r.statusText);
    return { results: (await r.json()).results };
  } catch {
    return { error: 'Could not reach the structure server. A sleeping Hugging Face Space can take a minute to start: try again.' };
  }
}

async function runAll(getRDKit) {
  const RDKit = getRDKit();
  if (!RDKit) { $('bstatus').textContent = 'RDKit is still loading. Try again in a moment.'; return; }
  $('brun').disabled = true;
  const entries = state.entries;
  let names = null, nameNote = '';
  if ($('buse-names').checked) {
    $('bstatus').textContent = `Reading ${entries.length} names with OPSIN…`;
    const lookup = await lookupNames(entries.map(e => e.name || ''));
    if (lookup.error) nameNote = lookup.error; else names = lookup.results;
  }
  state.results = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    $('bstatus').textContent = `Checking ${i + 1} / ${entries.length}…`;
    const nm = names ? names[i] : null;
    const smiles = nm && nm.smiles ? nm.smiles : '';
    const r = runChecks({ text: e.text, smiles }, RDKit);
    let source;
    if (smiles && r.structure) {
      source = { cls: 'good', text: `From name · ${formatFormula(r.compound)}` };
    } else if (nm && e.name && nm.error) {
      source = { cls: 'warn', text: 'Name not readable' };
      r.findings.unshift({ level: 'warning', section: 'Structure', title: 'The compound name could not be interpreted',
        detail: `OPSIN: ${nm.error} Check the name for typos; ignore this for trivial names or abbreviations.` });
    } else if (!e.name) {
      source = { cls: 'muted', text: 'No title found' };
    } else {
      source = { cls: 'muted', text: names ? 'No structure' : 'Names not looked up' };
    }
    if (!smiles && r.compoundFromHRMS) source.text += ` · ${formatFormula(r.compound)} from HRMS`;
    state.results.push({ entry: e, smiles, source, findings: r.findings });
    if (i % 5 === 4) await new Promise(res => setTimeout(res));
  }
  $('bstatus').textContent = `Done: ${entries.length} compounds checked.` + (nameNote ? ` ${nameNote}` : '');
  $('brun').disabled = false;
  render();
}

const count = (f, l) => f.filter(x => x.level === l).length;

function render() {
  $('bresults').hidden = false;
  const R = state.results;
  const withErr = R.filter(r => count(r.findings, 'error')).length;
  const withWarn = R.filter(r => !count(r.findings, 'error') && count(r.findings, 'warning')).length;
  const clean = R.length - withErr - withWarn;
  const fromName = R.filter(r => r.smiles).length;
  $('bsummary').innerHTML = `<strong>${R.length} compounds</strong>
    <span class="pill error">${withErr} with errors</span>
    <span class="pill warning">${withWarn} to check</span>
    <span class="pill ok">${clean} without problems</span>
    <span class="pill info">${fromName} / ${R.length} structures from names</span>`;
  const showOk = $('bshow-ok').checked, showInfo = $('bshow-info').checked;
  const cnt = (n, l) => `<span class="cnt ${n ? l : 'zero'}">${n}</span>`;
  $('btbody').innerHTML = R.map((r, i) => {
    const f = r.findings;
    const vis = f.filter(x => (showOk || x.level !== 'ok') && (showInfo || x.level !== 'info'))
      .sort((a, b) => ['error', 'warning', 'info', 'ok'].indexOf(a.level) - ['error', 'warning', 'info', 'ok'].indexOf(b.level));
    const open = count(f, 'error') > 0;
    return `<tr class="entry" data-i="${i}">
        <td>${r.entry.index}</td>
        <td>${r.entry.label ? `<span class="lab">${esc(r.entry.label)}</span>` : ''}${esc(r.entry.name || '(untitled entry)')}</td>
        <td><span class="src ${r.source.cls}">${esc(r.source.text)}</span></td>
        <td class="n">${cnt(count(f, 'error'), 'error')}</td>
        <td class="n">${cnt(count(f, 'warning'), 'warning')}</td>
        <td class="n">${cnt(count(f, 'info'), 'info')}</td>
        <td><button class="ghost small open" data-i="${i}">Open</button></td>
      </tr>
      <tr class="detail" data-i="${i}" ${open ? '' : 'hidden'}><td colspan="7">
        ${r.smiles ? `<div class="smi">${esc(r.smiles)}</div>` : ''}
        <ul>${vis.map(x => `<li class="f ${x.level}"><span class="badge">${LEVEL_LABEL[x.level]}</span>
          <div><div class="t">${esc(x.section)}: ${esc(x.title)}</div>${x.detail ? `<div class="d">${esc(x.detail)}</div>` : ''}</div></li>`).join('')
          || '<li class="d">Nothing to show with the current filters.</li>'}</ul>
      </td></tr>`;
  }).join('');
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function csv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['#', 'label', 'compound', 'structure', 'level', 'section', 'finding', 'detail']];
  for (const r of state.results) {
    for (const f of r.findings) rows.push([r.entry.index, r.entry.label, r.entry.name, r.source.text, f.level, f.section, f.title, f.detail]);
  }
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}

function reportHtml() {
  const date = new Date().toISOString().slice(0, 10);
  const css = `body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:30px auto;padding:0 20px;color:#1d2321}
  h1{font-size:22px;margin:0}h2{font-size:16px;margin:26px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
  .meta{color:#5d6763}.f{margin:3px 0;padding:5px 8px;border-left:3px solid;border-radius:4px}
  .error{background:#fdecea;border-color:#b42318}.warning{background:#fff4e0;border-color:#9a5b00}.info{background:#eaf2fb;border-color:#2a5d8f}
  .b{font-weight:700;font-size:11px;text-transform:uppercase;margin-right:8px}.d{color:#5d6763;font-size:13px}.ok{color:#2e7d4f}
  @media print{h2{break-after:avoid}}`;
  const body = state.results.map(r => {
    const issues = r.findings.filter(f => f.level !== 'ok');
    return `<h2>${esc(r.entry.label ? r.entry.label + ' · ' : '')}${esc(r.entry.name || '(untitled entry)')}</h2>
      <div class="meta">${esc(r.source.text)}</div>
      ${issues.length ? issues.map(f => `<div class="f ${f.level}"><span class="b">${LEVEL_LABEL[f.level]}</span>${esc(f.section)}: ${esc(f.title)}${f.detail ? `<div class="d">${esc(f.detail)}</div>` : ''}</div>`).join('') : '<p class="ok">No problems found.</p>'}`;
  }).join('');
  const n = state.results.length;
  const e = state.results.filter(r => count(r.findings, 'error')).length;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>ChemDataProof report · ${esc(state.fileName)}</title><style>${css}</style></head>
  <body><h1>ChemDataProof report</h1><p class="meta">${esc(state.fileName)} · ${date} · ${n} compounds, ${e} with errors</p>
  <p class="meta">Consistency checks only; notes are often fine. Generated by ChemDataProof.</p>${body}</body></html>`;
}

export function setupBatch({ getRDKit, openInSingle }) {
  const drop = $('bdrop');
  const take = async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { $('bstatus').textContent = 'Please choose a .docx file (save .doc files as .docx in Word first).'; return; }
    $('bstatus').textContent = `Reading ${file.name}…`;
    try { setSource(await readDocx(file), file.name); $('btext').value = ''; }
    catch (err) { $('bstatus').textContent = `Could not read ${file.name}: ${err.message}`; }
  };
  drop.addEventListener('click', () => $('bfile').click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('bfile').click(); } });
  $('bfile').addEventListener('change', e => { take(e.target.files[0]); e.target.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
  let t = null;
  $('btext').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { if ($('btext').value.trim()) setSource($('btext').value, 'Pasted text'); }, 400); });
  $('brun').addEventListener('click', () => runAll(getRDKit));
  $('bshow-ok').addEventListener('change', () => state.results.length && render());
  $('bshow-info').addEventListener('change', () => state.results.length && render());
  $('btbody').addEventListener('click', e => {
    const btn = e.target.closest('button.open');
    if (btn) { const r = state.results[+btn.dataset.i]; openInSingle(r.entry, r.smiles); return; }
    const row = e.target.closest('tr.entry');
    if (row) { const d = $('btbody').querySelector(`tr.detail[data-i="${row.dataset.i}"]`); d.hidden = !d.hidden; }
  });
  const base = () => (state.fileName || 'si').replace(/\.docx$/i, '');
  $('bcsv').addEventListener('click', () => download(`${base()}-chemdataproof.csv`, csv(), 'text/csv;charset=utf-8'));
  $('bhtml').addEventListener('click', () => download(`${base()}-chemdataproof-report.html`, reportHtml(), 'text/html;charset=utf-8'));
}
