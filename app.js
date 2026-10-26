'use strict';

/* =========================================================
   拾账 · 应用逻辑
   纯原生 JS，无外部依赖；数据保存在浏览器 localStorage。
   ========================================================= */

const CATEGORIES = [
  { id: 'food', name: '餐饮', icon: '🍜', color: '#e8734a', type: 'expense' },
  { id: 'transport', name: '交通', icon: '🚇', color: '#4a86c5', type: 'expense' },
  { id: 'shopping', name: '购物', icon: '🛍️', color: '#d95f8a', type: 'expense' },
  { id: 'housing', name: '居住', icon: '🏠', color: '#8a6cc9', type: 'expense' },
  { id: 'fun', name: '娱乐', icon: '🎮', color: '#e0a63c', type: 'expense' },
  { id: 'medical', name: '医疗', icon: '💊', color: '#4fa89b', type: 'expense' },
  { id: 'study', name: '学习', icon: '📚', color: '#6b8f3f', type: 'expense' },
  { id: 'social', name: '人情', icon: '🎁', color: '#c96f5a', type: 'expense' },
  { id: 'phone', name: '通讯', icon: '📱', color: '#5a7d9a', type: 'expense' },
  { id: 'other', name: '其他', icon: '✨', color: '#9b8f80', type: 'expense' },
  { id: 'salary', name: '工资', icon: '💼', color: '#2f8f6b', type: 'income' },
  { id: 'bonus', name: '奖金', icon: '🏆', color: '#3d9e8c', type: 'income' },
  { id: 'invest', name: '理财', icon: '📈', color: '#4a86c5', type: 'income' },
  { id: 'side', name: '兼职', icon: '🧑‍💻', color: '#8a6cc9', type: 'income' },
  { id: 'redpacket', name: '红包', icon: '🧧', color: '#d95f5f', type: 'income' },
  { id: 'other_in', name: '其他', icon: '💰', color: '#9b8f80', type: 'income' }
];

const CATEGORY_ICONS = [
  '🍜', '🍱', '☕', '🍰', '🍺', '🛒', '🛍️', '👕',
  '🚇', '🚗', '⛽️', '🚕', '🏠', '💡', '📱', '💊',
  '🏥', '📚', '🎮', '🎬', '🎵', '✈️', '🏨', '🎁',
  '🧧', '💼', '💰', '📈', '🎓', '🐱', '👶', '✂️',
  '💄', '🔧', '🎫', '🌿', '💳', '🏋️', '🧾', '🏷️'
];

const CATEGORY_COLORS = [
  '#e8734a', '#d95f8a', '#4a86c5', '#8a6cc9', '#e0a63c', '#4fa89b',
  '#6b8f3f', '#c96f5a', '#5a7d9a', '#9b8f80', '#c45a5a', '#3d9e8c'
];

const ACCOUNTS = ['微信', '支付宝', '银行卡', '现金', '信用卡'];
const STORAGE_KEY = 'shizhang.v1';
const DATA_VERSION = 2;
const DEFAULT_BOOK_NAME = '日常账本';
const DEMO_BOOK_NAME = '示例账本';
const BOOK_NAME_MAX = 12;
const CAT_NAME_MAX = 8;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const VIEWS = ['home', 'records', 'stats', 'settings'];

const CAT_MAP = new Map(CATEGORIES.map(c => [c.id, c]));
const numberFmt = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let state;
let selectedMonth = '';
let currentView = 'home';
let storageBroken = false;
let draft = null;
let lastFocus = null;
let confirmAction = null;
let confirmMode = 'confirm';
let confirmLastFocus = null;
let toastTimer = 0;
let deferredInstallPrompt = null;
let swRegistration = null;
let activeCatTab = 'expense';
let catDraft = null;
let catLastFocus = null;
let pendingMigrationSave = false;

const filters = { q: '', type: 'all', cat: 'all', month: 'all' };

/* ---------------- 小工具 ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const pad2 = n => String(n).padStart(2, '0');

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function parseDate(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function monthKeyOf(dateStr) { return String(dateStr).slice(0, 7); }
function currentMonthKey() { return monthKeyOf(todayStr()); }

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthTitle(key) {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
}

function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function activeDays(key) {
  if (key === currentMonthKey()) return new Date().getDate();
  if (key > currentMonthKey()) return 0;
  return daysInMonth(key);
}

function dateLabel(str) {
  const today = todayStr();
  if (str === today) return '今天';
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (str === toDateStr(yest)) return '昨天';
  const d = parseDate(str);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function sum(list) { return list.reduce((s, e) => s + e.amount, 0); }

function uid(prefix = 'e') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function tint(hex, alpha) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function fmtMoney(n) {
  const value = Number(n) || 0;
  const minus = value < 0 ? '−' : '';
  return minus + '¥' + numberFmt.format(Math.abs(value));
}

function fmtCompact(n) {
  if (n >= 10000) return '¥' + (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return '¥' + Math.round(n).toLocaleString('zh-CN');
}

function pctText(part, total) {
  if (!total) return '0%';
  const p = (part / total) * 100;
  return p < 1 ? '<1%' : Math.round(p) + '%';
}

function allCategories() {
  if (!state || !Array.isArray(state.categories)) return CATEGORIES.slice();
  return CATEGORIES.concat(state.categories);
}

function categoriesOfType(type) {
  return allCategories().filter(c => c.type === type);
}

function getCategory(id) {
  return CAT_MAP.get(id) ||
    (state && Array.isArray(state.categories) ? state.categories.find(c => c.id === id) : null) ||
    null;
}

function firstCat(type) {
  return categoriesOfType(type)[0] || CATEGORIES[0];
}

function fallbackCat(type) {
  return getCategory(type === 'income' ? 'other_in' : 'other');
}

function catOf(entry) {
  const c = getCategory(entry.categoryId);
  return c && c.type === entry.type ? c : fallbackCat(entry.type);
}

function activeBook() {
  if (!state || !Array.isArray(state.books) || !state.books.length) return null;
  return state.books.find(b => b.id === state.activeBookId) || state.books[0];
}

function isDemoBook() {
  const book = activeBook();
  return !!(book && book.demo);
}

function bookEntries(bookId) {
  if (!state) return [];
  const id = bookId || state.activeBookId;
  return state.entries.filter(e => e.bookId === id);
}

function entriesOfMonth(key) {
  return bookEntries().filter(e => e.date.startsWith(key));
}

function byDateDesc(a, b) {
  return b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------------- 数据存取 ---------------- */

function freshState() {
  const book = {
    id: uid('b_'),
    name: DEFAULT_BOOK_NAME,
    budget: 0,
    createdAt: Date.now()
  };
  return {
    v: DATA_VERSION,
    entries: [],
    books: [book],
    activeBookId: book.id,
    categories: [],
    theme: 'auto',
    defaultAccount: '微信'
  };
}

function isValidDateStr(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function normalizeCategory(c) {
  if (!c || typeof c !== 'object') return null;
  const type = c.type === 'income' ? 'income' : 'expense';
  const name = typeof c.name === 'string' ? c.name.trim().slice(0, CAT_NAME_MAX) : '';
  if (!name) return null;

  const icon = CATEGORY_ICONS.includes(c.icon) ? c.icon : '🏷️';
  const color = CATEGORY_COLORS.includes(c.color) ? c.color : CATEGORY_COLORS[0];
  const id = typeof c.id === 'string' && /^cat_[A-Za-z0-9_-]+$/.test(c.id)
    ? c.id
    : uid('cat_');

  return { id, type, name, icon, color, custom: true };
}

function normalizeBook(b) {
  if (!b || typeof b !== 'object') return null;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, BOOK_NAME_MAX) : '';
  if (!name) return null;

  const id = typeof b.id === 'string' && /^[A-Za-z0-9_-]+$/.test(b.id) && !b.id.startsWith('__')
    ? b.id
    : uid('b_');
  const budget = Number(b.budget);
  const book = {
    id,
    name,
    budget: Number.isFinite(budget) && budget > 0 ? round2(budget) : 0,
    createdAt: Number.isFinite(b.createdAt) ? b.createdAt : Date.now(),
    demo: !!b.demo
  };

  if (book.demo && typeof b.returnTo === 'string') book.returnTo = b.returnTo;
  return book;
}

function normalizeEntry(e, cats, fallbackBookId = '') {
  if (!e || typeof e !== 'object') return null;
  const amount = round2(e.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const type = e.type === 'income' ? 'income' : 'expense';
  const date = isValidDateStr(e.date) ? e.date : todayStr();

  const list = Array.isArray(cats) ? cats : allCategories();
  const cat = list.find(c => c.id === e.categoryId) || null;
  const categoryId = cat && cat.type === type
    ? cat.id
    : (type === 'income' ? 'other_in' : 'other');

  return {
    id: typeof e.id === 'string' && e.id ? e.id : uid(),
    type,
    amount,
    categoryId,
    date,
    account: ACCOUNTS.includes(e.account) ? e.account : ACCOUNTS[0],
    note: typeof e.note === 'string' ? e.note.slice(0, 60) : '',
    createdAt: Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
    bookId: typeof e.bookId === 'string' && e.bookId ? e.bookId : fallbackBookId
  };
}

function detectStorage() {
  try {
    const k = '__shizhang_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter(item => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function migrateState(parsed) {
  const theme = ['auto', 'light', 'dark'].includes(parsed.theme) ? parsed.theme : 'auto';
  const defaultAccount = ACCOUNTS.includes(parsed.defaultAccount) ? parsed.defaultAccount : '微信';
  const hasV2Books = Array.isArray(parsed.books) && parsed.books.length > 0;

  if (hasV2Books) {
    const books = dedupeById(parsed.books.map(normalizeBook).filter(Boolean));
    if (!books.length) return freshState();

    const activeBookId = books.some(b => b.id === parsed.activeBookId)
      ? parsed.activeBookId
      : books[0].id;

    const categories = dedupeById(
      (Array.isArray(parsed.categories) ? parsed.categories : [])
        .map(normalizeCategory)
        .filter(c => c && !CAT_MAP.has(c.id))
    );

    const allCats = CATEGORIES.concat(categories);
    const entries = (Array.isArray(parsed.entries) ? parsed.entries : [])
      .map(e => normalizeEntry(e, allCats, activeBookId))
      .filter(Boolean);

    const bookIds = new Set(books.map(b => b.id));
    entries.forEach(e => {
      if (!bookIds.has(e.bookId)) e.bookId = activeBookId;
    });

    pendingMigrationSave = parsed.v !== DATA_VERSION;
    return {
      v: DATA_VERSION,
      entries,
      books,
      activeBookId,
      categories,
      theme,
      defaultAccount
    };
  }

  // ---- 从 v1（单账本、无自定义分类）迁移 ----
  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const hasDemo = !!parsed.demo && rawEntries.length > 0;

  const daily = {
    id: uid('b_'),
    name: DEFAULT_BOOK_NAME,
    budget: 0,
    createdAt: Date.now() - 1000
  };
  const books = [daily];
  let demoBook = null;

  if (hasDemo) {
    demoBook = {
      id: uid('b_'),
      name: DEMO_BOOK_NAME,
      budget: 6000,
      createdAt: Date.now(),
      demo: true,
      returnTo: daily.id
    };
    books.push(demoBook);

    const prev = Number(parsed.prevBudget);
    daily.budget = Number.isFinite(prev) && prev > 0 ? round2(prev) : 0;

    const demoBudget = Number(parsed.budget);
    demoBook.budget = Number.isFinite(demoBudget) && demoBudget > 0 ? round2(demoBudget) : 6000;
  } else if (parsed.demo) {
    const prev = Number(parsed.prevBudget);
    daily.budget = Number.isFinite(prev) && prev > 0 ? round2(prev) : 0;
  } else {
    const budget = Number(parsed.budget);
    daily.budget = Number.isFinite(budget) && budget > 0 ? round2(budget) : 0;
  }

  const activeBookId = demoBook ? demoBook.id : daily.id;
  const entries = rawEntries.map(raw => {
    const bookId = demoBook && raw && raw.demo ? demoBook.id : daily.id;
    const entry = normalizeEntry(raw, CATEGORIES, bookId);
    if (entry) entry.bookId = bookId;
    return entry;
  }).filter(Boolean);

  pendingMigrationSave = true;
  return {
    v: DATA_VERSION,
    entries,
    books,
    activeBookId,
    categories: [],
    theme,
    defaultAccount
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return freshState();
    return migrateState(parsed);
  } catch (e) {
    return freshState();
  }
}

function saveState() {
  if (storageBroken) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    storageBroken = true;
    toast('无法写入本地存储，记录可能无法保存', 4200);
  }
}

/* ---------------- 主题 ---------------- */

const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');

function resolveTheme() {
  if (state.theme === 'light' || state.theme === 'dark') return state.theme;
  return darkMedia.matches ? 'dark' : 'light';
}

function applyTheme() {
  const theme = resolveTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#111513' : '#f4f1e9');
}

darkMedia.addEventListener('change', () => {
  if (state && state.theme === 'auto') applyTheme();
});

/* ---------------- 视图切换 ---------------- */

function syncTopbar() {
  const bar = $('.topbar');
  if (bar) bar.classList.toggle('scrolled', window.scrollY > 6);
}

function setView(name, opts = {}) {
  if (!VIEWS.includes(name)) name = 'home';
  if (name === currentView && !opts.force) {
    if (!opts.silent && location.hash !== '#' + name) location.hash = name;
    return;
  }
  currentView = name;

  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });

  $$('.tab').forEach(btn => {
    const on = btn.dataset.view === name;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  $$('.bottomnav button').forEach(btn => {
    const on = btn.dataset.view === name;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  if (!opts.silent && location.hash !== '#' + name) location.hash = name;
  window.scrollTo(0, 0);
  requestAnimationFrame(syncTopbar);
}

/* ---------------- 提示 / 确认 ---------------- */

function toast(message, ms = 2300) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function confirmDialog({ title, message, confirmText = '确定', danger = false, onConfirm }) {
  const modal = $('#confirm');
  if (!modal) return;

  confirmMode = 'confirm';
  confirmLastFocus = document.activeElement;
  $('#confirmTitle').textContent = title;

  const msg = $('#confirmMsg');
  msg.textContent = message;
  msg.hidden = !message;

  const input = $('#confirmInput');
  if (input) {
    input.hidden = true;
    input.value = '';
  }

  const ok = $('#confirmOk');
  ok.textContent = confirmText;
  ok.classList.toggle('btn-danger', danger);
  ok.classList.toggle('btn-primary', !danger);

  confirmAction = onConfirm;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => { const d = $('.dialog', modal); if (d) d.focus({ preventScroll: true }); }, 40);
}

function promptDialog({
  title,
  message = '',
  placeholder = '',
  value = '',
  maxlength = 12,
  confirmText = '保存',
  onConfirm
}) {
  const modal = $('#confirm');
  if (!modal) return;

  confirmMode = 'prompt';
  confirmLastFocus = document.activeElement;
  $('#confirmTitle').textContent = title;

  const msg = $('#confirmMsg');
  msg.textContent = message;
  msg.hidden = !message;

  const input = $('#confirmInput');
  if (input) {
    input.hidden = false;
    input.placeholder = placeholder;
    input.maxLength = maxlength;
    input.value = value;
    input.setAttribute('aria-label', placeholder || '名称');
  }

  const ok = $('#confirmOk');
  ok.textContent = confirmText;
  ok.classList.remove('btn-danger');
  ok.classList.add('btn-primary');

  confirmAction = onConfirm;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  setTimeout(() => {
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, 60);
}

function closeConfirm() {
  const modal = $('#confirm');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  confirmAction = null;
  confirmMode = 'confirm';

  const input = $('#confirmInput');
  if (input) {
    input.hidden = true;
    input.value = '';
  }

  if (confirmLastFocus && document.body.contains(confirmLastFocus)) {
    try { confirmLastFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ }
  }
  confirmLastFocus = null;
}

function runConfirm() {
  if (confirmMode === 'prompt') {
    const input = $('#confirmInput');
    const value = input ? input.value.trim() : '';
    if (!value) {
      toast('请输入名称');
      if (input) input.focus();
      return;
    }
    const fn = confirmAction;
    closeConfirm();
    if (typeof fn === 'function') fn(value);
    return;
  }

  const fn = confirmAction;
  closeConfirm();
  if (typeof fn === 'function') fn();
}

/* ---------------- 总览 ---------------- */

function renderHome() {
  const list = entriesOfMonth(selectedMonth);
  const expenseList = list.filter(e => e.type === 'expense');
  const incomeList = list.filter(e => e.type === 'income');
  const expense = sum(expenseList);
  const income = sum(incomeList);
  const balance = income - expense;

  $('#monthTitle').textContent = monthTitle(selectedMonth);
  $('#heroBadge').textContent = `${Number(selectedMonth.slice(5))} 月`;

  const tag = $('#monthTag');
  if (selectedMonth === currentMonthKey()) tag.textContent = '本月';
  else if (selectedMonth === shiftMonth(currentMonthKey(), -1)) tag.textContent = '上月';
  else tag.textContent = '';

  $('#heroBalance').textContent = fmtMoney(balance);
  $('#heroExpense').textContent = fmtMoney(expense);
  $('#heroIncome').textContent = fmtMoney(income);
  $('#heroCount').textContent = String(list.length);

  renderBudget(expense);
  renderRecent(list);
  renderBreakdown(expenseList, expense);
  syncMonthControls();
}

function renderBudget(expense) {
  const el = $('#heroBudget');
  if (!el) return;

  const book = activeBook();
  const budget = book ? book.budget : 0;

  if (!budget) {
    el.innerHTML = `<button class="budget-empty" data-action="nav" data-view="settings">还没有月度预算，去设置一个 ›</button>`;
    return;
  }

  const pct = (expense / budget) * 100;
  const over = expense > budget;
  const remain = budget - expense;

  el.innerHTML = `
    <div class="budget-line">
      <span>月预算 ${fmtMoney(budget)}</span>
      <b class="${over ? 'over' : ''}">${over ? '超支 ' + fmtMoney(-remain) : '剩余 ' + fmtMoney(remain)}</b>
    </div>
    <div class="budget-bar ${over ? 'over' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(pct))}" aria-label="预算使用进度">
      <i style="width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%"></i>
    </div>`;
}

function renderRecent(list) {
  const box = $('#recentList');
  if (!box) return;

  const recent = list.slice().sort(byDateDesc).slice(0, 5);

  if (!recent.length) {
    if (!bookEntries().length) {
      box.innerHTML = `
        <div class="empty-state">
          <div class="empty-emoji">🪴</div>
          <h3>从今天开始，看清每一笔</h3>
          <p>记下第一笔，月底就不会糊里糊涂。</p>
          <div class="btn-row">
            <button class="btn btn-primary" data-action="add" data-type="expense">记第一笔</button>
            <button class="btn" data-action="load-demo">看看示例</button>
          </div>
        </div>`;
    } else {
      box.innerHTML = `<div class="empty-inline">这个月还没有记录，换个时间看看？</div>`;
    }
    return;
  }

  box.innerHTML = recent.map(e => entryRow(e, true)).join('');
}

function renderBreakdown(expenseList, expense) {
  const box = $('#breakdownList');
  const sub = $('#breakdownSub');
  if (!box) return;

  if (!expenseList.length) {
    box.innerHTML = `
      <div class="empty-inline">
        本月还没有支出记录
        <br>
        <button class="link" data-action="add" data-type="expense">记一笔，看看钱花在哪儿 ›</button>
      </div>`;
    sub.textContent = '';
    return;
  }

  const map = new Map();
  expenseList.forEach(e => {
    const key = e.categoryId;
    const cur = map.get(key) || { amount: 0, count: 0, cat: catOf(e) };
    cur.amount += e.amount;
    cur.count += 1;
    map.set(key, cur);
  });

  const rows = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  const top = rows.slice(0, 4);
  const days = Math.max(1, activeDays(selectedMonth));

  sub.textContent = `日均 ${fmtMoney(expense / days)}`;

  let html = top.map(row => `
    <div class="bd-row">
      <span class="bd-dot" style="background:${row.cat.color}"></span>
      <span class="bd-name">${row.cat.icon} ${row.cat.name}</span>
      <span class="bd-track"><i style="width:${(row.amount / expense * 100).toFixed(1)}%;background:${row.cat.color}"></i></span>
      <span class="bd-amt">${fmtCompact(row.amount)}</span>
    </div>`).join('');

  if (rows.length > 4) {
    html += `
      <div class="breakdown-foot">
        <span>还有 ${rows.length - 4} 个分类</span>
        <button class="link" data-action="nav" data-view="stats">看完整统计 ›</button>
      </div>`;
  } else {
    html += `
      <div class="breakdown-foot">
        <span>共 ${expenseList.length} 笔支出</span>
        <button class="link" data-action="nav" data-view="stats">看完整统计 ›</button>
      </div>`;
  }

  box.innerHTML = html;
}

function entryRow(e, showDate = false) {
  const cat = catOf(e);
  const name = e.note ? e.note : cat.name;
  const meta = [];
  if (e.note) meta.push(cat.name);
  meta.push(e.account);
  if (showDate) meta.push(dateLabel(e.date));

  const sign = e.type === 'expense' ? '−' : '+';

  return `
    <button class="entry" type="button" data-action="edit" data-id="${esc(e.id)}" aria-label="${esc(name)} ${sign}${esc(fmtMoney(e.amount))}">
      <span class="entry-icon" style="background:${tint(cat.color, 0.14)}" aria-hidden="true">${cat.icon}</span>
      <span class="entry-main">
        <span class="entry-name">${esc(name)}</span>
        <span class="entry-sub">${esc(meta.join(' · '))}</span>
      </span>
      <span class="entry-amt ${e.type}">${sign}${fmtMoney(e.amount)}</span>
    </button>`;
}

function syncMonthControls() {
  const isCurrent = selectedMonth >= currentMonthKey();
  $$('[data-action="month-next"]').forEach(btn => { btn.disabled = isCurrent; });

  const todayBtn = $('#monthTodayBtn');
  if (todayBtn) todayBtn.hidden = selectedMonth === currentMonthKey();
}

/* ---------------- 明细 ---------------- */

function renderRecords() {
  const monthSel = $('#monthFilter');
  const catSel = $('#catFilter');
  if (!monthSel || !catSel) return;

  const bookList = bookEntries();
  const months = Array.from(new Set(bookList.map(e => monthKeyOf(e.date)))).sort().reverse();
  if (filters.month !== 'all' && !months.includes(filters.month)) filters.month = 'all';

  const sig = months.join('|');
  if (monthSel.dataset.sig !== sig) {
    monthSel.innerHTML =
      `<option value="all">全部月份</option>` +
      months.map(m => `<option value="${m}">${monthTitle(m)}</option>`).join('');
    monthSel.dataset.sig = sig;
  }
  monthSel.value = filters.month;

  const cats = allCategories();
  const catSig = cats.map(c => c.id + c.name).join('|');
  if (catSel.dataset.sig !== catSig) {
    const group = type => cats
      .filter(c => c.type === type)
      .map(c => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join('');
    catSel.innerHTML =
      `<option value="all">全部分类</option>` +
      `<optgroup label="支出">${group('expense')}</optgroup>` +
      `<optgroup label="收入">${group('income')}</optgroup>`;
    catSel.dataset.sig = catSig;
  }
  if (filters.cat !== 'all' && !getCategory(filters.cat)) filters.cat = 'all';
  catSel.value = filters.cat;

  $$('#typeFilter [data-filter-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterType === filters.type);
  });

  const filtersCard = $('.filters');
  if (filtersCard) filtersCard.hidden = bookList.length === 0;

  const q = filters.q.trim().toLowerCase();

  let list = bookList.filter(e => {
    if (filters.type !== 'all' && e.type !== filters.type) return false;
    if (filters.cat !== 'all' && e.categoryId !== filters.cat) return false;
    if (filters.month !== 'all' && !e.date.startsWith(filters.month)) return false;
    if (q) {
      const cat = catOf(e);
      const hay = `${e.note} ${cat.name} ${e.account} ${e.amount} ${e.amount.toFixed(2)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort(byDateDesc);

  const expense = sum(list.filter(e => e.type === 'expense'));
  const income = sum(list.filter(e => e.type === 'income'));

  const sub = $('#recordsSub');
  if (!list.length) {
    sub.textContent = bookList.length ? '没有符合条件的记录' : '还没有记录';
  } else {
    sub.textContent = `共 ${list.length} 笔 · 支出 ${fmtMoney(expense)} · 收入 ${fmtMoney(income)}`;
  }

  const box = $('#recordsList');
  if (!list.length) {
    if (!bookList.length) {
      box.innerHTML = `
        <div class="empty-state">
          <div class="empty-emoji">📒</div>
          <h3>这个账本还是空的</h3>
          <p>花一分钟记下第一笔，让每一块钱都有迹可循。</p>
          <div class="btn-row">
            <button class="btn btn-primary" data-action="add" data-type="expense">记一笔</button>
            <button class="btn" data-action="load-demo">看看示例</button>
          </div>
        </div>`;
    } else {
      box.innerHTML = `
        <div class="empty-state">
          <div class="empty-emoji">🔍</div>
          <h3>没有找到记录</h3>
          <p>换个关键词，或者清除筛选条件试试。</p>
          <button class="btn" data-action="clear-filters">清除筛选</button>
        </div>`;
    }
    return;
  }

  const groups = new Map();
  list.forEach(e => {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  });

  let html = '';
  groups.forEach((items, date) => {
    const d = parseDate(date);
    const dayExp = sum(items.filter(e => e.type === 'expense'));
    const dayInc = sum(items.filter(e => e.type === 'income'));
    const isToday = date === todayStr();

    const sums = [
      dayExp ? `支出 ${fmtMoney(dayExp)}` : '',
      dayInc ? `收入 ${fmtMoney(dayInc)}` : ''
    ].filter(Boolean).join(' · ');

    html += `
      <section class="day-card" aria-label="${date}">
        <div class="day-head">
          <span class="day-date">
            ${isToday ? '<span class="today-pill">今天</span>' : ''}
            ${d.getMonth() + 1}月${d.getDate()}日
            <span class="weekday">${WEEKDAYS[d.getDay()]}</span>
          </span>
          <span class="day-sums">${sums}</span>
        </div>
        ${items.map(e => entryRow(e)).join('')}
      </section>`;
  });

  box.innerHTML = html;
}

function resetFilters() {
  filters.q = '';
  filters.type = 'all';
  filters.cat = 'all';
  filters.month = 'all';
  const search = $('#searchInput');
  if (search) search.value = '';
  renderRecords();
}

/* ---------------- 统计 ---------------- */

function renderStats() {
  const list = entriesOfMonth(selectedMonth);
  const expenseList = list.filter(e => e.type === 'expense');
  const incomeList = list.filter(e => e.type === 'income');
  const expense = sum(expenseList);
  const income = sum(incomeList);
  const days = activeDays(selectedMonth);
  const daily = days > 0 ? expense / days : 0;

  $('#statsMonthTitle').textContent = monthTitle(selectedMonth);
  $('#statsSub').textContent = `${monthTitle(selectedMonth)} · 共 ${list.length} 笔记录`;

  $('#statExpense').textContent = fmtMoney(expense);
  $('#statExpenseNote').textContent = `共 ${expenseList.length} 笔`;
  $('#statIncome').textContent = fmtMoney(income);
  $('#statIncomeNote').textContent = `共 ${incomeList.length} 笔`;
  $('#statDaily').textContent = fmtMoney(daily);
  $('#statDailyNote').textContent = days > 0
    ? `按 ${days} 天计算`
    : '这个月还没开始';

  renderDonut(expenseList, expense);
  renderTrend();
  renderRank(expenseList, expense);
}

function renderDonut(expenseList, total) {
  const box = $('#donut');
  const legend = $('#donutLegend');
  if (!box || !legend) return;

  $('#donutSub').textContent = total ? `共 ${expenseList.length} 笔` : '';

  const map = new Map();
  expenseList.forEach(e => {
    const cur = map.get(e.categoryId) || { amount: 0, count: 0, cat: catOf(e) };
    cur.amount += e.amount;
    cur.count += 1;
    map.set(e.categoryId, cur);
  });
  const rows = Array.from(map.values()).sort((a, b) => b.amount - a.amount);

  const r = 82;
  const c = 110;
  const circle = 2 * Math.PI * r;

  let svg;
  if (!total) {
    svg = `<svg viewBox="0 0 220 220" role="img" aria-label="本月还没有支出">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="25"/>
    </svg>`;
  } else if (rows.length === 1) {
    svg = `<svg viewBox="0 0 220 220" role="img" aria-label="支出构成">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${rows[0].cat.color}" stroke-width="25"/>
    </svg>`;
  } else {
    let offset = 0;
    const segs = rows.map(row => {
      const len = (row.amount / total) * circle;
      const gap = Math.min(3, len * 0.3);
      const dash = Math.max(len - gap, 0.5);
      const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none"
        stroke="${row.cat.color}" stroke-width="25"
        stroke-dasharray="${dash.toFixed(2)} ${(circle - dash).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${c} ${c})"/>`;
      offset += len;
      return seg;
    }).join('');
    svg = `<svg viewBox="0 0 220 220" role="img" aria-label="支出构成环形图">${segs}</svg>`;
  }

  box.innerHTML = `${svg}
    <div class="donut-center">
      <strong>${total ? fmtCompact(total) : '—'}</strong>
      <span>${total ? '总支出' : '暂无支出'}</span>
    </div>`;

  legend.innerHTML = rows.length
    ? rows.map(row => `
      <div class="legend-row">
        <span class="dot" style="background:${row.cat.color}"></span>
        <span class="name">${row.cat.name}</span>
        <span class="amt">${fmtCompact(row.amount)}</span>
        <span class="pct">${pctText(row.amount, total)}</span>
      </div>`).join('')
    : `<div class="empty-inline">本月还没有支出记录</div>`;
}

function renderTrend() {
  const box = $('#trend');
  if (!box) return;

  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(selectedMonth, -i));

  const data = months.map(m => {
    const list = entriesOfMonth(m);
    return {
      key: m,
      exp: sum(list.filter(e => e.type === 'expense')),
      inc: sum(list.filter(e => e.type === 'income'))
    };
  });

  const max = Math.max(1, ...data.map(d => Math.max(d.exp, d.inc)));
  const maxH = 138;

  box.innerHTML = data.map(d => {
    const eh = d.exp ? Math.max(4, Math.round((d.exp / max) * maxH)) : 2;
    const ih = d.inc ? Math.max(4, Math.round((d.inc / max) * maxH)) : 2;
    const current = d.key === selectedMonth ? 'current' : '';
    const label = `${Number(d.key.slice(5))}月`;

    return `
      <div class="bar-col ${current}">
        <div class="bar-pair">
          <i class="bar exp ${d.exp ? '' : 'zero'}" style="height:${eh}px" title="${monthTitle(d.key)} 支出 ${fmtMoney(d.exp)}"></i>
          <i class="bar inc ${d.inc ? '' : 'zero'}" style="height:${ih}px" title="${monthTitle(d.key)} 收入 ${fmtMoney(d.inc)}"></i>
        </div>
        <span class="bar-label">${label}</span>
      </div>`;
  }).join('');
}

function renderRank(expenseList, total) {
  const box = $('#rankList');
  if (!box) return;

  $('#rankSub').textContent = selectedMonth === currentMonthKey() ? '本月' : '当月';

  if (!expenseList.length) {
    box.innerHTML = `<div class="empty-inline">本月还没有支出，记一笔后这里会显示排行</div>`;
    return;
  }

  const map = new Map();
  expenseList.forEach(e => {
    const cur = map.get(e.categoryId) || { amount: 0, count: 0, cat: catOf(e) };
    cur.amount += e.amount;
    cur.count += 1;
    map.set(e.categoryId, cur);
  });

  const rows = Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 6);

  box.innerHTML = rows.map((row, i) => `
    <div class="rank-row">
      <span class="rank-no ${i < 3 ? 'top' + (i + 1) : ''}">${i + 1}</span>
      <span class="entry-icon" style="background:${tint(row.cat.color, 0.14)}" aria-hidden="true">${row.cat.icon}</span>
      <div class="rank-main">
        <div class="rank-line">
          <b>${row.cat.name}</b>
          <span class="rank-amt">${fmtMoney(row.amount)}</span>
        </div>
        <div class="rank-sub">
          <span>${row.count} 笔 · ${pctText(row.amount, total)}</span>
          <span class="rank-track"><i style="width:${(row.amount / rows[0].amount * 100).toFixed(1)}%;background:${row.cat.color}"></i></span>
        </div>
      </div>
    </div>`).join('');
}

/* ---------------- 设置 ---------------- */

function renderSettings() {
  const book = activeBook();
  const budgetInput = $('#budgetInput');
  if (budgetInput) budgetInput.value = book && book.budget ? String(book.budget) : '';

  const budgetBookName = $('#budgetBookName');
  if (budgetBookName) budgetBookName.textContent = book ? `《${book.name}》` : '';

  $$('#themeSwitch [data-theme-option]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeOption === state.theme);
  });

  const accountSel = $('#accountSelect');
  if (accountSel) {
    if (!accountSel.options.length) {
      accountSel.innerHTML = ACCOUNTS.map(a => `<option value="${a}">${a}</option>`).join('');
    }
    accountSel.value = state.defaultAccount;
  }

  const demo = isDemoBook();

  const demoBtn = $('#demoLoadBtn');
  if (demoBtn) {
    demoBtn.textContent = demo ? '清空示例' : '载入示例';
    demoBtn.dataset.action = demo ? 'clear-demo' : 'load-demo';
  }

  const demoHint = $('#demoHint');
  if (demoHint) {
    demoHint.textContent = demo
      ? '当前正在浏览示例账本，添加真实记录会自动清空并回到原来的账本'
      : '想先看看效果？会新建一个独立的示例账本，不影响现有记录';
  }

  const aboutStats = $('#aboutStats');
  if (aboutStats) {
    const count = bookEntries().length;
    aboutStats.textContent = storageBroken
      ? `${count} 条记录 · ${state.books.length} 个账本 · ⚠️ 本地存储不可用`
      : `${count} 条记录 · ${state.books.length} 个账本 · 数据保存在本机浏览器`;
  }

  renderBookSelect();
  renderBookList();
  renderCategoryManager();
  renderInstallCard();
}

/* ---------------- PWA：安装与离线 ---------------- */

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function renderInstallCard() {
  const text = $('#installText');
  const btn = $('#installBtn');
  const status = $('#installStatus');
  if (!text || !btn || !status) return;

  btn.hidden = true;
  status.textContent = '';
  status.classList.remove('ok');

  if (isStandalone()) {
    text.textContent = '当前已作为独立 App 运行，可以从桌面直接打开。';
    status.textContent = '✓ 已安装';
    status.classList.add('ok');
    return;
  }

  if (location.protocol === 'file:') {
    text.textContent = '当前是用本地文件打开的。把整个文件夹放到 HTTPS 网站或通过本地服务器打开后，才能安装到桌面并离线使用。';
    status.textContent = '需要 HTTP(S) 打开';
    return;
  }

  if (!('serviceWorker' in navigator)) {
    text.textContent = '当前浏览器不支持 Service Worker。推荐使用最新版 Chrome、Edge 或 Safari。';
    status.textContent = '浏览器不支持';
    return;
  }

  if (!window.isSecureContext) {
    text.textContent = '当前页面不是 HTTPS。可以尝试用浏览器菜单「添加到主屏幕」，但离线缓存需要 HTTPS。';
    status.textContent = '需要 HTTPS';
    return;
  }

  if (isIOS()) {
    text.textContent = '在 Safari 中点击底部「分享」按钮，选择「添加到主屏幕」，就能像 App 一样使用。';
    status.textContent = swRegistration ? '✓ 离线缓存已就绪' : '正在准备离线缓存…';
    if (swRegistration) status.classList.add('ok');
    return;
  }

  if (deferredInstallPrompt) {
    text.textContent = '安装后可以从桌面直接打开，断网也能继续记账。';
    btn.hidden = false;
    status.textContent = swRegistration ? '✓ 离线缓存已就绪' : '正在准备离线缓存…';
    if (swRegistration) status.classList.add('ok');
    return;
  }

  text.textContent = '使用 Chrome / Edge 打开，稍等片刻后可从地址栏右侧或浏览器菜单选择「安装拾账」。';
  status.textContent = swRegistration ? '✓ 离线缓存已就绪' : '正在准备离线缓存…';
  if (swRegistration) status.classList.add('ok');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js')
    .then(reg => {
      swRegistration = reg;
      renderInstallCard();
    })
    .catch(() => {
      // 安装失败不影响记账，只是无法离线打开
    });
}

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  try {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderInstallCard();
    if (choice && choice.outcome === 'accepted') toast('正在安装到桌面…');
  } catch (e) {
    toast('这个浏览器暂时无法自动安装，请用浏览器菜单手动添加');
  }
}

function renderDemoBanner() {
  const box = $('#demoBanner');
  if (!box) return;
  const parts = [];
  if (isDemoBook()) {
    parts.push(`
      <div class="demo-banner">
        <span><b>示例账本</b> · 添加记录会自动清空</span>
        <button class="btn btn-sm" data-action="clear-demo">清空示例</button>
      </div>`);
  }
  if (storageBroken) {
    parts.push(`
      <div class="demo-banner warn">
        <span>⚠️ 浏览器限制了本地存储，记录可能无法保存</span>
      </div>`);
  }
  box.innerHTML = parts.join('');
}

function saveBudget() {
  const input = $('#budgetInput');
  if (!input) return;
  const raw = input.value.trim();
  const value = raw === '' ? 0 : Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    toast('请输入有效的预算金额');
    return;
  }

  const book = activeBook();
  if (!book) return;

  book.budget = round2(value);
  saveState();
  renderAll();
  toast(book.budget
    ? `《${book.name}》的月预算已设为 ${fmtMoney(book.budget)}`
    : '已关闭这个账本的月度预算');
}

/* ---------------- 账本管理 ---------------- */

function renderBookSelect() {
  const sel = $('#bookSelect');
  if (!sel) return;

  sel.innerHTML = state.books.map(book =>
    `<option value="${esc(book.id)}">${esc(book.name)}</option>`
  ).join('') +
    `<option value="__new">＋ 新建账本…</option>` +
    `<option value="__manage">管理账本…</option>`;

  sel.value = state.activeBookId;
}

function renderBookList() {
  const box = $('#bookList');
  if (!box) return;

  const realCount = state.books.filter(b => !b.demo).length;

  box.innerHTML = state.books.map(book => {
    const count = state.entries.filter(e => e.bookId === book.id).length;
    const active = book.id === state.activeBookId;
    const canDelete = !book.demo && realCount > 1;

    return `
      <div class="book-row ${active ? 'active' : ''}">
        <button class="book-main" type="button" data-action="book-switch" data-id="${esc(book.id)}"
          ${active ? 'aria-current="true"' : ''}>
          <span class="book-avatar" aria-hidden="true">📒</span>
          <span class="book-info">
            <strong>${esc(book.name)}${active ? '<em class="badge">当前</em>' : ''}${book.demo ? '<em class="badge demo">示例</em>' : ''}</strong>
            <span>${count} 笔 · ${book.budget ? '月预算 ' + fmtMoney(book.budget) : '未设预算'}</span>
          </span>
        </button>
        <div class="book-actions">
          ${book.demo
            ? `<button class="link" data-action="clear-demo">清空</button>`
            : `<button class="icon-btn sm" type="button" data-action="book-rename" data-id="${esc(book.id)}" aria-label="重命名 ${esc(book.name)}">
                 <svg class="icon"><use href="#i-edit"/></svg>
               </button>
               ${canDelete ? `<button class="icon-btn sm danger" type="button" data-action="book-delete" data-id="${esc(book.id)}" aria-label="删除 ${esc(book.name)}">
                 <svg class="icon"><use href="#i-trash"/></svg>
               </button>` : ''}`}
        </div>
      </div>`;
  }).join('');
}

function switchBook(id) {
  const target = state.books.find(b => b.id === id);
  if (!target || id === state.activeBookId) {
    renderBookSelect();
    return;
  }

  if (isDemoBook()) clearDemoBooks();
  if (!state.books.some(b => b.id === id)) {
    renderAll();
    return;
  }

  state.activeBookId = id;
  selectedMonth = currentMonthKey();
  filters.month = 'all';
  saveState();
  renderAll();
  toast(`已切换到《${target.name}》`);
}

function createBook(name) {
  const clean = name.trim().slice(0, BOOK_NAME_MAX);
  if (!clean) {
    toast('请输入账本名称');
    return;
  }

  if (clean === DEMO_BOOK_NAME) {
    toast('「示例账本」是保留名称');
    return;
  }

  if (state.books.some(b => b.name === clean)) {
    toast('已经有同名账本了');
    return;
  }

  if (isDemoBook()) clearDemoBooks();

  const book = {
    id: uid('b_'),
    name: clean,
    budget: 0,
    createdAt: Date.now()
  };

  state.books.push(book);
  state.activeBookId = book.id;
  selectedMonth = currentMonthKey();
  filters.month = 'all';
  saveState();
  renderAll();
  toast(`已创建《${book.name}》`);
}

function promptNewBook() {
  promptDialog({
    title: '新建账本',
    message: '不同账本的记录彼此独立，适合分账、旅行或家庭使用。',
    placeholder: '例如：旅行账本',
    value: '',
    maxlength: BOOK_NAME_MAX,
    confirmText: '创建',
    onConfirm: createBook
  });
}

function promptRenameBook(id) {
  const book = state.books.find(b => b.id === id);
  if (!book || book.demo) return;

  promptDialog({
    title: '重命名账本',
    placeholder: '账本名称',
    value: book.name,
    maxlength: BOOK_NAME_MAX,
    confirmText: '保存',
    onConfirm: name => {
      const next = name.trim().slice(0, BOOK_NAME_MAX);
      if (!next) return;
      if (next === DEMO_BOOK_NAME) {
        toast('「示例账本」是保留名称');
        return;
      }
      if (state.books.some(b => b.id !== book.id && b.name === next)) {
        toast('已经有同名账本了');
        return;
      }
      book.name = next;
      saveState();
      renderAll();
      toast('账本名称已更新');
    }
  });
}

function deleteBook(id) {
  const book = state.books.find(b => b.id === id);
  if (!book) return;

  if (book.demo) {
    clearDemoBooks();
    saveState();
    renderAll();
    toast('示例账本已清除');
    return;
  }

  if (state.books.filter(b => !b.demo).length <= 1) {
    toast('至少要保留一个真实账本');
    return;
  }

  const count = state.entries.filter(e => e.bookId === id).length;
  confirmDialog({
    title: `删除《${book.name}》？`,
    message: `这个账本里的 ${count} 笔记录会一并删除，无法恢复。其他账本不受影响。`,
    confirmText: '删除账本',
    danger: true,
    onConfirm: () => {
      state.entries = state.entries.filter(e => e.bookId !== id);
      state.books = state.books.filter(b => b.id !== id);
      if (state.activeBookId === id) {
        state.activeBookId = state.books[0].id;
        selectedMonth = currentMonthKey();
        filters.month = 'all';
      }
      saveState();
      renderAll();
      toast('账本已删除');
    }
  });
}

/* ---------------- 分类管理 ---------------- */

function renderCategoryManager() {
  const box = $('#catList');
  if (!box) return;

  $$('#catTabs [data-cat-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.catTab === activeCatTab);
  });

  const cats = categoriesOfType(activeCatTab).filter(c => c.custom);

  if (!cats.length) {
    box.innerHTML = `<div class="cat-empty">还没有自定义${activeCatTab === 'income' ? '收入' : '支出'}分类。内置分类固定可用，点右上角「＋ 添加」创建自己的分类。</div>`;
    return;
  }

  box.innerHTML = cats.map(cat => {
    const count = state.entries.filter(e => e.categoryId === cat.id).length;

    return `
      <div class="cat-row">
        <span class="cat-avatar" style="background:${tint(cat.color, 0.14)}" aria-hidden="true">${cat.icon}</span>
        <span class="cat-row-main">
          <strong>${esc(cat.name)}</strong>
          <span>${count} 笔 · 自定义</span>
        </span>
        <span class="cat-actions">
          <button class="icon-btn sm" type="button" data-action="cat-edit" data-id="${esc(cat.id)}" aria-label="编辑 ${esc(cat.name)}">
            <svg class="icon"><use href="#i-edit"/></svg>
          </button>
          <button class="icon-btn sm danger" type="button" data-action="cat-delete" data-id="${esc(cat.id)}" aria-label="删除 ${esc(cat.name)}">
            <svg class="icon"><use href="#i-trash"/></svg>
          </button>
        </span>
      </div>`;
  }).join('');
}

function renderCatPicker() {
  if (!catDraft) return;

  const iconBox = $('#catIcons');
  if (iconBox) {
    iconBox.innerHTML = CATEGORY_ICONS.map(icon => `
      <button class="emoji-cell ${icon === catDraft.icon ? 'active' : ''}" type="button"
        data-cat-icon="${icon}" aria-label="图标 ${icon}" aria-pressed="${icon === catDraft.icon}">${icon}</button>
    `).join('');
  }

  const colorBox = $('#catColors');
  if (colorBox) {
    colorBox.innerHTML = CATEGORY_COLORS.map(color => `
      <button class="color-cell ${color === catDraft.color ? 'active' : ''}" type="button"
        data-cat-color="${color}" style="--swatch:${color}" aria-label="颜色 ${color}" aria-pressed="${color === catDraft.color}"></button>
    `).join('');
  }
}

function openCategoryEditor(cat) {
  if (cat && !cat.custom) return;

  if (cat) {
    catDraft = { id: cat.id, type: cat.type, name: cat.name, icon: cat.icon, color: cat.color };
  } else {
    catDraft = {
      id: null,
      type: activeCatTab,
      name: '',
      icon: CATEGORY_ICONS[0],
      color: CATEGORY_COLORS[0]
    };
  }

  $('#catEditorTitle').textContent = cat ? '编辑分类' : '添加分类';
  const sub = $('#catEditorSub');
  if (sub) sub.textContent = catDraft.type === 'income' ? '收入分类' : '支出分类';
  $('#catName').value = catDraft.name;
  renderCatPicker();

  catLastFocus = document.activeElement;
  const modal = $('#catEditor');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    const input = $('#catName');
    if (input) input.focus({ preventScroll: true });
  }, 80);
}

function closeCategoryEditor() {
  const modal = $('#catEditor');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  catDraft = null;

  if (catLastFocus && document.body.contains(catLastFocus)) {
    try { catLastFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ }
  }
  catLastFocus = null;
}

function saveCategory() {
  if (!catDraft) return;

  const input = $('#catName');
  const name = (input ? input.value : '').trim().slice(0, CAT_NAME_MAX);
  if (!name) {
    toast('给这个分类起个名字吧');
    if (input) input.focus();
    return;
  }

  const duplicate = categoriesOfType(catDraft.type)
    .some(c => c.name === name && c.id !== catDraft.id);
  if (duplicate) {
    toast('这个类型下已经有同名分类');
    if (input) input.focus();
    return;
  }

  if (catDraft.id) {
    const cat = state.categories.find(c => c.id === catDraft.id);
    if (!cat) return;
    cat.name = name;
    cat.icon = catDraft.icon;
    cat.color = catDraft.color;
  } else {
    state.categories.push({
      id: uid('cat_'),
      type: catDraft.type,
      name,
      icon: catDraft.icon,
      color: catDraft.color,
      custom: true
    });
    activeCatTab = catDraft.type;
  }

  saveState();
  closeCategoryEditor();
  renderAll();
  toast('分类已保存');
}

function deleteCategory(id) {
  const cat = getCategory(id);
  if (!cat || !cat.custom) return;

  const used = state.entries.filter(e => e.categoryId === id).length;
  const fallback = cat.type === 'income' ? 'other_in' : 'other';

  confirmDialog({
    title: `删除「${cat.name}」？`,
    message: used
      ? `有 ${used} 笔记录使用了这个分类，删除后这些记录会归入「其他」。`
      : '删除后不可恢复。',
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      state.entries.forEach(e => {
        if (e.categoryId === id) e.categoryId = fallback;
      });
      state.categories = state.categories.filter(c => c.id !== id);
      if (filters.cat === id) filters.cat = 'all';
      saveState();
      renderAll();
      toast('分类已删除');
    }
  });
}

/* ---------------- 记账面板 ---------------- */

function defaultDateFor(month) {
  const current = currentMonthKey();
  if (month === current) return todayStr();
  if (month > current) return month + '-01';
  return month + '-' + pad2(daysInMonth(month));
}

function openComposer(type = 'expense', entry = null) {
  if (!state) return;
  const safeType = type === 'income' ? 'income' : 'expense';

  if (entry) {
    draft = {
      id: entry.id,
      type: entry.type,
      amount: Number(entry.amount).toFixed(2),
      categoryId: entry.categoryId,
      date: entry.date,
      account: entry.account,
      note: entry.note || ''
    };
  } else {
    draft = {
      id: null,
      type: safeType,
      amount: '0',
      categoryId: firstCat(safeType).id,
      date: defaultDateFor(selectedMonth),
      account: state.defaultAccount,
      note: ''
    };
  }

  renderComposer();

  const modal = $('#composer');
  lastFocus = document.activeElement;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    const sheet = $('.sheet', modal);
    if (sheet) sheet.focus({ preventScroll: true });
  }, 40);
}

function closeComposer() {
  const modal = $('#composer');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  draft = null;

  if (lastFocus && document.body.contains(lastFocus)) {
    try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ }
  }
  lastFocus = null;
}

function renderComposer() {
  if (!draft) return;

  $$('#composerType [data-draft-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.draftType === draft.type);
  });

  $('#composerTitle').textContent = draft.id ? '编辑记录' : '记一笔';
  $('#amountValue').textContent = displayAmount(draft.amount);
  $('#draftDate').value = draft.date;
  $('#draftNote').value = draft.note;

  const accountSel = $('#draftAccount');
  if (!accountSel.options.length) {
    accountSel.innerHTML = ACCOUNTS.map(a => `<option value="${a}">${a}</option>`).join('');
  }
  accountSel.value = draft.account;

  const del = $('#composerDelete');
  if (del) del.hidden = !draft.id;

  renderCatGrid();
}

function renderCatGrid() {
  if (!draft) return;
  const cats = categoriesOfType(draft.type);
  $('#catGrid').innerHTML = cats.map(c => `
    <button class="cat ${c.id === draft.categoryId ? 'active' : ''}" type="button"
      data-cat="${c.id}"
      style="--cat-color:${c.color};--cat-bg:${tint(c.color, 0.13)}"
      aria-pressed="${c.id === draft.categoryId}">
      <span class="cat-icon" aria-hidden="true">${c.icon}</span>
      <span>${c.name}</span>
    </button>`).join('');
}

function displayAmount(raw) {
  if (raw === '0') return '0.00';
  const [int, dec] = String(raw).split('.');
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${grouped}.${dec}` : grouped;
}

function pressKey(key) {
  if (!draft) return;

  if (key === 'back') {
    let next = draft.amount.slice(0, -1);
    if (!next) next = '0';
    draft.amount = next;
  } else if (key === '.') {
    if (!draft.amount.includes('.')) draft.amount += '.';
  } else if (/^[0-9]$/.test(key)) {
    if (draft.amount === '0') {
      draft.amount = key;
    } else {
      if (draft.amount.includes('.')) {
        if (draft.amount.split('.')[1].length >= 2) return;
      } else if (draft.amount.replace('.', '').length >= 7) {
        return;
      }
      draft.amount += key;
    }
  } else {
    return;
  }

  const el = $('#amountValue');
  el.textContent = displayAmount(draft.amount);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function setDraftType(type) {
  if (!draft || draft.type === type) return;
  draft.type = type;
  const current = getCategory(draft.categoryId);
  if (!current || current.type !== type) draft.categoryId = firstCat(type).id;

  $$('#composerType [data-draft-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.draftType === type);
  });
  renderCatGrid();
}

function setDraftCategory(id) {
  if (!draft) return;
  const cat = getCategory(id);
  if (!cat || cat.type !== draft.type) return;
  draft.categoryId = id;
  renderCatGrid();
}

function saveEntry() {
  if (!draft) return;

  const amount = round2(parseFloat(draft.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    const row = $('.amount-row');
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
    toast('请输入金额');
    return;
  }

  const cat = getCategory(draft.categoryId);
  const categoryId = cat && cat.type === draft.type ? cat.id : firstCat(draft.type).id;
  const date = isValidDateStr(draft.date) ? draft.date : todayStr();

  const wasDemo = isDemoBook();
  if (wasDemo) clearDemoBooks();

  const payload = {
    type: draft.type,
    amount,
    categoryId,
    date,
    account: ACCOUNTS.includes(draft.account) ? draft.account : ACCOUNTS[0],
    note: draft.note.trim().slice(0, 30),
    bookId: state.activeBookId
  };

  let isNew = !draft.id;
  if (!isNew) {
    const idx = state.entries.findIndex(e => e.id === draft.id);
    if (idx >= 0) {
      state.entries[idx] = { ...state.entries[idx], ...payload };
    } else {
      isNew = true;
    }
  }

  if (isNew) {
    state.entries.push({ id: uid(), ...payload, createdAt: Date.now() });
  }

  saveState();
  selectedMonth = monthKeyOf(date);

  closeComposer();
  renderAll();

  if (wasDemo) toast('示例账本已清除，这一笔已保存');
  else if (isNew) toast(`已记下${payload.type === 'expense' ? '支出' : '收入'} ${fmtMoney(amount)}`);
  else toast('已更新这笔记录');
}

function requestDelete() {
  if (!draft || !draft.id) return;
  const entry = state.entries.find(e => e.id === draft.id);
  if (!entry) return;

  confirmDialog({
    title: '删除这笔记录？',
    message: `${dateLabel(entry.date)} · ${catOf(entry).name} ${fmtMoney(entry.amount)}，删除后无法恢复。`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      state.entries = state.entries.filter(e => e.id !== entry.id);
      saveState();
      closeComposer();
      renderAll();
      toast('已删除');
    }
  });
}

/* ---------------- 示例数据 ---------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDemoEntries(bookId) {
  const rnd = mulberry32(20261026);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const entries = [];
  const now = new Date();

  const add = (y, m, d, type, categoryId, amount, note, account) => {
    const dt = new Date(y, m, d);
    entries.push({
      id: 'demo-' + entries.length + '-' + dt.getTime(),
      type,
      categoryId,
      amount: round2(amount),
      date: toDateStr(dt),
      account: account || '微信',
      note,
      createdAt: dt.getTime() + 9 * 3600 * 1000 + entries.length * 60000,
      bookId
    });
  };

  for (let back = 5; back >= 0; back--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const isCurrent = back === 0;
    const lastDay = isCurrent ? now.getDate() : new Date(y, m + 1, 0).getDate();

    if (lastDay >= 10) add(y, m, 10, 'income', 'salary', 12800 + (back % 3) * 400, '工资', '银行卡');
    if (back === 4) add(y, m, 20, 'income', 'bonus', 2000, '季度奖金', '银行卡');
    if (back === 2 && lastDay >= 18) add(y, m, 18, 'income', 'side', 800, '周末兼职', '微信');

    add(y, m, 1, 'expense', 'housing', 3200, '房租', '银行卡');
    if (lastDay >= 5) add(y, m, 5, 'expense', 'phone', 99, '话费套餐', '微信');

    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(y, m, d);
      const wd = date.getDay();
      const r = rnd();

      if (r < 0.45) {
        add(y, m, d, 'expense', 'food', pick([16, 20, 22, 26, 28, 32, 35, 42, 48, 56, 68]),
          pick(['楼下小馆', '公司食堂', '牛肉面', '轻食沙拉', '便利店早餐', '外卖午餐', '手冲咖啡', '奶茶']),
          pick(['微信', '支付宝', '微信']));
      }
      if (r > 0.86) {
        add(y, m, d, 'expense', 'transport', pick([3, 4, 6, 8, 12, 16, 25, 32]),
          pick(['地铁通勤', '公交', '共享单车', '打车回家']),
          pick(['支付宝', '微信']));
      }
      if ((wd === 6 || wd === 0) && rnd() > 0.58) {
        add(y, m, d, 'expense', 'fun', pick([45, 68, 88, 128, 168]),
          pick(['电影票', '周末展览', '桌游', '爬山', 'livehouse']), '微信');
      }
      if (rnd() > 0.8) {
        add(y, m, d, 'expense', 'shopping', pick([36, 58, 89, 129, 199, 268]),
          pick(['超市采购', '日用品', '水果零食', '换季衣物', '家居小物']),
          pick(['支付宝', '信用卡']));
      }
      if (rnd() > 0.94) {
        add(y, m, d, 'expense', 'study', pick([39, 58, 99, 128]),
          pick(['一本新书', '线上课程', '杂志订阅']), '微信');
      }
      if (rnd() > 0.96) {
        add(y, m, d, 'expense', 'medical', pick([25, 48, 120]),
          pick(['感冒药', '维生素', '牙科复诊']), '支付宝');
      }
      if (rnd() > 0.97) {
        add(y, m, d, 'expense', 'social', pick([100, 200, 520]),
          pick(['朋友生日礼物', '同事聚餐', '结婚红包']), '微信');
      }
    }
  }

  return entries.sort(byDateDesc);
}

function clearDemoBooks() {
  if (!state) return;

  const demoBooks = state.books.filter(b => b.demo);
  if (!demoBooks.length) return;

  const active = activeBook();
  const targetId = active && active.demo ? active.returnTo : state.activeBookId;
  const demoIds = new Set(demoBooks.map(b => b.id));

  state.books = state.books.filter(b => !b.demo);
  state.entries = state.entries.filter(e => !demoIds.has(e.bookId));

  if (!state.books.length) {
    const book = {
      id: uid('b_'),
      name: DEFAULT_BOOK_NAME,
      budget: 0,
      createdAt: Date.now()
    };
    state.books.push(book);
    state.activeBookId = book.id;
    return;
  }

  if (!state.books.some(b => b.id === state.activeBookId)) {
    state.activeBookId = state.books.some(b => b.id === targetId)
      ? targetId
      : state.books[0].id;
  }
}

function seedDemoData() {
  clearDemoBooks();

  const returnTo = activeBook() ? activeBook().id : null;
  const book = {
    id: uid('b_'),
    name: DEMO_BOOK_NAME,
    budget: 6000,
    createdAt: Date.now(),
    demo: true,
    returnTo
  };

  state.books.push(book);
  state.activeBookId = book.id;
  state.entries.push(...buildDemoEntries(book.id));
  selectedMonth = currentMonthKey();
}

function loadDemo() {
  seedDemoData();
  saveState();
  renderAll();
  filters.month = 'all';
  setView('home', { force: true });
  toast('已打开示例账本，随时可以清空');
}

function clearDemo() {
  const wasDemo = isDemoBook();
  clearDemoBooks();
  saveState();
  renderAll();
  toast(wasDemo ? '示例账本已清除，回到自己的账本' : '示例数据已清除');
}

/* ---------------- 导出 / 备份 / 恢复 ---------------- */

function downloadFile(filename, content, mime) {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (e) {
    toast('导出失败，请换个浏览器试试');
    return false;
  }
}

function exportCSV() {
  const book = activeBook();
  const list = bookEntries();
  if (!book || !list.length) {
    toast('这个账本还没有可导出的记录');
    return;
  }

  const rows = [['日期', '类型', '分类', '金额', '账户', '备注']];
  const sorted = list.slice().sort((a, b) =>
    a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));

  sorted.forEach(e => {
    const cat = catOf(e);
    rows.push([
      e.date,
      e.type === 'expense' ? '支出' : '收入',
      cat.name,
      e.amount.toFixed(2),
      e.account,
      e.note
    ]);
  });

  const csv = '\uFEFF' + rows
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const safeName = book.name.replace(/[\\/:*?"<>|]/g, '').slice(0, 20) || '账本';
  if (downloadFile(`拾账-${safeName}-${todayStr()}.csv`, csv, 'text/csv;charset=utf-8')) {
    toast(`《${book.name}》的 CSV 已导出`);
  }
}

function backupJSON() {
  const payload = {
    app: '拾账',
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      entries: state.entries,
      books: state.books,
      activeBookId: state.activeBookId,
      categories: state.categories,
      defaultAccount: state.defaultAccount,
      theme: state.theme
    }
  };

  if (downloadFile(`拾账-备份-${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json')) {
    toast('备份已保存（包含全部账本与分类）');
  }
}

function handleRestoreFile(file) {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const data = parsed && parsed.data ? parsed.data : parsed;
      if (!data || !Array.isArray(data.entries)) throw new Error('invalid');

      const candidate = migrateState(data);
      const count = candidate.entries.length;

      confirmDialog({
        title: '恢复这份备份？',
        message: `将导入 ${count} 条记录、${candidate.books.length} 个账本，并替换当前全部数据。`,
        confirmText: '恢复',
        danger: true,
        onConfirm: () => {
          state = candidate;
          selectedMonth = currentMonthKey();
          filters.q = '';
          filters.type = 'all';
          filters.cat = 'all';
          filters.month = 'all';
          const search = $('#searchInput');
          if (search) search.value = '';
          saveState();
          applyTheme();
          renderAll();
          toast(`已恢复 ${count} 条记录`);
        }
      });
    } catch (e) {
      toast('备份文件无法识别');
    }
  };

  reader.onerror = () => toast('读取文件失败');
  reader.readAsText(file);
}

function clearAll() {
  if (isDemoBook()) {
    clearDemoBooks();
    saveState();
    renderAll();
    toast('示例账本已清空');
    return;
  }

  const book = activeBook();
  const list = bookEntries();
  if (!book || !list.length) {
    toast('这个账本已经是空的了');
    return;
  }

  confirmDialog({
    title: `清空《${book.name}》？`,
    message: `将删除这个账本里的全部 ${list.length} 条记录，无法恢复。其他账本不受影响。`,
    confirmText: '清空记录',
    danger: true,
    onConfirm: () => {
      state.entries = state.entries.filter(e => e.bookId !== book.id);
      saveState();
      renderAll();
      toast('当前账本已清空');
    }
  });
}

/* ---------------- 渲染总入口 ---------------- */

function renderAll() {
  renderHome();
  renderRecords();
  renderStats();
  renderSettings();
  renderDemoBanner();
}

function changeMonth(delta) {
  const next = shiftMonth(selectedMonth, delta);
  if (next > currentMonthKey()) return;
  selectedMonth = next;
  renderHome();
  renderStats();
}

function goCurrentMonth() {
  selectedMonth = currentMonthKey();
  renderHome();
  renderStats();
}

function setTheme(theme) {
  if (!['auto', 'light', 'dark'].includes(theme)) return;
  state.theme = theme;
  applyTheme();
  saveState();
  renderSettings();
}

/* ---------------- 事件 ---------------- */

function onClick(e) {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;

  const keyBtn = target.closest('[data-key]');
  if (keyBtn && draft) {
    e.preventDefault();
    pressKey(keyBtn.dataset.key);
    return;
  }

  const catBtn = target.closest('[data-cat]');
  if (catBtn && draft) {
    e.preventDefault();
    setDraftCategory(catBtn.dataset.cat);
    return;
  }

  const draftTypeBtn = target.closest('[data-draft-type]');
  if (draftTypeBtn) {
    e.preventDefault();
    setDraftType(draftTypeBtn.dataset.draftType);
    return;
  }

  const catTabBtn = target.closest('[data-cat-tab]');
  if (catTabBtn) {
    e.preventDefault();
    activeCatTab = catTabBtn.dataset.catTab === 'income' ? 'income' : 'expense';
    renderCategoryManager();
    return;
  }

  const catIconBtn = target.closest('[data-cat-icon]');
  if (catIconBtn && catDraft) {
    e.preventDefault();
    catDraft.icon = catIconBtn.dataset.catIcon;
    renderCatPicker();
    return;
  }

  const catColorBtn = target.closest('[data-cat-color]');
  if (catColorBtn && catDraft) {
    e.preventDefault();
    catDraft.color = catColorBtn.dataset.catColor;
    renderCatPicker();
    return;
  }

  const typeFilterBtn = target.closest('[data-filter-type]');
  if (typeFilterBtn) {
    e.preventDefault();
    filters.type = typeFilterBtn.dataset.filterType;
    const cat = filters.cat === 'all' ? null : getCategory(filters.cat);
    if (cat && filters.type !== 'all' && cat.type !== filters.type) filters.cat = 'all';
    renderRecords();
    return;
  }

  const themeBtn = target.closest('[data-theme-option]');
  if (themeBtn) {
    e.preventDefault();
    setTheme(themeBtn.dataset.themeOption);
    return;
  }

  const actionEl = target.closest('[data-action]');
  if (!actionEl) return;

  e.preventDefault();
  handleAction(actionEl);
}

function handleAction(el) {
  const action = el.dataset.action;

  switch (action) {
    case 'nav':
      setView(el.dataset.view || 'home');
      break;

    case 'add':
      openComposer(el.dataset.type === 'income' ? 'income' : 'expense');
      break;

    case 'edit': {
      const entry = state.entries.find(e => e.id === el.dataset.id);
      if (entry) openComposer(entry.type, entry);
      break;
    }

    case 'close-composer':
      closeComposer();
      break;

    case 'save-entry':
      saveEntry();
      break;

    case 'delete-entry':
      requestDelete();
      break;

    case 'month-prev':
      changeMonth(-1);
      break;

    case 'month-next':
      changeMonth(1);
      break;

    case 'month-today':
      goCurrentMonth();
      break;

    case 'clear-filters':
      resetFilters();
      break;

    case 'load-demo':
      loadDemo();
      break;

    case 'clear-demo':
      clearDemo();
      break;

    case 'book-new':
      promptNewBook();
      break;

    case 'book-switch':
      switchBook(el.dataset.id);
      break;

    case 'book-rename':
      promptRenameBook(el.dataset.id);
      break;

    case 'book-delete':
      deleteBook(el.dataset.id);
      break;

    case 'cat-add':
      openCategoryEditor(null);
      break;

    case 'cat-edit': {
      const cat = getCategory(el.dataset.id);
      if (cat) openCategoryEditor(cat);
      break;
    }

    case 'cat-delete':
      deleteCategory(el.dataset.id);
      break;

    case 'close-cat-editor':
      closeCategoryEditor();
      break;

    case 'save-cat':
      saveCategory();
      break;

    case 'save-budget':
      saveBudget();
      break;

    case 'install-app':
      promptInstall();
      break;

    case 'export-csv':
      exportCSV();
      break;

    case 'backup':
      backupJSON();
      break;

    case 'restore':
      $('#restoreFile').click();
      break;

    case 'clear-all':
      clearAll();
      break;

    case 'close-confirm':
      closeConfirm();
      break;

    case 'confirm-ok':
      runConfirm();
      break;

    default:
      break;
  }
}

function bindEvents() {
  document.addEventListener('click', onClick);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    renderInstallCard();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    renderInstallCard();
    toast('已安装到桌面');
  });

  window.addEventListener('hashchange', () => {
    const name = location.hash.replace('#', '');
    if (VIEWS.includes(name)) setView(name, { silent: true });
  });

  window.addEventListener('scroll', syncTopbar, { passive: true });

  const search = $('#searchInput');
  if (search) {
    search.addEventListener('input', debounce(() => {
      filters.q = search.value;
      renderRecords();
    }, 140));
  }

  const catFilter = $('#catFilter');
  if (catFilter) catFilter.addEventListener('change', () => {
    filters.cat = catFilter.value;
    renderRecords();
  });

  const monthFilter = $('#monthFilter');
  if (monthFilter) monthFilter.addEventListener('change', () => {
    filters.month = monthFilter.value;
    renderRecords();
  });

  const accountSelect = $('#accountSelect');
  if (accountSelect) accountSelect.addEventListener('change', () => {
    if (ACCOUNTS.includes(accountSelect.value)) {
      state.defaultAccount = accountSelect.value;
      saveState();
      toast(`默认账户已设为${state.defaultAccount}`);
    }
  });

  const bookSelect = $('#bookSelect');
  if (bookSelect) {
    bookSelect.addEventListener('change', () => {
      const value = bookSelect.value;

      if (value === '__new') {
        bookSelect.value = state.activeBookId;
        promptNewBook();
        return;
      }

      if (value === '__manage') {
        bookSelect.value = state.activeBookId;
        setView('settings');
        setTimeout(() => {
          const card = $('#bookCard');
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
        return;
      }

      if (value !== state.activeBookId) switchBook(value);
    });
  }

  const confirmInput = $('#confirmInput');
  if (confirmInput) {
    confirmInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runConfirm();
      }
    });
  }

  const catName = $('#catName');
  if (catName) {
    catName.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveCategory();
      }
    });
  }

  const budgetInput = $('#budgetInput');
  if (budgetInput) {
    budgetInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBudget();
      }
    });
  }

  const draftDate = $('#draftDate');
  if (draftDate) draftDate.addEventListener('change', () => {
    if (draft && draftDate.value) draft.date = draftDate.value;
  });

  const draftAccount = $('#draftAccount');
  if (draftAccount) draftAccount.addEventListener('change', () => {
    if (draft) draft.account = draftAccount.value;
  });

  const draftNote = $('#draftNote');
  if (draftNote) {
    draftNote.addEventListener('input', () => {
      if (draft) draft.note = draftNote.value;
    });
    draftNote.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEntry();
      }
    });
  }

  const restoreFile = $('#restoreFile');
  if (restoreFile) {
    restoreFile.addEventListener('change', () => {
      const file = restoreFile.files && restoreFile.files[0];
      restoreFile.value = '';
      handleRestoreFile(file);
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#confirm').classList.contains('open')) {
        closeConfirm();
        return;
      }
      if ($('#catEditor').classList.contains('open')) {
        closeCategoryEditor();
        return;
      }
      if ($('#composer').classList.contains('open')) {
        closeComposer();
      }
      return;
    }

    const composerOpen = $('#composer').classList.contains('open');
    const confirmOpen = $('#confirm').classList.contains('open');
    if (!composerOpen || confirmOpen) return;

    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      pressKey(e.key);
    } else if (e.key === '.') {
      e.preventDefault();
      pressKey('.');
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      pressKey('back');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      saveEntry();
    }
  });
}

/* ---------------- 启动 ---------------- */

function init() {
  storageBroken = !detectStorage();
  state = loadState();
  selectedMonth = currentMonthKey();

  // 只在确实发生了版本迁移时写回，避免覆盖用户可能还想手动恢复的异常数据
  if (pendingMigrationSave) saveState();

  applyTheme();
  bindEvents();
  renderAll();

  const initial = location.hash.replace('#', '');
  setView(VIEWS.includes(initial) ? initial : 'home', { silent: true, force: true });
  syncTopbar();

  if (storageBroken) {
    setTimeout(() => toast('浏览器限制了本地存储，记录可能无法保存', 4200), 1200);
  }

  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
}

init();
