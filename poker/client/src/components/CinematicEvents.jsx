import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import {
  registerExternalMediaElement,
  unregisterExternalMediaElement,
} from '../media/casinoMedia.js';

// Uploaded files in public/fx. The 169f video is the end cinematic;
// the other uploaded mp4 is the all-in-left cinematic.
const ALL_IN_VIDEO_SRC = '/fx/63890366aeeb6e2cecb8407d4c3046ec.mp4';
const END_VIDEO_SRC = '/fx/169f3da9234ddc76059714adb70c9111.mp4';

export default function CinematicEvents() {
  const [allInFx, setAllInFx] = useState(null);
  const [endFx, setEndFx] = useState(null);
  const timersRef = useRef({});

  useEffect(() => {
    const trigger = (key, setter, payload, duration) => {
      window.clearTimeout(timersRef.current[key]);
      const fx = { ...payload, fxKey: `${key}-${Date.now()}-${Math.random()}` };
      setter(fx);
      timersRef.current[key] = window.setTimeout(() => setter(null), duration);
    };

    const onAction = ({ action, playerId, amount, state }) => {
      if (action !== 'allin') return;
      const player = state?.players?.find((p) => p.id === playerId);
      trigger(
        'allin',
        setAllInFx,
        {
          name: player?.name || 'Người chơi',
          amount: player?.totalContributed || amount,
        },
        8200,
      );
    };

    const onHandEnded = ({ winners = [], pot }) => {
      const topWinner = winners?.[0];
      trigger(
        'end',
        setEndFx,
        {
          name: topWinner?.name || 'Ván đấu',
          amount: topWinner?.amount || pot,
        },
        15000,
      );
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
    <div className="cinematic cinematic-allin" aria-live="polite">
      <div className="allin-video-shell">
        <SideVideo
          id={`allin-video-${fx.fxKey}`}
          src={ALL_IN_VIDEO_SRC}
          startAt={6.55}
          playbackRate={1.08}
          className="allin-video"
          fallbackClassName="allin-video-fallback"
        />
        <div className="allin-video-badge">ALL-IN CAM</div>
      </div>
      <div className="allin-copy">
        <div className="allin-kicker">TẤT TAY</div>
        <div className="allin-name">{fx.name}</div>
        <div className="allin-sub">đẩy hết búng lên bàn</div>
        <div className="allin-amount">{formatChips(fx.amount)} búng</div>
      </div>
      <div className="allin-chip-rain" />
    </div>
  );
}

function EndCinematic({ fx }) {
  return (
    <div className="cinematic cinematic-end" aria-live="polite">
      <div className="end-video-shell">
        <SideVideo
          id={`end-video-${fx.fxKey}`}
          src={END_VIDEO_SRC}
          playbackRate={2}
          className="end-video"
          fallbackClassName="end-video-fallback"
        />
        <div className="end-video-glow" />
      </div>
      <div className="end-copy">
        <span>THIS IS THE END</span>
        <b>{fx.name}</b>
        {fx.amount ? <small>+{formatChips(fx.amount)} búng</small> : null}
      </div>
    </div>
  );
}

function SideVideo({ id, src, startAt = 0, playbackRate = 1, className, fallbackClassName }) {
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    registerExternalMediaElement(id, video, 'sfx');
    const play = () => {
      try {
        video.currentTime = startAt;
      } catch {}
      video.playbackRate = playbackRate;
      video.play().catch(() => {});
    };
    if (video.readyState >= 1) play();
    else video.addEventListener('loadedmetadata', play, { once: true });
    return () => {
      unregisterExternalMediaElement(id);
      video.pause();
      video.removeEventListener('loadedmetadata', play);
    };
  }, [id, src, startAt, playbackRate, failed]);

  if (failed) return <div className={fallbackClassName} />;
  return (
    <video
      ref={videoRef}
      className={className}
      src={src}
      playsInline
      preload="auto"
      onError={() => setFailed(true)}
    />
  );
}

function formatChips(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
