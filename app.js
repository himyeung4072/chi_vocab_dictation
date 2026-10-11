'use strict';

/* =====================================================
   默書樂園 - 小學生自行默書練習
   純前端，資料存喺瀏覽器 localStorage
   ===================================================== */

const STORE_KEY = 'chiVocab.v1';
const BACKUP_KEY = STORE_KEY + '_corrupt_backup';   // 載入時讀唔到嘅原始資料另存喺度
const BACKUP_MAX = 3;   // 最多保留幾份備份
const AVATARS = ['🐶', '🐱', '🐰', '🐼', '🦊', '🐸', '🐯', '🐨', '🐷', '🦁', '🐵', '🐥'];
const GRADES = ['小一', '小二', '小三', '小四', '小五', '小六'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const SPEEDS = {
  slow: { label: '🐢 慢', rate: 0.55 },
  normal: { label: '🐰 正常', rate: 0.8 },
  fast: { label: '🐆 快', rate: 1.05 }
};
const LANGS = { yue: { label: '廣東話' }, cmn: { label: '普通話' } };

// 時序（毫秒）
const FIRST_DELAY = 1500;  // 開始默書後，第一個詞語朗讀前嘅等待
const SLOW_RATE = 0.45;    // 「再讀慢啲」嘅速度
// 設定頁「🔊 試聽」讀嘅句子；普通話用書面語，唔用廣東話口語
const VOICE_TEST = { yue: '你好，我哋開始默書啦', cmn: '你好，我們開始默書了' };
const HINT_MAX = 60;       // 提示句最多幾多個字（按字元計，超出截短）
const PIN_UNLOCK_MS = 3 * 60 * 1000;   // 家長 PIN 解鎖窗口：由輸入正確 PIN 嗰刻起計，固定長度、唔會因操作順延；只用嚟涵蓋一個課文編輯階段
const TITLE_MAX = 20;      // 課文名最多幾多個字（同編輯頁 maxlength 一致）
const WORD_MAX = 30;       // 分享課文：單個詞語最多幾多個字（超出拒收）
const SHARE_WORDS_MAX = 100;     // 分享課文：最多幾多個詞語（超出拒收）
const SHARE_TEXT_MAX = 5000;     // 分享課文：文字最多幾多個字（超出拒收）
const SHARE_PAYLOAD_MAX = 20000; // 分享連結 #lesson= 後面最多幾多字元（中文 UTF-8 每字 3 byte，base64 約 4 字元）
const SHARE_LESSONS_MAX = 100;   // 一位同學最多幾多課（只喺加入分享課文時檢查）
const LESSON_COUNT_DEFAULT = 12;   // 課文模式預設默幾多個詞語
const QUIZ_MODES = { timed: { label: '定時默書', tag: '定時' }, self: { label: '自助默書', tag: '自助' } };
/* 預設默書方式：有語音就定時，冇就自助。舊紀錄嘅 'normal'（已移除嘅舊方式）只留喺 history[].mode，唔再係可選方式 */
function defaultMode() { return 'speechSynthesis' in window ? 'timed' : 'self'; }
function normaliseMode(m) { return m === 'timed' || m === 'self' ? m : defaultMode(); }
const TIER_LABELS = ['2 字或以下', '3 字', '4 字', '5 字或以上'];
const TIMED_SECS_DEFAULT = [8, 10, 12, 15];
const TIMED_SECS_MIN = 3, TIMED_SECS_MAX = 60;
const TIMED_READS_DEFAULT = 2, TIMED_READS_MAX = 3;
const TIMED_PREP_MS = 3000;     // 定時默書開始前嘅預備時間（可暫停）
const TIMED_MIN_SLOT_S = 2.5;   // 每次朗讀最少預留秒數（秒數 ÷ 次數 < 2.5 就喺設定頁警告，唔強制）
const SELF_SPEAK_DELAY = 250;   // 自助：切換詞語後等 250ms 先朗讀，連撳時只讀最後一個
const CLICK_GUARD_MS = 500;     // 進入對答案／結果頁後，短時間內忽略點擊（防連點誤觸新畫面）
const SELF_LAST_GUARD_MS = 800; // 自助：剛切到最後一個詞語後，呢段時間內忽略「完成，對答案」
const TIMED_LIVE_MAX_MS = 3000; // 定時：朗讀開始後超過呢個時間仍冇收到 onend，暫停時都當已讀完（唔重讀）
const TIMED_DUE_SLACK_MS = 250; // 定時：暫停結算 elapsed 時，容許超出下一事件到期時間嘅上限
const NEW_BLUR = ['selfPrev', 'selfNext', 'selfRepeat', 'selfSlow', 'selfHint', 'selfLang', 'timedToggle'];   // 滑鼠／觸控撳完要 blur，等快捷鍵繼續生效
const BANK_COUNT_DEFAULT = 10;     // 錯字怪獸模式預設默幾多個錯字
const PRINT_CELLS = [2, 3, 4, 6];   // 列印：每字幾格（詞語重複寫幾次）
const PRINT_DEFAULTS = { mode: 'practice', cells: 4, trace: true, hints: true, answers: true };
const HISTORY_MAX = 200;   // 每位同學最多保留幾多次默書紀錄
const DAY_MS = 86400000;
const BACKUP_REMIND_DAYS = 14;   // 超過幾多日未備份，就喺首頁提示
const A2HS_KEY = STORE_KEY + '_a2hs_dismissed';   // 「加到主畫面」提示已關閉（只係呢部機，唔跟備份走）

const WAIT_HTML = '<span class="dots"><i></i><i></i><i></i></span> 預備緊，聽到就開始寫';

// 詞語解析用嘅 regex。要喺 loadDB() 之前宣告：載入時 cleanLessons 會用到（舊課文遷移）
/* 詞語首尾嘅標點（只係首尾，詞語中間嘅字元唔掂；唔包含 | 同 ｜） */
const EDGE_PUNCT = /^[。．.!?,、;:"'“”‘’「」『』()（）\[\]【】《》〈〉<>…]+|[。．.!?,、;:"'“”‘’「」『』()（）\[\]【】《》〈〉<>…]+$/g;
/* 詞語分隔符：空白（包括換行）、逗號、頓號、分號、斜線。NFKC 後全形逗號／分號／斜線已變半形，兩種都列出嚟 */
const WORD_SEP = /[\s,，、;；/／]+/;
/* 詞語同提示句之間嘅分隔符：全形「｜」同半形「|」都接受（英文鍵盤多數只打到半形） */
const HINT_SEP = /[|｜]/;

const $app = document.getElementById('app');
const $fx = document.getElementById('fx');
const $live = document.getElementById('srLive');   // 獨立 live region（視覺隱藏），#app 本身唔係 live

/* ---------- 資料儲存 ---------- */
let loadNotice = '';   // 載入時有資料讀唔到：啟動畫好畫面後用 toast 通知

/* 將原始字串另存一份，存做 { backups: [{ savedAt, raw }, ...] }（舊到新），最多 BACKUP_MAX 份。
   同一份原始資料唔會重複寫（保留第一次嘅時間）；超過上限就丟最舊嗰份。
   舊格式 { savedAt, raw } 會轉做第一份；讀唔明嘅舊內容原封不動搬去 _legacy，唔會靜靜雞刪走。
   儲存空間唔夠就由最舊開始丟，直到淨返新嗰份都寫唔入先返回 false。成功返回 true */
function backupRaw(raw) {
  try {
    let list = [];
    const old = localStorage.getItem(BACKUP_KEY);
    if (old) {
      let parsed = null;
      try { parsed = JSON.parse(old); } catch (e) { /* 讀唔明，下面搬走 */ }
      if (isObj(parsed) && Array.isArray(parsed.backups)) {
        list = parsed.backups;
      } else if (isObj(parsed) && typeof parsed.raw === 'string') {
        list = [{ savedAt: parsed.savedAt, raw: parsed.raw }];   // 舊格式：轉做第一份
      } else {
        let legacyKey = BACKUP_KEY + '_legacy';
        const prev = localStorage.getItem(legacyKey);
        if (prev !== null && prev !== old) legacyKey += '_' + Date.now();   // 唔好蓋咗之前搬走嗰份
        localStorage.setItem(legacyKey, old);
      }
    }
    if (list.some(function (b) { return isObj(b) && b.raw === raw; })) return true;
    list.push({ savedAt: new Date().toISOString(), raw: raw });
    while (list.length > BACKUP_MAX) list.shift();
    for (;;) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify({ backups: list }));
        return true;
      } catch (e) {
        if (list.length <= 1) return false;
        list.shift();   // 寫唔入：丟最舊嗰份騰位再試
      }
    }
  } catch (e) {
    return false;
  }
}

/* 載入唔會靜靜雞清空資料：只略過唔完整嘅同學；有資料讀唔到就先備份原始字串，再提示用家 */
function loadDB() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* 瀏覽器唔畀讀，當作冇資料 */ }
  if (!raw) return { students: [], currentId: null, lastBackupAt: null, parentPin: null };
  let data = null;
  try { data = normaliseDB(JSON.parse(raw), true); } catch (e) { /* JSON 壞咗或者搵唔到同學資料 */ }
  if (!data || data.dropped) {
    const saved = backupRaw(raw);
    loadNotice = (data ? '有 ' + data.dropped + ' 位同學嘅資料讀唔到，已經略過。' : '資料讀唔到，而家由空白開始。') +
      (saved ? '原始資料已經另外備份咗。' : '而且備份唔到原始資料，可能係儲存空間唔夠。');
  }
  if (!data) return { students: [], currentId: null, lastBackupAt: null, parentPin: null };
  return { students: data.students, currentId: data.currentId, lastBackupAt: data.lastBackupAt, parentPin: data.parentPin };   // 唔好將 dropped 存入 db
}

function saveDB() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('儲存唔到資料，請檢查瀏覽器設定');
  }
}

let db = loadDB();

/* 申請持久儲存：減低瀏覽器喺空間緊張時自動清走資料嘅機會（有支援先做，結果唔影響使用） */
(function requestPersist() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      const r = navigator.storage.persist();
      if (r && typeof r.catch === 'function') r.catch(function () { /* 俾拒絕或者出錯都冇所謂 */ });
    }
  } catch (e) { /* 唔支援就算 */ }
})();
let ui = {
  view: 'home',
  form: { name: '', grade: 1, avatar: AVATARS[0] },
  editLessonId: null,
  setup: null,
  quiz: null,
  share: null,   // 等緊確認加入嘅分享課文（已經 validateSharedLesson 清理過；唔存起）
  result: null,
  statTab: 'word',
  recordId: null,
  recordBack: 'history',
  voiceLang: null,       // 設定頁而家編輯緊邊個語言嘅聲音（只存記憶體，null = 跟預設朗讀語言）
  backupSnoozed: false,  // 撳咗「之後再講」：今次開 app 唔再提醒備份
  pinUntil: 0,           // 家長 PIN 解鎖到幾時（毫秒時間戳）；只存記憶體，重新整理即鎖
  printOpts: null,       // 列印練習紙選項（只存記憶體；null = 用 PRINT_DEFAULTS）
  print: null,           // 目前開住嘅列印預覽快照 { model }；null = 冇開
  clickGuardUntil: 0,    // performance.now() 時間戳：喺呢個時間之前忽略點擊（進入對答案／結果頁後防連點）
  lastInputKbd: false    // 最近一次操作係咪鍵盤（click 的 detail === 0 或 keydown）
};

/* ---------- 小工具 ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* 切換掣嘅 aria-pressed 屬性字串（on 係目前有冇揀中） */
function pressed(on) { return ' aria-pressed="' + (on ? 'true' : 'false') + '"'; }

function me() {
  return db.students.find(function (s) { return s.id === db.currentId; }) || null;
}

/* 輸入詞語時嘅標準化：NFKC 統一全形半形（ＡＢＣ → ABC）。
   「｜」（全形豎線）逃過 NFKC：NFKC 會將佢變成 |，但之後提示句功能（T5.1）要靠 ｜ 分隔詞語同提示句，所以逐段標準化再接返 */
function normaliseInput(text) {
  return String(text).split('｜').map(function (p) { return p.normalize('NFKC'); }).join('｜');
}

/* 提示句清理：非字串當冇；句內再有分隔符換成「，」（朗讀時停頓，唔會讀出「豎線」）；
   連續空白（包括換行）變一個空格；最多 HINT_MAX 個字 */
function cleanHint(x) {
  if (typeof x !== 'string') return '';
  const t = x.replace(/[|｜]/g, '，').replace(/\s+/g, ' ').trim();
  const cut = Array.from(t).slice(0, HINT_MAX).join('').trim();
  /* 冇任何文字或數字（例如只有「。」「，」）當冇提示句 */
  return /[\p{L}\p{N}]/u.test(cut) ? cut : '';
}

/* 解析課文輸入：返回 { words: [...], hints: { 詞語: 提示句 } }（hints 係無原型字典）。
   冇分隔符嘅行：照舊用 WORD_SEP 拆多個詞。
   有分隔符嘅行：只喺第一個「｜」／「|」拆開；左邊照舊拆詞，最後一個詞配提示句，前面嘅當普通詞語；
   右邊成段係提示句，唔再拆。左邊冇詞就成行略過；右邊清理後係空就當冇提示句。
   去重以詞語為準：位置跟第一次出現，提示句取第一個非空嘅 */
function parseLesson(text) {
  const seen = new Set();   // 用 Set：詞語係 constructor、__proto__ 都唔會撞到物件原型
  const words = [];
  const hints = Object.create(null);
  const add = function (w, hint) {
    if (!w) return;
    if (!seen.has(w)) { seen.add(w); words.push(w); }
    if (hint && !hints[w]) hints[w] = hint;
  };
  const split = function (s) {
    return s.split(WORD_SEP).map(function (w) { return w.replace(EDGE_PUNCT, '').trim(); }).filter(Boolean);
  };
  normaliseInput(text).split(/\r\n|\r|\n/).forEach(function (line) {
    const at = line.search(HINT_SEP);
    if (at === -1) { split(line).forEach(function (w) { add(w, ''); }); return; }
    const left = split(line.slice(0, at));
    if (!left.length) return;
    const hint = cleanHint(line.slice(at + 1));
    left.forEach(function (w, i) { add(w, i === left.length - 1 ? hint : ''); });
  });
  return { words: words, hints: hints };
}

/* ---------- 分享課文（T5.3） ----------
   分享文字：第一行「【課文】課文名」，之後一行一詞（有提示句寫成「詞語｜提示句」，即 lessonText）。
   分享連結：<頁面網址>#lesson=<分享文字嘅 UTF-8，URL-safe base64>。
   貼文字同開連結行同一條 parseSharedText → validateSharedLesson 路徑 */
const SHARE_HEAD = /^【課文】\s*(.*)$/;

function shareLessonText(l) {
  return '【課文】' + l.title + '\n' + lessonText(l);
}

/* 分享文字 → { title, words, hints }（未校驗長度，由 validateSharedLesson 負責）。
   第一個非空行係「【課文】」開頭就當課文名，其餘交畀 parseLesson；冇標題行就用「匯入課文」 */
function parseSharedText(text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  let at = 0;
  while (at < lines.length && !lines[at].trim()) at += 1;
  let title = '匯入課文';
  let rest = lines;
  const m = at < lines.length ? SHARE_HEAD.exec(lines[at].trim()) : null;
  if (m) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (t) title = Array.from(t).slice(0, TITLE_MAX).join('').trim();
    rest = lines.slice(at + 1);
  }
  const parsed = parseLesson(rest.join('\n'));
  return { title: title, words: parsed.words, hints: parsed.hints };
}

/* 文字 → URL-safe base64（UTF-8；+/ 換 -_，去 =） */
function encodeShare(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* URL-safe（或者一般）base64 → 文字；格式錯、超長、非法 UTF-8 一律 throw 畀用家睇嘅原因 */
function decodeShare(b64) {
  const s = String(b64).trim();
  if (s.length > SHARE_PAYLOAD_MAX) throw new Error('分享內容太長（連結最多 ' + SHARE_PAYLOAD_MAX + ' 個字元）');
  if (!/^[A-Za-z0-9_\-+/]*={0,2}$/.test(s)) throw new Error('連結格式唔正確');
  const std = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  let bin;
  try { bin = atob(std + '==='.slice((std.length + 3) % 4)); } catch (e) { throw new Error('連結格式唔正確'); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { throw new Error('連結內容讀唔到（文字編碼唔正確）'); }
}

/* 分享文字 → 已清理嘅課文 { id, title, words, hints }；唔合格 throw。
   超長一律拒收（唔截短，免得靜靜雞丟資料）；詞語同提示句交畀 parseLesson／cleanLessons（同 T1.2 同一條校驗） */
function validateSharedLesson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('冇內容，請貼上分享嘅課文');
  if (text.length > SHARE_TEXT_MAX) throw new Error('課文太長（最多 ' + SHARE_TEXT_MAX + ' 個字）');
  const p = parseSharedText(text);
  if (!p.words.length) throw new Error('呢段內容入面搵唔到詞語');
  if (p.words.length > SHARE_WORDS_MAX) throw new Error('詞語太多（一課最多 ' + SHARE_WORDS_MAX + ' 個）');
  const longW = p.words.find(function (w) { return Array.from(w).length > WORD_MAX; });
  if (longW !== undefined) throw new Error('有詞語太長（最多 ' + WORD_MAX + ' 個字）：' + Array.from(longW).slice(0, 10).join('') + '…');
  const out = cleanLessons([{ id: uid(), title: p.title, words: p.words, hints: p.hints }]);
  if (!out.length) throw new Error('呢段內容唔係有效嘅課文');
  return out[0];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function p2(n) { return String(n).padStart(2, '0'); }

function dayKey(iso) {
  const d = new Date(iso);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function dayLabel(iso) {
  const d = new Date(iso);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEKDAYS[d.getDay()];
}
function timeLabel(iso) {
  const d = new Date(iso);
  return p2(d.getHours()) + ':' + p2(d.getMinutes());
}
function shortDate(iso) {
  const d = new Date(iso);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

/* 將詞語逐字顯示，bad 入面嘅位置用紅色標示 */
function charsHtml(word, bad) {
  bad = bad || [];
  return Array.from(word).map(function (c, i) {
    return bad.indexOf(i) !== -1 ? '<em class="badc">' + esc(c) + '</em>' : esc(c);
  }).join('');
}

/* ---------- 資料校驗（載入 localStorage 同匯入備份行同一條路） ---------- */
function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
function hasKey(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

/* 數字欄位：只接受數字或者數字字串，其他（HTML、null、空字串）一律當無效 */
function numOr(x, fallback) {
  if (typeof x !== 'number' && !(typeof x === 'string' && x.trim() !== '')) return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

/* 詞語：逐個轉字串、trim、去空、去重 */
function cleanWords(list) {
  const seen = new Set();
  const out = [];
  list.forEach(function (w) {
    if (typeof w !== 'string' && typeof w !== 'number') return;
    const t = String(w).trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out;
}

/* 提示句對照表：只保留 words 入面有嘅詞，清理後非空先保留。返回無原型字典 */
function cleanHints(obj, words) {
  const out = Object.create(null);
  if (!isObj(obj)) return out;
  words.forEach(function (w) {
    if (!hasKey(obj, w)) return;
    const h = cleanHint(obj[w]);
    if (h) out[w] = h;
  });
  return out;
}

/* app 儲存課文時最少要有一個詞（saveLesson 會檢查），清理後冇詞語嘅只可能係損壞資料，直接剔走。
   l.hints（提示句對照表）：舊資料冇就係空表。
   遷移：T2.6 之後、T5.1 之前儲存嘅課文，詞語可能包含「｜」／「|」（例如「公園 | 我們去公園玩耍」當咗一個詞），
   喺第一個分隔符拆成詞語同提示句；課文原有嘅 hints 優先 */
function cleanLessons(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (l) {
    return isObj(l) && typeof l.id === 'string' && typeof l.title === 'string' && Array.isArray(l.words);
  }).map(function (l) {
    const migrated = Object.create(null);
    const raw = l.words.map(function (w) {
      if (typeof w !== 'string') return w;
      const at = w.search(HINT_SEP);
      if (at === -1) return w;
      const word = w.slice(0, at).replace(EDGE_PUNCT, '').trim();
      if (word && !migrated[word]) migrated[word] = w.slice(at + 1);
      return word;
    });
    l.words = cleanWords(raw);
    const merged = Object.create(null);
    const own = isObj(l.hints) ? l.hints : null;
    l.words.forEach(function (w) {
      if (own && hasKey(own, w) && cleanHint(own[w])) merged[w] = own[w];
      else if (migrated[w]) merged[w] = migrated[w];
    });
    l.hints = cleanHints(merged, l.words);
    return l;
  }).filter(function (l) { return l.words.length > 0; });
}

/* 舊紀錄冇 planned／incomplete，當作已完成 */
function cleanHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (h) {
    return isObj(h) && typeof h.date === 'string' && !isNaN(Date.parse(h.date)) &&
      !isNaN(numOr(h.correct, NaN)) && !isNaN(numOr(h.total, NaN));
  }).map(function (h) {
    h.id = typeof h.id === 'string' && h.id ? h.id : uid();
    h.total = numOr(h.total, 0);
    h.correct = Math.min(numOr(h.correct, 0), h.total);
    h.label = typeof h.label === 'string' ? h.label : String(h.label == null ? '' : h.label);
    h.lang = h.lang === 'cmn' ? 'cmn' : 'yue';
    h.mode = h.mode === 'timed' || h.mode === 'self' ? h.mode : 'normal';   // 只接受白名單；'normal' = 已移除嘅舊方式，只作舊紀錄標記（唔顯示標籤），舊紀錄、惡意值一律當 'normal'
    h.incomplete = h.incomplete === true;
    h.planned = h.incomplete ? Math.max(h.total, numOr(h.planned, h.total)) : h.total;
    h.wrong = Array.isArray(h.wrong) ? cleanWords(h.wrong) : [];
    if (Array.isArray(h.results)) {
      h.results = h.results.filter(function (r) {
        return isObj(r) && (typeof r.word === 'string' || typeof r.word === 'number');
      }).map(function (r) {
        const bad = Array.isArray(r.bad) ? r.bad.filter(function (i) { return Number.isInteger(i) && i >= 0; }) : [];
        return { word: String(r.word), ok: r.ok === true, bad: bad };
      });
    } else {
      delete h.results;   // 舊版紀錄：只用 wrong
    }
    return h;
  });
}

/* 統計字典：只保留物件值，數字欄位強制轉數字。
   返回無原型字典（Object.create(null)）：詞語係 constructor、__proto__ 都只係普通 key */
function cleanStats(obj, fields) {
  const out = Object.create(null);
  if (!isObj(obj)) return out;
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (!isObj(v)) return;
    fields.forEach(function (f) { v[f] = numOr(v[f], 0); });
    out[k] = v;
  });
  return out;
}

/* 錯字怪獸：need／progress 要係有效數字先保留。同樣返回無原型字典 */
function cleanBank(obj) {
  const out = Object.create(null);
  if (!isObj(obj)) return out;
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (!isObj(v) || isNaN(numOr(v.need, NaN)) || isNaN(numOr(v.progress, NaN)) || !String(k).trim()) return;
    v.need = numOr(v.need, 1);
    v.progress = numOr(v.progress, 0);
    // 上次默對嘅時間（入庫後未默對過就係入庫時間）；舊資料冇此欄位 → null，排序時當最耐冇默對
    v.lastOkAt = cleanTimestamp(v.lastOkAt);
    out[k] = v;
  });
  return out;
}

/* 課文 id 清單（prefs.lastLessonIds）：只保留非空字串，去重，最多 50 個，每個最多 100 字元 */
function cleanIds(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach(function (x) {
    if (typeof x !== 'string' || !x || x.length > 100 || seen.has(x) || out.length >= 50) return;
    seen.add(x);
    out.push(x);
  });
  return out;
}

/* db.lastBackupAt：只接受可解析嘅日期字串，統一轉成 ISO；解析唔到、或者比而家遲過一日以上（時鐘錯亂，
   否則提醒會永遠唔出）就當作冇備份過（null） */
function cleanTimestamp(x) {
  if (typeof x !== 'string' || x.length > 40) return null;
  const t = Date.parse(x);
  if (!Number.isFinite(t) || t > Date.now() + DAY_MS) return null;
  return new Date(t).toISOString();
}

/* 聲音 id（prefs.voiceYue／voiceCmn／舊版 voiceURI）：只接受非空字串，最多 200 字元，否則當作「自動」（空字串） */
function cleanVoiceURI(x) {
  return typeof x === 'string' && x.length > 0 && x.length <= 200 ? x : '';
}

/* 定時默書設定（prefs.timed）：secs 係四級（2 字或以下／3／4／5+）停留秒數，reads 係每個詞語朗讀次數。
   任何型別錯誤、超出範圍都夾返或回退預設；輸出係新物件，多餘欄位一律丟棄；唔 throw */
function cleanTimedPrefs(x) {
  const t = isObj(x) ? x : {};
  const raw = Array.isArray(t.secs) ? t.secs : [];
  const secs = TIMED_SECS_DEFAULT.map(function (d, i) {
    const n = numOr(raw[i], NaN);   // numOr 已擋非數字／NaN／Infinity，並把負數變 0
    return Number.isFinite(n) ? Math.min(TIMED_SECS_MAX, Math.max(TIMED_SECS_MIN, Math.round(n))) : d;
  });
  const r = numOr(t.reads, NaN);
  return { secs: secs, reads: Number.isInteger(r) && r >= 1 && r <= TIMED_READS_MAX ? r : TIMED_READS_DEFAULT };
}

/* 朗讀語言對應嘅聲音欄位：廣東話 voiceYue、普通話 voiceCmn（LANGS 只有兩個語言） */
function voicePrefKey(langKey) { return langKey === 'yue' ? 'voiceYue' : 'voiceCmn'; }

/* ---------- 家長 PIN（T5.4） ----------
   只係防止小朋友誤撳，唔係真正保安：4 位數字只有一萬種組合。
   純 JS 同步 SHA-256（唔用 crypto.subtle：佢只喺 HTTPS／localhost 有，
   如果 PIN 喺 https 設定、之後用 file:// 開就驗證唔到，會鎖死用家）。 */
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const bitLen = bytes.length * 8;
  const total = (bytes.length + 9 + 63) & ~63;   // 補 0x80、至少 8 byte 長度，湊夠 64 byte 倍數
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(total - 4, bitLen >>> 0, false);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Array(64);
  const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
}

function randomHex(nBytes) {
  const out = new Uint8Array(nBytes);
  try { crypto.getRandomValues(out); }
  catch (e) { for (let i = 0; i < nBytes; i++) out[i] = Math.floor(Math.random() * 256); }
  return Array.prototype.map.call(out, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}

/* 建立 PIN 紀錄：{ v, salt(32 位 hex), hash(64 位 hex) }，hash = SHA-256(salt + ':' + pin)；冇明文 PIN */
function makePin(pin) {
  const salt = randomHex(16);
  return { v: 1, salt: salt, hash: sha256Hex(salt + ':' + pin) };
}

function checkPin(rec, pin) {
  return !!rec && sha256Hex(rec.salt + ':' + String(pin)) === rec.hash;
}

/* 讀外來 parentPin：格式唔啱一律當冇 PIN（null） */
function cleanPin(x) {
  if (!isObj(x) || x.v !== 1) return null;
  if (typeof x.salt !== 'string' || !/^[0-9a-f]{16,64}$/i.test(x.salt)) return null;
  if (typeof x.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(x.hash)) return null;
  return { v: 1, salt: x.salt.toLowerCase(), hash: x.hash.toLowerCase() };
}

function pinUnlocked() { return Date.now() < ui.pinUntil; }
function unlockPin() { ui.pinUntil = Date.now() + PIN_UNLOCK_MS; }
function lockPin() { ui.pinUntil = 0; }

function normaliseStudent(st) {
  st.id = String(st.id);
  st.name = String(st.name);
  st.lessons = cleanLessons(st.lessons);
  st.wordStats = cleanStats(st.wordStats, ['attempts', 'wrong', 'bankEntries']);
  st.charStats = cleanStats(st.charStats, ['attempts', 'wrong']);
  st.bank = cleanBank(st.bank);
  st.history = cleanHistory(st.history);
  const pf = isObj(st.prefs) ? st.prefs : {};
  const speed = hasKey(SPEEDS, pf.speed) ? pf.speed : 'normal';
  st.prefs = {
    order: pf.order === 'random' ? 'random' : 'seq',
    lang: hasKey(LANGS, pf.lang) ? pf.lang : 'yue',
    speed: speed,
    hintSpeed: hasKey(SPEEDS, pf.hintSpeed) ? pf.hintSpeed : speed,   // 提示句速度；舊資料／舊備份冇此欄位就跟朗讀速度
    lastLessonIds: cleanIds(pf.lastLessonIds),   // 上次默書揀嘅課文
    voiceYue: cleanVoiceURI(pf.voiceYue),        // 廣東話揀咗嘅朗讀聲音；空 = 自動
    voiceCmn: cleanVoiceURI(pf.voiceCmn),        // 普通話揀咗嘅朗讀聲音；空 = 自動
    voiceURI: cleanVoiceURI(pf.voiceURI),        // 舊版單一聲音；待 migrateLegacyVoice 按聲音語言遷到 voiceYue／voiceCmn，遷完清空
    shortcuts: pf.shortcuts !== false,           // 默書鍵盤快捷鍵；只有明確 false 先關，舊資料／舊備份冇此欄位當開
    timed: cleanTimedPrefs(pf.timed)             // 定時默書設定；舊資料／舊備份冇此欄位就用預設
  };
  st.grade = Math.min(6, Math.max(1, Math.round(Number(st.grade)) || 1));
  st.avatar = AVATARS.indexOf(st.avatar) !== -1 ? st.avatar : AVATARS[0];
  return st;
}

/* 成功：返回 { students, currentId, dropped }。
   lenient（只有載入 localStorage 用）：唔完整嘅同學會略過，dropped 係略過咗幾多位；
   冇 lenient（匯入備份）：有一位唔完整就 throw，message 係畀用家睇嘅原因 */
function normaliseDB(data, lenient) {
  if (!isObj(data) || !Array.isArray(data.students)) throw new Error('搵唔到同學資料');
  const students = [];
  let dropped = 0;
  data.students.forEach(function (st, i) {
    if (!isObj(st) || !st.id || !st.name) {
      if (!lenient) throw new Error('第 ' + (i + 1) + ' 位同學資料唔完整');
      dropped += 1;
      return;
    }
    if (!lenient) { students.push(normaliseStudent(st)); return; }
    try { students.push(normaliseStudent(st)); } catch (e) { dropped += 1; }
  });
  const ids = students.map(function (st) { return st.id; });
  return {
    students: students,
    currentId: ids.indexOf(data.currentId) !== -1 ? data.currentId : null,
    lastBackupAt: cleanTimestamp(data.lastBackupAt),   // 舊資料、舊備份冇此欄位 → null
    parentPin: cleanPin(data.parentPin),               // 冇此欄位 = 冇 PIN。注意：匯入備份時呼叫者會明確忽略呢個值
    dropped: dropped
  };
}

/* 合併還原：將備份（incoming，已經 normaliseDB 校驗）嘅資料併入現有資料（cur），唔刪任何現有嘢。
   返回 { students, added: { students, lessons, records, bank, conflicts } }。
   喺深複製上做，任何一步 throw 都唔會影響 cur（原子）；呼叫者成功後先將 students 寫返 db。
   規則：
   1. 同學按 id 對應；備份有、現有冇＝原樣加入；現有有、備份冇＝唔掂。唔按名字對應。
   2. 同 id 同學：名、年級、頭像、prefs 一律保留現有。
   3. 課文：內容（課文名＋詞語＋提示句）完全相同＝略過；同 id 但內容唔同＝保留現有，備份版另存新 id、課文名加「（合併）」；其餘加入。
   4. 紀錄：按 id 只加現有冇嘅，按日期排序，超過 HISTORY_MAX 丟最舊（丟咗嘅唔入、唔計統計）；
      只重播新加入紀錄嘅統計，現有統計絕不覆蓋、不重複計。
   5. 錯字怪獸：只加現有冇嘅字，現有條目保留。 */
function mergeDB(cur, incoming) {
  const clone = function (students) {
    return normaliseDB(JSON.parse(JSON.stringify({ students: students }))).students;
  };
  const work = clone(cur.students);
  const inc = clone(incoming.students);
  const added = { students: 0, lessons: 0, records: 0, bank: 0, conflicts: 0 };
  const lessonKey = function (l) { return l.title + '\n' + lessonText(l); };
  const byId = new Map();
  work.forEach(function (st) { byId.set(st.id, st); });

  inc.forEach(function (is) {
    const cs = byId.get(is.id);
    if (!cs) {
      work.push(is);
      byId.set(is.id, is);
      added.students += 1;
      added.lessons += is.lessons.length;
      added.records += is.history.length;
      added.bank += Object.keys(is.bank).length;
      return;
    }
    // 課文
    const keys = new Set(cs.lessons.map(lessonKey));
    is.lessons.forEach(function (l) {
      if (keys.has(lessonKey(l))) return;
      let add = l;
      if (cs.lessons.some(function (x) { return x.id === l.id; })) {
        const t = Array.from(l.title).slice(0, TITLE_MAX - 4).join('') + '（合併）';
        add = { id: uid(), title: t, words: l.words, hints: l.hints };
        if (keys.has(lessonKey(add))) return;   // 上次合併已經另存過
        added.conflicts += 1;
      }
      cs.lessons.push(add);
      keys.add(lessonKey(add));
      added.lessons += 1;
    });
    // 紀錄
    const hids = new Set(cs.history.map(function (h) { return h.id; }));
    const fresh = is.history.filter(function (h) {
      if (hids.has(h.id)) return false;
      hids.add(h.id);
      return true;
    });
    if (fresh.length) {
      const all = cs.history.concat(fresh).sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); });
      const keep = all.slice(Math.max(0, all.length - HISTORY_MAX));
      const kept = new Set(keep);
      fresh.forEach(function (h) {
        if (!kept.has(h)) return;
        applyRecordStats(cs, h);
        added.records += 1;
      });
      cs.history = keep;
    }
    // 錯字怪獸
    Object.keys(is.bank).forEach(function (w) {
      if (hasKey(cs.bank, w)) return;
      cs.bank[w] = is.bank[w];
      added.bank += 1;
    });
  });
  return { students: work, added: added };
}

function newStudent(name, grade, avatar) {
  return normaliseStudent({ id: uid(), name: name, grade: grade, avatar: avatar });
}

/* ---------- 畫面切換 ---------- */
const timers = { speak: null, run: null };

function clearTimers() {
  clearTimeout(timers.run);
  timers.run = null;
  clearTimeout(timers.speak);
  timers.speak = null;
}

function stopSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function go(view) {
  if (ui.view === 'quiz' && view !== 'quiz') { clearTimers(); stopSpeech(); }
  if (ui.view === 'lessonEdit' && view !== 'lessonEdit') lockPin();   // 離開課文編輯頁（儲存、返回、換人…）即鎖，PIN 只管一個編輯階段
  if (view === 'settings' && ui.view !== 'settings') ui.voiceLang = null;   // 進入設定頁：聲音編輯語言重設為跟預設朗讀語言
  ui.view = view;
  render();
  window.scrollTo(0, 0);
}

/* ---------- 朗讀 ---------- */
let voices = [];
let speechUnlocked = false;
let currentUtterance = null;

function refreshVoices() {
  if ('speechSynthesis' in window) voices = window.speechSynthesis.getVoices() || [];
}
if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', function () {
    refreshVoices();
    migrateLegacyVoice(me());
    if (ui.view === 'settings') updateVoiceNotice();
  });
}

/* 符合朗讀語言嘅聲音，按優先次序排好（自動揀聲音就係攞第一個）。
   廣東話：zh-HK／yue；普通話：zh-CN → cmn → zh-TW → 其他 zh（唔包括 zh-HK） */
function voicesFor(langKey) {
  const norm = function (v) { return (v.lang || '').replace('_', '-'); };
  const tiers = langKey === 'yue'
    ? [/^(zh-HK|yue)/i]
    : [/^zh-CN/i, /^cmn/i, /^zh-TW/i, null];
  const out = [];
  tiers.forEach(function (re) {
    voices.forEach(function (v) {
      const ok = re ? re.test(norm(v)) : (/^zh/i.test(norm(v)) && !/^zh-HK/i.test(norm(v)));
      if (ok && out.indexOf(v) === -1) out.push(v);
    });
  });
  return out;
}

function voiceId(v) { return v.voiceURI || v.name || ''; }

/* 舊版單一聲音（prefs.voiceURI）遷到 voiceYue／voiceCmn：按嗰把聲音屬邊個語言決定。
   聲音清單未載入、或者呢部機搵唔到嗰把聲音：保留舊值唔掂，等之後有聲音再遷，唔丟資料。
   新欄位已有值就以新值為準 */
function migrateLegacyVoice(s) {
  const pf = s && s.prefs;
  if (!pf || !pf.voiceURI || !voices.length) return;
  const inList = function (k) { return voicesFor(k).some(function (v) { return voiceId(v) === pf.voiceURI; }); };
  const k = inList('yue') ? 'yue' : inList('cmn') ? 'cmn' : '';
  if (!k) return;
  const f = voicePrefKey(k);
  if (!pf[f]) pf[f] = pf.voiceURI;
  pf.voiceURI = '';
  saveDB();
}

/* 先用同學為呢個語言揀咗嘅聲音（廣東話 prefs.voiceYue／普通話 prefs.voiceCmn，只喺該語言適用聲音內搵）；搵唔到就用自動揀嘅 */
function pickVoice(langKey) {
  const list = voicesFor(langKey);
  const s = me();
  migrateLegacyVoice(s);
  const uri = s && s.prefs ? s.prefs[voicePrefKey(langKey)] : '';
  if (uri) {
    const chosen = list.find(function (v) { return voiceId(v) === uri; });
    if (chosen) return chosen;
  }
  return list[0] || null;
}

/* hooks: { onstart, onend }，只有最新一句會觸發，避免被 cancel 嘅舊句影響 */
function speak(text, langKey, rate, hooks) {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(langKey);
  if (v) { u.voice = v; u.lang = v.lang; }
  else { u.lang = langKey === 'yue' ? 'zh-HK' : 'zh-CN'; }
  u.rate = rate;
  if (hooks) {
    const finish = function () {
      if (currentUtterance === u && hooks.onend) hooks.onend();
    };
    u.onstart = function () {
      if (currentUtterance === u && hooks.onstart) hooks.onstart();
    };
    u.onend = finish;
    u.onerror = finish;
  }
  currentUtterance = u; // 保留引用，避免瀏覽器提早回收而收唔到 onend
  synth.speak(u);
}

/* iOS Safari 要喺用戶點擊時先可以開始朗讀，所以喺第一次點擊時播一句無聲嘅 */
function unlockSpeech() {
  if (speechUnlocked || !('speechSynthesis' in window)) return;
  speechUnlocked = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

function voiceWarning(langKey) {
  if (!('speechSynthesis' in window)) {
    return '呢個瀏覽器唔支援朗讀，請轉用 Chrome、Edge 或 Safari。';
  }
  if (!pickVoice(langKey)) {
    return langKey === 'yue'
      ? '呢部機暫時搵唔到廣東話語音。可以試吓按「試聽」，或者請家長安裝廣東話語音（方法見下面），又或者轉用普通話。'
      : '呢部機暫時搵唔到普通話語音，請家長安裝語音（方法見下面）。';
  }
  return '';
}

/* 裝置類型：iOS（包括偽裝成 Mac 嘅 iPad）、Android，其他當桌面 */
function devicePlatform() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/* 搵唔到語音時嘅安裝教學（各品牌選單名稱可能略有不同） */
function voiceHelp(langKey) {
  const lang = langKey === 'yue' ? '粵語（香港）' : '普通話';
  const p = devicePlatform();
  if (p === 'ios') {
    return 'iPhone／iPad：打開「設定」›「輔助使用」›「語音內容」›「聲音」，揀' + lang + '，再下載語音。';
  }
  if (p === 'android') {
    return 'Android：打開系統設定，搵「文字轉語音」（可能放喺「語言和輸入」入面），揀「Google 文字轉語音」，再安裝' + lang + '語言包。';
  }
  return '請家長喺電腦或手機嘅系統設定安裝' + lang + '語音（iPhone／iPad：設定 › 輔助使用 › 語音內容；Android：文字轉語音設定），安裝後重新整理頁面。';
}

/* 設定頁嘅語音提示：警告原因 + 安裝教學（支援朗讀但冇聲音時先有教學） */
function voiceNoticeHtml(langKey) {
  const w = voiceWarning(langKey);
  if (!w) return '';
  const help = 'speechSynthesis' in window ? '<br><small>' + esc(voiceHelp(langKey)) + '</small>' : '';
  return '<div class="notice">⚠️ ' + esc(w) + help + '</div>';
}

/* 設定頁而家編輯緊邊個語言嘅聲音：用家喺下拉選單揀過就跟佢，否則跟預設朗讀語言 */
function voiceLangKey(s) { return hasKey(LANGS, ui.voiceLang) ? ui.voiceLang : s.prefs.lang; }

/* 聲音設定：先揀語言（廣東話／普通話），再揀嗰個語言嘅聲音（自動 + 符合該語言嘅聲音）。
   該語言冇聲音可揀就唔畫聲音選單，但語言下拉照樣可用 */
function voicePickerHtml(s) {
  if (!('speechSynthesis' in window)) return '';
  refreshVoices();
  migrateLegacyVoice(s);
  const lk = voiceLangKey(s);
  const langOpts = Object.keys(LANGS).map(function (k) {
    return '<option value="' + esc(k) + '"' + (k === lk ? ' selected' : '') + '>' + esc(LANGS[k].label) + '</option>';
  });
  const head = '<label class="field-label" for="voiceLang">朗讀聲音語言</label>' +
    '<select id="voiceLang" class="voice-select">' + langOpts.join('') + '</select>';
  const list = voicesFor(lk);
  if (!list.length) return head + '<p class="muted" style="margin-top:8px">呢個語言暫時冇可揀嘅聲音。</p>';
  const cur = s.prefs[voicePrefKey(lk)];
  const opts = ['<option value=""' + (cur ? '' : ' selected') + '>自動（建議）</option>'].concat(list.map(function (v) {
    const id = voiceId(v);
    return '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' + esc(v.name + '（' + v.lang + '）') + '</option>';
  }));
  return head + '<label class="field-label" for="voiceSelect">朗讀聲音（' + esc(LANGS[lk].label) + '）</label>' +
    '<select id="voiceSelect" class="voice-select">' + opts.join('') + '</select>';
}

/* 強制重畫聲音設定（語言下拉改變時用）；焦點還給語言下拉 */
function renderVoicePicker() {
  const s = me();
  if (!s) return;
  const pick = document.getElementById('voicePicker');
  if (pick) pick.innerHTML = voicePickerHtml(s);
  const box = document.getElementById('voiceNotice');
  if (box) box.innerHTML = voiceNoticeHtml(voiceLangKey(s));
  const sel = document.getElementById('voiceLang');
  if (sel) sel.focus();
}

function updateVoiceNotice() {
  const s = me();
  if (!s) return;
  const box = document.getElementById('voiceNotice');
  if (box) box.innerHTML = voiceNoticeHtml(voiceLangKey(s));
  // 聲音清單隨語言改變、或者系統稍後先載入聲音（voiceschanged）而更新；用家正喺度揀嗰陣唔好打斷
  const pick = document.getElementById('voicePicker');
  const active = document.activeElement;
  const busy = active === document.getElementById('voiceSelect') || active === document.getElementById('voiceLang');
  if (pick && !busy) pick.innerHTML = voicePickerHtml(s);
}

/* ---------- 特效 ---------- */
/* ms（可選）：顯示幾耐，較長嘅訊息用；冇傳就同以前一樣 2.5 秒 */
function toast(msg, ms) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  if (ms) el.style.animationDuration = (ms - 100) + 'ms';
  // 先插入空嘅 live region（要留喺無障礙樹，唔可以 visibility:hidden），約 50ms 後先填字，讀屏軟件先會公佈
  document.body.appendChild(el);
  setTimeout(function () { el.textContent = msg; }, 50);
  setTimeout(function () { el.remove(); }, ms || 2500);
}

/* 公佈狀態畀讀屏軟件（第 3 / 12 題、答啱咗）。先清空再延遲填字，同一句連續出現都會再讀 */
let announceTimer = null;
function announce(msg) {
  if (!$live) return;
  clearTimeout(announceTimer);
  $live.textContent = '';
  announceTimer = setTimeout(function () { $live.textContent = msg; }, 60);
}

function confetti(count) {
  const bits = ['⭐', '🎉', '🎈', '🌟', '🍭', '✨'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'confetti';
    el.textContent = pick(bits);
    el.style.left = Math.random() * 100 + 'vw';
    el.style.fontSize = (16 + Math.random() * 22) + 'px';
    el.style.animationDuration = (2 + Math.random() * 2.2) + 's';
    el.style.animationDelay = (Math.random() * 0.8) + 's';
    $fx.appendChild(el);
    setTimeout(function () { el.remove(); }, 5500);
  }
}

/* 撳落按鈕時嘅水波紋 */
document.addEventListener('pointerdown', function (e) {
  const t = e.target.closest('.btn, .menu-btn, .chip:not(.word), .student-card, .speaker, .lang-btn, .rec-main, .icon-btn');
  if (!t || t.disabled) return;
  const r = t.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = d + 'px';
  s.style.left = (e.clientX - r.left - d / 2) + 'px';
  s.style.top = (e.clientY - r.top - d / 2) + 'px';
  t.appendChild(s);
  setTimeout(function () { s.remove(); }, 650);
});

/* ---------- 確認框 ----------
   opts: { icon, title, text, okText, danger }；撳確定先會執行 onOk
   onCancel（可選）：撳取消、撳背景或者 Esc 關閉時執行
   可選擴充（共用 dialog，現有呼叫唔使理）：
   - bodyHtml：插喺說明文字後面嘅 HTML。呼叫者要自己確保裡面所有資料值已經 esc() 過
   - single：只出一粒確定掣（Esc／背景＝關閉，會執行 onCancel）
   - altText＋onAlt：第三粒掣（data-m="alt"），三粒掣時直向排
   - validate(back)：撳確定／輸入框內撳 Enter 時先行；回傳 true 先關閉並執行 onOk，
     回傳字串＝顯示喺 .field-error[role=alert]，dialog 不關，焦點返去第一個輸入框
   - focusSel：開框時嘅初始焦點（預設係取消掣）
   - wide：寬版 dialog（.modal 加 print-modal class，列印預覽用）
   - keepOpen：撳確定時唔關框，只執行 onOk(back)（唔經 validate）；關閉一律走取消／Esc／背景＝onCancel
   - onOpen(back)：dialog 加入頁面同初始焦點之後執行一次 */
function confirmBox(opts, onOk, onCancel) {
  const opener = document.activeElement;   // 開框前嘅焦點，關閉時還原
  const back = document.createElement('div');
  back.className = 'modal-back';
  const okBtn = '<button class="btn ' + (opts.danger ? 'red' : 'green') + '" data-m="yes">' + esc(opts.okText || '確定') + '</button>';
  const altBtn = opts.altText ? '<button class="btn ghost" data-m="alt">' + esc(opts.altText) + '</button>' : '';
  const noBtn = '<button class="btn ghost" data-m="no">取消</button>';
  const btns = opts.single ? okBtn : opts.altText ? okBtn + altBtn + noBtn : noBtn + okBtn;
  back.innerHTML =
    '<div class="modal' + (opts.wide ? ' print-modal' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
    '<div class="m-ico">' + (opts.icon || '❓') + '</div>' +
    '<h3>' + esc(opts.title) + '</h3><p>' + esc(opts.text || '') + '</p>' +
    (opts.bodyHtml || '') +
    (opts.validate ? '<div class="field-error" role="alert" hidden></div>' : '') +
    '<div class="two-btns' + (opts.single ? ' one' : opts.altText ? ' three' : '') + '">' + btns +
    '</div></div>';

  /* Tab／Shift+Tab 只喺框內可操作元素（按鈕、輸入框、summary、連結）之間循環；焦點跑咗出框（例如撳咗空白位）就拉返入框 */
  function trapTab(e) {
    const btns = Array.prototype.filter.call(
      back.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, summary, a[href]'),
      function (x) { return x.getClientRects().length > 0; }
    );
    if (!btns.length) return;
    const first = btns[0];
    const last = btns[btns.length - 1];
    const cur = document.activeElement;
    if (!back.contains(cur)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }
  function onKey(e) {
    // 按住 Enter／空白會連發 keydown：忽略，避免關框後焦點還原到開框掣，再被重覆鍵打開
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return; }
    if (e.key === 'Escape') dismiss();
    else if (e.key === 'Tab') trapTab(e);
    else if (e.key === 'Enter' && opts.validate && !e.isComposing && e.target && e.target.tagName === 'INPUT' && back.contains(e.target)) {
      e.preventDefault();   // 輸入框內撳 Enter ＝ 撳確定
      submit();
    }
  }
  /* 有 validate：未通過就喺框內顯示原因，唔關框 */
  function submit() {
    if (opts.keepOpen) { onOk(back); return; }
    if (opts.validate) {
      const r = opts.validate(back);
      if (r !== true) {
        const err = back.querySelector('.field-error');
        const inp = back.querySelector('input, textarea');
        if (err) { err.textContent = String(r || ''); err.hidden = false; }
        if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
        return;
      }
    }
    close();
    onOk();
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    back.remove();
    // 還原焦點；原本嗰粒掣已經唔喺頁面（畫面重畫過）就唔處理，由 render 決定焦點
    if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') {
      opener.focus({ preventScroll: true });
    }
    // dialog 開住期間收到分享連結（hashchange）會暫時唔彈預覽；關咗之後補彈（onOk／onCancel 之後先行，有新 dialog 就唔彈）
    if (ui.share) setTimeout(pumpShare, 0);
  }
  function dismiss() {
    close();
    if (onCancel) onCancel();
  }

  back.addEventListener('click', function (e) {
    const b = e.target.closest('[data-m]');
    if (b) {
      if (b.dataset.m === 'yes') submit();
      else if (b.dataset.m === 'alt') { close(); if (opts.onAlt) opts.onAlt(); }
      else dismiss();
    } else if (e.target === back) {
      dismiss();
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  const first = (opts.focusSel && back.querySelector(opts.focusSel)) || back.querySelector('[data-m=no]') || back.querySelector('[data-m=yes]');
  if (first) first.focus();
  if (opts.onOpen) opts.onOpen(back);
}

/* ---------- 錯字怪獸規則 ----------
   詞語第一次默錯 → 入庫，需要默對 1 次先剔走。
   剔走後再默錯 → 再入庫，需要默對 2 次，如此類推。
   無論喺課文模式或者錯字怪獸模式，只要默對，庫內詞語就減一次。
   已經喺庫內又默錯 → 顯示嘅「×N」（need - progress）加 1，已默對嘅次數歸零。
   lastOkAt：入庫時設為而家；喺庫內默對（未剔走）更新為而家；喺庫內默錯唔變。
   bad: 寫錯咗嘅字位置（0 開始）。新對答案恆有完整 bad（錯詞 ⇒ bad 非空）；
   舊紀錄 ok:false 而 bad 空 = 單字層面未知，略過。 */
function recordAnswer(s, word, ok, bad, quiz) {
  const now = new Date().toISOString();
  const st = s.wordStats[word] || (s.wordStats[word] = { attempts: 0, wrong: 0, bankEntries: 0 });
  st.attempts += 1;
  if (!ok) st.wrong += 1;

  if (ok || bad.length) {
    Array.from(word).forEach(function (ch, i) {
      if (/\s/.test(ch)) return;
      const cs = s.charStats[ch] || (s.charStats[ch] = { attempts: 0, wrong: 0 });
      cs.attempts += 1;
      if (!ok && bad.indexOf(i) !== -1) cs.wrong += 1;
    });
  }

  const inBank = s.bank[word];
  if (ok) {
    if (!inBank) return;
    inBank.progress += 1;
    if (inBank.progress >= inBank.need) {
      delete s.bank[word];
      quiz.removed.push(word);
    } else {
      inBank.lastOkAt = now;
      quiz.hurt.push({ word: word, left: inBank.need - inBank.progress });
    }
  } else if (inBank) {
    inBank.need = inBank.need - inBank.progress + 1;
    inBank.progress = 0;
  } else {
    st.bankEntries += 1;
    s.bank[word] = { need: st.bankEntries, progress: 0, lastOkAt: now };
    quiz.added.push(word);
  }
}

/* 刪除紀錄時，扣返嗰次嘅詞語同單字統計。錯字怪獸唔受影響 */
function undoStats(s, rec) {
  const dec = function (obj, key, wrong) {
    const st = obj[key];
    if (!st) return;
    st.attempts = Math.max(0, st.attempts - 1);
    if (wrong) st.wrong = Math.max(0, st.wrong - 1);
  };
  if (!rec.results) { // 舊版紀錄只知道錯咗邊啲詞語
    (rec.wrong || []).forEach(function (w) { dec(s.wordStats, w, true); });
    return;
  }
  rec.results.forEach(function (r) {
    dec(s.wordStats, r.word, !r.ok);
    const bad = r.bad || [];
    if (r.ok || bad.length) {
      Array.from(r.word).forEach(function (ch, i) {
        if (/\s/.test(ch)) return;
        dec(s.charStats, ch, !r.ok && bad.indexOf(i) !== -1);
      });
    }
  });
}

/* 合併還原時，將新加入嘅一次紀錄計入詞語同單字統計（undoStats 嘅對稱版）。
   唔掂錯字怪獸，亦唔加 bankEntries（錯字怪獸入庫次數只靠真實默書累積） */
function applyRecordStats(s, rec) {
  const inc = function (obj, key, wrong) {
    const st = obj[key] || (obj[key] = { attempts: 0, wrong: 0 });
    st.attempts += 1;
    if (wrong) st.wrong += 1;
  };
  const incWord = function (key, wrong) {
    const st = s.wordStats[key] || (s.wordStats[key] = { attempts: 0, wrong: 0, bankEntries: 0 });
    st.attempts += 1;
    if (wrong) st.wrong += 1;
  };
  if (!rec.results) {   // 舊版紀錄只知道錯咗邊啲詞語
    (rec.wrong || []).forEach(function (w) { incWord(w, true); });
    return;
  }
  rec.results.forEach(function (r) {
    incWord(r.word, !r.ok);
    const bad = r.bad || [];
    if (r.ok || bad.length) {
      Array.from(r.word).forEach(function (ch, i) {
        if (/\s/.test(ch)) return;
        inc(s.charStats, ch, !r.ok && bad.indexOf(i) !== -1);
      });
    }
  });
}

function removeRecords(s, ids) {
  s.history = s.history.filter(function (h) {
    if (ids.indexOf(h.id) === -1) return true;
    undoStats(s, h);
    return false;
  });
  saveDB();
}

/* =====================================================
   畫面
   ===================================================== */
let lastView = null;
let lastScreen = null;   // 上一次畫咗邊個「畫面」（默書按題目＋階段分），用嚟決定要唔要搬焦點

/* 「畫面」身份：換咗先搬焦點；同一畫面內重畫（例如切換選項）唔搶焦點 */
function screenKey() {
  const q = ui.quiz;
  return ui.view === 'quiz' && q ? 'quiz:' + q.mode + ':' + q.phase : ui.view;   // 換詞語唔搶焦點
}

function focusEl(t) {
  if (!t.matches('button, a[href], input, textarea, select, [tabindex]')) t.setAttribute('tabindex', '-1');
  t.focus({ preventScroll: true });
}

/* 新畫面嘅焦點位：有 data-focus 用佢（默書嘅提示句），否則第一個標題；再冇就「← 返回」 */
function focusMain() {
  const t = $app.querySelector('[data-focus]') || $app.querySelector('h1, h2') || $app.querySelector('.back');
  if (t) focusEl(t);
}

/* 重畫前記低焦點元素嘅特徵，重畫後喺同一畫面搵返同一粒（按鈕靠 data-*，輸入框靠 id） */
function focusSig(el) {
  if (!el || el === document.body || !$app.contains(el)) return null;
  const d = el.dataset;
  return { id: el.id, action: d.action, key: d.key, val: d.val, did: d.id, word: d.word, i: d.i, day: d.day, ok: d.ok };
}

function findBySig(sig) {
  if (sig.id) return document.getElementById(sig.id);
  if (!sig.action) return null;
  const list = $app.querySelectorAll('[data-action]');
  for (let n = 0; n < list.length; n++) {
    const d = list[n].dataset;
    if (d.action === sig.action && d.key === sig.key && d.val === sig.val && d.id === sig.did &&
      d.word === sig.word && d.i === sig.i && d.day === sig.day && d.ok === sig.ok) return list[n];
  }
  return null;
}

/* 默書畫面出新題目／新階段時，用獨立 live region 公佈狀態（唔重讀整個畫面） */
function announceScreen() {
  const q = ui.quiz;
  if (ui.view !== 'quiz' || !q) return;
  // 定時 run 唔喺度公佈：timedBegin 逐個詞語自己公佈
  if (q.phase === 'prep') announce('預備，稍後開始自動朗讀');
  else if (q.phase === 'run' && q.mode === 'self') announce('第 ' + (q.idx + 1) + ' / ' + q.words.length + ' 個');
  else if (q.phase === 'review') announce('默書完成，請對答案：點選寫錯嘅字');
}

function render() {
  setTimeout(pumpShare, 0);   // 有等緊確認嘅分享課文，畫面畫好後彈預覽
  const sig = focusSig(document.activeElement);
  const s = me();
  if (ui.view !== 'home' && ui.view !== 'add' && !s) ui.view = 'home';
  const views = {
    home: homeView, add: addView, menu: menuView, lessons: lessonsView,
    lessonEdit: lessonEditView, lessonImport: lessonImportView, setup: setupView, settings: settingsView, quiz: quizView,
    result: resultView, stats: statsView, history: historyView, record: recordView
  };
  // 只有換畫面先播入場動畫，畫面內更新唔會閃
  const animate = ui.view !== lastView;
  lastView = ui.view;
  $app.innerHTML = '<div class="view' + (animate ? ' enter' : '') + '">' +
    (views[ui.view] || homeView)(s) + '</div>';
  if (ui.view === 'quiz') afterQuizRender();
  if (ui.view === 'setup') refreshCount();

  // 焦點管理：換畫面 → 搬去新畫面標題；同一畫面重畫 → 還原到同一粒掣（搵唔到先去標題）。
  // 第一次畫（開 app）同確認框打開期間唔搬
  const screen = screenKey();
  const changed = screen !== lastScreen;
  const firstPaint = lastScreen === null;
  lastScreen = screen;
  if (firstPaint || document.querySelector('.modal-back')) return;
  if (changed) {
    focusMain();
    announceScreen();
  } else if (sig) {
    const t = findBySig(sig);
    if (t) focusEl(t); else focusMain();
  }
}

/* ---------- 備份提醒 ---------- */
/* 距離上次備份幾多日（滿 24 小時先加一）；未備份過返回 null；時鐘倒退（未來時間）當 0 日 */
function backupAgeDays(now) {
  if (!db.lastBackupAt) return null;
  const t = Date.parse(db.lastBackupAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor(((now == null ? Date.now() : now) - t) / DAY_MS));
}

/* 有冇值得備份嘅資料：有課文、默書紀錄或者錯字怪獸；剛登記、仲未用過嘅同學唔算 */
function hasUserData() {
  return db.students.some(function (s) {
    return s.lessons.length > 0 || s.history.length > 0 || Object.keys(s.bank).length > 0;
  });
}

/* 超過 BACKUP_REMIND_DAYS 日未備份（或者從未備份但已有資料）就要提醒；
   「之後再講」只係今次開 app 唔再出（ui.backupSnoozed，唔存起） */
function backupDue(now) {
  if (ui.backupSnoozed || !hasUserData()) return false;
  const t = db.lastBackupAt ? Date.parse(db.lastBackupAt) : NaN;
  if (!Number.isFinite(t)) return true;
  return (now == null ? Date.now() : now) - t > BACKUP_REMIND_DAYS * DAY_MS;
}

function backupAgeText() {
  const d = backupAgeDays();
  if (d === null) return '未備份過';
  return d === 0 ? '今日' : d + ' 日前';
}

function backupReminderHtml() {
  if (!backupDue()) return '';
  const d = backupAgeDays();
  const msg = d === null
    ? '仲未備份過資料。清除瀏覽器資料或者換機，紀錄就會消失。'
    : '已經 ' + d + ' 日冇備份資料喇。';
  return '<div class="notice reminder" role="region" aria-label="備份提醒"><p>💾 ' + msg + '</p>' +
    '<div class="notice-actions"><button class="btn small" data-action="exportData" data-key="reminder">立即備份</button>' +
    '<button class="link" data-action="snoozeBackup">之後再講</button></div></div>';
}

/* 設定頁「家長模式」卡片：設定／更改／移除 4 位數字 PIN（靜態文字，冇外來資料） */
function parentCardHtml() {
  const on = !!db.parentPin;
  return '<div class="card" style="margin-top:16px"><h2>家長模式</h2>' +
    '<p class="muted">設定 PIN 後，刪除紀錄、刪除錯字、修改或刪除詞庫（詞語、課文）、刪除同學同加入分享課文，每次都要先輸入 4 位數字 PIN，剛設定或更改 PIN 之後都一樣。改課文只需輸入一次，3 分鐘內可以儲存，離開編輯頁就重新上鎖；換人、開始默書或者離開 app 都會即刻上鎖。</p>' +
    '<p class="muted pin-note" style="margin-top:6px">' + esc(PIN_DISCLAIMER) + '</p>' +
    (on
      ? '<p class="pin-state"><b>✅ 已啟用</b></p>' +
        '<div class="two-btns"><button class="btn blue small" data-action="changePin">更改 PIN</button>' +
        '<button class="btn ghost small" data-action="removePin">移除 PIN</button></div>'
      : '<button class="btn blue small" style="margin-top:12px" data-action="setPin">設定 PIN</button>') +
    '</div>';
}

/* 設定頁「資料備份」卡片：上次備份幾日前 + 立即備份 */
function backupCardHtml() {
  return '<div class="card" style="margin-top:16px"><h2>資料備份</h2>' +
    '<p id="backupAge">上次備份：' + backupAgeText() + '</p>' +
    '<p class="muted" style="margin-top:6px">資料只存喺呢部機嘅瀏覽器入面，建議定期備份。備份檔唔包括家長 PIN。</p>' +
    '<button class="btn blue small" style="margin-top:12px" data-action="exportData">備份資料</button></div>';
}

/* ---------- 加到主畫面提示 ---------- */
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

function a2hsDismissed() {
  try { return localStorage.getItem(A2HS_KEY) === '1'; } catch (e) { return false; }
}

/* 只喺手機／平板、經 http(s) 開、未加到主畫面、未關閉過先顯示 */
function a2hsTipHtml() {
  const plat = devicePlatform();
  if (plat === 'desktop' || !/^https?:$/.test(location.protocol) || isStandalone() || a2hsDismissed()) return '';
  const how = plat === 'ios'
    ? '用 Safari 打開，撳瀏覽器嘅「分享」掣（□ 加向上箭咀），再揀「加入主畫面」。'
    : '撳瀏覽器右上角嘅選單 ⋮，再揀「加到主畫面」或者「安裝應用程式」。';
  return '<div class="notice a2hs" role="region" aria-label="加到主畫面"><p>📲 加到主畫面，好似 App 咁一撳就開，斷網都用到。</p>' +
    '<p class="how">' + how + '</p>' +
    '<div class="notice-actions"><button class="link" data-action="dismissA2hs">知道喇，唔再提示</button></div></div>';
}

/* 首頁同主選單共用：單人使用時直接入主選單，所以兩個畫面都要有 */
function homeNoticesHtml() {
  return shareWaitHtml() + backupReminderHtml() + a2hsTipHtml();
}

function homeView() {
  const cards = db.students.map(function (s) {
    return '<button class="student-card" data-action="pickStudent" data-id="' + esc(s.id) + '">' +
      '<span class="av">' + esc(s.avatar) + '</span><b>' + esc(s.name) + '</b>' +
      '<small class="muted">' + GRADES[s.grade - 1] + '</small></button>';
  }).join('');
  return '<header class="hero"><div class="logo">🐾</div><h1>默書樂園</h1>' +
    '<p>' + (db.students.length ? '撳返自己嘅頭像啦' : '先登記一位同學啦') + '</p></header>' +
    '<div class="grid">' + cards +
    '<button class="student-card add" data-action="goAdd"><span class="av">➕</span><b>新同學</b></button></div>' +
    homeNoticesHtml() +
    '<div class="footer-links">' +
    '<button class="link" data-action="exportData">備份資料</button>' +
    '<button class="link" data-action="importData">還原資料</button></div>' +
    '<input type="file" id="importFile" accept="application/json,.json" hidden>';
}

/* 公仔選擇 chips（新增同學同設定頁共用）；action 係撳落去執行嘅 data-action */
function avatarChips(current, action) {
  return AVATARS.map(function (a) {
    return '<button class="chip avatar' + (current === a ? ' on' : '') + '" data-action="' + action + '" data-key="avatar" data-val="' + a + '" aria-label="公仔 ' + a + '"' + pressed(current === a) + '>' + a + '</button>';
  }).join('');
}

/* 年級選擇 chips（新增同學同設定頁共用）；action 係撳落去執行嘅 data-action */
function gradeChips(current, action) {
  return GRADES.map(function (g, i) {
    return '<button class="chip' + (current === i + 1 ? ' on' : '') + '" data-action="' + action + '" data-key="grade" data-val="' + (i + 1) + '"' + pressed(current === i + 1) + '>' + g + '</button>';
  }).join('');
}

function addView() {
  const f = ui.form;
  const grades = gradeChips(f.grade, 'setForm');
  const avs = avatarChips(f.avatar, 'setForm');
  return '<div class="topnav"><button class="back" data-action="goHome">← 返回</button></div>' +
    '<div class="card"><h2>新同學</h2>' +
    '<label class="field-label" for="nameInput">你叫咩名？</label>' +
    '<input type="text" id="nameInput" maxlength="10" autocomplete="off" value="' + esc(f.name) + '" placeholder="輸入名字">' +
    '<span class="field-label">讀幾年級？</span><div class="chips" data-group="grade">' + grades + '</div>' +
    '<span class="field-label">揀個頭像</span><div class="chips" data-group="avatar">' + avs + '</div>' +
    '<button class="btn green block" style="margin-top:26px" data-action="saveStudent">完成 ✓</button></div>';
}

function menuView(s) {
  const bankCount = Object.keys(s.bank).length;
  return '<div class="topnav"><button class="back" data-action="goHome">← 換人</button>' +
    '<button class="back btn-settings" data-action="goSettings" aria-label="設定">設定</button></div>' +
    '<div class="greet"><div class="big-av">' + esc(s.avatar) + '</div>' +
    '<h2>' + esc(s.name) + '，你好！</h2><p class="muted">' + GRADES[s.grade - 1] + '</p></div>' +
    '<div class="menu-grid">' +
    '<button class="menu-btn" data-action="goSetup" data-source="lessons"><span class="ico">✏️</span>開始默書</button>' +
    '<button class="menu-btn r" data-action="goSetup" data-source="bank"><span class="ico">👾</span>錯字怪獸' +
    (bankCount ? '<span class="badge">' + bankCount + '</span>' : '') + '</button>' +
    '<button class="menu-btn g" data-action="goLessons"><span class="ico">📚</span>我的詞庫</button>' +
    '<button class="menu-btn b" data-action="goStats"><span class="ico">📊</span>我的成績</button>' +
    '</div>' + homeNoticesHtml() +
    '<div class="footer-links"><button class="link danger" data-action="deleteStudent">刪除呢位同學</button></div>';
}

/* ---------- 列印練習紙（T5.5） ----------
   列印唔改資料：唔 saveDB、唔寫 localStorage、唔需要 PIN；選項只存 ui.printOpts（記憶體）。
   紙面（printSheetHtml）同時寫入預覽同 #printRoot（同一份 HTML）；所有資料值經 esc()／Number() */
function printOpts() {
  const o = Object.assign({}, PRINT_DEFAULTS, ui.printOpts || {});
  return {
    mode: o.mode === 'dictation' ? 'dictation' : 'practice',
    cells: PRINT_CELLS.indexOf(o.cells) !== -1 ? o.cells : PRINT_DEFAULTS.cells,
    trace: o.trace !== false,
    hints: o.hints !== false,
    answers: o.answers !== false
  };
}

/* 列印快照：{ title, words, hints(無原型字典), hasHints, studentName, source }；搵唔到課文或者冇詞語就 null */
function printModel(s, src, id) {
  if (!s) return null;
  let title, words, hints;
  if (src === 'bank') {
    title = '錯字';
    words = bankQueue(s);
    hints = hintMap(s.lessons);
  } else {
    const l = s.lessons.find(function (x) { return x.id === id; });
    if (!l) return null;
    title = l.title;
    words = l.words.slice();
    hints = Object.create(null);
    if (l.hints) {
      words.forEach(function (w) { if (hasKey(l.hints, w) && l.hints[w]) hints[w] = String(l.hints[w]); });
    }
  }
  if (!words.length) return null;
  return {
    title: title,
    words: words,
    hints: hints,
    hasHints: words.some(function (w) { return !!hints[w]; }),
    studentName: s.name || '',
    source: src === 'bank' ? 'bank' : 'lesson'
  };
}

/* 詞語拆字（逐 code point，唔拆 surrogate pair），去掉空白 */
function charCells(word) {
  return Array.from(String(word)).filter(function (c) { return !/\s/.test(c); });
}

function cellHtml(ch, trace) {
  return '<span class="tz">' + (trace ? '<b class="tz-ch">' + esc(ch) + '</b>' : '') + '</span>';
}

/* 一次詞語＝一組格（組內唔斷行） */
function repHtml(chars, trace) {
  return '<span class="ps-rep">' + chars.map(function (c) { return cellHtml(c, trace); }).join('') + '</span>';
}

function printSheetHtml(m, o) {
  const dict = o.mode === 'dictation';
  const total = Number(m.words.length);
  const kind = dict ? '默書紙' : '練習紙';
  const title = (m.source === 'bank' ? '錯字' : esc(m.title) + '　') + kind;
  const head =
    '<div class="ps-head"><p class="ps-title">' + title + '</p>' +
    '<p class="ps-meta"><span>姓名：<i class="ps-line">' + esc(m.studentName || '') + '</i></span>' +
    '<span>日期：<i class="ps-line"></i></span>' +
    '<span>分數：<i class="ps-line"></i> ／ ' + total + '</span></p></div>';
  const hintOf = function (w) { return m.hints && hasKey(m.hints, w) && m.hints[w] ? String(m.hints[w]) : ''; };
  const items = m.words.map(function (w, i) {
    const no = '<span class="ps-no">' + Number(i + 1) + '</span>';
    const chars = charCells(w);
    if (dict) {
      return '<li class="ps-word ps-dict">' + no + '<div class="ps-cells">' + repHtml(chars, false) + '</div></li>';
    }
    const h = o.hints ? hintOf(w) : '';
    const reps = [];
    for (let k = 0; k < o.cells; k++) reps.push(repHtml(chars, o.trace && k === 0));
    return '<li class="ps-word"><div class="ps-label">' + no + '<span class="ps-lw">' + esc(w) + '</span>' +
      (h ? '<small class="ps-hint">' + esc(h) + '</small>' : '') + '</div>' +
      '<div class="ps-cells">' + reps.join('') + '</div></li>';
  }).join('');
  let ans = '';
  if (dict && o.answers) {
    ans = '<div class="ps-ans"><p class="ps-title">答案（家長用）</p><ol class="ps-alist">' +
      m.words.map(function (w, i) {
        const h = o.hints ? hintOf(w) : '';
        return '<li><span class="ps-no">' + Number(i + 1) + '</span> <span class="ps-lw">' + esc(w) + '</span>' +
          (h ? ' <small class="ps-hint">' + esc(h) + '</small>' : '') + '</li>';
      }).join('') + '</ol></div>';
  }
  return '<div class="ps ' + (dict ? 'ps-dictation' : 'ps-practice') + '">' + head +
    '<ol class="ps-list">' + items + '</ol>' + ans + '</div>';
}

/* 選項組：一列 chip（沿用 .chip＋aria-pressed），狀態由 refreshPrint 更新 */
function ppGroup(key, label, items) {
  return '<div class="pp-group" data-opt="' + key + '"><span class="field-label" id="ppL-' + key + '">' + label + '</span>' +
    '<div class="toggle-select" role="group" aria-labelledby="ppL-' + key + '">' +
    items.map(function (it) {
      return '<button type="button" class="chip" data-action="printOpt" data-key="' + key + '" data-val="' + esc(it[0]) +
        '" aria-pressed="false">' + it[1] + '</button>';
    }).join('') + '</div></div>';
}

function printDialogBodyHtml(m) {
  return '<p class="pp-title"><b>' + esc(m.source === 'bank' ? '錯字怪獸清單' : m.title) + '</b>　<span>共 ' + Number(m.words.length) + ' 個詞語</span></p>' +
    '<div class="pp-opts">' +
    ppGroup('mode', '紙張', [['practice', '✏️ 練習紙'], ['dictation', '📝 默書紙']]) +
    ppGroup('cells', '每字幾格', PRINT_CELLS.map(function (n) { return [String(n), n + ' 格']; })) +
    ppGroup('trace', '描紅示範字', [['1', '有'], ['0', '冇']]) +
    ppGroup('hints', '提示句', [['1', '附上'], ['0', '唔附']]) +
    ppGroup('answers', '附答案頁', [['1', '附上'], ['0', '唔附']]) +
    '</div><p class="muted pp-nohint" hidden>呢批詞語冇提示句</p>' +
    '<p class="sr-only" id="ppSummary" role="status" aria-live="polite"></p>' +
    '<div class="pp-preview" tabindex="0" role="group" aria-label="預覽（示意）"><div class="pp-preview-inner" aria-hidden="true"></div></div>';
}

/* 重畫預覽同 #printRoot（同一份 HTML），並更新選項狀態；唔重建 dialog，焦點唔會跳 */
function refreshPrint() {
  if (!ui.print) return;
  const m = ui.print.model;
  const o = printOpts();
  const dict = o.mode === 'dictation';
  const html = printSheetHtml(m, o);
  const inner = document.querySelector('.pp-preview-inner');
  const root = document.getElementById('printRoot');
  if (inner) inner.innerHTML = html;
  if (root) root.innerHTML = html;
  document.querySelectorAll('.print-modal [data-action=printOpt]').forEach(function (btn) {
    const key = btn.dataset.key;
    const cur = key === 'mode' ? o.mode : key === 'cells' ? String(o.cells) : (o[key] ? '1' : '0');
    const on = cur === btn.dataset.val;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (key === 'hints') btn.disabled = !m.hasHints;
  });
  const hide = { cells: dict, trace: dict, answers: !dict };
  document.querySelectorAll('.print-modal .pp-group').forEach(function (g) {
    g.hidden = !!hide[g.dataset.opt];
  });
  const nh = document.querySelector('.print-modal .pp-nohint');
  if (nh) nh.hidden = m.hasHints;
  const sum = document.getElementById('ppSummary');
  if (sum) {
    sum.textContent = '共 ' + m.words.length + ' 個詞語' + (dict ? '（默書紙' + (o.answers ? '，附答案頁' : '') + '）' : '，每字 ' + o.cells + ' 格');
  }
  preloadAnswerFont(m.words);
}

function closePrint() {
  const r = document.getElementById('printRoot');
  if (r) r.remove();
  document.body.classList.remove('is-printing');
  ui.print = null;
}

/* 先等楷書字體載入（最多 1.5 秒）再印，免得列印出後備字體 */
function doPrint() {
  const m = ui.print && ui.print.model;
  if (!m) return;
  const go = function () {
    if (!ui.print) return;   // 等字體期間 dialog 已關
    try { window.print(); } catch (e) { toast('列印唔到，請用瀏覽器選單列印'); }
  };
  try {
    if (document.fonts && document.fonts.load) {
      Promise.race([
        document.fonts.load('400 1em "Free HK Kai"', m.words.join('')),
        new Promise(function (r) { setTimeout(r, 1500); })
      ]).catch(function () {}).then(go);
    } else {
      go();
    }
  } catch (e) {
    toast('列印唔到，請用瀏覽器選單列印');
  }
}

function openPrintDialog(src, id) {
  const m = printModel(me(), src, id);
  if (!m) { toast('冇詞語可以列印'); return; }
  if (document.querySelector('.modal-back')) return;
  ui.print = { model: m };
  const old = document.getElementById('printRoot');
  if (old) old.remove();
  const root = document.createElement('div');
  root.id = 'printRoot';
  document.body.appendChild(root);
  document.body.classList.add('is-printing');
  confirmBox({
    icon: '🖨️', title: '列印預覽',
    text: '先睇預覽，再撳「列印」。預覽只係示意，實際分行同分頁以瀏覽器列印預覽為準。',
    okText: '🖨️ 列印', wide: true, keepOpen: true,
    bodyHtml: printDialogBodyHtml(m),
    focusSel: '[data-action=printOpt]',
    onOpen: refreshPrint
  }, doPrint, closePrint);
}

function lessonsView(s) {
  let body;
  if (!s.lessons.length) {
    body = '<div class="empty"><span class="em">📝</span>仲未有課文，加一課啦</div>';
  } else {
    body = s.lessons.map(function (l) {
      return '<div class="lesson-row"><div class="info"><b>' + esc(l.title) + '</b> <span class="muted">' + l.words.length + ' 個詞</span>' +
        '<div class="preview">' + esc(l.words.join('　')) + '</div></div>' +
        '<button class="btn ghost small" data-action="editLesson" data-id="' + esc(l.id) + '">改</button>' +
        '<button class="icon-btn" data-action="shareLesson" data-id="' + esc(l.id) + '" aria-label="分享課文">📤</button>' +
        '<button class="icon-btn" data-action="printLesson" data-id="' + esc(l.id) + '" aria-label="列印「' + esc(l.title) + '」練習紙">🖨️</button>' +
        '<button class="icon-btn" data-action="deleteLesson" data-id="' + esc(l.id) + '" aria-label="刪除課文">🗑</button></div>';
    }).join('');
  }
  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="card"><h2>我的詞庫</h2>' + body + '</div>' +
    '<button class="btn green block" style="margin-top:20px" data-action="newLesson">➕ 新增一課</button>' +
    '<button class="btn ghost block" style="margin-top:12px" data-action="goLessonImport">📥 匯入課文</button>';
}

/* 匯入分享課文頁：貼分享文字或者成條連結，撳「預覽」先睇內容，確認先會加入 */
function lessonImportView() {
  return '<div class="topnav"><button class="back" data-action="goLessons">← 返回</button></div>' +
    '<div class="card"><h2>匯入課文</h2>' +
    '<label class="field-label" for="importText">貼上朋友分享嘅課文文字或者連結</label>' +
    '<p class="muted hint-help" id="importHelp">貼上之後撳「預覽」，睇清楚內容先決定加唔加入詞庫，唔會自動加入。</p>' +
    '<textarea id="importText" aria-describedby="importHelp" placeholder="【課文】第一課&#10;蘋果&#10;公園 | 我們去公園玩耍"></textarea>' +
    '<button class="btn green block" style="margin-top:18px" data-action="previewImport">預覽</button></div>';
}

/* 課文轉返編輯框文字：一行一詞，有提示句嘅寫成「詞語｜提示句」 */
function lessonText(l) {
  return l.words.map(function (w) {
    return l.hints && hasKey(l.hints, w) ? w + '｜' + l.hints[w] : w;
  }).join('\n');
}

/* ---------- 分享課文：複製、預覽、加入 ---------- */
/* 複製文字：有 navigator.clipboard 就用，失敗或者冇就轉 execCommand 後備（揀中 textarea 再複製）。
   fallbackEl 係畫面上現成嘅 textarea（複製文字時用，用家會見到揀中）；冇傳就用臨時 textarea */
function copyText(text, fallbackEl) {
  const done = function (ok) { toast(ok ? '已複製 ✓' : '複製唔到，請手動揀取文字'); };
  const fallback = function () {
    const prev = document.activeElement;
    let el = fallbackEl;
    let temp = null;
    let ok = false;
    try {
      if (!el) {
        temp = el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
        document.body.appendChild(el);
      }
      el.focus();
      el.select();
      el.setSelectionRange(0, el.value.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    if (temp) {
      temp.remove();
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    }
    done(ok);
  };
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      return;
    }
  } catch (e) { /* 轉後備 */ }
  fallback();
}

/* 目前頁面網址（唔含 #）；分享連結用 */
function shareBaseUrl() { return location.href.split('#')[0]; }

/* 預覽內容：課文名、詞語數、每個詞語同提示句（全部係外來資料，一律 esc） */
function sharePreviewHtml(l) {
  const rows = l.words.map(function (w) {
    const h = hasKey(l.hints, w) ? l.hints[w] : '';
    return '<div class="sp-row"><span class="sp-word">' + esc(w) + '</span>' +
      (h ? '<small class="sp-hint">' + esc(h) + '</small>' : '') + '</div>';
  }).join('');
  return '<p class="sp-title"><b>' + esc(l.title) + '</b>　<span>' + Number(l.words.length) + ' 個詞語</span></p>' +
    '<div class="share-preview" tabindex="0" role="group" aria-label="課文內容預覽">' + rows + '</div>';
}

/* 未揀同學但有分享課文等緊加入：喺首頁出提示卡 */
function shareWaitHtml() {
  if (!ui.share || me()) return '';
  return '<div class="notice reminder" role="region" aria-label="分享課文"><p>📩 有一課分享課文「' + esc(ui.share.title) +
    '」等緊加入，' + (db.students.length ? '請先揀同學。' : '請先登記同學。') + '</p>' +
    '<div class="notice-actions"><button class="link" data-action="cancelShare">放棄</button></div></div>';
}

function clearShareHash() {
  if (!location.hash) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
}

/* 丟棄等緊確認嘅分享課文並清走網址 hash */
function discardShare() {
  ui.share = null;
  clearShareHash();
}

/* 分享課文出錯：單掣錯誤框（外來錯誤訊息一律經 confirmBox 嘅 esc） */
function shareError(msg) {
  confirmBox({ icon: '⚠️', title: '開唔到分享課文', text: String(msg), okText: '知道', single: true }, function () {});
}

/* 網址帶 #lesson=：解碼＋校驗；成功就放入 ui.share（等 pumpShare 彈預覽，永不自動加入；
   hash 留到取消／加入先清走），失敗就彈錯誤框並即刻清走 hash */
function checkShareHash() {
  const h = location.hash || '';
  if (h.indexOf('#lesson=') !== 0) return;
  try {
    ui.share = validateSharedLesson(decodeShare(h.slice(8)));
  } catch (e) {
    ui.share = null;
    clearShareHash();
    shareError(e.message);
  }
}

/* 有等緊確認嘅分享課文而且已經揀咗同學：彈預覽。默書中、已有 dialog 時唔彈。取消／Esc／撳背景＝丟棄 */
function pumpShare() {
  if (!ui.share || ui.view === 'quiz' || document.querySelector('.modal-back')) return;
  const s = me();
  if (!s) return;
  const lesson = ui.share;
  confirmBox({
    icon: '📥', title: '加入呢一課？',
    text: '有人分享咗一課畀你。睇清楚內容，撳「加入」先會加入「' + s.name + '」嘅詞庫。',
    okText: '加入', bodyHtml: sharePreviewHtml(lesson)
  }, function () {
    // PIN 先：通過先加入。取消 PIN 就同取消預覽一樣，丟棄 ui.share 並清走 hash
    requirePin('加入課文', function () {
      ui.share = null;
      addSharedLesson(me() || s, lesson);
    }, discardShare);
  }, discardShare);
}

/* 加入分享課文：重複（同名同內容）、課文數量上限都會擋住 */
function addSharedLesson(s, lesson) {
  ui.share = null;
  clearShareHash();
  if (s.lessons.some(function (x) { return x.title === lesson.title && lessonText(x) === lessonText(lesson); })) {
    toast('已經有呢一課');
    go('lessons');
    return;
  }
  if (s.lessons.length >= SHARE_LESSONS_MAX) {
    toast('詞庫已經有 ' + SHARE_LESSONS_MAX + ' 課，唔可以再加');
    return;
  }
  s.lessons.push({ id: uid(), title: lesson.title, words: lesson.words, hints: lesson.hints });
  saveDB();
  toast('已加入「' + lesson.title + '」✓');
  go('lessons');
}

/* 編輯課文時嘅即時預覽：解析後嘅詞語 chips，有提示句就細字顯示（詞語同提示句係用家輸入，一律 esc） */
function wordPreviewHtml(parsed) {
  if (!parsed.words.length) return '<span class="muted">輸入詞語後，呢度會顯示解析結果</span>';
  return parsed.words.map(function (w) {
    const h = parsed.hints[w];
    return '<span class="chip word">' + esc(w) + (h ? ' <small class="hint">' + esc(h) + '</small>' : '') + '</span>';
  }).join('');
}

/* 「其中 M 個有提示句」；冇提示句就空字串 */
function hintCountText(parsed) {
  const m = parsed.words.filter(function (w) { return !!parsed.hints[w]; }).length;
  return m > 0 ? '，其中 ' + m + ' 個有提示句' : '';
}

/* 編輯課文有冇未儲存改動：課文名或詞語同開啟時嘅內容唔同 */
function editDirty() {
  const t = document.getElementById('lessonTitle');
  const w = document.getElementById('lessonWords');
  if (ui.view !== 'lessonEdit' || !ui.editBase || !t || !w) return false;
  return t.value !== ui.editBase.title || w.value !== ui.editBase.words;
}

function lessonEditView(s) {
  const lesson = ui.editLessonId ? s.lessons.find(function (l) { return l.id === ui.editLessonId; }) : null;
  const title = lesson ? lesson.title : '第' + (s.lessons.length + 1) + '課';
  const words = lesson ? lessonText(lesson) : '';
  ui.editBase = { title: title, words: words };   // 開啟時嘅內容，用嚟偵測有冇未儲存改動
  const parsed = parseLesson(words);
  return '<div class="topnav"><button class="back" data-action="leaveEdit">← 返回</button></div>' +
    '<div class="card"><h2>' + (lesson ? '修改課文' : '新增課文') + '</h2>' +
    '<label class="field-label" for="lessonTitle">課文名稱</label>' +
    '<input type="text" id="lessonTitle" maxlength="20" autocomplete="off" value="' + esc(title) + '">' +
    '<label class="field-label" for="lessonWords">詞語（一行一個，或者用逗號、空格、斜線分開）</label>' +
    '<p class="muted hint-help" id="hintHelp">想加提示句：一行寫一個詞語，後面加「｜」（或者 |）再寫句子，例如「公園 | 我們去公園玩耍」。默書時有提示句嘅詞語會出現「💡 提示句」掣，學生需要先自己撳來聽；提示句最多 ' + HINT_MAX + ' 個字。</p>' +
    '<textarea id="lessonWords" aria-describedby="hintHelp" placeholder="例如：&#10;蘋果&#10;公園 | 我們去公園玩耍&#10;西瓜">' + esc(words) + '</textarea>' +
    '<p class="muted" style="margin-top:8px">共 <b id="wordCount">' + parsed.words.length + '</b> 個詞語<span id="hintCount">' + esc(hintCountText(parsed)) + '</span>（儲存時會自動去走頭尾標點同重複詞語）</p>' +
    '<div class="word-preview" id="wordPreview" role="group" aria-label="詞語預覽">' + wordPreviewHtml(parsed) + '</div>' +
    '<button class="btn green block" style="margin-top:18px" data-action="saveLesson">儲存 ✓</button></div>';
}

/* 「默幾多個」滑桿（課文同錯字怪獸模式共用）；數字由 refreshCount 即時填。label 係靜態文字 */
function countBoxHtml(label) {
  return '<div id="countBox" class="count-box">' +
    '<span class="field-label" style="margin-top:6px">' + label + '</span>' +
    '<div class="count-val"><b id="countNum"></b><small> / <span id="countMax">0</span> 個</small></div>' +
    '<input type="range" id="countRange" class="range" min="1" max="1" step="1" value="1" aria-label="默書數量">' +
    '<p class="muted center" id="countHint"></p></div>';
}

function setupView(s) {
  if (!ui.setup) initSetup(s, 'lessons');
  const c = ui.setup;
  const chip = function (key, val, label) {
    return '<button class="chip' + (c[key] === val ? ' on' : '') + '" data-action="setOpt" data-key="' + key + '" data-val="' + val + '"' + pressed(c[key] === val) + '>' + label + '</button>';
  };
  const bankWords = bankQueue(s);   // 最耐冇默對嘅排最前，即係會先默嘅字

  let sourceBlock;
  if (c.source === 'bank') {
    if (!bankWords.length) {
      sourceBlock = '<div class="empty"><span class="em">🎉</span>錯字怪獸全部打敗晒！<br>暫時冇錯字。</div>';
    } else {
      sourceBlock = '<p class="muted">默對就打敗怪獸。有啲字要默對幾次先剔走。</p><div class="chips" style="margin-top:10px">' +
        bankWords.map(function (w) {
          const b = s.bank[w];
          return '<span class="chip word">' + esc(w) + ' <small class="muted">×' + Number(b.need - b.progress) + '</small>' +
            '<button class="chip-x" data-action="removeBank" data-word="' + esc(w) + '" aria-label="刪除「' + esc(w) + '」">✕</button></span>';
        }).join('') + '</div>' + countBoxHtml('默幾多個錯字？');
    }
  } else if (!s.lessons.length) {
    sourceBlock = '<div class="empty"><span class="em">📝</span>仲未有課文，<br>請先去「我的詞庫」新增。</div>';
  } else {
    sourceBlock = '<div class="chips" data-group="lessons">' + s.lessons.map(function (l) {
      const on = c.lessonIds.indexOf(l.id) !== -1;
      return '<button class="chip' + (on ? ' on' : '') + '" data-action="toggleLesson" data-id="' + esc(l.id) + '"' + pressed(on) + '>' +
        esc(l.title) + ' <small>(' + l.words.length + ')</small></button>';
    }).join('') + '</div>' +
      '<button class="link" data-action="allLessons">全選 / 取消全選</button>' +
      countBoxHtml('默幾多個詞語？');
  }

  const canStart = c.source === 'bank' ? bankWords.length > 0 : s.lessons.length > 0;
  const group = function (key, inner) {
    return '<div class="toggle-select" data-group="' + key + '">' + inner + '</div>';
  };

  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="card"><h2>默書</h2>' +
    '<span class="field-label">默邊度？</span>' +
    group('source', chip('source', 'lessons', '📚 課文') + chip('source', 'bank', '👾 錯字怪獸')) +
    '<div style="margin-top:14px">' + sourceBlock + '</div></div>' +
    modeCardHtml(c) +
    (c.source === 'bank'
      ? '<button class="btn ghost small block" style="margin-top:12px" data-action="printBank"' + (bankWords.length ? '' : ' disabled') + ' aria-label="列印錯字練習紙">🖨️ 列印錯字練習紙</button>'
      : '') +
    '<button class="btn block" style="margin-top:20px;min-height:68px;font-size:1.3rem"' + (canStart ? '' : ' disabled') + ' data-action="startQuiz">開始默書 🚀</button>';
}

/* 設定頁：次序、預設朗讀語言、朗讀速度（存喺 s.prefs，每位同學一份） */
function settingsView(s) {
  const p = s.prefs;
  const chip = function (key, val, label) {
    return '<button class="chip' + (p[key] === val ? ' on' : '') + '" data-action="setPref" data-key="' + key + '" data-val="' + val + '"' + pressed(p[key] === val) + '>' + label + '</button>';
  };
  const group = function (key, inner) {
    return '<div class="toggle-select" data-group="' + key + '">' + inner + '</div>';
  };
  const shortcutChip = function (on, label) {
    const cur = p.shortcuts !== false;
    return '<button class="chip' + (cur === on ? ' on' : '') + '" data-action="setShortcuts" data-val="' + (on ? '1' : '0') + '"' + pressed(cur === on) + '>' + label + '</button>';
  };
  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="card"><h2>我嘅資料</h2>' +
    '<label class="field-label" for="profileName" style="margin-top:0">名稱</label>' +
    '<div class="name-edit"><input type="text" id="profileName" maxlength="10" autocomplete="off" value="' + esc(s.name) + '" placeholder="輸入名稱" aria-describedby="profileHint">' +
    '<button class="btn small" data-action="saveProfileName">儲存</button></div>' +
    '<p class="field-error" id="profileHint" role="alert" hidden></p>' +
    '<span class="field-label">讀幾年級？</span><div class="chips" data-group="grade">' + gradeChips(s.grade, 'setMyGrade') + '</div>' +
    '<span class="field-label">揀個公仔</span><div class="chips" data-group="avatar">' + avatarChips(s.avatar, 'setMyAvatar') + '</div></div>' +
    '<div class="card" style="margin-top:16px"><h2>設定</h2>' +
    '<span class="field-label">次序</span>' + group('order', chip('order', 'seq', '➡️ 順序') + chip('order', 'random', '🔀 亂序')) +
    '<span class="field-label">預設朗讀語言</span>' + group('lang', chip('lang', 'yue', LANGS.yue.label) + chip('lang', 'cmn', LANGS.cmn.label)) +
    '<p class="muted" style="margin-top:6px">自助默書時，每個詞語都可以隨時轉語言再聽。</p>' +
    '<span class="field-label">朗讀速度</span>' +
    group('speed', Object.keys(SPEEDS).map(function (k) { return chip('speed', k, SPEEDS[k].label); }).join('')) +
    '<span class="field-label">提示句速度</span>' +
    group('hintSpeed', Object.keys(SPEEDS).map(function (k) { return chip('hintSpeed', k, SPEEDS[k].label); }).join('')) +
    '<p class="muted" style="margin-top:6px">學生喺默書畫面撳「💡 提示句」掣先會讀（有提示句嘅詞語先有此掣，例如「公園 | 我們去公園玩耍」），唔會自動讀。呢度設定提示句嘅朗讀速度。</p>' +
    '<span class="field-label" id="shortcutsLabel">鍵盤快捷鍵</span>' +
    '<div class="toggle-select" data-group="shortcuts" role="group" aria-labelledby="shortcutsLabel">' +
    shortcutChip(true, '開') + shortcutChip(false, '關') + '</div>' +
    '<p class="muted" style="margin-top:6px">自助默書用 ←、→ 轉詞語，空白重讀，Enter 去下一個；定時默書用空白暫停／繼續。語音輸入或讀屏軟件用家可以關閉，避免誤觸。</p>' +
    '<div id="voicePicker">' + voicePickerHtml(s) + '</div>' +
    '<button class="btn blue small" style="margin-top:14px" data-action="testVoice">🔊 試聽</button>' +
    '<div id="voiceNotice">' + voiceNoticeHtml(voiceLangKey(s)) + '</div></div>' +
    timedSettingsHtml(p) +
    parentCardHtml() +
    backupCardHtml() +
    // 字體署名（CC BY 4.0）：靜態文字，唔涉及資料
    '<p class="muted credit">答案字型：<a href="https://freehkfonts.opensource.hk/download/" target="_blank" rel="noopener">自由香港楷書</a> (Free HK Kai)，' +
    '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>；改編自全字庫正楷體。</p>';
}

/* 設定頁改名：失焦／Enter／撳「儲存」先處理，輸入期間唔會重畫 */
function saveProfileName() {
  const input = document.getElementById('profileName');
  const hint = document.getElementById('profileHint');
  const s = me();
  if (!input || !s) return;
  const name = input.value.trim();
  const fail = function (msg) {
    hint.textContent = msg;
    hint.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  };
  if (!name) { fail('名稱唔可以留空'); return; }
  hint.hidden = true;
  input.removeAttribute('aria-invalid');
  input.value = name;
  if (name === s.name) return;
  s.name = name;
  saveDB();
  toast('已更新 ✓');
}

function initSetup(s, source) {
  // 還原上次揀嘅課文（已刪除嘅略過）；冇記錄或者全部失效就揀最新（最後加入）一課
  const exists = new Set(s.lessons.map(function (l) { return l.id; }));
  let ids = s.prefs.lastLessonIds.filter(function (id) { return exists.has(id); });
  if (!ids.length && s.lessons.length) ids = [s.lessons[s.lessons.length - 1].id];
  ui.setup = {
    source: source, lessonIds: ids, count: countDefault(source),   // count：數字 = 默幾多個；null = 全部
    mode: defaultMode()   // 默書方式：timed／self；每次入設定頁都重設為預設方式（有語音＝定時，冇＝自助）
  };
}

/* 「默幾多個」預設：課文模式 12、錯字怪獸模式 10 */
function countDefault(source) {
  return source === 'bank' ? BANK_COUNT_DEFAULT : LESSON_COUNT_DEFAULT;
}

/* 錯字怪獸出題次序：最耐冇默對（lastOkAt 最舊）排最前；冇 lastOkAt（舊資料）當最舊；同時間保持原本次序 */
function bankQueue(s) {
  return Object.keys(s.bank).map(function (w, i) {
    const t = Date.parse(s.bank[w].lastOkAt);
    return { w: w, i: i, t: Number.isFinite(t) ? t : -Infinity };
  }).sort(function (a, b) {
    return a.t === b.t ? a.i - b.i : (a.t < b.t ? -1 : 1);
  }).map(function (x) { return x.w; });
}

/* 錯字怪獸模式：錯字總數；課文模式：已揀課文入面嘅詞語總數（重複嘅詞語只計一次） */
function setupTotal(s, c) {
  if (c.source === 'bank') return Object.keys(s.bank).length;
  const seen = new Set();
  s.lessons.forEach(function (l) {
    if (c.lessonIds.indexOf(l.id) === -1) return;
    l.words.forEach(function (w) { seen.add(w); });
  });
  return seen.size;
}

/* 更新「默幾多個詞語」：只改需要變嘅地方，唔重畫整個面板 */
function refreshCount() {
  const box = document.getElementById('countBox');
  if (!box || !ui.setup) return;
  const c = ui.setup;
  const total = setupTotal(me(), c);
  const n = Math.max(0, c.count == null ? total : Math.min(c.count, total));

  // 數量 = 總數時顯示「全部」；拖動滑桿時唔播動畫
  document.getElementById('countNum').textContent = n === total && total > 0 ? '全部' : n;
  document.getElementById('countMax').textContent = total;
  const range = document.getElementById('countRange');
  range.max = Math.max(total, 1);
  range.value = n;
  range.disabled = total === 0;
  range.setAttribute('aria-valuetext', n === total && total > 0 ? '全部 ' + total + ' 個' : n + ' 個');
  range.style.setProperty('--pct', total > 1 ? ((n - 1) / (total - 1) * 100) + '%' : '100%');

  document.getElementById('countHint').textContent = c.source === 'bank'
    ? (!total ? '' : n < total ? '先默最耐冇默對嘅 ' + n + ' 個，尚餘 ' + (total - n) + ' 個錯字未溫' : '默晒全部 ' + total + ' 個錯字')
    : (!total ? '先揀課文' : n < total ? (me().prefs.order === 'random' ? '由 ' + total + ' 個詞語入面隨機抽 ' + n + ' 個' : '按課文次序，默頭 ' + n + ' 個（共 ' + total + ' 個）') : '默晒全部 ' + total + ' 個詞語');
}

/* 詞語 → 提示句對照（無原型字典）：逐課逐詞，第一課有嘅優先 */
function hintMap(lessons) {
  const out = Object.create(null);
  lessons.forEach(function (l) {
    if (!l.hints) return;
    l.words.forEach(function (w) {
      if (!out[w] && hasKey(l.hints, w) && l.hints[w]) out[w] = l.hints[w];
    });
  });
  return out;
}

/* 順序模式：揀頭 n 個，跟返課文次序；亂序模式：由全部詞語入面隨機抽 n 個再打亂 */
function pickWords(all, n, order) {
  let idx = all.map(function (w, i) { return i; });
  if (order === 'random') {
    if (n < all.length) idx = shuffle(idx).slice(0, n);
    idx = shuffle(idx);
  } else {
    idx = idx.slice(0, n);   // 順序：頭 n 個，本身已經係課文次序
  }
  return idx.map(function (i) { return all[i]; });
}

/* 開始默書時預先載入答案字體（自由香港楷書分片），避免揭曉答案時先閃一下後備字體。
   唔等結果、唔阻塞默書；載入失敗就當冇事，逐字退回系統楷書／serif。詞語係資料，唔 log */
function preloadAnswerFont(words) {
  if (!document.fonts || !document.fonts.load) return;
  try {
    document.fonts.load('400 1em "Free HK Kai"', words.join('')).catch(function () {});
  } catch (e) { /* 字體預載失敗唔影響默書 */ }
}

/* ---------- 默書畫面 ---------- */
function langSwitch(q, action) {
  return '<div class="lang-switch" role="group" aria-label="朗讀語言">' +
    ['cmn', 'yue'].map(function (k) {
      return '<button class="lang-btn' + (q.curLang === k ? ' on' : '') + '" data-action="' + action + '" data-val="' + k + '"' + pressed(q.curLang === k) + '>' + LANGS[k].label + '</button>';
    }).join('') + '</div>';
}

/* 默書鍵盤快捷鍵開關（WCAG 2.1.4）：prefs.shortcuts，冇同學資料或欄位缺失當開 */
function shortcutsOn() {
  const s = me();
  return !(s && s.prefs && s.prefs.shortcuts === false);
}

/* 默書畫面：只有定時／自助兩種方式（函數名沿用，內容交畀 newModeView） */
function quizView(s) {
  return newModeView(s, ui.quiz);
}

/* ----- 新默書方式畫面（純回傳 HTML，冇副作用；詞語／提示句一律 esc） ----- */
/* 頂部：沿用 quizView 同一組 class（.quit／.track／.fill／.runner／.flag／.count），afterQuizRender 靠佢做進度動畫 */
function newTopHtml(s, q, countText) {
  return '<div class="quiz-top"><button class="quit" data-action="quit" aria-label="' + (q.phase === 'review' ? '離開對答案' : '停止默書') + '">✕</button>' +
    '<div class="track"><div class="fill" style="width:' + (q.shown * 100) + '%"></div>' +
    '<div class="runner" style="left:calc((100% - 32px) * ' + q.shown + ')">' + esc(s.avatar) + '</div>' +
    '<span class="flag">🏁</span></div>' +
    '<div class="count">' + countText + '</div></div>';
}

function newModeView(s, q) {
  if (q.phase === 'review') return reviewView(s, q);
  return q.mode === 'timed' ? timedView(s, q) : selfView(s, q);
}

/* 定時畫面：DOM 內唔會出現當前詞語、提示句或字數 */
function timedView(s, q) {
  const t = q.t, n = q.words.length;
  const prep = q.phase === 'prep' || !t;
  const paused = !!(t && t.paused);
  let body;
  if (prep) {
    const w = voiceWarning(q.lang);
    body = '<p class="prompt" data-focus>預備…稍後自動朗讀</p>' + (w ? '<p class="muted">' + esc(w) + '</p>' : '');
  } else {
    body = '<p class="prompt" data-focus>第 ' + (q.idx + 1) + ' / ' + n + ' 個</p>';
  }
  const bar = !prep
    ? '<div class="dwell' + (paused ? ' paused' : '') + '" aria-hidden="true"><div class="dwell-fill" style="--dwell:' + t.D + 'ms;animation-delay:-' + Math.round(clockMs(t)) + 'ms"></div></div>'
    : '';
  const status = paused ? (t.reason === 'hidden' ? '已暫停（你離開咗頁面），撳繼續' : '已暫停') : '';
  return newTopHtml(s, q, prep ? '預備' : (q.idx + 1) + ' / ' + n) +
    '<div class="card quiz-card">' + body +
    '<div class="speaker static" id="speakerBtn" aria-hidden="true">🔊</div>' + bar +
    '<p class="status" id="status">' + status + '</p>' +
    '<button class="btn ghost block" id="timedBtn" data-action="timedToggle" aria-label="' + (paused ? '繼續默書' : '暫停默書') + '">' + (paused ? '▶ 繼續' : '⏸ 暫停') + '</button>' +
    (shortcutsOn() ? '<p class="kbd-hint">快捷鍵：<span>空白 = 暫停／繼續</span></p>' : '') +
    '</div>';
}

/* 自助畫面：唔顯示詞語同提示句文字（提示句只朗讀） */
function selfView(s, q) {
  const n = q.words.length;
  const first = q.idx === 0, last = q.idx === n - 1;
  const hasHint = !!(q.hints && q.hints[q.words[q.idx]]);
  return newTopHtml(s, q, (q.idx + 1) + ' / ' + n) +
    '<div class="card quiz-card">' +
    '<p class="prompt" data-focus>聽下，寫喺紙上面 ✏️</p>' +
    '<button class="speaker labeled" id="speakerBtn" data-action="selfRepeat" aria-label="重讀">🔊<small>重讀</small></button>' +
    '<div class="status" id="status"></div>' +
    langSwitch(q, 'selfLang') +
    '<div class="read-row"><button class="btn ghost small" data-action="selfSlow">🐢 再讀慢啲</button>' +
    (hasHint ? '<button class="btn ghost small" id="hintBtn" data-action="selfHint">💡 提示句</button>' : '') + '</div>' +
    '<div class="two-btns nav">' +
    '<button class="btn ghost" id="prevBtn" data-action="selfPrev"' + (first ? ' disabled' : '') + '>⬅ 上一個</button>' +
    '<button class="btn green" id="nextBtn" data-action="selfNext">' + (last ? '完成，對答案 ✓' : '下一個 ➡') + '</button></div>' +
    (shortcutsOn()
      ? '<p class="kbd-hint">快捷鍵：<span>← 上一個</span> <span>→ 下一個</span> <span>空白 = 重讀</span> <span>Enter = 下一個</span></p>' +
        '<p class="kbd-hint">焦點喺按鈕上（例如用 Tab 揀咗掣）時，空白／Enter 會直接撳該掣</p>'
      : '') +
    '</div>';
}

/* 對答案：每個詞語拆成單字字卡，預設全部「啱」，只需點選寫錯嘅字；任何一隻字錯，成個詞語就算錯 */
function reviewView(s, q) {
  const n = q.words.length, bad = rvCount(q);
  const rows = q.words.map(function (w, i) {
    const chars = Array.from(w);
    const wrong = q.rv.bad[i].length > 0;
    const cards = chars.map(function (c, j) {
      if (/\s/.test(c)) return '';
      const on = q.rv.bad[i].indexOf(j) !== -1;
      return '<button class="rv-ch" data-action="rvChar" data-i="' + i + '" data-val="' + j + '"' + pressed(on) +
        ' aria-label="' + rvCharLabel(j, c, on) + '">' + esc(c) + '</button>';
    }).join('');
    return '<li class="rv-row' + (wrong ? ' bad' : '') + '"><span class="rv-no">' + (i + 1) + '</span>' +
      '<div class="rv-chars" role="group" aria-label="第 ' + (i + 1) + ' 個詞語，逐字點選寫錯嘅字">' + cards + '</div></li>';
  }).join('');
  return newTopHtml(s, q, '共 ' + n + ' 個') +
    '<div class="card review-card"><h2 data-focus>對答案</h2>' +
    '<ul class="rv-list">' + rows + '</ul></div>' +
    '<div class="rv-bar"><span class="rv-count">錯 ' + bad + ' 個／共 ' + n + ' 個</span>' +
    '<button class="btn green" data-action="rvConfirm">確認，記錄成績 ✓</button></div>';
}

function rvCharLabel(j, c, on) {
  return '第 ' + (j + 1) + ' 個字「' + esc(c) + '」，' + (on ? '已標記為寫錯' : '標記為寫錯');
}
/* 進度條嘅動物同進度要喺畫面出現後再移動，先有滑動效果 */
function afterQuizRender() {
  const q = ui.quiz;
  const target = q.phase === 'review' ? 1 : q.phase === 'prep' ? 0 : q.idx / q.words.length;
  if (Math.abs(target - q.shown) < 0.0001) return;
  const runner = document.querySelector('.runner');
  const fill = document.querySelector('.track .fill');
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (runner) runner.style.left = 'calc((100% - 32px) * ' + target + ')';
      if (fill) fill.style.width = (target * 100) + '%';
    });
  });
  q.shown = target;
}

function wordChips(arr) {
  return '<div class="chips">' + arr.map(function (w) {
    return '<span class="chip word">' + esc(w) + '</span>';
  }).join('') + '</div>';
}

function resultView(s) {
  const r = ui.result;
  const p = pct(r.correct, r.total);
  const stars = p === 100 ? 3 : p >= 80 ? 2 : p >= 50 ? 1 : 0;
  const mascot = r.incomplete ? '📝' : p === 100 ? '🏆' : p >= 80 ? esc(s.avatar) : p >= 50 ? '💪' : '🤗';
  const msg = r.incomplete ? '答啱咗 ' + r.correct + ' 題。下次試吓默晒全部！' :
    p === 100 ? '全部啱晒！你好叻呀！' : p >= 80 ? '好勁呀！差啲就滿分！' : p >= 50 ? '幾好呀，繼續努力！' : '唔緊要，多練習就會進步！';
  let starHtml = '';
  for (let i = 0; i < 3; i++) starHtml += '<span>' + (i < stars ? '⭐' : '☆') + '</span>';
  // 中途停止：唔顯示星星同分數，改為顯示答咗幾多題
  const head = r.incomplete
    ? '<div class="score inc">未完成：答咗 ' + r.total + ' / ' + r.planned + ' 題</div>'
    : '<div class="stars">' + starHtml + '</div><div class="score">' + r.correct + ' / ' + r.total + '</div>';

  let extra = '';
  if (r.wrong.length) extra += '<div class="result-section"><h3>❌ 要再練習嘅字</h3>' + wordChips(r.wrong) + '</div>';
  if (r.added.length) extra += '<div class="result-section"><h3>👾 放咗入錯字怪獸</h3>' + wordChips(r.added) + '</div>';
  if (r.hurt.length) {
    extra += '<div class="result-section"><h3>💥 怪獸受傷咗（括號係仲要默對幾次）</h3>' +
      wordChips(r.hurt.map(function (h) { return h.word + '（' + h.left + '）'; })) + '</div>';
  }
  if (r.removed.length) extra += '<div class="result-section"><h3>🎉 打敗咗怪獸（已經記得）</h3>' + wordChips(r.removed) + '</div>';
  if (typeof r.bankLeft === 'number' && r.bankLeft > 0) {
    extra += '<p class="muted bank-left">尚餘 ' + Number(r.bankLeft) + ' 個錯字未溫，撳「再默一次」繼續打怪獸。</p>';
  }

  const srPrefix = r.mode === 'timed' || r.mode === 'self' ? QUIZ_MODES[r.mode].label + '，' : '';
  const srTitle = srPrefix + (r.incomplete ? '默書未完成：答咗 ' + r.total + ' / ' + r.planned + ' 題' :
    '默書完成：答啱 ' + r.correct + ' / ' + r.total + ' 題');
  return '<h2 class="sr-only">' + srTitle + '</h2>' +
    '<div class="card result-card"><div class="mascot">' + mascot + '</div>' + modeTagHtml(r.mode) + head +
    '<p>' + msg + '</p>' + extra + '</div>' +
    '<div class="stack" style="margin-top:20px">' +
    '<button class="btn block" data-action="again">再默一次 🔁</button>' +
    '<button class="btn blue block" data-action="openRecord" data-id="' + esc(r.recordId) + '">睇詳細對錯 🔍</button>' +
    '<button class="btn ghost block" data-action="goMenu">返主頁 🏠</button></div>';
}

/* 默書方式小標籤（定時／自助）；mode 先用嚴格相等白名單，唔直接索引 QUIZ_MODES */
function modeTagHtml(mode) {
  return mode === 'timed' || mode === 'self' ? '<span class="rec-mode">' + esc(QUIZ_MODES[mode].tag) + '</span>' : '';
}

function recRow(h) {
  const p = pct(h.correct, h.total);
  const cls = h.incomplete ? ' inc' : p >= 80 ? '' : p >= 50 ? ' mid' : ' low';
  return '<div class="rec"><button class="rec-main" data-action="openRecord" data-id="' + esc(h.id) + '">' +
    '<span class="rec-time">' + shortDate(h.date) + ' ' + timeLabel(h.date) + '</span>' +
    '<span class="rec-label">' + esc(h.label) + '</span>' + modeTagHtml(h.mode) +
    (h.incomplete ? '<span class="rec-tag">未完成</span>' : '') +
    '<span class="rec-score' + cls + '">' + h.correct + '/' + h.total + '</span></button>' +
    '<button class="icon-btn" data-action="deleteRecord" data-id="' + esc(h.id) + '" aria-label="刪除呢次紀錄">🗑</button></div>';
}

/* 平均正確率：中途停止（未完成）嘅紀錄唔計；冇完成紀錄就顯示「—」 */
function avgText(list) {
  const done = list.filter(function (h) { return !h.incomplete; });
  if (!done.length) return '—';
  const c = done.reduce(function (a, h) { return a + h.correct; }, 0);
  const t = done.reduce(function (a, h) { return a + h.total; }, 0);
  return pct(c, t) + '%';
}

/* 由默書紀錄整理出：每個詞語入面，邊幾個字曾經寫錯（位置） */
function badIndexMap(s) {
  const map = Object.create(null);   // 詞語做 key，唔可以撞到 constructor 等原型屬性
  s.history.forEach(function (h) {
    (h.results || []).forEach(function (r) {
      if (r.ok || !r.bad || !r.bad.length) return;
      const list = map[r.word] || (map[r.word] = []);
      r.bad.forEach(function (i) { if (list.indexOf(i) === -1) list.push(i); });
    });
  });
  return map;
}

function statsView(s) {
  const hist = s.history;
  if (!hist.length) {
    return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
      '<div class="card"><h2>我的成績</h2><div class="empty"><span class="em">📊</span>仲未有成績，去默一次書啦！</div></div>';
  }
  const avg = avgText(hist);

  const recent = hist.slice(-10);
  const bars = recent.map(function (h) {
    // 未完成紀錄用原定題數做分母（例如 5 題答啱 2 題 = 40%）；已完成紀錄 planned 等於 total
    const p = pct(h.correct, h.planned);
    const cls = h.incomplete ? 'inc' : p >= 80 ? '' : p >= 50 ? 'mid' : 'low';
    return '<div class="bar-col"' + (h.incomplete ? ' title="未完成"' : '') + '><span class="v">' + (h.incomplete ? '未完' : p) + '</span>' +
      '<div class="bar ' + cls + '" style="height:' + Math.max(p, 3) + '%"></div>' +
      '<small>' + shortDate(h.date) + '</small></div>';
  }).join('');

  const isChar = ui.statTab === 'char';
  const src = isChar ? s.charStats : s.wordStats;
  const rows = Object.keys(src).map(function (k) {
    const st = src[k];
    return { w: k, attempts: st.attempts, wrong: st.wrong, rate: Math.min(100, pct(st.wrong, st.attempts)) };
  }).filter(function (x) { return x.wrong > 0; }).sort(function (a, b) {
    return isChar ? b.wrong - a.wrong || b.rate - a.rate : b.rate - a.rate || b.wrong - a.wrong;
  }).slice(0, 15);

  const badMap = badIndexMap(s);
  const emptyMsg = isChar
    ? '仲未有單字統計。默書對答案時點選寫錯嘅字，就會記錄到。'
    : '到依家一個字都冇錯過！';
  const rateHtml = rows.length ? rows.map(function (x) {
    return '<div class="rate-row"><span class="w">' + (isChar ? esc(x.w) : charsHtml(x.w, badMap[x.w])) + '</span>' +
      '<span class="meter"><i style="width:' + x.rate + '%"></i></span>' +
      '<span class="pct">錯 ' + x.wrong + '/' + x.attempts + '（' + x.rate + '%）</span></div>';
  }).join('') : '<div class="empty"><span class="em">🌟</span>' + emptyMsg + '</div>';

  const tab = function (key, label) {
    return '<button class="chip' + (ui.statTab === key ? ' on' : '') + '" data-action="setStatTab" data-val="' + key + '"' + pressed(ui.statTab === key) + '>' + label + '</button>';
  };

  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<h2 class="sr-only">我的成績</h2>' +
    '<div class="stack">' +
    '<div class="card"><div class="summary">' +
    '<div><div class="num">' + hist.length + '</div><div class="muted">默書次數</div></div>' +
    '<div><div class="num">' + avg + '</div><div class="muted">平均正確率</div></div>' +
    '<div><div class="num">' + Object.keys(s.bank).length + '</div><div class="muted">錯字怪獸</div></div></div></div>' +
    '<div class="card"><h3>最近 ' + recent.length + ' 次成績（%）</h3><div class="bars">' + bars + '</div></div>' +
    '<div class="card"><h3>' + (isChar ? '最常寫錯嘅字（錯誤次數）' : '最易錯嘅字（錯誤率）') + '</h3>' +
    '<div class="toggle-select" style="margin:10px 0">' + tab('word', '詞語') + tab('char', '單字') + '</div>' +
    (isChar ? '' : '<p class="muted">紅色標記 = 曾經寫錯嘅字</p>') +
    rateHtml + '</div>' +
    '<div class="card"><h3>最近紀錄</h3>' + hist.slice(-5).reverse().map(recRow).join('') + '</div>' +
    '<button class="btn ghost block" data-action="goHistory">睇晒所有紀錄（' + hist.length + '）→</button></div>';
}

function historyView(s) {
  const hist = s.history;
  const back = '<div class="topnav"><button class="back" data-action="goStats">← 返回</button></div>';
  if (!hist.length) {
    return back + '<div class="card"><h2>所有紀錄</h2><div class="empty"><span class="em">🗒️</span>冇紀錄</div></div>';
  }

  // 按日子分組，最新嘅喺最頂
  const groups = [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const key = dayKey(hist[i].date);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key: key, date: hist[i].date, items: [] };
      groups.push(g);
    }
    g.items.push(hist[i]);
  }

  const cards = groups.map(function (g) {
    return '<div class="card"><div class="day-head wrap"><div class="t"><b>' + dayLabel(g.date) + '</b>' +
      '<div class="muted">' + g.items.length + ' 次 · 平均 ' + avgText(g.items) + '</div></div>' +
      '<button class="btn ghost small" data-action="deleteDay" data-day="' + esc(g.key) + '">🗑 刪除呢日</button></div>' +
      g.items.map(recRow).join('') + '</div>';
  }).join('');

  return back + '<h2>所有紀錄</h2><p class="muted history-note">只保留最近 ' + HISTORY_MAX + ' 次默書紀錄，更舊嘅會自動刪走。</p>' +
    '<div class="stack">' + cards + '</div>';
}

function recordView(s) {
  const h = s.history.find(function (x) { return x.id === ui.recordId; });
  const back = '<div class="topnav"><button class="back" data-action="closeRecord">← 返回</button></div>';
  if (!h) {
    return back + '<div class="card"><div class="empty"><span class="em">🗒️</span>搵唔到呢個紀錄</div></div>';
  }

  const p = pct(h.correct, h.total);
  let list;
  if (h.results) {
    list = h.results.map(function (r) {
      return '<div class="word-row ' + (r.ok ? 'ok' : 'bad') + '"><span class="mark">' + (r.ok ? '✓' : '✗') + '</span>' +
        '<span class="wtxt">' + charsHtml(r.word, r.bad) + '</span></div>';
    }).join('');
  } else {
    // 舊版紀錄冇逐個詞語嘅資料，只知道錯咗邊啲
    list = '<p class="muted">呢個係舊版本嘅紀錄，只有錯咗嘅詞語。</p>' +
      (h.wrong && h.wrong.length ? wordChips(h.wrong) : '<div class="empty"><span class="em">🌟</span>全部啱晒</div>');
  }

  return back +
    '<div class="card"><div class="day-head"><div class="t"><h2>' + esc(h.label) + '</h2>' +
    '<div class="muted">' + dayLabel(h.date) + ' ' + timeLabel(h.date) + '</div>' +
    '<div class="muted">預設朗讀：' + (LANGS[h.lang] || LANGS.yue).label + '</div>' +
    (modeTagHtml(h.mode) ? '<div>' + modeTagHtml(h.mode) + '</div>' : '') +
    (h.incomplete ? '<div class="rec-tag">未完成：答咗 ' + h.total + ' / ' + h.planned + ' 題</div>' : '') + '</div>' +
    '<span class="rec-score' + (h.incomplete ? ' inc' : p >= 80 ? '' : p >= 50 ? ' mid' : ' low') + '">' + h.correct + '/' + h.total + '</span></div>' +
    '<div style="margin-top:8px">' + list + '</div></div>' +
    '<button class="btn ghost block" style="margin-top:20px" data-action="deleteRecord" data-id="' + esc(h.id) + '">🗑 刪除呢次紀錄</button>';
}

/* =====================================================
   默書流程（朗讀狀態）
   定時／自助各自嘅時序喺 timed*／self* 函數入面處理，呢度只留朗讀掣動畫
   ===================================================== */
function setSpeaking(on) {
  const b = document.getElementById('speakerBtn');
  if (b) b.classList.toggle('speaking', on);
}

function finishQuiz(s) {
  const q = ui.quiz;
  const correct = q.results.filter(function (r) { return r.ok; }).length;
  const wrong = q.results.filter(function (r) { return !r.ok; }).map(function (r) { return r.word; });
  const rec = {
    id: uid(),
    date: new Date().toISOString(),
    label: q.label,
    source: q.source,
    lang: q.lang,
    total: q.results.length,   // 實際答咗嘅題數
    mode: q.mode,   // timed／self
    planned: q.words.length,   // 原定題數
    incomplete: q.results.length < q.words.length,
    correct: correct,
    wrong: wrong,
    results: q.results.map(function (r) { return { word: r.word, ok: r.ok, bad: r.bad }; })
  };
  s.history.push(rec);
  if (s.history.length > HISTORY_MAX) s.history = s.history.slice(-HISTORY_MAX);
  saveDB();
  // 錯字怪獸模式：庫內今次冇答過嘅錯字數（中途停止時未答嘅都計）；其他模式唔顯示
  let bankLeft = null;
  if (q.source === 'bank') {
    const answered = new Set(q.results.map(function (r) { return r.word; }));
    bankLeft = Object.keys(s.bank).filter(function (w) { return !answered.has(w); }).length;
  }
  ui.result = {
    total: rec.total, planned: rec.planned, incomplete: rec.incomplete, mode: rec.mode,
    correct: correct, wrong: wrong, recordId: rec.id,
    added: q.added, removed: q.removed, hurt: q.hurt, bankLeft: bankLeft
  };
  go('result');
  const p = pct(correct, rec.total);
  if (p >= 80 && !rec.incomplete) confetti(p === 100 ? 70 : 35);
}

/* =====================================================
   互動（data-action 對應嘅處理函式）
   ===================================================== */
const actions = {};

/* 同一組選項入面，只更新 class，唔重新畫整個畫面（避免閃爍） */
function selectInGroup(el) {
  Array.prototype.forEach.call(el.parentElement.children, function (x) {
    x.classList.remove('on');
    if (x.hasAttribute('aria-pressed')) x.setAttribute('aria-pressed', 'false');
  });
  el.classList.add('on', 'pop');
  el.setAttribute('aria-pressed', 'true');
  setTimeout(function () { el.classList.remove('pop'); }, 450);
}

Object.assign(actions, {
  goHome: function () { lockPin(); db.currentId = null; saveDB(); go('home'); },   // 換人＝交畀其他人用，家長 PIN 即鎖
  goAdd: function () { ui.form = { name: '', grade: 1, avatar: AVATARS[0] }; go('add'); },
  setForm: function (el) {
    const key = el.dataset.key;
    ui.form[key] = key === 'grade' ? Number(el.dataset.val) : el.dataset.val;
    selectInGroup(el);
  },
  saveStudent: function () {
    const name = ui.form.name.trim();
    if (!name) { toast('請輸入名字'); return; }
    const s = newStudent(name, ui.form.grade, ui.form.avatar);
    db.students.push(s);
    db.currentId = s.id;
    saveDB();
    go('menu');
  },
  pickStudent: function (el) { db.currentId = el.dataset.id; saveDB(); go('menu'); },
  deleteStudent: function () {
    const s = me();
    confirmBox({
      icon: '🗑', title: '刪除「' + s.name + '」？',
      text: '所有詞庫同成績都會消失，無法還原。', okText: '刪除', danger: true
    }, function () {
      db.students = db.students.filter(function (x) { return x.id !== s.id; });
      db.currentId = null;
      saveDB();
      go('home');
    });
  },

  /* 備份：先記低 lastBackupAt 再匯出（備份檔入面嘅時間就係今次）。
     瀏覽器冇辦法確認檔案真係存咗，所以以「已觸發下載」計；匯出途中出錯就還原舊時間，唔會誤報已備份 */
  exportData: function () {
    const prev = db.lastBackupAt;
    const d = new Date();
    try {
      db.lastBackupAt = d.toISOString();
      // 備份檔唔包括家長 PIN（PIN 屬於呢部機嘅防誤觸設定，唔跟檔案流動）
      const out = Object.assign({}, db);
      delete out.parentPin;
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chi-vocab-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    } catch (e) {
      db.lastBackupAt = prev;
      toast('備份失敗，請再試一次');
      return;
    }
    saveDB();
    toast('已備份 ✓');
    render();   // 更新提醒同「上次備份」
  },
  snoozeBackup: function () { ui.backupSnoozed = true; render(); },
  dismissA2hs: function () {
    try { localStorage.setItem(A2HS_KEY, '1'); } catch (e) { /* 儲存唔到：今次關閉，下次再提示 */ }
    render();
  },
  importData: function () { document.getElementById('importFile').click(); },

  goMenu: function () { go('menu'); },
  goLessons: function () { ui.editLessonId = null; ui.editBase = null; go('lessons'); },
  /* 編輯頁嘅「← 返回」：有未儲存改動先問；取消就停留喺編輯頁，輸入內容原封不動 */
  leaveEdit: function () {
    if (!editDirty()) { actions.goLessons(); return; }
    confirmBox({
      icon: '📝', title: '未儲存，確定離開？',
      text: '你改咗嘅課文名稱或者詞語唔會儲存。', okText: '離開', danger: true
    }, function () {
      if (ui.view === 'lessonEdit') actions.goLessons();
    });
  },
  newLesson: function () { ui.editLessonId = null; go('lessonEdit'); },
  editLesson: function (el) { ui.editLessonId = el.dataset.id; go('lessonEdit'); },
  deleteLesson: function (el) {
    const s = me();
    const l = s.lessons.find(function (x) { return x.id === el.dataset.id; });
    if (!l) return;
    confirmBox({
      icon: '🗑', title: '刪除「' + l.title + '」？',
      text: '成績紀錄會保留。', okText: '刪除', danger: true
    }, function () {
      s.lessons = s.lessons.filter(function (x) { return x.id !== l.id; });
      saveDB();
      render();
    });
  },
  saveLesson: function () {
    const s = me();
    const title = document.getElementById('lessonTitle').value.trim();
    const parsed = parseLesson(document.getElementById('lessonWords').value);
    if (!title) { toast('請輸入課文名稱'); return; }
    if (!parsed.words.length) { toast('請最少輸入一個詞語'); return; }
    const existing = ui.editLessonId && s.lessons.find(function (l) { return l.id === ui.editLessonId; });
    if (existing) { existing.title = title; existing.words = parsed.words; existing.hints = parsed.hints; }
    else { s.lessons.push({ id: uid(), title: title, words: parsed.words, hints: parsed.hints }); }
    saveDB();
    toast('已儲存 ✓');
    actions.goLessons();
  }
});

/* ---------- 分享課文 ---------- */
Object.assign(actions, {
  shareLesson: function (el) {
    const s = me();
    const l = s && s.lessons.find(function (x) { return x.id === el.dataset.id; });
    if (!l) return;
    const text = shareLessonText(l);
    const payload = encodeShare(text);
    const linkOk = payload.length <= SHARE_PAYLOAD_MAX;
    ui.shareOut = { text: text, link: linkOk ? shareBaseUrl() + '#lesson=' + payload : '' };
    confirmBox({
      icon: '📤', title: '分享「' + l.title + '」',
      text: '複製文字或者連結，傳畀朋友。對方喺「我的詞庫」撳「匯入課文」貼上就得。',
      okText: '完成', single: true,
      bodyHtml: '<label class="field-label sr-only" for="shareText">分享文字</label>' +
        '<textarea id="shareText" class="share-text" readonly>' + esc(text) + '</textarea>' +
        '<div class="copy-row"><button class="btn blue small" data-action="copyShareText">複製文字</button>' +
        '<button class="btn blue small" data-action="copyShareLink"' + (linkOk ? '' : ' disabled') + '>複製連結</button></div>' +
        (linkOk ? '' : '<p class="field-error">課文太長，請用文字分享。</p>'),
      focusSel: '[data-action=copyShareText]'
    }, function () {});
  },
  copyShareText: function () {
    if (ui.shareOut) copyText(ui.shareOut.text, document.getElementById('shareText'));
  },
  copyShareLink: function () {
    if (ui.shareOut && ui.shareOut.link) copyText(ui.shareOut.link);
  },
  goLessonImport: function () { go('lessonImport'); },
  /* 預覽：貼文字或者成條連結（抽出 #lesson= 後面部分）都得；校驗失敗彈錯誤框，成功彈預覽 */
  previewImport: function () {
    const box = document.getElementById('importText');
    const v = box ? box.value.trim() : '';
    try {
      const at = v.indexOf('#lesson=');
      ui.share = validateSharedLesson(at === -1 ? v : decodeShare(v.slice(at + 8).split(/\s/)[0]));
    } catch (e) {
      ui.share = null;
      shareError(e.message);
      return;
    }
    pumpShare();
  },
  cancelShare: function () { discardShare(); render(); }
});

/* ---------- 列印練習紙（T5.5）：唔改資料，唔經 guarded（唔需要 PIN） ---------- */
Object.assign(actions, {
  printLesson: function (el) { openPrintDialog('lesson', el.dataset.id); },
  printBank: function () { openPrintDialog('bank'); },
  printOpt: function (el) {
    if (!ui.print) return;
    const key = el.dataset.key;
    const val = el.dataset.val;
    const o = Object.assign({}, ui.printOpts || {});
    if (key === 'mode') {
      if (val !== 'practice' && val !== 'dictation') return;
      o.mode = val;
    } else if (key === 'cells') {
      const n = Number(val);
      if (PRINT_CELLS.indexOf(n) === -1) return;
      o.cells = n;
    } else if (key === 'trace' || key === 'hints' || key === 'answers') {
      o[key] = val === '1';
    } else {
      return;
    }
    ui.printOpts = o;
    refreshPrint();
  }
});

/* ---------- 默書 ---------- */
Object.assign(actions, {
  goSetup: function (el) { initSetup(me(), el.dataset.source); go('setup'); },
  setOpt: function (el) {
    const key = el.dataset.key;
    // 轉「默邊度」：數量重設為新模式嘅預設（課文 12、錯字怪獸 10）
    if (key === 'source' && ui.setup.source !== el.dataset.val) ui.setup.count = countDefault(el.dataset.val);
    ui.setup[key] = el.dataset.val;
    render();  // 內容唔同，要重畫
  },
  removeBank: function (el) {
    const s = me();
    const w = el.dataset.word;
    if (!s.bank[w]) return;
    confirmBox({
      icon: '👾', title: '刪除「' + w + '」？',
      text: '會由錯字怪獸移走，之後唔會再喺怪獸默書出現。成績紀錄會保留。',
      okText: '刪除', danger: true
    }, function () {
      delete s.bank[w];
      const ws = s.wordStats[w];
      if (ws && ws.bankEntries) ws.bankEntries = Math.max(0, ws.bankEntries - 1);
      saveDB();
      toast('已刪除');
      render();
    });
  },
  goSettings: function () { go('settings'); },
  saveProfileName: function () { saveProfileName(); },
  setMyAvatar: function (el) {
    const s = me();
    if (s.avatar === el.dataset.val) return;
    s.avatar = el.dataset.val;
    saveDB();
    selectInGroup(el);
    toast('已更新 ✓');
  },
  setMyGrade: function (el) {
    const s = me();
    const g = Number(el.dataset.val);
    if (!Number.isInteger(g) || g < 1 || g > GRADES.length || s.grade === g) return;   // 只接受 1–6
    s.grade = g;
    saveDB();
    selectInGroup(el);
    toast('已更新 ✓');
  },
  setPref: function (el) {
    const s = me();
    s.prefs[el.dataset.key] = el.dataset.val;
    saveDB();
    selectInGroup(el);
    if (el.dataset.key === 'lang') {
      if (hasKey(LANGS, el.dataset.val)) ui.voiceLang = el.dataset.val;   // 預設朗讀語言一改，聲音編輯語言跟住轉
      updateVoiceNotice();
    }
  },
  setShortcuts: function (el) {
    const s = me();
    s.prefs.shortcuts = el.dataset.val === '1';
    saveDB();
    selectInGroup(el);
  },
  toggleLesson: function (el) {
    const ids = ui.setup.lessonIds;
    const i = ids.indexOf(el.dataset.id);
    if (i === -1) ids.push(el.dataset.id); else ids.splice(i, 1);
    el.setAttribute('aria-pressed', String(el.classList.toggle('on')));
    el.classList.add('pop');
    setTimeout(function () { el.classList.remove('pop'); }, 450);
    refreshCount();
  },
  allLessons: function () {
    const s = me();
    const all = ui.setup.lessonIds.length !== s.lessons.length;
    ui.setup.lessonIds = all ? s.lessons.map(function (l) { return l.id; }) : [];
    document.querySelectorAll('[data-action=toggleLesson]').forEach(function (b) {
      b.classList.toggle('on', all);
      b.setAttribute('aria-pressed', String(all));
    });
    refreshCount();
  },
  testVoice: function () {
    unlockSpeech();
    const s = me();
    const lk = voiceLangKey(s);   // 跟設定頁下拉選單揀咗嘅語言；普通話讀書面語試聽句
    speak(VOICE_TEST[lk], lk, SPEEDS[s.prefs.speed].rate);
  },

  startQuiz: function () {
    lockPin();   // 開始默書通常係交畀小朋友，家長 PIN 即鎖
    const s = me();
    const c = ui.setup;
    const mode = normaliseMode(c.mode);   // 白名單；非法值（包括已移除嘅 'normal'）回落預設
    if (mode === 'timed' && !('speechSynthesis' in window)) { toast('呢個瀏覽器唔支援朗讀，用唔到定時默書'); return; }
    let words = [];
    let label = '';
    let hints;
    if (c.source === 'bank') {
      words = bankQueue(s);   // 最耐冇默對嘅排最前
      label = '錯字怪獸';
      hints = hintMap(s.lessons);   // 錯字喺邊課有提示句都讀埋
    } else {
      const picked = s.lessons.filter(function (l) { return c.lessonIds.indexOf(l.id) !== -1; });
      if (!picked.length) { toast('請先揀最少一課'); return; }
      hints = hintMap(picked);
      const seen = new Set();
      picked.forEach(function (l) {
        l.words.forEach(function (w) { if (!seen.has(w)) { seen.add(w); words.push(w); } });
      });
      label = picked.length > 2
        ? picked[0].title + ' 等' + picked.length + '課'
        : picked.map(function (l) { return l.title; }).join('、');
    }
    if (!words.length) { toast('冇詞語可以默'); return; }
    const total = words.length;
    // 兩個模式都可以揀默幾多個：最少 1 個，最多係全部，超出嘅數字會被限制返
    const n = c.count != null ? Math.max(1, Math.min(c.count, total)) : total;
    const p = s.prefs;   // 次序、朗讀語言、速度全部由設定頁讀取
    if (c.source === 'bank') {
      // 錯字怪獸：攞最耐冇默對嘅頭 n 個（唔隨機抽）；亂序模式先打亂呢 n 個
      words = words.slice(0, n);
      if (p.order === 'random') words = shuffle(words);
      if (n < total) label += '（先默 ' + n + ' 個）';
    } else {
      words = pickWords(words, n, p.order);
      if (n < total) label += p.order === 'random' ? '（抽 ' + n + ' 個）' : '（頭 ' + n + ' 個）';
    }
    if (c.source === 'lessons') {   // 成功開始先記住今次揀嘅課文
      p.lastLessonIds = c.lessonIds.filter(function (id) { return s.lessons.some(function (l) { return l.id === id; }); });
      saveDB();
    }
    unlockSpeech();
    ui.quiz = {
      source: c.source, label: label, words: words, idx: 0, results: [],
      added: [], removed: [], hurt: [], lang: p.lang, speed: p.speed, shown: 0,
      hints: hints, hintSpeed: p.hintSpeed,
      mode: mode, curLang: p.lang, seq: 0, rv: null, committed: false, aborted: false, t: null, stepAt: 0
    };
    preloadAnswerFont(words);
    if (mode === 'timed') {
      ui.quiz.phase = 'prep';
      go('quiz');
      timedBegin(-1, 0);
    } else if (mode === 'self') {
      const q = ui.quiz;
      q.phase = 'run';
      q.stepAt = performance.now();   // 單詞語課文：開始後 SELF_LAST_GUARD_MS 內亦唔受理「完成，對答案」
      go('quiz');
      if (!('speechSynthesis' in window)) setSelfStatus('呢個瀏覽器唔支援朗讀，自助默書冇聲音');
      else {
        setSelfStatus(WAIT_HTML, true);
        timers.run = setTimeout(selfSpeak, FIRST_DELAY);
      }
    }
  },
  again: function () {
    if (ui.setup) actions.startQuiz(); else go('menu');
  }
});

/* ---------- 默書中 ---------- */
Object.assign(actions, {
  // 定時／自助：停止唔記錄任何嘢
  quit: function () { if (ui.quiz) quitNew(ui.quiz); }
});

/* ---------- 新默書方式：定時全自動／學生自助 ----------
   兩種方式都唔即時寫統計：默寫完進入「對答案」（review）階段，家長確認後由 commitReview 批量
   調用既有 recordAnswer，再交畀 finishQuiz 寫入紀錄。中途停止唔記錄任何嘢。 */

/* 字數：去咗空白之後嘅字元數 */
function wordLen(w) { return Array.from(String(w)).filter(function (c) { return !/\s/.test(c); }).length; }
/* 字數 → 四級（0..3）；1 字併入「2 字或以下」 */
function tierOf(n) { return Math.min(Math.max(n, 2), 5) - 2; }
function dwellMs(prefs, w) { return prefs.timed.secs[tierOf(wordLen(w))] * 1000; }
/* n 次朗讀平均分佈喺停留時間 D 內：第 k 次喺第 k 格時間槽嘅起點開始，最後一次起點 < D */
function readOffsets(D, n) { return Array.from({ length: n }, function (_, k) { return Math.round(k * D / n); }); }

/* 時鐘：一段 = 預備（seg = -1）或一個詞語（seg = 0…n-1）。虛擬時間 = elapsed + 本段運行時間 */
function newClock(seg, D, offs, carry) {
  return {
    seg: seg, D: D, offs: offs, nextRead: 0,   // nextRead：下一次未開始嘅朗讀下標
    live: -1, liveEnded: true, liveAt: 0, redo: false,   // live：最近開始嘅朗讀下標；liveEnded：收到完結事件；liveAt：呢次朗讀開始時嘅 clockMs
    dueAt: 0,                                  // 下一個事件嘅 clockMs，武裝 timer 時寫入，供暫停時夾住 elapsed
    elapsed: carry || 0, since: null,          // since = null 代表暫停或未開始
    paused: false, reason: '', seq: 0          // seq：令舊朗讀嘅 hook 失效
  };
}
function clockMs(t) { return t.elapsed + (t.since == null ? 0 : performance.now() - t.since); }

function timedAlive(q) { return ui.view === 'quiz' && ui.quiz === q && !q.aborted && q.mode === 'timed' && q.phase !== 'review'; }

/* 開始一段（seg = -1 預備，否則第 seg 個詞語）；carry = 上一段遲到嘅毫秒 */
function timedBegin(seg, carry) {
  const q = ui.quiz;
  q.idx = Math.max(seg, 0);
  q.phase = seg < 0 ? 'prep' : 'run';
  const D = seg < 0 ? TIMED_PREP_MS : dwellMs(me().prefs, q.words[seg]);
  q.t = newClock(seg, D, seg < 0 ? [] : readOffsets(D, me().prefs.timed.reads), carry);
  render();   // 倒數條用 animation-delay:-clockMs 還原位置
  if (seg >= 0) announce('第 ' + (seg + 1) + ' / ' + q.words.length + ' 個');
  q.t.since = performance.now();
  timedFire();
}

/* 核心：只喺運行中（since != null）執行，每次只武裝一個 timeout，指向下一個事件（朗讀或詞語結束） */
function timedFire() {
  const q = ui.quiz, t = q && q.t;
  timers.run = null;
  if (!t || t.since == null || !timedAlive(q)) return;
  const el = clockMs(t);
  let due = -1;
  while (t.nextRead < t.offs.length && el >= t.offs[t.nextRead] - 4) { due = t.nextRead; t.nextRead += 1; }
  if (due >= 0) timedRead(q, t, due);   // 同一刻多次到期（極端延遲）只讀最後一次
  if (el >= t.D - 4) { timedEnd(q, el - t.D); return; }
  const next = Math.min(t.nextRead < t.offs.length ? t.offs[t.nextRead] : Infinity, t.D);
  t.dueAt = next;
  timers.run = setTimeout(timedFire, Math.max(0, next - el));
}

/* 朗讀一次。一律 0ms 延後 speak()，令 timedEnd 嘅硬取消同下一個詞語首句分屬不同 task；唔影響時間線 */
function timedRead(q, t, k) {
  t.live = k; t.liveEnded = false; t.liveAt = clockMs(t);
  const seq = (t.seq += 1);
  const same = function () { return ui.quiz === q && q.t === t && t.seq === seq; };
  clearTimeout(timers.speak);
  timers.speak = setTimeout(function () {
    timers.speak = null;
    if (!same() || t.since == null) return;   // 期間已暫停／換詞語／離開：唔讀
    speak(q.words[q.idx], q.lang, SPEEDS[q.speed].rate, {
      onstart: function () { if (same()) setSpeaking(true); },
      onend: function () { if (same()) { t.liveEnded = true; setSpeaking(false); } }   // onerror 同樣走 onend（speak() 已綁定）
    });
  }, 0);
}

/* 一段完結：硬切斷仍在進行或未發聲嘅朗讀，唔同下一個詞語重疊 */
function timedEnd(q, late) {
  const t = q.t;
  clearTimeout(timers.speak); timers.speak = null;
  t.seq += 1; currentUtterance = null; stopSpeech();
  if (t.seg >= q.words.length - 1) { enterReview(); return; }
  timedBegin(t.seg + 1, Math.min(250, Math.max(0, late)));   // 遲到量帶入下一段，上限 250ms
}

/* 暫停：返回「呢次呼叫之前係咪運行緊」。reason：'user'（掣／快捷鍵）、'hidden'（頁面隱藏）、'dialog'（確認框期間） */
function timedPause(reason) {
  const q = ui.quiz, t = q && q.t;
  if (!q || !t || !timedAlive(q) || t.since == null) return false;
  clearTimeout(timers.run); timers.run = null;
  clearTimeout(timers.speak); timers.speak = null;
  const now = clockMs(t);
  // 夾住 elapsed：若瀏覽器先凍結 timer、之後才派發 hidden，now 會包含凍結時間；最多容許超出下一事件到期時間 TIMED_DUE_SLACK_MS
  t.elapsed = Math.min(now, Math.max(t.dueAt, 0) + TIMED_DUE_SLACK_MS);
  t.since = null; t.paused = true; t.reason = reason;
  // 朗讀到一半被截斷，繼續時先重讀；超過 TIMED_LIVE_MAX_MS 仲未收到 onend（例如 iOS 漏發）當已讀完
  t.redo = t.live >= 0 && !t.liveEnded && (t.elapsed - t.liveAt) < TIMED_LIVE_MAX_MS;
  t.seq += 1; currentUtterance = null; stopSpeech(); setSpeaking(false);
  timedPausedUi(true, reason);
  return true;
}

function timedResume() {
  const q = ui.quiz, t = q && q.t;
  if (!q || !t || t.since != null || !timedAlive(q)) return;
  const was = t.reason;
  t.paused = false; t.reason = ''; t.since = performance.now();
  timedPausedUi(false, was);
  if (t.redo) { t.redo = false; timedRead(q, t, t.live); }   // 同一個下標，nextRead 不變，所以完整讀完次數不變
  timedFire();
}

/* 只改 DOM，唔 render()：倒數條停喺原位，繼續後由原位續跑。#status 純視覺，公佈只走 announce() */
function timedPausedUi(on, reason) {
  const q = ui.quiz, t = q && q.t;
  if (!t) return;
  const d = document.querySelector('.dwell');
  if (d) d.classList.toggle('paused', on);
  const b = document.getElementById('timedBtn');
  if (b) {
    b.textContent = on ? '▶ 繼續' : '⏸ 暫停';
    b.setAttribute('aria-label', on ? '繼續默書' : '暫停默書');
  }
  const st = document.getElementById('status');
  if (st) st.textContent = on ? (reason === 'hidden' ? '已暫停（你離開咗頁面），撳繼續' : '已暫停') : '';
  if (reason !== 'dialog') announce(on ? (reason === 'hidden' ? '已暫停，你離開咗頁面' : '已暫停') : '繼續默書');
  // 只有鍵盤啟動嘅暫停同頁面隱藏造成嘅暫停先搬焦點去「繼續」；滑鼠／觸控維持 blur，等空白快捷鍵繼續生效
  if (on && b && ((reason === 'user' && ui.lastInputKbd) || reason === 'hidden')) focusEl(b);
}

Object.assign(actions, {
  timedToggle: function () {
    const q = ui.quiz;
    if (!q || q.mode !== 'timed' || q.t == null) return;
    if (q.t.paused) timedResume(); else timedPause('user');
  }
});

/* ----- 自助默書 ----- */
/* 狀態列：asHtml 只可以傳常數 WAIT_HTML；其餘一律 textContent */
function setSelfStatus(text, asHtml) {
  const st = document.getElementById('status');
  if (!st) return;
  if (asHtml) st.innerHTML = text; else st.textContent = text;
}

/* 取消排程中同進行中嘅朗讀；所有切換都先經佢（q.seq 令舊 hook 失效） */
function selfCancel() {
  const q = ui.quiz;
  clearTimeout(timers.run); timers.run = null;
  if (q) q.seq += 1;
  currentUtterance = null; stopSpeech(); setSpeaking(false);
}

function selfSpeak(rate) {
  const q = ui.quiz;
  timers.run = null;
  if (!q || q.mode !== 'self' || q.phase !== 'run' || q.aborted || ui.view !== 'quiz') return;
  const idx = q.idx, seq = (q.seq += 1);
  const same = function () { return ui.quiz === q && q.idx === idx && q.seq === seq; };
  setSelfStatus('');
  speak(q.words[idx], q.curLang, typeof rate === 'number' ? rate : SPEEDS[q.speed].rate, {
    onstart: function () { if (same()) setSpeaking(true); },
    onend: function () { if (same()) setSpeaking(false); }
  });
}

/* render() 之後：鍵盤用家焦點如果跌咗落 body／已 disabled 嘅掣，放去非按鈕嘅提示句，
   咁空白／Enter 仍然係快捷鍵（重讀），唔會變成原生撳「下一個」 */
function keepSelfFocus() {
  const a = document.activeElement;
  if (!ui.lastInputKbd) return;   // 滑鼠／觸控：維持 blur
  if (a && a !== document.body && !a.disabled) return;
  const t = $app.querySelector('[data-focus]');
  if (t) focusEl(t);
}

/* 上一個／下一個 */
function selfStep(delta) {
  const q = ui.quiz;
  const to = q.idx + delta;
  if (q.phase !== 'run' || to < 0 || to >= q.words.length) return;
  selfCancel();
  q.idx = to; q.curLang = q.lang;
  q.stepAt = performance.now();   // 最後一個詞語防連點用
  render();
  announce('第 ' + (to + 1) + ' / ' + q.words.length + ' 個');
  keepSelfFocus();
  setSelfStatus(WAIT_HTML, true);
  timers.run = setTimeout(selfSpeak, SELF_SPEAK_DELAY);
}

/* click 同鍵盤（→、Enter）共用入口 */
function selfNext() {
  const q = ui.quiz;
  if (!q || q.mode !== 'self' || q.phase !== 'run') return;
  if (q.idx === q.words.length - 1) {
    // 剛切到最後一個詞語 SELF_LAST_GUARD_MS 內忽略「完成，對答案」，防連點令學生未聽最後一個詞語就掉入不可返回嘅對答案
    if (performance.now() - q.stepAt < SELF_LAST_GUARD_MS) return;
    enterReview();
    return;
  }
  selfStep(1);
}

function selfPrev() {
  const q = ui.quiz;
  if (!q || q.mode !== 'self' || q.phase !== 'run') return;
  selfStep(-1);
}

Object.assign(actions, {
  selfPrev: selfPrev,
  selfNext: selfNext,
  selfRepeat: function () {
    const q = ui.quiz;
    if (!q || q.mode !== 'self' || q.phase !== 'run') return;
    selfCancel(); selfSpeak();
  },
  selfSlow: function () {
    const q = ui.quiz;
    if (!q || q.mode !== 'self' || q.phase !== 'run') return;
    selfCancel(); selfSpeak(SLOW_RATE);
  },
  // 提示句：只朗讀，畫面唔顯示句子；同語言、同聲音、hintSpeed 速度
  selfHint: function () {
    const q = ui.quiz;
    if (!q || q.mode !== 'self' || q.phase !== 'run') return;
    const hint = q.hints ? q.hints[q.words[q.idx]] || '' : '';
    if (!hint) return;
    selfCancel();
    const idx = q.idx, seq = (q.seq += 1);
    const same = function () { return ui.quiz === q && q.idx === idx && q.seq === seq; };
    setSelfStatus('');
    speak(hint, q.curLang, SPEEDS[q.hintSpeed || q.speed].rate, {
      onstart: function () { if (same()) setSpeaking(true); },
      onend: function () { if (same()) setSpeaking(false); }
    });
  },
  selfLang: function (el) {
    const q = ui.quiz, val = el.dataset.val;
    if (!q || q.mode !== 'self' || q.phase !== 'run' || !hasKey(LANGS, val)) return;   // 非法值靜默忽略
    q.curLang = val;
    Array.prototype.forEach.call(el.parentElement.children, function (x) {
      x.classList.toggle('on', x === el);
      x.setAttribute('aria-pressed', String(x === el));
    });
    selfCancel(); selfSpeak();
  }
});

/* ----- 對答案與結算（兩種新方式共用） ----- */
function enterReview() {
  const q = ui.quiz;
  clearTimers(); currentUtterance = null; stopSpeech(); setSpeaking(false);
  q.phase = 'review';
  q.rv = { bad: q.words.map(function () { return []; }) };
  ui.clickGuardUntil = performance.now() + CLICK_GUARD_MS;   // 防「完成，對答案」連點後第二下落喺清單上
  render();
  window.scrollTo(0, 0);
}

function rvCount(q) { return q.rv.bad.filter(function (a) { return a.length > 0; }).length; }

/* 下標校驗：整數而且喺詞語範圍內 */
function rvIndex(q, raw) {
  const i = Number(raw);
  return q && q.phase === 'review' && q.rv && Number.isInteger(i) && i >= 0 && i < q.words.length ? i : -1;
}

/* 結算：逐個詞語調用既有 recordAnswer，再交畀 finishQuiz 寫紀錄。q.committed 先上鎖，連點只寫一次 */
function commitReview() {
  const q = ui.quiz, s = me();
  if (!q || q.phase !== 'review' || q.committed) return;
  if (!s) { toast('搵唔到同學資料，今次冇記錄'); go('home'); return; }
  q.committed = true;
  ui.clickGuardUntil = performance.now() + CLICK_GUARD_MS;
  q.results = [];
  q.words.forEach(function (word, i) {
    const bad = q.rv.bad[i].slice().sort(function (a, b) { return a - b; });
    const ok = bad.length === 0;
    recordAnswer(s, word, ok, bad, q);
    q.results.push({ word: word, ok: ok, bad: bad });
  });
  finishQuiz(s);
}

Object.assign(actions, {
  /* 逐字字卡：原位更新 DOM（唔 render，字卡唔會失焦／跳位） */
  rvChar: function (el) {
    const q = ui.quiz, i = rvIndex(q, el.dataset.i);
    if (i < 0) return;
    const chars = Array.from(q.words[i]);
    const j = Number(el.dataset.val);
    if (!Number.isInteger(j) || j < 0 || j >= chars.length || /\s/.test(chars[j])) return;
    const at = q.rv.bad[i].indexOf(j);
    if (at === -1) q.rv.bad[i].push(j); else q.rv.bad[i].splice(at, 1);
    const on = at === -1;
    el.setAttribute('aria-pressed', String(on));
    el.setAttribute('aria-label', rvCharLabel(j, chars[j], on));
    const row = el.closest('.rv-row');
    if (row) row.classList.toggle('bad', q.rv.bad[i].length > 0);
    const cnt = document.querySelector('.rv-count');
    const text = '錯 ' + rvCount(q) + ' 個／共 ' + q.words.length + ' 個';
    if (cnt) cnt.textContent = text;
    announce('第 ' + (j + 1) + ' 個字「' + chars[j] + '」：' + (on ? '標記為錯' : '取消標記') + '。' + text);
  },
  rvConfirm: commitReview
});
/* ----- 停止同鍵盤 ----- */
/* 停止：新方式從不調用 finishQuiz／recordAnswer／saveDB，所以紀錄同統計同開始前完全一樣 */
function quitNew(q) {
  const inReview = q.phase === 'review';
  let wasRunning = false;
  if (q.mode === 'timed') wasRunning = timedPause('dialog'); else selfCancel();   // 確認框期間暫停計時同朗讀
  confirmBox({
    icon: '🛑', title: inReview ? '離開對答案？' : '停止默書？',
    text: inReview ? '未確認對答案，離開就唔會記錄今次成績。' : '今次默書唔會記錄，成績同錯字怪獸唔受影響。',
    okText: inReview ? '離開，唔記錄' : '停止', danger: true
  }, function () {
    if (ui.view !== 'quiz' || ui.quiz !== q || q.committed) return;
    q.aborted = true;
    toast('默書已取消，未記錄');
    go('menu');   // go() 已 clearTimers() + stopSpeech()
  }, function () {
    if (ui.view !== 'quiz' || ui.quiz !== q) return;
    if (wasRunning) timedResume();   // 取消：由原位繼續；本來已手動暫停就保持暫停
  });
}

/* 默書鍵盤快捷鍵（新方式）。已經過所有現有守衛（修飾鍵、shortcutsOn、確認框、輸入框、長按重覆） */
function newModeKey(e, q, onControl) {
  ui.lastInputKbd = true;
  if (q.phase === 'review') return;   // 對答案階段冇快捷鍵，避免誤批
  if (q.mode === 'timed') {
    if (e.key === ' ' && !onControl && q.t) {
      e.preventDefault();
      if (q.t.paused) timedResume(); else timedPause('user');
    }
    return;
  }
  if (q.phase !== 'run') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); selfPrev(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); selfNext(); }
  else if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
    e.preventDefault();
    if (e.key === ' ') actions.selfRepeat(); else selfNext();
  }
}

/* ----- 設定頁：默書方式卡 ----- */
/* 定時設定說明；任何一級「秒數 ÷ 朗讀次數 < TIMED_MIN_SLOT_S」就追加警告（只警告，唔阻止） */
function timedHintText(prefs) {
  const tp = prefs.timed;
  let msg = '讀 ' + tp.reads + ' 次會平均分佈喺停留時間內，每個詞語完整行晒設定秒數先轉下一個。';
  const low = [];
  let min = Infinity;
  tp.secs.forEach(function (sec, i) {
    const slot = sec / tp.reads;
    if (slot < TIMED_MIN_SLOT_S) { low.push(TIER_LABELS[i]); min = Math.min(min, slot); }
  });
  if (low.length) msg += ' ⚠️ ' + low.join('、') + '詞語每次朗讀只得 ' + min.toFixed(1) + ' 秒，可能讀唔完，建議加秒數或減少次數。';
  return msg;
}

/* 設定頁內嘅定時默書設定卡：朗讀秒數（4 級）同朗讀次數，存喺 s.prefs.timed */
function timedSettingsHtml(p) {
  const rows = TIER_LABELS.map(function (label, i) {
    return '<div class="tier-row"><span class="tier-label">' + label + '</span>' +
      '<button class="step" data-action="tierStep" data-i="' + i + '" data-val="-1" aria-label="' + label + '，減一秒">−</button>' +
      '<span class="tier-val"><output id="tierSecs' + i + '">' + p.timed.secs[i] + '</output> 秒</span>' +
      '<button class="step" data-action="tierStep" data-i="' + i + '" data-val="1" aria-label="' + label + '，加一秒">＋</button></div>';
  }).join('');
  const reads = [1, 2, 3].map(function (n) {
    return '<button class="chip' + (p.timed.reads === n ? ' on' : '') + '" data-action="setTimedReads" data-val="' + n + '"' + pressed(p.timed.reads === n) + '>' + n + ' 次</button>';
  }).join('');
  return '<div class="card" style="margin-top:16px"><h2>定時默書</h2>' +
    '<p class="muted" style="margin-top:0">只影響定時默書。</p>' +
    '<div class="timed-set solo"><span class="field-label">每個詞語停留幾多秒？</span>' + rows +
    '<span class="field-label">每個詞語讀幾多次？</span>' +
    '<div class="toggle-select" data-group="timedReads">' + reads + '</div>' +
    '<button class="link" data-action="timedDefaults">還原預設秒數</button>' +
    '<p class="muted" id="timedHint" role="status">' + esc(timedHintText(p)) + '</p></div></div>';
}

function modeCardHtml(c) {
  const noSpeech = !('speechSynthesis' in window);
  const cur = normaliseMode(c.mode);   // 非法值（包括已移除嘅 'normal'）顯示預設方式
  const opt = function (mode, title, desc, disabled) {
    const on = cur === mode;
    return '<button class="mode-opt' + (on ? ' on' : '') + '" data-action="setOpt" data-key="mode" data-val="' + mode + '"' + pressed(on) + (disabled ? ' disabled' : '') + '>' +
      '<b>' + title + '</b><small>' + desc + '</small></button>';
  };
  const timedBlock = cur === 'timed' ? '<p class="muted">朗讀秒數同次數喺主頁「設定」入面改。</p>' : '';
  return '<div class="card" style="margin-top:16px"><h2>默書方式</h2>' +
    '<div class="mode-list" role="group" aria-label="默書方式">' +
    opt('timed', QUIZ_MODES.timed.label, noSpeech ? '呢個瀏覽器唔支援朗讀，用唔到定時默書' : '全自動逐個詞語朗讀，每個限時；完成後對答案', noSpeech) +
    opt('self', QUIZ_MODES.self.label, '學生自己按上一個／下一個，不計時；完成後對答案', false) +
    '</div>' + timedBlock + '</div>';
}

/* 即時儲存、只更新對應 DOM（唔重畫整頁，焦點唔會丟） */
function refreshTimedUi() {
  const p = me().prefs;
  p.timed.secs.forEach(function (v, i) {
    const o = document.getElementById('tierSecs' + i);
    if (o) o.textContent = v;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-action=setTimedReads]'), function (b) {
    const on = Number(b.dataset.val) === p.timed.reads;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const h = document.getElementById('timedHint');
  if (h) h.textContent = timedHintText(p);
}

Object.assign(actions, {
  tierStep: function (el) {
    const i = Number(el.dataset.i), v = Number(el.dataset.val);
    if (!Number.isInteger(i) || i < 0 || i > 3 || (v !== 1 && v !== -1)) return;
    const t = me().prefs.timed;
    t.secs[i] = Math.min(TIMED_SECS_MAX, Math.max(TIMED_SECS_MIN, t.secs[i] + v));
    saveDB();
    refreshTimedUi();
  },
  setTimedReads: function (el) {
    const n = Number(el.dataset.val);
    if (!Number.isInteger(n) || n < 1 || n > TIMED_READS_MAX) return;
    me().prefs.timed.reads = n;
    saveDB();
    refreshTimedUi();
  },
  timedDefaults: function () {
    me().prefs.timed.secs = TIMED_SECS_DEFAULT.slice();
    saveDB();
    refreshTimedUi();
  }
});


/* ---------- 成績同紀錄 ---------- */
Object.assign(actions, {
  goStats: function () { go('stats'); },
  goHistory: function () { go('history'); },
  setStatTab: function (el) { ui.statTab = el.dataset.val; render(); },
  openRecord: function (el) {
    ui.recordBack = ui.view;
    ui.recordId = el.dataset.id;
    go('record');
  },
  closeRecord: function () { go(ui.recordBack || 'history'); },

  deleteRecord: function (el) {
    const s = me();
    const h = s.history.find(function (x) { return x.id === el.dataset.id; });
    if (!h) return;
    confirmBox({
      icon: '🗑', title: '刪除呢次默書紀錄？',
      text: dayLabel(h.date) + ' ' + timeLabel(h.date) + '「' + h.label + '」' + h.correct + '/' + h.total +
        '。錯誤率統計會一併扣減，錯字怪獸唔受影響，而且無法還原。',
      okText: '刪除', danger: true
    }, function () {
      removeRecords(s, [h.id]);
      toast('已刪除');
      if (ui.view === 'record') go(ui.recordBack === 'result' ? 'stats' : (ui.recordBack || 'history'));
      else render();
    });
  },
  deleteDay: function (el) {
    const s = me();
    const key = el.dataset.day;
    const found = s.history.filter(function (h) { return dayKey(h.date) === key; });
    if (!found.length) return;
    confirmBox({
      icon: '🗑', title: '刪除 ' + dayLabel(found[0].date) + ' 全部紀錄？',
      text: '共 ' + found.length + ' 次默書紀錄會被刪除。錯誤率統計會一併扣減，錯字怪獸唔受影響，而且無法還原。',
      okText: '全部刪除', danger: true
    }, function () {
      removeRecords(s, found.map(function (h) { return h.id; }));
      toast('已刪除 ' + found.length + ' 次紀錄');
      render();
    });
  }
});

/* ---------- 家長 PIN dialog 同保護操作（T5.4） ----------
   PIN 先、原本確認框後。解鎖政策（修正「剛設定 PIN 後改／刪詞語冇問 PIN」之後）：
   - 每個受保護操作都要 PIN；做完（確認框彈出／加入／刪除）即鎖，下一個操作再問。
   - 唯一例外係課文編輯階段：newLesson／editLesson 過 PIN 後保持解鎖，等同一次編輯可以儲存；
     窗口固定 PIN_UNLOCK_MS（3 分鐘，唔順延），儲存時 saveLesson 再檢查，過期就重問（草稿保留）。
     離開編輯頁（儲存、返回、換人）經 go() 即鎖。
   - 設定／更改／移除 PIN 完成後唔解鎖。
   - 其他即鎖：goHome（換人）、startQuiz、頁面 hidden、取代還原成功。只存記憶體（ui.pinUntil）。 */
const PIN_DISCLAIMER = '呢個 PIN 只係防止小朋友誤撳，唔係真正加密或保安。4 位數字只有一萬種組合，懂技術嘅人可以輕易繞過（例如直接改瀏覽器資料）。';

function pinFieldHtml(id, label) {
  return '<label class="field-label" for="' + id + '">' + esc(label) + '</label>' +
    '<input type="password" id="' + id + '" class="pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off">';
}

/* 忘記 PIN 說明用 <details>，唔開第二個 dialog（兩個 confirmBox 同時開，Esc 會一齊關）。內容係靜態文字 */
function forgotPinHtml() {
  return '<details class="forgot-pin"><summary>忘記 PIN？</summary>' +
    '<ol><li>喺首頁或者設定撳「備份資料」。</li>' +
    '<li>撳「還原資料」，揀返嗰個備份檔。</li>' +
    '<li>揀「取代全部」。資料照舊，PIN 會被移除，之後可以重新設定。</li></ol>' +
    '<p class="muted">備份檔唔包括家長 PIN。</p></details>';
}

/* 冇 PIN：直接行 fn。有 PIN 而仲喺解鎖窗口內（只會係課文編輯階段）：直接行 fn，唔順延窗口。
   否則彈 PIN dialog，通過先行 fn；取消／Esc 行 onCancel。
   fn 行完即鎖，除非 keep（課文編輯階段：newLesson／editLesson／saveLesson，由 go() 離開編輯頁時上鎖） */
function requirePin(reason, fn, onCancel, keep) {
  if (!db.parentPin) { fn(); return; }
  const run = function () { fn(); if (!keep) lockPin(); };
  if (pinUnlocked()) { run(); return; }
  confirmBox({
    icon: '🔒', title: '請輸入家長 PIN', text: '需要家長 PIN 先可以' + reason + '。',
    okText: '確定', focusSel: '#pinInput',
    bodyHtml: pinFieldHtml('pinInput', '家長 PIN（4 位數字）') + forgotPinHtml(),
    validate: function (back) {
      const inp = back.querySelector('#pinInput');
      const v = inp.value;
      if (!/^\d{4}$/.test(v)) return '請輸入 4 位數字';
      if (checkPin(db.parentPin, v)) return true;
      inp.value = '';
      return 'PIN 唔啱，請再試';
    }
  }, function () { unlockPin(); run(); }, onCancel);
}

/* 包住 action：撳落去嗰刻 snapshot el.dataset（PIN dialog 開關期間畫面可能重畫），通過 PIN 後用 snapshot 行原函數 */
function guarded(reason, fn, keep) {
  return function (el) {
    const snap = { dataset: Object.assign({}, el && el.dataset) };
    requirePin(reason, function () { fn(snap); }, null, keep);
  };
}

/* 設定／更改 PIN：兩個輸入框，各有 label；錯誤喺 dialog 內 role=alert 顯示，唔關框 */
function setPinDialog(title) {
  let chosen = '';   // validate 通過時記低；onOk 行嗰刻 dialog 已經關咗，讀唔到輸入框
  confirmBox({
    icon: '🔒', title: title, text: '請設定 4 位數字 PIN。' + PIN_DISCLAIMER,
    okText: '儲存', focusSel: '#pinNew',
    bodyHtml: pinFieldHtml('pinNew', '新 PIN（4 位數字）') + pinFieldHtml('pinNew2', '再輸入一次'),
    validate: function (back) {
      const a = back.querySelector('#pinNew').value;
      const b = back.querySelector('#pinNew2').value;
      if (!/^\d{4}$/.test(a)) return 'PIN 要係 4 位數字';
      if (a !== b) return '兩次輸入唔一致';
      chosen = a;
      return true;
    }
  }, function () {
    db.parentPin = makePin(chosen);
    chosen = '';
    lockPin();   // 設定／更改完唔解鎖：之後第一個刪除或修改照樣要輸入 PIN
    saveDB();
    toast('已設定家長 PIN ✓');
    render();
  });
}

Object.assign(actions, {
  setPin: function () {
    if (db.parentPin) { actions.changePin(); return; }   // 已有 PIN 就一定要先驗證現有 PIN，唔可以靠 setPin 覆蓋
    setPinDialog('設定家長 PIN');
  },
  changePin: function () {
    if (!db.parentPin) return;
    requirePin('更改 PIN', function () { setPinDialog('更改家長 PIN'); });
  },
  removePin: function () {
    if (!db.parentPin) return;
    requirePin('移除 PIN', function () {
      confirmBox({
        icon: '🔓', title: '移除家長 PIN？',
        text: '移除後，刪除紀錄、修改詞庫等操作唔會再問 PIN。', okText: '移除', danger: true
      }, function () {
        db.parentPin = null;
        lockPin();
        saveDB();
        toast('已移除家長 PIN');
        render();
      });
    });
  }
});

/* 受保護操作：只喺最外層包 PIN，原函數（確認框、removeRecords 等）一行唔改。
   唔保護：分享／複製、備份匯出、還原、設定改名／年級／公仔／朗讀、開始默書 */
[
  ['deleteStudent', '刪除同學'],
  ['newLesson', '修改詞庫', true], ['editLesson', '修改詞庫', true], ['deleteLesson', '修改詞庫'],
  ['saveLesson', '儲存課文', true],   // 第三項 true = 課文編輯階段：過咗 PIN 保持解鎖，離開編輯頁（go()）先鎖
  ['removeBank', '刪除錯字'],
  ['deleteRecord', '刪除紀錄'], ['deleteDay', '刪除紀錄']
].forEach(function (p) { actions[p[0]] = guarded(p[1], actions[p[0]], p[2]); });

/* =====================================================
   事件監聽同啟動
   ===================================================== */
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  ui.lastInputKbd = e.detail === 0;   // 鍵盤（或虛擬）啟動嘅 click，detail 係 0
  if (performance.now() < ui.clickGuardUntil) return;   // 剛進入對答案／結果頁：忽略連點
  const fn = actions[el.dataset.action];
  // 滑鼠／觸控撳「停止默書」✕：喺開確認框之前放走焦點，令框記低嘅 opener 係 BODY，
  // 取消後唔會還原到 ✕（否則之後撳空白／Enter 會被 ✕ 攔截再開框）；鍵盤啟動（detail === 0）照舊還原
  if (e.detail > 0 && el.dataset.action === 'quit') el.blur();
  if (fn) fn(el);
  // 滑鼠／觸控（detail > 0）撳完朗讀類掣就放走焦點，等 Enter／空白繼續行默書快捷鍵；
  // 鍵盤啟動嘅 click（detail === 0）唔處理，保持鍵盤同讀屏用家嘅焦點位置
  // 新默書方式：selfPrev／selfNext 會 render()，被撳嗰粒掣已經脫離 DOM，要放走重畫後還原咗焦點嘅新掣，空白／方向鍵快捷鍵先繼續生效
  if (e.detail > 0 && NEW_BLUR.indexOf(el.dataset.action) !== -1) {
    const a = document.activeElement;
    if (a && a !== document.body && $app.contains(a) && a.dataset && a.dataset.action === el.dataset.action) a.blur();
  }
});

document.addEventListener('input', function (e) {
  if (e.target.id === 'nameInput') ui.form.name = e.target.value;
  if (e.target.id === 'lessonWords') {
    const parsed = parseLesson(e.target.value);
    document.getElementById('wordCount').textContent = parsed.words.length;
    document.getElementById('hintCount').textContent = hintCountText(parsed);
    document.getElementById('wordPreview').innerHTML = wordPreviewHtml(parsed);
  }
  if (e.target.id === 'countRange' && ui.setup) {
    const total = setupTotal(me(), ui.setup);
    const v = Number(e.target.value);
    ui.setup.count = v >= total ? null : v;   // 拉到最右 = 全部
    refreshCount();
  }
});

document.addEventListener('keydown', function (e) {
  // 聯想輸入法選字時嘅 Enter 唔算確認
  if (e.target.id === 'profileName' && e.key === 'Enter' && !e.isComposing) {
    saveProfileName();
    e.target.blur();
  }
});

/* 默書鍵盤快捷鍵：自助 = 空白重讀、←／→ 轉詞語、Enter 去下一個；定時 = 空白暫停／繼續（詳見 newModeKey）。
   只喺默書畫面生效，而且每個鍵都要符合當時階段。
   以下情況一律唔觸發：確認框打開（計時已暫停）、輸入框／文字區／下拉選單／可編輯內容、帶修飾鍵、長按重覆。
   焦點喺按鈕或連結時，空白同 Enter 交畀瀏覽器原生處理（否則一撳會觸發兩次） */
document.addEventListener('keydown', function (e) {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  const q = ui.quiz;
  if (ui.view !== 'quiz' || !q) return;
  if (!shortcutsOn()) return;   // 設定頁關咗快捷鍵（WCAG 2.1.4）：完全唔攔截任何鍵
  if (document.querySelector('.modal-back')) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return;
  const onControl = !!(t && t.closest && t.closest('button, a[href], [role=button]'));
  // 長按重覆：唔再觸發動作；快捷鍵會處理嘅空白鍵（焦點唔喺掣）仍要擋住預設捲動
  if (e.repeat) {
    if (e.key === ' ' && !onControl) e.preventDefault();
    return;
  }
  newModeKey(e, q, onControl);   // 定時／自助各自處理
});

document.addEventListener('change', function (e) {
  if (e.target.id === 'profileName') { saveProfileName(); return; }
  if (e.target.id === 'voiceSelect') {
    const s = me();
    if (!s) return;
    s.prefs[voicePrefKey(voiceLangKey(s))] = cleanVoiceURI(e.target.value);   // 按下拉選單揀咗嘅語言分別儲存
    saveDB();
    actions.testVoice();   // 揀完即時試聽
    return;
  }
  if (e.target.id === 'voiceLang') {
    // 只切換設定頁顯示邊個語言嘅聲音，唔寫 prefs、唔試聽
    if (!hasKey(LANGS, e.target.value)) return;
    ui.voiceLang = e.target.value;
    renderVoicePicker();
    return;
  }
  if (e.target.id !== 'importFile') return;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    let data;
    try {
      let raw;
      try { raw = JSON.parse(reader.result); } catch (err) { throw new Error('唔係有效嘅備份檔案'); }
      data = normaliseDB(raw);   // 同載入 localStorage 行同一條校驗
    } catch (err) {
      toast('還原失敗：' + err.message);   // 唔會寫入 localStorage
      return;
    }
    const replaceAll = function () {
      confirmBox({
        icon: '📥', title: '還原資料？',
        text: '會取代而家所有資料（共 ' + data.students.length + ' 位同學）。' +
          (db.parentPin ? '備份檔唔包括家長 PIN，同時會移除家長 PIN。' : ''),
        okText: '還原', danger: true
      }, function () {
        // 還原自一個備份檔，所以資料已經有檔案備份，備份時間當而家。
        // 備份檔唔包括家長 PIN（data.parentPin 明確忽略）：取代還原後 PIN 一律移除，亦係「忘記 PIN」嘅出路
        db = { students: data.students, currentId: null, lastBackupAt: new Date().toISOString(), parentPin: null };
        lockPin();
        saveDB();
        render();
        toast('還原成功 ✓');
      });
    };
    if (!db.students.length) { replaceAll(); return; }   // 冇現有資料：照舊取代，行為不變
    confirmBox({
      icon: '📥', title: '點樣還原？',
      text: '而家已經有資料，想點樣還原備份？',
      bodyHtml: '<ul class="merge-help"><li>合併：保留現有資料，只加入備份入面冇嘅同學、課文、紀錄同錯字。</li>' +
        '<li>取代全部：刪走現有資料，完全換成備份。</li>' +
        '<li>之前打敗咗又喺備份入面嘅錯字，合併後會重新出現。</li></ul>',
      okText: '合併（保留現有資料）', altText: '取代全部',
      onAlt: replaceAll
    }, function () {
      try {
        const merged = mergeDB(db, data);
        const a = merged.added;
        if (!a.students && !a.lessons && !a.records && !a.bank) { toast('冇新資料需要合併'); return; }
        db.students = merged.students;   // 只改 students；currentId、lastBackupAt 唔掂
        saveDB();
        render();
        toast('合併完成：新增 ' + a.students + ' 位同學、' + a.lessons + ' 課文、' + a.records + ' 次紀錄、' + a.bank + ' 個錯字' +
          (a.conflicts ? '（' + a.conflicts + ' 課同名但內容唔同，已另存一份）' : ''), 6000);
      } catch (err) {
        toast('合併失敗，資料冇改動');
      }
    });
  };
  reader.readAsText(file);
  e.target.value = '';
});

// 只有一位同學而且上次冇撳「換人」（currentId 有效）：開 app 直接入主選單。
// 撳「← 換人」會清 currentId，所以返到揀同學畫面之後唔會被彈返主選單
if (db.students.length === 1 && me()) ui.view = 'menu';
checkShareHash();   // 開 app 時網址已經帶 #lesson=（朋友傳咗連結）
render();

/* app 開住時網址 hash 轉成 #lesson=：默書中唔處理（避免打斷）；彈緊 dialog 時只記低，等 dialog 關咗再畫面更新 */
window.addEventListener('hashchange', function () {
  if (ui.view === 'quiz') return;
  checkShareHash();
  if (ui.share && !document.querySelector('.modal-back')) render();
});
/* 離開 app／切換分頁：家長 PIN 即時重新上鎖（手機交畀小朋友嘅常見情況） */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') { lockPin(); timedPause('hidden'); }   // 定時默書：切走即暫停，返嚟要撳繼續
});
if (loadNotice) toast(loadNotice, 6000);   // 載入時有資料讀唔到，提示用家

/* PWA：只喺 http(s)（file:// 唔支援 service worker）而且瀏覽器支援先註冊；失敗安靜略過，app 照常使用 */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 註冊唔到就當冇離線功能 */ });
  });
}
