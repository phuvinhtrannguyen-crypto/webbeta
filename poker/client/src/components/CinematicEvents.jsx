import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import {
  registerExternalMediaElement,
  unregisterExternalMediaElement,
} from '../media/casinoMedia.js';

const ALL_IN_AUDIO_SRC = '/fx/63890366aeeb6e2cecb8407d4c3046ec.mp4';
const END_AUDIO_SRC = '/fx/169f3da9234ddc76059714adb70c9111.mp4';

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
        7600,
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
        32000,
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
    <div className="fx-full fx-allin-script" aria-live="polite">
      <MediaSound
        id={`allin-audio-${fx.fxKey}`}
        src={ALL_IN_AUDIO_SRC}
        startAt={6.55}
        playbackRate={1.12}
      />
      <div className="fx-scanlines" />
      <div className="fx-green-vortex" />
      <div className="fx-skull-stage">
        <div className="fx-shockwave" />
        <div className="fx-shockwave two" />
        <div className="fx-shockwave three" />
        <div className="fx-brain-cloud" aria-hidden="true">
          <span className="brain b1" />
          <span className="brain b2" />
          <span className="brain b3" />
          <span className="brain b4" />
          <span className="brain b5" />
        </div>
        <div className="fx-bone-shards" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => <i key={i} />)}
        </div>
        <div className="fx-skull-mask" aria-hidden="true">
          <span className="eye left" />
          <span className="eye right" />
          <span className="nose" />
          <span className="jaw" />
          <span className="teeth" />
        </div>
      </div>
      <div className="fx-allin-copy">
        <div className="fx-kicker">ALL IN</div>
        <div className="fx-player">{fx.name}</div>
        <div className="fx-amount">{formatChips(fx.amount)} búng</div>
      </div>
    </div>
  );
}

function EndCinematic({ fx }) {
  return (
    <div className="fx-full fx-end-script" aria-live="polite">
      <MediaSound
        id={`end-audio-${fx.fxKey}`}
        src={END_AUDIO_SRC}
        playbackRate={2}
      />
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

function MediaSound({ id, src, startAt = 0, playbackRate = 1 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    registerExternalMediaElement(id, el, 'sfx');
    const play = () => {
      try {
        el.currentTime = startAt;
      } catch {}
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
  }, [id, src, startAt, playbackRate]);

  return <audio ref={ref} className="fx-audio" src={src} preload="auto" />;
}

function formatChips(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
