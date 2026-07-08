const CACHE_NAME = 'audiobooks-pwa-v1';
const GOOGLE_DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files/';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ИЗОЛИРОВАННЫЙ ПЕРЕХВАТ ЗАПРОСОВ
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Обрабатываем ТОЛЬКО запросы к аудиофайлам Google Drive
  if (url.origin === 'https://www.googleapis.com' && url.pathname.startsWith('/drive/v3/files') && url.searchParams.get('alt') === 'media') {
    event.respondWith(handleAudioRequest(event.request));
  } else {
    // Все остальные запросы (библиотека, стили, скрипты GAS) пропускаем без вмешательства SW
    event.respondWith(fetch(event.request));
  }
});

async function handleAudioRequest(request) {
  const url = new URL(request.url);
  const fileId = url.pathname.split('/').pop();
  const token = url.searchParams.get('bearer_token');

  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(GOOGLE_DRIVE_API_URL + fileId + '?alt=media');

  // Если файл в офлайн-кэше — отдаем локально
  if (cachedResponse) {
    return handleRangeRequest(request, cachedResponse);
  }

  // Если файла нет — стримим из сети с авторизацией
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
      return new Response('', { status: 416, headers: response.headers });
    }
    return response;
  } catch (error) {
    return new Response('Network error', { status: 408 });
  }
}

// Эмуляция Range для локального кэша
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
