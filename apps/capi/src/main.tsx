import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: the service worker keeps the app shell; data lives in IndexedDB.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
