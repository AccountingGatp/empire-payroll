import { CFG_KEY, loadConfig, safeSet, safeDel } from './config.js';

const $ = id => document.getElementById(id);
let defaults = null;
const msg = (t, err) => { const m = $('cfg-msg'); m.textContent = t; m.className = 'status' + (err ? ' err' : ''); };
const show = c => { $('cfg').value = JSON.stringify(c, null, 2); };

const { cfg, defaults: d, custom } = await loadConfig();
defaults = d; show(cfg);
if (custom) msg('Using rules saved in this browser.');

$('cfg-save').addEventListener('click', () => {
  try {
    const c = JSON.parse($('cfg').value);
    for (const k of ['class_map', 'accounts', 'settings', 'dept_class', 'class_overrides', 'city_managers', 'outside_payentry']) if (!c[k]) throw new Error('Missing section: ' + k);
    safeSet(CFG_KEY, JSON.stringify(c)); msg('Saved in this browser.');
  } catch (e) { msg('Not saved: ' + e.message, true); }
});
$('cfg-reset').addEventListener('click', () => { safeDel(CFG_KEY); show(defaults); msg('Back to the default rules.'); });
$('cfg-dl').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([$('cfg').value], { type: 'application/json' }));
  a.download = 'config.json'; document.body.appendChild(a); a.click(); a.remove();
});
$('cfg-up').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const t = await f.text(); JSON.parse(t); $('cfg').value = t; msg('Loaded. Press Save rules to keep it.'); } catch (err) { msg('Not valid JSON: ' + err.message, true); }
  e.target.value = '';
});
