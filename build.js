// Сборка одного автономного HTML-файла из исходников и вендорных библиотек.
// Запуск: node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const template = read('src/index.template.html');
const css = read('src/style.css');
const core = read('src/orient-core.js');
const app = read('src/app.js');
const pdfLib = read('vendor/pdf-lib.min.js');
const pdfJs = read('vendor/pdf.min.js');
const worker = read('vendor/pdf.worker.min.js');

const parts = { pdfLib, pdfJs, worker };
for (const [name, src] of Object.entries(parts)) {
  if (/<\/script/i.test(src)) throw new Error('В ' + name + ' найден </script — нужна экранировка');
}

let html = template;
const put = (token, value) => {
  if (!html.includes(token)) throw new Error('В шаблоне нет токена ' + token);
  html = html.split(token).join(value);
};

put('/*__STYLE__*/', css);
put('/*__PDFLIB__*/', pdfLib);
put('/*__PDFJS__*/', pdfJs);
put('/*__CORE__*/', core);
put('/*__APP__*/', app);
put('/*__WORKER__*/', worker);

const out = path.join(root, 'index.html');
fs.writeFileSync(out, html, 'utf8');
console.log('index.html:', (Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2), 'MB');
