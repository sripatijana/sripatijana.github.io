// Compound name -> structure via OPSIN on the structure server.
import { extractName } from './core/document.js';
import { serverUrl } from './ocsr.js';
import { expandAbbreviations } from './core/abbrev.js';

const $ = id => document.getElementById(id);
export { extractName };
export const nameState = { name: '', smiles: '', error: '', auto: false };

function msg(text, cls = '') {
  const el = $('name-msg');
  el.className = 'hint ' + cls;
  el.textContent = text;
}

export async function resolveName() {
  const name = $('name').value.trim();
  if (!name) { Object.assign(nameState, { name: '', smiles: '', error: '' }); msg(''); return nameState; }
  if (nameState.name === name && (nameState.smiles || nameState.error)) return nameState;
  const url = serverUrl();
  if (!url) {
    Object.assign(nameState, { name, smiles: '', error: 'no server' });
    msg('Name lookup needs the structure server (see "Structure server" above).', 'warn');
    return nameState;
  }
  msg('Reading the name with OPSIN…');
  try {
    const ask = async q => (await fetch(`${url}/name?q=${encodeURIComponent(q)}`)).json();
    let j = await ask(name);
    let note = '';
    if (!j.smiles) {
      const ex = expandAbbreviations(name);
      if (ex.used.length && ex.name !== name) {
        const j2 = await ask(ex.name);
        if (j2.smiles) { j = j2; note = ` (read as "${ex.name}")`; }
      }
    }
    Object.assign(nameState, { name, smiles: j.smiles || '', error: j.error || '' });
    if (j.smiles) msg(`OPSIN read the name${note}: ${j.smiles}`, 'good');
    else msg(`OPSIN could not read the name: ${j.error}`, 'warn');
  } catch {
    Object.assign(nameState, { name, smiles: '', error: 'server unreachable' });
    msg('Could not reach the structure server for the name lookup. A sleeping Hugging Face Space can take a minute to start.', 'warn');
  }
  return nameState;
}

export function setupName({ onAutoName }) {
  let timer = null;
  const fromText = () => {
    const guess = extractName($('data').value);
    if (guess && (!$('name').value.trim() || nameState.auto)) {
      if ($('name').value !== guess) { $('name').value = guess; nameState.auto = true; onAutoName && onAutoName(guess); }
    }
  };
  $('data').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(fromText, 400); });
  $('name').addEventListener('input', () => { nameState.auto = false; });
}
