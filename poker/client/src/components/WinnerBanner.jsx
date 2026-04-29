export default function WinnerBanner({ info }) {
  if (!info?.winners?.length) return null;
  return (
    <div className="winner-banner">
      <div className="banner-inner">
        <div className="trophy">🏆</div>
        <div className="winner-text">
          {info.winners.length === 1 ? (
            <>
              <b>{info.winners[0].name}</b> thắng{' '}
              <b>{info.winners[0].amount}</b> búng
              {info.winners[0].handName && !info.uncontested ? ` với ${info.winners[0].handName}` : ''}!
            </>
          ) : (
            <>
              Chia pot: {info.winners.map((w) => `${w.name} (+${w.amount})`).join(', ')}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
