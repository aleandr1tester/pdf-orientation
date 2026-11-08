(async () => {
  const s0 = __PDFORIENT__.snapshot();
  const switched = __PDFORIENT__.switchFile(1);
  const activeName = switched.fileName;
  const activeDims = switched.pages.map((p) => [p.sheetW, p.sheetH]);
  const removed = __PDFORIENT__.removeFile(0);
  return {
    filesAtStart: s0.files.map((f) => f.name),
    activeAfterSwitch: switched.active,
    activeName,
    activeDims,
    filesAfterRemove: removed.files.map((f) => f.name),
    activeAfterRemove: removed.active,
    zipButtonVisible: !document.getElementById('btnZip').hidden,
  };
})()
