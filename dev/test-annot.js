// Проверки: пустая страница, пересчёт /Rect, /QuadPoints и /InkList аннотаций.
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName } = require('../vendor/pdf-lib.min.js');
const core = require('../src/orient-core.js');

(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]); // пустая страница

  const page = doc.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 400, y: 40, width: 100, height: 40 });

  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [400, 40, 500, 80],
    Border: [0, 0, 0],
    QuadPoints: [400, 80, 500, 80, 400, 40, 500, 40],
    InkList: [[400, 40, 420, 60, 440, 40], [460, 70, 480, 75]],
  });
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
  const dict = reloaded.context.lookup(p.node.Annots().get(0));
  const numbers = (name) => {
    const arr = dict.lookup(PDFName.of(name));
    if (!arr || typeof arr.size !== 'function') return null;
    const result = [];
    for (let i = 0; i < arr.size(); i++) {
      const el = arr.lookup(i);
      if (el && typeof el.asNumber === 'function') result.push(el.asNumber());
      else if (el && typeof el.size === 'function') {
        const sub = [];
        for (let j = 0; j < el.size(); j++) sub.push(el.lookup(j).asNumber());
        result.push(sub);
      }
    }
    return result;
  };

  const [a, b, c, d, e, f] = core.computePlacement(bbox, settings[1]).matrix;
  const point = (x, y) => [a * x + c * y + e, b * x + d * y + f];
  const close = (v1, v2) => Math.abs(v1 - v2) < 0.05;

  console.log('blank page size', reloaded.getPage(0).getWidth(), reloaded.getPage(0).getHeight());

  const rect = numbers('Rect');
  const expectedRect = [point(400, 40), point(500, 80)];
  console.log('annot rect', rect.map((n) => +n.toFixed(2)));
  if (!close(rect[0], Math.min(expectedRect[0][0], expectedRect[1][0]))) throw new Error('Rect x0');
  if (!close(rect[3], Math.max(expectedRect[0][1], expectedRect[1][1]))) throw new Error('Rect y1');

  const quad = numbers('QuadPoints');
  console.log('quadpoints', quad.map((n) => +n.toFixed(2)));
  if (quad.length !== 8) throw new Error('QuadPoints потеряны');
  if (!close(quad[0], point(400, 80)[0]) || !close(quad[1], point(400, 80)[1])) throw new Error('QuadPoints не пересчитаны');

  const ink = numbers('InkList');
  console.log('inklist', JSON.stringify(ink.map((stroke) => stroke.map((n) => +n.toFixed(2)))));
  if (!ink || ink.length !== 2) throw new Error('InkList потерян');
  if (!close(ink[0][0], point(400, 40)[0])) throw new Error('InkList не пересчитан');

  console.log('OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
