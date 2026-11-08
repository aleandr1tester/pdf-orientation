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
  // В приложении может быть несколько файлов; активный файл — state.doc.
  const state = {
    files: [],
    active: -1,
    busy: false,
    get doc() {
      return this.files[this.active] || null;
    },
    get pages() {
      return this.doc ? this.doc.pages : [];
    },
    get selected() {
      return this.doc ? this.doc.selected : new Set();
    },
    set selected(value) {
      if (this.doc) this.doc.selected = value;
    },
    get bytes() {
      return this.doc ? this.doc.bytes : null;
    },
    get pdfjs() {
      return this.doc ? this.doc.pdfjs : null;
    },
    get fileName() {
      return this.doc ? this.doc.name : '';
    },
    get autoApplied() {
      return this.doc ? this.doc.autoApplied : 0;
    },
    set autoApplied(value) {
      if (this.doc) this.doc.autoApplied = value;
    },
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
    fileStrip: $('fileStrip'),
    fileName: $('fileName'),
    fileSub: $('fileSub'),
    pagesGrid: $('pagesGrid'),
    pagesSub: $('pagesSub'),
    summaryBox: $('summaryBox'),
    fmtSelect: $('fmtSelect'),
    fitSelect: $('fitSelect'),
    marginInput: $('marginInput'),
    cropCheck: $('cropCheck'),
    batchField: $('batchField'),
    batchAllCheck: $('batchAllCheck'),
    autoRotateCheck: $('autoRotateCheck'),
    fileInput: $('fileInput'),
    toasts: $('toasts'),
    btnDownload: $('btnDownload'),
    btnZip: $('btnZip'),
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

  // Автоподбор: меняет ориентацию листа, только если это заметно увеличит содержимое
  // и содержимое занимает существенную часть страницы.
  function autoPreset(page) {
    const bw = page.bbox.x1 - page.bbox.x0;
    const bh = page.bbox.y1 - page.bbox.y0;
    const viewW = page.view.x1 - page.view.x0;
    const viewH = page.view.y1 - page.view.y0;
    if (bw <= 1 || bh <= 1 || !viewW || !viewH) return null;

    // как содержимое будет выглядеть после всех поворотов
    const totalRot = norm(page.rotate + core.bakeRotate(page.pdfRotate || 0));
    const swap = totalRot === 90 || totalRot === 270;
    const contentAspect = swap ? bh / bw : bw / bh;
    const currentLandscape = page.sheetW > page.sheetH;
    const desired = contentAspect > 1.05 ? 'landscape' : contentAspect < 0.95 ? 'portrait' : null;

    let result = null;
    if (desired && desired !== (currentLandscape ? 'landscape' : 'portrait')) {
      const sheet = sheetFor(page, desired, 'auto');
      const currentScale = core.computePlacement(page.bbox, {
        pageWidth: page.sheetW,
        pageHeight: page.sheetH,
        rotate: totalRot,
        fit: 'contain',
        margin: 0,
      }).scale;
      const targetScale = core.computePlacement(page.bbox, {
        pageWidth: sheet.width,
        pageHeight: sheet.height,
        rotate: totalRot,
        fit: 'contain',
        margin: 5 * MM,
      }).scale;
      const gain = targetScale / currentScale;
      // «сжатый широкий бланк» занимает всю ширину листа, но не всю высоту
      const wFill = bw / viewW;
      const hFill = bh / viewH;
      const looksSqueezed =
        desired === 'landscape' ? wFill >= 0.85 && hFill <= 0.8 : hFill >= 0.85 && wFill <= 0.8;

      if (gain >= 1.08 && looksSqueezed) {
        page.sheetW = sheet.width;
        page.sheetH = sheet.height;
        page.fit = 'contain';
        page.margin = 5 * MM;
        page.crop = true;
        result = desired;
      }
    }

    // страницу, которую мы только что развернули, полезно сразу вписать в лист
    if (page.autoRotate) {
      page.fit = 'contain';
      page.margin = 5 * MM;
      page.crop = true;
    }

    return result;
  }

  // Направление текста на странице (в сырых координатах, без /Rotate): 0/90/180/270.
  async function detectTextAngle(pdfPage) {
    let items = [];
    try {
      const tc = await pdfPage.getTextContent();
      items = tc.items || [];
    } catch (e) {
      return { angle: 0, confidence: 0, weight: 0 };
    }

    let sx = 0;
    let sy = 0;
    let weight = 0;
    const samples = [];
    for (const item of items) {
      const str = (item.str || '').trim();
      if (!str || !item.transform) continue;
      const a = item.transform[0];
      const b = item.transform[1];
      if (!isFinite(a) || !isFinite(b) || (Math.abs(a) < 1e-6 && Math.abs(b) < 1e-6)) continue;
      const len = Math.min(str.length, 80);
      const ang = (Math.atan2(b, a) * 180) / Math.PI;
      sx += Math.cos((ang * Math.PI) / 180) * len;
      sy += Math.sin((ang * Math.PI) / 180) * len;
      samples.push({ ang: ang, len: len });
      weight += len;
    }
    if (!weight) return { angle: 0, confidence: 0, weight: 0 };

    const avg = (Math.atan2(sy, sx) * 180) / Math.PI;
    const quarter = Math.round(avg / 90);
    const angle = norm(quarter * 90);
    let matched = 0;
    for (const sample of samples) {
      const delta = Math.abs((((((sample.ang - quarter * 90 + 540) % 360) + 360) % 360) - 180));
      if (delta < 22) matched += sample.len;
    }
    return { angle: angle, confidence: matched / weight, weight: weight };
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
    await addFiles(files);
  }

  async function addFiles(files) {
    state.busy = true;
    const startIndex = state.files.length;
    try {
      showLoading(
        files.length > 1 ? 'Открываю файлы…' : 'Открываю документ…',
        files.length > 1 ? files.length + ' файла, всё локально' : files[0].name
      );
      setProgress(files.length > 1 ? 0 : null);

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        try {
          const loaded = await loadOneFile(file, (pageIndex, pageCount) => {
            if (files.length > 1) {
              setProgress((fi + (pageIndex + 0.5) / pageCount) / files.length);
              els.loadingSub.textContent =
                'Файл ' + (fi + 1) + ' из ' + files.length + ' · ' + file.name;
            } else {
              setProgress((pageIndex + 0.5) / pageCount);
              els.loadingSub.textContent = 'Разбираю страницу ' + (pageIndex + 1) + ' из ' + pageCount;
            }
          });
          state.files.push(loaded);
        } catch (err) {
          console.error(err);
          toast(
            (err && err.userMessage ? err.userMessage : 'Не получилось открыть файл') +
              ' — «' + file.name + '» пропущен',
            'error'
          );
        }
      }

      if (!state.files.length) {
        hideLoading();
        els.dropzoneSection.style.display = '';
        els.workspace.classList.remove('is-active');
        return;
      }

      state.active = startIndex < state.files.length ? startIndex : state.files.length - 1;
      els.dropzoneSection.style.display = 'none';
      els.workspace.classList.add('is-active');
      hideLoading();
      renderActiveFile();
    } finally {
      state.busy = false;
    }
  }

  async function loadOneFile(file, onPageProgress) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // 1. pdf.js — предпросмотр и границы содержимого
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({
        data: bytes.slice(),
        useSystemFonts: true,
        isEvalSupported: false,
      }).promise;
    } catch (err) {
      throw friendlyPdfError(err);
    }

    // 2. pdf-lib — проверим, что файл вообще можно пересобрать
    try {
      await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      try { await pdf.destroy(); } catch (e) {}
      throw friendlyPdfError(err);
    }

    const pages = [];
    const count = pdf.numPages;
    for (let i = 0; i < count; i++) {
      if (onPageProgress) onPageProgress(i, count);
      pages.push(await analysePage(pdf, i));
    }

    return {
      name: file.name,
      size: file.size,
      bytes: bytes,
      pdfjs: pdf,
      pages: pages,
      selected: new Set(pages.map((p) => p.index)),
      autoApplied: pages.filter((p) => p.auto).length,
      autoRotated: pages.filter((p) => p.autoRotate).length,
    };
  }

  function pageCountLabel(doc) {
    const pages = doc.pages.length;
    const base = pages === 1 ? '1 страница' : pages + ' страниц';
    if (state.files.length < 2) return base;
    return base + ' · файл ' + (state.active + 1) + ' из ' + state.files.length;
  }

  function changedInFile(doc) {
    return doc.pages.filter(isChanged).length;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  /* ---------- активный файл и полоса файлов ---------- */
  function renderActiveFile() {
    const doc = state.doc;
    if (!doc) return;

    els.pagesGrid.innerHTML = '';
    for (const page of doc.pages) buildCard(page);

    els.fileName.textContent = doc.name;
    els.fileSub.textContent = pageCountLabel(doc);
    els.batchField.hidden = state.files.length < 2;
    els.btnZip.hidden = state.files.length < 2;

    renderFileStrip();
    updateBanner();
    syncControlsFromSelection();
    updateAllCards();
  }

  function renderFileStrip() {
    if (state.files.length < 2) {
      els.fileStrip.hidden = true;
      els.fileStrip.textContent = '';
      return;
    }
    els.fileStrip.hidden = false;
    els.fileStrip.textContent = '';

    state.files.forEach((doc, index) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip' + (index === state.active ? ' is-active' : '');
      chip.tabIndex = 0;
      chip.setAttribute('role', 'button');
      chip.title = doc.name;

      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = doc.name;
      chip.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'chip-meta';
      meta.textContent = doc.pages.length === 1 ? '1 стр.' : doc.pages.length + ' стр.';
      if (changedInFile(doc)) {
        meta.appendChild(document.createTextNode(' · '));
        const b = document.createElement('b');
        b.textContent = 'изменён';
        meta.appendChild(b);
      }
      chip.appendChild(meta);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'chip-close';
      close.title = 'Убрать файл';
      close.setAttribute('aria-label', 'Убрать файл ' + doc.name);
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(index);
      });
      chip.appendChild(close);

      chip.addEventListener('click', () => switchFile(index));
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchFile(index);
        }
      });

      els.fileStrip.appendChild(chip);
    });
  }

  function switchFile(index) {
    if (index === state.active || !state.files[index]) return;
    state.active = index;
    renderActiveFile();
  }

  function removeFile(index) {
    const doc = state.files[index];
    if (!doc) return;
    try { doc.pdfjs && doc.pdfjs.destroy(); } catch (e) {}
    state.files.splice(index, 1);

    if (!state.files.length) {
      state.active = -1;
      els.pagesGrid.innerHTML = '';
      els.workspace.classList.remove('is-active');
      els.dropzoneSection.style.display = '';
      els.fileStrip.hidden = true;
      return;
    }

    if (state.active >= state.files.length) state.active = state.files.length - 1;
    else if (state.active > index) state.active -= 1;
    renderActiveFile();
    toast('Файл «' + doc.name + '» убран');
  }

  function updateBanner() {
    const doc = state.doc;
    const preset = doc ? doc.autoApplied : 0;
    const rotated = doc ? doc.autoRotated : 0;
    if (!doc || (!preset && !rotated)) {
      els.autoBanner.classList.remove('is-visible');
      return;
    }
    const parts = [];
    if (preset) {
      parts.push(
        preset === 1
          ? 'Страница свёрстана широко, а лист был книжный — развернул её на альбомный лист.'
          : preset + ' страницы свёрстаны широко — развернул их на альбомный лист.'
      );
    }
    if (rotated) {
      parts.push(
        rotated === 1
          ? 'Ещё одна страница была с повёрнутым текстом — развернул её.'
          : 'Ещё ' + rotated + ' страницы были с повёрнутым текстом — развернул их.'
      );
    }
    els.autoBannerText.innerHTML =
      '<b>Готово к печати.</b> ' +
      parts.join(' ') +
      (state.files.length > 1 ? ' Файл «' + escapeHtml(doc.name) + '».' : '') +
      ' Проверьте предпросмотр.';
    els.autoBanner.classList.add('is-visible');
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

    const textInfo = await detectTextAngle(pdfPage);

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
      autoRotate: null,
      textAngle: textInfo.angle,
      textConfidence: +textInfo.confidence.toFixed(3),
    };

    // Автоповорот: если текст на странице повёрнут, разворачиваем содержимое.
    const autoRotateOn = !els.autoRotateCheck || els.autoRotateCheck.checked;
    if (autoRotateOn && textInfo.weight >= 20 && textInfo.confidence >= 0.7) {
      const bake = core.bakeRotate(page.pdfRotate || 0);
      // как текст выглядит сейчас на экране, с учётом /Rotate
      const needed = norm(-(textInfo.angle + bake));
      if (needed !== 0) {
        page.rotate = needed;
        if (needed % 180 === 90) {
          const w = page.sheetW;
          page.sheetW = page.sheetH;
          page.sheetH = w;
        }
        page.autoRotate = needed;
      }
    }

    page.auto = autoPreset(page);
    return page;
  }

  /* ---------- просмотр страницы крупно ---------- */
  const lightbox = {
    el: null,
    page: null,
    mode: 'result',
    zoom: 1,
    source: null,
  };

  function buildLightbox() {
    const el = document.createElement('div');
    el.className = 'lightbox';
    el.hidden = true;
    el.innerHTML =
      '<div class="lightbox-bar">' +
      '  <span class="lightbox-title"></span>' +
      '  <div class="lb-seg">' +
      '    <button type="button" data-mode="result" class="is-active">Результат</button>' +
      '    <button type="button" data-mode="source">Исходник</button>' +
      '  </div>' +
      '  <button type="button" class="lb-zoom-btn" data-zoom="-1" title="Уменьшить (−)">−</button>' +
      '  <span class="lb-zoom">100%</span>' +
      '  <button type="button" class="lb-zoom-btn" data-zoom="1" title="Увеличить (+)">+</button>' +
      '  <button type="button" class="lb-close" title="Закрыть (Esc)">×</button>' +
      '</div>' +
      '<div class="lb-scroll"><canvas></canvas></div>';

    el.addEventListener('click', (e) => {
      if (e.target === el) closeLightbox();
    });
    el.querySelector('.lb-close').addEventListener('click', closeLightbox);
    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        lightbox.mode = btn.dataset.mode;
        renderLightbox();
      });
    });
    el.querySelectorAll('[data-zoom]').forEach((btn) => {
      btn.addEventListener('click', () => setZoom(lightbox.zoom + Number(btn.dataset.zoom) * 0.25));
    });

    lightbox.el = el;
    lightbox.canvas = el.querySelector('canvas');
    lightbox.title = el.querySelector('.lightbox-title');
    lightbox.scroll = el.querySelector('.lb-scroll');
    lightbox.zoomLabel = el.querySelector('.lb-zoom');
    lightbox.modeButtons = Array.from(el.querySelectorAll('[data-mode]'));
  }

  async function ensureSource(page) {
    if (lightbox.source && lightbox.source.page === page && lightbox.source.docName === state.fileName) {
      return;
    }
    const pdf = state.doc && state.doc.pdfjs;
    if (!pdf) return;

    const view = page.view;
    const wPt = view.x1 - view.x0;
    const hPt = view.y1 - view.y0;
    const scale = clamp(1800 / Math.max(wPt, hPt), 0.8, 2.5);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(wPt * scale));
    canvas.height = Math.max(1, Math.ceil(hPt * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pdfPage = await pdf.getPage(page.index + 1);
    const viewport = pdfPage.getViewport({ scale: scale, rotation: 0 });
    await pdfPage.render({ canvasContext: ctx, viewport: viewport, background: '#ffffff' }).promise;
    if (pdfPage.cleanup) pdfPage.cleanup();

    lightbox.source = { page: page, canvas: canvas, scale: scale, docName: state.fileName };
  }

  async function openLightbox(page) {
    if (!state.doc) return;
    if (!lightbox.el) buildLightbox();
    if (!lightbox.el.parentNode) document.body.appendChild(lightbox.el);

    lightbox.page = page;
    lightbox.mode = 'result';
    lightbox.zoom = 1;
    lightbox.source = null;
    lightbox.el.hidden = false;
    document.body.classList.add('lb-open');
    lightbox.title.textContent = 'Загрузка…';

    try {
      await ensureSource(page);
    } catch (err) {
      console.warn('Не удалось отрисовать страницу крупно', err);
    }
    renderLightbox();
  }

  function closeLightbox() {
    if (!lightbox.el) return;
    lightbox.el.hidden = true;
    lightbox.page = null;
    lightbox.source = null;
    document.body.classList.remove('lb-open');
  }

  function setZoom(value) {
    lightbox.zoom = clamp(Number(value) || 1, 0.5, 4);
    applyZoom();
  }

  function applyZoom() {
    if (!lightbox.canvas) return;
    const canvas = lightbox.canvas;
    const available = Math.max(240, lightbox.scroll.clientWidth - 28);
    const base = Math.min(available, canvas.width);
    canvas.style.width = Math.round(base * lightbox.zoom) + 'px';
    canvas.style.height = 'auto';
    lightbox.zoomLabel.textContent = Math.round(lightbox.zoom * 100) + '%';
  }

  function renderLightbox() {
    const page = lightbox.page;
    if (!page || !lightbox.el) return;

    const st = effective(page);
    const placement = core.computePlacement(st.bbox, st);
    const paper = paperName(placement.pageWidth, placement.pageHeight);
    lightbox.title.textContent =
      'Страница ' + (page.index + 1) +
      ' · ' + (paper ? paper : fmtMM(placement.pageWidth) + '×' + fmtMM(placement.pageHeight)) +
      ' · ' + (placement.pageWidth > placement.pageHeight ? 'альбомный' : 'книжный') +
      (isChanged(page) ? ' · изменена' : '');
    lightbox.modeButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.mode === lightbox.mode);
    });

    const canvas = lightbox.canvas;
    const ctx = canvas.getContext('2d');

    if (lightbox.mode === 'source' && lightbox.source) {
      canvas.width = lightbox.source.canvas.width;
      canvas.height = lightbox.source.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(lightbox.source.canvas, 0, 0);
      applyZoom();
      return;
    }

    const k = 2;
    canvas.width = Math.max(1, Math.round(placement.pageWidth * k));
    canvas.height = Math.max(1, Math.round(placement.pageHeight * k));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!lightbox.source) {
      applyZoom();
      return;
    }

    const [a, b, c, d, e, f] = placement.matrix;
    const m = new DOMMatrix([a, b, c, d, e, f]);
    const imgToPt = new DOMMatrix()
      .translate(page.view.x0, page.view.y1)
      .scale(1 / lightbox.source.scale, -1 / lightbox.source.scale);
    const ptToPx = new DOMMatrix([k, 0, 0, -k, 0, placement.pageHeight * k]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(ptToPx.multiply(m).multiply(imgToPt));
    ctx.drawImage(lightbox.source.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    applyZoom();
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
        rotateOne(page, Number(btn.dataset.rot));
        refreshAfterChange();
      });
    });

    card.querySelector('canvas').addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(page);
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
    const selectedCount = state.selected.size;
    const active = selectedCount ? selectedCount : total;
    els.pagesSub.textContent =
      'Предпросмотр результата · ' + (active === 1 ? '1 стр.' : active + ' стр.') +
      (selectedCount && selectedCount !== total ? ' из ' + total : '');

    const totalChanged = state.files.reduce((sum, doc) => sum + doc.pages.filter(isChanged).length, 0);
    const multi =
      state.files.length > 1
        ? ' · всего изменено <b>' + totalChanged + '</b> стр. в ' + state.files.length + ' файлах'
        : '';

    if (!changed.length) {
      els.summaryBox.innerHTML =
        'Изменений пока нет. Нажмите <b>«Развернуть на альбомный»</b>, если бланк свёрстан широко.' + multi;
      els.btnDownload.disabled = false;
      return;
    }
    const sample = changed[0];
    const name = paperName(sample.sheetW, sample.sheetH);
    const label = (name ? name : 'свой размер') + (sample.sheetW > sample.sheetH ? ', альбомный' : ', книжный');
    const ratios = changed.map((p) => core.computePlacement(effective(p).bbox, effective(p)).scale);
    const maxRatio = Math.max.apply(null, ratios);
    const clipped = changed.filter((p) => {
      const pl = core.computePlacement(effective(p).bbox, effective(p));
      return pl.contentHeight > pl.pageHeight + 0.5 || pl.contentWidth > pl.pageWidth + 0.5;
    }).length;
    els.summaryBox.innerHTML =
      'Изменяется <b>' + changed.length + '</b> из ' + total + ' стр. · <b>' + label + '</b>' +
      (maxRatio > 1.03 ? ' · содержимое крупнее в <b>×' + maxRatio.toFixed(2) + '</b>' : '') +
      (clipped ? ' · <b>внимание:</b> обрежется ' + clipped + ' стр.' : '') +
      multi;
    els.btnDownload.disabled = false;
  }

  /* ---------- действия ---------- */
  function targets() {
    const selected = state.pages.filter((p) => state.selected.has(p.index));
    return selected.length ? selected : state.pages;
  }

  // «Применять ко всем файлам»: настройки идут во все документы, а не только в открытый.
  function batchAll() {
    return !!(els.batchAllCheck && els.batchAllCheck.checked && state.files.length > 1);
  }

  function forEachTarget(fn) {
    if (batchAll()) {
      state.files.forEach((doc) => doc.pages.forEach((page) => fn(page, doc)));
      return;
    }
    for (const page of targets()) fn(page, state.doc);
  }

  function refreshAfterChange() {
    updateAllCards();
    renderFileStrip();
  }

  function applySheet(orientation) {
    if (!state.pages.length) return;
    const format = els.fmtSelect.value;
    const margin = clamp(Number(els.marginInput.value) || 0, 0, 40) * MM;
    const crop = els.cropCheck.checked;
    forEachTarget((page) => {
      const sheet = sheetFor(page, orientation, format);
      page.sheetW = sheet.width;
      page.sheetH = sheet.height;
      page.fit = els.fitSelect.value;
      page.margin = margin;
      page.crop = crop;
      page.rotate = 0;
      page.auto = null;
    });
    refreshAfterChange();
  }

  function rotateOne(page, delta) {
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

  function rotateTargets(delta) {
    if (!state.pages.length) return;
    forEachTarget((page) => rotateOne(page, delta));
    refreshAfterChange();
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
    if (!state.pages.length) return;
    forEachTarget((page) => resetPage(page));
    refreshAfterChange();
    toast(batchAll() ? 'Настройки сброшены во всех файлах' : 'Настройки сброшены');
  }

  function selectAll(on) {
    state.selected = new Set();
    if (on) for (const p of state.pages) state.selected.add(p.index);
    updateAllCards();
  }

  /* ---------- сборка результата ---------- */
  async function buildResult(doc) {
    const target = doc || state.doc;
    if (!target) throw new Error('Нет открытого файла');
    const changedPages = target.pages.filter(isChanged);
    if (!changedPages.length) {
      return new Blob([target.bytes], { type: 'application/pdf' });
    }
    const pdf = await PDFDocument.load(target.bytes, { updateMetadata: false });
    const settings = target.pages.map((p) => (isChanged(p) ? effective(p) : null));
    core.applyToDocument(pdf, settings);
    const bytes = await pdf.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function outputName(doc) {
    const target = doc || state.doc;
    const base = ((target && target.name) || 'document').replace(/\.pdf$/i, '');
    const changed = target ? target.pages.filter(isChanged) : [];
    if (!changed.length) return base + '.pdf';
    let suffix = ' (изменённый)';
    const landscape = changed.filter((p) => p.sheetW > p.sheetH).length;
    const portrait = changed.filter((p) => p.sheetH > p.sheetW).length;
    if (landscape === changed.length) suffix = ' (альбомный)';
    else if (portrait === changed.length) suffix = ' (книжный)';
    return base + suffix + '.pdf';
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function setBusy(on) {
    state.busy = on;
    els.btnDownload.disabled = on;
    els.btnZip.disabled = on;
    els.btnPreviewResult.disabled = on;
    document.body.style.cursor = on ? 'progress' : '';
  }

  async function download() {
    if (state.busy || !state.doc) return;
    setBusy(true);
    try {
      const doc = state.doc;
      const blob = await buildResult(doc);
      const name = outputName(doc);
      saveBlob(blob, name);
      toast(
        doc.pages.some(isChanged)
          ? 'Готово: ' + name + ' — сохранён'
          : 'Изменений нет — сохранил исходный файл'
      );
    } catch (err) {
      console.error(err);
      toast('Не получилось сохранить: ' + (err && err.message), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function downloadZip() {
    if (state.busy || state.files.length < 2) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      const used = new Set();
      for (const doc of state.files) {
        const blob = await buildResult(doc);
        const baseName = outputName(doc);
        let name = baseName;
        let counter = 2;
        while (used.has(name)) {
          name = baseName.replace(/\.pdf$/i, ' (' + counter++ + ').pdf');
        }
        used.add(name);
        zip.file(name, blob);
      }
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const name = 'pdf-orientation.zip';
      saveBlob(blob, name);
      toast('Готово: ' + state.files.length + ' файла в архиве ' + name);
    } catch (err) {
      console.error(err);
      toast('Не получилось собрать архив: ' + (err && err.message), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function previewResult() {
    if (state.busy || !state.doc) return;
    const win = window.open('', '_blank');
    if (!win) {
      toast('Разрешите всплывающие окна, чтобы открыть предпросмотр', 'error');
      return;
    }
    setBusy(true);
    try {
      const blob = await buildResult(state.doc);
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
        else if (kind === 'rotate-left') rotateTargets(90);
        else if (kind === 'rotate-right') rotateTargets(-90);
      });
    });

    els.fmtSelect.addEventListener('change', () => {
      if (!state.pages.length) return;
      const value = els.fmtSelect.value;
      forEachTarget((page) => {
        const orientation = page.sheetW > page.sheetH ? 'landscape' : 'portrait';
        const sheet = sheetFor(page, orientation, value);
        page.sheetW = sheet.width;
        page.sheetH = sheet.height;
      });
      refreshAfterChange();
    });

    els.fitSelect.addEventListener('change', () => {
      forEachTarget((page) => {
        page.fit = els.fitSelect.value;
      });
      refreshAfterChange();
    });

    els.marginInput.addEventListener('change', () => {
      const v = clamp(Number(els.marginInput.value) || 0, 0, 40);
      els.marginInput.value = String(v);
      forEachTarget((page) => {
        page.margin = v * MM;
        if (v > 0 && page.fit === 'none') page.fit = 'contain';
      });
      refreshAfterChange();
    });

    els.cropCheck.addEventListener('change', () => {
      forEachTarget((page) => {
        page.crop = els.cropCheck.checked;
      });
      refreshAfterChange();
    });

    els.batchAllCheck.addEventListener('change', () => {
      if (!batchAll()) return;
      toast('Настройки будут применяться ко всем файлам');
    });

    els.autoRotateCheck.addEventListener('change', () => {
      if (els.autoRotateCheck.checked) {
        toast('Автоповорот включён — сработает для вновь открываемых файлов');
      } else {
        toast('Автоповорот выключен — страницы останутся как есть');
      }
    });

    els.btnSelectAll.addEventListener('click', () => {
      const all = state.selected.size === state.pages.length;
      selectAll(!all);
      els.btnSelectAll.textContent = all ? 'Выбрать все' : 'Снять выделение';
    });
    els.btnReset.addEventListener('click', resetTargets);
    els.btnOtherFile.addEventListener('click', () => els.fileInput.click());
    els.btnDownload.addEventListener('click', download);
    els.btnZip.addEventListener('click', downloadZip);
    els.btnPreviewResult.addEventListener('click', previewResult);
    els.btnUndoAuto.addEventListener('click', () => {
      const docs = batchAll() ? state.files : state.doc ? [state.doc] : [];
      for (const doc of docs) {
        for (const page of doc.pages) resetPage(page);
        doc.autoApplied = 0;
      }
      els.autoBanner.classList.remove('is-visible');
      refreshAfterChange();
      toast('Вернул исходную ориентацию');
    });
    els.btnHelp.addEventListener('click', showHelp);

    // Горячие клавиши
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      const key = (e.key || '').toLowerCase();

      if (key === 'escape') {
        if (lightbox.page) {
          e.preventDefault();
          closeLightbox();
        }
        return;
      }
      if (lightbox.page && (key === '+' || key === '=' || key === '-')) {
        e.preventDefault();
        setZoom(lightbox.zoom + (key === '-' ? -0.25 : 0.25));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        download();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!state.pages.length) return;

      if (key === 'r') {
        e.preventDefault();
        rotateTargets(e.shiftKey ? 90 : -90);
        if (lightbox.page) renderLightbox();
        return;
      }
      if (key === 'a') {
        e.preventDefault();
        applySheet('landscape');
        if (lightbox.page) renderLightbox();
        return;
      }
      if (key === 'k') {
        e.preventDefault();
        applySheet('portrait');
        if (lightbox.page) renderLightbox();
      }
    });
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
      '<li><b>Несколько файлов</b> — перетащите сразу пачку PDF. С включённой галочкой «Применять ко всем файлам» настройки ' +
      'применяются ко всей пачке, а <b>Скачать всё (ZIP)</b> отдаёт один архив.</li>' +
      '<li><b>Клик по превью</b> — открывает страницу крупно: масштаб и переключение «Результат / Исходник».</li>' +
      '<li><b>Проверить</b> — открывает готовый файл в новой вкладке, <b>Скачать PDF</b> — сохраняет.</li>' +
      '</ul>' +
      '<p class="muted"><b>Горячие клавиши:</b> R — повернуть по часовой, Shift+R — против часовой, ' +
      'A — альбомный лист, K — книжный, Ctrl+S — скачать, Esc — закрыть просмотр, +/− — масштаб.</p>' +
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
      const file = new File([b64ToBytes(b64)], name || 'test.pdf', { type: 'application/pdf' });
      await addFiles([file]);
      return this.snapshot();
    },
    async loadManyBase64(items) {
      const files = (items || []).map(
        (it) => new File([b64ToBytes(it.b64)], it.name || 'test.pdf', { type: 'application/pdf' })
      );
      await addFiles(files);
      return this.snapshot();
    },
    pageInfo(p, i) {
      return {
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
        autoRotate: p.autoRotate,
        textAngle: p.textAngle,
        textConfidence: p.textConfidence,
        sheetW: +p.sheetW.toFixed(2),
        sheetH: +p.sheetH.toFixed(2),
        fit: p.fit,
        crop: p.crop,
        rotate: p.rotate,
        changed: isChanged(p),
      };
    },
    snapshot() {
      return {
        fileName: state.fileName,
        active: state.active,
        autoApplied: state.autoApplied,
        files: state.files.map((doc, index) => ({
          name: doc.name,
          active: index === state.active,
          pages: doc.pages.map((p, i) => this.pageInfo(p, i)),
        })),
        pages: state.pages.map((p, i) => this.pageInfo(p, i)),
      };
    },
    preset(kind) {
      if (kind === 'landscape') applySheet('landscape');
      else if (kind === 'portrait') applySheet('portrait');
      else if (kind === 'reset') resetTargets();
      else if (kind === 'rotate-left') rotateTargets(90);
      else if (kind === 'rotate-right') rotateTargets(-90);
      return this.snapshot();
    },
    async convertBase64(fileIndex) {
      const doc = fileIndex == null ? state.doc : state.files[fileIndex];
      const blob = await buildResult(doc);
      const buf = new Uint8Array(await blob.arrayBuffer());
      return bytesToB64(buf);
    },
    async zipBase64() {
      const zip = new JSZip();
      for (const doc of state.files) zip.file(outputName(doc), await buildResult(doc));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      return bytesToB64(new Uint8Array(await blob.arrayBuffer()));
    },
    select(ids) {
      state.selected = new Set(ids.map((n) => n - 1));
      updateAllCards();
    },
    switchFile(index) {
      switchFile(index);
      return this.snapshot();
    },
    removeFile(index) {
      removeFile(index);
      return this.snapshot();
    },
    setBatchAll(on) {
      els.batchAllCheck.checked = !!on;
      return this.snapshot();
    },
    async resultPageSizes(fileIndex) {
      const doc = fileIndex == null ? state.doc : state.files[fileIndex];
      const blob = await buildResult(doc);
      const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { updateMetadata: false });
      return pdf.getPages().map((p) => ({
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
    openPreview(index) {
      return openLightbox(state.pages[index || 0]);
    },
    closePreview() {
      closeLightbox();
    },
    lightboxState() {
      return {
        open: !!lightbox.page,
        mode: lightbox.mode,
        zoom: lightbox.zoom,
        title: lightbox.title ? lightbox.title.textContent : '',
      };
    },
  };

  /* ---------- старт ---------- */
  bindEvents();
  updateSummary();
})();
