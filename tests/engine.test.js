import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runPayroll, parseReport, jaredRows, yassineRows, manualRows, parseCsv, journalCsv, diffReference, r2 } from '../src/engine.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
cfg.city_managers['Bell Sam'] = { work_class: 'Chicago' };

// Made-up report in the shape Payentry prints (whitespace is not significant).
const LINES = `
Labor Distribution R   EMPIRE TOURS AND PRODUCTIONS LLC   Check Date: 01/12/2026   Page
Company (91418)   Process: 2026011201   1
Period: 01/05/2026 to 01/11/2026
Department: (100)STAFF
Cruz,   Code Earning Hours Amount Code Deduction Amount Code Tax Taxable Amount Code Tax Taxable Amount
Lee   SAL SALARY 500.00   FITW Federal Income Tax 500.00 60.00 FUTA Fed Unemployment 0.00 0.00
Emp Id 91   MED Medicare 500.00 40.00 MED-R Medicare - Employer 500.00 40.00 Gross 500.00
Salary 500.00   Tot Liab 540.00 Net Amt 400.00
Total Earnings 0.00 500.00 Total Deductions 0.00 Total Employee Taxes 100.00 Total Employer Taxes 40.00
Department: (100)STAFF Total
Department: (200)Illinois
Ames,   Code Earning Hours Amount Code Deduction Amount Code Tax Taxable Amount Code Tax Taxable Amount
Pat   REG REGULAR 400.00   FITW Federal Income Tax 400.00 20.00 FUTA Fed Unemployment 0.00 0.00
Emp Id 90   MED Medicare 400.00 30.00 MED-R Medicare - Employer 400.00 30.00 Gross 400.00
Rate 35.0000   Tot Liab 430.00 Net Amt 350.00
Total Earnings 0.00 400.00 Total Deductions 0.00 Total Employee Taxes 50.00 Total Employer Taxes 30.00
Bell,   Code Earning Hours Amount Code Deduction Amount Code Tax Taxable Amount Code Tax Taxable Amount
Sam   REG REGULAR 200.00 HEALTH Health Insurance 20.00 FITW Federal Income Tax 1180.00 90.00
Emp Id 92 SAL SALARY 1000.00   MED Medicare 1180.00 150.00 MED-R Medicare - Employer 1180.00 96.00 Gross 1200.00
Salary 1000.00   Tot Liab 1296.00
Total Earnings 0.00 1200.00 Total Deductions 20.00 Total Employee Taxes 240.00 Total Employer Taxes 96.00
Department: (200)Illinois Total
Employees 3 Code Earning Hours Amount
Total Earnings 0.00 2100.00 Total Deductions 20.00 Total Employee Taxes 390.00 Total Employer Taxes 166.00
Payentry   Run Date: 01/12/26   Run Time: 03:10 AM
`.trim().split('\n');

const EMP_LIST = [['Employee name', 'Class'], ['Ames Pat', 'Chicago'], ['Bell Sam Q', 'Chicago']];
const CLASSES = [['Company'], ['Class full name'], ['Empire Tours:Administrative'], ['Empire Tours:Chicago'], ['Empire Tours:Charleston'], ['NYC'], ['Empire Tours:London']];
const run = (extra = {}, c = cfg) => runPayroll({ lines: LINES, empListRows: EMP_LIST, classListRows: CLASSES, cfg: c, ...extra });

test('parses the report', () => {
  const { meta, emps } = parseReport(LINES);
  assert.equal(meta.check_date, '01/12/2026');
  assert.deepEqual(meta.period, ['01/05/2026', '01/11/2026']);
  assert.equal(emps.length, 3);
  assert.equal(meta.count, 3);
  const bell = emps.find(e => e.last === 'Bell');
  assert.deepEqual(bell.earn, { REG: 200, SAL: 1000 });
  assert.equal(bell.ded, 20);
  assert.equal(bell.net, 940);   // derived: gross - employee tax - deductions
});

test('journal balances and every check passes except the unknown employee', () => {
  const r = run();
  const failed = r.checks.filter(c => !c[1]).map(c => c[0]);
  assert.deepEqual(failed, ['Every employee is on the Employee List']);
  assert.equal(r2(r.rows.reduce((a, x) => a + (+x.DEBITS || 0), 0)), 2266);   // gross 2100 + employer tax 166
  assert.equal(r2(r.rows.reduce((a, x) => a + (+x.CREDITS || 0), 0)), 2266);
});

test('rules: contract labor, city manager split, admin, deductions', () => {
  const r = run();
  const f = (who, acct) => r.rows.filter(x => x.DESCRIPTION.startsWith(who) && x.ACCOUNT.startsWith(acct));
  assert.equal(f('Ames', '50005').map(x => +x.DEBITS).join(), '400,30');            // pay + tax follow the pay
  assert.equal(f('Bell', '66000.1')[0].DEBITS, 1000);
  assert.equal(f('Bell', '50005').map(x => +x.DEBITS).join(), '200,16');            // 200/1200 of 96
  assert.equal(f('Bell', '67610.1')[0].DEBITS, 80);                                // remainder
  assert.equal(f('Bell', '60100')[0].CREDITS, 20);                                 // deduction is a credit
  assert.equal(f('Cruz', '66020')[0].DEBITS, 500);                                 // unknown -> STAFF -> Admin
  assert.equal(f('Cruz', '67610 ')[0].DEBITS, 40);
  assert.ok(f('Cruz', '66020')[0].DESCRIPTION.includes('[class unconfirmed]'));
  assert.ok(r.email.includes('Cruz, Lee'));
});

test('tax_follows_pay=false keeps contract-labor tax in 67610 (pre 15 Oct rule)', () => {
  const c = structuredClone(cfg); c.settings.tax_follows_pay = false;
  const r = run({}, c);
  assert.equal(r.rows.filter(x => x.DESCRIPTION.startsWith('Ames') && x.ACCOUNT.startsWith('67610 ')).length, 1);
});

test('unmapped class fails the class check', () => {
  const list = [['Employee name', 'Class'], ['Ames Pat', 'Mars'], ['Bell Sam', 'Chicago']];
  const r = runPayroll({ lines: LINES, empListRows: list, classListRows: CLASSES, cfg });
  assert.equal(r.checks.find(c => c[0].startsWith('Every class')).at(1), false);
});

test('unknown pay code is caught by the earnings check', () => {
  const lines = LINES.map(l => l.replace('Rate 35.0000', 'Rate 35.0000').replace('REG REGULAR 400.00', 'OT OVERTIME 400.00'));
  const r = runPayroll({ lines, empListRows: EMP_LIST, classListRows: CLASSES, cfg });
  assert.equal(r.checks.find(c => c[0].startsWith('Every pay code')).at(1), false);
});

test('report with a missing grand total refuses to tie out', () => {
  const lines = LINES.filter(l => !l.startsWith('Total Earnings 0.00 2100.00'));
  const r = runPayroll({ lines, empListRows: EMP_LIST, classListRows: CLASSES, cfg });
  assert.equal(r.checks.some(c => c[3] && !c[1]), true);
});

test('Jared Wiseman split', () => {
  const sum = rows => rows.filter(x => x.DEBITS).map(x => `${x.CLASS}:${x.ACCOUNT.split(' ')[0]}:${x.DEBITS}`).join(' ');
  const p = ['09/21/2026', '09/27/2026'];
  assert.equal(sum(jaredRows(cfg, p, 900)), 'NYC:66000.1:500 Empire Tours:Charleston:66000.1:200 NYC:50005:200');
  assert.equal(sum(jaredRows(cfg, p, 650)), 'NYC:66000.1:500 NYC:50005:150');
  assert.equal(sum(jaredRows(cfg, p, 300)), 'NYC:50005:300');
  assert.equal(sum(jaredRows(cfg, ['09/14/2026', '09/20/2026'], 900)), 'NYC:66000.1:500 NYC:50005:400');   // before Charleston starts
  const all = jaredRows(cfg, p, 900);
  assert.equal(all.reduce((a, x) => a + (+x.DEBITS || 0), 0), all.reduce((a, x) => a + (+x.CREDITS || 0), 0));
});

test('Yassine, manual lines and outside rows stay balanced in the run', () => {
  assert.equal(yassineRows(cfg, ['01/05/2026', '01/11/2026'], 400)[0].CLASS, 'Empire Tours:London');
  const csv = 'account,class,debit,credit,description\n66020 Payroll expenses:Salaries & wages,Empire Tours:Administrative,"1,000.00",,Deel gross\n21040 Accrued Payroll Liabilities,Empire Tours:Administrative,,1000,Deel net';
  assert.equal(manualRows(csv).length, 2);
  const r = run({ outside: { jared: 700, yassine: 400, manualCsv: csv } });
  assert.ok(r.checks.find(c => c[0] === 'Debits equal credits')[1]);
  assert.equal(r.rows.length, r.payRows.length + r.extraRows.length);
});

test('QBO csv escapes commas and quotes', () => {
  const r = run();
  const csv = journalCsv(r);
  const back = parseCsv(csv);
  assert.equal(back.length, r.rows.length + 1);
  assert.equal(back[1][5], r.rows[0].DESCRIPTION);
});

test('diff against a finished journal reports only real differences', () => {
  const r = run();
  const ref = r.payRows.map(x => ({ ...x }));
  assert.equal(diffReference(r.payRows, ref).length, 0);
  ref[0].ACCOUNT = '99999 Wrong';
  assert.equal(diffReference(r.payRows, ref).length, 1);
});
