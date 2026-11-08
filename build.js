/*
 * build.js — сборка одного автономного index.html из исходников и вендорных библиотек.
 *
 * Зачем: приложение должно работать как один файл (двойной клик, file://, любой
 * статический хостинг) и не делать ни одного сетевого запроса. Поэтому все
 * библиотеки и стили не подключаются ссылками, а вставляются в HTML.
 *
 * Как: в src/index.template.html есть токены-заглушки (/*__APP__*\/ и т.п.),
 * скрипт последовательно заменяет их содержимым файлов. Токен __VERSION__
 * берётся из package.json, чтобы версия в подвале не расходилась с релизом.
 *
 * Запуск: node build.js
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Исходники проекта
const template = read('src/index.template.html');
const pkg = JSON.parse(read('package.json'));
const css = read('src/style.css');
const core = read('src/orient-core.js');
const app = read('src/app.js');
// Вендорные библиотеки (лежат локально, качаются из npm/unpkg при обновлении вручную)
const pdfLib = read('vendor/pdf-lib.min.js');
const pdfJs = read('vendor/pdf.min.js');
const jszip = read('vendor/jszip.min.js');
const worker = read('vendor/pdf.worker.min.js');

// Защита сборки: если внутри библиотеки встретится закрывающий тег script,
// вставка «как есть» сломает HTML. Такое лучше поймать здесь, чем в браузере.
const parts = { pdfLib, pdfJs, jszip, worker };
for (const [name, src] of Object.entries(parts)) {
  if (/<\/script/i.test(src)) throw new Error('В ' + name + ' найден </script — нужна экранировка');
}

let html = template;
const put = (token, value) => {
  if (!html.includes(token)) throw new Error('В шаблоне нет токена ' + token);
  // split/join, а не replace: в минифицированном JS встречаются «$&» и подобное,
  // что в String.replace() имеет особый смысл.
  html = html.split(token).join(value);
};

put('/*__STYLE__*/', css);
put('__VERSION__', pkg.version || 'dev');
put('/*__PDFLIB__*/', pdfLib);
put('/*__PDFJS__*/', pdfJs);
put('/*__JSZIP__*/', jszip);
put('/*__CORE__*/', core);
put('/*__APP__*/', app);
put('/*__WORKER__*/', worker);

const out = path.join(root, 'index.html');
fs.writeFileSync(out, html, 'utf8');
console.log('index.html:', (Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2), 'MB');
