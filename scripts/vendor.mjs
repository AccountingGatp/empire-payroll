// Copies the browser builds of pdf.js and SheetJS into /vendor so the app has no CDN dependency.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'vendor');
fs.mkdirSync(out, { recursive: true });
const copy = (from, to) => { fs.copyFileSync(from, path.join(out, to)); console.log('vendored', to); };
copy(path.join(nm, 'pdfjs-dist/build/pdf.min.mjs'), 'pdf.min.mjs');
copy(path.join(nm, 'pdfjs-dist/build/pdf.worker.min.mjs'), 'pdf.worker.min.mjs');
copy(path.join(nm, 'xlsx/dist/xlsx.full.min.js'), 'xlsx.full.min.js');
for (const f of ['pdfjs-dist/LICENSE', 'xlsx/LICENSE']) {
  const dest = f.split('/')[0] + '.LICENSE.txt';
  if (fs.existsSync(path.join(nm, f))) copy(path.join(nm, f), dest);
}
