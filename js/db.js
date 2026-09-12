/**
 * 影子练习 - 数据层 v3.3
 * 分类(categories) + 课程(lessons) + 录音(records)
 * 极简原生 IndexedDB：每个操作独立 openDB -> 事务 -> close
 */

const DB_NAME = 'shadow_db_v3';
const DB_VERSION = 2; // v2: 增加 categories 表

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      // lessons 表
      if (!db.objectStoreNames.contains('lessons')) {
        const s = db.createObjectStore('lessons', { keyPath: 'id', autoIncrement: true });
        s.createIndex('book_lesson', ['book', 'lesson'], { unique: false });
      } else {
        // v1 -> v2 迁移：放开 book_lesson 唯一约束（不同分类可有同册课号）
        try { tx.objectStore('lessons').deleteIndex('book_lesson'); } catch (err) {}
        tx.objectStore('lessons').createIndex('book_lesson', ['book', 'lesson'], { unique: false });
      }
      // records 表
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        s.createIndex('lessonId', 'lessonId', { unique: false });
      }
      // categories 表（v2 新增）
      if (!db.objectStoreNames.contains('categories')) {
        const s = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ========== 分类 ==========
async function addCategory(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const req = tx.objectStore('categories').add({ name: name, time: Date.now() });
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function getAllCategories() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readonly');
    const req = tx.objectStore('categories').getAll();
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function findCategoryByName(name) {
  const cats = await getAllCategories();
  return cats.find(c => c.name === name) || null;
}

async function ensureCategory(name) {
  const existing = await findCategoryByName(name);
  if (existing) return existing;
  const id = await addCategory(name);
  return { id: id, name: name, time: Date.now() };
}

// ========== 课程 ==========
async function addLesson(lesson) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lessons', 'readwrite');
    const req = tx.objectStore('lessons').add(lesson);
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function getLesson(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lessons', 'readonly');
    const req = tx.objectStore('lessons').get(id);
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function getAllLessons() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lessons', 'readonly');
    const req = tx.objectStore('lessons').getAll();
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function getLessonsByCategory(catId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lessons', 'readonly');
    const req = tx.objectStore('lessons').index('book_lesson'); // 复用：先getAll再过滤
    const all = req.getAll();
    all.onsuccess = () => {
      const list = all.result.filter(l => (l.categoryId || 1) === catId);
      resolve(list);
      db.close();
    };
    all.onerror = () => { reject(all.error); db.close(); };
  });
}

async function deleteLesson(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    // 同一事务里删课程 + 它的所有录音
    const tx = db.transaction(['lessons', 'records'], 'readwrite');
    tx.objectStore('lessons').delete(id);
    const idx = tx.objectStore('records').index('lessonId');
    const cursorReq = idx.openCursor(null);
    cursorReq.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.lessonId === id) cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}

async function deleteCategory(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const req = tx.objectStore('categories').delete(id);
    req.onsuccess = () => { resolve(); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

// ========== 录音 ==========
async function addRecord(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const req = tx.objectStore('records').add(record);
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function getRecordsByLesson(lessonId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const idx = tx.objectStore('records').index('lessonId');
    const req = idx.getAll(IDBKeyRange.only(lessonId));
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function deleteRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const req = tx.objectStore('records').delete(id);
    req.onsuccess = () => { resolve(); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

// 清空全部（导入备份前用）
async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['categories', 'lessons', 'records'], 'readwrite');
    tx.objectStore('categories').clear();
    tx.objectStore('lessons').clear();
    tx.objectStore('records').clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// 保存导入的分类（带原id）
async function putCategory(cat) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const req = tx.objectStore('categories').put(cat);
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

// 保存导入的课程（带原id）
async function putLesson(lesson) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lessons', 'readwrite');
    const req = tx.objectStore('lessons').put(lesson);
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

// 保存导入的录音（带原id）
async function putRecord(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const req = tx.objectStore('records').put(record);
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

// ========== 统计 ==========
async function getStats() {
  const categories = await getAllCategories();
  const lessons = await getAllLessons();
  const db = await openDB();
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const req = tx.objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();

  const countMap = {};
  records.forEach(r => {
    countMap[r.lessonId] = (countMap[r.lessonId] || 0) + 1;
  });

  return { categories, lessons, records, countMap };
}