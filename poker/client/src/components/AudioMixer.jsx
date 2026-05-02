import { useEffect, useState } from 'react';
import {
  subscribe,
  getMixerState,
  setVolume,
  setMuted,
  setPeerVolume,
  ensureContext,
} from '../audio/engine.js';
import {
  startYouTubeMusic as startMusic,
  stopYouTubeMusic as stopMusic,
  isYouTubeMusicPlaying as isMusicPlaying,
  subscribeExternalMedia,
} from '../media/casinoMedia.js';

// Audio mixer panel: master/music/sfx/tts sliders + per-player mic sliders.
// Music now controls the requested YouTube background track, and HTML media
// effects obey the same master/music/sfx mixer model.
export default function AudioMixer({ players, me, open, onClose }) {
  const [mixer, setMixer] = useState(getMixerState);
  const [musicOn, setMusicOn] = useState(isMusicPlaying());

  useEffect(() => {
    const unsubMixer = subscribe(setMixer);
    const unsubMedia = subscribeExternalMedia(() => setMusicOn(isMusicPlaying()));
    setMusicOn(isMusicPlaying());
    return () => {
      unsubMixer();
      unsubMedia();
    };
  }, []);

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
          <button className="mixer-close" onClick={onClose} title="Đóng">✕</button>
        </div>

        <div className="mixer-section">
          <MixerRow label="Tổng âm lượng" icon={mixer.muted.master ? '🔇' : '🔊'} muted={mixer.muted.master} value={mixer.volumes.master} onMute={onMute('master')} onChange={onSlider('master')} />
          <div className="mixer-row">
            <label>Nhạc nền YouTube</label>
            <button className={`mute-btn ${mixer.muted.music ? 'muted' : ''}`} onClick={onMute('music')}>{mixer.muted.music ? '🔇' : '🎵'}</button>
            <input type="range" min={0} max={1} step={0.01} value={mixer.volumes.music} onChange={onSlider('music')} />
            <span className="mixer-value">{Math.round(mixer.volumes.music * 100)}%</span>
            <button className={`btn btn-sm ${musicOn ? 'on' : ''}`} onClick={toggleMusic} style={{ marginLeft: 6 }}>{musicOn ? 'Đang phát' : 'Phát'}</button>
          </div>
          <MixerRow label="Hiệu ứng + video" icon={mixer.muted.sfx ? '🔇' : '✨'} muted={mixer.muted.sfx} value={mixer.volumes.sfx} onMute={onMute('sfx')} onChange={onSlider('sfx')} />
          <MixerRow label="Giọng đọc (TTS)" icon={mixer.muted.tts ? '🔇' : '🗣️'} muted={mixer.muted.tts} value={mixer.volumes.tts} onMute={onMute('tts')} onChange={onSlider('tts')} />
        </div>

        <div className="mixer-section">
          <div className="mixer-section-title">Mic của người chơi</div>
          {peers.length === 0 && <div className="mixer-empty">Chưa có người chơi khác trong phòng.</div>}
          {peers.map((p) => {
            const v = mixer.peerVolumes[p.id] ?? 1;
            return (
              <div className="mixer-row" key={p.id}>
                <label title={p.name}>{p.micOn ? '🎙️' : '🔇'} {p.name}</label>
                <input type="range" min={0} max={1} step={0.01} value={v} onChange={onPeerSlider(p.id)} />
                <span className="mixer-value">{Math.round(v * 100)}%</span>
              </div>
            );
          })}
        </div>

        <div className="mixer-foot">Cài đặt được lưu cục bộ trên máy bạn.</div>
      </div>
    </div>
  );
}

function MixerRow({ label, icon, muted, value, onMute, onChange }) {
  return (
    <div className="mixer-row">
      <label>{label}</label>
      <button className={`mute-btn ${muted ? 'muted' : ''}`} onClick={onMute}>{icon}</button>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={onChange} />
      <span className="mixer-value">{Math.round(value * 100)}%</span>
    </div>
  );
}
