import { io } from 'socket.io-client';

// In dev (vite dev server) we want to talk to the standalone server on :3001.
// In a same-origin production deploy (server serves the built client) we use
// window.location.origin so we inherit the page's protocol/host/credentials.
function defaultUrl() {
  if (import.meta.env.DEV) return 'http://localhost:3001';
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

const url = import.meta.env.VITE_SERVER_URL || defaultUrl();

export const socket = io(url, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});
