const CACHE_NAME = 'smart-parking-v2';
const DYNAMIC_CACHE = 'smart-parking-dynamic-v2';

// Assets to cache on install — use relative paths for GitHub Pages subdirectory hosting
const STATIC_ASSETS = [
    './index.html',
    './app.js',
    './manifest.json',
    './offline.html',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css',
    'https://code.jquery.com/jquery-4.0.0-beta.min.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

// Install Service Worker
self.addEventListener('install', event => {
    console.log('[SW] Installing...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static assets');
                // Cache each asset individually so one failure doesn't break everything
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
                    )
                );
            })
            .then(() => {
                console.log('[SW] Skip waiting');
                return self.skipWaiting();
            })
    );
});

// Activate Service Worker
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cache => {
                        if (cache !== CACHE_NAME && cache !== DYNAMIC_CACHE) {
                            console.log('[SW] Deleting old cache:', cache);
                            return caches.delete(cache);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[SW] Claiming clients');
                return self.clients.claim();
            })
    );
});

// Fetch Strategy: Cache First, then Network
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip chrome-extension requests
    if (event.request.url.startsWith('chrome-extension://')) return;

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // Return cached response
                    return cachedResponse;
                }

                // If it's an API request, return mock data for the demo
                if (event.request.url.includes('/api/')) {
                    console.log('[SW] Mocking API request:', event.request.url);
                    return handleMockApi(event.request);
                }

                // Not in cache, fetch from network
                return fetch(event.request)
                    .then(response => {
                        // Check if we received a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response
                        const responseToCache = response.clone();

                        // Cache the response for offline use
                        caches.open(DYNAMIC_CACHE)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(error => {
                        // Network failed, return offline fallback if it's a navigation request
                        if (event.request.mode === 'navigate') {
                            return caches.match('/offline.html');
                        }

                        // For API calls, return a JSON offline response
                        if (event.request.url.includes('/api/')) {
                            return new Response(
                                JSON.stringify({
                                    error: 'You are offline',
                                    offline: true,
                                    mock: true,
                                    timestamp: new Date().toISOString()
                                }),
                                {
                                    headers: { 'Content-Type': 'application/json' }
                                }
                            );
                        }

                        throw error;
                    });
            })

    );
});

// Background Sync
self.addEventListener('sync', event => {
    console.log('[SW] Background Sync:', event.tag);

    if (event.tag === 'sync-parking-data') {
        event.waitUntil(syncParkingData());
    }

    if (event.tag === 'sync-violations') {
        event.waitUntil(syncViolations());
    }
});

// Push Notifications
self.addEventListener('push', event => {
    console.log('[SW] Push received:', event);

    let data = {
        title: 'Parking Alert',
        body: 'New notification from Smart Parking Sensor System System',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        vibrate: [200, 100, 200],
        tag: 'parking-alert',
        renotify: true,
        data: {
            url: '/'
        }
    };

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() };
        } catch (e) {
            console.error('Failed to parse push data:', e);
        }
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon,
            badge: data.badge,
            vibrate: data.vibrate,
            tag: data.tag,
            renotify: data.renotify,
            data: data.data,
            actions: [
                {
                    action: 'view',
                    title: 'View Details'
                },
                {
                    action: 'dismiss',
                    title: 'Dismiss'
                }
            ]
        })
    );
});

// Notification Click Handler
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        const urlToOpen = event.notification.data?.url || '/';

        event.waitUntil(
            clients.matchAll({
                type: 'window',
                includeUncontrolled: true
            })
                .then(windowClients => {
                    // Check if there is already a window/tab open with the target URL
                    for (let client of windowClients) {
                        if (client.url === urlToOpen && 'focus' in client) {
                            return client.focus();
                        }
                    }
                    // If not, open a new window/tab
                    if (clients.openWindow) {
                        return clients.openWindow(urlToOpen);
                    }
                })
        );
    }
});

// Periodic Background Sync (if supported)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-parking-status') {
        event.waitUntil(checkParkingStatus());
    }
});

// Mock API Handler for demo purposes
function handleMockApi(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    let responseData = { success: true, mock: true, timestamp: new Date().toISOString() };

    if (path.includes('/api/parking/status')) {
        responseData = {
            ...responseData,
            status: 'online',
            totalBays: 8,
            violations: []
        };
    } else if (path.includes('/api/parking/sync')) {
        responseData = {
            ...responseData,
            message: 'Data successfully synced with mock server'
        };
    }

    return new Response(JSON.stringify(responseData), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
    });
}


// Helper function to sync parking data
async function syncParkingData() {
    console.log('[SW] Syncing parking data...');

    try {
        const cache = await caches.open(DYNAMIC_CACHE);
        const requests = await cache.keys();

        for (let request of requests) {
            if (request.url.includes('/api/parking/offline')) {
                const response = await cache.match(request);
                const data = await response.json();

                // Send to server when online
                await fetch('/api/parking/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                // Remove from cache after successful sync
                await cache.delete(request);
            }
        }

        console.log('[SW] Parking data synced successfully');
    } catch (error) {
        console.error('[SW] Failed to sync parking data:', error);
        throw error;
    }
}

// Helper function to sync violations
async function syncViolations() {
    console.log('[SW] Syncing violations...');
    // Implementation similar to syncParkingData
}

// Helper function to check parking status in background
async function checkParkingStatus() {
    console.log('[SW] Checking parking status...');

    try {
        const response = await fetch('/api/parking/status');
        const data = await response.json();

        // Check for violations
        const violations = data.violations || [];

        if (violations.length > 0) {
            // Show notification for violations
            await self.registration.showNotification('Parking Violation Alert', {
                body: `${violations.length} vehicle(s) have exceeded parking time`,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/badge-72x72.png',
                vibrate: [200, 100, 200],
                tag: 'parking-violation',
                data: {
                    url: '/?view=violations'
                }
            });
        }

        // Cache the status for offline use
        const cache = await caches.open(DYNAMIC_CACHE);
        await cache.put('/api/parking/status', new Response(JSON.stringify(data)));

    } catch (error) {
        console.error('[SW] Failed to check parking status:', error);
    }
}

// Message handler for communication with the page
self.addEventListener('message', event => {
    console.log('[SW] Message received:', event.data);

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CACHE_URL') {
        event.waitUntil(
            caches.open(DYNAMIC_CACHE)
                .then(cache => cache.add(event.data.url))
        );
    }
});