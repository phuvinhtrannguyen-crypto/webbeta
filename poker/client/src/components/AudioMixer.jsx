import { useEffect, useState } from 'react';
import {
  subscribe,
  getMixerState,
  setVolume,
  setMuted,
  setPeerVolume,
  startMusic,
  stopMusic,
  isMusicPlaying,
  ensureContext,
} from '../audio/engine.js';

// Audio mixer panel: master/music/sfx/tts sliders + per-player mic sliders.
// Hidden behind a 🔊 toggle in the topbar to keep the table uncluttered.
export default function AudioMixer({ players, me, open, onClose }) {
  const [mixer, setMixer] = useState(getMixerState);
  const [musicOn, setMusicOn] = useState(isMusicPlaying());

  useEffect(() => subscribe(setMixer), []);

  const onSlider = (cat) => (e) => {
    ensureContext();
    setVolume(cat, Number(e.target.value));
  };
  const onMute = (cat) => () => setMuted(cat, !mixer.muted[cat]);
  const onPeerSlider = (id) => (e) => setPeerVolume(id, Number(e.target.value));

  const toggleMusic = () => {
    ensureContext();
    if (musicOn) {
      stopMusic();
      setMusicOn(false);
    } else {
      startMusic();
      setMusicOn(true);
    }
  };

  if (!open) return null;
  const peers = (players || []).filter((p) => p.id !== me);
  return (
    <div className="mixer-overlay" onClick={onClose}>
      <div className="mixer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mixer-header">
          <h3>Bộ chỉnh âm</h3>
          <button className="mixer-close" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="mixer-section">
          <div className="mixer-row">
            <label>Tổng âm lượng</label>
            <button
              className={`mute-btn ${mixer.muted.master ? 'muted' : ''}`}
              onClick={onMute('master')}
              title={mixer.muted.master ? 'Bật tiếng' : 'Tắt tiếng'}
            >
              {mixer.muted.master ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mixer.volumes.master}
              onChange={onSlider('master')}
            />
            <span className="mixer-value">
              {Math.round(mixer.volumes.master * 100)}%
            </span>
          </div>

          <div className="mixer-row">
            <label>Nhạc nền</label>
            <button
              className={`mute-btn ${mixer.muted.music ? 'muted' : ''}`}
              onClick={onMute('music')}
            >
              {mixer.muted.music ? '🔇' : '🎵'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mixer.volumes.music}
              onChange={onSlider('music')}
            />
            <span className="mixer-value">
              {Math.round(mixer.volumes.music * 100)}%
            </span>
            <button
              className={`btn btn-sm ${musicOn ? 'on' : ''}`}
              onClick={toggleMusic}
              style={{ marginLeft: 6 }}
            >
              {musicOn ? 'Đang phát' : 'Phát'}
            </button>
          </div>

          <div className="mixer-row">
            <label>Hiệu ứng</label>
            <button
              className={`mute-btn ${mixer.muted.sfx ? 'muted' : ''}`}
              onClick={onMute('sfx')}
            >
              {mixer.muted.sfx ? '🔇' : '✨'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mixer.volumes.sfx}
              onChange={onSlider('sfx')}
            />
            <span className="mixer-value">
              {Math.round(mixer.volumes.sfx * 100)}%
            </span>
          </div>

          <div className="mixer-row">
            <label>Giọng đọc (TTS)</label>
            <button
              className={`mute-btn ${mixer.muted.tts ? 'muted' : ''}`}
              onClick={onMute('tts')}
            >
              {mixer.muted.tts ? '🔇' : '🗣️'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mixer.volumes.tts}
              onChange={onSlider('tts')}
            />
            <span className="mixer-value">
              {Math.round(mixer.volumes.tts * 100)}%
            </span>
          </div>
        </div>

        <div className="mixer-section">
          <div className="mixer-section-title">Mic của người chơi</div>
          {peers.length === 0 && (
            <div className="mixer-empty">
              Chưa có người chơi khác trong phòng.
            </div>
          )}
          {peers.map((p) => {
            const v = mixer.peerVolumes[p.id] ?? 1;
            return (
              <div className="mixer-row" key={p.id}>
                <label title={p.name}>
                  {p.micOn ? '🎙️' : '🔇'} {p.name}
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={v}
                  onChange={onPeerSlider(p.id)}
                />
                <span className="mixer-value">{Math.round(v * 100)}%</span>
              </div>
            );
          })}
        </div>

        <div className="mixer-foot">
          Cài đặt được lưu cục bộ trên máy bạn.
        </div>
      </div>
    </div>
  );
}
