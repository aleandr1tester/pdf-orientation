// Node-проверка геометрии: «книжный» бланк -> альбомный лист (синтетический демо-PDF).
// Запуск: node dev/test-core.js [вход.pdf] [выход.pdf]
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const core = require('../src/orient-core.js');

const IN = process.argv[2] || path.join(__dirname, 'fixtures', 'book-invoice.pdf');
const OUT = process.argv[3] || path.join(__dirname, 'out', 'book-invoice-landscape.pdf');

const MM = 72 / 25.4;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const bytes = fs.readFileSync(IN);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const view = core.pageViewRect(page);
  console.log('page size', page.getWidth(), page.getHeight(), 'view', view);

  // Синтетическая «книжная» страница: бланк прижат к верху, ширина = ширине листа.
  const bbox = IN.includes('book-invoice')
    ? { x0: 0, y0: 420.98, x1: 595.28, y1: 841.89 }
    : view;

  const st = {
    bbox,
    pageWidth: core.PAPER.A4.height, // альбомный A4
    pageHeight: core.PAPER.A4.width,
    rotate: 0,
    fit: 'contain',
    margin: 5 * MM,
  };
  const placement = core.computePlacement(st.bbox, st);
  console.log('placement', { scale: placement.scale, box: placement.box, matrix: placement.matrix });
  core.applyToDocument(doc, [st]);
  fs.writeFileSync(OUT, await doc.save());
  const outPage = doc.getPage(0);
  console.log('result size', outPage.getWidth(), outPage.getHeight(), 'rotation', outPage.getRotation().angle);
  console.log('saved', OUT, fs.statSync(OUT).size);

  if (Math.abs(outPage.getWidth() - core.PAPER.A4.height) > 0.5) throw new Error('Неверная ширина результата');
  if (Math.abs(outPage.getHeight() - core.PAPER.A4.width) > 0.5) throw new Error('Неверная высота результата');
  if (placement.scale < 1.25 || placement.scale > 1.45) throw new Error('Неожиданный масштаб: ' + placement.scale);
  console.log('OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
