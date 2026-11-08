// Действие для сквозного теста: открывает два файла в пакетном режиме,
// применяет пресет «альбомный» ко всем файлам, собирает ZIP и проверяет размеры.
// Запуск через dev/test-browser.js с переменной LOAD_FILES.
(async () => {
  const before = __PDFORIENT__.snapshot();
  // Галочка «Применять ко всем файлам» включена по умолчанию — пресет идёт во все.
  __PDFORIENT__.preset('landscape');
  const after = __PDFORIENT__.snapshot();
  const zipB64 = await __PDFORIENT__.zipBase64();

  // Вырежем из снапшота лишнее, чтобы вывод теста был читаемым.
  const filesBefore = before.files.map((f) => ({
    name: f.name,
    pages: f.pages.length,
    auto: f.pages.map((p) => p.auto),
  }));
  const filesAfter = after.files.map((f) => ({
    name: f.name,
    changed: f.pages.filter((p) => p.changed).length,
    dims: f.pages.map((p) => [p.sheetW, p.sheetH]),
  }));

  return {
    filesBefore,
    filesAfter,
    activeBefore: before.active,
    activeAfter: after.active,
    zipLen: zipB64.length,
    __b64: zipB64,
    __file: 'dev/out/batch.zip',
  };
})()
