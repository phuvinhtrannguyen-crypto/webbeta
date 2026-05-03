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
    <div className="fx-full fx-allin-clean" aria-live="polite">
      <div className="fx-clean-backdrop" />
      <div className="fx-clean-vortex" />
      <div className="fx-clean-ring r1" />
      <div className="fx-clean-ring r2" />
      <KeyedSkullVideo src={ALL_IN_VIDEO_SRC} playbackRate={1.12} />
      <AudioFx id={`allin-audio-${fx.fxKey}`} src={ALL_IN_VIDEO_SRC} playbackRate={1.12} />
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

function KeyedSkullVideo({ src, playbackRate = 1 }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const size = 720;
    canvas.width = size;
    canvas.height = size;

    const draw = () => {
      if (!ctx || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const base = Math.min(vw, vh);

      // Crop only the skull/brain area, not the whole clip.
      const sourceSize = Math.max(240, base * 0.46);
      const targetX = vw * 0.5;
      const targetY = vh * 0.58;
      const sx = Math.min(vw - sourceSize, Math.max(0, targetX - sourceSize / 2));
      const sy = Math.min(vh - sourceSize, Math.max(0, targetY - sourceSize / 2));

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

      try {
        const frame = ctx.getImageData(0, 0, size, size);
        const data = frame.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const maxRB = Math.max(r, b);
          const greenLead = g - maxRB;
          const greenRatio = g / Math.max(1, maxRB);

          const removeGreen =
            (g > 44 && greenLead > 10 && greenRatio > 1.06) ||
            (g > 88 && r < 160 && b < 160);

          if (removeGreen) {
            const strength = Math.min(255, Math.max(0, greenLead * 7));
            data[i + 3] = Math.max(0, 255 - strength);
          }
        }

        ctx.putImageData(frame, 0, 0);
      } catch {
        // Keep the animation running even if one frame cannot be processed.
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    const play = () => {
      try { video.currentTime = 0; } catch {}
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.playbackRate = playbackRate;
      video.play().catch(() => {});
      draw();
    };

    // Critical mobile fix: keep the visual source muted so Safari/Android allows autoplay.
    // Audio is played by a separate registered AudioFx element.
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');

    if (video.readyState >= 1) play();
    else video.addEventListener('loadedmetadata', play, { once: true });

    return () => {
      cancelAnimationFrame(rafRef.current);
      video.pause();
      video.removeEventListener('loadedmetadata', play);
    };
  }, [src, playbackRate]);

  return (
    <>
      <video ref={videoRef} className="fx-key-source" src={src} muted playsInline autoPlay preload="auto" />
      <canvas ref={canvasRef} className="fx-key-canvas" />
    </>
  );
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
