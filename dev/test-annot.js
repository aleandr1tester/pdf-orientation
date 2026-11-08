// Проверки: пустая страница и пересчёт /Rect аннотаций.
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const core = require('../src/orient-core.js');

(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]); // пустая страница
  const page = doc.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 400, y: 40, width: 100, height: 40 });
  const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [400, 40, 500, 80], Border: [0, 0, 0] });
  page.node.addAnnot(doc.context.register(annot));

  const bbox = { x0: 20, y0: 500, x1: 560, y1: 820 };
  const settings = [
    { bbox: { x0: 0, y0: 0, x1: 595.28, y1: 841.89 }, pageWidth: 841.89, pageHeight: 595.28, rotate: 0, fit: 'contain', margin: 14 },
    { bbox, pageWidth: 841.89, pageHeight: 595.28, rotate: 0, fit: 'contain', margin: 14 },
  ];
  core.applyToDocument(doc, settings);

  const out = path.join(__dirname, 'out', 'annot.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await doc.save());

  const reloaded = await PDFDocument.load(fs.readFileSync(out));
  const p = reloaded.getPage(1);
  const annots = p.node.Annots();
  const dict = reloaded.context.lookup(annots.get(0));
  const rect = dict.lookup(PDFLibName('Rect'));
  console.log('blank page size', reloaded.getPage(0).getWidth(), reloaded.getPage(0).getHeight());
  console.log('annot rect in output', [0, 1, 2, 3].map((i) => rect.lookup(i).asNumber()));

  // Ожидаем: исходный /Rect (400,40,500,80) -> масштаб s, смещение.
  const pl = core.computePlacement(bbox, settings[1]);
  const [a, b, c, d, e, f] = pl.matrix;
  const pts = [[400, 40], [500, 40], [400, 80], [500, 80]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  console.log('expected rect', [
    Math.min(...xs).toFixed(2),
    Math.min(...ys).toFixed(2),
    Math.max(...xs).toFixed(2),
    Math.max(...ys).toFixed(2),
  ]);
  console.log('saved', out);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function PDFLibName(n) {
  const lib = require('../vendor/pdf-lib.min.js');
  return lib.PDFName.of(n);
}
