// Empire US payroll engine: Payentry "Labor Distribution" lines -> QuickBooks Online journal entry.
// Pure functions, no DOM, no network. Works in the browser and in Node (tests).

export const r2 = x => Math.round((x + 1e-9) * 100) / 100;
const num = s => parseFloat(s);
const money = x => (x === '' || x === null || x === undefined ? 0 : Number(x));
const SEP = ' – ';

// ---------------------------------------------------------------- names
export const norm = s => String(s || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

/** "Garcia Steven C" -> "garcia steven" (last + first token, case-insensitive) */
export function listKey(fullName) {
  const p = norm(fullName).split(' ');
  return p.length > 1 ? p[0] + ' ' + p[1] : p[0];
}

// ---------------------------------------------------------------- report parsing
/**
 * lines: array of strings (one per visual line; '\f' marks a page break).
 * Returns { meta, emps }.
 */
export function parseReport(lines) {
  const text = lines.join('\n');
  const meta = {};
  let m = text.match(/Check Date:\s*(\d\d\/\d\d\/\d{4})/);
  if (!m) throw new Error('This does not look like a Payentry Labor Distribution report (no "Check Date" found).');
  meta.check_date = m[1];
  m = text.match(/Period:\s*(\d\d\/\d\d\/\d{4})\s+to\s+(\d\d\/\d\d\/\d{4})/);
  if (!m) throw new Error('Report period not found.');
  meta.period = [m[1], m[2]];
  m = text.match(/Run Date:\s*(\d\d\/\d\d\/\d\d)\b/);
  meta.run_date = m ? m[1] : null;

  const totRe = /Total Earnings\s+[\d.]+\s+([\d.]+)\s+Total Deductions\s+([\d.]+)\s+Total Employee Taxes\s+([\d.]+)\s+Total Employer Taxes\s+([\d.]+)/;
  const tots = lines.map(l => l.match(totRe)).filter(Boolean);
  meta.grand = tots.length ? tots[tots.length - 1].slice(1, 5).map(num) : null;
  const cnt = lines.map(l => l.match(/^Employees\s+(\d+)\b/)).filter(Boolean);
  meta.count = cnt.length ? num(cnt[cnt.length - 1][1]) : null;

  const emps = [];
  let dept = null, cur = null;
  for (const l of lines) {
    let d = l.match(/Department:\s*\((\d+)\)\s*(.+?)\s*$/);
    if (d) { dept = /\bTotal$/.test(d[2]) ? null : d[2].trim(); cur = null; continue; }
    const h = l.match(/^(\S.*?),\s+Code\s+Earning\b/);
    if (h && dept) {
      cur = { last: h[1].trim(), first: null, dept, id: null, earn: {}, gross: null, ded: 0, ee: 0, er: 0, net: null };
      emps.push(cur); continue;
    }
    if (!cur) continue;
    if (cur.first === null) {
      const f = l.match(/^\s*([A-Za-z'.-]+(?: [A-Za-z'.-]+)?)\s+(?:SAL|REG)\b/);
      if (f) cur.first = f[1].trim();
    }
    let x = l.match(/Emp Id\s+(\d+)/); if (x) cur.id = parseInt(x[1], 10);
    for (const [code, nm] of [['REG', 'REGULAR'], ['SAL', 'SALARY']]) {
      const e = l.match(new RegExp('\\b' + code + '\\s+' + nm + '\\s+(?:(\\d+\\.\\d+)\\s+)?(\\d+\\.\\d+)'));
      if (e && !(code in cur.earn)) cur.earn[code] = num(e[2]);
    }
    x = l.match(/Gross\s+([\d.]+)/); if (x && cur.gross === null) cur.gross = num(x[1]);
    x = l.match(/Net Amt\s+([\d.]+)/); if (x) cur.net = num(x[1]);
    x = l.match(/Total Deductions\s+([\d.]+)\s+Total Employee Taxes\s+([\d.]+)\s+Total Employer Taxes\s+([\d.]+)/);
    if (x) { cur.ded = num(x[1]); cur.ee = num(x[2]); cur.er = num(x[3]); cur = null; }
  }
  for (const e of emps) {
    e.first_token = e.first ? e.first.split(' ')[0] : '';
    e.name = e.last + ', ' + e.first;
    e.key = norm(e.last) + ' ' + norm(e.first_token);
    if (e.gross === null) e.gross = r2(Object.values(e.earn).reduce((a, b) => a + b, 0));
    if (e.net === null) e.net = r2(e.gross - e.ee - e.ded);
  }
  return { meta, emps };
}

// ---------------------------------------------------------------- list files
/** rows: 2D array from the Employee List sheet ("Employee name", "Class") */
export function parseEmployeeList(rows) {
  const map = new Map();
  for (const r of rows.slice(1)) {
    if (r && r[0] && r[1]) map.set(listKey(r[0]), String(r[1]).trim());
  }
  return map;
}

/** rows: 2D array from the QBO class list export; keeps everything after the "Class full name" heading */
export function parseClassList(rows) {
  const out = new Set();
  let on = false;
  for (const r of rows) {
    const v = r && r[0] != null ? String(r[0]).trim() : '';
    if (!v) continue;
    if (/^class full name$/i.test(v)) { on = true; continue; }
    if (on && !/GMT[+-]\d/.test(v)) out.add(v);
  }
  if (!on) rows.forEach(r => { const v = r && r[0] != null ? String(r[0]).trim() : ''; if (v && !/GMT[+-]\d/.test(v)) out.add(v); });
  return out;
}

// ---------------------------------------------------------------- rules
function ruleSet(cfg) {
  const k = o => Object.fromEntries(Object.entries(o || {}).map(([a, b]) => [norm(a), b]));
  return {
    overrides: k(cfg.class_overrides),
    cms: k(cfg.city_managers),
    officers: new Set((cfg.officers || []).map(norm)),
    regContract: new Set((cfg.regular_pay_as_contract_labor || []).map(norm)),
    aliases: k(cfg.name_aliases)
  };
}

export function classOf(cfg, rs, emp, empList) {
  const key = rs.aliases[emp.key] ? norm(rs.aliases[emp.key]) : emp.key;
  const c = rs.overrides[key] || empList.get(key);
  if (c) return { cls: c, flagged: false, src: rs.overrides[key] ? 'override' : 'list' };
  if (cfg.settings.unknown_class_mode === 'department' && cfg.dept_class[emp.dept])
    return { cls: cfg.dept_class[emp.dept], flagged: true, src: 'department' };
  return { cls: cfg.settings.fallback_class, flagged: true, src: 'fallback' };
}

const qbo = (cfg, c) => cfg.class_map[c] || ('UNMAPPED:' + c);

function employeeBlock(cfg, rs, e, empList, period) {
  const A = cfg.accounts, S = cfg.settings;
  const { cls, flagged, src } = classOf(cfg, rs, e, empList);
  const key = rs.aliases[e.key] ? norm(rs.aliases[e.key]) : e.key;
  const cm = rs.cms[key];
  const officer = rs.officers.has(key);
  const tag = flagged && S.flag_in_description ? ' [class unconfirmed]' : '';
  const per = ' ' + period[0] + ' to ' + period[1];
  const parts = [];
  for (const code of ['REG', 'SAL']) {
    const amt = e.earn[code] || 0;
    if (amt <= 0) continue;
    const contractTax = S.tax_follows_pay ? A.contract_labor : A.admin_tax;
    if (code === 'SAL' && officer) parts.push([A.officer_salary, A.admin_tax, cls, amt, "Officer's salary", 'guide pay']);
    else if (code === 'SAL' && cm && cm.salary_is_city_manager !== false)
      parts.push([A.city_mgr_salary, A.city_mgr_tax, cm.work_class, amt, 'City Manager salary', 'City Manager salary']);
    else if (code === 'REG' && rs.regContract.has(key)) parts.push([A.contract_labor, contractTax, cls, amt, 'Guide pay (Regular)', 'guide pay']);
    else if (cls === 'Admin' || cls === 'Administrative') parts.push([A.admin_salary, A.admin_tax, cls, amt, 'Admin salary', 'guide pay']);
    else parts.push([A.contract_labor, contractTax, cls, amt, code === 'REG' ? 'Guide pay (Regular)' : 'Salary – contract labour', 'guide pay']);
  }
  const gross = parts.reduce((a, p) => a + p[3], 0);
  let left = e.er; const taxes = [];
  parts.forEach((p, i) => {
    const t = i === parts.length - 1 ? r2(left) : r2(e.er * p[3] / gross);
    left -= t; taxes.push(t);
  });
  const rows = [];
  const mk = (acct, dr, cr, desc, c) => ({ ACCOUNT: acct, DEBITS: dr || '', CREDITS: cr || '', DESCRIPTION: e.name + SEP + desc + per + tag, NAME: '', LOCATION: '', CLASS: qbo(cfg, c) });
  parts.forEach(p => rows.push(mk(p[0], r2(p[3]), 0, p[4], p[2])));
  parts.forEach((p, i) => {
    const lab = parts.length === 1
      ? 'Employer payroll taxes' + (p[1] === A.city_mgr_tax ? ' on City Manager salary' : '')
      : 'Employer payroll taxes on ' + p[5] + ' (' + (100 * p[3] / gross).toFixed(2) + '% of gross)';
    rows.push(mk(p[1], taxes[i], 0, lab, p[2]));
  });
  rows.push(mk(A.liability, 0, r2(e.net), 'Net pay (direct deposit)', cls));
  rows.push(mk(A.liability, 0, r2(e.ee + e.er), 'EE tax withholdings + employer taxes', cls));
  if (e.ded) {
    const debit = S.deductions_side === 'debit';
    rows.push(mk(A.deductions, debit ? r2(e.ded) : 0, debit ? 0 : r2(e.ded), 'Health insurance deduction withheld', cls));
  }
  return { rows, info: { emp: e.name, id: e.id, dept: e.dept, cls: qbo(cfg, cls), flagged, src, gross: e.gross, er: e.er, ee: e.ee, net: e.net, ded: e.ded } };
}

export function buildDetail(cfg, emps, empList, period) {
  const rs = ruleSet(cfg);
  const grp = e => {
    const key = rs.aliases[e.key] ? norm(rs.aliases[e.key]) : e.key;
    const { cls } = classOf(cfg, rs, e, empList);
    const cm = rs.cms[key] && e.earn.SAL;
    return [rs.officers.has(key) ? 0 : (cls === 'Admin' || cls === 'Administrative') && !cm ? 1 : cm ? 2 : 3, cls, e.name];
  };
  const keyed = emps.map(e => ({ e, k: grp(e) }));
  keyed.sort((a, b) => a.k[0] - b.k[0] || (a.k[1] < b.k[1] ? -1 : a.k[1] > b.k[1] ? 1 : 0) || (a.k[2] < b.k[2] ? -1 : a.k[2] > b.k[2] ? 1 : 0));
  const rows = [], info = [];
  for (const { e } of keyed) { const b = employeeBlock(cfg, rs, e, empList, period); rows.push(...b.rows); info.push(b.info); }
  return { rows, info };
}

// ---------------------------------------------------------------- outside Payentry
/** Jared Wiseman: direct payments, no payroll tax. NYC city manager first, then Charleston, rest is NYC contract labor. */
export function jaredRows(cfg, period, total) {
  const o = cfg.outside_payentry, j = o.jared, A = cfg.accounts;
  if (!total || total <= 0) return [];
  const [mm, dd, yy] = period[0].split('/');
  const start = `${yy}-${mm}-${dd}`;
  let left = total;
  const lines = [];
  const take = (acct, cls, cap, label) => { if (left + 1e-9 >= cap) { lines.push([acct, cls, cap, label]); left = r2(left - cap); return true; } return false; };
  // NYC city manager is filled first; Charleston only after NYC is full; anything left is contract labor.
  const nycFull = take(A.city_mgr_salary, 'NYC', j.nyc_city_manager, 'City Manager salary (NYC)');
  if (nycFull && start >= j.charleston_from) take(A.city_mgr_salary, 'Charleston', j.charleston_city_manager, 'City Manager salary (Charleston)');
  if (left > 0) lines.push([A.contract_labor, 'NYC', left, 'Guide pay (contract labor)']);
  const per = ' ' + period[0] + ' to ' + period[1];
  const rows = lines.map(l => ({ ACCOUNT: l[0], DEBITS: r2(l[2]), CREDITS: '', DESCRIPTION: j.name + SEP + l[3] + ' – direct payment, no payroll tax' + per, NAME: '', LOCATION: '', CLASS: qbo(cfg, l[1]) }));
  rows.push({ ACCOUNT: o.credit_account, DEBITS: '', CREDITS: r2(total), DESCRIPTION: j.name + SEP + 'Direct payment' + per, NAME: '', LOCATION: '', CLASS: qbo(cfg, 'NYC') });
  return rows;
}

/** Yassine's weekly direct payment is contract labor in London. */
export function yassineRows(cfg, period, total) {
  const o = cfg.outside_payentry, y = o.yassine, A = cfg.accounts;
  if (!total || total <= 0) return [];
  const per = ' ' + period[0] + ' to ' + period[1];
  return [
    { ACCOUNT: A.contract_labor, DEBITS: r2(total), CREDITS: '', DESCRIPTION: y.name + SEP + 'Guide pay (direct payment)' + per, NAME: '', LOCATION: '', CLASS: qbo(cfg, y.direct_class) },
    { ACCOUNT: o.credit_account, DEBITS: '', CREDITS: r2(total), DESCRIPTION: y.name + SEP + 'Direct payment' + per, NAME: '', LOCATION: '', CLASS: qbo(cfg, y.direct_class) }
  ];
}

/** Manual lines (Deel payroll etc.): CSV text with columns account,class,debit,credit,description. */
export function manualRows(csvText) {
  const rows = [];
  const recs = parseCsv(csvText).filter(r => r.some(c => c.trim() !== ''));
  if (!recs.length) return rows;
  const head = recs[0].map(h => h.trim().toLowerCase());
  const body = head.includes('account') ? recs.slice(1) : recs;
  const ix = n => (head.includes('account') ? head.indexOf(n) : ['account', 'class', 'debit', 'credit', 'description'].indexOf(n));
  for (const r of body) {
    const g = n => (r[ix(n)] || '').trim();
    rows.push({ ACCOUNT: g('account'), DEBITS: money(g('debit').replace(/[$,]/g, '')) || '', CREDITS: money(g('credit').replace(/[$,]/g, '')) || '', DESCRIPTION: g('description'), NAME: '', LOCATION: '', CLASS: g('class') });
  }
  return rows;
}

export function parseCsv(text) {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}

export function toCsv(rows2d) {
  return rows2d.map(r => r.map(v => { v = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- checks
function parseDate(s, fmt) {
  if (fmt === 'mdy') { const [m, d, y] = s.split('/'); return new Date(+(y.length === 2 ? '20' + y : y), m - 1, +d); }
}

export function runChecks({ meta, emps, rows, info, qboClasses }) {
  const res = [];
  const sum = k => rows.reduce((a, r) => a + money(r[k]), 0);
  const td = r2(sum('DEBITS')), tc = r2(sum('CREDITS'));
  res.push(['Debits equal credits', td === tc, `debits ${td.toFixed(2)} credits ${tc.toFixed(2)}`, true]);
  const bad = emps.filter(e => {
    const rr = rows.filter(r => r.DESCRIPTION.startsWith(e.name + SEP));
    return Math.abs(rr.reduce((a, r) => a + money(r.DEBITS) - money(r.CREDITS), 0)) > 0.011;
  }).map(e => e.name);
  res.push(['Each employee block balances', !bad.length, bad.join(', ') || 'ok', true]);
  const badEarn = emps.filter(e => Math.abs(Object.values(e.earn).reduce((a, b) => a + b, 0) - e.gross) > 0.011).map(e => e.name);
  res.push(['Every pay code on the report is understood (REG/SAL)', !badEarn.length, badEarn.length ? 'earnings do not add up to gross for: ' + badEarn.join(', ') + ' (unknown pay code?)' : 'ok', true]);
  const sg = r2(emps.reduce((a, e) => a + e.gross, 0)), sd = r2(emps.reduce((a, e) => a + e.ded, 0)),
    se = r2(emps.reduce((a, e) => a + e.ee, 0)), sr = r2(emps.reduce((a, e) => a + e.er, 0));
  if (meta.grand) {
    const g = meta.grand;
    const ok = [sg, sd, se, sr].every((v, i) => Math.abs(v - g[i]) < 0.01);
    res.push(['Employees add up to the report grand totals', ok, `employees gross ${sg.toFixed(2)} ded ${sd.toFixed(2)} ee ${se.toFixed(2)} er ${sr.toFixed(2)} | report ${g.map(v => v.toFixed(2)).join(' ')}`, true]);
  } else res.push(['Employees add up to the report grand totals', false, 'grand total line not found in the PDF', true]);
  if (meta.count != null) res.push(['Employee count matches the report', meta.count === emps.length, `parsed ${emps.length}, report ${meta.count}`, true]);
  const payDebits = r2(rows.filter(r => info.some(i => r.DESCRIPTION.startsWith(i.emp + SEP))).reduce((a, r) => a + money(r.DEBITS), 0) - sr);
  res.push(['Pay lines equal report gross', Math.abs(payDebits - sg) < 0.011, `booked ${payDebits.toFixed(2)} report ${sg.toFixed(2)}`, true]);
  if (qboClasses && qboClasses.size) {
    const badc = [...new Set(rows.map(r => r.CLASS))].filter(c => !qboClasses.has(c));
    res.push(['Every class exists in the QBO class list', !badc.length, badc.join(', ') || 'ok', true]);
  } else res.push(['Every class exists in the QBO class list', true, 'skipped: no class list uploaded', false]);
  const fl = info.filter(i => i.flagged);
  res.push(['Every employee is on the Employee List', !fl.length, fl.length ? `${fl.length} not on list: ${fl.map(i => i.emp).join('; ')}` : 'ok', false]);
  if (meta.run_date) {
    const run = parseDate(meta.run_date, 'mdy'), end = parseDate(meta.period[1], 'mdy');
    res.push(['Report was run on or after the period end (final)', run >= end, `run ${meta.run_date}, period ends ${meta.period[1]}, check date ${meta.check_date}`, false]);
  }
  return res;
}

// ---------------------------------------------------------------- summaries and drafts
export function classSummary(rows) {
  const d = new Map();
  for (const r of rows) {
    const k = r.CLASS + '\u0000' + r.ACCOUNT;
    const v = d.get(k) || [r.ACCOUNT, r.CLASS, 0, 0];
    v[2] += money(r.DEBITS); v[3] += money(r.CREDITS); d.set(k, v);
  }
  return [...d.values()].map(v => [v[0], v[1], r2(v[2]), r2(v[3])]).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function emailToJonathan(meta, emps, info) {
  const fl = info.filter(i => i.flagged);
  if (!fl.length) return '';
  const by = Object.fromEntries(emps.map(e => [e.name, e]));
  const L = ['Subject: Payroll - class confirmation needed', '', 'Hi Jonathan,', '',
    `While recording the payroll for the week of ${meta.period[0]} to ${meta.period[1]}, we found the employees below who are not on our Employee List. Could you please confirm the class for each, and whether any of their pay is city-manager salary (and from what date)?`, '',
    'Employee | Pay on report | Weekly gross | Class used for now | Class? | City-manager pay?'];
  for (const i of fl) {
    const e = by[i.emp];
    L.push(`${i.emp} | ${Object.keys(e.earn).map(c => c === 'SAL' ? 'Salary' : 'Regular').join(' / ')} | ${e.gross.toFixed(2)} | ${i.cls} | | `);
  }
  L.push('', 'We have booked these provisionally to the class shown (based on their Payentry department) and will reclassify once you confirm.', '', 'Thanks,');
  return L.join('\n');
}

export function replyToLouise(meta, totals) {
  return ['Subject: Payroll recorded - week of ' + meta.period[0] + ' to ' + meta.period[1], '', 'Hi Louise,', '',
    `The payroll with check date ${meta.check_date} (gross ${totals.gross.toFixed(2)}) has been recorded in QuickBooks. Please let us know if you have any questions.`, '',
    'Thanks,'].join('\n');
}

// ---------------------------------------------------------------- reference diff
function lineKind(d) {
  const i = d.indexOf(SEP);
  const who = d.slice(0, i);
  let t = d.slice(i + SEP.length);
  t = t.replace(/ \d\d\/\d\d\/\d{4} to .*$/, '').replace(/ \(\d+\.\d+% of gross\)/, '').replace(' [class unconfirmed]', '');
  return who + '|' + t;
}

/** referenceRows: rows from a finished JE with ACCOUNT/DEBITS/CREDITS/DESCRIPTION/CLASS */
export function diffReference(rows, referenceRows) {
  const mine = new Map(rows.map(r => [lineKind(r.DESCRIPTION), [r.ACCOUNT, r.CLASS, r2(money(r.DEBITS) - money(r.CREDITS))]]));
  const out = [];
  for (const r of referenceRows) {
    const k = lineKind(r.DESCRIPTION); const m = mine.get(k);
    const ref = [r.ACCOUNT, r.CLASS, r2(money(r.DEBITS) - money(r.CREDITS))];
    const [who, what] = k.split('|');
    if (!m) { out.push([who, what, 'MISSING in this output', ref.join(' | '), '']); continue; }
    const diffs = ['account', 'class', 'amount'].filter((n, i) => m[i] !== ref[i]);
    mine.delete(k);
    if (diffs.length) out.push([who, what, diffs.join('/'), ref.join(' | '), m.join(' | ')]);
  }
  for (const [k, m] of mine) { const [who, what] = k.split('|'); out.push([who, what, 'EXTRA in this output', '', m.join(' | ')]); }
  return out;
}

/** reference sheet rows (2D) -> row objects; positional: ACCOUNT, DEBITS, CREDITS, DESCRIPTION, NAME, LOCATION, CLASS */
export function parseReferenceRows(rows2d) {
  return rows2d.slice(1).filter(r => r && r[0]).map(r => ({ ACCOUNT: String(r[0]).trim(), DEBITS: money(r[1]) || '', CREDITS: money(r[2]) || '', DESCRIPTION: String(r[3] || ''), CLASS: String(r[6] || '') }));
}

// ---------------------------------------------------------------- one call for the whole run
export function runPayroll({ lines, empListRows, classListRows, cfg, outside = {}, referenceRows2d = null }) {
  const { meta, emps } = parseReport(lines);
  const empList = parseEmployeeList(empListRows);
  const qboClasses = classListRows ? parseClassList(classListRows) : null;
  const { rows: payRows, info } = buildDetail(cfg, emps, empList, meta.period);
  let rows = payRows.slice();
  const extra = [...jaredRows(cfg, meta.period, outside.jared), ...yassineRows(cfg, meta.period, outside.yassine), ...(outside.manualCsv ? manualRows(outside.manualCsv) : [])];
  rows = rows.concat(extra);
  const [mm, dd, yy] = meta.check_date.split('/');
  const payDate = cfg.settings.journal_date_mode === 'check_date' ? meta.check_date : meta.period[1];
  const jno = `PR-${yy}-${mm}-${dd}`;
  const checks = runChecks({ meta, emps, rows, info, qboClasses });
  const diffs = referenceRows2d ? diffReference(payRows, parseReferenceRows(referenceRows2d)) : null;
  const gross = r2(emps.reduce((a, e) => a + e.gross, 0));
  return { meta, emps, rows, payRows, extraRows: extra, info, checks, diffs, payDate, jno, byClass: classSummary(rows),
    email: emailToJonathan(meta, emps, info), louise: replyToLouise(meta, { gross }) };
}

export function journalCsv(res) {
  const head = ['JournalNo', 'JournalDate', 'AccountName', 'Debits', 'Credits', 'Description', 'Name', 'Location', 'Class'];
  return toCsv([head, ...res.rows.map(r => [res.jno, res.payDate, r.ACCOUNT, r.DEBITS, r.CREDITS, r.DESCRIPTION, '', '', r.CLASS])]);
}
