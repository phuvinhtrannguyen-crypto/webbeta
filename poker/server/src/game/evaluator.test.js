import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate7, compareScores, determineWinners } from './evaluator.js';

function card(code) {
  const rankChar = code.slice(0, -1);
  const suit = code.slice(-1);
  const rank = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[rankChar] ?? Number(rankChar);
  return { rank, suit, code };
}

const cards = (s) => s.split(' ').map(card);

test('detects royal / straight flush', () => {
  const r = evaluate7(cards('Ah Kh Qh Jh Th 2c 3d'));
  assert.equal(r.category, 9);
  assert.equal(r.tiebreakers[0], 14);
});

test('detects wheel straight', () => {
  const r = evaluate7(cards('Ah 2d 3c 4s 5h 9c Kd'));
  assert.equal(r.category, 5);
  assert.equal(r.tiebreakers[0], 5);
});

test('four of a kind beats full house', () => {
  const a = evaluate7(cards('As Ah Ad Ac 2s 3d 4h'));
  const b = evaluate7(cards('Ks Kh Kd Qs Qh 2c 3d'));
  assert.equal(a.category, 8);
  assert.equal(b.category, 7);
  assert.ok(compareScores(a, b) > 0);
});

test('flush tiebreak by high card', () => {
  const a = evaluate7(cards('Ah Kh 9h 7h 2h 3c 4d'));
  const b = evaluate7(cards('Ah Qh 9h 7h 2h 3c 4d'));
  assert.ok(compareScores(a, b) > 0);
});

test('two pair tiebreak by kicker', () => {
  const a = evaluate7(cards('As Ah Ks Kh Qs 3d 2c'));
  const b = evaluate7(cards('As Ah Ks Kh Js 3d 2c'));
  assert.ok(compareScores(a, b) > 0);
});

test('determineWinners handles split pot', () => {
  const s1 = evaluate7(cards('Ah Kh Qh Jh Th 2c 3d'));
  const s2 = evaluate7(cards('Ad Kd Qd Jd Td 2h 3s'));
  const winners = determineWinners([
    { id: 'p1', score: s1 },
    { id: 'p2', score: s2 },
  ]);
  assert.deepEqual(winners.sort(), ['p1', 'p2']);
});

test('high card comparison', () => {
  const a = evaluate7(cards('Ah Kd 9c 7s 5h 3d 2c'));
  const b = evaluate7(cards('Ah Qd 9c 7s 5h 3d 2c'));
  assert.equal(a.category, 1);
  assert.ok(compareScores(a, b) > 0);
});
