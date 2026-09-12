/**
 * 影子100 APP v3.3 - 主逻辑
 * 分类（文件夹）+ 歌词（LRC/TXT）+ 录音时自动隐藏歌词
 */

const TARGET = 100;
const DEFAULT_CATEGORY = '新概念英语';

let currentCategory = null;
let currentLesson = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordStartTime = 0;
let recordTimer = null;
let recordAutoStopTimer = null;  // 播放完5秒自动停止
let lyricsData = [];       // [{time, text}]
let showLyricsPref = true; // 歌词显示偏好

// ========== 初始化 ==========
async function init() {
  await ensureCategory(DEFAULT_CATEGORY);
  await renderHome();
  setupImport();
  setupLyricsToggle();
}

// ========== 视图 ==========
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
}

function goHome() { showView('home'); renderHome(); }

function goCategory() {
  if (currentCategory) {
    showView('category');
    renderCategory();
  } else {
    goHome();
  }
}

function openImport() { showView('import'); renderCategoryOptions(); }

// ========== 统计页 ==========
function openStats() { showView('stats'); renderStats(); }

// 当天零点时间戳（本地时区）
function dayKey(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function renderStats() {
  const { records } = await getStats();

  // 按天聚合：哪些天练过 + 每天总时长
  const dayMap = {};
  records.forEach(r => {
    const k = dayKey(r.time);
    if (!dayMap[k]) dayMap[k] = { count: 0, seconds: 0 };
    dayMap[k].count++;
    dayMap[k].seconds += (r.duration || 0);
  });
  const days = Object.keys(dayMap).map(Number).sort((a, b) => a - b);

  const totalDays = days.length;

  // 连续天数：从今天（或昨天，今天还没练不断链）往回数
  let streak = 0;
  const todayKey = dayKey(Date.now());
  const yesterdayKey = todayKey - 86400000;
  if (days.length > 0) {
    let cursor;
    if (dayMap[todayKey]) cursor = todayKey;
    else if (dayMap[yesterdayKey]) cursor = yesterdayKey;
    else cursor = null;
    while (cursor !== null && dayMap[cursor]) {
      streak++;
      cursor -= 86400000;
    }
  }

  // 最长连续记录
  let best = 0, run = 0, prev = null;
  days.forEach(d => {
    if (prev !== null && d - prev === 86400000) run++;
    else run = 1;
    if (run > best) best = run;
    prev = d;
  });

  // 累计时长
  const totalSeconds = records.reduce((s, r) => s + (r.duration || 0), 0);
  const totalMinutes = Math.round(totalSeconds / 60);
  let hoursText;
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    hoursText = m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  } else {
    hoursText = `${totalMinutes} 分钟`;
  }

  // 起始日期（手动格式化，避免locale差异）
  const fmtCN = ts => `${new Date(ts).getFullYear()}年${new Date(ts).getMonth() + 1}月${new Date(ts).getDate()}日`;
  const sinceEl = document.getElementById('st-since');
  sinceEl.textContent = totalDays > 0
    ? `从 ${fmtCN(days[0])} 开始的坚持`
    : '还没有练习记录，今天开始吧！';

  document.getElementById('st-total-days').textContent = totalDays;
  document.getElementById('st-streak').textContent = streak;
  document.getElementById('st-hours').textContent = hoursText;
  document.getElementById('st-count').textContent = records.length;
  document.getElementById('st-best').textContent = best;

  // 最近28天打卡条
  const strip = document.getElementById('st-strip');
  strip.innerHTML = '';
  const now = new Date();
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = d.getTime();
    const cell = document.createElement('div');
    cell.className = 'cell' + (dayMap[k] ? ' hit' : '') + (i === 0 ? ' today' : '');
    cell.textContent = d.getDate();
    cell.title = `${d.getMonth() + 1}月${d.getDate()}日` + (dayMap[k] ? ` · 练${dayMap[k].count}次` : '');
    strip.appendChild(cell);
  }
}

let manageMode = false;

function toggleManage() {
  manageMode = !manageMode;
  document.getElementById('btn-manage').textContent = manageMode ? '✓ 完成' : '✎ 管理';
  renderCategory();
}

// ========== 首页（分类列表） ==========
async function renderHome() {
  const { categories, lessons, records, countMap } = await getStats();

  document.getElementById('stat-cats').textContent = categories.length;
  document.getElementById('stat-lessons').textContent = lessons.length;
  document.getElementById('stat-records').textContent = records.length;

  const container = document.getElementById('category-list');
  container.innerHTML = '';

  categories.sort((a, b) => a.time - b.time).forEach(cat => {
    const catLessons = lessons.filter(l => (l.categoryId || 1) === cat.id);
    const totalPractice = catLessons.reduce((sum, l) => sum + (countMap[l.id] || 0), 0);
    const done = catLessons.filter(l => (countMap[l.id] || 0) >= TARGET).length;

    const div = document.createElement('div');
    div.className = 'category-item';
    div.innerHTML = `
      <div class="cat-icon">${catLessons.length ? '📁' : '📂'}</div>
      <div class="cat-info">
        <div class="cat-name">${cat.name}</div>
        <div class="cat-sub">${catLessons.length}课 · ${totalPractice}次练习${done ? ` · ${done}达标` : ''}</div>
      </div>
      <div class="cat-arrow">›</div>
    `;
    div.onclick = () => openCategory(cat.id);
    // 长按删除分类
    let pressTimer = null;
    div.ontouchstart = () => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (confirm(`长按操作：删除分类「${cat.name}」及其全部课程和录音？`)) {
          delCategory(cat.id);
        }
      }, 800);
    };
    div.ontouchend = div.ontouchmove = div.ontouchcancel = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    };
    container.appendChild(div);
  });
}

function openCategory(catId) {
  currentCategory = catId;
  showView('category');
  renderCategory();
}

// ========== 分类页（课程网格） ==========
async function renderCategory() {
  const cats = await getAllCategories();
  const cat = cats.find(c => c.id === currentCategory);
  if (!cat) { goHome(); return; }

  const lessons = await getLessonsByCategory(cat.id);
  const { countMap } = await getStats();

  document.getElementById('cat-title').textContent = cat.name;
  document.getElementById('cat-sub').textContent = `${lessons.length} 个课程`;

  const container = document.getElementById('lesson-list');
  container.innerHTML = '';

  if (lessons.length === 0) {
    container.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#64748b;padding:40px 0;">这个分类还没有课程，点首页的「导入新内容」</p>';
    return;
  }

  lessons.sort((a, b) => a.book - b.book || a.lesson - b.lesson).forEach(lesson => {
    const count = countMap[lesson.id] || 0;
    const div = document.createElement('div');
    div.className = 'lesson-item' + (count >= TARGET ? ' done' : '') + (manageMode ? ' managing' : '');
    div.innerHTML = `
      <div class="num">${lesson.book}-${String(lesson.lesson).padStart(2, '0')}</div>
      <div class="cnt">${count}/${TARGET}</div>
      ${manageMode ? `<button class="del-btn" onclick="event.stopPropagation(); delLesson(${lesson.id})">✕</button>` : ''}
    `;
    div.onclick = () => { if (!manageMode) openPractice(lesson.id); };
    container.appendChild(div);
  });
}

// ========== 删除 ==========
async function delLesson(id) {
  const lesson = await getLesson(id);
  const name = lesson ? (lesson.title || `第${lesson.lesson}课`) : '该课程';
  if (!confirm(`确定删除「${name}」？\n该课程的全部练习录音也会一起删除，不可恢复。`)) return;
  await deleteLesson(id);
  renderCategory();
}

async function delCategory(catId) {
  const cats = await getAllCategories();
  const cat = cats.find(c => c.id === catId);
  if (!cat) return;
  const lessons = await getLessonsByCategory(catId);
  const msg = lessons.length
    ? `确定删除分类「${cat.name}」？\n包含 ${lessons.length} 个课程及全部练习录音，不可恢复。`
    : `确定删除空分类「${cat.name}」？`;
  if (!confirm(msg)) return;
  for (const l of lessons) await deleteLesson(l.id);
  await deleteCategory(catId);
  currentCategory = null;
  goHome();
}

// ========== LRC 解析 ==========
function parseLRC(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const times = [];
    let match;
    timeRegex.lastIndex = 0;
    while ((match = timeRegex.exec(line)) !== null) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
      times.push(min * 60 + sec + ms / 1000);
    }
    const lyricText = line.replace(timeRegex, '').trim();
    if (times.length > 0 && lyricText) {
      times.forEach(t => result.push({ time: t, text: lyricText }));
    }
  }
  result.sort((a, b) => a.time - b.time);
  return result;
}

function isLRC(text) {
  return /\[\d{1,2}:\d{1,2}/.test(text);
}

// ========== 练习页 ==========
async function openPractice(id) {
  currentLesson = await getLesson(id);
  if (!currentLesson) return;

  document.getElementById('p-title').textContent =
    currentLesson.title || `第${currentLesson.book}册 第${currentLesson.lesson}课`;
  document.getElementById('p-subtitle').textContent = currentLesson.subtitle || '';

  // 音频：优先 blob（导入时拷贝），其次 uri（文件夹导入，引用外部文件）
  const audio = document.getElementById('audio');
  if (currentLesson.audioBlob) {
    audio.src = URL.createObjectURL(currentLesson.audioBlob);
  } else if (currentLesson.audioUri) {
    audio.src = currentLesson.audioUri; // content:// URI，WebView 可直接播放
  }

  // 歌词
  lyricsData = currentLesson.lyrics
    ? (isLRC(currentLesson.lyrics) ? parseLRC(currentLesson.lyrics) : [])
    : [];

  showLyricsPref = true;
  document.getElementById('lyrics-switch').checked = true;
  syncLyrics._last = undefined;

  await renderLyrics();
  await renderPractice();
  showView('practice');
}

async function renderLyrics() {
  const box = document.getElementById('lyrics-box');
  const hint = document.getElementById('record-hint');

  if (isRecording) {
    // 录音中：不显示歌词（核心需求）
    box.style.display = 'none';
    hint.classList.remove('hidden');
    return;
  }

  hint.classList.add('hidden');

  if (!showLyricsPref || lyricsData.length === 0) {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = lyricsData.map((l, i) =>
    `<div class="lyric-line" data-i="${i}">${l.text}</div>`
  ).join('');
}

function setupLyricsToggle() {
  document.getElementById('lyrics-switch').onchange = (e) => {
    showLyricsPref = e.target.checked;
    renderLyrics();
  };
}

// 歌词同步高亮
function syncLyrics() {
  if (!showLyricsPref || isRecording || lyricsData.length === 0) return;
  const audio = document.getElementById('audio');
  const t = audio.currentTime;
  let active = -1;
  for (let i = lyricsData.length - 1; i >= 0; i--) {
    if (t >= lyricsData[i].time) { active = i; break; }
  }
  if (active === syncLyrics._last) return;
  syncLyrics._last = active;
  document.querySelectorAll('.lyric-line').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.i) === active);
  });
  const activeEl = document.querySelector('.lyric-line.active');
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function renderPractice() {
  if (!currentLesson) return;

  const records = await getRecordsByLesson(currentLesson.id);
  const count = records.length;

  document.getElementById('p-count').textContent = count;
  document.getElementById('p-target').textContent = TARGET;
  document.getElementById('p-next').textContent = count + 1;
  document.getElementById('p-rec-count').textContent = count;
  document.getElementById('p-progress').style.width = Math.min(100, count / TARGET * 100) + '%';

  const list = document.getElementById('record-list');
  list.innerHTML = '';

  if (records.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">还没有录音</p>';
    return;
  }

  records.sort((a, b) => b.time - a.time).forEach(rec => {
    const div = document.createElement('div');
    div.className = 'record-item';
    div.id = `rec-${rec.id}`;
    div.innerHTML = `
      <div class="info">
        <div>第${rec.attempt}次练习</div>
        <div class="time">${new Date(rec.time).toLocaleString()}</div>
      </div>
      <div class="btns">
        <button id="play-btn-${rec.id}" onclick="togglePlayRecord(${rec.id})">▶</button>
        <button onclick="downloadRecord(${rec.id})">⬇</button>
        <button onclick="delRecord(${rec.id})">🗑</button>
      </div>
    `;
    list.appendChild(div);
  });
}

// ========== 录音 ==========
async function toggleRecord() {
  if (isRecording) {
    stopRecord();
    return;
  }

  try {
    // 回声消除：只录人声，去掉扬声器播的原声（解决断断续续）
    const constraints = {
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 }
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    // Opus 编码，音质更好
    let mimeType = '';
    for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
    }
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
      : new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

    // 麦克风被系统掐断（如息屏/后台）时，立即保存已录部分，别全丢
    mediaRecorder.onerror = () => {
      if (isRecording) stopRecord();
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const duration = (Date.now() - recordStartTime) / 1000;

      const records = await getRecordsByLesson(currentLesson.id);
      const record = {
        lessonId: currentLesson.id,
        attempt: records.length + 1,
        blob: blob,
        duration: duration,
        time: Date.now()
      };

      await addRecord(record);
      stream.getTracks().forEach(t => t.stop());

      alert(`第${record.attempt}次练习已保存！`);
      await renderPractice();
      // 录音结束，恢复歌词显示
      await renderLyrics();
    };

    // 开始录音
    mediaRecorder.start();
    isRecording = true;
    recordStartTime = Date.now();

    // 录音期间保持屏幕常亮（防止约1分钟息屏把录音掐断）
    const nat = getNativeUtils();
    if (nat) { try { Promise.resolve(nat.keepAwake()).catch(() => {}); } catch (e) {} }

    // 播放原声
    const audio = document.getElementById('audio');
    audio.currentTime = 0;
    // 播放结束2秒后自动停止录音（随时可手动按停止）
    audio.onended = () => {
      if (isRecording) {
        recordAutoStopTimer = setTimeout(() => {
          if (isRecording) stopRecord();
        }, 2000);
      }
    };
    audio.play();

    // 录音时隐藏歌词（核心需求）
    await renderLyrics();

    // UI
    const btn = document.getElementById('btn-record');
    btn.textContent = '■ 停止录音';
    btn.classList.add('recording');

    const timeEl = document.getElementById('record-time');
    timeEl.style.display = 'block';
    recordTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recordStartTime) / 1000);
      timeEl.textContent = formatTime(sec);
    }, 1000);

  } catch (e) {
    alert('录音失败: ' + e.message);
  }
}

function stopRecord() {
  if (mediaRecorder && isRecording) {
    try { mediaRecorder.stop(); } catch (e) { /* 已自动停止，忽略 */ }
    isRecording = false;
    const nat = getNativeUtils();
    if (nat) { try { Promise.resolve(nat.allowSleep()).catch(() => {}); } catch (e) {} }
    clearInterval(recordTimer);
    if (recordAutoStopTimer) { clearTimeout(recordAutoStopTimer); recordAutoStopTimer = null; }

    document.getElementById('btn-record').textContent = '● 开始录音';
    document.getElementById('btn-record').classList.remove('recording');
    document.getElementById('record-time').style.display = 'none';
    document.getElementById('audio').pause();
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ========== 原生保存通道（存到手机 Download/影子100/） ==========
function getNativeUtils() {
  try {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeUtils) || null;
  } catch (e) { return null; }
}

function blobToBase64(blob) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => {
      const u8 = new Uint8Array(r.result);
      let s = '';
      const STEP = 0x8000; // 每次转 32KB，避免栈溢出
      for (let i = 0; i < u8.length; i += STEP) {
        s += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
      }
      ok(btoa(s));
    };
    r.onerror = no;
    r.readAsArrayBuffer(blob);
  });
}

// 保存 blob：有原生插件→写进 Download/影子100/，返回完整路径；
// 没有（浏览器打开）→回退老下载方式，返回 null
async function nativeSaveBlob(blob, filename, mimeType) {
  const nat = getNativeUtils();
  if (!nat) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    return null;
  }
  await nat.saveBegin({ filename, mimeType: mimeType || blob.type || 'application/octet-stream' });
  const CHUNK = 512 * 1024; // 512KB 一块
  for (let off = 0; off < blob.size; off += CHUNK) {
    const b64 = await blobToBase64(blob.slice(off, off + CHUNK));
    await nat.saveChunk({ base64: b64 });
  }
  const done = await nat.saveEnd();
  return done && done.path;
}

// ========== 录音操作（单实例播放器） ==========
let playAudio = null;      // 当前播放的 Audio 对象
let playingId = null;      // 正在播放的记录 id

function resetPlayUI() {
  // 所有按钮复位 ▶，所有行去掉高亮
  document.querySelectorAll('.record-item').forEach(el => el.classList.remove('playing'));
  document.querySelectorAll('[id^="play-btn-"]').forEach(el => { el.textContent = '▶'; el.classList.remove('playing'); });
  playingId = null;
}

function stopPlayback() {
  if (playAudio) {
    playAudio.pause();
    playAudio.currentTime = 0;
    playAudio = null;
  }
  resetPlayUI();
}

async function togglePlayRecord(id) {
  // 正在播放的就是它 -> 停止
  if (playingId === id) {
    stopPlayback();
    return;
  }

  // 换曲目：先停掉前一个（自动暂停）
  stopPlayback();

  const records = await getRecordsByLesson(currentLesson.id);
  const rec = records.find(r => r.id === id);
  if (!rec || !rec.blob) return;

  const url = URL.createObjectURL(rec.blob);
  playAudio = new Audio(url);
  playingId = id;

  // 高亮当前行 + 按钮变 ⏸
  const row = document.getElementById(`rec-${id}`);
  const btn = document.getElementById(`play-btn-${id}`);
  if (row) row.classList.add('playing');
  if (btn) { btn.textContent = '⏸'; btn.classList.add('playing'); }

  playAudio.onended = stopPlayback;
  playAudio.onerror = stopPlayback;
  playAudio.play();
}

async function downloadRecord(id) {
  const records = await getRecordsByLesson(currentLesson.id);
  const rec = records.find(r => r.id === id);
  if (rec && rec.blob) {
    try {
      const fname = `${currentLesson.title || '练习'}-第${rec.attempt}次.webm`;
      const path = await nativeSaveBlob(rec.blob, fname, 'audio/webm');
      if (path) alert(`已保存到：${path}`);
    } catch (e) {
      alert('保存失败: ' + (e && e.message ? e.message : e));
    }
  }
}

async function delRecord(id) {
  if (!confirm('确定删除？')) return;
  await deleteRecord(id);
  await renderPractice();
}

// ========== 导入（累加式批量队列） ==========
let audioQueue = [];   // [{name, file}]

function setupImport() {
  const audioInput = document.getElementById('audio-input');

  // 只认音频文件
  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|opus|flac|amr|webm|mp4)$/i;

  const addFiles = files => {
    let audioAdded = 0, skipped = 0;
    for (const f of files) {
      if (AUDIO_EXT.test(f.name) || (f.type && f.type.startsWith('audio/'))) {
        if (!audioQueue.some(q => q.name === f.name && q.file.size === f.size)) {
          audioQueue.push({ name: f.name, file: f });
          audioAdded++;
        }
      } else {
        skipped++;
      }
    }
    if (skipped) alert(`已跳过 ${skipped} 个不支持的文件（只支持音频）`);
    renderQueue();
  };

  audioInput.onchange = () => { addFiles(audioInput.files); audioInput.value = ''; };
  setupBackup();
}

function removeQueueItem(type, name) {
  audioQueue = audioQueue.filter(q => q.name !== name);
  renderQueue();
}

function clearQueue() {
  audioQueue = [];
  renderQueue();
}

function renderQueue() {
  const queue = document.getElementById('import-queue');
  const clearBtn = document.getElementById('btn-clear-queue');
  const importBtn = document.getElementById('btn-import');

  let html = '';
  if (audioQueue.length) {
    html += `<div class="queue-title">🎵 音频清单（${audioQueue.length}）</div>`;
    audioQueue.forEach(q => {
      const size = q.file ? (q.file.size / 1024 / 1024).toFixed(1) + 'M' : ((q.size || 0) / 1024 / 1024).toFixed(1) + 'M';
      html += `<div class="queue-item">
        <span class="q-name">${q.name}</span>
        <span class="q-size">${size}</span>
        <button class="q-del" onclick="removeQueueItem('audio', '${q.name.replace(/'/g, "\\'")}')">✕</button>
      </div>`;
    });
  }

  queue.innerHTML = html;
  clearBtn.style.display = audioQueue.length ? 'block' : 'none';
  importBtn.disabled = audioQueue.length === 0;
  importBtn.textContent = audioQueue.length ? `确认导入（${audioQueue.length} 个音频）` : '确认导入';
}

function renderCategoryOptions() {
  const select = document.getElementById('import-category');
  getAllCategories().then(cats => {
    cats.sort((a, b) => a.time - b.time);
    select.innerHTML =
      `<option value="__new__">➕ 新建分类…</option>` +
      cats.map(c => `<option value="${c.id}" ${c.name === DEFAULT_CATEGORY ? 'selected' : ''}>${c.name}</option>`).join('');
    // 默认选中「新建分类」时显示输入框
    toggleNewCategoryBox();
  });
  select.onchange = toggleNewCategoryBox;
}

function toggleNewCategoryBox() {
  const select = document.getElementById('import-category');
  const box = document.getElementById('new-category-box');
  if (select.value === '__new__') {
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

// 文件名去扩展名
function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

async function doImport() {
  if (audioQueue.length === 0) return;

  // 确定分类
  const select = document.getElementById('import-category');
  let catId;
  if (select.value === '__new__') {
    const name = document.getElementById('new-category').value.trim();
    if (!name) { alert('请输入新分类名称'); return; }
    const cat = await ensureCategory(name);
    catId = cat.id;
  } else {
    catId = parseInt(select.value);
  }

  // 导入中状态
  const btn = document.getElementById('btn-import');
  btn.disabled = true;
  btn.textContent = '导入中…';

  let count = 0;
  for (const aq of audioQueue) {
    // 课号：从文件名第一个数字串提取；没有则递增
    const match = aq.name.match(/(\d+)/);
    const lessonNum = match ? parseInt(match[1]) : count + 1;

    await addLesson({
      categoryId: catId,
      book: 1,
      lesson: lessonNum,
      title: baseName(aq.name),
      subtitle: '',
      lyrics: null,
      audioBlob: aq.file || null,
      audioUri: aq.uri || null,
      time: Date.now()
    });
    count++;
  }

  alert(`已导入 ${count} 个课程`);

  // 清空队列并返回
  clearQueue();
  document.getElementById('new-category').value = '';
  goHome();
}

// 音频播放时同步歌词
document.addEventListener('DOMContentLoaded', () => {
  const audio = document.getElementById('audio');
  if (audio) audio.addEventListener('timeupdate', syncLyrics);
});


// ========== 备份 / 换机迁移 ==========
function setupBackup() {
  const input = document.getElementById('backup-input');
  if (!input) return;
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (!confirm('导入备份会覆盖现有全部数据（分类、课程、录音），确定继续？')) return;
    try {
      const zip = await JSZip.loadAsync(file);
      const dataFile = zip.file('backup.json');
      if (!dataFile) { alert('这不是有效的备份文件（缺少 backup.json）'); return; }
      const data = JSON.parse(await dataFile.async('string'));

      await clearAll();
      for (const cat of data.categories || []) await putCategory(cat);
      for (const lesson of data.lessons || []) await putLesson(lesson);
      // 录音文件在 records/ 目录下，按文件名回填 blob
      const recObjs = [];
      for (const rec of data.records || []) {
        if (rec.blobFile) {
          const f = zip.file('records/' + rec.blobFile);
          if (f) rec.blob = await f.async('blob');
        }
        delete rec.blobFile;
        recObjs.push(rec);
      }
      for (const rec of recObjs) await putRecord(rec);

      alert(`导入完成：${data.categories.length} 个分类、${data.lessons.length} 个课程、${recObjs.length} 条录音`);
      goHome();
    } catch (e) {
      alert('导入失败: ' + e.message);
    }
  };
}

async function exportBackup() {
  if (!confirm('把全部分类、课程和录音打包成一个 zip 文件？\n（录音多的话需要一点时间）')) return;
  try {
    const { categories, lessons, records } = await getStats();
    if (!lessons.length && !records.length) { alert('还没有任何数据可备份'); return; }

    const zip = new JSZip();
    const data = { version: 1, exportTime: Date.now(), categories, lessons, records: [] };

    let n = 0;
    for (const rec of records) {
      const item = { ...rec };
      if (item.blob instanceof Blob) {
        const ext = (item.blob.type.split('/')[1] || 'webm').split(';')[0];
        const fname = `rec_${item.id}.${ext}`;
        zip.file('records/' + fname, item.blob);
        item.blobFile = fname;
        delete item.blob;  // blob不能JSON序列化
        n++;
      }
      data.records.push(item);
    }
    zip.file('backup.json', JSON.stringify(data));

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const d = new Date();
    const pad = x => String(x).padStart(2, '0');
    const fname = `影子100备份_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.zip`;
    const path = await nativeSaveBlob(blob, fname, 'application/zip');
    alert(`备份完成：${categories.length} 个分类、${lessons.length} 个课程、${n} 条录音` + (path ? `\n已保存到：${path}` : ''));
  } catch (e) {
    alert('备份失败: ' + e.message);
  }
}

function importBackup() {
  document.getElementById('backup-input').click();
}

// 启动
init();