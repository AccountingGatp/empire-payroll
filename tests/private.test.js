// Runs only when you put real files in tests/private/ (ignored by Git). Never commit payroll data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfToLines } from '../src/pdflines.js';
import { runPayroll } from '../src/engine.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'private');
const has = f => fs.existsSync(path.join(dir, f));
const rows = f => { const wb = XLSX.read(fs.readFileSync(path.join(dir, f))); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); };
const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));

test('real files: every critical check passes', { skip: !(has('report.pdf') && has('employee_list.xlsx')) }, async () => {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, 'report.pdf'))), useSystemFonts: true }).promise;
  const lines = await pdfToLines(doc);
  const r = runPayroll({ lines, empListRows: rows('employee_list.xlsx'), classListRows: has('class_list.xlsx') ? rows('class_list.xlsx') : null, cfg, referenceRows2d: has('reference_je.xls') ? rows('reference_je.xls') : null });
  const failed = r.checks.filter(c => c[3] && !c[1]);
  assert.deepEqual(failed, []);
});
