// Генерирует синтетические демо-PDF (без персональных данных) для тестов и скриншотов.
// Запуск: node dev/make-demo.js
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('../vendor/pdf-lib.min.js');
const core = require('../src/orient-core.js');

const OUT = path.join(__dirname, 'fixtures');
const BLACK = rgb(0.1, 0.12, 0.14);
const GRAY = rgb(0.45, 0.47, 0.5);
const LINE = rgb(0.55, 0.57, 0.6);
const HEAD = rgb(0.93, 0.94, 0.95);

const W = core.PAPER.A4.height; // 841.89
const H = core.PAPER.A4.width; // 595.28

function money(n) {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

async function buildAlbum() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const T = (text, x, y, size, f, color) =>
    page.drawText(text, { x, y, size, font: f || font, color: color || BLACK });

  // Шапка
  T('COMMERCIAL INVOICE', 40, H - 58, 22, bold);
  T('INVOICE No. 1024', 610, H - 46, 11, bold);
  T('Date: 12.01.2026', 610, H - 62, 10, font, GRAY);
  T('Due date: 26.01.2026', 610, H - 76, 10, font, GRAY);

  page.drawLine({ start: { x: 40, y: H - 88 }, end: { x: W - 40, y: H - 88 }, thickness: 1.2, color: BLACK });

  // Продавец / покупатель
  T('SELLER', 40, H - 108, 9, bold);
  T('Example Trading LLC', 40, H - 122, 10);
  T('1 Sample Street, Demo City, 100000', 40, H - 136, 9, font, GRAY);
  T('VAT ID: 0000000000', 40, H - 150, 9, font, GRAY);

  T('BUYER', 330, H - 108, 9, bold);
  T('Sample Buyer Ltd', 330, H - 122, 10);
  T('42 Test Avenue, Demo Town, 200000', 330, H - 136, 9, font, GRAY);
  T('VAT ID: 1111111111', 330, H - 150, 9, font, GRAY);

  T('Payment terms: bank transfer, 14 days', 610, H - 122, 9, font, GRAY);
  T('Currency: USD', 610, H - 136, 9, font, GRAY);
  T('Page 1 of 1', 610, H - 150, 9, font, GRAY);

  // Таблица
  const x0 = 40;
  const widths = [36, 200, 64, 56, 84, 96, 64, 96, 64];
  const cols = widths.map((w, i) => x0 + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const xs = cols.concat([cols[cols.length - 1] + widths[widths.length - 1]]);
  const top = H - 180;
  const headH = 46;

  page.drawRectangle({ x: x0, y: top - headH, width: xs[xs.length - 1] - x0, height: headH, color: HEAD });

  const headers = [
    'No.',
    'Description',
    'Qty',
    'Unit',
    'Unit price',
    'Net amount',
    'VAT %',
    'Gross amount',
    'Code',
  ];
  headers.forEach((h, i) => {
    const label = h.length > 12 ? h : h;
    T(label, xs[i] + 5, top - headH + (h.length > 12 ? 26 : 18), 7.6, bold, BLACK);
  });

  const items = [
    ['Widget A-100, stainless steel, 12 mm', 2, 'pcs', 125.0],
    ['Bracket B-200, powder coated', 4, 'pcs', 18.5],
    ['Cable C-300, 5 m, shielded', 1, 'set', 74.9],
    ['Adapter D-400, 220 V', 3, 'pcs', 32.0],
    ['Installation and setup service', 1, 'job', 240.0],
  ];

  const rowH = 38;
  let y = top - headH;
  page.drawLine({ start: { x: x0, y: top }, end: { x: xs[xs.length - 1], y: top }, thickness: 0.9, color: LINE });
  page.drawLine({ start: { x: x0, y: top - headH }, end: { x: xs[xs.length - 1], y: top - headH }, thickness: 0.9, color: LINE });

  let net = 0;
  items.forEach(([desc, qty, unit, price], idx) => {
    const amount = qty * price;
    net += amount;
    const rowTop = y;
    const rowBottom = y - rowH;
    T(String(idx + 1), xs[0] + 6, rowBottom + 16, 9);
    T(desc, xs[1] + 5, rowBottom + 16, 9);
    T(String(qty), xs[2] + 6, rowBottom + 16, 9);
    T(unit, xs[3] + 5, rowBottom + 16, 9);
    T(money(price), xs[4] + 5, rowBottom + 16, 9);
    T(money(amount), xs[5] + 5, rowBottom + 16, 9);
    T('20', xs[6] + 6, rowBottom + 16, 9);
    T(money(amount * 1.2), xs[7] + 5, rowBottom + 16, 9);
    T('000' + (idx + 1), xs[8] + 5, rowBottom + 16, 9);
    page.drawLine({ start: { x: x0, y: rowBottom }, end: { x: xs[xs.length - 1], y: rowBottom }, thickness: 0.6, color: LINE });
    y = rowBottom;
  });

  // Вертикальные линии
  for (const gx of xs) {
    page.drawLine({ start: { x: gx, y: top }, end: { x: gx, y: y }, thickness: 0.6, color: LINE });
  }

  // Итоги
  const vat = net * 0.2;
  T('Subtotal (net):', xs[4] + 4, y - 26, 9, bold);
  T(money(net), xs[5] + 5, y - 26, 9);
  T('VAT 20%:', xs[4] + 4, y - 42, 9);
  T(money(vat), xs[5] + 5, y - 42, 9);
  T('TOTAL DUE:', xs[4] + 4, y - 58, 10, bold);
  T(money(net + vat), xs[5] + 5, y - 58, 10, bold);
  T('Amount due: USD ' + money(net + vat), xs[6] + 5, y - 58, 9, bold);

  // Подписи и сноска
  page.drawLine({ start: { x: 40, y: 74 }, end: { x: 360, y: 74 }, thickness: 0.8, color: LINE });
  T('Authorized signature / company stamp', 40, 60, 8.5, font, GRAY);
  page.drawLine({ start: { x: 500, y: 74 }, end: { x: 800, y: 74 }, thickness: 0.8, color: LINE });
  T('Received by (name, date)', 500, 60, 8.5, font, GRAY);
  T('Demo document generated for the PDF-orientation project. Any resemblance to real invoices is accidental.', 40, 30, 7.5, font, GRAY);

  return doc;
}

// «Книжная» версия: тот же бланк, ужатый по ширине листа и прижатый к верху.
async function buildBook(album, name) {
  const book = await PDFDocument.create();
  const page = book.addPage([core.PAPER.A4.width, core.PAPER.A4.height]); // 595.28 x 841.89
  const src = album.getPage(0);
  const emb = await book.embedPage(src);
  const drawW = core.PAPER.A4.width;
  const drawH = (drawW * H) / W; // 420.9
  page.drawPage(emb, { x: 0, y: core.PAPER.A4.height - drawH, width: drawW, height: drawH });
  return { doc: book, bbox: { x0: 0, y0: core.PAPER.A4.height - drawH, x1: drawW, y1: core.PAPER.A4.height } };
}

// «Боком»: книжная страница, но текст повёрнут на 90° (кривой экспорт/скан с текстовым слоем).
async function buildSideways() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([core.PAPER.A4.width, core.PAPER.A4.height]); // 595 x 842
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawText('ROTATED PAGE', {
    x: 90, y: 700, size: 30, font: bold, rotate: degrees(90),
  });
  for (let i = 0; i < 6; i++) {
    page.drawText('Sideways text line ' + (i + 1) + ' — the app should rotate this page automatically', {
      x: 120 + i * 70, y: 120, size: 12, font, rotate: degrees(90),
    });
  }
  return doc;
}

// Обычный портретный документ — автоподбор не должен его трогать.
async function buildNormalPortrait() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([core.PAPER.A4.width, core.PAPER.A4.height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawText('Project status report', { x: 60, y: 770, size: 20, font: bold });
  const lines = [
    'This is a regular portrait document. It has a title, a few paragraphs',
    'of text and a small table. The content is narrower than the page, so',
    'there is no reason to rotate anything: the app should leave it as is.',
    'A wide image or a short banner does not make a document landscape.',
  ];
  lines.forEach((line, i) => {
    page.drawText(line, { x: 60, y: 720 - i * 22, size: 11, font });
  });

  const x0 = 60;
  const widths = [40, 220, 70, 70];
  const xs = [x0];
  for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const top = 600;
  const rowH = 26;
  for (let i = 0; i < 5; i++) {
    const y = top - i * rowH;
    page.drawLine({ start: { x: x0, y: y }, end: { x: xs[xs.length - 1], y: y }, thickness: 0.6, color: LINE });
  }
  for (const x of xs) {
    page.drawLine({ start: { x: x, y: top }, end: { x: x, y: top - 4 * rowH }, thickness: 0.6, color: LINE });
  }
  page.drawText('Item', { x: x0 + 5, y: top - 18, size: 9, font: bold });
  page.drawText('Description', { x: xs[1] + 5, y: top - 18, size: 9, font: bold });
  page.drawText('Qty', { x: xs[2] + 5, y: top - 18, size: 9, font: bold });
  page.drawText('Price', { x: xs[3] + 5, y: top - 18, size: 9, font: bold });
  for (let i = 0; i < 3; i++) {
    const y = top - rowH * (i + 1) - 18;
    page.drawText(String(i + 1), { x: x0 + 5, y, size: 9, font });
    page.drawText('Regular line item ' + (i + 1), { x: xs[1] + 5, y, size: 9, font });
    page.drawText(String(i + 1), { x: xs[2] + 5, y, size: 9, font });
    page.drawText((10 + i * 5).toFixed(2), { x: xs[3] + 5, y, size: 9, font });
  }
  return doc;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const album = await buildAlbum();
  const albumBytes = await album.save();
  fs.writeFileSync(path.join(OUT, 'album-invoice.pdf'), albumBytes);
  console.log('album-invoice.pdf', albumBytes.length);

  const book = await buildBook(await PDFDocument.load(albumBytes), 'book');
  fs.writeFileSync(path.join(OUT, 'book-invoice.pdf'), await book.doc.save());

  const book2 = await PDFDocument.create();
  book2.addPage((await book2.copyPages(book.doc, [0]))[0]);
  book2.addPage((await book2.copyPages(book.doc, [0]))[0]);
  fs.writeFileSync(path.join(OUT, 'book2.pdf'), await book2.save());

  const mixed = await PDFDocument.create();
  mixed.addPage((await mixed.copyPages(book.doc, [0]))[0]);
  mixed.addPage((await mixed.copyPages(album, [0]))[0]);
  mixed.addPage((await mixed.copyPages(book.doc, [0]))[0]);
  fs.writeFileSync(path.join(OUT, 'mixed.pdf'), await mixed.save());

  const sideways = await buildSideways();
  fs.writeFileSync(path.join(OUT, 'sideways.pdf'), await sideways.save());

  const normal = await buildNormalPortrait();
  fs.writeFileSync(path.join(OUT, 'normal-portrait.pdf'), await normal.save());

  console.log('fixtures готовы:', fs.readdirSync(OUT).join(', '));
  console.log('bbox книжной страницы:', book.bbox);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
