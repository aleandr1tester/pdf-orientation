// Действие для сквозного теста: возвращает итоговые размеры страниц после конвертации.
(async () => {
  const snapshot = __PDFORIENT__.snapshot();
  const sizes = await __PDFORIENT__.resultPageSizes();
  return {
    pages: snapshot.pages.map((p) => ({ changed: p.changed, w: p.sheetW, h: p.sheetH })),
    sizes,
  };
})()
