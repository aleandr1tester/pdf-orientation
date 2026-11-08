// Проверка поворотов: строим 4 варианта из синтетического альбомного бланка.
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const core = require('../src/orient-core.js');

const IN = process.argv[2] || path.join(__dirname, 'fixtures', 'album-invoice.pdf');
const OUTDIR = path.join(__dirname, 'out', 'rotations');
const MM = 72 / 25.4;

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const bytes = fs.readFileSync(IN);
  const bbox = { x0: 0, y0: 0, x1: core.PAPER.A4.height, y1: core.PAPER.A4.width };

  const variants = [
    { name: 'rot0', rotate: 0, pageWidth: core.PAPER.A4.height, pageHeight: core.PAPER.A4.width, fit: 'contain' },
    { name: 'rot90', rotate: 90, pageWidth: core.PAPER.A4.width, pageHeight: core.PAPER.A4.height, fit: 'contain' },
    { name: 'rot180', rotate: 180, pageWidth: core.PAPER.A4.height, pageHeight: core.PAPER.A4.width, fit: 'contain' },
    { name: 'rot270', rotate: 270, pageWidth: core.PAPER.A4.width, pageHeight: core.PAPER.A4.height, fit: 'contain' },
    { name: 'width', rotate: 0, pageWidth: core.PAPER.A4.height, pageHeight: core.PAPER.A4.width, fit: 'width' },
  ];

  for (const v of variants) {
    const doc = await PDFDocument.load(bytes);
    const st = { bbox, pageWidth: v.pageWidth, pageHeight: v.pageHeight, rotate: v.rotate, fit: v.fit, margin: 5 * MM };
    core.applyToDocument(doc, [st]);
    const out = path.join(OUTDIR, v.name + '.pdf');
    fs.writeFileSync(out, await doc.save());
    const p = doc.getPage(0);
    console.log(v.name, p.getWidth().toFixed(1), p.getHeight().toFixed(1));
    if (Math.abs(p.getWidth() - v.pageWidth) > 0.5 || Math.abs(p.getHeight() - v.pageHeight) > 0.5) {
      throw new Error('Неверный размер листа в ' + v.name);
    }
  }
  console.log('OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
