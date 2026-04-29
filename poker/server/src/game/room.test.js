import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PokerRoom } from './room.js';

// Minimal harness: capture events + schedule timers synchronously so we can
// drive state transitions directly from tests without real time.
function makeRoom(opts = {}) {
  const events = [];
  const scheduled = new Map();
  const emit = (event, payload) => events.push({ event, payload });
  const scheduleTimer = (key, fn, _ms) => {
    scheduled.set(key, fn);
  };
  const clearTimer = (key) => {
    scheduled.delete(key);
  };
  const room = new PokerRoom({
    id: 'TEST',
    hostSocketId: null,
    emit,
    scheduleTimer,
    clearTimer,
    onEmpty: opts.onEmpty,
  });
  return { room, events, scheduled };
}

test('disconnect during hand keeps contribution for side pot', () => {
  const { room } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.addPlayer('c', 'C');
  room.startHand('a');

  // After blinds (SB=5 BB=10 for non heads-up) + UTG action = 'a'.
  // A calls 10, B (SB) calls 10, C (BB) checks → flop.
  // Actually easier: just verify contributions are preserved when someone leaves.
  const actingBefore = room.seatOrder[room.actingIdx];
  // Let actingPlayer raise, then disconnect another one.
  const nonActing = ['a', 'b', 'c'].find((id) => id !== actingBefore);
  // Record their totalContributed (they already posted blind perhaps).
  const contribBefore = room.players.get(nonActing).totalContributed;

  room.removePlayer(nonActing);

  // Player should still be present with same totalContributed.
  assert.ok(room.players.has(nonActing), 'player kept in map during hand');
  assert.equal(room.players.get(nonActing).connected, false);
  assert.equal(
    room.players.get(nonActing).totalContributed,
    contribBefore,
    'contribution preserved for side pot'
  );
  assert.ok(room.seatOrder.includes(nonActing), 'seatOrder unchanged mid-hand');
});

test('disconnect in waiting phase fully removes player', () => {
  const { room } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.removePlayer('b');
  assert.ok(!room.players.has('b'));
  assert.ok(!room.seatOrder.includes('b'));
});

test('_endHandUncontested clears pending river timer', () => {
  const { room, scheduled } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.startHand('a');

  // Force phase to turn then trigger river_intro via _advancePhase.
  room.phase = 'turn';
  // Simulate betting completion on turn: reset everything and advance.
  for (const p of room.players.values()) {
    p.currentBet = 0;
    p.hasActedThisRound = true;
    p.status = 'playing';
  }
  room.currentBet = 0;
  room._advancePhase();
  assert.equal(room.phase, 'river_intro');
  assert.ok(scheduled.has(`river:${room.id}`), 'river timer was scheduled');

  // Simulate one of them leaving during river_intro → uncontested end.
  room.players.get('b').status = 'folded';
  room.players.get('b').connected = false;
  room._endHandUncontested('a');
  assert.ok(!scheduled.has(`river:${room.id}`), 'river timer cleared');
});

test('_fastForwardToShowdown during river_intro deals missing river card', () => {
  const { room, scheduled, events } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.startHand('a');

  // Move state forward manually to river_intro with 4 community cards.
  room.phase = 'turn';
  room.community = room.deck.splice(0, 4);
  room._advancePhase();
  assert.equal(room.phase, 'river_intro');
  assert.equal(room.community.length, 4);

  // Fast forward (simulates both players all-in scenario with intro pending).
  events.length = 0;
  room._fastForwardToShowdown();
  assert.equal(room.community.length, 5, 'river card dealt before showdown');
  assert.ok(!scheduled.has(`river:${room.id}`), 'intro timer cleared');
  // Showdown must have been entered.
  assert.equal(room.phase, 'showdown');
});

test('hand_ended event sees phase=finished for uncontested win', () => {
  const { room, events } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.startHand('a');
  // Fold everyone but A to force uncontested end.
  room.players.get('b').status = 'folded';
  events.length = 0;
  room._endHandUncontested('a');
  const ended = events.find((e) => e.event === 'hand_ended');
  assert.ok(ended, 'hand_ended emitted');
  assert.equal(ended.payload.state.phase, 'finished', 'phase is finished in hand_ended payload');
  assert.equal(room.phase, 'finished');
});

test('_fastForwardToShowdown clears pending action timer', () => {
  const { room, scheduled } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.addPlayer('c', 'C');
  room.startHand('a');
  // Simulate a pending action timer (startHand already scheduled one).
  assert.ok(scheduled.has(`action:${room.id}`), 'action timer pending');
  room.phase = 'turn';
  room.community = [1, 2, 3, 4].map((i) => ({ rank: i + 1, suit: 'H', code: `${i}H` }));
  room._fastForwardToShowdown();
  // Action timer must be cleared so it cannot fire during river_intro.
  assert.equal(scheduled.has(`action:${room.id}`), false);
  // River timer was scheduled instead.
  assert.ok(scheduled.has(`river:${room.id}`));
});

test('onEmpty fires when last disconnected player is purged', () => {
  let emptiedCount = 0;
  const { room } = makeRoom({ onEmpty: () => { emptiedCount += 1; } });
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.startHand('a');
  // Both disconnect mid-hand (they remain in the map for side-pot safety).
  room.removePlayer('a');
  room.removePlayer('b');
  assert.equal(emptiedCount, 0, 'room not emptied yet while hand is still "active"');
  // Trigger return-to-waiting, which purges disconnected players.
  room._returnToWaiting();
  assert.equal(room.players.size, 0);
  assert.equal(emptiedCount, 1, 'onEmpty invoked exactly once');
});

test('showdown preserves waiting-status spectators (no dead-ternary loser)', () => {
  const { room } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.addPlayer('c', 'C');
  // C sits out with 0 stack.
  room.players.get('c').stack = 0;
  room.startHand('a');
  // C should have been forced to 'waiting' by startHand.
  assert.equal(room.players.get('c').status, 'waiting');
  // Run showdown now (even with short-circuit community).
  room.community = [
    { rank: 2, suit: 'H', code: '2H' },
    { rank: 7, suit: 'C', code: '7C' },
    { rank: 10, suit: 'D', code: '10D' },
    { rank: 12, suit: 'S', code: '12S' },
    { rank: 5, suit: 'H', code: '5H' },
  ];
  room._showdown();
  assert.equal(room.players.get('c').status, 'waiting', 'spectator stays waiting, not loser');
});

test('waiting-phase removePlayer preserves dealer button by id', () => {
  const { room } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.addPlayer('c', 'C');
  room.addPlayer('d', 'D');
  room.dealerIdx = 2; // dealer is 'c'
  // Remove 'a' (before dealer). dealer should still be 'c'.
  room.removePlayer('a');
  assert.equal(room.seatOrder[room.dealerIdx], 'c');
  // Remove the dealer itself -> dealerIdx resets.
  room.removePlayer('c');
  assert.equal(room.dealerIdx, -1);
});

test('_returnToWaiting cleans up disconnected players', () => {
  const { room } = makeRoom();
  room.addPlayer('a', 'A');
  room.addPlayer('b', 'B');
  room.addPlayer('c', 'C');
  room.startHand('a');
  room.removePlayer('c');
  assert.ok(room.players.has('c'), 'c retained mid-hand');

  room._returnToWaiting();
  assert.ok(!room.players.has('c'), 'c removed on return to waiting');
  assert.ok(!room.seatOrder.includes('c'));
});
