// Проверки безопасности статической сборки и санитайзера имён файлов.
// Запуск: node dev/test-security.js
const fs = require('fs');
const path = require('path');
const core = require('../src/orient-core.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log('  ok  ' + name);
  } else {
    failures++;
    console.error('  FAIL ' + name);
  }
}

console.log('CSP и отсутствие внешних ресурсов в index.html');
const html = read('index.html');
check('есть Content-Security-Policy', /http-equiv="Content-Security-Policy"/.test(html));
check('connect-src \'none\' (запрет сети)', /connect-src 'none'/.test(html));
check('нет внешних <script src=...>', !/<script[^>]+src=/i.test(html));
check('нет внешних <link href="http...">', !/<link[^>]+href="https?:/i.test(html));
check('нет <iframe>', !/<iframe/i.test(html));

console.log('\nИсходники не содержат опасных примитивов');
for (const file of ['src/app.js', 'src/orient-core.js']) {
  const code = read(file);
  check(file + ': нет eval(', !/\beval\s*\(/.test(code));
  check(file + ': нет new Function(', !/new\s+Function\s*\(/.test(code));
  check(file + ': нет fetch(', !/\bfetch\s*\(/.test(code));
  check(file + ': нет XMLHttpRequest', !/XMLHttpRequest/.test(code));
  check(file + ': нет WebSocket', !/WebSocket/.test(code));
  check(file + ': нет document.cookie', !/document\.cookie/.test(code));
  check(file + ': нет localStorage', !/localStorage/.test(code));
}

console.log('\nСанитайзер имён файлов (защита от zip-slip)');
const cases = [
  ['../../etc/passwd', (v) => !v.includes('/') && !v.includes('..') && v.length > 0],
  ['C:\\temp\\invoice.pdf', (v) => !v.includes('\\') && !v.includes(':') && v.length > 0],
  ['a\u0000b\u001f.pdf', (v) => !/[\u0000-\u001f]/.test(v) && v.length > 0],
  ['..', (v) => v === 'document'],
  ['   ', (v) => v === 'document'],
  ['нормальный счёт.pdf', (v) => v === 'нормальный счёт.pdf'],
  ['x'.repeat(300), (v) => v.length <= 120],
];
for (const [input, predicate] of cases) {
  const value = core.safeFileName(input, 'document');
  check(JSON.stringify(input).slice(0, 40) + ' -> ' + JSON.stringify(value).slice(0, 40), predicate(value));
}

console.log('\nZIP-записи в приложении строятся через safeFileName');
const app = read('src/app.js');
check('outputName использует core.safeFileName', /core\.safeFileName\(/.test(app));
check('имена в ZIP берутся из outputName', /zip\.file\(name, blob\)/.test(app));

console.log('\nФайл имён в download-атрибуте очищается');
check('saveBlob получает уже очищенное имя', /a\.download = name/.test(app));

if (failures) {
  console.error('\nПровалено проверок: ' + failures);
  process.exit(1);
}
console.log('\nOK');
