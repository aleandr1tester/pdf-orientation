/*
 * orient-core.js — геометрия смены ориентации PDF-страниц.
 *
 * Работает и в браузере (window.OrientCore, глобал PDFLib), и в Node (require('pdf-lib')).
 * Ничего не рисует: только считает матрицы и переписывает страницы через pdf-lib.
 *
 * Единицы — типографские пункты (1/72 дюйма), как в PDF.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let lib;
    try {
      lib = require('pdf-lib');
    } catch (e) {
      lib = require('../vendor/pdf-lib.min.js'); // локальная копия для проверок из Node
    }
    module.exports = factory(lib);
  } else {
    root.OrientCore = factory(root.PDFLib);
  }
})(typeof self !== 'undefined' ? self : this, function (PDFLib) {
  'use strict';

  const MM = 72 / 25.4; // миллиметры -> пункты
  const PDFName = PDFLib.PDFName;

  // Стандартные размеры листа в пунктах (ширина x высота, книжная ориентация).
  const PAPER = {
    A3: { width: 841.89, height: 1190.55 },
    A4: { width: 595.28, height: 841.89 },
    A5: { width: 419.53, height: 595.28 },
    Letter: { width: 612.0, height: 792.0 },
  };

  const normAngle = (deg) => {
    const d = Math.round(Number(deg) || 0);
    return ((d % 360) + 360) % 360;
  };

  // Поворот содержимого в градусах против часовой стрелки,
  // который нужно применить, чтобы после сброса /Rotate страница выглядела как раньше.
  const bakeRotate = (pageRotate) => normAngle(360 - normAngle(pageRotate));

  /**
   * Считает размещение содержимого на новом листе.
   *
   * @param {{x0:number,y0:number,x1:number,y1:number}} bbox  видимое содержимое в координатах страницы (без /Rotate)
   * @param {object} opts
   *   pageWidth, pageHeight — размер нового листа (пункты)
   *   rotate  — дополнительный поворот содержимого, градусы ПРОТИВ часовой стрелки (0/90/180/270)
   *   fit     — 'contain' (вписать целиком) | 'width' (по ширине) | 'none' (1:1)
   *   margin  — поля в пунктах (с каждой стороны)
   */
  function computePlacement(bbox, opts) {
    const W = Number(opts.pageWidth);
    const H = Number(opts.pageHeight);
    const margin = Math.max(0, Number(opts.margin) || 0);
    const rotate = normAngle(opts.rotate);
    const fit = opts.fit || 'contain';

    const x0 = Number(bbox.x0);
    const y0 = Number(bbox.y0);
    const w = Math.max(0.01, Number(bbox.x1) - x0);
    const h = Math.max(0.01, Number(bbox.y1) - y0);

    const swap = rotate === 90 || rotate === 270;
    const cw = swap ? h : w; // габариты содержимого после поворота
    const ch = swap ? w : h;

    const availW = Math.max(0.5, W - 2 * margin);
    const availH = Math.max(0.5, H - 2 * margin);

    let scale;
    if (fit === 'none') scale = 1;
    else if (fit === 'width') scale = availW / cw;
    else scale = Math.min(availW / cw, availH / ch);

    const cos = Math.cos((rotate * Math.PI) / 180);
    const sin = Math.sin((rotate * Math.PI) / 180);

    // Куда встанет повёрнутое содержимое (до центрирования): углы (0,0)..(w,h).
    let minx = Infinity;
    let miny = Infinity;
    for (const [u, v] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const x = u * scale;
      const y = v * scale;
      const rx = cos * x - sin * y;
      const ry = sin * x + cos * y;
      if (rx < minx) minx = rx;
      if (ry < miny) miny = ry;
    }

    const left = (W - cw * scale) / 2;
    const bottom = (H - ch * scale) / 2;
    const tx = left - minx;
    const ty = bottom - miny;

    // M = T(tx,ty) · S(scale) · R(rotate) · T(-x0,-y0)
    const a = scale * cos;
    const b = scale * sin;
    const c = -scale * sin;
    const d = scale * cos;
    const e = tx - (a * x0 + c * y0);
    const f = ty - (b * x0 + d * y0);

    return {
      matrix: [a, b, c, d, e, f],
      pageWidth: W,
      pageHeight: H,
      scale,
      rotate,
      margin,
      contentWidth: cw * scale,
      contentHeight: ch * scale,
      // прямоугольник, который займёт содержимое на новом листе (для рамок/подсказок)
      box: { x: left, y: bottom, width: cw * scale, height: ch * scale },
    };
  }

  // Рамка видимой области страницы (без /Rotate) — из CropBox/MediaBox.
  function pageViewRect(page) {
    let rect = null;
    if (typeof page.getCropBox === 'function') rect = page.getCropBox();
    if (!rect && typeof page.getMediaBox === 'function') rect = page.getMediaBox();
    if (!rect) throw new Error('Не удалось определить размер страницы.');
    return { x0: rect.x, y0: rect.y, x1: rect.x + rect.width, y1: rect.y + rect.height };
  }

  /**
   * Переписывает одну страницу: сбрасывает /Rotate, подставляет матрицу
   * к содержимому и задаёт новый размер листа.
   */
  function applyPlacement(doc, page, placement) {
    page.node.normalize();

    const [a, b, c, d, e, f] = placement.matrix;
    const m = (n) => (Math.abs(n) < 1e-9 ? '0' : String(Number(n.toFixed(6))));
    const prefix = doc.context.stream('q\n' + [a, b, c, d, e, f].map(m).join(' ') + ' cm\n');
    const suffix = doc.context.stream('\nQ\n');

    // У пустой страницы может не быть /Contents — создаём пустой массив.
    if (!page.node.Contents()) {
      page.node.set(PDFName.of('Contents'), doc.context.obj([]));
    }

    const ok = page.node.wrapContentStreams(doc.context.register(prefix), doc.context.register(suffix));
    if (!ok) throw new Error('Не удалось обернуть содержимое страницы (Contents не массив).');

    page.setMediaBox(0, 0, placement.pageWidth, placement.pageHeight);
    page.setCropBox(0, 0, placement.pageWidth, placement.pageHeight);
    // Прочие рамки, если они были, тоже приводим к новому листу, иначе печать может обрезать.
    const node = page.node;
    if (node.BleedBox && node.BleedBox()) page.setBleedBox(0, 0, placement.pageWidth, placement.pageHeight);
    if (node.TrimBox && node.TrimBox()) page.setTrimBox(0, 0, placement.pageWidth, placement.pageHeight);
    if (node.ArtBox && node.ArtBox()) page.setArtBox(0, 0, placement.pageWidth, placement.pageHeight);
    page.setRotation(PDFLib.degrees(0));

    // Аннотации (штампы, ссылки, поля) — хотя бы переставляем их рамки.
    try {
      transformAnnotationRects(doc, page, placement.matrix);
    } catch (err) {
      // не критично для печати
    }
    return placement;
  }

  // Пересчитывает /Rect аннотаций той же матрицей, что и содержимое.
  function transformAnnotationRects(doc, page, matrix) {
    const annots = page.node.Annots ? page.node.Annots() : null;
    if (!annots || typeof annots.size !== 'function') return;
    const [a, b, c, d, e, f] = matrix;
    for (let i = 0; i < annots.size(); i++) {
      const dict = doc.context.lookup(annots.get(i));
      if (!dict || typeof dict.lookup !== 'function') continue;
      const rect = dict.lookup(PDFName.of('Rect'));
      if (!rect || typeof rect.size !== 'function' || rect.size() !== 4) continue;
      const v = [0, 1, 2, 3].map((k) => {
        const n = rect.lookup(k);
        return n && typeof n.asNumber === 'function' ? n.asNumber() : NaN;
      });
      if (v.some((n) => !isFinite(n))) continue;
      const pts = [
        [v[0], v[1]],
        [v[2], v[1]],
        [v[0], v[3]],
        [v[2], v[3]],
      ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      dict.set(
        PDFName.of('Rect'),
        doc.context.obj([Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)])
      );
    }
  }

  /**
   * Применяет настройки ко всем страницам документа.
   * settings[i] = { bbox, pageWidth, pageHeight, rotate, fit, margin }
   */
  function applyToDocument(doc, settings) {
    const pages = doc.getPages();
    if (pages.length !== settings.length) {
      throw new Error('Количество настроек не совпадает с количеством страниц.');
    }
    return pages.map((page, i) => {
      const st = settings[i];
      if (!st) return null; // страница не меняется — не трогаем её вовсе
      const placement = computePlacement(st.bbox, st);
      applyPlacement(doc, page, placement);
      return placement;
    });
  }

  return {
    MM,
    PAPER,
    normAngle,
    bakeRotate,
    computePlacement,
    pageViewRect,
    applyPlacement,
    applyToDocument,
  };
});
