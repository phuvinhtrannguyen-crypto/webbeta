import Card from './Card.jsx';

const STATUS_LABEL = {
  waiting: 'Đang chờ',
  playing: 'Đang chơi',
  folded: 'Fold',
  allin: 'All-in',
  winner: 'Thắng',
  loser: 'Thua',
};

export default function Seat({
  player,
  position,
  isMe,
  isDealer,
  isActing,
  actionRemainingMs,
  hole,
  showdownReveal,
  speaking,
}) {
  const seconds = actionRemainingMs != null ? Math.max(0, Math.ceil(actionRemainingMs / 1000)) : null;
  const progressPct =
    actionRemainingMs != null ? Math.max(0, Math.min(100, (actionRemainingMs / 15000) * 100)) : 0;

  const shownHole =
    isMe && hole?.length
      ? hole
      : showdownReveal?.hole || null;

  return (
    <div
      className={`seat ${isActing ? 'acting' : ''} ${player.status} ${speaking ? 'speaking' : ''}`}
      style={{ top: position.top, left: position.left }}
    >
      <div className="seat-cards">
        {shownHole
          ? shownHole.map((c, i) => (
              <div key={i} className={`hole ${showdownReveal ? 'revealed' : ''}`}>
                <Card card={c} revealed />
              </div>
            ))
          : Array.from({ length: player.holeCount || 0 }).map((_, i) => (
              <div key={i} className="hole">
                <Card />
              </div>
            ))}
      </div>

      <div className={`seat-card ${player.status === 'folded' ? 'folded' : ''}`}>
        <div className="seat-header">
          {player.micOn ? <span className="mic-icon">🎙️</span> : <span className="mic-icon off">🔇</span>}
          <div className="seat-name">{player.name}{isMe ? ' (bạn)' : ''}</div>
          {isDealer && <span className="dealer-btn" title="Dealer">D</span>}
        </div>
        <div className="seat-stack">{player.stack} búng</div>
        <div className="seat-status">{STATUS_LABEL[player.status] || player.status}</div>
        {showdownReveal?.handName && (
          <div className="seat-hand">{showdownReveal.handName}</div>
        )}
        {player.currentBet > 0 && (
          <div className="seat-bet">Đã cược: {player.currentBet}</div>
        )}
        {isActing && seconds !== null && (
          <div className="action-timer">
            <div className="timer-bar" style={{ width: `${progressPct}%` }} />
            <div className="timer-text">{seconds}s</div>
          </div>
        )}
      </div>
    </div>
  );
}
