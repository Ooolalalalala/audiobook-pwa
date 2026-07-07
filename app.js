const API_URL = "https://script.google.com/macros/s/AKfycby6Ux7wMKr1oLZPaRyh0ou7rEdAY8Jwre56XJeL1omrj1KKJtXpeBsbm7h6LBOoELPKiA/exec";

let books = [];
let progress = {};
let currentBook = null;
let currentChapterIndex = 0;
let saveTimer = null;
let db = null;

const booksBox = document.getElementById("books");
const chaptersBox = document.getElementById("chapters");
const playerBox = document.getElementById("playerBox");
const audio = document.getElementById("audio");

const cover = document.getElementById("cover");
const bookTitle = document.getElementById("bookTitle");
const chapterTitle = document.getElementById("chapterTitle");

document.getElementById("refreshBtn").onclick = refresh;
document.getElementById("prevBtn").onclick = prevChapter;
document.getElementById("nextBtn").onclick = nextChapter;
document.getElementById("backBtn").onclick = () => audio.currentTime = Math.max(0, audio.currentTime - 20);
document.getElementById("forwardBtn").onclick = () => audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 20);

document.getElementById("speed").onchange = e => {
  audio.playbackRate = Number(e.target.value);
  saveCurrentProgress();
};

document.getElementById("downloadFileBtn").onclick = downloadCurrentFile;
document.getElementById("downloadBookBtn").onclick = downloadCurrentBook;

audio.addEventListener("timeupdate", () => {
  saveLocalProgress();
});

audio.addEventListener("ended", () => {
  nextChapter();
});

window.addEventListener("online", () => {
  saveCurrentProgress();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}

// Инициализация базы данных IndexedDB для офлайн-хранения
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("AudiobooksOfflineDB", 1);
    request.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains("files")) {
        database.createObjectStore("files", { keyPath: "id" });
      }
    };
    request.onsuccess = e => {
      db = e.target.result;
      resolve();
    };
    request.onerror = e => reject(e.target.error);
  });
}

// Сохранение Blob файла в IndexedDB
function saveFileToStorage(id, blob) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    store.put({ id: id, blob: blob });
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

// Получение Blob файла из IndexedDB
function getFileFromStorage(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result ? request.result.blob : null);
    request.onerror = e => reject(e.target.error);
  });
}

async function init() {
  await initDB();
  loadLocalProgress();
  await refresh();
  startAutoSave();
}

init();

async function refresh() {
  try {
    const booksData = await api("books");
    if (booksData && booksData.ok) {
      books = booksData.books;
      localStorage.setItem("audiobook_cache_books", JSON.stringify(books));
    }
  } catch (e) {
    console.log("Офлайн-режим: загрузка книг из локального кэша");
    books = JSON.parse(localStorage.getItem("audiobook_cache_books") || "[]");
  }

  try {
    const progressData = await api("progress");
    if (progressData && progressData.ok) {
      progress = mergeProgress(progress, progressData.progress);
    }
  } catch (e) {
    console.log("Офлайн-режим: синхронизация прогресса отложена");
  }

  renderBooks();
}

function renderBooks() {
  booksBox.innerHTML = "";
  books.forEach(book => {
    const div = document.createElement("div");
    div.className = "book";
    div.innerHTML = `
      ${book.cover ? `<img src="${book.cover}" alt="" data-id="${book.id}">` : `<div class="noCover">Нет обложки</div>`}
      <div>
        <h2>${escapeHtml(book.title)}</h2>
        <p>${book.chapters.length} файлов</p>
      </div>
    `;
    div.onclick = () => openBook(book.id);
    booksBox.appendChild(div);

    // Ленивая загрузка обложек через Blob (защита от CORS)
    if (book.cover) {
      loadCoverImage(book.id, book.cover);
    }
  });
}

async function loadCoverImage(bookId, coverUrl) {
  try {
    let blob = await getFileFromStorage(bookId);
    if (!blob) {
      const res = await fetch(coverUrl);
      blob = await res.blob();
      await saveFileToStorage(bookId, blob);
    }
    const imgEl = document.querySelector(`img[data-id="${bookId}"]`);
    if (imgEl) imgEl.src = URL.createObjectURL(blob);
  } catch (e) {
    console.error("Ошибка загрузки обложки", e);
  }
}

function openBook(bookId) {
  currentBook = books.find(b => b.id === bookId);
  if (!currentBook) return;

  const saved = progress[currentBook.id];
  currentChapterIndex = 0;

  if (saved) {
    const idx = currentBook.chapters.findIndex(c => c.id === saved.chapterId);
    if (idx >= 0) currentChapterIndex = idx;
    if (saved.speed) {
      document.getElementById("speed").value = saved.speed;
    }
  }

  playerBox.classList.remove("hidden");
  
  // Ставим временную обложку, пока грузится сохраненная из базы
  getFileFromStorage(currentBook.id).then(blob => {
    if (blob) cover.src = URL.createObjectURL(blob);
  });

  bookTitle.textContent = currentBook.title;

  renderChapters();
  loadChapter(currentChapterIndex, true);
}

function renderChapters() {
  chaptersBox.innerHTML = "";
  currentBook.chapters.forEach((chapter, index) => {
    const btn = document.createElement("button");
    btn.textContent = chapter.name;
    btn.className = index === currentChapterIndex ? "active" : "";
    btn.onclick = () => loadChapter(index, true);
    chaptersBox.appendChild(btn);
  });
}

async function loadChapter(index, restorePosition) {
  if (!currentBook || !currentBook.chapters[index]) return;

  currentChapterIndex = index;
  const chapter = currentBook.chapters[index];
  chapterTitle.textContent = "Загрузка файла...";

  try {
    let blob = await getFileFromStorage(chapter.id);
    
    if (!blob) {
      const response = await fetch(chapter.url);
      blob = await response.blob();
    }

    audio.src = URL.createObjectURL(blob);
    chapterTitle.textContent = chapter.name;

    const speed = Number(document.getElementById("speed").value);
    audio.playbackRate = speed;

    audio.onloadedmetadata = () => {
      if (restorePosition) {
        const saved = progress[currentBook.id];
        if (saved && saved.chapterId === chapter.id && saved.time) {
          audio.currentTime = Math.min(saved.time, audio.duration || saved.time);
        }
      }
    };
  } catch (err) {
    chapterTitle.textContent = "Ошибка загрузки: " + chapter.name;
    console.error(err);
  }

  renderChapters();
}

function nextChapter() {
  if (!currentBook) return;
  if (currentChapterIndex < currentBook.chapters.length - 1) {
    loadChapter(currentChapterIndex + 1, true);
    audio.play();
  }
}

function prevChapter() {
  if (!currentBook) return;
  if (currentChapterIndex > 0) {
    loadChapter(currentChapterIndex - 1, true);
    audio.play();
  }
}

function saveLocalProgress() {
  if (!currentBook || !currentBook.chapters[currentChapterIndex]) return;

  const chapter = currentBook.chapters[currentChapterIndex];

  progress[currentBook.id] = {
    bookId: currentBook.id,
    bookTitle: currentBook.title,
    chapterId: chapter.id,
    chapterName: chapter.name,
    chapterIndex: currentChapterIndex,
    time: audio.currentTime || 0,
    duration: audio.duration || 0,
    speed: Number(document.getElementById("speed").value),
    updatedAt: Date.now()
  };

  localStorage.setItem("audiobook_progress", JSON.stringify(progress));
}

async function saveCurrentProgress() {
  saveLocalProgress();
  if (!navigator.onLine) return;
  try {
    await api("saveProgress", progress);
  } catch (e) {
    console.error("Не удалось синхронизировать прогресс с сервером", e);
  }
}

function startAutoSave() {
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(saveCurrentProgress, 20000);
}

function loadLocalProgress() {
  try {
    progress = JSON.parse(localStorage.getItem("audiobook_progress") || "{}");
  } catch {
    progress = {};
  }
}

function mergeProgress(local, remote) {
  const result = { ...remote };
  for (const key in local) {
    if (!result[key] || local[key].updatedAt > result[key].updatedAt) {
      result[key] = local[key];
    }
  }
  localStorage.setItem("audiobook_progress", JSON.stringify(result));
  return result;
}

async function downloadCurrentFile() {
  if (!currentBook) return;
  const chapter = currentBook.chapters[currentChapterIndex];
  const btn = document.getElementById("downloadFileBtn");
  
  btn.textContent = "Скачивание...";
  try {
    let blob = await getFileFromStorage(chapter.id);
    if (!blob) {
      const res = await fetch(chapter.url);
      blob = await res.blob();
      await saveFileToStorage(chapter.id, blob);
    }
    btn.textContent = "Готово (Офлайн)";
    setTimeout(() => btn.textContent = "Скачать файл", 2000);
  } catch (e) {
    btn.textContent = "Ошибка";
    setTimeout(() => btn.textContent = "Скачать файл", 2000);
  }
}

async function downloadCurrentBook() {
  if (!currentBook) return;
  const btn = document.getElementById("downloadBookBtn");
  const originalText = btn.textContent;

  for (let i = 0; i < currentBook.chapters.length; i++) {
    const chapter = currentBook.chapters[i];
    btn.textContent = `Скачано ${i}/${currentBook.chapters.length}`;
    try {
      let blob = await getFileFromStorage(chapter.id);
      if (!blob) {
        const res = await fetch(chapter.url);
        blob = await res.blob();
        await saveFileToStorage(chapter.id, blob);
      }
    } catch (e) {
      console.error("Ошибка при скачивании главы книги", e);
    }
  }
  btn.textContent = "Вся книга в офлайне!";
  setTimeout(() => btn.textContent = originalText, 3000);
}

// Универсальный метод fetch для GET и POST (Замена устаревшего JSONP)
async function api(action, bodyData = null) {
  const url = new URL(API_URL);
  
  if (bodyData) {
    // Если переданы данные — выполняем POST (для сохранения прогресса)
    const response = await fetch(url.toString(), {
      method: "POST",
      body: JSON.stringify(bodyData)
    });
    return await response.json();
  } else {
    // Если данных нет — выполняем GET (для книг и загрузки прогресса)
    url.searchParams.set("action", action);
    const response = await fetch(url.toString());
    return await response.json();
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[s]));
}
