const SUIT_INFO = {
  s: { symbol: '♠', color: 'black' },
  c: { symbol: '♣', color: 'black' },
  h: { symbol: '♥', color: 'red' },
  d: { symbol: '♦', color: 'red' },
};

export default function Card({ card, revealed = false, placeholder = false, flipping = false }) {
  if (placeholder) {
    return <div className="card placeholder" />;
  }

  if (!revealed) {
    return (
      <div className={`card back ${flipping ? 'flipping' : ''}`}>
        <div className="card-back-pattern" />
      </div>
    );
  }

  const { symbol, color } = SUIT_INFO[card.suit] || { symbol: '?', color: 'black' };
  const rankChar =
    card.rank <= 9
      ? String(card.rank)
      : { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[card.rank];

  return (
    <div className={`card face ${color} ${flipping ? 'flipping' : ''}`}>
      <div className="card-corner top-left">
        <div className="rank">{rankChar}</div>
        <div className="suit">{symbol}</div>
      </div>
      <div className="card-center">{symbol}</div>
      <div className="card-corner bottom-right">
        <div className="rank">{rankChar}</div>
        <div className="suit">{symbol}</div>
      </div>
    </div>
  );
}
