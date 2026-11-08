// Сквозной тест в настоящем браузере (Edge headless) через CDP.
// Запуск: node dev/test-browser.js <input.pdf> <out.pdf> [screenshot.png]
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
].filter(Boolean);
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error('Не найден Edge/Chrome. Укажите путь через переменную EDGE_PATH.');
  process.exit(1);
}
const ROOT = path.resolve(__dirname, '..');
const APP = process.env.APP_URL || 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const PORT = Number(process.env.CDP_PORT || 9333);

const input = process.argv[2];
const outPdf = process.argv[3];
const shotArg = process.argv[4] || '-';
const shot = shotArg === '-' ? null : shotArg;
let actions = process.argv[5] || null;
if (actions && fs.existsSync(actions)) actions = fs.readFileSync(actions, 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 30000, interval = 150) {
  const t0 = Date.now();
  let lastErr;
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error('Таймаут ожидания' + (lastErr ? ': ' + lastErr.message : ''));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP таймаут: ' + method));
        }
      }, 120000);
    });
  }
}

(async () => {
  if (!input || !outPdf) throw new Error('Нужны аргументы: input.pdf out.pdf [screenshot.png]');
  const profile = path.join(ROOT, '.tmp-edge-profile');
  fs.rmSync(profile, { recursive: true, force: true });

  const edge = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const version = await waitFor(async () => {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      return r.ok ? r.json() : null;
    }, 20000);

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);

    await s('Page.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    const consoleLines = [];
    cdp.events.push = function (ev) {
      if (ev.method === 'Runtime.consoleAPICalled') {
        consoleLines.push(ev.params.type + ': ' + ev.params.args.map((a) => a.value != null ? a.value : a.description || a.type).join(' '));
      }
      if (ev.method === 'Runtime.exceptionThrown') {
        consoleLines.push('EXCEPTION: ' + JSON.stringify(ev.params.exceptionDetails.exception || ev.params.exceptionDetails.text));
      }
      return Array.prototype.push.call(this, ev);
    };

    await s('Page.navigate', { url: APP });
    await waitFor(async () => {
      const r = await s('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      return r.result.value === 'complete' && (await s('Runtime.evaluate', { expression: 'typeof window.__PDFORIENT__', returnByValue: true })).result.value === 'object';
    }, 30000);

    const b64 = fs.readFileSync(input).toString('base64');
    const name = path.basename(input);
    const snapshot = await s('Runtime.evaluate', {
      expression: `window.__PDFORIENT__.loadBase64(${JSON.stringify(b64)}, ${JSON.stringify(name)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (snapshot.exceptionDetails) throw new Error('load: ' + JSON.stringify(snapshot.exceptionDetails));
    console.log('SNAPSHOT', JSON.stringify(snapshot.result.value, null, 1));

    if (actions) {
      const act = await s('Runtime.evaluate', {
        expression: actions,
        awaitPromise: true,
        returnByValue: true,
      });
      if (act.exceptionDetails) throw new Error('actions: ' + JSON.stringify(act.exceptionDetails));
      const v = act.result.value;
      const printable = v && typeof v === 'object' && v.data ? Object.assign({}, v, { data: '<' + String(v.data).length + ' chars>' }) : v;
      console.log('ACTIONS', JSON.stringify(printable));
      if (v && v.__image && v.data) {
        fs.writeFileSync(v.__image + '.png', Buffer.from(String(v.data).split(',')[1], 'base64'));
        console.log('IMAGE', v.__image + '.png', v.w, v.h);
      }
      const after = await s('Runtime.evaluate', {
        expression: 'window.__PDFORIENT__.snapshot()',
        returnByValue: true,
      });
      console.log('AFTER', JSON.stringify(after.result.value, null, 1));
    }

    const conv = await s('Runtime.evaluate', {
      expression: 'window.__PDFORIENT__.convertBase64()',
      awaitPromise: true,
      returnByValue: true,
    });
    if (conv.exceptionDetails) throw new Error('convert: ' + JSON.stringify(conv.exceptionDetails));
    const outBytes = Buffer.from(conv.result.value, 'base64');
    fs.writeFileSync(outPdf, outBytes);
    console.log('SAVED', outPdf, outBytes.length);

    if (shot) {
      await s('Runtime.evaluate', { expression: 'window.scrollTo(0,0)', returnByValue: true });
      await sleep(600);
      const layout = await s('Page.getLayoutMetrics');
      const height = Math.min(Math.ceil(layout.cssContentSize.height || 1000), 4000);
      await s('Emulation.setDeviceMetricsOverride', {
        width: 1440, height, deviceScaleFactor: 1, mobile: false,
      });
      await sleep(500);
      const img = await s('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(shot, Buffer.from(img.data, 'base64'));
      console.log('SCREENSHOT', shot);
    }

    if (process.env.DOWNLOAD_DIR) {
      const dir = process.env.DOWNLOAD_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
      await s('Runtime.evaluate', { expression: "document.getElementById('btnDownload').click()" });
      const files = await waitFor(async () => {
        const list = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));
        if (!list.length) return null;
        const full = path.join(dir, list[0]);
        const st = fs.statSync(full);
        if (st.size < 1000) return null;
        return [{ name: list[0], size: st.size }];
      }, 20000, 250);
      console.log('DOWNLOAD', JSON.stringify(files));
    }

    if (consoleLines.length) console.log('CONSOLE:\n' + consoleLines.join('\n'));
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    ws.close();
  } finally {
    edge.kill();
  }
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
