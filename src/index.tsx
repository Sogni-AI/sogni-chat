import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Auto-reload when a lazy-loaded chunk fails (stale hash after deploy)
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  window.location.reload();
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
  const isLocalDev = location.hostname === 'localhost' ||
                     location.hostname === '127.0.0.1' ||
                     location.hostname.includes('local');

  if (!isLocalDev) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('[APP] Service Worker registered:', registration.scope);
        })
        .catch((error) => {
          console.warn('[APP] Service Worker registration failed:', error);
        });
    });
  } else {
    // Unregister stale service workers in local development
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
  }
}

// Update viewport height for mobile
function setViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

setViewportHeight();
window.addEventListener('resize', setViewportHeight);
window.addEventListener('orientationchange', setViewportHeight);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
