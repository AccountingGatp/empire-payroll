import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { pdfToLines } from './pdflines.js';
import { runPayroll, journalCsv, r2 } from './engine.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = id => document.getElementById(id);
const CFG_KEY = 'empire-payroll-rules-v1';
const state = { files: {}, cfg: null, defaults: null, result: null, view: 'je' };

// ---------------------------------------------------------------- helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => (v === '' || v === null || v === undefined || v === 0 ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const safeGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const safeDel = k => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function sheetRows(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
}

// ---------------------------------------------------------------- tabs
function showView(name) {
  for (const v of ['run', 'rules', 'help']) {
    $('view-' + v).hidden = v !== name;
    $('tab-' + v).setAttribute('aria-selected', String(v === name));
  }
}
for (const v of ['run', 'rules', 'help']) $('tab-' + v).addEventListener('click', () => showView(v));

// ---------------------------------------------------------------- rules
async function loadConfig() {
  const res = await fetch('config.json');
  state.defaults = await res.json();
  const saved = safeGet(CFG_KEY);
  try { state.cfg = saved ? JSON.parse(saved) : structuredClone(state.defaults); } catch { state.cfg = structuredClone(state.defaults); }
  $('cfg').value = JSON.stringify(state.cfg, null, 2);
}
function setCfgMsg(t, err) { const m = $('cfg-msg'); m.textContent = t; m.className = 'status' + (err ? ' err' : ''); }
$('cfg-save').addEventListener('click', () => {
  try {
    const c = JSON.parse($('cfg').value);
    for (const k of ['class_map', 'accounts', 'settings', 'dept_class', 'class_overrides', 'city_managers', 'outside_payentry']) if (!c[k]) throw new Error('Missing section: ' + k);
    state.cfg = c; safeSet(CFG_KEY, JSON.stringify(c)); setCfgMsg('Saved in this browser.');
  } catch (e) { setCfgMsg('Not saved: ' + e.message, true); }
});
$('cfg-reset').addEventListener('click', () => { state.cfg = structuredClone(state.defaults); safeDel(CFG_KEY); $('cfg').value = JSON.stringify(state.cfg, null, 2); setCfgMsg('Reset to defaults.'); });
$('cfg-dl').addEventListener('click', () => download('config.json', $('cfg').value, 'application/json'));
$('cfg-up').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const t = await f.text(); JSON.parse(t); $('cfg').value = t; setCfgMsg('Loaded. Press Save rules to keep it.'); } catch (err) { setCfgMsg('Not valid JSON: ' + err.message, true); }
  e.target.value = '';
});

// ---------------------------------------------------------------- file inputs
const slots = { pdf: 'f-pdf', emp: 'f-emp', cls: 'f-cls', ref: 'f-ref' };
for (const [k, id] of Object.entries(slots)) {
  $(id).addEventListener('change', e => {
    const f = e.target.files[0];
    state.files[k] = f || null;
    $('n-' + k).textContent = f ? f.name : 'No file chosen';
    $(id).closest('.drop').classList.toggle('has', !!f);
    $('go').disabled = !(state.files.pdf && state.files.emp);
  });
}

// ---------------------------------------------------------------- run
function setStatus(t, err) { const s = $('status'); s.textContent = t; s.className = 'status' + (err ? ' err' : ''); }

$('go').addEventListener('click', async () => {
  $('go').disabled = true; setStatus('Reading the report...');
  try {
    const buf = new Uint8Array(await state.files.pdf.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const lines = await pdfToLines(doc);
    setStatus('Building the journal entry...');
    const empListRows = await sheetRows(state.files.emp);
    const classListRows = state.files.cls ? await sheetRows(state.files.cls) : null;
    const referenceRows2d = state.files.ref ? await sheetRows(state.files.ref) : null;
    const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : 0; };
    state.result = runPayroll({
      lines, empListRows, classListRows, cfg: state.cfg, referenceRows2d,
      outside: { jared: num('o-jared'), yassine: num('o-yassine'), manualCsv: $('o-manual').value }
    });
    render();
    setStatus('Done.');
    $('results').hidden = false;
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    setStatus('Could not build the journal: ' + err.message, true);
  } finally { $('go').disabled = !(state.files.pdf && state.files.emp); }
});

// ---------------------------------------------------------------- render
function blockedNow() { return state.result.checks.some(c => c[3] && !c[1]); }

function render() {
  const r = state.result, m = r.meta;
  const gross = r2(r.emps.reduce((a, e) => a + e.gross, 0));
  const dr = r2(r.rows.reduce((a, x) => a + (Number(x.DEBITS) || 0), 0));
  $('summary').textContent = `Check date ${m.check_date} · period ${m.period[0]} to ${m.period[1]} · ${r.emps.length} employees · gross ${fmt(gross)} · ${r.rows.length} journal lines · total ${fmt(dr)}`;
  $('checks').innerHTML = r.checks.map(([name, ok, detail, critical]) => {
    const cls = ok ? 'pass' : critical ? 'fail' : 'warn';
    return `<li><span class="badge ${cls}">${ok ? 'PASS' : critical ? 'FAIL' : 'CHECK'}</span><span><b>${esc(name)}</b><br><span class="d">${esc(detail)}</span></span></li>`;
  }).join('');
  $('flagbox').hidden = !r.email;
  $('email').textContent = r.email;
  $('diff-tab').hidden = !r.diffs;
  const blocked = blockedNow();
  for (const id of ['dl-xlsx', 'dl-csv', 'dl-louise']) $(id).disabled = blocked;
  $('blocked').hidden = !blocked;
  renderTable();
}

function table(head, rows, opts = {}) {
  const right = opts.right || [];
  const th = head.map((h, i) => `<th class="${right.includes(i) ? 'r' : ''}">${esc(h)}</th>`).join('');
  const tr = rows.map(row => `<tr class="${row.flag ? 'flag' : ''}">${row.cells.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  const foot = opts.foot ? `<tfoot><tr>${opts.foot.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr></tfoot>` : '';
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${foot}</table>`;
}

function renderTable() {
  const r = state.result, v = state.view;
  document.querySelectorAll('#rtabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === v)));
  let html = '';
  if (v === 'je') {
    const td = r2(r.rows.reduce((a, x) => a + (Number(x.DEBITS) || 0), 0)), tc = r2(r.rows.reduce((a, x) => a + (Number(x.CREDITS) || 0), 0));
    html = table(['Account', 'Debits', 'Credits', 'Description', 'Class'],
      r.rows.map(x => ({ cells: [x.ACCOUNT, fmt(x.DEBITS), fmt(x.CREDITS), x.DESCRIPTION, x.CLASS], flag: x.DESCRIPTION.includes('[class unconfirmed]') })),
      { right: [1, 2], foot: ['Total', fmt(td), fmt(tc), '', ''] });
  } else if (v === 'cls') {
    html = table(['Account', 'Class', 'Debits', 'Credits'], r.byClass.map(x => ({ cells: [x[0], x[1], fmt(x[2]), fmt(x[3])] })), { right: [2, 3] });
  } else if (v === 'cm') {
    const cm = r.rows.filter(x => /^(66000\.1|67610\.1)/.test(x.ACCOUNT));
    html = cm.length ? table(['Line', 'Account', 'Amount', 'Class'], cm.map(x => ({ cells: [x.DESCRIPTION, x.ACCOUNT, fmt(x.DEBITS), x.CLASS] })), { right: [2] }) : '<p class="hint" style="padding:12px">No city-manager pay in this payroll.</p>';
  } else if (v === 'emp') {
    html = table(['Employee', 'Id', 'Payentry dept', 'Class used', 'Source', 'Gross', 'Employer tax', 'Employee tax', 'Deductions', 'Net'],
      r.info.map(i => ({ flag: i.flagged, cells: [i.emp, i.id, i.dept, i.cls, i.src, fmt(i.gross), fmt(i.er), fmt(i.ee), fmt(i.ded), fmt(i.net)] })), { right: [5, 6, 7, 8, 9] });
  } else if (v === 'diff') {
    html = r.diffs.length ? table(['Employee', 'Line', 'Differs in', 'Reference (account | class | amount)', 'This output'], r.diffs.map(d => ({ cells: d })))
      : '<p class="hint" style="padding:12px">No differences. Every line matches the finished journal.</p>';
  }
  $('tbl').innerHTML = html;
}
$('rtabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.view = b.dataset.t; renderTable(); } });

// ---------------------------------------------------------------- downloads
function workbook(r) {
  const wb = XLSX.utils.book_new();
  const je = [['ACCOUNT', 'DEBITS', 'CREDITS', 'DESCRIPTION', 'NAME', 'LOCATION', 'CLASS'],
    ...r.rows.map(x => [x.ACCOUNT, x.DEBITS === '' ? null : x.DEBITS, x.CREDITS === '' ? null : x.CREDITS, x.DESCRIPTION, null, null, x.CLASS]),
    [], ['TOTAL', r2(r.rows.reduce((a, x) => a + (Number(x.DEBITS) || 0), 0)), r2(r.rows.reduce((a, x) => a + (Number(x.CREDITS) || 0), 0))]];
  const add = (name, aoa, widths) => { const ws = XLSX.utils.aoa_to_sheet(aoa); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add('JE', je, [62, 12, 12, 100, 8, 10, 32]);
  add('By class', [['Account', 'Class', 'Debits', 'Credits'], ...r.byClass], [60, 32, 14, 14]);
  add('City manager', [['Line', 'Account', 'Amount', 'Class'], ...r.rows.filter(x => /^(66000\.1|67610\.1)/.test(x.ACCOUNT)).map(x => [x.DESCRIPTION, x.ACCOUNT, x.DEBITS, x.CLASS])], [90, 50, 12, 32]);
  add('Employees', [['Employee', 'Emp Id', 'Payentry dept', 'Class used', 'Class source', 'Needs confirmation', 'Gross', 'Employer tax', 'Employee tax', 'Deductions', 'Net'],
    ...r.info.map(i => [i.emp, i.id, i.dept, i.cls, i.src, i.flagged ? 'YES' : '', i.gross, i.er, i.ee, i.ded, i.net])], [26, 8, 18, 32, 12, 10, 12, 12, 12, 12, 12]);
  add('Checks', [['Check', 'Result', 'Detail'], ...r.checks.map(c => [c[0], c[1] ? 'PASS' : c[3] ? 'FAIL' : 'CHECK', c[2]])], [50, 10, 110]);
  if (r.diffs) add('Compare', [['Employee', 'Line', 'Differs in', 'Reference', 'This output'], ...r.diffs], [24, 40, 20, 70, 70]);
  return wb;
}

$('dl-xlsx').addEventListener('click', () => {
  const r = state.result; const out = XLSX.write(workbook(r), { bookType: 'xlsx', type: 'array' });
  download(`JE_${r.jno}.xlsx`, out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
$('dl-csv').addEventListener('click', () => download(`journal_import_${state.result.jno}.csv`, journalCsv(state.result), 'text/csv'));
$('dl-louise').addEventListener('click', () => download(`reply_to_louise_${state.result.jno}.txt`, state.result.louise, 'text/plain'));
$('copy-email').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.result.email); $('copy-email').textContent = 'Copied'; }
  catch { $('copy-email').textContent = 'Select the text and copy it'; }
  setTimeout(() => { $('copy-email').textContent = 'Copy email draft'; }, 2500);
});

// ---------------------------------------------------------------- start
loadConfig().catch(err => setStatus('Could not load the default rules: ' + err.message, true));
