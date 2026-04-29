// Pot management with side pots for all-in players.
// Input: array of { id, totalContributed, folded } and winners list of ids for main pot.
// Returns: array of pots: [{ amount, eligibleIds }]. The caller evaluates each pot
// and awards to the best among eligible.
//
// Algorithm: sort contributors by totalContributed asc; peel off layers.

export function buildPots(contributions) {
  // contributions: [{ id, totalContributed, folded }]
  const pots = [];
  // Sort by contributed ascending, only those who contributed.
  const entries = contributions
    .filter((c) => c.totalContributed > 0)
    .map((c) => ({ ...c }))
    .sort((a, b) => a.totalContributed - b.totalContributed);

  while (entries.length > 0) {
    const minAmount = entries[0].totalContributed;
    if (minAmount === 0) {
      entries.shift();
      continue;
    }
    const potAmount = minAmount * entries.length;
    const eligibleIds = entries.filter((e) => !e.folded).map((e) => e.id);
    if (eligibleIds.length > 0) {
      pots.push({ amount: potAmount, eligibleIds });
    } else {
      // Everyone folded from this layer — merge into previous pot or create orphan.
      if (pots.length > 0) {
        pots[pots.length - 1].amount += potAmount;
      } else {
        pots.push({ amount: potAmount, eligibleIds: [] });
      }
    }
    for (const e of entries) e.totalContributed -= minAmount;
    while (entries.length > 0 && entries[0].totalContributed === 0) entries.shift();
  }
  return pots;
}

// Split an integer amount as evenly as possible among winner ids.
// Leftover chips go to the first winner(s) in `winnerIds` order.
export function splitAmount(amount, winnerIds) {
  const n = winnerIds.length;
  if (n === 0) return {};
  const base = Math.floor(amount / n);
  let remainder = amount - base * n;
  const out = {};
  for (const id of winnerIds) {
    out[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return out;
}
