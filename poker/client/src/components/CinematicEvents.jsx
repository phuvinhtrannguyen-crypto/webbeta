import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import { registerExternalMediaElement, unregisterExternalMediaElement } from '../media/casinoMedia.js';

const ALL_IN_VIDEO_SRC = '/fx/tiktok_no_nm.mp4';
const END_AUDIO_SRC = '/fx/169f3da9234ddc76059714adb70c9111.mp4';

export default function CinematicEvents() {
  const [allInFx, setAllInFx] = useState(null);
  const [endFx, setEndFx] = useState(null);
  const timersRef = useRef({});

  useEffect(() => {
    const trigger = (key, setter, payload, duration) => {
      window.clearTimeout(timersRef.current[key]);
      setter({ ...payload, fxKey: `${key}-${Date.now()}-${Math.random()}` });
      timersRef.current[key] = window.setTimeout(() => setter(null), duration);
    };

    const onAction = ({ action, playerId, amount, state }) => {
      if (action !== 'allin') return;
      const player = state?.players?.find((p) => p.id === playerId);
      trigger('allin', setAllInFx, {
        name: player?.name || 'Người chơi',
        amount: player?.totalContributed || amount,
      }, 7600);
    };

    const onHandEnded = ({ winners = [], pot }) => {
      const topWinner = winners?.[0];
      trigger('end', setEndFx, {
        name: topWinner?.name || 'Ván đấu',
        amount: topWinner?.amount || pot,
      }, 15000);
    };

    socket.on('action_taken', onAction);
    socket.on('hand_ended', onHandEnded);
    return () => {
      socket.off('action_taken', onAction);
      socket.off('hand_ended', onHandEnded);
      window.clearTimeout(timersRef.current.allin);
      window.clearTimeout(timersRef.current.end);
    };
  }, []);

  return (
    <>
      {allInFx && <AllInCinematic key={allInFx.fxKey} fx={allInFx} />}
      {endFx && <EndCinematic key={endFx.fxKey} fx={endFx} />}
    </>
  );
}

function AllInCinematic({ fx }) {
  return (
    <div className="fx-full fx-allin-video" aria-live="polite">
      <div className="fx-clean-backdrop" />
      <div className="fx-clean-vortex" />
      <div className="fx-clean-ring r1" />
      <div className="fx-clean-ring r2" />
      <VideoFx id={`allin-video-${fx.fxKey}`} src={ALL_IN_VIDEO_SRC} playbackRate={1.12} />
      <div className="fx-clean-copy">
        <div className="fx-clean-kicker">ALL IN</div>
        <div className="fx-clean-player">{fx.name}</div>
        <div className="fx-clean-amount">{formatChips(fx.amount)} búng</div>
      </div>
    </div>
  );
}

function EndCinematic({ fx }) {
  return (
    <div className="fx-full fx-end-script" aria-live="polite">
      <AudioFx id={`end-audio-${fx.fxKey}`} src={END_AUDIO_SRC} playbackRate={4} />
      <div className="fx-end-grain" />
      <div className="fx-end-words">
        <div className="fx-end-pre">FEEL THE EARTH MOVE</div>
        <div className="fx-end-title">THIS IS THE END</div>
        <div className="fx-end-winner">{fx.name}</div>
        {fx.amount ? <div className="fx-end-amount">+{formatChips(fx.amount)} búng</div> : null}
      </div>
    </div>
  );
}

function VideoFx({ id, src, playbackRate = 1 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    registerExternalMediaElement(id, el, 'sfx');
    const play = () => {
      try { el.currentTime = 0; } catch {}
      el.muted = false;
      el.volume = 1;
      el.playbackRate = playbackRate;
      el.play().catch(() => {});
    };
    if (el.readyState >= 1) play();
    else el.addEventListener('loadedmetadata', play, { once: true });
    return () => {
      unregisterExternalMediaElement(id);
      el.pause();
      el.removeEventListener('loadedmetadata', play);
    };
  }, [id, src, playbackRate]);

  return <video ref={ref} className="fx-allin-video-el" src={src} playsInline autoPlay preload="auto" />;
}

function AudioFx({ id, src, playbackRate = 1 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    registerExternalMediaElement(id, el, 'sfx');
    const play = () => {
      try { el.currentTime = 0; } catch {}
      el.playbackRate = playbackRate;
      el.play().catch(() => {});
    };
    if (el.readyState >= 1) play();
    else el.addEventListener('loadedmetadata', play, { once: true });
    return () => {
      unregisterExternalMediaElement(id);
      el.pause();
      el.removeEventListener('loadedmetadata', play);
    };
  }, [id, src, playbackRate]);
  return <audio ref={ref} className="fx-audio" src={src} preload="auto" />;
}

function formatChips(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
