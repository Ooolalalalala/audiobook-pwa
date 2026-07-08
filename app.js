// НАСТРОЙКИ: Подставьте сюда ваш актуальный URL Макроса (Web App) из Google Apps Script
const API_URL = "https://script.google.com/macros/s/AKfycby6Ux7wMKr1oLZPaRyh0ou7rEdAY8Jwre56XJeL1omrj1KKJtXpeBsbm7h6LBOoELPKiA/exec"; 

const CACHE_NAME = 'audiobooks-pwa-v1';
let currentTrackId = null;
let syncInterval = null;
let booksDataGlobal = [];
window.AUTH_TOKEN_DYNAMIC = ""; // Токен будет получен автоматически из бэкенда

// ЭЛЕМЕНТЫ ИНТЕРФЕЙСА
const audio = document.getElementById('main-audio');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnSkipBack = document.getElementById('btn-skip-back');
const btnSkipForward = document.getElementById('btn-skip-forward');
const progressBar = document.getElementById('player-progress');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const selectSpeed = document.getElementById('select-speed');
const searchInput = document.getElementById('search-input');
const syncStatus = document.getElementById('sync-status');
const libraryList = document.getElementById('library-list');

// ИНИЦИАЛИЗАЦИЯ И РЕГИСТРАЦИЯ СЕРВИС-ВОРКЕРА
window.addEventListener('load', async () => {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (e) { console.error('SW registration failed', e); }
  }
  initLibrary();
});

// ЗАГРУЗКА БИБЛИОТЕКИ КНИГ ИЗ БЭКЕНДА
async function initLibrary() {
  try {
    const res = await fetch(`${API_URL}?action=books`, { mode: 'cors' });
    const data = await res.json();
    document.getElementById('loading-overlay').style.display = 'none';
    
    if (!data.success) {
      libraryList.innerHTML = 'Ошибка загрузки данных.';
      return;
    }
    
    // Безопасно сохраняем токен авторизации, пришедший от Google скрипта
    if (data.token) {
      window.AUTH_TOKEN_DYNAMIC = data.token;
    }
    
    booksDataGlobal = data.books;
    renderLibrary(booksDataGlobal);
  } catch (e) {
    document.getElementById('loading-overlay').innerText = 'Ошибка сети/CORS: ' + e;
  }
}

// РЕНДЕРИНГ СПИСКА КНИГ
async function renderLibrary(books) {
  libraryList.innerHTML = '';
  const cache = await caches.open(CACHE_NAME);

  if (books.length === 0) {
    libraryList.innerHTML = 'Ничего не найдено.';
    return;
  }

  for (let book of books) {
    const card = document.createElement('div');
    card.className = 'book-card';
    
    let isBookLocal = true;
    for (let track of book.tracks) {
      const match = await cache.match(`https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`);
      if (!match) { isBookLocal = false; break; }
    }

    card.innerHTML = `
      <div class="book-header">
        <div class="book-cover-container" id="cov-${book.folderId}">📘</div>
        <div class="book-title-block">
          <h4>${book.folderName}</h4>
          <button class="btn-download-book ${isBookLocal ? 'downloaded' : ''}" data-folderid="${book.folderId}">
            ${isBookLocal ? '✓ Скачано' : '⬇ Скачать книгу'}
          </button>
        </div>
      </div>
      <div class="tracks-list">
        ${book.tracks.map(t => `
          <div class="track-item" data-trackid="${t.id}" data-foldername="${book.folderName}">
            <span class="track-name">${t.name}</span>
            <div class="track-meta">
              <span class="track-dur">${Math.floor(t.duration / 60)} мин</span>
              <span class="local-status-badge" id="badge-${t.id}"></span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    libraryList.appendChild(card);
    if (book.coverId) loadSecureCover(book.coverId, `cov-${book.folderId}`);

    for (let track of book.tracks) {
      const isTrackLocal = await cache.match(`https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`);
      if (isTrackLocal) document.getElementById(`badge-${track.id}`).innerHTML = '<span class="local-badge">офлайн</span>';
    }

    card.querySelector('.btn-download-book').addEventListener('click', function(e) {
      e.stopPropagation();
      downloadWholeBook(book, this);
    });
  }

  document.querySelectorAll('.track-item').forEach(item => {
    item.addEventListener('click', function() {
      const trackId = this.getAttribute('data-trackid');
      const bookTitle = this.getAttribute('data-foldername');
      const trackName = this.querySelector('.track-name').innerText;
      playTrack(trackId, bookTitle, trackName);
    });
  });
}

// СКАЧИВАНИЕ КНИГИ В ОФЛАЙН КЭШ С ИСПОЛЬЗОВАНИЕМ ДИНАМИЧЕСКОГО ТОКЕНА
async function downloadWholeBook(book, buttonElement) {
  if (buttonElement.classList.contains('downloaded')) return;
  buttonElement.innerText = 'Скачивание...';
  const cache = await caches.open(CACHE_NAME);

  try {
    for (let track of book.tracks) {
      const url = `https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`;
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${window.AUTH_TOKEN_DYNAMIC}` } });
      if (response.ok) {
        await cache.put(url, response.clone());
        const badge = document.getElementById(`badge-${track.id}`);
        if (badge) badge.innerHTML = '<span class="local-badge">офлайн</span>';
      }
    }
    buttonElement.innerText = '✓ Скачано';
    buttonElement.classList.add('downloaded');
  } catch (e) {
    buttonElement.innerText = 'Ошибка';
  }
}

// ЗАГРУЗКА ОБЛОЖКИ КНИГИ
async function loadSecureCover(fileId, elementId) {
  const container = document.getElementById(elementId);
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${window.AUTH_TOKEN_DYNAMIC}` }
    });
    const blob = await res.blob();
    container.innerHTML = `<img src="${URL.createObjectURL(blob)}" style="width:100%;height:100%;object-fit:cover;" />`;
  } catch (e) { container.innerText = '📕'; }
}

// БЕЗОПАСНЫЙ ЗАПУСК АУДИО БЕЗ ABORT_ERROR
async function safePlay() {
  try {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      await playPromise;
      btnPlayPause.innerText = '⏸';
    }
  } catch (error) {
    console.log("Play interrupted or stream loading skipped.");
  }
}

// ЗАПУСК ВОСПРОИЗВЕДЕНИЯ ТРЕКА С ПРОВЕРКОЙ ПОЗИЦИИ
async function playTrack(trackId, bookTitle, trackName) {
  currentTrackId = trackId;
  document.getElementById('current-title').innerText = bookTitle;
  document.getElementById('current-track-name').innerText = trackName;

  // Сброс и жесткая остановка старого воспроизведения во избежание AbortError
  audio.pause();
  audio.src = `https://www.googleapis.com/drive/v3/files/${trackId}?alt=media&bearer_token=${window.AUTH_TOKEN_DYNAMIC}`;
  audio.load();
  
  syncStatus.innerText = 'Синхронизация...';

  try {
    const res = await fetch(`${API_URL}?action=progress&bookId=${trackId}`, { mode: 'cors' });
    const data = await res.json();
    if (data.success && data.position > 0) {
      audio.currentTime = data.position;
    }
  } catch (e) {}

  await safePlay();
  startCloudSync();
}

// ОБРАБОТКА КЛИКА PLAY/PAUSE
btnPlayPause.addEventListener('click', async () => {
  if (audio.paused) {
    await safePlay();
  } else {
    audio.pause();
    btnPlayPause.innerText = '▶';
  }
});

// КНОПКИ ПЕРЕМОТКИ НА 10 СЕКУНД
btnSkipBack.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
btnSkipForward.addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });

// СКОРОСТЬ
selectSpeed.addEventListener('change', (e) => { audio.playbackRate = parseFloat(e.target.value); });

// ТАЙМЛАЙН
audio.addEventListener('timeupdate', () => {
  if (isNaN(audio.duration) || audio.duration === 0) return;
  const current = audio.currentTime;
  const total = audio.duration;
  
  progressBar.value = (current / total) * 100;
  timeCurrent.innerText = formatTime(current);
  timeTotal.innerText = formatTime(total);
});

progressBar.addEventListener('input', (e) => {
  if (isNaN(audio.duration)) return;
  audio.currentTime = (e.target.value / 100) * audio.duration;
});

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// СИНХРОНИЗАЦИЯ ПРОГРЕССА С СЕРВЕРОМ РАЗ В 30 СЕКУНД
function startCloudSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    if (!currentTrackId || audio.paused || !navigator.onLine) return;
    const pos = audio.currentTime;
    try {
      await fetch(`${API_URL}?action=progress&bookId=${currentTrackId}&position=${pos}`, { mode: 'cors' });
      syncStatus.innerText = 'Синхронизировано';
      setTimeout(() => { if(syncStatus.innerText === 'Синхронизировано') syncStatus.innerText = 'ОК'; }, 2000);
    } catch (e) { syncStatus.innerText = 'Офлайн режим'; }
  }, 30000);
}

// ФИЛЬТР ПОИСКА
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filteredBooks = booksDataGlobal.filter(book => book.folderName.toLowerCase().includes(query));
  renderLibrary(filteredBooks);
});
