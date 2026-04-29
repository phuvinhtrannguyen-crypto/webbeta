// Cu Bung Poker — Socket.IO server.
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { PokerRoom } from './game/room.js';

const PORT = Number(process.env.PORT || 3001);
const ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
app.use(cors({ origin: ORIGIN }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: ORIGIN, methods: ['GET', 'POST'] },
});

// ----- timers -----
const timers = new Map(); // key -> timeoutHandle
function scheduleTimer(key, fn, ms) {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const h = setTimeout(() => {
    timers.delete(key);
    try {
      fn();
    } catch (e) {
      console.error('Timer error', key, e);
    }
  }, ms);
  timers.set(key, h);
}
function clearTimerKey(key) {
  const h = timers.get(key);
  if (h) {
    clearTimeout(h);
    timers.delete(key);
  }
}

// ----- rooms -----
/** @type {Map<string, PokerRoom>} */
const rooms = new Map();
const socketToRoom = new Map();

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeRoom(hostSocketId) {
  const id = genRoomCode();
  const room = new PokerRoom({
    id,
    hostSocketId,
    emit: (event, payload) => dispatch(id, event, payload),
    scheduleTimer,
    clearTimer: clearTimerKey,
  });
  rooms.set(id, room);
  return room;
}

function dispatch(roomId, event, payload) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (event === '__private__') {
    io.to(payload.to).emit(payload.event, payload.payload);
    return;
  }
  io.to(roomId).emit(event, payload);
}

function sendStateSync(room) {
  io.to(room.id).emit('state_sync', room.publicState());
}

// ----- socket handlers -----
io.on('connection', (socket) => {
  socket.on('create_room', ({ name }, cb) => {
    try {
      const room = makeRoom(socket.id);
      room.addPlayer(socket.id, name);
      socket.join(room.id);
      socketToRoom.set(socket.id, room.id);
      cb?.({ ok: true, roomId: room.id, state: room.publicState() });
      sendStateSync(room);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('join_room', ({ roomId, name }, cb) => {
    try {
      const room = rooms.get((roomId || '').toUpperCase());
      if (!room) throw new Error('Room not found');
      room.addPlayer(socket.id, name);
      socket.join(room.id);
      socketToRoom.set(socket.id, room.id);
      cb?.({ ok: true, roomId: room.id, state: room.publicState(), chatLog: room.chatLog });
      io.to(room.id).emit('player_joined', { id: socket.id, state: room.publicState() });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('start_hand', (_payload, cb) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return cb?.({ ok: false, error: 'No room' });
    try {
      room.startHand(socket.id);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('player_action', ({ action, amount }, cb) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return cb?.({ ok: false, error: 'No room' });
    try {
      room.playerAction(socket.id, action, amount);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('chat_message', ({ text }) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;
    const msg = room.pushChat(socket.id, text);
    if (msg) io.to(room.id).emit('chat_message', msg);
  });

  socket.on('mic_toggle', ({ on }) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;
    room.setMic(socket.id, on);
    io.to(room.id).emit('mic_update', { id: socket.id, on: !!on });
    sendStateSync(room);
  });

  socket.on('speaking', ({ speaking }) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    socket.to(roomId).emit('speaking', { id: socket.id, speaking: !!speaking });
  });

  // ---- WebRTC signaling (mesh) ----
  socket.on('webrtc_signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit('webrtc_signal', { from: socket.id, data });
  });

  socket.on('webrtc_hello', () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    socket.to(roomId).emit('webrtc_hello', { from: socket.id });
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    socketToRoom.delete(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.removePlayer(socket.id);
    io.to(room.id).emit('player_left', { id: socket.id, state: room.publicState() });
    if (room.players.size === 0) {
      rooms.delete(room.id);
    } else {
      sendStateSync(room);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[cu-bung-poker] server listening on :${PORT} (client origin: ${ORIGIN})`);
});
