// Service Worker for CaneMap Offline Support
// Caches essential pages for Worker and Driver

const CACHE_NAME = 'canemap-offline-v2';
const OFFLINE_PAGES = [
  '/frontend/Worker/Workers.html',
  '/frontend/Driver/Driver_Dashboard.html',
  '/backend/Worker/Workers.js',
  '/backend/Driver/Driver_Dashboard.js',
  '/backend/Driver/driver-ui.js',
  '/backend/Driver/driver-init.js',
  '/backend/Common/ui-popup.js',
  '/backend/Common/firebase-config.js'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching offline pages');
        return cache.addAll(OFFLINE_PAGES);
      })
      .then(() => {
        console.log('Service Worker: Installed successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated successfully');
        return self.clients.claim();
      })
  );
});

// Fetch event - ONLY cache Worker and Driver pages
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // ⚠️ CRITICAL: Exclude Handler pages completely
  if (url.pathname.includes('/Handler/') || 
      url.pathname.includes('handler') ||
      url.pathname.toLowerCase().includes('handler')) {
    // Don't intercept Handler requests at all
    return;
  }
  
  // Only cache GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Only handle Worker and Driver pages
  const isWorkerOrDriver = url.pathname.includes('/Worker/') || 
                           url.pathname.includes('/Driver/') ||
                           url.pathname.includes('/Common/');
  
  if (!isWorkerOrDriver) {
    // Don't cache other pages (lobby, handler, etc.)
    return;
  }
  
  // For Worker/Driver pages: use cache-first strategy when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Online: update cache and return response
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch((err) => {
                console.log('Cache put failed (expected for some requests):', err.message);
              });
            });
          }
          return response;
        })
        .catch(() => {
          // Offline: serve from cache
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                console.log('Service Worker: Serving from cache:', request.url);
                return cachedResponse;
              }
              return new Response('Offline - Page not available', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({ 'Content-Type': 'text/plain' })
              });
            });
        })
    );
  }
  // For resources (JS, CSS, etc.)
  else {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch(() => {
                // Silently fail - some requests can't be cached
              });
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((cachedResponse) => {
              return cachedResponse || new Response('Offline', { status: 503 });
            });
        })
    );
  }
});

// Message event
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
