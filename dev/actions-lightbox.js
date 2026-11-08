(async () => {
  await __PDFORIENT__.openPreview(0);
  const opened = __PDFORIENT__.lightboxState();

  document.querySelector('[data-mode="source"]').click();
  const source = __PDFORIENT__.lightboxState();
  document.querySelector('[data-mode="result"]').click();
  const result = __PDFORIENT__.lightboxState();

  document.querySelector('[data-zoom="1"]').click();
  document.querySelector('[data-zoom="1"]').click();
  const zoomed = __PDFORIENT__.lightboxState();
  document.querySelector('[data-zoom="-1"]').click();
  document.querySelector('[data-zoom="-1"]').click();

  return { opened, source, result, zoomed, final: __PDFORIENT__.lightboxState() };
})()
