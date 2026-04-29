// Texas Hold'em 7-card hand evaluator.
// Given 7 cards (2 hole + 5 community), returns the best 5-card hand + category.
//
// Categories (higher = better):
//   9 Straight flush
//   8 Four of a kind
//   7 Full house
//   6 Flush
//   5 Straight
//   4 Three of a kind
//   3 Two pair
//   2 One pair
//   1 High card
//
// Result: { category: number, name: string, tiebreakers: number[], cards: Card[] }
// Two results compare by (category, tiebreakers...) lexicographically.

const CATEGORY_NAMES = {
  9: 'Straight flush',
  8: 'Four of a kind',
  7: 'Full house',
  6: 'Flush',
  5: 'Straight',
  4: 'Three of a kind',
  3: 'Two pair',
  2: 'One pair',
  1: 'High card',
};

function combinations(arr, k) {
  const result = [];
  const combo = [];
  function helper(start) {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1);
      combo.pop();
    }
  }
  helper(0);
  return result;
}

// Evaluate 5 cards exactly; returns { category, tiebreakers: [...] }.
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a); // desc
  const suits = cards.map((c) => c.suit);

  const rankCount = new Map();
  for (const r of ranks) rankCount.set(r, (rankCount.get(r) || 0) + 1);

  // Group by count desc, then rank desc
  const groups = [...rankCount.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const isFlush = suits.every((s) => s === suits[0]);

  // Detect straight (including 5-4-3-2-A wheel)
  const uniqDesc = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniqDesc.length === 5) {
    if (uniqDesc[0] - uniqDesc[4] === 4) straightHigh = uniqDesc[0];
    else if (
      uniqDesc[0] === 14 &&
      uniqDesc[1] === 5 &&
      uniqDesc[2] === 4 &&
      uniqDesc[3] === 3 &&
      uniqDesc[4] === 2
    ) {
      straightHigh = 5; // wheel: A-2-3-4-5
    }
  }

  if (isFlush && straightHigh) {
    return { category: 9, tiebreakers: [straightHigh] };
  }

  // Four of a kind
  if (groups[0][1] === 4) {
    return { category: 8, tiebreakers: [groups[0][0], groups[1][0]] };
  }

  // Full house
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { category: 7, tiebreakers: [groups[0][0], groups[1][0]] };
  }

  // Flush
  if (isFlush) {
    return { category: 6, tiebreakers: ranks };
  }

  // Straight
  if (straightHigh) {
    return { category: 5, tiebreakers: [straightHigh] };
  }

  // Three of a kind
  if (groups[0][1] === 3) {
    const kickers = ranks.filter((r) => r !== groups[0][0]);
    return { category: 4, tiebreakers: [groups[0][0], ...kickers] };
  }

  // Two pair
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = ranks.find((r) => r !== highPair && r !== lowPair);
    return { category: 3, tiebreakers: [highPair, lowPair, kicker] };
  }

  // One pair
  if (groups[0][1] === 2) {
    const kickers = ranks.filter((r) => r !== groups[0][0]);
    return { category: 2, tiebreakers: [groups[0][0], ...kickers] };
  }

  // High card
  return { category: 1, tiebreakers: ranks };
}

// Evaluate the best 5-card hand out of 7.
export function evaluate7(cards) {
  if (cards.length < 5) {
    throw new Error('Need at least 5 cards to evaluate');
  }
  const combos = combinations(cards, 5);
  let best = null;
  let bestCards = null;
  for (const combo of combos) {
    const res = evaluate5(combo);
    if (!best || compareScores(res, best) > 0) {
      best = res;
      bestCards = combo;
    }
  }
  return {
    category: best.category,
    name: CATEGORY_NAMES[best.category],
    tiebreakers: best.tiebreakers,
    cards: bestCards,
  };
}

// Returns >0 if a better, <0 if b better, 0 tie.
export function compareScores(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreakers[i] ?? 0;
    const bv = b.tiebreakers[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Compare a list of evaluated players (each { id, score }).
// Returns array of winner ids (may be multiple on tie).
export function determineWinners(players) {
  if (players.length === 0) return [];
  let best = players[0];
  const winners = [best];
  for (let i = 1; i < players.length; i++) {
    const cmp = compareScores(players[i].score, best.score);
    if (cmp > 0) {
      best = players[i];
      winners.length = 0;
      winners.push(best);
    } else if (cmp === 0) {
      winners.push(players[i]);
    }
  }
  return winners.map((p) => p.id);
}
