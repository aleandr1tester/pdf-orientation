// Действие для сквозного теста: проверяет горячие клавиши (A — альбомный, R / Shift+R — поворот).
(() => {
  const before = __PDFORIENT__.snapshot();
  const dispatch = (key, shiftKey) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: !!shiftKey, bubbles: true }));

  dispatch('a');
  const afterA = __PDFORIENT__.snapshot();
  dispatch('r');
  const afterR = __PDFORIENT__.snapshot();
  dispatch('r', true);
  const afterShiftR = __PDFORIENT__.snapshot();

  return {
    sheetBefore: [before.pages[0].sheetW, before.pages[0].sheetH],
    sheetAfterA: [afterA.pages[0].sheetW, afterA.pages[0].sheetH],
    rotateAfterR: afterR.pages[0].rotate,
    rotateAfterShiftR: afterShiftR.pages[0].rotate,
  };
})()
