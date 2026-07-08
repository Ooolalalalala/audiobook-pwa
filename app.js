// НАСТРОЙКИ: Сюда подставится ваш URL из Code.gs автоматически при генерации интерфейса
const API_URL = "https://script.google.com/macros/s/AKfycbwb8FuX_EmDmyQg_O9YqLp6hu2vDNhtBnQ4eP50zg8Qf7IaRQcQ1hCFD0PX15X0pUc2kg/exec"; // Скрипт сам подставит нужный URL
const AUTH_TOKEN = ""; // Токен инжектируется автоматически

const CACHE_NAME = 'audiobooks-pwa-v1';
let currentBookId = null;
let currentTrackId = null;
let syncInterval = null;
let booksDataGlobal = [];

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

// ИНИЦИАЛИЗАЦИЯ PWA И РЕГИСТРАЦИЯ СЕРВИС-ВОРКЕРА
window.addEventListener('load', async () => {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (e) { console.error('SW registration failed', e); }
  }
  initLibrary();
});

// ЗАГРУЗКА БИБЛИОТЕКИ КНИГ
async function initLibrary() {
  try {
    const res = await fetch(`${API_URL}?action=getBooks`);
    const data = await res.json();
    document.getElementById('loading-overlay').style.display = 'none';
    
    if (!data.success) {
      libraryList.innerHTML = 'Ошибка загрузки данных.';
      return;
    }
    
    booksDataGlobal = data.books;
    renderLibrary(booksDataGlobal);
  } catch (e) {
    document.getElementById('loading-overlay').innerText = 'Ошибка сети: ' + e;
  }
}

// РЕНДЕРИНГ КНИГ И ОПРЕДЕЛЕНИЕ ЛОКАЛЬНОГО СТАТУСА
async function renderLibrary(books) {
  libraryList.innerHTML = '';
  const cache = await caches.open(CACHE_NAME);

  for (let book of books) {
    const card = document.createElement('div');
    card.className = 'book-card';
    
    // Проверяем, скачана ли вся книга локально
    let isBookLocal = true;
    for (let track of book.tracks) {
      const match = await cache.match(`https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`);
      if (!match) { isBookLocal = false; break; }
    }

    card.innerHTML = `
      <div class="book-header">
        <div class="book-cover-container" id="cov-${book.folderId}">📋</div>
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

    // Обновляем плашки треков
    for (let track of book.tracks) {
      const isTrackLocal = await cache.match(`https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`);
      if (isTrackLocal) document.getElementById(`badge-${track.id}`).innerHTML = '<span class="local-badge">офлайн</span>';
    }

    // Кнопка скачивания книги
    card.querySelector('.btn-download-book').addEventListener('click', function(e) {
      e.stopPropagation();
      downloadWholeBook(book, this);
    });
  }

  // Навешивание событий на клик по треку
  document.querySelectorAll('.track-item').forEach(item => {
    item.addEventListener('click', function() {
      const trackId = this.getAttribute('data-trackid');
      const bookTitle = this.getAttribute('data-foldername');
      const trackName = this.querySelector('.track-name').innerText;
      playTrack(trackId, bookTitle, trackName);
    });
  });
}

// СКРИПТ СКАЧИВАНИЯ КНИГИ ДЛЯ ОФЛАЙНА
async function downloadWholeBook(book, buttonElement) {
  if (buttonElement.classList.contains('downloaded')) return;
  buttonElement.innerText = 'Скачивание...';
  const cache = await caches.open(CACHE_NAME);

  try {
    for (let track of book.tracks) {
      const url = `https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`;
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } });
      if (response.ok) {
        await cache.put(url, response.clone());
        const badge = document.getElementById(`badge-${track.id}`);
        if (badge) badge.innerHTML = '<span class="local-badge">офлайн</span>';
      }
    }
    buttonElement.innerText = '✓ Скачано';
    buttonElement.classList.add('downloaded');
  } catch (e) {
    buttonElement.innerText = 'Ошибка скачивания';
  }
}

// ЗАГРУЗКА И КЭШИРОВАНИЕ ОБЛОЖЕК
async function loadSecureCover(fileId, elementId) {
  const container = document.getElementById(elementId);
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
    });
    const blob = await res.blob();
    container.innerHTML = `<img src="${URL.createObjectURL(blob)}" />`;
  } catch (e) { container.innerText = '📕'; }
}

// ЗАПУСК ВОСПРОИЗВЕДЕНИЯ ТРЕКА
async function playTrack(trackId, bookTitle, trackName) {
  currentTrackId = trackId;
  document.getElementById('current-title').innerText = bookTitle;
  document.getElementById('current-track-name').innerText = trackName;

  // Сервис воркер сам подменит на офлайн-версию, если она есть в кэше
  audio.src = `https://www.googleapis.com/drive/v3/files/${trackId}?alt=media&bearer_token=${AUTH_TOKEN}`;
  
  syncStatus.innerText = 'Синхронизация...';
  audio.pause();

  try {
    // Получаем прошлый прогресс трека
    const res = await fetch(`${API_URL}?action=getProgress&bookId=${trackId}`);
    const data = await res.json();
    if (data.success && data.position > 0) {
      audio.currentTime = data.position;
    }
  } catch (e) {}

  audio.play();
  btnPlayPause.innerText = '⏸';
  startCloudSync();
}

// КНОПКИ УПРАВЛЕНИЯ ПЛЕЕРОМ
btnPlayPause.addEventListener('click', () => {
  if (audio.paused) {
    audio.play();
    btnPlayPause.innerText = '⏸';
  } else {
    audio.pause();
    btnPlayPause.innerText = '▶';
  }
});

btnSkipBack.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
btnSkipForward.addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });

// СКОРОСТЬ ВОСПРОИЗВЕДЕНИЯ
selectSpeed.addEventListener('change', (e) => { audio.playbackRate = parseFloat(e.target.value); });

// ОБНОВЛЕНИЕ ТАЙМЛАЙНА ПЛЕЕРА
audio.addEventListener('timeupdate', () => {
  if (isNaN(audio.duration)) return;
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

// ЖЕСТКАЯ ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ РАЗ В 30 СЕКУНД (ПРИ НАЛИЧИИ ИНТЕРНЕТА)
function startCloudSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    if (!currentTrackId || audio.paused || !navigator.onLine) return;
    const pos = audio.currentTime;
    try {
      await fetch(`${API_URL}?action=saveProgress&bookId=${currentTrackId}&position=${pos}`);
      syncStatus.innerText = 'Синхронизировано';
      setTimeout(() => { if(syncStatus.innerText === 'Синхронизировано') syncStatus.innerText = 'ОК'; }, 2000);
    } catch (e) { syncStatus.innerText = 'Офлайн режим'; }
  }, 30000);
}

// ИНТЕРАКТИВНЫЙ ПОИСК ПО НАЗВАНИЮ КНИГИ
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filteredBooks = booksDataGlobal.filter(book => book.folderName.toLowerCase().includes(query));
  renderLibrary(filteredBooks);
});
