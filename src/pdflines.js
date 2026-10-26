// Rebuilds visual text lines from a pdf.js document (browser or Node).
// Items on the same baseline (within `tol` points) form one line; items are joined left to right.
export async function pdfToLines(pdfDoc, tol = 2.5) {
  const lines = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str !== undefined && i.str.trim() !== '' )
      .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows.find(r => Math.abs(r.y - it.y) <= tol);
      if (row) { row.items.push(it); } else rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let out = '', end = null;
      for (const it of r.items) {
        if (end === null) out = it.s;
        else out += (it.x - end > 1.0 ? ' ' : '') + it.s;
        end = it.x + it.w;
      }
      lines.push(out);
    }
    lines.push('\f'); // page break marker
  }
  return lines;
}
