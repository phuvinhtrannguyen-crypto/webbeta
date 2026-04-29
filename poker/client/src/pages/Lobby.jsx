import { useState } from 'react';

export default function Lobby({ name, setName, error, setError, onCreate, onJoin }) {
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState('home'); // home | join

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="title">
          <span className="chip-logo">🪙</span> Cú Búng Poker
        </h1>
        <p className="subtitle">Chơi poker giải trí với tiền ảo <b>cú búng</b>. Không tiền thật.</p>

        <label className="field">
          <span>Tên người chơi</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder="Ví dụ: Phú"
            maxLength={20}
          />
        </label>

        {error ? <div className="error">{error}</div> : null}

        {mode === 'home' && (
          <div className="btn-row">
            <button className="btn btn-primary" onClick={onCreate}>
              Tạo phòng mới
            </button>
            <button className="btn btn-secondary" onClick={() => setMode('join')}>
              Vào bằng mã phòng
            </button>
          </div>
        )}

        {mode === 'join' && (
          <>
            <label className="field">
              <span>Mã phòng</span>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="VD: A1B2C"
                maxLength={5}
              />
            </label>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => onJoin(joinCode)}>
                Vào phòng
              </button>
              <button className="btn btn-ghost" onClick={() => setMode('home')}>
                Quay lại
              </button>
            </div>
          </>
        )}

        <div className="lobby-rules">
          <h3>Đơn vị cược</h3>
          <ul>
            <li>
              <b>Búng</b> = 1
            </li>
            <li>
              <b>Gõ</b> = 10 búng
            </li>
            <li>
              <b>Đấm</b> = 100 búng
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
