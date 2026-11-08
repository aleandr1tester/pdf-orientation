(() => {
  const snap = __PDFORIENT__.snapshot();
  return {
    pages: snap.pages.map((p) => ({
      textAngle: p.textAngle,
      conf: p.textConfidence,
      autoRotate: p.autoRotate,
      rotate: p.rotate,
      auto: p.auto,
      sheet: [p.sheetW, p.sheetH],
      bbox: [p.bbox.x0, p.bbox.y0, p.bbox.x1, p.bbox.y1],
      changed: p.changed,
    })),
    files: snap.files.map((f) => ({ name: f.name, pages: f.pages.length })),
  };
})()
