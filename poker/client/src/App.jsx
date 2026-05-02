import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import Lobby from './pages/Lobby.jsx';
import Table from './pages/Table.jsx';
import { attachUnlock } from './audio/engine.js';

// Wire up the first-gesture unlock for our AudioContext as soon as the app
// mounts. Browsers block audio playback until the user interacts; this hook
// resumes the context on the first click/touch/keypress.
attachUnlock();

export default function App() {
  const [screen, setScreen] = useState('lobby'); // lobby | table
  const [room, setRoom] = useState(null); // { roomId, state, chatLog }
  const [name, setName] = useState(() => localStorage.getItem('poker.name') || '');
  const [error, setError] = useState('');

  useEffect(() => {
    const onPlayerJoined = (p) => {
      setRoom((r) => (r ? { ...r, state: p.state } : r));
    };
    const onPlayerLeft = (p) => {
      setRoom((r) => (r ? { ...r, state: p.state } : r));
    };
    socket.on('player_joined', onPlayerJoined);
    socket.on('player_left', onPlayerLeft);
    return () => {
      socket.off('player_joined', onPlayerJoined);
      socket.off('player_left', onPlayerLeft);
    };
  }, []);

  const createRoom = (opts = {}) => {
    if (!name.trim()) return setError('Nhập tên đã nào!');
    localStorage.setItem('poker.name', name);
    socket.emit(
      'create_room',
      { name, startingStack: opts.startingStack },
      (res) => {
        if (!res?.ok) return setError(res?.error || 'Không tạo được phòng');
        setRoom({ roomId: res.roomId, state: res.state, chatLog: [] });
        setScreen('table');
      },
    );
  };

  const joinRoom = (code) => {
    if (!name.trim()) return setError('Nhập tên đã nào!');
    localStorage.setItem('poker.name', name);
    socket.emit('join_room', { roomId: code, name }, (res) => {
      if (!res?.ok) return setError(res?.error || 'Không vào được phòng');
      setRoom({ roomId: res.roomId, state: res.state, chatLog: res.chatLog || [] });
      setScreen('table');
    });
  };

  const leaveRoom = () => {
    socket.disconnect();
    setRoom(null);
    setScreen('lobby');
    setTimeout(() => socket.connect(), 100);
  };

  if (screen === 'lobby') {
    return (
      <Lobby
        name={name}
        setName={setName}
        error={error}
        setError={setError}
        onCreate={createRoom}
        onJoin={joinRoom}
      />
    );
  }

  return <Table room={room} setRoom={setRoom} onLeave={leaveRoom} me={socket.id} />;
}
