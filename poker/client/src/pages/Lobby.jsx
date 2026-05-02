import { useState } from 'react';

export default function Lobby({ name, setName, error, setError, onCreate, onJoin }) {
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState('home'); // home | join
  // Default starting stack is "vô hạn" (1 triệu búng — large enough that
  // tournament-style elimination is unlikely in casual play).
  const [startingStack, setStartingStack] = useState(1_000_000);

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
          <>
            <label className="field">
              <span>Số búng khởi đầu mỗi người (tạo phòng mới)</span>
              <div className="stack-row">
                <input
                  type="number"
                  min={20}
                  step={100}
                  value={startingStack}
                  onChange={(e) => setStartingStack(Number(e.target.value) || 0)}
                />
                <div className="stack-presets">
                  {[
                    [1000, '1k'],
                    [10_000, '10k'],
                    [100_000, '100k'],
                    [1_000_000, 'Vô hạn'],
                  ].map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={`btn btn-sm ${startingStack === v ? 'on' : ''}`}
                      onClick={() => setStartingStack(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </label>
            <div className="btn-row">
              <button
                className="btn btn-primary"
                onClick={() => onCreate({ startingStack })}
              >
                Tạo phòng mới
              </button>
              <button className="btn btn-secondary" onClick={() => setMode('join')}>
                Vào bằng mã phòng
              </button>
            </div>
          </>
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
