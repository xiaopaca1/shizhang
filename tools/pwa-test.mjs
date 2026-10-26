import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'preview');
const PROFILE = '/tmp/shizhang-pwa-chrome-' + Date.now();
const PREFIX = '/shizhang';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const issues = [];
const results = [];

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      // 模拟 GitHub Pages 项目站点：https://<user>.github.io/shizhang/
      if (pathname !== PREFIX && !pathname.startsWith(PREFIX + '/')) {
        res.writeHead(404); res.end('not found'); return;
      }
      pathname = pathname.slice(PREFIX.length) || '/';
      if (pathname === '/') pathname = '/index.html';
      const file = path.join(ROOT, pathname);
      if (!file.startsWith(ROOT + path.sep)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        issues.push('EXCEPTION: ' + (d.exception?.description || d.text));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        issues.push('CONSOLE: ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        issues.push('LOG: ' + msg.params.entry.text);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function waitForJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('Chrome CDP not ready: ' + url);
}

async function waitReady(cdp) {
  for (let i = 0; i < 100; i++) {
    try {
      if (await cdp.eval('document.readyState') === 'complete') break;
    } catch {}
    await sleep(100);
  }
  await sleep(500);
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('📸', name);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await rm(PROFILE, { recursive: true, force: true });

  const server = await serve();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}${PREFIX}`;
  console.log('server:', base);

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--disable-gpu',
    '--window-size=390,844',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('no page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });

    await cdp.send('Page.navigate', { url: `${base}/index.html` });
    await waitReady(cdp);

    // 等 Service Worker 激活并接管页面
    const swState = await cdp.eval(`(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.ready;
      const ctrl = await Promise.race([
        new Promise(resolve => {
          if (navigator.serviceWorker.controller) return resolve(true);
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 6000);
        }),
        new Promise(resolve => setTimeout(() => resolve(false), 7000))
      ]);
      return { supported: true, scope: reg.scope, active: !!reg.active, controller: !!navigator.serviceWorker.controller || ctrl };
    })()`);
    console.log('SW:', swState);
    results.push(['service worker注册成功', swState.supported && swState.active && swState.controller, JSON.stringify(swState)]);
    results.push(['SW scope 适配子路径', swState.scope.endsWith('/shizhang/'), swState.scope]);

    const cacheInfo = await cdp.eval(`(async () => {
      const keys = await caches.keys();
      if (!keys.length) return { keys, count: 0 };
      const cache = await caches.open(keys[0]);
      const entries = await cache.keys();
      return { keys, count: entries.length };
    })()`);
    console.log('cache:', cacheInfo);
    results.push(['应用外壳已缓存', cacheInfo.count >= 8, JSON.stringify(cacheInfo)]);

    // Manifest 与应用可安装性
    const manifest = await cdp.send('Page.getAppManifest');
    const manifestJson = manifest.data ? JSON.parse(manifest.data) : null;
    console.log('manifest errors:', manifest.errors);
    results.push(['manifest 可解析', !!manifestJson && manifestJson.name === '拾账 · 简单记账', JSON.stringify(manifestJson && { name: manifestJson.name, display: manifestJson.display, start_url: manifestJson.start_url })]);
    results.push(['manifest 无错误', Array.isArray(manifest.errors) && manifest.errors.length === 0, JSON.stringify(manifest.errors)]);

    let installability = { installabilityErrors: [] };
    try {
      installability = await cdp.send('Page.getInstallabilityErrors');
    } catch (e) {
      issues.push('installability check: ' + e.message);
    }
    console.log('installability errors:', installability.installabilityErrors);
    results.push(['可安装性检查', installability.installabilityErrors.length === 0, JSON.stringify(installability.installabilityErrors)]);

    const icons = await cdp.eval(`Promise.all(['icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'].map(async src => {
      const res = await fetch(src);
      return { src, status: res.status, type: res.headers.get('content-type') };
    }))`);
    results.push(['图标均可访问', icons.every(i => i.status === 200 && i.type === 'image/png'), JSON.stringify(icons)]);

    await shot(cdp, 'pwa-home.png');

    await cdp.eval(`location.hash = '#settings'`);
    await sleep(600);
    const installCard = await cdp.eval(`(() => ({
      text: document.getElementById('installText').textContent,
      status: document.getElementById('installStatus').textContent,
      buttonHidden: document.getElementById('installBtn').hidden
    }))()`);
    console.log('install card:', installCard);
    results.push(['安装说明可见', installCard.text.length > 10, JSON.stringify(installCard)]);
    results.push(['离线缓存状态', installCard.status.includes('离线缓存'), installCard.status]);
    await cdp.eval(`document.getElementById('installCard').scrollIntoView({ block: 'center' })`);
    await sleep(400);
    await shot(cdp, 'pwa-install-card.png');
    await cdp.eval(`location.hash = '#home'`);

    // 离线重载
    await cdp.eval(`location.hash = '#home'`);
    await sleep(300);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
    await cdp.send('Page.reload');
    await sleep(1800);
    const offline = await cdp.eval(`(() => ({
      title: document.title,
      hero: !!document.querySelector('.hero'),
      online: navigator.onLine,
      text: document.body.innerText.slice(0, 80)
    }))()`);
    console.log('offline:', offline);
    results.push(['断网后仍可打开', offline.title.includes('拾账') && offline.hero && offline.online === false, JSON.stringify(offline)]);
    await shot(cdp, 'pwa-offline.png');

    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });

    console.log('');
    let failed = 0;
    for (const [name, ok, detail] of results) {
      console.log(`${ok ? '✅' : '❌'} ${name} :: ${detail}`);
      if (!ok) failed++;
    }

    console.log('\n--- console issues ---');
    console.log(issues.length ? issues.join('\n') : 'none');
    console.log(`\nPWA RESULT: ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    chrome.kill('SIGKILL');
    server.close();
  }
}

main().catch(err => {
  console.error('FATAL', err);
  process.exitCode = 1;
});
