import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { pdfToLines } from './pdflines.js';
import { runPayroll, journalCsv, r2 } from './engine.js';
import { detectKind } from './detect.js';
import { loadConfig } from './config.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = id => document.getElementById(id);
const state = { files: {}, parsed: {}, cfg: null, result: null, busy: false, again: false };

// ---------------------------------------------------------------- helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => (v === '' || v === null || v === undefined || v === 0 ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const money = v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copyText(btn, text, label) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch { btn.textContent = 'Select the text and copy it'; }
  setTimeout(() => { btn.textContent = label; }, 2500);
}
function notice(text, bad) {
  const n = $('notice'); n.hidden = !text; n.textContent = text || ''; n.className = 'notice' + (bad ? ' bad' : '');
}

// ---------------------------------------------------------------- intake: drop everything at once
const KINDS = { pdf: 'Payentry report', emp: 'Employee List', cls: 'QuickBooks class list', ref: 'Finished journal' };

async function sheetRows(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
}

async function addFiles(fileList) {
  const problems = [];
  for (const f of [...fileList]) {
    try {
      const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
      const rows = isPdf ? null : await sheetRows(f);
      const kind = detectKind(f.name, rows);
      if (!kind) { problems.push(`I could not tell what "${f.name}" is. Expected the Payentry PDF, Employee List, class list or a finished journal.`); continue; }
      state.files[kind] = f; state.parsed[kind] = rows;
    } catch (err) { problems.push(`"${f.name}" could not be opened (${err.message}).`); }
  }
  drawSlots();
  notice(problems.join(' '), problems.length > 0);
  await maybeRun();
}

function drawSlots() {
  document.querySelectorAll('#slots li').forEach(li => {
    const k = li.dataset.k, f = state.files[k];
    li.classList.toggle('has', !!f);
    li.querySelector('.mark').innerHTML = f ? '&#10003;' : '&#9675;';
    li.querySelector('.fn').textContent = f ? f.name : '';
    li.querySelector('.x').hidden = !f;
  });
}

const dz = $('dropzone'), picker = $('files');
dz.addEventListener('click', () => picker.click());
dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });
['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
// A file dropped outside the box must not make the browser open it.
['dragover', 'drop'].forEach(t => window.addEventListener(t, e => e.preventDefault()));
window.addEventListener('drop', e => { if (!dz.contains(e.target) && e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

$('slots').addEventListener('click', e => {
  const b = e.target.closest('.x'); if (!b) return;
  const k = b.closest('li').dataset.k; delete state.files[k]; delete state.parsed[k];
  drawSlots(); if (!(state.files.pdf && state.files.emp)) $('results').hidden = true; else maybeRun();
});
$('reset').addEventListener('click', () => {
  state.files = {}; state.parsed = {}; state.result = null;
  for (const id of ['o-jared', 'o-yassine', 'o-manual']) $(id).value = '';
  drawSlots(); notice(''); $('results').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('update').addEventListener('click', () => maybeRun());

// ---------------------------------------------------------------- run
async function maybeRun() {
  if (!(state.files.pdf && state.files.emp)) {
    const need = [!state.files.pdf && 'the Payentry report (PDF)', !state.files.emp && 'the Employee List'].filter(Boolean).join(' and ');
    if (Object.keys(state.files).length) notice(`Still needed: ${need}.`);
    return;
  }
  if (state.busy) { state.again = true; return; }
  state.busy = true;
  try {
    notice('Working...');
    await state.cfgReady;
    if (!state.cfg) throw new Error('the rules did not load');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await state.files.pdf.arrayBuffer()) }).promise;
    const lines = await pdfToLines(doc);
    const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : 0; };
    state.result = runPayroll({
      lines, empListRows: state.parsed.emp, classListRows: state.parsed.cls || null, cfg: state.cfg,
      referenceRows2d: state.parsed.ref || null,
      outside: { jared: num('o-jared'), yassine: num('o-yassine'), manualCsv: $('o-manual').value }
    });
    notice('');
    render();
    $('results').hidden = false;
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    $('results').hidden = true;
    notice(`Could not build the journal: ${err.message}`, true);
  } finally {
    state.busy = false;
    if (state.again) { state.again = false; maybeRun(); }
  }
}

// ---------------------------------------------------------------- results
function render() {
  const r = state.result, m = r.meta;
  const hardFails = r.checks.filter(c => c[3] && !c[1]);
  const warns = r.checks.filter(c => !c[3] && !c[1]);
  const totalDr = r2(r.rows.reduce((a, x) => a + (Number(x.DEBITS) || 0), 0));
  const gross = r2(r.emps.reduce((a, e) => a + e.gross, 0));
  const flagged = r.info.filter(i => i.flagged);
  const when = `Pay date ${m.check_date} (${m.period[0]} to ${m.period[1]})`;

  const b = $('banner');
  if (hardFails.length) {
    b.className = 'banner bad';
    b.innerHTML = `<b>This journal cannot be used yet.</b><span>${esc(hardFails.map(c => c[0] + ': ' + c[2]).join(' · '))}</span><span class="when">${esc(when)}</span>`;
  } else if (warns.length) {
    b.className = 'banner warn';
    const bits = [];
    if (flagged.length) bits.push(`${flagged.length} employee${flagged.length > 1 ? 's' : ''} not on the Employee List`);
    for (const w of warns) {
      if (/Employee List/.test(w[0])) continue;
      if (/run on or after the period end/.test(w[0])) bits.push(`The report was run on ${m.run_date}, before the pay period ended (${m.period[1]}). Make sure it is the final report.`);
      else bits.push(w[0] + ': ' + w[2]);
    }
    b.innerHTML = `<b>Journal is ready, with something to look at.</b><span>${esc(bits.join(' · '))}</span><span class="when">${esc(when)} · ${r.emps.length} employees · gross ${money(gross)} · journal total ${money(totalDr)}</span>`;
  } else {
    b.className = 'banner ok';
    b.innerHTML = `<b>Journal is ready.</b><span>All checks passed. The totals match the Payentry report.</span><span class="when">${esc(when)} · ${r.emps.length} employees · gross ${money(gross)} · journal total ${money(totalDr)}</span>`;
  }

  $('flagbox').hidden = !flagged.length;
  $('flag-title').textContent = `${flagged.length} employee${flagged.length === 1 ? ' is' : 's are'} not on the Employee List: ${flagged.map(i => i.emp).join('; ')}`;
  $('email').textContent = r.email;

  for (const id of ['dl-xlsx', 'dl-csv']) $(id).disabled = hardFails.length > 0;
  const bl = $('blocked'); bl.hidden = !hardFails.length;
  bl.textContent = hardFails.length ? 'Downloads are off until the problem above is fixed.' : '';

  $('tbl').innerHTML = tableHtml(['Account', 'Debit', 'Credit', 'Description', 'Class'],
    r.rows.map(x => ({ cells: [x.ACCOUNT, fmt(x.DEBITS), fmt(x.CREDITS), x.DESCRIPTION, x.CLASS], flag: x.DESCRIPTION.includes('[class unconfirmed]') })),
    { right: [1, 2], foot: ['Total', fmt(totalDr), fmt(r2(r.rows.reduce((a, x) => a + (Number(x.CREDITS) || 0), 0))), '', ''] });

  $('cmpbox').hidden = !r.diffs;
  if (r.diffs) {
    $('cmp-sum').textContent = r.diffs.length ? `– ${r.diffs.length} difference${r.diffs.length > 1 ? 's' : ''}` : '– no differences';
    $('cmp').innerHTML = r.diffs.length
      ? tableHtml(['Employee', 'Line', 'Differs in', 'Your finished journal', 'This journal'], r.diffs.map(d => ({ cells: d })))
      : '<p class="hint" style="padding:12px">Every line matches your finished journal.</p>';
  }

  $('chk-sum').textContent = `– ${r.checks.filter(c => c[1]).length} of ${r.checks.length} passed`;
  $('checks').innerHTML = r.checks.map(([name, ok, detail, critical]) => {
    const cls = ok ? 'pass' : critical ? 'fail' : 'warn';
    return `<li><span class="badge ${cls}">${ok ? 'PASS' : critical ? 'FAIL' : 'LOOK'}</span><span><b>${esc(name)}</b><br><span class="d">${esc(detail)}</span></span></li>`;
  }).join('');
}

function tableHtml(head, rows, opts = {}) {
  const right = opts.right || [];
  const th = head.map((h, i) => `<th class="${right.includes(i) ? 'r' : ''}">${esc(h)}</th>`).join('');
  const tr = rows.map(row => `<tr class="${row.flag ? 'flag' : ''}">${row.cells.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  const foot = opts.foot ? `<tfoot><tr>${opts.foot.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr></tfoot>` : '';
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${foot}</table>`;
}

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
  add('Checks', [['Check', 'Result', 'Detail'], ...r.checks.map(c => [c[0], c[1] ? 'PASS' : c[3] ? 'FAIL' : 'LOOK', c[2]])], [50, 10, 110]);
  if (r.diffs) add('Compare', [['Employee', 'Line', 'Differs in', 'Reference', 'This output'], ...r.diffs], [24, 40, 20, 70, 70]);
  return wb;
}
$('dl-xlsx').addEventListener('click', () => {
  const r = state.result;
  download(`JE_${r.jno}.xlsx`, XLSX.write(workbook(r), { bookType: 'xlsx', type: 'array' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
$('dl-csv').addEventListener('click', () => download(`journal_import_${state.result.jno}.csv`, journalCsv(state.result), 'text/csv'));
$('copy-louise').addEventListener('click', e => copyText(e.currentTarget, state.result.louise, 'Copy reply to Louise'));
$('copy-email').addEventListener('click', e => copyText(e.currentTarget, state.result.email, 'Copy email'));

// ---------------------------------------------------------------- start
state.cfgReady = loadConfig().then(({ cfg }) => { state.cfg = cfg; }).catch(err => notice('Could not load the rules: ' + err.message, true));
