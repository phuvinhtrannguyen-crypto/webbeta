// Deck creation & shuffle. Standard 52-card deck.
// Card format: { rank: 2..14, suit: 'c'|'d'|'h'|'s', code: 'As' | 'Td' etc. }
// Rank: 2..9 = numeric, T=10, J=11, Q=12, K=13, A=14.

export const SUITS = ['c', 'd', 'h', 's'];
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function rankToChar(rank) {
  if (rank <= 9) return String(rank);
  return { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank];
}

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, code: `${rankToChar(rank)}${suit}` });
    }
  }
  return deck;
}

// Fisher-Yates shuffle with crypto-strong randomness when available.
export function shuffle(deck, rng = Math.random) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function drawFromDeck(deck, n) {
  const drawn = deck.splice(0, n);
  return drawn;
}
