/*
 * orient-core.js — «математика» смены ориентации: от рамки содержимого до готовой PDF-страницы.
 *
 * Модуль намеренно не зависит от DOM, интерфейса и pdf.js:
 *   вход  — документ pdf-lib + настройки страницы (bbox, размер листа, угол, режим масштаба, поля);
 *   выход — та же страница, но содержимое обёрнуто в матрицу преобразования, а MediaBox/CropBox
 *           заменены на новый лист. Векторы и шрифты не пересжимаются.
 *
 * Системы координат и соглашения:
 *   • PDF: начало координат в левом нижнем углу страницы, ось Y вверх, единицы — пункты (1/72 дюйма).
 *   • bbox — рамка видимого содержимого в СЫРЫХ координатах страницы, то есть без учёта /Rotate.
 *     Влияние /Rotate отдельно компенсирует bakeRotate(): после сброса /Rotate страница
 *     должна выглядеть так же, как выглядела раньше.
 *   • Все углы — в градусах ПРОТИВ часовой стрелки (0/90/180/270).
 *   • Матрица PDF записывается шестью числами [a b c d e f] и действует как
 *     x' = a*x + c*y + e, y' = b*x + d*y + f.
 *
 * Итоговое преобразование страницы: M = T(tx,ty) · S(scale) · R(rotate) · T(-x0,-y0),
 * то есть сначала bbox сдвигается в начало координат, затем масштабируется, поворачивается
 * и центрируется на новом листе. Подробности — в computePlacement().
 *
 * UMD-обёртка ниже позволяет использовать один и тот же код в браузере (window.OrientCore)
 * и в Node-тестах (require('pdf-lib') или локальный vendor/pdf-lib.min.js).
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

  const MM = 72 / 25.4; // миллиметры -> пункты (1 мм = 2.8346 pt)
  const PDFName = PDFLib.PDFName; // имена ключей PDF-словарей (/MediaBox, /Rotate, ...)

  // Стандартные размеры листа в пунктах (ширина x высота, книжная ориентация).
  // Альбомный вариант получается перестановкой width/height.
  const PAPER = {
    A3: { width: 841.89, height: 1190.55 },
    A4: { width: 595.28, height: 841.89 },
    A5: { width: 419.53, height: 595.28 },
    Letter: { width: 612.0, height: 792.0 },
  };

  // Приводит любой угол к диапазону 0..359 и к целым градусам (90/180/270).
  const normAngle = (deg) => {
    const d = Math.round(Number(deg) || 0);
    return ((d % 360) + 360) % 360;
  };

  // Поворот содержимого в градусах ПРОТИВ часовой стрелки, который компенсирует /Rotate.
  // /Rotate = 90 означает «показывать страницу повёрнутой на 90° по часовой стрелке»,
  // поэтому содержимому нужно +270° против часовой, чтобы картинка осталась прежней.
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

    // После поворота на 90/270 габариты содержимого меняются местами (w↔h):
    // именно они должны вписываться в новый лист.
    const swap = rotate === 90 || rotate === 270;
    const cw = swap ? h : w; // габариты содержимого после поворота
    const ch = swap ? w : h;

    const availW = Math.max(0.5, W - 2 * margin);
    const availH = Math.max(0.5, H - 2 * margin);

    // Коэффициент масштабирования содержимого:
    //   contain — вписать целиком (берём меньший из двух коэффициентов),
    //   width   — заполнить по ширине (по высоте может обрезаться — это подсвечивается в UI),
    //   none    — 1:1, без изменения размера.
    let scale;
    if (fit === 'none') scale = 1;
    else if (fit === 'width') scale = availW / cw;
    else scale = Math.min(availW / cw, availH / ch);

    const cos = Math.cos((rotate * Math.PI) / 180);
    const sin = Math.sin((rotate * Math.PI) / 180);

    // Куда встанет повёрнутое содержимое (до центрирования): углы (0,0)..(w,h).
    // После поворота вокруг начала координат часть точек уходит в минус,
    // поэтому находим минимум — на него потом сдвигаем, чтобы содержимое легло в [0..cw]×[0..ch].
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

    // Центрируем повёрнутое содержимое на листе с учётом полей.
    const left = (W - cw * scale) / 2;
    const bottom = (H - ch * scale) / 2;
    const tx = left - minx;
    const ty = bottom - miny;

    // M = T(tx,ty) · S(scale) · R(rotate) · T(-x0,-y0)
    // Раскрываем в шесть чисел PDF: сначала сдвиг bbox в ноль, затем масштаб, поворот и перенос.
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
   *
   * Содержимое PDF не пересобирается по объектам: мы оборачиваем существующие
   * content-стримы в пару операторов `q <матрица> cm` … `Q`. Это стандартный
   * способ задать общее преобразование для всей страницы, не трогая шрифты,
   * картинки и векторные объекты.
   */
  function applyPlacement(doc, page, placement) {
    // 1. Приводим /Contents к массиву стримов: так их проще дополнить.
    page.node.normalize();

    const [a, b, c, d, e, f] = placement.matrix;
    // Числа в content-стрим пишем с фиксированной точностью, чтобы не ловить
    // экспоненциальную запись и «-0» в PDF.
    const m = (n) => (Math.abs(n) < 1e-9 ? '0' : String(Number(n.toFixed(6))));
    const prefix = doc.context.stream('q\n' + [a, b, c, d, e, f].map(m).join(' ') + ' cm\n');
    const suffix = doc.context.stream('\nQ\n');

    // 2. У пустой страницы может не быть /Contents — создаём пустой массив.
    if (!page.node.Contents()) {
      page.node.set(PDFName.of('Contents'), doc.context.obj([]));
    }

    // 3. Вставляем «q матрица cm» в начало и «Q» в конец списка стримов.
    const ok = page.node.wrapContentStreams(doc.context.register(prefix), doc.context.register(suffix));
    if (!ok) throw new Error('Не удалось обернуть содержимое страницы (Contents не массив).');

    // 4. Меняем лист: все рамки страницы приводим к новому размеру.
    //    Иначе Acrobat/просмотрщик может обрезать содержимое по старому CropBox.
    page.setMediaBox(0, 0, placement.pageWidth, placement.pageHeight);
    page.setCropBox(0, 0, placement.pageWidth, placement.pageHeight);
    // Прочие рамки, если они были, тоже приводим к новому листу, иначе печать может обрезать.
    const node = page.node;
    if (node.BleedBox && node.BleedBox()) page.setBleedBox(0, 0, placement.pageWidth, placement.pageHeight);
    if (node.TrimBox && node.TrimBox()) page.setTrimBox(0, 0, placement.pageWidth, placement.pageHeight);
    if (node.ArtBox && node.ArtBox()) page.setArtBox(0, 0, placement.pageWidth, placement.pageHeight);
    // /Rotate уже «запечён» в матрицу — сбрасываем, чтобы не применился дважды.
    page.setRotation(PDFLib.degrees(0));

    // 5. Аннотации (штампы, ссылки, поля) — переставляем их рамки/точки той же матрицей.
    try {
      transformAnnotationRects(doc, page, placement.matrix);
    } catch (err) {
      // Аннотации не критичны для печати: если структура нестандартная, просто пропускаем.
    }
    return placement;
  }

  // Пересчитывает /Rect, /QuadPoints и /InkList аннотаций той же матрицей, что и содержимое.
  function transformAnnotationRects(doc, page, matrix) {
    const annots = page.node.Annots ? page.node.Annots() : null;
    if (!annots || typeof annots.size !== 'function') return;
    const [a, b, c, d, e, f] = matrix;
    const point = (x, y) => [a * x + c * y + e, b * x + d * y + f];

    const readNumbers = (arr) => {
      if (!arr || typeof arr.size !== 'function') return null;
      const out = [];
      for (let i = 0; i < arr.size(); i++) {
        const n = arr.lookup(i);
        if (!n || typeof n.asNumber !== 'function') return null;
        out.push(n.asNumber());
      }
      return out;
    };

    for (let i = 0; i < annots.size(); i++) {
      const dict = doc.context.lookup(annots.get(i));
      if (!dict || typeof dict.lookup !== 'function') continue;

      const rect = readNumbers(dict.lookup(PDFName.of('Rect')));
      if (rect && rect.length === 4) {
        const pts = [
          point(rect[0], rect[1]),
          point(rect[2], rect[1]),
          point(rect[0], rect[3]),
          point(rect[2], rect[3]),
        ];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        dict.set(
          PDFName.of('Rect'),
          doc.context.obj([Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)])
        );
      }

      const quad = readNumbers(dict.lookup(PDFName.of('QuadPoints')));
      if (quad && quad.length >= 8 && quad.length % 8 === 0) {
        const result = [];
        for (let q = 0; q < quad.length; q += 8) {
          const pts = [];
          for (let p = 0; p < 4; p++) pts.push(point(quad[q + p * 2], quad[q + p * 2 + 1]));
          // порядок углов: верх-лево, верх-право, низ-лево, низ-право
          pts.sort((p1, p2) => p2[1] - p1[1]);
          const top = pts.slice(0, 2).sort((p1, p2) => p1[0] - p2[0]);
          const bottom = pts.slice(2, 4).sort((p1, p2) => p1[0] - p2[0]);
          const ordered = top.concat(bottom);
          for (const p of ordered) result.push(p[0], p[1]);
        }
        dict.set(PDFName.of('QuadPoints'), doc.context.obj(result));
      }

      const ink = dict.lookup(PDFName.of('InkList'));
      if (ink && typeof ink.size === 'function') {
        const strokes = [];
        for (let s = 0; s < ink.size(); s++) {
          const numbers = readNumbers(ink.lookup(s));
          if (!numbers || numbers.length % 2 !== 0) {
            strokes.length = 0;
            break;
          }
          const transformed = [];
          for (let p = 0; p < numbers.length; p += 2) {
            const tp = point(numbers[p], numbers[p + 1]);
            transformed.push(tp[0], tp[1]);
          }
          strokes.push(transformed);
        }
        if (strokes.length) {
          dict.set(PDFName.of('InkList'), doc.context.obj(strokes));
        }
      }
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

  /**
   * Безопасное имя файла для скачивания и записей ZIP.
   *
   * Убирает управляющие символы, разделители путей и зарезервированные в Windows
   * символы. Это защита от «zip-slip» (запись за пределы папки при распаковке)
   * и от подмены расширения: имя приходит из файла пользователя и ему доверять нельзя.
   *
   * @param {string} name исходное имя (может быть с путём или мусором)
   * @param {string} [fallback] что вернуть, если после очистки ничего не осталось
   * @returns {string}
   */
  function safeFileName(name, fallback) {
    const cleaned = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f\u007f]/g, '') // управляющие символы
      .replace(/[\\/:*?"<>|]/g, ' ') // разделители путей и запрещённые в Windows символы
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+/, '') // ни «..», ни скрытых файлов в начале имени
      .trim()
      .slice(0, 120);
    return cleaned || fallback || 'document';
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
    safeFileName,
  };
});
