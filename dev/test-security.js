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

// Версия в подвале — ссылка на страницу проекта. Навигация по явному клику
// не является сетевым запросом и разрешена, но в шаблоне не должно быть
// никаких других внешних <a href>.
console.log('\nВерсия в подвале — ссылка на страницу проекта');
const REPO_URL = 'https://github.com/aleandr1tester/pdf-orientation/';
const verLink = html.match(/<a\b[^>]*class="ver"[^>]*>[\s\S]*?<\/a>/i);
check('в подвале index.html есть ссылка .ver', !!verLink);
check('ссылка ведёт на страницу проекта на GitHub', !!verLink && verLink[0].includes('href="' + REPO_URL + '"'));
check('номер версии подставлен сборкой (v<semver>)', !!verLink && /^v\d+\.\d+\.\d+$/.test(verLink[0].replace(/<[^>]+>/g, '').trim()));
check('внешняя ссылка открывается в новой вкладке без доступа к opener', !!verLink && /target="_blank"/.test(verLink[0]) && /rel="noopener noreferrer"/.test(verLink[0]));
const template = read('src/index.template.html');
const externalHrefs = [...template.matchAll(/<a\b[^>]*href="(https?:[^"]+)"/gi)].map((m) => m[1]);
check('в шаблоне внешние ссылки — только страница проекта', externalHrefs.length === 1 && externalHrefs[0] === REPO_URL);

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

// Правило проекта: в текстах, комментариях и коде — только русский и английский.
// Китайские иероглифы запрещены: они легко попадают в комментарии по ошибке.
console.log('\nНет китайских символов в текстах и коде');
const TEXT_EXT = /\.(js|mjs|cjs|html|css|md|json|yml|yaml|txt)$/i;
const CJK = /[\u4e00-\u9fff]/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dev/out', '.tmp-edge-profile']);
const cjkFiles = [];
let scanned = 0;

function walkTextFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
      walkTextFiles(full);
      continue;
    }
    if (!TEXT_EXT.test(entry.name)) continue;
    scanned++;
    if (CJK.test(fs.readFileSync(full, 'utf8'))) cjkFiles.push(rel);
  }
}
walkTextFiles(ROOT);
check('китайских символов нет в ' + scanned + ' текстовых файлах', cjkFiles.length === 0);
for (const file of cjkFiles) console.error('  файл с CJK: ' + file);

if (failures) {
  console.error('\nПровалено проверок: ' + failures);
  process.exit(1);
}
console.log('\nOK');
