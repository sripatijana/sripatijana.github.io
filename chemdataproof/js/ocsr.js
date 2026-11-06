// Image -> SMILES via the OCSR server, with a side-by-side confirmation step.
import { OCSR_DEFAULT_URL } from './config.js';

const $ = id => document.getElementById(id);
const KEY = 'chemdataproof.serverUrl';
const LOW_CONFIDENCE = 0.9;

export const imageState = { active: false, confirmed: false, recognised: null };

function store(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage unavailable */ } }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

export function serverUrl() {
  return ($('ocsr-url').value || '').trim().replace(/\/+$/, '');
}

function msg(html, cls = '') {
  const el = $('ocsr-msg');
  el.className = 'ocsr-msg ' + cls;
  el.innerHTML = html;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Draw the recognised structure. Prefer the molfile: it keeps the layout of the original image. */
function drawRecognised(getRDKit, smiles, molfile) {
  const RDKit = getRDKit();
  const box = $('ocsr-svg');
  if (!RDKit) { box.textContent = smiles || ''; return; }
  for (const src of [molfile, smiles]) {
    if (!src) continue;
    const mol = RDKit.get_mol(src);
    if (mol && mol.is_valid()) {
      try { box.innerHTML = mol.get_svg(300, 220); } finally { mol.delete(); }
      return;
    }
    if (mol) mol.delete();
  }
  box.innerHTML = '<span class="bad">This SMILES cannot be drawn</span>';
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

async function recognise(blob, getRDKit, onSmiles) {
  const url = serverUrl();
  $('cropper').hidden = true;
  $('ocsr').hidden = false;
  $('ocsr-img').src = URL.createObjectURL(blob);
  $('ocsr-svg').innerHTML = '<span class="spinner"></span>';
  $('ocsr-ok').checked = false;
  imageState.active = true; imageState.confirmed = false; imageState.recognised = null;

  if (!url) {
    $('ocsr-svg').innerHTML = '';
    msg('No recognition server is set. Open <b>Structure server</b> below and enter its address (see README), or type the SMILES yourself.', 'warn');
    document.querySelector('details.settings').open = true;
    return;
  }
  msg('Recognising… The first request can take up to a minute while a sleeping server starts.');
  const fd = new FormData();
  fd.append('image', blob, blob.name || 'structure.png');
  let res;
  try {
    res = await fetchWithTimeout(`${url}/predict`, { method: 'POST', body: fd }, 150000);
  } catch (e) {
    $('ocsr-svg').innerHTML = '';
    msg(`Could not reach the recognition server at <code>${esc(url)}</code>. If it is a Hugging Face Space it may still be starting: try again in a minute. You can also type the SMILES yourself.`, 'bad');
    return;
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    $('ocsr-svg').innerHTML = '';
    msg(`The server could not read this image: ${esc(detail)}`, 'bad');
    return;
  }
  const out = await res.json();
  if (!out.smiles) {
    $('ocsr-svg').innerHTML = '';
    msg('No structure was recognised. Crop the image to a single molecule and try again.', 'bad');
    return;
  }
  imageState.recognised = out.smiles;
  drawRecognised(getRDKit, out.smiles, out.molfile);
  const conf = typeof out.confidence === 'number' ? out.confidence : null;
  $('ocsr-cap').textContent = `Recognised by ${out.engine || 'OCSR'}` + (conf !== null ? ` · confidence ${conf.toFixed(2)}` : '') + (out.seconds ? ` · ${out.seconds} s` : '');
  const notes = [];
  if (conf !== null && conf < LOW_CONFIDENCE) notes.push('<b>Low confidence.</b> Compare atom by atom.');
  if (/[@\\/]/.test(out.smiles)) notes.push('Contains stereochemistry: check every wedge and hash.');
  notes.push('Compare both drawings. If something is wrong, correct the SMILES below; the right-hand drawing updates as you type.');
  msg(notes.join(' '), conf !== null && conf < LOW_CONFIDENCE ? 'warn' : '');
  onSmiles(out.smiles);
}

// ---------- Cropping ----------
let source = null;   // { blob, img }
let sel = null;      // selection in displayed pixels {x, y, w, h}

function showCropper(blob) {
  source = { blob };
  sel = null;
  $('crop-box').hidden = true;
  $('crop-go').disabled = true;
  $('crop-img').src = URL.createObjectURL(blob);
  $('ocsr').hidden = true;
  $('cropper').hidden = false;
}

function cropToBlob() {
  const img = $('crop-img');
  const sx = img.naturalWidth / img.clientWidth, sy = img.naturalHeight / img.clientHeight;
  const w = Math.round(sel.w * sx), h = Math.round(sel.h * sy);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, Math.round(sel.x * sx), Math.round(sel.y * sy), w, h, 0, 0, w, h);
  return new Promise(res => c.toBlob(b => { b.name = 'selection.png'; res(b); }, 'image/png'));
}

function setupCropper(getRDKit, onSmiles) {
  const stage = document.querySelector('.crop-stage');
  const box = $('crop-box');
  let start = null;
  const pos = e => {
    const r = $('crop-img').getBoundingClientRect();
    return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
  };
  stage.addEventListener('pointerdown', e => { start = pos(e); stage.setPointerCapture(e.pointerId); box.hidden = true; });
  stage.addEventListener('pointermove', e => {
    if (!start) return;
    const p = pos(e);
    sel = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    Object.assign(box.style, { left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' });
    box.hidden = false;
  });
  stage.addEventListener('pointerup', () => {
    start = null;
    $('crop-go').disabled = !(sel && sel.w > 10 && sel.h > 10);
  });
  $('crop-go').addEventListener('click', async () => { if (sel) recognise(await cropToBlob(), getRDKit, onSmiles); });
  $('crop-all').addEventListener('click', () => { if (source) recognise(source.blob, getRDKit, onSmiles); });
  $('crop-cancel').addEventListener('click', () => { $('cropper').hidden = true; });
  $('crop-again').addEventListener('click', e => { e.preventDefault(); if (source) { $('ocsr').hidden = true; $('cropper').hidden = false; } });
}

export function setupOcsr({ getRDKit, onSmiles }) {
  setupCropper(getRDKit, onSmiles);
  $('ocsr-url').value = load(KEY) || OCSR_DEFAULT_URL;
  $('ocsr-url').addEventListener('change', () => store(KEY, serverUrl() !== OCSR_DEFAULT_URL ? serverUrl() : ''));

  const handle = (blob) => { if (blob && blob.type.startsWith('image/')) showCropper(blob); };
  const drop = $('drop');
  drop.addEventListener('click', () => $('file').click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
  $('file').addEventListener('change', e => { handle(e.target.files[0]); e.target.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); });
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); handle(item.getAsFile()); }
  });

  $('ocsr-ok').addEventListener('change', e => { imageState.confirmed = e.target.checked; });

  // Live redraw when the user corrects the SMILES
  $('smiles').addEventListener('input', () => {
    if (!imageState.active || $('ocsr').hidden) return;
    const s = $('smiles').value.trim();
    drawRecognised(getRDKit, s, null);
    if (imageState.recognised && s !== imageState.recognised) $('ocsr-cap').textContent = 'Your corrected structure';
  });

  $('ocsr-test').addEventListener('click', async () => {
    const url = serverUrl();
    store(KEY, url !== OCSR_DEFAULT_URL ? url : '');
    const out = $('ocsr-test-msg');
    if (!url) { out.textContent = 'Enter an address first.'; return; }
    out.textContent = 'Contacting server…';
    try {
      const r = await fetchWithTimeout(`${url}/`, {}, 120000);
      const j = await r.json();
      out.textContent = j.status === 'ok' ? `Connected: ${j.engine} ${j.engine_version || ''}` : 'Server answered, but not as expected.';
    } catch {
      out.textContent = 'No answer. A sleeping Hugging Face Space can take a minute to start; try again.';
    }
  });
}
