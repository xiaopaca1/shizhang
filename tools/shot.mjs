import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const OUT = path.join(ROOT, 'preview');
const PROFILE = '/tmp/shizhang-chrome-' + Date.now();
const DOWNLOAD_DIR = '/tmp/shizhang-downloads';

const issues = [];

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
  for (let i = 0; i < 80; i++) {
    try {
      const state = await cdp.eval('document.readyState');
      if (state === 'complete') break;
    } catch {}
    await sleep(100);
  }
  await sleep(450);
}

async function shot(cdp, name, full = false) {
  const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (full) {
    const m = await cdp.send('Page.getLayoutMetrics');
    const { width, height } = m.cssContentSize;
    params.clip = { x: 0, y: 0, width, height, scale: 1 };
    params.captureBeyondViewport = true;
  }
  const { data } = await cdp.send('Page.captureScreenshot', params);
  await writeFile(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('📸', name);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await rm(PROFILE, { recursive: true, force: true });

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
    '--force-color-profile=srgb',
    '--window-size=1440,1000',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const version = await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
    console.log('Chrome:', version.Browser);

    const targets = await waitForJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('no page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
    });

    // 首次打开（空账本）
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitReady(cdp);
    await shot(cdp, 'empty-home-desktop.png', true);
    await cdp.eval(`location.hash = '#records'`);
    await sleep(400);
    await shot(cdp, 'empty-records-desktop.png');

    // 通过空状态按钮载入示例数据
    await cdp.eval(`location.hash = '#home'`);
    await sleep(400);
    await cdp.eval(`document.querySelector('[data-action="load-demo"]').click()`);
    await sleep(2800);

    console.log('storage ok:', await cdp.eval('(() => { try { localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return true; } catch(e) { return String(e); } })()'));
    console.log('entries:', await cdp.eval(`(() => { const s = localStorage.getItem('shizhang.v1'); return s ? JSON.parse(s).entries.length : 'no-data'; })()`));

    await shot(cdp, 'home-desktop.png', true);

    // records
    await cdp.eval(`location.hash = '#records'`);
    await sleep(500);
    await shot(cdp, 'records-desktop.png');

    // stats
    await cdp.eval(`location.hash = '#stats'`);
    await sleep(600);
    await shot(cdp, 'stats-desktop.png', true);

    // settings
    await cdp.eval(`location.hash = '#settings'`);
    await sleep(500);
    await shot(cdp, 'settings-desktop.png');

    // dark home
    await cdp.eval(`document.querySelector('[data-theme-option="dark"]').click()`);
    await cdp.eval(`location.hash = '#home'`);
    await sleep(500);
    await shot(cdp, 'home-dark.png');

    // back to light
    await cdp.eval(`document.querySelector('[data-theme-option="light"]').click()`);
    await sleep(250);

    // mobile
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await cdp.eval(`location.hash = '#home'`);
    await sleep(500);
    await shot(cdp, 'home-mobile.png');

    // mobile composer
    await cdp.eval(`document.querySelector('.nav-add').click()`);
    await sleep(500);
    await shot(cdp, 'composer-mobile.png');

    await cdp.eval(`document.querySelector('[data-action="close-composer"]').click()`);
    await sleep(300);

    // mobile records
    await cdp.eval(`location.hash = '#records'`);
    await sleep(500);
    await shot(cdp, 'records-mobile.png');

    // mobile stats
    await cdp.eval(`location.hash = '#stats'`);
    await sleep(500);
    await shot(cdp, 'stats-mobile.png');

    // mobile settings
    await cdp.eval(`location.hash = '#settings'`);
    await sleep(450);
    await shot(cdp, 'settings-mobile.png');

    // tablet home
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 768, height: 1024, deviceScaleFactor: 1, mobile: true
    });
    await cdp.eval(`location.hash = '#home'`);
    await sleep(500);
    await shot(cdp, 'home-tablet.png');

    // desktop composer
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
    });
    await cdp.eval(`location.hash = '#home'`);
    await sleep(400);
    await cdp.eval(`document.querySelector('.top-add').click()`);
    await sleep(500);
    await shot(cdp, 'composer-desktop.png');
    await cdp.eval(`document.querySelector('[data-action="close-composer"]').click()`);
    await sleep(300);

    // sticky header when scrolled
    await cdp.eval(`location.hash = '#records'`);
    await sleep(400);
    await cdp.eval(`window.scrollTo(0, 520)`);
    await sleep(450);
    await shot(cdp, 'records-scrolled.png');
    await cdp.eval(`window.scrollTo(0, 0)`);
    await cdp.eval(`location.hash = '#home'`);
    await sleep(300);

    // ---- 交互测试 ----
    console.log('\n--- interaction tests ---');
    const results = [];

    const initial = await cdp.eval(`JSON.parse(localStorage.getItem('shizhang.v1')).entries.length`);
    results.push(['demo loaded', initial > 20, initial]);

    await cdp.eval(`document.querySelector('.nav-add').click()`);
    await sleep(400);

    const zeroText = await cdp.eval(`document.getElementById('amountValue').textContent`);
    results.push(['default amount is 0.00', zeroText === '0.00', zeroText]);

    const delHidden = await cdp.eval(`document.getElementById('composerDelete').hidden`);
    results.push(['delete hidden for new entry', delHidden === true, delHidden]);

    await cdp.eval(`document.querySelector('[data-action="save-entry"]').click()`);
    await sleep(250);
    const emptyGuard = await cdp.eval(`(() => ({ toast: document.getElementById('toast').textContent, n: JSON.parse(localStorage.getItem('shizhang.v1')).entries.length }))()`);
    results.push(['empty amount rejected', emptyGuard.n === initial && emptyGuard.toast.includes('金额'), JSON.stringify(emptyGuard)]);

    await cdp.eval(`document.querySelector('[data-draft-type="income"]').click()`);
    await sleep(200);
    const incomeCats = await cdp.eval(`Array.from(document.querySelectorAll('#catGrid .cat')).map(el => el.textContent.trim())`);
    results.push(['income categories switch', incomeCats.length === 6 && incomeCats[0].includes('工资'), incomeCats.join(',')]);
    await cdp.eval(`document.querySelector('[data-draft-type="expense"]').click()`);
    await sleep(200);

    // type 12.50
    for (const key of ['1', '2', '.', '5', '0']) {
      await cdp.eval(`document.querySelector('[data-key="${key}"]').click()`);
      await sleep(40);
    }
    const typed = await cdp.eval(`document.getElementById('amountValue').textContent`);
    results.push(['amount typed', typed === '12.50', typed]);

    await cdp.eval(`document.querySelector('[data-action="save-entry"]').click()`);
    await sleep(600);

    const afterAdd = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return { n: s.entries.length, books: s.books.length, demo: !!(b && b.demo), budget: b ? b.budget : null, count: document.getElementById('heroCount').textContent };
    })()`);
    results.push(['demo auto-cleared on save', afterAdd.demo === false, JSON.stringify(afterAdd)]);
    results.push(['real entry saved', afterAdd.n === 1, afterAdd.n]);

    // reload keeps the real entry
    await cdp.send('Page.reload');
    await waitReady(cdp);
    await sleep(800);
    const persistedEntry = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return { n: s.entries.length, demo: !!(b && b.demo), amount: s.entries[0] && s.entries[0].amount };
    })()`);
    results.push(['real entry persists', persistedEntry.n === 1 && persistedEntry.demo === false, JSON.stringify(persistedEntry)]);

    // edit entry
    await cdp.eval(`location.hash = '#home'`);
    await sleep(300);
    await cdp.eval(`document.querySelector('#recentList .entry').click()`);
    await sleep(400);
    const editTitle = await cdp.eval(`document.getElementById('composerTitle').textContent`);
    results.push(['edit opens existing entry', editTitle === '编辑记录', editTitle]);
    await cdp.eval(`document.querySelector('[data-key="back"]').click()`);
    await cdp.eval(`document.querySelector('[data-key="back"]').click()`);
    await cdp.eval(`document.querySelector('[data-key="3"]').click()`);
    await cdp.eval(`document.querySelector('[data-action="save-entry"]').click()`);
    await sleep(500);
    const edited = await cdp.eval(`JSON.parse(localStorage.getItem('shizhang.v1')).entries[0].amount`);
    results.push(['entry edited', edited === 12.3, edited]);

    // delete entry
    await cdp.eval(`document.querySelector('#recentList .entry').click()`);
    await sleep(400);
    await cdp.eval(`document.querySelector('[data-action="delete-entry"]').click()`);
    await sleep(400);
    await cdp.eval(`document.querySelector('[data-action="confirm-ok"]').click()`);
    await sleep(500);
    const afterDelete = await cdp.eval(`JSON.parse(localStorage.getItem('shizhang.v1')).entries.length`);
    results.push(['entry deleted', afterDelete === 0, afterDelete]);

    // budget
    await cdp.eval(`location.hash = '#settings'`);
    await sleep(300);
    await cdp.eval(`(() => { const el = document.getElementById('budgetInput'); el.value = '2500'; document.querySelector('[data-action="save-budget"]').click(); })()`);
    await sleep(400);
    const budget = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return b ? b.budget : null;
    })()`);
    results.push(['budget saved', budget === 2500, budget]);

    // reload persistence
    await cdp.send('Page.reload');
    await waitReady(cdp);
    await sleep(900);
    const persisted = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return { budget: b ? b.budget : null, theme: s.theme, books: s.books.length };
    })()`);
    results.push(['persist after reload', persisted.budget === 2500, JSON.stringify(persisted)]);

    // load demo from the empty settings page
    await cdp.eval(`document.querySelector('[data-action="load-demo"]').click()`);
    await sleep(600);
    const reseeded = await cdp.eval(`JSON.parse(localStorage.getItem('shizhang.v1')).entries.length`);
    results.push(['demo loads from settings', reseeded > 20, reseeded]);

    await cdp.eval(`location.hash = '#records'`);
    await sleep(400);
    const recordCount = await cdp.eval(`document.querySelectorAll('#recordsList .entry').length`);
    results.push(['records render all', recordCount > 50, recordCount]);

    await cdp.eval(`(() => { const el = document.getElementById('searchInput'); el.value = '咖啡'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(450);
    const searchCount = await cdp.eval(`document.querySelectorAll('#recordsList .entry').length`);
    results.push(['search filters', searchCount > 0 && searchCount < recordCount, searchCount]);

    await cdp.eval(`(() => { const el = document.getElementById('searchInput'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(400);
    const clearedCount = await cdp.eval(`document.querySelectorAll('#recordsList .entry').length`);
    results.push(['clear search', clearedCount === recordCount, clearedCount]);

    // CSV / JSON download
    await rm(DOWNLOAD_DIR, { recursive: true, force: true });
    await mkdir(DOWNLOAD_DIR, { recursive: true });
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });

    await cdp.eval(`document.querySelector('[data-action="export-csv"]').click()`);
    await sleep(900);
    let files = await readdir(DOWNLOAD_DIR);
    const csvName = files.find(f => f.endsWith('.csv'));
    let csvCheck = { ok: false, files };
    if (csvName) {
      const content = await readFile(path.join(DOWNLOAD_DIR, csvName), 'utf8');
      const lines = content.split('\r\n');
      csvCheck = {
        ok: content.charCodeAt(0) === 0xFEFF && lines.length === 208 && content.includes('"日期"'),
        lines: lines.length,
        size: content.length
      };
    }
    results.push(['CSV export', csvCheck.ok, JSON.stringify(csvCheck)]);

    await cdp.eval(`document.querySelector('[data-action="backup"]').click()`);
    await sleep(900);
    files = await readdir(DOWNLOAD_DIR);
    const jsonName = files.find(f => f.endsWith('.json'));
    let jsonCheck = { ok: false };
    if (jsonName) {
      const data = JSON.parse(await readFile(path.join(DOWNLOAD_DIR, jsonName), 'utf8'));
      jsonCheck = {
        ok: data.app === '拾账' && data.data.entries.length === 207 && data.data.books.length === 2,
        count: data.data.entries.length,
        books: data.data.books.length
      };
    }
    results.push(['JSON backup', jsonCheck.ok, JSON.stringify(jsonCheck)]);

    // month navigation
    await cdp.eval(`location.hash = '#home'`);
    await sleep(300);
    const nowTitle = await cdp.eval(`document.getElementById('monthTitle').textContent`);
    await cdp.eval(`document.querySelector('#view-home [data-action="month-prev"]').click()`);
    await sleep(300);
    const prevTitle = await cdp.eval(`document.getElementById('monthTitle').textContent`);
    results.push(['month navigation', prevTitle !== nowTitle, `${nowTitle} -> ${prevTitle}`]);
    await cdp.eval(`document.querySelector('#view-home [data-action="month-today"]').click()`);
    await sleep(200);

    // theme persistence
    await cdp.eval(`document.querySelector('[data-theme-option="dark"]').click()`);
    await sleep(250);
    const darkAttr = await cdp.eval(`document.documentElement.dataset.theme`);
    results.push(['theme switch', darkAttr === 'dark', darkAttr]);

    // no duplicate ids / unlabeled buttons
    const domAudit = await cdp.eval(`(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      const unlabeled = Array.from(document.querySelectorAll('button')).filter(btn => !(btn.textContent.trim() || btn.getAttribute('aria-label'))).length;
      return { dup, unlabeled };
    })()`);
    results.push(['no duplicate ids', domAudit.dup.length === 0, domAudit.dup.join(',') || 'ok']);
    results.push(['all buttons labeled', domAudit.unlabeled === 0, domAudit.unlabeled]);

    // clearing the demo leaves user budget intact and empties the book
    await cdp.eval(`location.hash = '#home'`);
    await sleep(300);
    await cdp.eval(`document.querySelector('[data-action="clear-demo"]').click()`);
    await sleep(400);
    const cleared = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return { n: s.entries.length, books: s.books.length, demo: !!(b && b.demo), budget: b ? b.budget : null };
    })()`);
    results.push(['clear demo', cleared.n === 0 && cleared.demo === false, JSON.stringify(cleared)]);
    results.push(['user budget kept', cleared.budget === 2500, cleared.budget]);

    // 320px 窄屏检查
    await sleep(2400);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 320, height: 640, deviceScaleFactor: 2, mobile: true
    });
    await cdp.eval(`location.hash = '#home'`);
    await sleep(450);
    await shot(cdp, 'home-mobile-320.png');
    const overflow = await cdp.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
    results.push(['no overflow at 320px', overflow === true, overflow]);

    await cdp.eval(`document.querySelector('.nav-add').click()`);
    await sleep(450);
    await shot(cdp, 'composer-mobile-320.png');
    await cdp.eval(`document.querySelector('[data-action="close-composer"]').click()`);
    await sleep(200);

    // ---------------- 多账本 / 自定义分类 ----------------
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
    });
    await cdp.eval(`location.hash = '#settings'`);
    await sleep(400);
    await cdp.eval(`document.querySelector('[data-theme-option="light"]').click()`);
    await sleep(250);

    await cdp.eval(`document.querySelector('[data-action="book-new"]').click()`);
    await sleep(300);
    const promptShown = await cdp.eval(`document.getElementById('confirm').classList.contains('open') && !document.getElementById('confirmInput').hidden`);
    results.push(['新建账本弹窗', promptShown === true, promptShown]);

    await cdp.eval(`(() => { const input = document.getElementById('confirmInput'); input.value = '旅行账本'; document.querySelector('[data-action="confirm-ok"]').click(); })()`);
    await sleep(500);

    const bookState = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      const daily = s.books.find(x => !x.demo);
      return {
        books: s.books.length,
        active: b.name,
        activeEntries: s.entries.filter(e => e.bookId === b.id).length,
        dailyId: daily && daily.id,
        travelId: b.id,
        options: document.getElementById('bookSelect').options.length
      };
    })()`);
    results.push(['创建账本', bookState.books === 2 && bookState.active === '旅行账本', JSON.stringify(bookState)]);
    results.push(['新账本为空', bookState.activeEntries === 0, bookState.activeEntries]);
    results.push(['账本选择器选项', bookState.options === 4, bookState.options]);
    await sleep(2400);
    await shot(cdp, 'books-desktop.png');

    await cdp.eval(`location.hash = '#home'`);
    await sleep(300);
    await cdp.eval(`document.querySelector('.nav-add').click()`);
    await sleep(350);
    for (const key of ['8', '8']) {
      await cdp.eval(`document.querySelector('[data-key="${key}"]').click()`);
      await sleep(40);
    }
    await cdp.eval(`document.querySelector('[data-action="save-entry"]').click()`);
    await sleep(500);

    const travelAfter = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return {
        total: s.entries.length,
        activeEntries: s.entries.filter(e => e.bookId === b.id).length,
        heroCount: document.getElementById('heroCount').textContent,
        dailyEntries: s.entries.filter(e => e.bookId !== b.id).length
      };
    })()`);
    results.push(['新账本独立记账', travelAfter.total === 1 && travelAfter.activeEntries === 1 && travelAfter.heroCount === '1', JSON.stringify(travelAfter)]);
    results.push(['其他账本不受影响', travelAfter.dailyEntries === 0, travelAfter.dailyEntries]);

    await cdp.eval(`(() => { const sel = document.getElementById('bookSelect'); sel.value = ${JSON.stringify(bookState.dailyId)}; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(500);
    const switched = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return { active: b.name, heroCount: document.getElementById('heroCount').textContent, total: s.entries.length };
    })()`);
    results.push(['切换账本', switched.active === '日常账本' && switched.heroCount === '0' && switched.total === 1, JSON.stringify(switched)]);

    await cdp.eval(`(() => { const sel = document.getElementById('bookSelect'); sel.value = ${JSON.stringify(bookState.travelId)}; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(2400);

    // 自定义分类
    await cdp.eval(`location.hash = '#settings'`);
    await sleep(350);
    await cdp.eval(`document.querySelector('[data-action="cat-add"]').click()`);
    await sleep(300);
    const catOpen = await cdp.eval(`document.getElementById('catEditor').classList.contains('open') && !document.getElementById('catName').hidden`);
    results.push(['分类编辑弹窗', catOpen === true, catOpen]);

    await cdp.eval(`(() => { const el = document.getElementById('catName'); el.value = '宠物'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await cdp.eval(`document.querySelector('[data-cat-icon="🐱"]').click()`);
    await sleep(120);
    await cdp.eval(`document.querySelector('[data-cat-color="#4a86c5"]').click()`);
    await sleep(120);
    await shot(cdp, 'category-editor-desktop.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await sleep(350);
    await shot(cdp, 'category-editor-mobile.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
    });
    await sleep(350);
    await cdp.eval(`document.querySelector('[data-action="save-cat"]').click()`);
    await sleep(500);

    const catState = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const c = s.categories[0];
      return { count: s.categories.length, name: c && c.name, icon: c && c.icon, color: c && c.color, type: c && c.type, id: c && c.id };
    })()`);
    results.push(['添加自定义分类', catState.count === 1 && catState.name === '宠物' && catState.icon === '🐱' && catState.color === '#4a86c5', JSON.stringify(catState)]);
    await sleep(2400);
    await shot(cdp, 'category-settings-desktop.png');

    await cdp.eval(`location.hash = '#home'`);
    await sleep(300);
    await cdp.eval(`document.querySelector('.nav-add').click()`);
    await sleep(350);
    const gridHasCat = await cdp.eval(`Array.from(document.querySelectorAll('#catGrid .cat')).some(el => el.textContent.includes('宠物'))`);
    results.push(['分类出现在记账面板', gridHasCat === true, gridHasCat]);
    await cdp.eval(`document.querySelector('[data-cat="${catState.id}"]').click()`);
    await sleep(150);
    for (const key of ['1', '2']) {
      await cdp.eval(`document.querySelector('[data-key="${key}"]').click()`);
      await sleep(40);
    }
    await cdp.eval(`document.querySelector('[data-action="save-entry"]').click()`);
    await sleep(500);

    const customEntry = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      const list = s.entries.filter(e => e.bookId === b.id);
      return { total: s.entries.length, activeEntries: list.length, lastCat: list[list.length - 1].categoryId };
    })()`);
    results.push(['用自定义分类记账', customEntry.activeEntries === 2 && customEntry.lastCat === catState.id, JSON.stringify(customEntry)]);

    await cdp.eval(`location.hash = '#settings'`);
    await sleep(350);
    await cdp.eval(`document.querySelector('[data-action="cat-delete"][data-id="${catState.id}"]').click()`);
    await sleep(350);
    const catDeleteMsg = await cdp.eval(`document.getElementById('confirmMsg').textContent`);
    results.push(['删除分类说明', catDeleteMsg.includes('归入'), catDeleteMsg]);
    await cdp.eval(`document.querySelector('[data-action="confirm-ok"]').click()`);
    await sleep(450);

    const afterCatDelete = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      return {
        categories: s.categories.length,
        stillUsed: s.entries.filter(e => e.categoryId === ${JSON.stringify(catState.id)}).length,
        other: s.entries.filter(e => e.categoryId === 'other').length,
        total: s.entries.length
      };
    })()`);
    results.push(['删除分类并归入其他', afterCatDelete.categories === 0 && afterCatDelete.stillUsed === 0 && afterCatDelete.other === 1 && afterCatDelete.total === 2, JSON.stringify(afterCatDelete)]);

    // 删除账本
    await cdp.eval(`document.querySelector('[data-action="book-delete"][data-id="${bookState.travelId}"]').click()`);
    await sleep(350);
    await cdp.eval(`document.querySelector('[data-action="confirm-ok"]').click()`);
    await sleep(500);
    const afterBookDelete = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return { books: s.books.length, active: b.name, total: s.entries.length, categories: s.categories.length };
    })()`);
    results.push(['删除账本', afterBookDelete.books === 1 && afterBookDelete.active === '日常账本' && afterBookDelete.total === 0, JSON.stringify(afterBookDelete)]);

    // ---------------- 恢复备份 ----------------
    const v2backup = {
      app: '拾账',
      version: 2,
      exportedAt: new Date().toISOString(),
      data: {
        books: [
          { id: 'bA', name: '恢复A', budget: 1000, createdAt: 1 },
          { id: 'bB', name: '恢复B', budget: 0, createdAt: 2 }
        ],
        activeBookId: 'bB',
        categories: [
          { id: 'cat_x', type: 'expense', name: '测试类', icon: '🐱', color: '#4a86c5', custom: true }
        ],
        entries: [
          { id: 'e1', type: 'expense', amount: 9, categoryId: 'cat_x', date: '2026-10-05', account: '微信', note: '恢复', createdAt: 1, bookId: 'bB' }
        ],
        theme: 'light',
        defaultAccount: '微信'
      }
    };

    await cdp.eval(`(() => {
      const payload = ${JSON.stringify(JSON.stringify(v2backup))};
      const input = document.getElementById('restoreFile');
      const dt = new DataTransfer();
      dt.items.add(new File([payload], 'backup.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    const restoreMsg = await cdp.eval(`document.getElementById('confirmMsg').textContent`);
    results.push(['恢复备份弹窗', restoreMsg.includes('2 个账本'), restoreMsg]);
    await cdp.eval(`document.querySelector('[data-action="confirm-ok"]').click()`);
    await sleep(600);

    const restored = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId);
      return {
        books: s.books.length,
        active: b && b.name,
        categories: s.categories.length,
        entries: s.entries.length,
        catId: s.entries[0] && s.entries[0].categoryId,
        bookId: s.entries[0] && s.entries[0].bookId,
        budgetA: s.books[0] && s.books[0].budget
      };
    })()`);
    results.push(['恢复 v2 备份', restored.books === 2 && restored.active === '恢复B' && restored.categories === 1 && restored.entries === 1 && restored.catId === 'cat_x' && restored.bookId === 'bB' && restored.budgetA === 1000, JSON.stringify(restored)]);

    const v1backup = {
      app: '拾账',
      version: 1,
      data: {
        entries: [
          { id: 'oldbackup', type: 'expense', amount: 18, categoryId: 'food', date: '2026-10-06', account: '支付宝', note: '旧备份', createdAt: 1 }
        ],
        budget: 800,
        theme: 'light',
        defaultAccount: '微信'
      }
    };

    await cdp.eval(`(() => {
      const payload = ${JSON.stringify(JSON.stringify(v1backup))};
      const input = document.getElementById('restoreFile');
      const dt = new DataTransfer();
      dt.items.add(new File([payload], 'backup-old.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    await cdp.eval(`document.querySelector('[data-action="confirm-ok"]').click()`);
    await sleep(600);

    const restoredV1 = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      return { books: s.books.length, name: b.name, budget: b.budget, entries: s.entries.length, categories: s.categories.length };
    })()`);
    results.push(['恢复 v1 旧备份', restoredV1.books === 1 && restoredV1.name === '日常账本' && restoredV1.budget === 800 && restoredV1.entries === 1 && restoredV1.categories === 0, JSON.stringify(restoredV1)]);

    // ---------------- v1 数据迁移 ----------------
    const v1 = {
      v: 1,
      entries: [
        { id: 'old1', type: 'expense', amount: 12.5, categoryId: 'food', date: '2026-10-01', account: '微信', note: '旧记录', createdAt: 1 },
        { id: 'old2', type: 'income', amount: 100, categoryId: 'salary', date: '2026-10-02', account: '银行卡', note: '', createdAt: 2 }
      ],
      budget: 3000,
      theme: 'light',
      defaultAccount: '支付宝',
      demo: false
    };
    await cdp.eval(`localStorage.setItem('shizhang.v1', ${JSON.stringify(JSON.stringify(v1))})`);
    await cdp.send('Page.reload');
    await waitReady(cdp);
    await sleep(700);

    const migrated = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      const ids = new Set(s.books.map(x => x.id));
      return {
        v: s.v,
        books: s.books.length,
        name: b.name,
        budget: b.budget,
        entries: s.entries.length,
        allBooked: s.entries.every(e => ids.has(e.bookId)),
        categories: s.categories.length,
        account: s.defaultAccount
      };
    })()`);
    results.push(['v1 数据迁移', migrated.v === 2 && migrated.books === 1 && migrated.name === '日常账本' && migrated.budget === 3000 && migrated.entries === 2 && migrated.allBooked && migrated.categories === 0, JSON.stringify(migrated)]);

    const v1demo = {
      v: 1,
      entries: [
        { id: 'd1', type: 'expense', amount: 20, categoryId: 'food', date: '2026-10-02', account: '微信', note: '示例', createdAt: 1, demo: true },
        { id: 'd2', type: 'income', amount: 500, categoryId: 'bonus', date: '2026-10-03', account: '银行卡', note: '示例', createdAt: 2, demo: true }
      ],
      budget: 6000,
      prevBudget: 1200,
      demo: true,
      theme: 'light',
      defaultAccount: '微信'
    };
    await cdp.eval(`localStorage.setItem('shizhang.v1', ${JSON.stringify(JSON.stringify(v1demo))})`);
    await cdp.send('Page.reload');
    await waitReady(cdp);
    await sleep(700);

    const demoMigrated = await cdp.eval(`(() => {
      const s = JSON.parse(localStorage.getItem('shizhang.v1'));
      const b = s.books.find(x => x.id === s.activeBookId) || s.books[0];
      const daily = s.books.find(x => !x.demo);
      const demo = s.books.find(x => x.demo);
      return {
        books: s.books.length,
        active: b.name,
        dailyBudget: daily && daily.budget,
        demoBudget: demo && demo.budget,
        entries: s.entries.length,
        demoEntries: s.entries.filter(e => e.bookId === (demo && demo.id)).length
      };
    })()`);
    results.push(['v1 示例账本迁移', demoMigrated.books === 2 && demoMigrated.active === '示例账本' && demoMigrated.dailyBudget === 1200 && demoMigrated.demoBudget === 6000 && demoMigrated.demoEntries === 2, JSON.stringify(demoMigrated)]);

    console.log('');
    let failed = 0;
    for (const [name, ok, detail] of results) {
      console.log(`${ok ? '✅' : '❌'} ${name} :: ${detail}`);
      if (!ok) failed++;
    }

    const demoData = await cdp.eval(`(() => { const s = JSON.parse(localStorage.getItem('shizhang.v1')); const ds = s.entries.filter(e => e.demo); return { total: s.entries.length, demo: ds.length, sample: ds.slice(0, 3) }; })()`);
    console.log('demo sample:', JSON.stringify(demoData.sample, null, 1));

    console.log('\n--- console issues ---');
    console.log(issues.length ? issues.join('\n') : 'none');

    console.log(`\nRESULT: ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch(err => {
  console.error('FATAL', err);
  process.exitCode = 1;
});
