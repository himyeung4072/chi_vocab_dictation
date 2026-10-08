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
const CHEERS = ['好嘢！', '叻呀！', '正呀！', '好勁！', '繼續加油！'];
const COMFORTS = ['唔緊要，下次記得！', '錯咗先會記得牢啲！', '加油，再嚟！'];

// 時序（毫秒）
const FIRST_DELAY = 1500;  // 開始默書後，第一個詞語朗讀前嘅等待
const NEXT_DELAY = 1000;   // 下一題出現後，朗讀前嘅等待
const FEEDBACK_MS = 1200;  // 答啱／錯動畫顯示時間，播完先轉下一題
const SLOW_RATE = 0.45;    // 「慢啲再讀」嘅速度
const LOCK_MAX_MS = 6000;  // 「睇答案」最長鎖定時間（朗讀收唔到完結訊號時嘅保險）
const LOCK_HINT = '聽唔到？撳 🔊 再試';   // 鎖定期間顯示嘅提示
const HISTORY_MAX = 200;   // 每位同學最多保留幾多次默書紀錄
const DAY_MS = 86400000;
const BACKUP_REMIND_DAYS = 14;   // 超過幾多日未備份，就喺首頁提示
const A2HS_KEY = STORE_KEY + '_a2hs_dismissed';   // 「加到主畫面」提示已關閉（只係呢部機，唔跟備份走）

const WAIT_HTML = '<span class="dots"><i></i><i></i><i></i></span> 預備緊，聽到就開始寫';

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
  if (!raw) return { students: [], currentId: null, lastBackupAt: null };
  let data = null;
  try { data = normaliseDB(JSON.parse(raw), true); } catch (e) { /* JSON 壞咗或者搵唔到同學資料 */ }
  if (!data || data.dropped) {
    const saved = backupRaw(raw);
    loadNotice = (data ? '有 ' + data.dropped + ' 位同學嘅資料讀唔到，已經略過。' : '資料讀唔到，而家由空白開始。') +
      (saved ? '原始資料已經另外備份咗。' : '而且備份唔到原始資料，可能係儲存空間唔夠。');
  }
  if (!data) return { students: [], currentId: null, lastBackupAt: null };
  return { students: data.students, currentId: data.currentId, lastBackupAt: data.lastBackupAt };   // 唔好將 dropped 存入 db
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
  result: null,
  statTab: 'word',
  recordId: null,
  recordBack: 'history',
  backupSnoozed: false   // 撳咗「之後再講」：今次開 app 唔再提醒備份
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

/* 詞語首尾嘅標點（只係首尾，詞語中間嘅字元唔掂；唔包含 | 同 ｜） */
const EDGE_PUNCT = /^[。．.!?,、;:"'“”‘’「」『』()（）\[\]【】《》〈〉<>…]+|[。．.!?,、;:"'“”‘’「」『』()（）\[\]【】《》〈〉<>…]+$/g;

/* 分隔符：空白（包括換行）、逗號、頓號、分號、斜線。NFKC 後全形逗號／分號／斜線已變半形，兩種都列出嚟 */
function parseWords(text) {
  const seen = new Set();   // 用 Set：詞語係 constructor、__proto__ 都唔會撞到物件原型
  return normaliseInput(text).split(/[\s,，、;；/／]+/).map(function (w) {
    return w.replace(EDGE_PUNCT, '').trim();
  }).filter(function (w) {
    if (!w || seen.has(w)) return false;
    seen.add(w);
    return true;
  });
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

/* app 儲存課文時最少要有一個詞（saveLesson 會檢查），清理後冇詞語嘅只可能係損壞資料，直接剔走 */
function cleanLessons(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (l) {
    return isObj(l) && typeof l.id === 'string' && typeof l.title === 'string' && Array.isArray(l.words);
  }).map(function (l) {
    l.words = cleanWords(l.words);
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

/* 聲音 id（prefs.voiceURI）：只接受非空字串，最多 200 字元，否則當作「自動」（空字串） */
function cleanVoiceURI(x) {
  return typeof x === 'string' && x.length > 0 && x.length <= 200 ? x : '';
}

function normaliseStudent(st) {
  st.id = String(st.id);
  st.name = String(st.name);
  st.lessons = cleanLessons(st.lessons);
  st.wordStats = cleanStats(st.wordStats, ['attempts', 'wrong', 'bankEntries']);
  st.charStats = cleanStats(st.charStats, ['attempts', 'wrong']);
  st.bank = cleanBank(st.bank);
  st.history = cleanHistory(st.history);
  const pf = isObj(st.prefs) ? st.prefs : {};
  st.prefs = {
    order: pf.order === 'random' ? 'random' : 'seq',
    lang: hasKey(LANGS, pf.lang) ? pf.lang : 'yue',
    speed: hasKey(SPEEDS, pf.speed) ? pf.speed : 'normal',
    lastLessonIds: cleanIds(pf.lastLessonIds),   // 上次默書揀嘅課文
    voiceURI: cleanVoiceURI(pf.voiceURI),        // 揀咗嘅朗讀聲音；空 = 自動
    shortcuts: pf.shortcuts !== false            // 默書鍵盤快捷鍵；只有明確 false 先關，舊資料／舊備份冇此欄位當開
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
    dropped: dropped
  };
}

function newStudent(name, grade, avatar) {
  return normaliseStudent({ id: uid(), name: name, grade: grade, avatar: avatar });
}

/* ---------- 畫面切換 ---------- */
const timers = { speak: null, adv: null, lock: null };

function clearTimers() {
  clearTimeout(timers.speak);
  clearTimeout(timers.adv);
  clearTimeout(timers.lock);
  timers.speak = null;
  timers.adv = null;
  timers.lock = null;
}

function stopSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function go(view) {
  if (ui.view === 'quiz' && view !== 'quiz') { clearTimers(); stopSpeech(); }
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

/* 先用同學揀咗嘅聲音（prefs.voiceURI，而且要符合今次嘅朗讀語言）；搵唔到就用自動揀嘅 */
function pickVoice(langKey) {
  const list = voicesFor(langKey);
  const s = me();
  const uri = s && s.prefs ? s.prefs.voiceURI : '';
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

/* 聲音選單：自動 + 符合目前朗讀語言嘅聲音；冇聲音可揀就唔畫選單 */
function voicePickerHtml(s) {
  if (!('speechSynthesis' in window)) return '';
  refreshVoices();
  const list = voicesFor(s.prefs.lang);
  if (!list.length) return '';
  const cur = s.prefs.voiceURI;
  const opts = ['<option value=""' + (cur ? '' : ' selected') + '>自動（建議）</option>'].concat(list.map(function (v) {
    const id = voiceId(v);
    return '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' + esc(v.name + '（' + v.lang + '）') + '</option>';
  }));
  return '<label class="field-label" for="voiceSelect">朗讀聲音</label>' +
    '<select id="voiceSelect" class="voice-select">' + opts.join('') + '</select>';
}

function updateVoiceNotice() {
  const s = me();
  if (!s) return;
  const box = document.getElementById('voiceNotice');
  if (box) box.innerHTML = voiceNoticeHtml(s.prefs.lang);
  // 聲音清單隨語言改變、或者系統稍後先載入聲音（voiceschanged）而更新；用家正喺度揀嗰陣唔好打斷
  const pick = document.getElementById('voicePicker');
  if (pick && document.activeElement !== document.getElementById('voiceSelect')) pick.innerHTML = voicePickerHtml(s);
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
  const t = e.target.closest('.btn, .menu-btn, .chip:not(.word), .student-card, .speaker, .lang-btn, .tile, .rec-main, .icon-btn');
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
   onCancel（可選）：撳取消、撳背景或者 Esc 關閉時執行 */
function confirmBox(opts, onOk, onCancel) {
  const opener = document.activeElement;   // 開框前嘅焦點，關閉時還原
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
    '<div class="m-ico">' + (opts.icon || '❓') + '</div>' +
    '<h3>' + esc(opts.title) + '</h3><p>' + esc(opts.text || '') + '</p>' +
    '<div class="two-btns"><button class="btn ghost" data-m="no">取消</button>' +
    '<button class="btn ' + (opts.danger ? 'red' : 'green') + '" data-m="yes">' + esc(opts.okText || '確定') + '</button>' +
    '</div></div>';

  /* Tab／Shift+Tab 只喺框內兩粒按鈕之間循環；焦點跑咗出框（例如撳咗空白位）就拉返入框 */
  function trapTab(e) {
    const btns = back.querySelectorAll('button');
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
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    back.remove();
    // 還原焦點；原本嗰粒掣已經唔喺頁面（畫面重畫過）就唔處理，由 render 決定焦點
    if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') {
      opener.focus({ preventScroll: true });
    }
  }
  function dismiss() {
    close();
    if (onCancel) onCancel();
  }

  back.addEventListener('click', function (e) {
    const b = e.target.closest('[data-m]');
    if (b) {
      if (b.dataset.m === 'yes') { close(); onOk(); } else dismiss();
    } else if (e.target === back) {
      dismiss();
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  const cancel = back.querySelector('[data-m=no]');
  if (cancel) cancel.focus();
}

/* ---------- 錯字怪獸規則 ----------
   詞語第一次默錯 → 入庫，需要默對 1 次先剔走。
   剔走後再默錯 → 再入庫，需要默對 2 次，如此類推。
   無論喺課文模式或者錯字怪獸模式，只要默對，庫內詞語就減一次。
   已經喺庫內又默錯 → 顯示嘅「×N」（need - progress）加 1，已默對嘅次數歸零。
   bad: 寫錯咗嘅字位置（0 開始），有揀先會計單字統計。 */
function recordAnswer(s, word, ok, bad, quiz) {
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
      quiz.hurt.push({ word: word, left: inBank.need - inBank.progress });
    }
  } else if (inBank) {
    inBank.need = inBank.need - inBank.progress + 1;
    inBank.progress = 0;
  } else {
    st.bankEntries += 1;
    s.bank[word] = { need: st.bankEntries, progress: 0 };
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
  return ui.view === 'quiz' && q ? 'quiz:' + q.idx + ':' + q.phase : ui.view;
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
  if (q.phase === 'listen') announce('第 ' + (q.idx + 1) + ' / ' + q.words.length + ' 題');
  else if (q.phase === 'answer') announce(q.words[q.idx]);   // 焦點喺「答案係」，跟住讀出答案
  else if (q.phase === 'feedback') announce(q.fb.ok ? '答啱咗' : '答錯咗');
}

function render() {
  const sig = focusSig(document.activeElement);
  const s = me();
  if (ui.view !== 'home' && ui.view !== 'add' && !s) ui.view = 'home';
  const views = {
    home: homeView, add: addView, menu: menuView, lessons: lessonsView,
    lessonEdit: lessonEditView, setup: setupView, settings: settingsView, quiz: quizView,
    result: resultView, stats: statsView, history: historyView, record: recordView
  };
  // 只有換畫面先播入場動畫，畫面內更新唔會閃
  const animate = ui.view !== lastView;
  lastView = ui.view;
  $app.innerHTML = '<div class="view' + (animate ? ' enter' : '') + '">' +
    (views[ui.view] || homeView)(s) + '</div>';
  if (ui.view === 'quiz') { afterQuizRender(); syncLockHint(); }
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

/* 設定頁「資料備份」卡片：上次備份幾日前 + 立即備份 */
function backupCardHtml() {
  return '<div class="card" style="margin-top:16px"><h2>資料備份</h2>' +
    '<p id="backupAge">上次備份：' + backupAgeText() + '</p>' +
    '<p class="muted" style="margin-top:6px">資料只存喺呢部機嘅瀏覽器入面，建議定期備份。</p>' +
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
  return backupReminderHtml() + a2hsTipHtml();
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

function lessonsView(s) {
  let body;
  if (!s.lessons.length) {
    body = '<div class="empty"><span class="em">📝</span>仲未有課文，加一課啦</div>';
  } else {
    body = s.lessons.map(function (l) {
      return '<div class="lesson-row"><div class="info"><b>' + esc(l.title) + '</b> <span class="muted">' + l.words.length + ' 個詞</span>' +
        '<div class="preview">' + esc(l.words.join('　')) + '</div></div>' +
        '<button class="btn ghost small" data-action="editLesson" data-id="' + esc(l.id) + '">改</button>' +
        '<button class="icon-btn" data-action="deleteLesson" data-id="' + esc(l.id) + '" aria-label="刪除課文">🗑</button></div>';
    }).join('');
  }
  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="card"><h2>我的詞庫</h2>' + body + '</div>' +
    '<button class="btn green block" style="margin-top:20px" data-action="newLesson">➕ 新增一課</button>';
}

/* 編輯課文時嘅即時預覽：解析後嘅詞語 chips（詞語係用家輸入，一律 esc） */
function wordPreviewHtml(list) {
  if (!list.length) return '<span class="muted">輸入詞語後，呢度會顯示解析結果</span>';
  return list.map(function (w) { return '<span class="chip word">' + esc(w) + '</span>'; }).join('');
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
  const words = lesson ? lesson.words.join('\n') : '';
  ui.editBase = { title: title, words: words };   // 開啟時嘅內容，用嚟偵測有冇未儲存改動
  const parsed = parseWords(words);
  return '<div class="topnav"><button class="back" data-action="leaveEdit">← 返回</button></div>' +
    '<div class="card"><h2>' + (lesson ? '修改課文' : '新增課文') + '</h2>' +
    '<label class="field-label" for="lessonTitle">課文名稱</label>' +
    '<input type="text" id="lessonTitle" maxlength="20" autocomplete="off" value="' + esc(title) + '">' +
    '<label class="field-label" for="lessonWords">詞語（一行一個，或者用逗號、空格、斜線分開）</label>' +
    '<textarea id="lessonWords" placeholder="例如：&#10;蘋果&#10;香蕉&#10;西瓜">' + esc(words) + '</textarea>' +
    '<p class="muted" style="margin-top:8px">共 <b id="wordCount">' + parsed.length + '</b> 個詞語（儲存時會自動去走頭尾標點同重複詞語）</p>' +
    '<div class="word-preview" id="wordPreview" role="group" aria-label="詞語預覽">' + wordPreviewHtml(parsed) + '</div>' +
    '<button class="btn green block" style="margin-top:18px" data-action="saveLesson">儲存 ✓</button></div>';
}

function setupView(s) {
  if (!ui.setup) initSetup(s, 'lessons');
  const c = ui.setup;
  const chip = function (key, val, label) {
    return '<button class="chip' + (c[key] === val ? ' on' : '') + '" data-action="setOpt" data-key="' + key + '" data-val="' + val + '"' + pressed(c[key] === val) + '>' + label + '</button>';
  };
  const bankWords = Object.keys(s.bank);

  let sourceBlock;
  if (c.source === 'bank') {
    if (!bankWords.length) {
      sourceBlock = '<div class="empty"><span class="em">🎉</span>錯字怪獸全部打敗晒！<br>暫時冇錯字。</div>';
    } else {
      sourceBlock = '<p class="muted">默對就打敗怪獸。有啲字要默對幾次先剔走。</p><div class="chips" style="margin-top:10px">' +
        bankWords.map(function (w) {
          const b = s.bank[w];
          return '<span class="chip word">' + esc(w) + ' <small class="muted">×' + (b.need - b.progress) + '</small>' +
            '<button class="chip-x" data-action="removeBank" data-word="' + esc(w) + '" aria-label="刪除「' + esc(w) + '」">✕</button></span>';
        }).join('') + '</div>';
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
      '<div id="countBox" class="count-box">' +
      '<span class="field-label" style="margin-top:6px">默幾多個詞語？</span>' +
      '<div class="count-val"><b id="countNum">12</b><small> / <span id="countMax">0</span> 個</small></div>' +
      '<input type="range" id="countRange" class="range" min="1" max="1" step="1" value="1" aria-label="默書詞語數量">' +
      '<p class="muted center" id="countHint"></p></div>';
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
    '<p class="muted" style="margin-top:6px">默書時，每個詞語都可以隨時轉語言再聽。</p>' +
    '<span class="field-label">朗讀速度</span>' +
    group('speed', Object.keys(SPEEDS).map(function (k) { return chip('speed', k, SPEEDS[k].label); }).join('')) +
    '<span class="field-label" id="shortcutsLabel">鍵盤快捷鍵</span>' +
    '<div class="toggle-select" data-group="shortcuts" role="group" aria-labelledby="shortcutsLabel">' +
    shortcutChip(true, '開') + shortcutChip(false, '關') + '</div>' +
    '<p class="muted" style="margin-top:6px">默書時用空白、Enter、1、2 操作。語音輸入或讀屏軟件用家可以關閉，避免誤觸。</p>' +
    '<div id="voicePicker">' + voicePickerHtml(s) + '</div>' +
    '<button class="btn blue small" style="margin-top:14px" data-action="testVoice">🔊 試聽</button>' +
    '<div id="voiceNotice">' + voiceNoticeHtml(p.lang) + '</div></div>' +
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
    source: source, lessonIds: ids, count: 12   // count: 12 = 預設；null = 全部詞語
  };
}

/* 已揀課文入面嘅詞語總數（重複嘅詞語只計一次） */
function setupTotal(s, c) {
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

  document.getElementById('countHint').textContent = !total ? '先揀課文' :
    n < total ? '由 ' + total + ' 個詞語入面隨機抽 ' + n + ' 個' : '默晒全部 ' + total + ' 個詞語';
}

/* 由全部詞語入面隨機抽 n 個；順序模式會跟返課文次序，亂序模式會打亂 */
function pickWords(all, n, order) {
  let idx = all.map(function (w, i) { return i; });
  if (n < all.length) idx = shuffle(idx).slice(0, n);
  idx = order === 'random' ? shuffle(idx) : idx.sort(function (a, b) { return a - b; });
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
function langSwitch(q) {
  return '<div class="lang-switch" role="group" aria-label="朗讀語言">' +
    ['cmn', 'yue'].map(function (k) {
      return '<button class="lang-btn' + (q.curLang === k ? ' on' : '') + '" data-action="setWordLang" data-val="' + k + '"' + pressed(q.curLang === k) + '>' + LANGS[k].label + '</button>';
    }).join('') + '</div>';
}

/* 默書鍵盤快捷鍵開關（WCAG 2.1.4）：prefs.shortcuts，冇同學資料或欄位缺失當開 */
function shortcutsOn() {
  const s = me();
  return !(s && s.prefs && s.prefs.shortcuts === false);
}

function revealLabel(locked) {
  return locked ? '🎧 聽完先可以睇答案' : '寫好啦，睇答案 👀';
}

function listenHtml(q) {
  return '<p class="prompt" data-focus>聽下，寫喺紙上面 ✏️</p>' +
    '<button class="speaker" id="speakerBtn" data-action="speak" aria-label="再聽一次">🔊</button>' +
    '<div class="status" id="status">' + (q.waiting ? WAIT_HTML : '') + '</div>' +
    langSwitch(q) +
    '<div><button class="btn ghost small" data-action="slow">🐢 慢啲再讀</button></div>' +
    '<button class="btn green block" id="revealBtn" style="margin-top:22px;min-height:64px;font-size:1.25rem" data-action="reveal"' +
    (q.locked ? ' disabled' : '') + '>' + revealLabel(q.locked) + '</button>' +
    // 預留位置（min-height），鎖定提示出現／消失時版面唔會跳；內容由 syncLockHint 填
    '<p class="lock-hint" id="lockHint" role="status"></p>' +
    (shortcutsOn() ? '<p class="kbd-hint">快捷鍵：<span>空白 = 重聽</span> <span>Enter = 睇答案</span></p>' : '');
}

/* 「睇答案」鎖定期間顯示「聽唔到？撳 🔊 再試」，解鎖即清走。
   延遲一陣先填入，等讀屏軟件偵測到 role=status 內容有變而公佈一次 */
function syncLockHint() {
  const q = ui.quiz;
  const el = document.getElementById('lockHint');
  if (!q || !el) return;
  if (!q.locked) { el.textContent = ''; return; }
  const idx = q.idx;
  setTimeout(function () {
    const now = document.getElementById('lockHint');
    if (now && ui.view === 'quiz' && ui.quiz === q && q.idx === idx && q.phase === 'listen' && q.locked) {
      now.textContent = LOCK_HINT;
    }
  }, 100);
}

function answerHtml(q, word) {
  // 字號由 CSS 按答案框實際闊度計（--n = 字數），見 style.css .answer-box
  const n = Math.max(Array.from(word).length, 1);
  return '<p class="prompt" data-focus>答案係</p>' +
    '<div class="answer-wrap"><div class="answer-box" style="--n:' + n + '">' + esc(word) + '</div></div>' +
    langSwitch(q) +
    '<div><button class="btn ghost small" data-action="speak">🔊 再聽一次</button></div>' +
    '<p class="prompt" style="margin-top:18px">你寫啱咗嗎？</p>' +
    '<div class="two-btns">' +
    '<button class="btn green" data-action="mark" data-ok="1">✓ 啱咗</button>' +
    '<button class="btn red" data-action="mark" data-ok="0">✗ 錯咗</button></div>' +
    (shortcutsOn() ? '<p class="kbd-hint">快捷鍵：<span>空白 = 重聽</span> <span>1 = 啱咗</span> <span>2 = 錯咗</span></p>' : '');
}

function pickHtml(q, chars) {
  const sz = chars.length <= 4 ? 'min(20vw,96px)' : 'min(15vw,72px)';
  const tiles = chars.map(function (c, i) {
    return '<button class="tile' + (q.pickBad.indexOf(i) !== -1 ? ' bad' : '') + '" data-action="togglePick" data-i="' + i + '"' + pressed(q.pickBad.indexOf(i) !== -1) + '>' + esc(c) + '</button>';
  }).join('');
  return '<p class="prompt" data-focus>邊個字寫錯咗？</p>' +
    '<p class="muted" style="margin-top:4px">撳返寫錯咗嘅字，唔肯定可以直接撳確定</p>' +
    '<div class="tiles" style="--sz:' + sz + '">' + tiles + '</div>' +
    '<button class="btn block" data-action="confirmPick">確定 ✓</button>' +
    '<button class="link" data-action="backToAnswer">← 返轉頭</button>';
}

function feedbackHtml(s, q, word) {
  const ok = q.fb.ok;
  let burst = '';
  if (ok) {
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10;
      burst += '<span style="--dx:' + Math.round(Math.cos(a) * 125) + 'px;--dy:' + Math.round(Math.sin(a) * 125) + 'px">' +
        pick(['⭐', '✨', '🌟']) + '</span>';
    }
  }
  return (ok ? '<div class="burst">' + burst + '</div>' : '') +
    '<div class="fb-av">' + esc(s.avatar) + '</div>' +
    '<h2>' + esc(q.fb.msg) + '</h2>' +
    // --n = 字數、--b = 標紅嘅字數：字號由 CSS 按畫面闊度計，長詞語唔會斷行（見 style.css .fb-word）
    (ok ? '' : '<div class="fb-word" style="--n:' + Math.max(Array.from(word).length, 1) + ';--b:' + (q.fb.bad || []).length + '">' +
      charsHtml(word, q.fb.bad) + '</div>');
}

function quizView(s) {
  const q = ui.quiz;
  const total = q.words.length;
  const word = q.words[q.idx];
  let body;
  let cls = '';
  if (q.phase === 'listen') body = listenHtml(q);
  else if (q.phase === 'answer') body = answerHtml(q, word);
  else if (q.phase === 'pick') body = pickHtml(q, Array.from(word));
  else body = feedbackHtml(s, q, word);

  if (q.phase === 'feedback') cls = ' fb ' + (q.fb.ok ? 'ok' : 'bad');
  else if (q.enter) cls = ' card-enter';
  q.enter = false;

  return '<div class="quiz-top"><button class="quit" data-action="quit" aria-label="停止默書">✕</button>' +
    '<div class="track"><div class="fill" style="width:' + (q.shown * 100) + '%"></div>' +
    '<div class="runner" style="left:calc((100% - 32px) * ' + q.shown + ')">' + esc(s.avatar) + '</div>' +
    '<span class="flag">🏁</span></div>' +
    '<div class="count">' + (q.idx + 1) + ' / ' + total + '</div></div>' +
    '<div class="card quiz-card' + cls + '">' + body + '</div>';
}

/* 進度條嘅動物同進度要喺畫面出現後再移動，先有滑動效果 */
function afterQuizRender() {
  const q = ui.quiz;
  const target = (q.idx + (q.phase === 'feedback' ? 1 : 0)) / q.words.length;
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

  const srTitle = r.incomplete ? '默書未完成：答咗 ' + r.total + ' / ' + r.planned + ' 題' :
    '默書完成：答啱 ' + r.correct + ' / ' + r.total + ' 題';
  return '<h2 class="sr-only">' + srTitle + '</h2>' +
    '<div class="card result-card"><div class="mascot">' + mascot + '</div>' + head +
    '<p>' + msg + '</p>' + extra + '</div>' +
    '<div class="stack" style="margin-top:20px">' +
    '<button class="btn block" data-action="again">再默一次 🔁</button>' +
    '<button class="btn blue block" data-action="openRecord" data-id="' + esc(r.recordId) + '">睇詳細對錯 🔍</button>' +
    '<button class="btn ghost block" data-action="goMenu">返主頁 🏠</button></div>';
}

function recRow(h) {
  const p = pct(h.correct, h.total);
  const cls = h.incomplete ? ' inc' : p >= 80 ? '' : p >= 50 ? ' mid' : ' low';
  return '<div class="rec"><button class="rec-main" data-action="openRecord" data-id="' + esc(h.id) + '">' +
    '<span class="rec-time">' + shortDate(h.date) + ' ' + timeLabel(h.date) + '</span>' +
    '<span class="rec-label">' + esc(h.label) + '</span>' +
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
    return b.rate - a.rate || b.wrong - a.wrong;
  }).slice(0, 15);

  const badMap = badIndexMap(s);
  const emptyMsg = isChar
    ? '仲未有單字統計。默書時答錯，再揀返寫錯嘅字，就會記錄到。'
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
    '<div class="card"><h3>最易錯嘅字（錯誤率）</h3>' +
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
    (h.incomplete ? '<div class="rec-tag">未完成：答咗 ' + h.total + ' / ' + h.planned + ' 題</div>' : '') + '</div>' +
    '<span class="rec-score' + (h.incomplete ? ' inc' : p >= 80 ? '' : p >= 50 ? ' mid' : ' low') + '">' + h.correct + '/' + h.total + '</span></div>' +
    '<div style="margin-top:8px">' + list + '</div></div>' +
    '<button class="btn ghost block" style="margin-top:20px" data-action="deleteRecord" data-id="' + esc(h.id) + '">🗑 刪除呢次紀錄</button>';
}

/* =====================================================
   默書流程（時序）
   開始／轉題 → 等一等 → 朗讀 → 睇答案 → 評分 → 動畫 → 下一題
   ===================================================== */
function setSpeaking(on) {
  const b = document.getElementById('speakerBtn');
  if (b) b.classList.toggle('speaking', on);
}

function setWaiting(on) {
  const q = ui.quiz;
  if (!q) return;
  q.waiting = on;
  const st = document.getElementById('status');
  if (st) st.innerHTML = on ? WAIT_HTML : '';
}

/* 朗讀而家呢題，語言用學生為呢個詞語揀咗嘅語言 */
function speakCurrent(rate) {
  const q = ui.quiz;
  const idx = q.idx;
  // 只處理「同一題」嘅朗讀事件，上一題遲來嘅完結訊號唔可以解鎖下一題
  const same = function () { return ui.quiz === q && q.idx === idx; };
  setWaiting(false);   // 一開始朗讀，「預備緊」提示一定要走
  speak(q.words[q.idx], q.curLang, rate || SPEEDS[q.speed].rate, {
    onstart: function () {
      if (!same()) return;
      setWaiting(false);
      setSpeaking(true);
    },
    onend: function () {
      if (!same()) return;
      setWaiting(false);
      setSpeaking(false);
      unlockReveal();   // 讀完先可以睇答案
    }
  });
  if (q.locked) {
    clearTimeout(timers.lock);
    // 瀏覽器唔支援朗讀，或者收唔到完結訊號時，過一陣自動解鎖，避免學生卡住
    timers.lock = setTimeout(unlockReveal, 'speechSynthesis' in window ? LOCK_MAX_MS : 0);
  }
}

/* 詞語第一次朗讀完整播完後，「睇答案」先可以撳 */
function unlockReveal() {
  const q = ui.quiz;
  if (!q || !q.locked) return;
  q.locked = false;
  clearTimeout(timers.lock);
  timers.lock = null;
  const b = document.getElementById('revealBtn');
  if (!b) return;
  b.disabled = false;
  const hint = document.getElementById('lockHint');
  if (hint) hint.textContent = '';
  b.textContent = revealLabel(false);
  b.classList.remove('pop-in');
  void b.offsetWidth;   // 重新播放動畫
  b.classList.add('pop-in');
}

function scheduleSpeak(ms) {
  clearTimeout(timers.speak);
  setWaiting(true);
  timers.speak = setTimeout(function () {
    timers.speak = null;
    setWaiting(false);
    if (ui.view !== 'quiz' || ui.quiz.phase !== 'listen') return;
    speakCurrent();
  }, ms);
}

function cancelScheduled() {
  clearTimeout(timers.speak);
  timers.speak = null;
  setWaiting(false);
}

function prepareQuestion(enter) {
  const q = ui.quiz;
  q.phase = 'listen';
  q.curLang = q.lang;   // 每個詞語都由預設語言開始
  q.pickBad = [];
  q.fb = null;
  q.enter = enter;
  q.waiting = true;
  q.locked = true;      // 第一次朗讀播完之前，唔可以睇答案
  clearTimeout(timers.lock);
  timers.lock = null;
}

function beginQuestion() {
  stopSpeech();   // 上一題仲未讀完嘅聲音唔好帶入下一題
  prepareQuestion(true);
  render();
  scheduleSpeak(NEXT_DELAY);
}

function commitAnswer(ok, bad) {
  const s = me();
  const q = ui.quiz;
  const word = q.words[q.idx];
  recordAnswer(s, word, ok, bad, q);
  q.results.push({ word: word, ok: ok, bad: bad });
  saveDB();
  q.fb = { ok: ok, bad: bad, msg: pick(ok ? CHEERS : COMFORTS) };
  q.phase = 'feedback';
  render();
  // 動畫播完先轉下一題，兩者唔會重疊
  timers.adv = setTimeout(advance, FEEDBACK_MS);
}

function advance() {
  timers.adv = null;
  const q = ui.quiz;
  q.idx += 1;
  if (q.idx >= q.words.length) { finishQuiz(me()); return; }
  beginQuestion();
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
    planned: q.words.length,   // 原定題數
    incomplete: q.results.length < q.words.length,
    correct: correct,
    wrong: wrong,
    results: q.results.map(function (r) { return { word: r.word, ok: r.ok, bad: r.bad }; })
  };
  s.history.push(rec);
  if (s.history.length > HISTORY_MAX) s.history = s.history.slice(-HISTORY_MAX);
  saveDB();
  ui.result = {
    total: rec.total, planned: rec.planned, incomplete: rec.incomplete,
    correct: correct, wrong: wrong, recordId: rec.id,
    added: q.added, removed: q.removed, hurt: q.hurt
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
  goHome: function () { db.currentId = null; saveDB(); go('home'); },
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
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
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
    const words = parseWords(document.getElementById('lessonWords').value);
    if (!title) { toast('請輸入課文名稱'); return; }
    if (!words.length) { toast('請最少輸入一個詞語'); return; }
    const existing = ui.editLessonId && s.lessons.find(function (l) { return l.id === ui.editLessonId; });
    if (existing) { existing.title = title; existing.words = words; }
    else { s.lessons.push({ id: uid(), title: title, words: words }); }
    saveDB();
    toast('已儲存 ✓');
    actions.goLessons();
  }
});

/* ---------- 默書 ---------- */
Object.assign(actions, {
  goSetup: function (el) { initSetup(me(), el.dataset.source); go('setup'); },
  setOpt: function (el) {
    const key = el.dataset.key;
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
    if (el.dataset.key === 'lang') updateVoiceNotice();
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
    const p = me().prefs;
    speak('你好，我哋開始默書啦', p.lang, SPEEDS[p.speed].rate);
  },

  startQuiz: function () {
    const s = me();
    const c = ui.setup;
    let words = [];
    let label = '';
    if (c.source === 'bank') {
      words = Object.keys(s.bank);
      label = '錯字怪獸';
    } else {
      const picked = s.lessons.filter(function (l) { return c.lessonIds.indexOf(l.id) !== -1; });
      if (!picked.length) { toast('請先揀最少一課'); return; }
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
    // 課文模式可以揀默幾多個：最少 1 個，最多係全部，超出嘅數字會被限制返
    const n = c.source === 'lessons' && c.count != null ? Math.max(1, Math.min(c.count, total)) : total;
    const p = s.prefs;   // 次序、朗讀語言、速度全部由設定頁讀取
    words = pickWords(words, n, p.order);
    if (n < total) label += '（抽 ' + n + ' 個）';
    if (c.source === 'lessons') {   // 成功開始先記住今次揀嘅課文
      p.lastLessonIds = c.lessonIds.filter(function (id) { return s.lessons.some(function (l) { return l.id === id; }); });
      saveDB();
    }
    unlockSpeech();
    ui.quiz = {
      source: c.source, label: label, words: words, idx: 0, results: [],
      added: [], removed: [], hurt: [], lang: p.lang, speed: p.speed, shown: 0
    };
    preloadAnswerFont(words);
    prepareQuestion(false);  // 第一題跟住畫面入場動畫，唔使再滑入
    go('quiz');
    scheduleSpeak(FIRST_DELAY);
  },
  again: function () {
    if (ui.setup) actions.startQuiz(); else go('menu');
  }
});

/* ---------- 默書中 ---------- */
function canHear() { return ui.quiz && (ui.quiz.phase === 'listen' || ui.quiz.phase === 'answer'); }

/* 自評：啱 → 直接記錄；錯 → 單字詞語直接記錄，多字詞語問邊個字寫錯。撳掣同鍵盤快捷鍵（1／2）共用 */
function markAnswer(ok) {
  const q = ui.quiz;
  if (!q || q.phase !== 'answer') return;   // 只有「答案」階段先生效，回饋動畫期間重覆撳唔會再記錄
  if (ok) { commitAnswer(true, []); return; }
  if (Array.from(q.words[q.idx]).length <= 1) { commitAnswer(false, [0]); return; }
  q.pickBad = [];
  q.phase = 'pick';   // 多過一個字，問邊個字寫錯
  render();
}

Object.assign(actions, {
  speak: function () {
    if (!canHear()) return;
    cancelScheduled();
    speakCurrent();
  },
  slow: function () {
    if (!canHear()) return;
    cancelScheduled();
    speakCurrent(SLOW_RATE);
  },
  setWordLang: function (el) {
    if (!canHear()) return;
    ui.quiz.curLang = el.dataset.val;
    Array.prototype.forEach.call(el.parentElement.children, function (x) {
      x.classList.toggle('on', x === el);
      x.setAttribute('aria-pressed', String(x === el));
    });
    cancelScheduled();
    speakCurrent();
  },
  reveal: function () {
    const q = ui.quiz;
    if (q.phase !== 'listen' || q.locked) return;
    cancelScheduled();
    q.phase = 'answer';
    render();
  },
  mark: function (el) { markAnswer(el.dataset.ok === '1'); },
  togglePick: function (el) {
    const q = ui.quiz;
    if (q.phase !== 'pick') return;
    const i = Number(el.dataset.i);
    const at = q.pickBad.indexOf(i);
    if (at === -1) q.pickBad.push(i); else q.pickBad.splice(at, 1);
    el.setAttribute('aria-pressed', String(el.classList.toggle('bad')));
  },
  confirmPick: function () {
    const q = ui.quiz;
    if (q.phase !== 'pick') return;
    commitAnswer(false, q.pickBad.slice().sort(function (a, b) { return a - b; }));
  },
  backToAnswer: function () {
    if (ui.quiz.phase !== 'pick') return;
    ui.quiz.phase = 'answer';
    render();
  },
  quit: function () {
    // 確認框打開期間暫停：唔朗讀、唔轉下一題
    clearTimers();
    currentUtterance = null;   // 被 cancel 嘅句子唔好觸發 onend（否則會提早解鎖「睇答案」）
    stopSpeech();
    setSpeaking(false);
    setWaiting(false);
    confirmBox({
      icon: '🛑', title: '停止默書？',
      text: '已經答咗嘅題目會保留。', okText: '停止'
    }, function () {
      if (ui.view !== 'quiz') return;
      const s = me();
      if (ui.quiz.results.length) finishQuiz(s); else go('menu');
    }, function () {
      // 取消：由暫停嘅位置繼續
      if (ui.view !== 'quiz') return;
      const q = ui.quiz;
      if (q.phase === 'listen') scheduleSpeak(NEXT_DELAY);
      else if (q.phase === 'feedback') advance();
    });
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

/* =====================================================
   事件監聽同啟動
   ===================================================== */
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  // 滑鼠／觸控撳「停止默書」✕：喺開確認框之前放走焦點，令框記低嘅 opener 係 BODY，
  // 取消後唔會還原到 ✕（否則之後撳空白／Enter 會被 ✕ 攔截再開框）；鍵盤啟動（detail === 0）照舊還原
  if (e.detail > 0 && el.dataset.action === 'quit') el.blur();
  if (fn) fn(el);
  // 滑鼠／觸控（detail > 0）撳完朗讀類掣就放走焦點，等 Enter／空白繼續行默書快捷鍵；
  // 鍵盤啟動嘅 click（detail === 0）唔處理，保持鍵盤同讀屏用家嘅焦點位置
  if (e.detail > 0 && (el.dataset.action === 'speak' || el.dataset.action === 'slow' || el.dataset.action === 'setWordLang')) el.blur();
});

document.addEventListener('input', function (e) {
  if (e.target.id === 'nameInput') ui.form.name = e.target.value;
  if (e.target.id === 'lessonWords') {
    const list = parseWords(e.target.value);
    document.getElementById('wordCount').textContent = list.length;
    document.getElementById('wordPreview').innerHTML = wordPreviewHtml(list);
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

/* 默書鍵盤快捷鍵：空白 = 重聽、Enter = 睇答案、1 = 啱咗、2 = 錯咗。
   只喺默書畫面生效，而且每個鍵都要符合當時階段（回饋動畫、揀錯字階段全部唔觸發）。
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
  if (e.key === ' ' || e.key === 'Enter') {
    if (onControl) return;
    e.preventDefault();   // 空白鍵預設會捲動頁面
    if (e.key === ' ') actions.speak(); else actions.reveal();
  } else if (e.key === '1' || e.key === '2') {
    markAnswer(e.key === '1');   // markAnswer 自己檢查階段
  }
});

document.addEventListener('change', function (e) {
  if (e.target.id === 'profileName') { saveProfileName(); return; }
  if (e.target.id === 'voiceSelect') {
    const s = me();
    if (!s) return;
    s.prefs.voiceURI = cleanVoiceURI(e.target.value);
    saveDB();
    actions.testVoice();   // 揀完即時試聽
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
    confirmBox({
      icon: '📥', title: '還原資料？',
      text: '會取代而家所有資料（共 ' + data.students.length + ' 位同學）。',
      okText: '還原', danger: true
    }, function () {
      // 還原自一個備份檔，所以資料已經有檔案備份，備份時間當而家
      db = { students: data.students, currentId: null, lastBackupAt: new Date().toISOString() };
      saveDB();
      render();
      toast('還原成功 ✓');
    });
  };
  reader.readAsText(file);
  e.target.value = '';
});

// 只有一位同學而且上次冇撳「換人」（currentId 有效）：開 app 直接入主選單。
// 撳「← 換人」會清 currentId，所以返到揀同學畫面之後唔會被彈返主選單
if (db.students.length === 1 && me()) ui.view = 'menu';
render();
if (loadNotice) toast(loadNotice, 6000);   // 載入時有資料讀唔到，提示用家

/* PWA：只喺 http(s)（file:// 唔支援 service worker）而且瀏覽器支援先註冊；失敗安靜略過，app 照常使用 */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 註冊唔到就當冇離線功能 */ });
  });
}
