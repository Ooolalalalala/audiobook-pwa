const CACHE_NAME = 'audiobooks-pwa-v1';
const GOOGLE_DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files/';

// При установке воркера сразу активируем его
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Перехват всех сетевых запросов приложения
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Проверяем, идет ли запрос к медиафайлам Google Drive
  if (url.href.startsWith(GOOGLE_DRIVE_API_URL) && url.searchParams.get('alt') === 'media') {
    event.respondWith(handleAudioRequest(event.request));
  } else {
    // Для всех остальных системных файлов (html, css, js) используем обычную сеть
    event.respondWith(fetch(event.request));
  }
});

async function handleAudioRequest(request) {
  const url = new URL(request.url);
  const fileId = url.pathname.split('/').pop();
  
  // Извлекаем токен из параметров запроса, который передал app.js
  const token = url.searchParams.get('bearer_token');

  // 1. ПРОВЕРКА ЛОКАЛЬНОГО ОФЛАЙН-КЭША
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(GOOGLE_DRIVE_API_URL + fileId + '?alt=media');

  if (cachedResponse) {
    // Если файл полностью скачан для офлайна, отдаем его локально с поддержкой Range (перемотки)
    return handleRangeRequest(request, cachedResponse);
  }

  // 2. ОНЛАЙН СТРИМИНГ С АВТО-АВТОРИЗАЦИЕЙ
  // Создаем чистый запрос к API Google Drive без лишних параметров в URL
  const cleanUrl = `${GOOGLE_DRIVE_API_URL}${fileId}?alt=media`;
  const headers = new Headers(request.headers);
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const modifiedRequest = new Request(cleanUrl, {
    method: request.method,
    headers: headers,
    credentials: 'omit',
    mode: 'cors'
  });

  try {
    const response = await fetch(modifiedRequest);
    if (!response.ok && response.status === 416) {
      // Защита от сбоя диапазонов
      return new Response('', { status: 416, headers: response.headers });
    }
    return response;
  } catch (error) {
    return new Response('Network error', { status: 408 });
  }
}

// Эмуляция Range-запросов для файлов, которые воспроизводятся из локального офлайн-кэша
async function handleRangeRequest(request, cachedResponse) {
  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) return cachedResponse;

  const blob = await cachedResponse.blob();
  const bytes = rangeHeader.replace(/bytes=/, '').split('-');
  const start = parseInt(bytes[0], 10);
  const end = bytes[1] ? parseInt(bytes[1], 10) : blob.size - 1;

  const slicedBlob = blob.slice(start, end + 1);
  
  return new Response(slicedBlob, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cachedResponse.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': slicedBlob.size,
      'Accept-Ranges': 'bytes'
    }
  });
}
