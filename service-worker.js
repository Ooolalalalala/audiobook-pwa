const CACHE_NAME = 'audiobooks-pwa-v1';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Перехватываем запросы к Диску, содержащие наш токен
  if (url.origin === 'https://www.googleapis.com' && url.searchParams.has('token')) {
    event.respondWith(handleMedia(event.request, url));
  } else {
    event.respondWith(fetch(event.request));
  }
});

async function handleMedia(request, url) {
  const token = url.searchParams.get('token');
  url.searchParams.delete('token'); // Убираем токен из строки URL

  const headers = new Headers(request.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const cleanRequest = new Request(url.href, {
    method: request.method,
    headers: headers,
    mode: 'cors'
  });

  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url.pathname + '?alt=media');
  if (cached) return handleRange(request, cached);

  return fetch(cleanRequest);
}

async function handleRange(request, cachedResponse) {
  const range = request.headers.get('Range');
  if (!range) return cachedResponse;
  const blob = await cachedResponse.blob();
  const bytes = range.replace(/bytes=/, '').split('-');
  const start = parseInt(bytes[0], 10);
  const end = bytes[1] ? parseInt(bytes[1], 10) : blob.size - 1;
  const sliced = blob.slice(start, end + 1);
  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': sliced.size,
      'Accept-Ranges': 'bytes'
    }
  });
}
