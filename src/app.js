/*!
 * app.js — интерфейс «Смена ориентации PDF».
 * Обработка полностью локальная: pdf.js рисует страницы, pdf-lib пересобирает файл.
 */
(function () {
  'use strict';

  const PDFLib = window.PDFLib;
  const core = window.OrientCore;
  const MM = core.MM;
  const PAPER = core.PAPER;
  const PDFDocument = PDFLib.PDFDocument;

  /* ---------- worker pdf.js из встроенного текста ---------- */
  try {
    const workerEl = document.getElementById('pdf-worker-src');
    if (workerEl && window.pdfjsLib) {
      const blob = new Blob([workerEl.textContent], { type: 'text/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    }
  } catch (e) {
    console.warn('pdf.js worker:', e);
  }

  /* ---------- состояние ---------- */
  const state = {
    fileName: '',
    bytes: null,
    pdfjs: null,
    pages: [],
    selected: new Set(),
    busy: false,
    autoApplied: 0,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    dropzoneSection: $('dropzoneSection'),
    dropzone: $('dropzone'),
    loadingSection: $('loadingSection'),
    loadingTitle: $('loadingTitle'),
    loadingSub: $('loadingSub'),
    loadingProgressWrap: $('loadingProgressWrap'),
    loadingProgress: $('loadingProgress'),
    workspace: $('workspace'),
    autoBanner: $('autoBanner'),
    autoBannerText: $('autoBannerText'),
    fileName: $('fileName'),
    fileSub: $('fileSub'),
    pagesGrid: $('pagesGrid'),
    pagesSub: $('pagesSub'),
    summaryBox: $('summaryBox'),
    fmtSelect: $('fmtSelect'),
    fitSelect: $('fitSelect'),
    marginInput: $('marginInput'),
    cropCheck: $('cropCheck'),
    fileInput: $('fileInput'),
    toasts: $('toasts'),
    btnDownload: $('btnDownload'),
    btnPreviewResult: $('btnPreviewResult'),
    btnSelectAll: $('btnSelectAll'),
    btnReset: $('btnReset'),
    btnUndoAuto: $('btnUndoAuto'),
    btnOtherFile: $('btnOtherFile'),
    btnHelp: $('btnHelp'),
  };

  /* ---------- утилиты ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (d) => ((Math.round(Number(d) || 0) % 360) + 360) % 360;

  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' is-error' : '');
    el.textContent = text;
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 260);
    }, kind === 'error' ? 6000 : 4200);
  }

  function showLoading(title, sub) {
    els.dropzoneSection.style.display = 'none';
    els.workspace.classList.remove('is-active');
    els.loadingSection.hidden = false;
    els.loadingTitle.textContent = title || 'Открываю документ…';
    els.loadingSub.textContent = sub || '';
    setProgress(null);
  }

  function setProgress(value) {
    if (value == null) {
      els.loadingProgressWrap.hidden = true;
      els.loadingProgress.style.width = '0%';
      return;
    }
    els.loadingProgressWrap.hidden = false;
    els.loadingProgress.style.width = Math.round(value * 100) + '%';
  }

  function hideLoading() {
    els.loadingSection.hidden = true;
  }

  function fmtMM(pt) {
    return Math.round(pt / MM);
  }

  function paperName(w, h) {
    for (const [name, p] of Object.entries(PAPER)) {
      if (
        (Math.abs(w - p.width) < 2 && Math.abs(h - p.height) < 2) ||
        (Math.abs(w - p.height) < 2 && Math.abs(h - p.width) < 2)
      ) {
        return name;
      }
    }
    return null;
  }

  function nearestPaper(w, h) {
    const a = Math.min(w, h);
    const b = Math.max(w, h);
    let best = null;
    let bestErr = Infinity;
    for (const [name, p] of Object.entries(PAPER)) {
      const pa = Math.min(p.width, p.height);
      const pb = Math.max(p.width, p.height);
      const err = Math.abs(a - pa) + Math.abs(b - pb);
      if (err < bestErr) {
        bestErr = err;
        best = name;
      }
    }
    // если страница сильно нестандартная — оставляем её собственный размер
    if (bestErr > 70) return null;
    const p = PAPER[best];
    return { name: best, width: Math.min(p.width, p.height), height: Math.max(p.width, p.height) };
  }

  // Размер листа заданной ориентации.
  function sheetFor(page, orientation, formatValue) {
    let portrait;
    if (formatValue && formatValue !== 'auto' && PAPER[formatValue]) {
      const p = PAPER[formatValue];
      portrait = { name: formatValue, width: Math.min(p.width, p.height), height: Math.max(p.width, p.height) };
    } else {
      portrait = nearestPaper(page.origW, page.origH);
      if (!portrait) {
        portrait = {
          name: null,
          width: Math.min(page.origW, page.origH),
          height: Math.max(page.origW, page.origH),
        };
      }
    }
    if (orientation === 'landscape') {
      return { width: portrait.height, height: portrait.width };
    }
    return { width: portrait.width, height: portrait.height };
  }

  /* ---------- настройки страниц ---------- */
  function origSettings(page) {
    return {
      rotate: 0,
      sheetW: page.origW,
      sheetH: page.origH,
      fit: 'none',
      margin: 0,
      crop: false,
    };
  }

  function resetPage(page) {
    Object.assign(page, origSettings(page));
  }

  function isChanged(page) {
    return !(
      page.rotate === 0 &&
      page.fit === 'none' &&
      page.margin === 0 &&
      !page.crop &&
      Math.abs(page.sheetW - page.origW) < 0.01 &&
      Math.abs(page.sheetH - page.origH) < 0.01
    );
  }

  function effective(page) {
    const view = page.view;
    const bbox = page.crop ? page.bbox : { x0: view.x0, y0: view.y0, x1: view.x1, y1: view.y1 };
    return {
      bbox,
      pageWidth: page.sheetW,
      pageHeight: page.sheetH,
      rotate: norm(page.rotate + core.bakeRotate(page.pdfRotate || 0)),
      fit: page.fit,
      margin: page.margin,
    };
  }

  // Автоподбор: широкий бланк на книжном листе -> альбомный A4, и наоборот.
  function autoPreset(page) {
    const bw = page.bbox.x1 - page.bbox.x0;
    const bh = page.bbox.y1 - page.bbox.y0;
    if (bw <= 1 || bh <= 1) return null;
    // сравниваем с тем, как содержимое выглядит на экране (с учётом /Rotate)
    const swap = page.pdfRotate === 90 || page.pdfRotate === 270;
    const contentAspect = swap ? bh / bw : bw / bh;
    const pageAspect = page.origW / page.origH;
    if (pageAspect < 1 && contentAspect > 1.12) {
      const sheet = sheetFor(page, 'landscape', 'auto');
      page.sheetW = sheet.width;
      page.sheetH = sheet.height;
      page.fit = 'contain';
      page.margin = 5 * MM;
      page.crop = true;
      return 'landscape';
    }
    if (pageAspect > 1 && contentAspect < 0.89) {
      const sheet = sheetFor(page, 'portrait', 'auto');
      page.sheetW = sheet.width;
      page.sheetH = sheet.height;
      page.fit = 'contain';
      page.margin = 5 * MM;
      page.crop = true;
      return 'portrait';
    }
    return null;
  }

  /* ---------- загрузка ---------- */
  async function handleFiles(fileList) {
    if (state.busy) return;
    const files = Array.from(fileList || []).filter(
      (f) => f && (/\.pdf$/i.test(f.name) || f.type === 'application/pdf')
    );
    if (!files.length) {
      toast('Нужен PDF-файл', 'error');
      return;
    }
    if (files.length > 1) toast('Открываю первый файл из ' + files.length);
    await loadPdf(files[0]);
  }

  async function loadPdf(file) {
    state.busy = true;
    try {
      showLoading('Открываю документ…', file.name);
      if (state.pdfjs) {
        try { state.pdfjs.destroy(); } catch (e) {}
        state.pdfjs = null;
      }
      state.pages = [];
      state.selected = new Set();
      state.autoApplied = 0;
      els.pagesGrid.innerHTML = '';
      els.autoBanner.classList.remove('is-visible');

      const buf = await file.arrayBuffer();
      state.bytes = new Uint8Array(buf);
      state.fileName = file.name;

      // 1. Проверяем pdf.js (он же рендерит превью)
      let pdf;
      try {
        pdf = await pdfjsLib.getDocument({
          data: state.bytes.slice(),
          useSystemFonts: true,
          isEvalSupported: false,
        }).promise;
      } catch (err) {
        throw friendlyPdfError(err);
      }
      state.pdfjs = pdf;

      // pdf-lib нужен, чтобы понять, сможем ли мы переписать файл
      try {
        await PDFDocument.load(state.bytes, { updateMetadata: false });
      } catch (err) {
        throw friendlyPdfError(err);
      }

      const count = pdf.numPages;
      setProgress(0);
      for (let i = 0; i < count; i++) {
        els.loadingSub.textContent = 'Разбираю страницу ' + (i + 1) + ' из ' + count;
        const page = await analysePage(pdf, i);
        state.pages.push(page);
        state.selected.add(page.index);
        buildCard(page);
        setProgress((i + 1) / count);
      }

      els.fileName.textContent = file.name;
      els.fileSub.textContent = count === 1 ? '1 страница' : count + ' страниц';

      hideLoading();
      els.dropzoneSection.style.display = 'none';
      els.workspace.classList.add('is-active');

      syncControlsFromSelection();
      updateAllCards();

      if (state.autoApplied > 0) {
        const n = state.autoApplied;
        els.autoBannerText.innerHTML =
          '<b>Готово к печати.</b> ' +
          (n === 1
            ? 'Страница свёрстана широко, а лист был книжный — развернул её на альбомный лист.'
            : n + ' страницы свёрстаны широко — развернул их на альбомный лист.') +
          ' Проверьте предпросмотр.';
        els.autoBanner.classList.add('is-visible');
      }
    } catch (err) {
      console.error(err);
      hideLoading();
      els.dropzoneSection.style.display = '';
      els.workspace.classList.remove('is-active');
      toast(err && err.userMessage ? err.userMessage : 'Не получилось открыть файл: ' + (err && err.message), 'error');
    } finally {
      state.busy = false;
    }
  }

  function friendlyPdfError(err) {
    const e = new Error(err && err.message ? err.message : 'ошибка чтения PDF');
    const name = (err && err.name) || '';
    if (/password/i.test(name) || /password/i.test(e.message)) {
      e.userMessage = 'PDF защищён паролем. Снимите пароль в просмотрщике и попробуйте снова.';
    } else if (/Invalid PDF|InvalidPDF|corrupt/i.test(name + ' ' + e.message)) {
      e.userMessage = 'Файл повреждён или это не PDF.';
    } else {
      e.userMessage = 'Не получилось открыть файл: ' + e.message;
    }
    return e;
  }

  /* ---------- разбор страницы (рамка содержимого + миниатюра) ---------- */
  async function analysePage(pdf, index) {
    const pdfPage = await pdf.getPage(index + 1);
    const view = pdfPage.view;
    const viewW = view[2] - view[0];
    const viewH = view[3] - view[1];
    const pdfRotate = norm(pdfPage.rotate || 0);
    const swapped = pdfRotate === 90 || pdfRotate === 270;
    const origW = swapped ? viewH : viewW;
    const origH = swapped ? viewW : viewH;

    const maxDim = Math.max(viewW, viewH);
    const scale = clamp(1200 / maxDim, 0.6, 2.2);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewW * scale));
    canvas.height = Math.max(1, Math.ceil(viewH * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let bbox;
    try {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const viewport = pdfPage.getViewport({ scale: scale, rotation: 0 });
      await pdfPage.render({ canvasContext: ctx, viewport: viewport, background: '#ffffff' }).promise;

      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      const TH = 246;
      const stride = canvas.width * 4;
      for (let y = 0; y < canvas.height; y++) {
        let o = y * stride;
        for (let x = 0; x < canvas.width; x++, o += 4) {
          if (img[o] < TH || img[o + 1] < TH || img[o + 2] < TH) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) {
        const pad = 0.75; // пунктов, чтобы не подрезать сглаженные края
        const found = {
          x0: clamp(view[0] + minX / scale - pad, view[0], view[2]),
          y0: clamp(view[3] - (maxY + 1) / scale - pad, view[1], view[3]),
          x1: clamp(view[0] + (maxX + 1) / scale + pad, view[0], view[2]),
          y1: clamp(view[3] - minY / scale + pad, view[1], view[3]),
        };
        const area = (found.x1 - found.x0) * (found.y1 - found.y0);
        const pageArea = viewW * viewH;
        // страховка от случайной точки/царапины: слишком маленькая рамка = пустая страница
        if (found.x1 - found.x0 < 5 || found.y1 - found.y0 < 5 || area < pageArea * 0.005) {
          bbox = { x0: view[0], y0: view[1], x1: view[2], y1: view[3] };
        } else {
          bbox = found;
        }
      } else {
        bbox = { x0: view[0], y0: view[1], x1: view[2], y1: view[3] };
      }
    } catch (err) {
      console.warn('Не удалось отрисовать страницу', index + 1, err);
      bbox = { x0: view[0], y0: view[1], x1: view[2], y1: view[3] };
    }

    // миниатюра для предпросмотра
    const thumbScale = Math.min(640 / viewW, 640 / viewH, scale);
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.ceil(viewW * thumbScale));
    thumb.height = Math.max(1, Math.ceil(viewH * thumbScale));
    const tctx = thumb.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);

    if (pdfPage.cleanup) pdfPage.cleanup();

    const page = {
      index: index,
      view: { x0: view[0], y0: view[1], x1: view[2], y1: view[3] },
      pdfRotate: pdfRotate,
      origW: origW,
      origH: origH,
      bbox: bbox,
      thumb: thumb,
      thumbScale: thumbScale,
      rotate: 0,
      sheetW: origW,
      sheetH: origH,
      fit: 'none',
      margin: 0,
      crop: false,
      auto: null,
    };

    page.auto = autoPreset(page);
    if (page.auto) state.autoApplied++;
    return page;
  }

  /* ---------- карточки страниц ---------- */
  const ROT_ICON_LEFT =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.9-6.4"/><path d="M3 4.5V10h5.4"/></svg>';
  const ROT_ICON_RIGHT =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4"/><path d="M21 4.5V10h-5.4"/></svg>';

  function buildCard(page) {
    const card = document.createElement('article');
    card.className = 'page-card is-selected';
    card.dataset.index = String(page.index);
    card.innerHTML =
      '<div class="thumb">' +
      '  <canvas aria-label="Предпросмотр страницы ' + (page.index + 1) + '"></canvas>' +
      '  <span class="badge"></span>' +
      '  <span class="scale-pill" hidden></span>' +
      '</div>' +
      '<div class="card-foot">' +
      '  <label class="num"><input type="checkbox" checked aria-label="Страница ' + (page.index + 1) + '"><span>стр. ' + (page.index + 1) + '</span></label>' +
      '  <span class="dims"></span>' +
      '  <div class="mini">' +
      '    <button type="button" data-rot="90" title="Повернуть против часовой">' + ROT_ICON_LEFT + '</button>' +
      '    <button type="button" data-rot="-90" title="Повернуть по часовой">' + ROT_ICON_RIGHT + '</button>' +
      '  </div>' +
      '</div>';

    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      toggleSelection(page, checkbox.checked, false);
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label')) return;
      toggleSelection(page, !state.selected.has(page.index), true);
    });

    card.querySelectorAll('.mini button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        rotatePages([page], Number(btn.dataset.rot));
      });
    });

    page.el = card;
    page.canvas = card.querySelector('canvas');
    page.badge = card.querySelector('.badge');
    page.scalePill = card.querySelector('.scale-pill');
    page.dimsEl = card.querySelector('.dims');
    page.checkbox = checkbox;
    els.pagesGrid.appendChild(card);
    updateCard(page);
  }

  function toggleSelection(page, selected, syncCheckbox) {
    if (selected) state.selected.add(page.index);
    else state.selected.delete(page.index);
    page.el.classList.toggle('is-selected', selected);
    if (syncCheckbox) page.checkbox.checked = selected;
    updateSummary();
  }

  function updateCard(page) {
    if (!page.el) return;
    const st = effective(page);
    const placement = core.computePlacement(st.bbox, st);

    // холст предпросмотра
    const canvas = page.canvas;
    const k = 620 / Math.max(placement.pageWidth, placement.pageHeight);
    canvas.width = Math.max(1, Math.round(placement.pageWidth * k));
    canvas.height = Math.max(1, Math.round(placement.pageHeight * k));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const [a, b, c, d, e, f] = placement.matrix;
    const m = new DOMMatrix([a, b, c, d, e, f]);
    const imgToPt = new DOMMatrix().translate(page.view.x0, page.view.y1).scale(1 / page.thumbScale, -1 / page.thumbScale);
    // пункты PDF (y вверх) -> пиксели холста (y вниз)
    const ptToPx = new DOMMatrix([k, 0, 0, -k, 0, placement.pageHeight * k]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(ptToPx.multiply(m).multiply(imgToPt));
    ctx.drawImage(page.thumb, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    canvas.style.aspectRatio = String(placement.pageWidth / placement.pageHeight);

    const changed = isChanged(page);
    const landscape = placement.pageWidth > placement.pageHeight;
    const name = paperName(placement.pageWidth, placement.pageHeight);
    const label = (name ? name : fmtMM(placement.pageWidth) + '×' + fmtMM(placement.pageHeight)) +
      ' · ' + (landscape ? 'альбомный' : 'книжный');

    const cuts = placement.contentHeight > placement.pageHeight + 0.5 || placement.contentWidth > placement.pageWidth + 0.5;
    page.badge.textContent = changed ? label : 'без изменений';
    page.badge.className = 'badge' + (changed ? (cuts ? ' is-warn' : ' is-changed') : '');

    const ratio = placement.scale;
    const showRatio = changed && Math.abs(ratio - 1) > 0.03;
    page.scalePill.hidden = !showRatio;
    if (showRatio) {
      page.scalePill.textContent = '×' + ratio.toFixed(2);
      page.scalePill.style.background = ratio > 1.02 ? 'rgba(20,107,82,.92)' : 'rgba(120,113,95,.92)';
    }

    page.dimsEl.textContent = fmtMM(placement.pageWidth) + ' × ' + fmtMM(placement.pageHeight) + ' мм';
    page.dimsEl.title = Math.round(placement.pageWidth) + ' × ' + Math.round(placement.pageHeight) + ' pt';
    page.el.classList.toggle('is-selected', state.selected.has(page.index));
    page.checkbox.checked = state.selected.has(page.index);
  }

  function updateAllCards() {
    for (const page of state.pages) updateCard(page);
    if (state.pages.length) syncControlsFromSelection();
    updateSummary();
  }

  function updateSummary() {
    if (!state.pages.length) {
      els.summaryBox.textContent = '—';
      return;
    }
    const changed = state.pages.filter(isChanged);
    const total = state.pages.length;
    const active = state.selected.size ? state.selected.size : total;
    els.pagesSub.textContent =
      'Предпросмотр результата · ' + (active === 1 ? '1 стр.' : active + ' стр.') +
      (state.selected.size && state.selected.size !== total ? ' из ' + total : '');
    if (!changed.length) {
      els.summaryBox.innerHTML =
        'Изменений пока нет. Нажмите <b>«Развернуть на альбомный»</b>, если бланк свёрстан широко.';
      els.btnDownload.disabled = false;
      return;
    }
    const sample = changed[0];
    const name = paperName(sample.sheetW, sample.sheetH);
    const label = (name ? name : 'свой размер') + (sample.sheetW > sample.sheetH ? ', альбомный' : ', книжный');
    const ratios = changed.map((p) => core.computePlacement(effective(p).bbox, effective(p)).scale);
    const maxRatio = Math.max.apply(null, ratios);
    els.summaryBox.innerHTML =
      'Изменяется <b>' + changed.length + '</b> из ' + total + ' стр. · <b>' + label + '</b>' +
      (maxRatio > 1.03 ? ' · содержимое крупнее в <b>×' + maxRatio.toFixed(2) + '</b>' : '');
    els.btnDownload.disabled = false;
  }

  /* ---------- действия ---------- */
  function targets() {
    const selected = state.pages.filter((p) => state.selected.has(p.index));
    return selected.length ? selected : state.pages;
  }

  function applySheet(orientation) {
    const pages = targets();
    if (!pages.length) return;
    const format = els.fmtSelect.value;
    const margin = clamp(Number(els.marginInput.value) || 0, 0, 40) * MM;
    const crop = els.cropCheck.checked;
    for (const page of pages) {
      const sheet = sheetFor(page, orientation, format);
      page.sheetW = sheet.width;
      page.sheetH = sheet.height;
      page.fit = els.fitSelect.value;
      page.margin = margin;
      page.crop = crop;
      page.rotate = 0;
      page.auto = null;
    }
    updateAllCards();
  }

  function rotatePages(pages, delta) {
    if (!pages.length) return;
    for (const page of pages) {
      page.rotate = norm(page.rotate + delta);
      // лист поворачиваем вместе с содержимым, чтобы оно осталось вписано
      const w = page.sheetW;
      page.sheetW = page.sheetH;
      page.sheetH = w;
      if (page.fit === 'none') {
        // при повороте на 90° 1:1 обычно уже не помещается — вписываем
        page.fit = 'contain';
        page.crop = true;
      }
      page.auto = null;
    }
    updateAllCards();
  }

  function selectionList(pages) {
    return pages.map((p) => p.index + 1).join(', ');
  }

  function syncControlsFromSelection() {
    const pages = targets();
    if (!pages.length) return;
    const sample = pages[0];
    els.marginInput.value = String(Math.round(sample.margin / MM));
    els.fitSelect.value = sample.fit;
    els.cropCheck.checked = !!sample.crop;
    els.pagesSub.textContent = 'Предпросмотр результата · ' + (pages.length === 1 ? '1 стр.' : pages.length + ' стр.');
  }

  function resetTargets() {
    const pages = targets();
    for (const page of pages) resetPage(page);
    updateAllCards();
    toast('Настройки сброшены');
  }

  function selectAll(on) {
    state.selected = new Set();
    if (on) for (const p of state.pages) state.selected.add(p.index);
    updateAllCards();
  }

  /* ---------- сборка результата ---------- */
  async function buildResult() {
    const changedPages = state.pages.filter(isChanged);
    if (!changedPages.length) {
      return new Blob([state.bytes], { type: 'application/pdf' });
    }
    const doc = await PDFDocument.load(state.bytes, { updateMetadata: false });
    const settings = state.pages.map((p) => (isChanged(p) ? effective(p) : null));
    core.applyToDocument(doc, settings);
    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function outputName() {
    const base = (state.fileName || 'document').replace(/\.pdf$/i, '');
    const changed = state.pages.filter(isChanged);
    if (!changed.length) return base + '.pdf';
    let suffix = ' (изменённый)';
    const landscape = changed.filter((p) => p.sheetW > p.sheetH).length;
    const portrait = changed.filter((p) => p.sheetH > p.sheetW).length;
    if (landscape === changed.length) suffix = ' (альбомный)';
    else if (portrait === changed.length) suffix = ' (книжный)';
    return base + suffix + '.pdf';
  }

  function setBusy(on) {
    state.busy = on;
    els.btnDownload.disabled = on;
    els.btnPreviewResult.disabled = on;
    document.body.style.cursor = on ? 'progress' : '';
  }

  async function download() {
    if (state.busy) return;
    setBusy(true);
    try {
      const blob = await buildResult();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outputName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast(
        state.pages.some(isChanged)
          ? 'Готово: ' + outputName() + ' — сохранён'
          : 'Изменений нет — сохранил исходный файл'
      );
    } catch (err) {
      console.error(err);
      toast('Не получилось сохранить: ' + (err && err.message), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function previewResult() {
    if (state.busy) return;
    const win = window.open('', '_blank');
    if (!win) {
      toast('Разрешите всплывающие окна, чтобы открыть предпросмотр', 'error');
      return;
    }
    setBusy(true);
    try {
      const blob = await buildResult();
      const url = URL.createObjectURL(blob);
      win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (err) {
      win.close();
      toast('Не получилось собрать файл: ' + (err && err.message), 'error');
    } finally {
      setBusy(false);
    }
  }

  /* ---------- события ---------- */
  function bindEvents() {
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.fileInput.click();
      }
    });
    els.fileInput.addEventListener('change', () => {
      handleFiles(els.fileInput.files);
      els.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) =>
      window.addEventListener(ev, (e) => {
        e.preventDefault();
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
          els.dropzone.classList.add('is-over');
        }
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      window.addEventListener(ev, (e) => {
        e.preventDefault();
        els.dropzone.classList.remove('is-over');
      })
    );
    window.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });

    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.preset;
        if (kind === 'landscape') applySheet('landscape');
        else if (kind === 'portrait') applySheet('portrait');
        else if (kind === 'reset') resetTargets();
        else if (kind === 'rotate-left') rotatePages(targets(), 90);
        else if (kind === 'rotate-right') rotatePages(targets(), -90);
      });
    });

    els.fmtSelect.addEventListener('change', () => {
      const pages = targets();
      if (!pages.length) return;
      const orientation = pages[0].sheetW > pages[0].sheetH ? 'landscape' : 'portrait';
      const value = els.fmtSelect.value;
      for (const page of pages) {
        const sheet = sheetFor(page, orientation, value);
        page.sheetW = sheet.width;
        page.sheetH = sheet.height;
      }
      updateAllCards();
    });

    els.fitSelect.addEventListener('change', () => {
      for (const page of targets()) page.fit = els.fitSelect.value;
      updateAllCards();
    });

    els.marginInput.addEventListener('change', () => {
      const v = clamp(Number(els.marginInput.value) || 0, 0, 40);
      els.marginInput.value = String(v);
      for (const page of targets()) {
        page.margin = v * MM;
        if (v > 0 && page.fit === 'none') page.fit = 'contain';
      }
      updateAllCards();
    });

    els.cropCheck.addEventListener('change', () => {
      for (const page of targets()) page.crop = els.cropCheck.checked;
      updateAllCards();
    });

    els.btnSelectAll.addEventListener('click', () => {
      const all = state.selected.size === state.pages.length;
      selectAll(!all);
      els.btnSelectAll.textContent = all ? 'Выбрать все' : 'Снять выделение';
    });
    els.btnReset.addEventListener('click', resetTargets);
    els.btnOtherFile.addEventListener('click', () => els.fileInput.click());
    els.btnDownload.addEventListener('click', download);
    els.btnPreviewResult.addEventListener('click', previewResult);
    els.btnUndoAuto.addEventListener('click', () => {
      for (const p of state.pages) resetPage(p);
      els.autoBanner.classList.remove('is-visible');
      updateAllCards();
      toast('Вернул исходную ориентацию');
    });
    els.btnHelp.addEventListener('click', showHelp);
  }

  /* ---------- справка ---------- */
  function showHelp() {
    const old = document.getElementById('helpDialog');
    if (old) old.remove();
    const dlg = document.createElement('dialog');
    dlg.id = 'helpDialog';
    dlg.innerHTML =
      '<h2>Как это работает</h2>' +
      '<p>Документ пересобирается прямо в браузере: содержимое страницы поворачивается и вписывается в новый лист. ' +
      'Текст остаётся текстом — он не превращается в картинку и не теряет чёткость.</p>' +
      '<ul>' +
      '<li><b>Развернуть на альбомный</b> — для бланков, которые свёрстаны широко, а пришли на книжном листе. ' +
      'Белые поля обрезаются, содержимое увеличивается (обычно в 1,4–1,5 раза) и заполняет альбомный A4.</li>' +
      '<li><b>На книжный лист</b> — обратное действие.</li>' +
      '<li><b>Повернуть ↺ / ↻</b> — крутит саму страницу: пригодится для сканов, лежащих боком. Лист при этом меняет ориентацию.</li>' +
      '<li><b>Проверить</b> — открывает готовый файл в новой вкладке, <b>Скачать PDF</b> — сохраняет.</li>' +
      '</ul>' +
      '<p class="muted">Если PDF подписан электронной подписью, после изменения подпись станет недействительной. ' +
      'Файлы не отправляются в интернет — всё считается на вашем компьютере.</p>' +
      '<div class="dialog-actions"><button class="btn btn-primary" id="helpClose" type="button">Понятно</button></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#helpClose').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.showModal();
  }

  /* ---------- тестовый мост (для автотестов) ---------- */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  window.__PDFORIENT__ = {
    async loadBase64(b64, name) {
      const bytes = b64ToBytes(b64);
      const file = new File([bytes], name || 'test.pdf', { type: 'application/pdf' });
      await loadPdf(file);
      return this.snapshot();
    },
    snapshot() {
      return {
        fileName: state.fileName,
        pages: state.pages.map((p, i) => ({
          i: i + 1,
          origW: +p.origW.toFixed(2),
          origH: +p.origH.toFixed(2),
          bbox: {
            x0: +p.bbox.x0.toFixed(2),
            y0: +p.bbox.y0.toFixed(2),
            x1: +p.bbox.x1.toFixed(2),
            y1: +p.bbox.y1.toFixed(2),
          },
          auto: p.auto,
          sheetW: +p.sheetW.toFixed(2),
          sheetH: +p.sheetH.toFixed(2),
          fit: p.fit,
          crop: p.crop,
          rotate: p.rotate,
          changed: isChanged(p),
          autoApplied: state.autoApplied,
        })),
      };
    },
    preset(kind) {
      if (kind === 'landscape') applySheet('landscape');
      else if (kind === 'portrait') applySheet('portrait');
      else if (kind === 'reset') resetTargets();
      else if (kind === 'rotate-left') rotatePages(targets(), 90);
      else if (kind === 'rotate-right') rotatePages(targets(), -90);
      return this.snapshot();
    },
    async convertBase64() {
      const blob = await buildResult();
      const buf = new Uint8Array(await blob.arrayBuffer());
      return bytesToB64(buf);
    },
    select(ids) {
      state.selected = new Set(ids.map((n) => n - 1));
      updateAllCards();
    },
    async resultPageSizes() {
      const blob = await buildResult();
      const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { updateMetadata: false });
      return doc.getPages().map((p) => ({
        w: +p.getWidth().toFixed(2),
        h: +p.getHeight().toFixed(2),
        rotate: p.getRotation().angle,
      }));
    },
    thumbs() {
      return state.pages.map((p) => ({
        w: p.thumb.width,
        h: p.thumb.height,
        scale: p.thumbScale,
        view: p.view,
        data: p.thumb.toDataURL('image/png'),
      }));
    },
  };

  /* ---------- старт ---------- */
  bindEvents();
  updateSummary();
})();
