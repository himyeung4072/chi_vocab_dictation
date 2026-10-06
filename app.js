'use strict';

/* =====================================================
   默書樂園 - 小學生自行默書練習
   純前端，資料存喺瀏覽器 localStorage
   ===================================================== */

const STORE_KEY = 'chiVocab.v1';
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
const LOCK_MAX_MS = 12000; // 「睇答案」最長鎖定時間（朗讀收唔到完結訊號時嘅保險）

const WAIT_HTML = '<span class="dots"><i></i><i></i><i></i></span> 預備緊，聽到就開始寫';

const $app = document.getElementById('app');
const $fx = document.getElementById('fx');

/* ---------- 資料儲存 ---------- */
function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.students)) {
        data.students.forEach(function (st) { normaliseStudent(st); });
        return data;
      }
    }
  } catch (e) { /* 當作冇資料 */ }
  return { students: [], currentId: null };
}

function saveDB() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('儲存唔到資料，請檢查瀏覽器設定');
  }
}

let db = loadDB();
let ui = {
  view: 'home',
  form: { name: '', grade: 1, avatar: AVATARS[0] },
  editLessonId: null,
  setup: null,
  quiz: null,
  result: null,
  statTab: 'word',
  recordId: null,
  recordBack: 'history'
};

/* ---------- 小工具 ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function me() {
  return db.students.find(function (s) { return s.id === db.currentId; }) || null;
}

function parseWords(text) {
  const seen = {};
  return text.split(/[\s,，、;；]+/).map(function (w) { return w.trim(); }).filter(function (w) {
    if (!w || seen[w]) return false;
    seen[w] = true;
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

function normaliseStudent(st) {
  st.lessons = Array.isArray(st.lessons) ? st.lessons : [];
  st.wordStats = st.wordStats || {};
  st.charStats = st.charStats || {};
  st.bank = st.bank || {};
  st.history = Array.isArray(st.history) ? st.history : [];
  st.history.forEach(function (h) { if (!h.id) h.id = uid(); });
  const pf = st.prefs || {};
  st.prefs = {
    order: pf.order === 'random' ? 'random' : 'seq',
    lang: LANGS[pf.lang] ? pf.lang : 'yue',
    speed: SPEEDS[pf.speed] ? pf.speed : 'normal'
  };
  st.grade = Math.min(6, Math.max(1, Number(st.grade) || 1));
  st.avatar = st.avatar || AVATARS[0];
  return st;
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

function pickVoice(langKey) {
  const norm = function (v) { return (v.lang || '').replace('_', '-'); };
  if (langKey === 'yue') {
    return voices.find(function (v) { return /^(zh-HK|yue)/i.test(norm(v)); }) || null;
  }
  return voices.find(function (v) { return /^zh-CN/i.test(norm(v)); }) ||
    voices.find(function (v) { return /^cmn/i.test(norm(v)); }) ||
    voices.find(function (v) { return /^zh-TW/i.test(norm(v)); }) ||
    voices.find(function (v) { return /^zh/i.test(norm(v)) && !/^zh-HK/i.test(norm(v)); }) || null;
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
      ? '呢部機暫時搵唔到廣東話語音。可以試吓按「試聽」，或者請家長喺系統設定安裝廣東話語音，又或者轉用普通話。'
      : '呢部機暫時搵唔到普通話語音，請家長喺系統設定安裝語音。';
  }
  return '';
}

function updateVoiceNotice() {
  const box = document.getElementById('voiceNotice');
  const s = me();
  if (!box || !s) return;
  const w = voiceWarning(s.prefs.lang);
  box.innerHTML = w ? '<div class="notice">⚠️ ' + esc(w) + '</div>' : '';
}

/* ---------- 特效 ---------- */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 2500);
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
   opts: { icon, title, text, okText, danger }；撳確定先會執行 onOk */
function confirmBox(opts, onOk) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
    '<div class="m-ico">' + (opts.icon || '❓') + '</div>' +
    '<h3>' + esc(opts.title) + '</h3><p>' + esc(opts.text || '') + '</p>' +
    '<div class="two-btns"><button class="btn ghost" data-m="no">取消</button>' +
    '<button class="btn ' + (opts.danger ? 'red' : 'green') + '" data-m="yes">' + esc(opts.okText || '確定') + '</button>' +
    '</div></div>';

  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.removeEventListener('keydown', onKey);
    back.remove();
  }

  back.addEventListener('click', function (e) {
    const b = e.target.closest('[data-m]');
    if (b) {
      close();
      if (b.dataset.m === 'yes') onOk();
    } else if (e.target === back) {
      close();
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

function render() {
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
  if (ui.view === 'quiz') afterQuizRender();
  if (ui.view === 'setup') refreshCount();
}

function homeView() {
  const cards = db.students.map(function (s) {
    return '<button class="student-card" data-action="pickStudent" data-id="' + esc(s.id) + '">' +
      '<span class="av">' + s.avatar + '</span><b>' + esc(s.name) + '</b>' +
      '<small class="muted">' + GRADES[s.grade - 1] + '</small></button>';
  }).join('');
  return '<header class="hero"><div class="logo">🐾</div><h1>默書樂園</h1>' +
    '<p>' + (db.students.length ? '撳返自己嘅頭像啦' : '先登記一位同學啦') + '</p></header>' +
    '<div class="grid">' + cards +
    '<button class="student-card add" data-action="goAdd"><span class="av">➕</span><b>新同學</b></button></div>' +
    '<div class="footer-links">' +
    '<button class="link" data-action="exportData">備份資料</button>' +
    '<button class="link" data-action="importData">還原資料</button></div>' +
    '<input type="file" id="importFile" accept="application/json,.json" hidden>';
}

function addView() {
  const f = ui.form;
  const grades = GRADES.map(function (g, i) {
    return '<button class="chip' + (f.grade === i + 1 ? ' on' : '') + '" data-action="setForm" data-key="grade" data-val="' + (i + 1) + '">' + g + '</button>';
  }).join('');
  const avs = AVATARS.map(function (a) {
    return '<button class="chip avatar' + (f.avatar === a ? ' on' : '') + '" data-action="setForm" data-key="avatar" data-val="' + a + '">' + a + '</button>';
  }).join('');
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
    '<div class="greet"><div class="big-av">' + s.avatar + '</div>' +
    '<h2>' + esc(s.name) + '，你好！</h2><p class="muted">' + GRADES[s.grade - 1] + '</p></div>' +
    '<div class="menu-grid">' +
    '<button class="menu-btn" data-action="goSetup" data-source="lessons"><span class="ico">✏️</span>開始默書</button>' +
    '<button class="menu-btn r" data-action="goSetup" data-source="bank"><span class="ico">👾</span>錯字怪獸' +
    (bankCount ? '<span class="badge">' + bankCount + '</span>' : '') + '</button>' +
    '<button class="menu-btn g" data-action="goLessons"><span class="ico">📚</span>我的詞庫</button>' +
    '<button class="menu-btn b" data-action="goStats"><span class="ico">📊</span>我的成績</button>' +
    '</div>' +
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

function lessonEditView(s) {
  const lesson = ui.editLessonId ? s.lessons.find(function (l) { return l.id === ui.editLessonId; }) : null;
  const title = lesson ? lesson.title : '第' + (s.lessons.length + 1) + '課';
  const words = lesson ? lesson.words.join('\n') : '';
  return '<div class="topnav"><button class="back" data-action="goLessons">← 返回</button></div>' +
    '<div class="card"><h2>' + (lesson ? '修改課文' : '新增課文') + '</h2>' +
    '<label class="field-label" for="lessonTitle">課文名稱</label>' +
    '<input type="text" id="lessonTitle" maxlength="20" autocomplete="off" value="' + esc(title) + '">' +
    '<label class="field-label" for="lessonWords">詞語（一行一個，或者用逗號、空格分開）</label>' +
    '<textarea id="lessonWords" placeholder="例如：&#10;蘋果&#10;香蕉&#10;西瓜">' + esc(words) + '</textarea>' +
    '<p class="muted" style="margin-top:8px">共 <b id="wordCount">' + parseWords(words).length + '</b> 個詞語</p>' +
    '<button class="btn green block" style="margin-top:18px" data-action="saveLesson">儲存 ✓</button></div>';
}

function setupView(s) {
  if (!ui.setup) initSetup(s, 'lessons');
  const c = ui.setup;
  const chip = function (key, val, label) {
    return '<button class="chip' + (c[key] === val ? ' on' : '') + '" data-action="setOpt" data-key="' + key + '" data-val="' + val + '">' + label + '</button>';
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
      return '<button class="chip' + (on ? ' on' : '') + '" data-action="toggleLesson" data-id="' + esc(l.id) + '">' +
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
    return '<button class="chip' + (p[key] === val ? ' on' : '') + '" data-action="setPref" data-key="' + key + '" data-val="' + val + '">' + label + '</button>';
  };
  const group = function (key, inner) {
    return '<div class="toggle-select" data-group="' + key + '">' + inner + '</div>';
  };
  const warn = voiceWarning(p.lang);
  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="card"><h2>設定</h2>' +
    '<span class="field-label">次序</span>' + group('order', chip('order', 'seq', '➡️ 順序') + chip('order', 'random', '🔀 亂序')) +
    '<span class="field-label">預設朗讀語言</span>' + group('lang', chip('lang', 'yue', LANGS.yue.label) + chip('lang', 'cmn', LANGS.cmn.label)) +
    '<p class="muted" style="margin-top:6px">默書時，每個詞語都可以隨時轉語言再聽。</p>' +
    '<span class="field-label">朗讀速度</span>' +
    group('speed', Object.keys(SPEEDS).map(function (k) { return chip('speed', k, SPEEDS[k].label); }).join('')) +
    '<button class="btn blue small" style="margin-top:14px" data-action="testVoice">🔊 試聽</button>' +
    '<div id="voiceNotice">' + (warn ? '<div class="notice">⚠️ ' + esc(warn) + '</div>' : '') + '</div></div>';
}

function initSetup(s, source) {
  ui.setup = {
    source: source, lessonIds: [], count: 12   // count: 12 = 預設；null = 全部詞語
  };
}

/* 已揀課文入面嘅詞語總數（重複嘅詞語只計一次） */
function setupTotal(s, c) {
  const seen = {};
  let n = 0;
  s.lessons.forEach(function (l) {
    if (c.lessonIds.indexOf(l.id) === -1) return;
    l.words.forEach(function (w) { if (!seen[w]) { seen[w] = true; n += 1; } });
  });
  return n;
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

/* ---------- 默書畫面 ---------- */
function langSwitch(q) {
  return '<div class="lang-switch" role="group" aria-label="朗讀語言">' +
    ['cmn', 'yue'].map(function (k) {
      return '<button class="lang-btn' + (q.curLang === k ? ' on' : '') + '" data-action="setWordLang" data-val="' + k + '">' + LANGS[k].label + '</button>';
    }).join('') + '</div>';
}

function revealLabel(locked) {
  return locked ? '🎧 聽完先可以睇答案' : '寫好啦，睇答案 👀';
}

function listenHtml(q) {
  return '<p class="prompt">聽下，寫喺紙上面 ✏️</p>' +
    '<button class="speaker" id="speakerBtn" data-action="speak" aria-label="再聽一次">🔊</button>' +
    '<div class="status" id="status">' + (q.waiting ? WAIT_HTML : '') + '</div>' +
    langSwitch(q) +
    '<div><button class="btn ghost small" data-action="slow">🐢 慢啲再讀</button></div>' +
    '<button class="btn green block" id="revealBtn" style="margin-top:22px;min-height:64px;font-size:1.25rem" data-action="reveal"' +
    (q.locked ? ' disabled' : '') + '>' + revealLabel(q.locked) + '</button>';
}

function answerHtml(q, word) {
  const vw = Math.min(18, Math.floor(80 / Math.max(Array.from(word).length, 1)));
  return '<p class="prompt">答案係</p>' +
    '<div class="answer-box" style="font-size:min(' + vw + 'vw,110px)">' + esc(word) + '</div>' +
    langSwitch(q) +
    '<div><button class="btn ghost small" data-action="speak">🔊 再聽一次</button></div>' +
    '<p class="prompt" style="margin-top:18px">你寫啱咗嗎？</p>' +
    '<div class="two-btns">' +
    '<button class="btn green" data-action="mark" data-ok="1">✓ 啱咗</button>' +
    '<button class="btn red" data-action="mark" data-ok="0">✗ 錯咗</button></div>';
}

function pickHtml(q, chars) {
  const sz = chars.length <= 4 ? 'min(20vw,96px)' : 'min(15vw,72px)';
  const tiles = chars.map(function (c, i) {
    return '<button class="tile' + (q.pickBad.indexOf(i) !== -1 ? ' bad' : '') + '" data-action="togglePick" data-i="' + i + '">' + esc(c) + '</button>';
  }).join('');
  return '<p class="prompt">邊個字寫錯咗？</p>' +
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
    '<div class="fb-av">' + s.avatar + '</div>' +
    '<h2>' + esc(q.fb.msg) + '</h2>' +
    (ok ? '' : '<div class="fb-word">' + charsHtml(word, q.fb.bad) + '</div>');
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
    '<div class="runner" style="left:calc((100% - 32px) * ' + q.shown + ')">' + s.avatar + '</div>' +
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
  const mascot = p === 100 ? '🏆' : p >= 80 ? s.avatar : p >= 50 ? '💪' : '🤗';
  const msg = p === 100 ? '全部啱晒！你好叻呀！' : p >= 80 ? '好勁呀！差啲就滿分！' : p >= 50 ? '幾好呀，繼續努力！' : '唔緊要，多練習就會進步！';
  let starHtml = '';
  for (let i = 0; i < 3; i++) starHtml += '<span>' + (i < stars ? '⭐' : '☆') + '</span>';

  let extra = '';
  if (r.wrong.length) extra += '<div class="result-section"><h3>❌ 要再練習嘅字</h3>' + wordChips(r.wrong) + '</div>';
  if (r.added.length) extra += '<div class="result-section"><h3>👾 放咗入錯字怪獸</h3>' + wordChips(r.added) + '</div>';
  if (r.hurt.length) {
    extra += '<div class="result-section"><h3>💥 怪獸受傷咗（括號係仲要默對幾次）</h3>' +
      wordChips(r.hurt.map(function (h) { return h.word + '（' + h.left + '）'; })) + '</div>';
  }
  if (r.removed.length) extra += '<div class="result-section"><h3>🎉 打敗咗怪獸（已經記得）</h3>' + wordChips(r.removed) + '</div>';

  return '<div class="card result-card"><div class="mascot">' + mascot + '</div>' +
    '<div class="stars">' + starHtml + '</div>' +
    '<div class="score">' + r.correct + ' / ' + r.total + '</div>' +
    '<p>' + msg + '</p>' + extra + '</div>' +
    '<div class="stack" style="margin-top:20px">' +
    '<button class="btn block" data-action="again">再默一次 🔁</button>' +
    '<button class="btn blue block" data-action="openRecord" data-id="' + esc(r.recordId) + '">睇詳細對錯 🔍</button>' +
    '<button class="btn ghost block" data-action="goMenu">返主頁 🏠</button></div>';
}

function recRow(h) {
  const p = pct(h.correct, h.total);
  const cls = p >= 80 ? '' : p >= 50 ? ' mid' : ' low';
  return '<div class="rec"><button class="rec-main" data-action="openRecord" data-id="' + esc(h.id) + '">' +
    '<span class="rec-time">' + shortDate(h.date) + ' ' + timeLabel(h.date) + '</span>' +
    '<span class="rec-label">' + esc(h.label) + '</span>' +
    '<span class="rec-score' + cls + '">' + h.correct + '/' + h.total + '</span></button>' +
    '<button class="icon-btn" data-action="deleteRecord" data-id="' + esc(h.id) + '" aria-label="刪除呢次紀錄">🗑</button></div>';
}

/* 由默書紀錄整理出：每個詞語入面，邊幾個字曾經寫錯（位置） */
function badIndexMap(s) {
  const map = {};
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
  const sumC = hist.reduce(function (a, h) { return a + h.correct; }, 0);
  const sumT = hist.reduce(function (a, h) { return a + h.total; }, 0);

  const recent = hist.slice(-10);
  const bars = recent.map(function (h) {
    const p = pct(h.correct, h.total);
    return '<div class="bar-col"><span class="v">' + p + '</span>' +
      '<div class="bar ' + (p >= 80 ? '' : p >= 50 ? 'mid' : 'low') + '" style="height:' + Math.max(p, 3) + '%"></div>' +
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
    return '<button class="chip' + (ui.statTab === key ? ' on' : '') + '" data-action="setStatTab" data-val="' + key + '">' + label + '</button>';
  };

  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="stack">' +
    '<div class="card"><div class="summary">' +
    '<div><div class="num">' + hist.length + '</div><div class="muted">默書次數</div></div>' +
    '<div><div class="num">' + pct(sumC, sumT) + '%</div><div class="muted">平均正確率</div></div>' +
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
    const c = g.items.reduce(function (a, h) { return a + h.correct; }, 0);
    const t = g.items.reduce(function (a, h) { return a + h.total; }, 0);
    return '<div class="card"><div class="day-head"><div class="t"><b>' + dayLabel(g.date) + '</b>' +
      '<div class="muted">' + g.items.length + ' 次 · 平均 ' + pct(c, t) + '%</div></div>' +
      '<button class="btn ghost small" data-action="deleteDay" data-day="' + esc(g.key) + '">🗑 刪除呢日</button></div>' +
      g.items.map(recRow).join('') + '</div>';
  }).join('');

  return back + '<h2 style="margin-bottom:12px">所有紀錄</h2><div class="stack">' + cards + '</div>';
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
    '<div class="muted">預設朗讀：' + (LANGS[h.lang] || LANGS.yue).label + '</div></div>' +
    '<span class="rec-score' + (p >= 80 ? '' : p >= 50 ? ' mid' : ' low') + '">' + h.correct + '/' + h.total + '</span></div>' +
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
    total: q.results.length,
    correct: correct,
    wrong: wrong,
    results: q.results.map(function (r) { return { word: r.word, ok: r.ok, bad: r.bad }; })
  };
  s.history.push(rec);
  if (s.history.length > 200) s.history = s.history.slice(-200);
  saveDB();
  ui.result = {
    total: rec.total, correct: correct, wrong: wrong, recordId: rec.id,
    added: q.added, removed: q.removed, hurt: q.hurt
  };
  go('result');
  const p = pct(correct, rec.total);
  if (p >= 80) confetti(p === 100 ? 70 : 35);
}

/* =====================================================
   互動（data-action 對應嘅處理函式）
   ===================================================== */
const actions = {};

/* 同一組選項入面，只更新 class，唔重新畫整個畫面（避免閃爍） */
function selectInGroup(el) {
  Array.prototype.forEach.call(el.parentElement.children, function (x) { x.classList.remove('on'); });
  el.classList.add('on', 'pop');
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

  exportData: function () {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'chi-vocab-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  },
  importData: function () { document.getElementById('importFile').click(); },

  goMenu: function () { go('menu'); },
  goLessons: function () { ui.editLessonId = null; go('lessons'); },
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
  setPref: function (el) {
    const s = me();
    s.prefs[el.dataset.key] = el.dataset.val;
    saveDB();
    selectInGroup(el);
    if (el.dataset.key === 'lang') updateVoiceNotice();
  },
  toggleLesson: function (el) {
    const ids = ui.setup.lessonIds;
    const i = ids.indexOf(el.dataset.id);
    if (i === -1) ids.push(el.dataset.id); else ids.splice(i, 1);
    el.classList.toggle('on');
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
      const seen = {};
      picked.forEach(function (l) {
        l.words.forEach(function (w) { if (!seen[w]) { seen[w] = true; words.push(w); } });
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
    unlockSpeech();
    ui.quiz = {
      source: c.source, label: label, words: words, idx: 0, results: [],
      added: [], removed: [], hurt: [], lang: p.lang, speed: p.speed, shown: 0
    };
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
    Array.prototype.forEach.call(el.parentElement.children, function (x) { x.classList.toggle('on', x === el); });
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
  mark: function (el) {
    const q = ui.quiz;
    if (q.phase !== 'answer') return;
    if (el.dataset.ok === '1') { commitAnswer(true, []); return; }
    if (Array.from(q.words[q.idx]).length <= 1) { commitAnswer(false, [0]); return; }
    q.pickBad = [];
    q.phase = 'pick';   // 多過一個字，問邊個字寫錯
    render();
  },
  togglePick: function (el) {
    const q = ui.quiz;
    if (q.phase !== 'pick') return;
    const i = Number(el.dataset.i);
    const at = q.pickBad.indexOf(i);
    if (at === -1) q.pickBad.push(i); else q.pickBad.splice(at, 1);
    el.classList.toggle('bad');
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
    confirmBox({
      icon: '🛑', title: '停止默書？',
      text: '已經答咗嘅題目會保留。', okText: '停止'
    }, function () {
      if (ui.view !== 'quiz') return;
      const s = me();
      if (ui.quiz.results.length) finishQuiz(s); else go('menu');
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
  if (fn) fn(el);
});

document.addEventListener('input', function (e) {
  if (e.target.id === 'nameInput') ui.form.name = e.target.value;
  if (e.target.id === 'lessonWords') {
    document.getElementById('wordCount').textContent = parseWords(e.target.value).length;
  }
  if (e.target.id === 'countRange' && ui.setup) {
    const total = setupTotal(me(), ui.setup);
    const v = Number(e.target.value);
    ui.setup.count = v >= total ? null : v;   // 拉到最右 = 全部
    refreshCount();
  }
});

document.addEventListener('change', function (e) {
  if (e.target.id !== 'importFile') return;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    let data;
    try {
      data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.students)) throw new Error('format');
      data.students.forEach(function (st) {
        if (!st.id || !st.name) throw new Error('format');
        normaliseStudent(st);
      });
    } catch (err) {
      toast('檔案格式唔啱，還原失敗');
      return;
    }
    confirmBox({
      icon: '📥', title: '還原資料？',
      text: '會取代而家所有資料（共 ' + data.students.length + ' 位同學）。',
      okText: '還原', danger: true
    }, function () {
      db = { students: data.students, currentId: null };
      saveDB();
      render();
      toast('還原成功 ✓');
    });
  };
  reader.readAsText(file);
  e.target.value = '';
});

render();
