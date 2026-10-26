// Works out what an uploaded file is, so people can drop everything at once.
// rows: first rows of the first sheet (2D array) or null for a PDF.
export function detectKind(fileName, rows) {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  const cells = (rows || []).slice(0, 12).flat().map(c => String(c ?? '').toLowerCase());
  const has = s => cells.some(c => c.includes(s));
  if (has('account') && has('debits') && has('credits')) return 'ref';
  if (has('employee name')) return 'emp';
  if (has('class full name') || cells.some(c => c.startsWith('empire tours:'))) return 'cls';
  if (/class/.test(name)) return 'cls';
  if (/employee/.test(name)) return 'emp';
  if (/(^|[^a-z])(je|journal)([^a-z]|$)/.test(name)) return 'ref';
  return null;
}
