import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../socket.js';
import Seat from '../components/Seat.jsx';
import Card from '../components/Card.jsx';
import BetBar from '../components/BetBar.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import WinnerBanner from '../components/WinnerBanner.jsx';
import RiverIntro from '../components/RiverIntro.jsx';
import { useVoiceChat } from '../hooks/useVoiceChat.js';
import { useActionCountdown } from '../hooks/useActionCountdown.js';

const SEAT_POSITIONS = [
  // positions around an oval. Index 0 = current player bottom center.
  { top: '82%', left: '50%' },
  { top: '70%', left: '18%' },
  { top: '40%', left: '8%' },
  { top: '14%', left: '25%' },
  { top: '8%', left: '50%' },
  { top: '14%', left: '75%' },
  { top: '40%', left: '92%' },
  { top: '70%', left: '82%' },
  { top: '82%', left: '35%' },
];

export default function Table({ room, setRoom, onLeave, me }) {
  const state = room?.state;
  const [hole, setHole] = useState([]);
  const [chat, setChat] = useState(room?.chatLog || []);
  const [showdownReveals, setShowdownReveals] = useState([]); // ordered reveals
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [winnerInfo, setWinnerInfo] = useState(null); // {winners, reveals}
  const [riverIntro, setRiverIntro] = useState(false);
  const [speakingIds, setSpeakingIds] = useState(new Set());
  const [errorMsg, setErrorMsg] = useState('');

  const voice = useVoiceChat(state?.players || [], me);
  const countdown = useActionCountdown(state?.actionDeadline);

  // Listen for game events.
  useEffect(() => {
    const onState = (s) => setRoom((r) => (r ? { ...r, state: s } : r));
    const onHole = ({ hole }) => setHole(hole);
    const onHand = (p) => {
      setWinnerInfo(null);
      setShowdownReveals([]);
      setRevealedIds(new Set());
      setRoom((r) => (r ? { ...r, state: p } : r));
    };
    const onAction = (p) => {
      setRoom((r) => (r ? { ...r, state: p.state } : r));
    };
    const onAuto = () => {};
    const onCommunity = ({ cards, phase }) => {
      setRoom((r) => (r ? { ...r, state: { ...r.state, community: cards, phase } } : r));
    };
    const onRiverIntro = ({ state }) => {
      setRiverIntro(true);
      setRoom((r) => (r ? { ...r, state } : r));
      setTimeout(() => setRiverIntro(false), 4800);
    };
    const onShowdown = ({ reveals, state }) => {
      setShowdownReveals(reveals);
      setRoom((r) => (r ? { ...r, state } : r));
      // Stagger reveal.
      reveals.forEach((rev, i) => {
        setTimeout(() => {
          setRevealedIds((prev) => {
            const next = new Set(prev);
            next.add(rev.id);
            return next;
          });
        }, 900 + i * 1200);
      });
    };
    const onHandEnded = (p) => {
      setWinnerInfo({ winners: p.winners, reveals: p.reveals, uncontested: p.uncontested });
      setRoom((r) => (r ? { ...r, state: p.state } : r));
    };
    const onChat = (msg) => setChat((prev) => [...prev, msg]);
    const onSpeaking = ({ id, speaking }) => {
      setSpeakingIds((prev) => {
        const next = new Set(prev);
        if (speaking) next.add(id);
        else next.delete(id);
        return next;
      });
    };

    socket.on('state_sync', onState);
    socket.on('your_hole', onHole);
    socket.on('hand_started', onHand);
    socket.on('action_taken', onAction);
    socket.on('auto_action', onAuto);
    socket.on('community_dealt', onCommunity);
    socket.on('river_intro', onRiverIntro);
    socket.on('showdown_start', onShowdown);
    socket.on('hand_ended', onHandEnded);
    socket.on('chat_message', onChat);
    socket.on('speaking', onSpeaking);
    return () => {
      socket.off('state_sync', onState);
      socket.off('your_hole', onHole);
      socket.off('hand_started', onHand);
      socket.off('action_taken', onAction);
      socket.off('auto_action', onAuto);
      socket.off('community_dealt', onCommunity);
      socket.off('river_intro', onRiverIntro);
      socket.off('showdown_start', onShowdown);
      socket.off('hand_ended', onHandEnded);
      socket.off('chat_message', onChat);
      socket.off('speaking', onSpeaking);
    };
  }, [setRoom]);

  // Rotate seat layout so the local player is seat 0 (bottom center).
  const orderedPlayers = useMemo(() => {
    if (!state) return [];
    const myIdx = state.players.findIndex((p) => p.id === me);
    if (myIdx < 0) return state.players;
    const rotated = [...state.players.slice(myIdx), ...state.players.slice(0, myIdx)];
    return rotated;
  }, [state, me]);

  if (!state) {
    return (
      <div className="table-loading">
        <p>Đang kết nối phòng…</p>
      </div>
    );
  }

  const myPlayer = state.players.find((p) => p.id === me);
  const isHost = state.hostId === me;
  const myTurn = state.actingId === me;

  const start = () => {
    socket.emit('start_hand', {}, (res) => {
      if (!res?.ok) setErrorMsg(res?.error || 'Không bắt đầu được');
      else setErrorMsg('');
    });
  };

  const act = (action, amount = 0) => {
    socket.emit('player_action', { action, amount }, (res) => {
      if (!res?.ok) setErrorMsg(res?.error || 'Hành động không hợp lệ');
      else setErrorMsg('');
    });
  };

  const sendChat = (text) => socket.emit('chat_message', { text });

  const toggleMic = () => {
    const on = !myPlayer?.micOn;
    socket.emit('mic_toggle', { on });
    voice.setEnabled(on);
  };

  return (
    <div className="table-page">
      <header className="topbar">
        <div className="room-info">
          <span className="label">Phòng</span>
          <span className="code">{state.roomId}</span>
          <button
            className="copy-btn"
            onClick={() => navigator.clipboard?.writeText(state.roomId)}
            title="Sao chép mã"
          >
            📋
          </button>
        </div>
        <div className="hand-info">Ván #{state.handNumber} · {phaseLabel(state.phase)}</div>
        <div className="top-actions">
          <button
            className={`btn btn-mic ${myPlayer?.micOn ? 'on' : ''}`}
            onClick={toggleMic}
            title={myPlayer?.micOn ? 'Tắt mic' : 'Bật mic'}
          >
            {myPlayer?.micOn ? '🎙️ Mic' : '🔇 Mic'}
          </button>
          <button className="btn btn-ghost" onClick={onLeave}>
            Thoát
          </button>
        </div>
      </header>

      <main className="table-main">
        <div className="poker-table">
          <div className="table-felt">
            <div className="pot">
              <div className="pot-label">POT</div>
              <div className="pot-amount">{state.pot} búng</div>
            </div>

            <div className="community">
              {[0, 1, 2, 3, 4].map((i) => {
                const c = state.community[i];
                const isRiverSlot = i === 4;
                return (
                  <div
                    key={i}
                    className={`community-slot ${c ? 'filled' : ''} ${
                      isRiverSlot && c ? 'river-slam' : ''
                    }`}
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    {c ? <Card card={c} revealed /> : <Card placeholder />}
                  </div>
                );
              })}
            </div>

            {riverIntro && <RiverIntro />}

            {winnerInfo && <WinnerBanner info={winnerInfo} />}
          </div>

          {orderedPlayers.map((p, i) => (
            <Seat
              key={p.id}
              player={p}
              position={SEAT_POSITIONS[i] || SEAT_POSITIONS[0]}
              isMe={p.id === me}
              isDealer={p.id === state.dealerId}
              isActing={p.id === state.actingId}
              actionRemainingMs={p.id === state.actingId ? countdown : null}
              hole={p.id === me ? hole : null}
              showdownReveal={
                revealedIds.has(p.id)
                  ? showdownReveals.find((r) => r.id === p.id)
                  : null
              }
              speaking={speakingIds.has(p.id)}
            />
          ))}
        </div>

        <aside className="side-panel">
          <ChatPanel messages={chat} onSend={sendChat} meName={myPlayer?.name} />
        </aside>
      </main>

      <footer className="bottom-bar">
        {errorMsg && <div className="error">{errorMsg}</div>}

        {state.phase === 'waiting' || state.phase === 'finished' ? (
          <div className="waiting-bar">
            <div>Đang chờ {isHost ? 'bạn bắt đầu ván' : 'chủ phòng bắt đầu ván'}…</div>
            {isHost && (
              <button className="btn btn-primary" onClick={start}>
                Bắt đầu ván
              </button>
            )}
          </div>
        ) : (
          <BetBar
            myTurn={myTurn}
            myPlayer={myPlayer}
            state={state}
            onAct={act}
            countdownMs={countdown}
          />
        )}
      </footer>
    </div>
  );
}

function phaseLabel(phase) {
  return {
    waiting: 'Đang chờ',
    preflop: 'Vòng 1 (Pre-flop)',
    flop: 'Vòng 2 (Flop)',
    turn: 'Vòng 3 (Turn)',
    river_intro: '✨ Chuẩn bị lá cuối...',
    river: 'Vòng 4 (River)',
    showdown: 'Lật bài',
    finished: 'Đã xong ván',
  }[phase] || phase;
}
