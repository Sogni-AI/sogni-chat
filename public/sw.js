// Service Worker for Sogni Chat
// Simple service worker for PWA installation support

const CACHE_VERSION = 'sogni-chat-v1';

// Install event - activate immediately
self.addEventListener('install', (event) => {
  console.log('Sogni Chat Service Worker: Installing...');
  self.skipWaiting();
});

// Activate event - claim clients immediately
self.addEventListener('activate', (event) => {
  console.log('Sogni Chat Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('sogni-chat-') && cacheName !== CACHE_VERSION)
          .map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch event - network first, no offline caching for now
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
