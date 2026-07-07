const API_URL = "ВСТАВЬ_ССЫЛКУ_APPS_SCRIPT_WEB_APP";

let books = [];
let progress = {};
let currentBook = null;
let currentChapterIndex = 0;
let saveTimer = null;

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

init();

async function init() {
  loadLocalProgress();
  await refresh();
  startAutoSave();
}

async function refresh() {
  const booksData = await api("books");
  const progressData = await api("progress");

  if (booksData.ok) books = booksData.books;
  if (progressData.ok) progress = mergeProgress(progress, progressData.progress);

  renderBooks();
}

function renderBooks() {
  booksBox.innerHTML = "";

  books.forEach(book => {
    const div = document.createElement("div");
    div.className = "book";

    div.innerHTML = `
      ${book.cover ? `<img src="${book.cover}" alt="">` : `<div class="noCover">Нет обложки</div>`}
      <div>
        <h2>${escapeHtml(book.title)}</h2>
        <p>${book.chapters.length} файлов</p>
      </div>
    `;

    div.onclick = () => openBook(book.id);
    booksBox.appendChild(div);
  });
}

function openBook(bookId) {
  currentBook = books.find(b => b.id === bookId);
  if (!currentBook) return;

  const saved = progress[currentBook.id];

  currentChapterIndex = 0;

  if (saved) {
    const idx = currentBook.chapters.findIndex(c => c.id === saved.chapterId);
    if (idx >= 0) currentChapterIndex = idx;
  }

  playerBox.classList.remove("hidden");
  cover.src = currentBook.cover || "";
  cover.style.display = currentBook.cover ? "block" : "none";
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

function loadChapter(index, restorePosition) {
  if (!currentBook || !currentBook.chapters[index]) return;

  currentChapterIndex = index;
  const chapter = currentBook.chapters[index];

  audio.src = chapter.url;
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
  await api("saveProgress", { data: JSON.stringify(progress) });
}

function startAutoSave() {
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(saveCurrentProgress, 30000);
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

function downloadCurrentFile() {
  if (!currentBook) return;
  const chapter = currentBook.chapters[currentChapterIndex];
  downloadLink(chapter.downloadUrl, chapter.name);
}

function downloadCurrentBook() {
  if (!currentBook) return;

  currentBook.chapters.forEach((chapter, i) => {
    setTimeout(() => {
      downloadLink(chapter.downloadUrl, chapter.name);
    }, i * 700);
  });
}

function downloadLink(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = "cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);

    const url = new URL(API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);

    Object.keys(params).forEach(key => {
      url.searchParams.set(key, params[key]);
    });

    window[callbackName] = data => {
      delete window[callbackName];
      script.remove();
      resolve(data);
    };

    const script = document.createElement("script");
    script.src = url.toString();
    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error("API error"));
    };

    document.body.appendChild(script);
  });
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
