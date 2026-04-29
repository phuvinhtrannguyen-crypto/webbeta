export default function RiverIntro() {
  return (
    <div className="river-intro">
      <div className="shuffle-cards">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="shuffle-card" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="intro-text">
        <div className="intro-line">Trộn bài…</div>
        <div className="intro-line big">Lá cuối cùng sắp tới</div>
        <div className="intro-line">Ai sẽ ăn pot?</div>
      </div>
    </div>
  );
}
