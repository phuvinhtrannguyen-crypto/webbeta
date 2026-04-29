import { useEffect, useState } from 'react';

export default function BetBar({ myTurn, myPlayer, state, onAct, countdownMs }) {
  const [amount, setAmount] = useState(0);

  const toCall = Math.max(0, (state.currentBet || 0) - (myPlayer?.currentBet || 0));
  const minRaiseTotal = (state.currentBet || 0) + (state.minRaise || 10);
  const stack = myPlayer?.stack || 0;

  useEffect(() => {
    // Reset amount to reasonable default when it's the player's turn.
    if (myTurn) {
      if (state.currentBet > 0) {
        setAmount(Math.min(minRaiseTotal, stack + (myPlayer?.currentBet || 0)));
      } else {
        setAmount(Math.min(10, stack));
      }
    }
  }, [myTurn, state.phase, state.currentBet]);

  const add = (n) => setAmount((v) => Math.min(stack + (myPlayer?.currentBet || 0), (v || 0) + n));
  const seconds = countdownMs != null ? Math.max(0, Math.ceil(countdownMs / 1000)) : null;

  const disabled = !myTurn;

  return (
    <div className={`betbar ${disabled ? 'disabled' : ''}`}>
      <div className="betbar-left">
        <div className="my-stack">
          <div className="label">Của bạn</div>
          <div className="value">{stack} búng</div>
        </div>
        <div className="my-stack">
          <div className="label">Cần theo</div>
          <div className="value">{toCall} búng</div>
        </div>
        {seconds !== null && myTurn && (
          <div className="my-stack timer">
            <div className="label">Thời gian</div>
            <div className="value">{seconds}s</div>
          </div>
        )}
      </div>

      <div className="betbar-center">
        <div className="quick-chips">
          <button className="chip chip-bung" disabled={disabled} onClick={() => add(1)}>
            +1 Búng
          </button>
          <button className="chip chip-go" disabled={disabled} onClick={() => add(10)}>
            +10 Gõ
          </button>
          <button className="chip chip-dam" disabled={disabled} onClick={() => add(100)}>
            +100 Đấm
          </button>
          <button className="chip chip-reset" disabled={disabled} onClick={() => setAmount(0)}>
            ↺
          </button>
        </div>
        <div className="amount-row">
          <input
            type="number"
            min={0}
            value={amount}
            disabled={disabled}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          />
          <span className="unit">búng</span>
        </div>
      </div>

      <div className="betbar-right">
        <button
          className="btn btn-action fold"
          disabled={disabled}
          onClick={() => onAct('fold')}
        >
          Fold
        </button>
        {toCall === 0 ? (
          <button
            className="btn btn-action check"
            disabled={disabled}
            onClick={() => onAct('check')}
          >
            Check
          </button>
        ) : (
          <button
            className="btn btn-action call"
            disabled={disabled}
            onClick={() => onAct('call')}
          >
            Call {toCall}
          </button>
        )}
        {state.currentBet === 0 ? (
          <button
            className="btn btn-action bet"
            disabled={disabled || amount <= 0}
            onClick={() => onAct('bet', amount)}
          >
            Bet {amount}
          </button>
        ) : (
          <button
            className="btn btn-action raise"
            disabled={disabled || amount < minRaiseTotal}
            onClick={() => onAct('raise', amount)}
          >
            Raise → {amount}
          </button>
        )}
        <button
          className="btn btn-action allin"
          disabled={disabled}
          onClick={() => onAct('allin')}
        >
          All-in
        </button>
      </div>
    </div>
  );
}
