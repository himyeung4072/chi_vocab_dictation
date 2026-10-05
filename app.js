'use strict';

/* =====================================================
   默書樂園 - 小學生自行默書練習
   純前端，資料存喺瀏覽器 localStorage
   ===================================================== */

const STORE_KEY = 'chiVocab.v1';
const AVATARS = ['🐶', '🐱', '🐰', '🐼', '🦊', '🐸', '🐯', '🐨', '🐷', '🦁', '🐵', '🐥'];
const GRADES = ['小一', '小二', '小三', '小四', '小五', '小六'];
const SPEEDS = {
  slow: { label: '🐢 慢', rate: 0.55 },
  normal: { label: '🐰 正常', rate: 0.8 },
  fast: { label: '🐆 快', rate: 1.05 }
};
const LANGS = {
  yue: { label: '廣東話' },
  cmn: { label: '普通話' }
};
const CHEERS = ['好嘢！', '叻呀！', '正呀！', '好勁！', '繼續加油！'];
const COMFORTS = ['唔緊要，下次記得！', '錯咗先會記得牢啲！', '加油，再嚟！'];

const $app = document.getElementById('app');
const $fx = document.getElementById('fx');

/* ---------- 資料儲存 ---------- */
function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.students)) return data;
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
  result: null
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

function newStudent(name, grade, avatar) {
  return {
    id: uid(), name: name, grade: grade, avatar: avatar,
    lessons: [], wordStats: {}, bank: {}, history: [],
    prefs: { order: 'seq', lang: 'yue', speed: 'normal' }
  };
}

function go(view) {
  ui.view = view;
  render();
  window.scrollTo(0, 0);
}

/* ---------- 朗讀 ---------- */
let voices = [];
function refreshVoices() {
  if ('speechSynthesis' in window) voices = window.speechSynthesis.getVoices() || [];
}
if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', function () {
    refreshVoices();
    if (ui.view === 'setup') render();
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

function speak(text, langKey, rate) {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(langKey);
  if (v) { u.voice = v; u.lang = v.lang; }
  else { u.lang = langKey === 'yue' ? 'zh-HK' : 'zh-CN'; }
  u.rate = rate;
  synth.speak(u);
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

/* ---------- 特效 ---------- */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 2500);
}

function popMsg(emoji, text) {
  const el = document.createElement('div');
  el.className = 'pop-msg';
  el.innerHTML = '<span class="e">' + emoji + '</span>' + esc(text);
  $fx.appendChild(el);
  setTimeout(function () { el.remove(); }, 1000);
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

/* ---------- 錯字詞庫規則 ----------
   每個詞語第一次默錯 → 放入錯字詞庫，需要默對 1 次先剔走。
   剔走後若再默錯 → 再入庫，需要默對 2 次，如此類推。
   喺錯字詞庫默錯 → 已默對嘅次數歸零（要求唔變）。
   只有喺「錯字詞庫」模式默對先會計算進度。 */
function recordAnswer(s, word, ok, source, quiz) {
  const st = s.wordStats[word] || (s.wordStats[word] = { attempts: 0, wrong: 0, bankEntries: 0 });
  st.attempts += 1;
  if (!ok) st.wrong += 1;

  const inBank = s.bank[word];
  if (source === 'bank') {
    if (ok && inBank) {
      inBank.progress += 1;
      if (inBank.progress >= inBank.need) {
        delete s.bank[word];
        quiz.removed.push(word);
      }
    } else if (!ok && inBank) {
      inBank.progress = 0;
    }
  } else if (!ok) {
    if (inBank) {
      inBank.progress = 0;
    } else {
      st.bankEntries += 1;
      s.bank[word] = { need: st.bankEntries, progress: 0 };
      quiz.added.push(word);
    }
  }
}

/* =====================================================
   畫面
   ===================================================== */

function render() {
  const s = me();
  if (ui.view !== 'home' && ui.view !== 'add' && !s) ui.view = 'home';
  const views = {
    home: homeView, add: addView, menu: menuView, lessons: lessonsView,
    lessonEdit: lessonEditView, setup: setupView, quiz: quizView,
    result: resultView, stats: statsView
  };
  $app.innerHTML = '<div class="view">' + (views[ui.view] || homeView)(s) + '</div>';
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
    '<span class="field-label">讀幾年級？</span><div class="chips">' + grades + '</div>' +
    '<span class="field-label">揀個頭像</span><div class="chips">' + avs + '</div>' +
    '<button class="btn green block" style="margin-top:26px" data-action="saveStudent">完成 ✓</button></div>';
}

function menuView(s) {
  const bankCount = Object.keys(s.bank).length;
  return '<div class="topnav"><button class="back" data-action="goHome">← 換人</button></div>' +
    '<div class="greet"><div class="big-av">' + s.avatar + '</div>' +
    '<h2>' + esc(s.name) + '，你好！</h2><p class="muted">' + GRADES[s.grade - 1] + '</p></div>' +
    '<div class="menu-grid">' +
    '<button class="menu-btn o" data-action="goSetup" data-source="lessons"><span class="ico">✏️</span>開始默書</button>' +
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
        '<button class="btn ghost small" data-action="deleteLesson" data-id="' + esc(l.id) + '">🗑</button></div>';
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
  if (!ui.setup) ui.setup = { source: 'lessons', lessonIds: [], order: s.prefs.order, lang: s.prefs.lang, speed: s.prefs.speed };
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
          return '<span class="chip word">' + esc(w) + ' <small class="muted">×' + (b.need - b.progress) + '</small></span>';
        }).join('') + '</div>';
    }
  } else if (!s.lessons.length) {
    sourceBlock = '<div class="empty"><span class="em">📝</span>仲未有課文，<br>請先去「我的詞庫」新增。</div>';
  } else {
    sourceBlock = '<div class="chips">' + s.lessons.map(function (l) {
      const on = c.lessonIds.indexOf(l.id) !== -1;
      return '<button class="chip' + (on ? ' on' : '') + '" data-action="toggleLesson" data-id="' + esc(l.id) + '">' +
        (on ? '✓ ' : '') + esc(l.title) + ' <small>(' + l.words.length + ')</small></button>';
    }).join('') + '</div>' +
      '<button class="link" data-action="allLessons">全選 / 取消全選</button>';
  }

  const warn = voiceWarning(c.lang);
  const canStart = c.source === 'bank' ? bankWords.length > 0 : (s.lessons.length > 0);

  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="card"><h2>默書設定</h2>' +
    '<span class="field-label">默邊度？</span>' +
    '<div class="toggle-select">' + chip('source', 'lessons', '📚 課文') + chip('source', 'bank', '👾 錯字怪獸') + '</div>' +
    '<div style="margin-top:14px">' + sourceBlock + '</div>' +
    '<span class="field-label">次序</span><div class="toggle-select">' + chip('order', 'seq', '➡️ 順序') + chip('order', 'random', '🔀 亂序') + '</div>' +
    '<span class="field-label">朗讀語言</span><div class="toggle-select">' + chip('lang', 'yue', LANGS.yue.label) + chip('lang', 'cmn', LANGS.cmn.label) + '</div>' +
    '<span class="field-label">朗讀速度</span><div class="toggle-select">' +
    Object.keys(SPEEDS).map(function (k) { return chip('speed', k, SPEEDS[k].label); }).join('') + '</div>' +
    '<button class="btn blue small" style="margin-top:14px" data-action="testVoice">🔊 試聽</button>' +
    (warn ? '<div class="notice">⚠️ ' + esc(warn) + '</div>' : '') + '</div>' +
    '<button class="btn block" style="margin-top:20px;min-height:68px;font-size:1.3rem"' + (canStart ? '' : ' disabled') + ' data-action="startQuiz">開始默書 🚀</button>';
}

function quizView(s) {
  const q = ui.quiz;
  const total = q.words.length;
  const word = q.words[q.idx];
  const progress = q.idx / total;
  const vw = Math.min(18, Math.floor(80 / Math.max(word.length, 1)));

  let body;
  if (!q.revealed) {
    body = '<p class="prompt">聽下，寫喺紙上面 ✏️</p>' +
      '<button class="speaker" id="speakerBtn" data-action="speak" aria-label="再聽一次">🔊</button>' +
      '<button class="btn ghost small" data-action="slow">🐢 慢啲再讀</button>' +
      '<button class="btn green block" style="margin-top:22px;min-height:64px;font-size:1.25rem" data-action="reveal">寫好啦，睇答案 👀</button>';
  } else {
    body = '<p class="prompt">答案係</p>' +
      '<div class="answer-box" style="font-size:min(' + vw + 'vw,110px)">' + esc(word) + '</div>' +
      '<button class="btn ghost small" data-action="speak">🔊 再聽一次</button>' +
      '<p class="prompt" style="margin-top:18px">你寫啱咗嗎？</p>' +
      '<div class="two-btns">' +
      '<button class="btn green" data-action="mark" data-ok="1">✓ 啱咗</button>' +
      '<button class="btn red" data-action="mark" data-ok="0">✗ 錯咗</button></div>';
  }

  return '<div class="quiz-top"><button class="quit" data-action="quit" aria-label="停止默書">✕</button>' +
    '<div class="track"><div class="fill" style="width:' + Math.round(progress * 100) + '%"></div>' +
    '<div class="runner" style="left:calc((100% - 32px) * ' + progress + ')">' + s.avatar + '</div>' +
    '<span class="flag">🏁</span></div>' +
    '<div class="count">' + (q.idx + 1) + ' / ' + total + '</div></div>' +
    '<div class="card quiz-card">' + body + '</div>';
}

function resultView(s) {
  const r = ui.result;
  const p = pct(r.correct, r.total);
  const stars = p === 100 ? 3 : p >= 80 ? 2 : p >= 50 ? 1 : 0;
  const mascot = p === 100 ? '🏆' : p >= 80 ? s.avatar : p >= 50 ? '💪' : '🤗';
  const msg = p === 100 ? '全部啱晒！你好叻呀！' : p >= 80 ? '好勁呀！差啲就滿分！' : p >= 50 ? '幾好呀，繼續努力！' : '唔緊要，多練習就會進步！';
  let starHtml = '';
  for (let i = 0; i < 3; i++) starHtml += '<span>' + (i < stars ? '⭐' : '☆') + '</span>';

  const chips = function (arr) {
    return '<div class="chips">' + arr.map(function (w) { return '<span class="chip word">' + esc(w) + '</span>'; }).join('') + '</div>';
  };

  let extra = '';
  if (r.wrong.length) extra += '<div class="result-section"><h3>❌ 要再練習嘅字</h3>' + chips(r.wrong) + '</div>';
  if (r.added.length) extra += '<div class="result-section"><h3>👾 放咗入錯字怪獸</h3>' + chips(r.added) + '</div>';
  if (r.removed.length) extra += '<div class="result-section"><h3>🎉 打敗咗怪獸（已經記得）</h3>' + chips(r.removed) + '</div>';

  return '<div class="card result-card"><div class="mascot">' + mascot + '</div>' +
    '<div class="stars">' + starHtml + '</div>' +
    '<div class="score">' + r.correct + ' / ' + r.total + '</div>' +
    '<p>' + msg + '</p>' + extra + '</div>' +
    '<div class="stack" style="margin-top:20px">' +
    '<button class="btn block" data-action="again">再默一次 🔁</button>' +
    '<button class="btn ghost block" data-action="goMenu">返主頁 🏠</button></div>';
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
    const d = new Date(h.date);
    return '<div class="bar-col"><span class="v">' + p + '</span>' +
      '<div class="bar ' + (p >= 80 ? '' : p >= 50 ? 'mid' : 'low') + '" style="height:' + Math.max(p, 3) + '%"></div>' +
      '<small>' + (d.getMonth() + 1) + '/' + d.getDate() + '</small></div>';
  }).join('');

  const rows = Object.keys(s.wordStats).map(function (w) {
    const st = s.wordStats[w];
    return { w: w, attempts: st.attempts, wrong: st.wrong, rate: pct(st.wrong, st.attempts) };
  }).filter(function (x) { return x.wrong > 0; }).sort(function (a, b) {
    return b.rate - a.rate || b.wrong - a.wrong;
  }).slice(0, 15);

  const rateHtml = rows.length ? rows.map(function (x) {
    return '<div class="rate-row"><span class="w">' + esc(x.w) + '</span>' +
      '<span class="meter"><i style="width:' + x.rate + '%"></i></span>' +
      '<span class="pct">錯 ' + x.wrong + '/' + x.attempts + '（' + x.rate + '%）</span></div>';
  }).join('') : '<div class="empty"><span class="em">🌟</span>到依家一個字都冇錯過！</div>';

  const histHtml = hist.slice(-10).reverse().map(function (h) {
    const d = new Date(h.date);
    return '<div class="hist-row"><span>' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + esc(h.label) + '</span>' +
      '<b>' + h.correct + ' / ' + h.total + '</b></div>';
  }).join('');

  return '<div class="topnav"><button class="back" data-action="goMenu">← 返回</button></div>' +
    '<div class="stack">' +
    '<div class="card"><div class="summary">' +
    '<div><div class="num">' + hist.length + '</div><div class="muted">默書次數</div></div>' +
    '<div><div class="num">' + pct(sumC, sumT) + '%</div><div class="muted">平均正確率</div></div>' +
    '<div><div class="num">' + Object.keys(s.bank).length + '</div><div class="muted">錯字怪獸</div></div></div></div>' +
    '<div class="card"><h3>最近 ' + recent.length + ' 次成績（%）</h3><div class="bars">' + bars + '</div></div>' +
    '<div class="card"><h3>最易錯嘅字（錯誤率）</h3>' + rateHtml + '</div>' +
    '<div class="card"><h3>默書紀錄</h3>' + histHtml + '</div></div>';
}

/* =====================================================
   互動
   ===================================================== */

function initSetup(s, source) {
  ui.setup = { source: source, lessonIds: [], order: s.prefs.order, lang: s.prefs.lang, speed: s.prefs.speed };
}

function finishQuiz(s) {
  const q = ui.quiz;
  const correct = q.results.filter(function (r) { return r.ok; }).length;
  const wrong = q.results.filter(function (r) { return !r.ok; }).map(function (r) { return r.word; });
  s.history.push({
    date: new Date().toISOString(),
    label: q.label,
    source: q.source,
    lang: q.lang,
    total: q.results.length,
    correct: correct,
    wrong: wrong
  });
  if (s.history.length > 200) s.history = s.history.slice(-200);
  saveDB();
  ui.result = { total: q.results.length, correct: correct, wrong: wrong, added: q.added, removed: q.removed };
  go('result');
  if (pct(correct, q.results.length) >= 80) confetti(pct(correct, q.results.length) === 100 ? 70 : 35);
}

function normaliseStudent(st) {
  st.lessons = Array.isArray(st.lessons) ? st.lessons : [];
  st.wordStats = st.wordStats || {};
  st.bank = st.bank || {};
  st.history = Array.isArray(st.history) ? st.history : [];
  st.prefs = st.prefs || { order: 'seq', lang: 'yue', speed: 'normal' };
  st.grade = Math.min(6, Math.max(1, Number(st.grade) || 1));
  st.avatar = st.avatar || AVATARS[0];
  return st;
}

const actions = {
  goHome: function () { db.currentId = null; saveDB(); go('home'); },
  goAdd: function () { ui.form = { name: '', grade: 1, avatar: AVATARS[0] }; go('add'); },
  setForm: function (el) {
    const key = el.dataset.key;
    ui.form[key] = key === 'grade' ? Number(el.dataset.val) : el.dataset.val;
    render();
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
    if (!confirm('確定刪除「' + s.name + '」？所有詞庫同成績都會消失，無法還原。')) return;
    db.students = db.students.filter(function (x) { return x.id !== s.id; });
    db.currentId = null;
    saveDB();
    go('home');
  },

  exportData: function () {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'chi-vocab-backup-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
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
    if (!l || !confirm('確定刪除「' + l.title + '」？（成績紀錄會保留）')) return;
    s.lessons = s.lessons.filter(function (x) { return x.id !== l.id; });
    saveDB();
    render();
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
  },

  goSetup: function (el) { initSetup(me(), el.dataset.source); go('setup'); },
  setOpt: function (el) { ui.setup[el.dataset.key] = el.dataset.val; render(); },
  toggleLesson: function (el) {
    const ids = ui.setup.lessonIds;
    const i = ids.indexOf(el.dataset.id);
    if (i === -1) ids.push(el.dataset.id); else ids.splice(i, 1);
    render();
  },
  allLessons: function () {
    const s = me();
    ui.setup.lessonIds = ui.setup.lessonIds.length === s.lessons.length ? [] : s.lessons.map(function (l) { return l.id; });
    render();
  },
  testVoice: function () {
    speak('你好，我哋開始默書啦', ui.setup.lang, SPEEDS[ui.setup.speed].rate);
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
      label = picked.length > 2 ? picked[0].title + ' 等' + picked.length + '課' : picked.map(function (l) { return l.title; }).join('、');
    }
    if (!words.length) { toast('冇詞語可以默'); return; }
    if (c.order === 'random') words = shuffle(words);
    s.prefs = { order: c.order, lang: c.lang, speed: c.speed };
    saveDB();
    ui.quiz = {
      source: c.source, label: label, words: words, idx: 0, results: [], revealed: false,
      added: [], removed: [], lang: c.lang, speed: c.speed
    };
    go('quiz');
    speak(words[0], c.lang, SPEEDS[c.speed].rate);
  },
  again: function () {
    if (ui.setup) actions.startQuiz(); else go('menu');
  },

  speak: function () {
    const q = ui.quiz;
    speak(q.words[q.idx], q.lang, SPEEDS[q.speed].rate);
    const btn = document.getElementById('speakerBtn');
    if (btn) { btn.classList.remove('speaking'); void btn.offsetWidth; btn.classList.add('speaking'); }
  },
  slow: function () {
    const q = ui.quiz;
    speak(q.words[q.idx], q.lang, 0.45);
  },
  reveal: function () { ui.quiz.revealed = true; render(); },
  mark: function (el) {
    const s = me();
    const q = ui.quiz;
    const ok = el.dataset.ok === '1';
    const word = q.words[q.idx];
    recordAnswer(s, word, ok, q.source, q);
    q.results.push({ word: word, ok: ok });
    saveDB();
    if (ok) popMsg('⭐', pick(CHEERS)); else popMsg('💪', pick(COMFORTS));
    q.idx += 1;
    if (q.idx >= q.words.length) { finishQuiz(s); return; }
    q.revealed = false;
    render();
    speak(q.words[q.idx], q.lang, SPEEDS[q.speed].rate);
  },
  quit: function () {
    if (!confirm('確定要停止默書？已經答咗嘅題目會保留。')) return;
    const s = me();
    if (ui.quiz.results.length) { finishQuiz(s); } else { go('menu'); }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  },

  goStats: function () { go('stats'); }
};

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
});

document.addEventListener('change', function (e) {
  if (e.target.id !== 'importFile') return;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.students)) throw new Error('format');
      data.students.forEach(function (st) {
        if (!st.id || !st.name) throw new Error('format');
        normaliseStudent(st);
      });
      if (!confirm('還原會取代而家所有資料（共 ' + data.students.length + ' 位同學），確定嗎？')) return;
      db = { students: data.students, currentId: null };
      saveDB();
      render();
      toast('還原成功 ✓');
    } catch (err) {
      toast('檔案格式唔啱，還原失敗');
    }
  };
  reader.readAsText(file);
});

render();
