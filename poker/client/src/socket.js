import { io } from 'socket.io-client';

const url = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket = io(url, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});
