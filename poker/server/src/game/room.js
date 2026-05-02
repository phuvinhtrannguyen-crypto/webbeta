// Room & game state machine.
//
// Phases:
//   'waiting'        -> players can join, host can startHand
//   'preflop'        -> hole cards dealt, betting round
//   'c1'             -> 1st community card, betting round
//   'c2'             -> 2nd community card, betting round
//   'c3'             -> 3rd community card, betting round
//   'c4'             -> 4th community card, betting round
//   'river_intro'    -> shuffle/intro animation before 5th card (server waits)
//   'c5'             -> 5th community card, betting round (a.k.a. river)
//   'showdown'       -> reveal hands one by one, determine winner, award pot
//   'finished'       -> hand over, stays briefly before returning to 'waiting'
//
// Note: community cards are dealt one at a time per Vietnamese spec — every
// dealt community card is followed by a 15s betting round, not a 3+1+1
// flop/turn/river split.
//
// Public events emitted via an emit(event, payload) callback set externally.

import { createDeck, shuffle } from './deck.js';
import { evaluate7, determineWinners } from './evaluator.js';
import { buildPots, splitAmount } from './pot.js';

const BETTING_DURATION_MS = 15_000;
const RIVER_INTRO_DURATION_MS = 5_000;
const SHOWDOWN_REVEAL_INTERVAL_MS = 1_200;
const FINISHED_DURATION_MS = 8_000;

// Starting stack is configurable per-room (host picks when creating). The
// default is intentionally large so casual play feels effectively unlimited
// while still letting all-in/side-pot logic work normally.
const DEFAULT_STARTING_STACK = 1_000_000;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

export const ROOM_DEFAULTS = { startingStack: DEFAULT_STARTING_STACK };

export class PokerRoom {
  constructor({ id, hostSocketId, emit, clearTimer, scheduleTimer, onEmpty, startingStack }) {
    this.id = id;
    this.hostSocketId = hostSocketId;
    this.emit = emit;
    this.scheduleTimer = scheduleTimer; // (key, fn, ms) => void
    this.clearTimer = clearTimer; // (key) => void
    this.onEmpty = onEmpty || null; // callback when room becomes empty
    // Clamp to a sane positive integer (treat 0/negative/non-finite as default).
    const s = Number(startingStack);
    this.startingStack = Number.isFinite(s) && s >= BIG_BLIND ? Math.floor(s) : DEFAULT_STARTING_STACK;

    /** @type {Map<string, Player>} */
    this.players = new Map(); // socketId -> player
    this.seatOrder = []; // array of socketIds in seat order
    this.dealerIdx = -1;
    this.phase = 'waiting';
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.actingIdx = -1; // index into seatOrder
    this.handNumber = 0;
    this.lastWinners = null;
    this.chatLog = [];
    this.actionDeadline = 0;
  }

  // ---------- lifecycle ----------
  addPlayer(socketId, name) {
    if (this.players.size >= 20) throw new Error('Room is full (max 20)');
    if (this.players.has(socketId)) return this.players.get(socketId);
    // If a hand is currently in progress, the new player can't be dealt in
    // mid-hand — they sit out as 'queued' (will be auto-promoted to 'playing'
    // by the next startHand reset loop). Otherwise they're a normal waiter.
    const handActive = !['waiting', 'finished'].includes(this.phase);
    const player = {
      id: socketId,
      name: (name || 'Player').slice(0, 20),
      stack: this.startingStack,
      // queued | waiting | playing | folded | allin | winner | loser
      status: handActive ? 'queued' : 'waiting',
      hole: [], // [{rank, suit, code}]
      currentBet: 0, // bet within current round
      totalContributed: 0, // total this hand (for side pots)
      hasActedThisRound: false,
      connected: true,
      micOn: false,
    };
    this.players.set(socketId, player);
    this.seatOrder.push(socketId);
    if (!this.hostSocketId) this.hostSocketId = socketId;
    return player;
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (!p) return;

    const handActive =
      this.phase !== 'waiting' && this.phase !== 'finished';

    if (handActive) {
      // Hand in progress: KEEP the player in this.players and seatOrder so that
      // totalContributed is preserved for side pot calculation in _showdown().
      // Also keeps seatOrder indices (incl. actingIdx, dealerIdx) stable.
      // They'll be cleaned up in _returnToWaiting().
      p.connected = false;
      if (p.status === 'playing') p.status = 'folded';
      // All-in players stay 'allin' so buildPots still treats their contribution
      // as eligible for the side pot they paid into.

      // Transfer host if needed to the next connected player.
      if (socketId === this.hostSocketId) {
        const nextHost = this.seatOrder.find((id) => {
          const other = this.players.get(id);
          return other && other.connected && id !== socketId;
        });
        this.hostSocketId = nextHost || null;
      }

      // If it was this player's turn, advance. But don't interfere with the
      // staggered showdown reveal or the river intro animation — those own
      // their own timers and will complete naturally.
      if (this.phase !== 'showdown' && this.phase !== 'river_intro') {
        this.maybeAdvanceAfterPlayerGone(socketId);
      }
    } else {
      // Waiting / finished: safe to remove fully.
      const dealerId = this.seatOrder[this.dealerIdx];
      this.players.delete(socketId);
      this.seatOrder = this.seatOrder.filter((id) => id !== socketId);
      if (socketId === this.hostSocketId) {
        const nextHost = this.seatOrder.find((id) => {
          const other = this.players.get(id);
          return other && other.connected;
        });
        this.hostSocketId = nextHost || null;
      }
      // Keep dealerIdx pointing at the same player by id (indices shift after
      // filter). If the dealer was the one removed, reset to -1 so the next
      // startHand() advances from a clean state.
      this.dealerIdx = dealerId && dealerId !== socketId
        ? this.seatOrder.indexOf(dealerId)
        : -1;
    }
  }

  setMic(socketId, on) {
    const p = this.players.get(socketId);
    if (p) p.micOn = !!on;
  }

  pushChat(socketId, text) {
    const p = this.players.get(socketId);
    if (!p) return null;
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: p.name,
      fromId: socketId,
      text: String(text || '').slice(0, 300),
      at: Date.now(),
    };
    this.chatLog.push(msg);
    if (this.chatLog.length > 200) this.chatLog.shift();
    return msg;
  }

  // ---------- hand start ----------
  startHand(byId) {
    if (byId !== this.hostSocketId) throw new Error('Only host can start');
    if (this.players.size < 2) throw new Error('Need at least 2 players');
    if (this.phase !== 'waiting' && this.phase !== 'finished') {
      throw new Error('Hand already in progress');
    }
    // Clear stale timers from the previous hand's end-of-round sequence so a
    // host who starts a new hand during the 8s 'finished' window doesn't get
    // their hand torn down by the pending _returnToWaiting() callback.
    this.clearTimer(`finish:${this.id}`);
    this.clearTimer(`showdown:${this.id}`);
    this.clearTimer(`river:${this.id}`);
    this.clearTimer(`action:${this.id}`);

    // Purge players who disconnected during the previous hand. Normally
    // _returnToWaiting() would do this, but if the host starts a new hand
    // during the 'finished' window we cancelled that callback above — so we
    // run the same cleanup here, preserving dealerIdx by id.
    const prevDealerId = this.seatOrder[this.dealerIdx];
    for (const [id, p] of [...this.players.entries()]) {
      if (!p.connected) this.players.delete(id);
    }
    this.seatOrder = this.seatOrder.filter((id) => this.players.has(id));
    this.dealerIdx = prevDealerId && this.players.has(prevDealerId)
      ? this.seatOrder.indexOf(prevDealerId)
      : -1;
    if (this.hostSocketId && !this.players.has(this.hostSocketId)) {
      this.hostSocketId = this.seatOrder[0] || null;
    }
    if (this.players.size < 2) throw new Error('Need at least 2 players');

    // Remove broke players' capability: those with 0 stack sit out.
    const activeIds = this.seatOrder.filter((id) => {
      const p = this.players.get(id);
      return p && p.stack > 0;
    });
    if (activeIds.length < 2) throw new Error('Need at least 2 players with chips');

    this.handNumber += 1;
    this.deck = shuffle(createDeck());
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.lastWinners = null;

    // Reset player state.
    for (const p of this.players.values()) {
      p.hole = [];
      p.currentBet = 0;
      p.totalContributed = 0;
      p.hasActedThisRound = false;
      if (p.stack <= 0) p.status = 'waiting';
      else p.status = 'playing';
    }

    // Advance dealer button among active players.
    this.dealerIdx = (this.dealerIdx + 1) % this.seatOrder.length;
    while (this.players.get(this.seatOrder[this.dealerIdx]).stack <= 0) {
      this.dealerIdx = (this.dealerIdx + 1) % this.seatOrder.length;
    }

    // Blinds: small = dealer+1, big = dealer+2 among active. Heads-up: dealer posts SB.
    const active = activeIds;
    const dealerPos = active.indexOf(this.seatOrder[this.dealerIdx]);
    const sbId =
      active.length === 2 ? active[dealerPos] : active[(dealerPos + 1) % active.length];
    const bbId =
      active.length === 2
        ? active[(dealerPos + 1) % active.length]
        : active[(dealerPos + 2) % active.length];

    this._postBlind(sbId, SMALL_BLIND);
    this._postBlind(bbId, BIG_BLIND);
    this.currentBet = BIG_BLIND;
    this.minRaise = BIG_BLIND;

    // Deal hole cards: 2 each in seatOrder starting after dealer.
    for (let round = 0; round < 2; round++) {
      for (const id of active) {
        const p = this.players.get(id);
        p.hole.push(this.deck.shift());
      }
    }

    // First to act preflop: after BB (heads-up: SB = dealer acts first).
    const firstActor =
      active.length === 2
        ? active[dealerPos] // SB (dealer) acts first preflop heads-up
        : active[(dealerPos + 3) % active.length]; // UTG
    this.actingIdx = this.seatOrder.indexOf(firstActor);
    this.phase = 'preflop';

    this.emit('hand_started', this.publicState());
    this._emitPrivateHoles();
    this._startActionTimer();
  }

  _postBlind(id, amount) {
    const p = this.players.get(id);
    const actual = Math.min(amount, p.stack);
    p.stack -= actual;
    p.currentBet += actual;
    p.totalContributed += actual;
    this.pot += actual;
    if (p.stack === 0) p.status = 'allin';
  }

  // ---------- actions ----------
  playerAction(socketId, action, amount = 0) {
    if (!['preflop', 'c1', 'c2', 'c3', 'c4', 'c5'].includes(this.phase)) {
      throw new Error('Not a betting phase');
    }
    const actingId = this.seatOrder[this.actingIdx];
    if (actingId !== socketId) throw new Error('Not your turn');
    const p = this.players.get(socketId);
    if (!p || p.status !== 'playing') throw new Error('Cannot act');

    const toCall = this.currentBet - p.currentBet;
    switch (action) {
      case 'fold':
        p.status = 'folded';
        break;
      case 'check':
        if (toCall > 0) throw new Error('Cannot check, must call or fold');
        break;
      case 'call': {
        if (toCall <= 0) throw new Error('Nothing to call');
        const pay = Math.min(toCall, p.stack);
        p.stack -= pay;
        p.currentBet += pay;
        p.totalContributed += pay;
        this.pot += pay;
        if (p.stack === 0) p.status = 'allin';
        break;
      }
      case 'bet': {
        if (this.currentBet > 0) throw new Error('Use raise, there is already a bet');
        const bet = Math.floor(Number(amount) || 0);
        if (bet < BIG_BLIND) throw new Error(`Min bet is ${BIG_BLIND}`);
        if (bet > p.stack) throw new Error('Not enough chips');
        p.stack -= bet;
        p.currentBet += bet;
        p.totalContributed += bet;
        this.pot += bet;
        this.currentBet = p.currentBet;
        this.minRaise = bet;
        if (p.stack === 0) p.status = 'allin';
        // All others who had already acted now need to re-act.
        for (const other of this.players.values()) {
          if (other.id !== p.id && other.status === 'playing') other.hasActedThisRound = false;
        }
        break;
      }
      case 'raise': {
        if (this.currentBet === 0) throw new Error('Use bet, nothing to raise');
        const total = Math.floor(Number(amount) || 0); // total bet amount (not increment)
        const increment = total - this.currentBet;
        if (increment < this.minRaise) {
          throw new Error(`Min raise is ${this.minRaise} (total ${this.currentBet + this.minRaise})`);
        }
        const need = total - p.currentBet;
        if (need > p.stack) throw new Error('Not enough chips');
        p.stack -= need;
        p.currentBet += need;
        p.totalContributed += need;
        this.pot += need;
        this.minRaise = increment;
        this.currentBet = p.currentBet;
        if (p.stack === 0) p.status = 'allin';
        for (const other of this.players.values()) {
          if (other.id !== p.id && other.status === 'playing') other.hasActedThisRound = false;
        }
        break;
      }
      case 'allin': {
        if (p.stack <= 0) throw new Error('No chips');
        const shove = p.stack;
        p.stack = 0;
        p.currentBet += shove;
        p.totalContributed += shove;
        this.pot += shove;
        if (p.currentBet > this.currentBet) {
          const increment = p.currentBet - this.currentBet;
          if (increment >= this.minRaise) this.minRaise = increment;
          this.currentBet = p.currentBet;
          for (const other of this.players.values()) {
            if (other.id !== p.id && other.status === 'playing')
              other.hasActedThisRound = false;
          }
        }
        p.status = 'allin';
        break;
      }
      default:
        throw new Error('Unknown action');
    }
    p.hasActedThisRound = true;

    this.emit('action_taken', {
      playerId: socketId,
      action,
      amount,
      state: this.publicState(),
    });

    this._advanceAfterAction();
  }

  autoActCurrent(reason = 'timeout') {
    const id = this.seatOrder[this.actingIdx];
    const p = this.players.get(id);
    if (!p || p.status !== 'playing') {
      this._advanceAfterAction();
      return;
    }
    const toCall = this.currentBet - p.currentBet;
    const action = toCall > 0 ? 'fold' : 'check';
    try {
      this.playerAction(id, action);
    } catch {
      // ignore, force-advance
      this._advanceAfterAction();
    }
    this.emit('auto_action', { playerId: id, action, reason });
  }

  _advanceAfterAction() {
    // Check if only one player left unfolded -> award pot to them.
    const active = [...this.players.values()].filter(
      (p) => p.status === 'playing' || p.status === 'allin'
    );
    if (active.length === 1) {
      this._endHandUncontested(active[0].id);
      return;
    }
    // All remaining are allin? Skip to showdown by dealing remaining streets.
    const stillToAct = active.filter((p) => p.status === 'playing');
    if (stillToAct.length <= 1 && this._everyoneMatched()) {
      this._fastForwardToShowdown();
      return;
    }
    // If betting round complete, advance phase.
    if (this._bettingRoundComplete()) {
      this._advancePhase();
      return;
    }
    // Otherwise pass action.
    this._nextActor();
    this._startActionTimer();
  }

  _everyoneMatched() {
    const active = [...this.players.values()].filter(
      (p) => p.status === 'playing' || p.status === 'allin'
    );
    return active.every((p) => p.currentBet === this.currentBet || p.status === 'allin');
  }

  _bettingRoundComplete() {
    const active = [...this.players.values()].filter((p) => p.status === 'playing');
    if (active.length === 0) return true;
    return active.every((p) => p.hasActedThisRound && p.currentBet === this.currentBet);
  }

  _nextActor() {
    const n = this.seatOrder.length;
    for (let i = 1; i <= n; i++) {
      const idx = (this.actingIdx + i) % n;
      const p = this.players.get(this.seatOrder[idx]);
      if (p && p.status === 'playing') {
        this.actingIdx = idx;
        return;
      }
    }
    this.actingIdx = -1;
  }

  _advancePhase() {
    this.clearTimer(`action:${this.id}`);
    // Reset currentBet for next round
    for (const p of this.players.values()) {
      p.currentBet = 0;
      p.hasActedThisRound = false;
    }
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;

    if (this.phase === 'preflop') {
      this._dealCommunity(1);
      this.phase = 'c1';
    } else if (this.phase === 'c1') {
      this._dealCommunity(1);
      this.phase = 'c2';
    } else if (this.phase === 'c2') {
      this._dealCommunity(1);
      this.phase = 'c3';
    } else if (this.phase === 'c3') {
      this._dealCommunity(1);
      this.phase = 'c4';
    } else if (this.phase === 'c4') {
      // Special intro before final (5th) community card.
      this.phase = 'river_intro';
      this.emit('river_intro', { state: this.publicState() });
      this.scheduleTimer(
        `river:${this.id}`,
        () => {
          this._dealCommunity(1);
          this.phase = 'c5';
          this.emit('community_dealt', { cards: this.community, phase: this.phase });
          this._startRiverBetting();
        },
        RIVER_INTRO_DURATION_MS
      );
      return;
    } else if (this.phase === 'c5') {
      this._showdown();
      return;
    }

    // Set first actor for the new round = first active player after dealer.
    const n = this.seatOrder.length;
    const dealerId = this.seatOrder[this.dealerIdx];
    let startIdx = (this.seatOrder.indexOf(dealerId) + 1) % n;
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      const p = this.players.get(this.seatOrder[idx]);
      if (p && p.status === 'playing') {
        this.actingIdx = idx;
        break;
      }
    }
    this.emit('community_dealt', { cards: this.community, phase: this.phase });
    this._startActionTimer();
  }

  _startRiverBetting() {
    const n = this.seatOrder.length;
    const dealerId = this.seatOrder[this.dealerIdx];
    let startIdx = (this.seatOrder.indexOf(dealerId) + 1) % n;
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      const p = this.players.get(this.seatOrder[idx]);
      if (p && p.status === 'playing') {
        this.actingIdx = idx;
        break;
      }
    }
    // If nobody can act (all-in), skip straight to showdown.
    if (this.actingIdx === -1 || ![...this.players.values()].some((p) => p.status === 'playing')) {
      this._showdown();
      return;
    }
    this._startActionTimer();
  }

  _dealCommunity(n) {
    // We deal community cards one at a time per spec, so no burn card —
    // burning before every single community card would consume too much of
    // the 52-card deck when 20 players sit (40 hole cards already).
    for (let i = 0; i < n; i++) this.community.push(this.deck.shift());
  }

  _fastForwardToShowdown() {
    // Stop any pending betting-round timer so a late auto-action can't
    // re-enter this function during river_intro.
    this.clearTimer(`action:${this.id}`);
    // Deal remaining community cards quickly but still trigger river_intro before c5.
    const advanceMap = ['preflop', 'c1', 'c2', 'c3', 'c4'];
    while (advanceMap.includes(this.phase) && this.phase !== 'c4') {
      this._dealCommunity(1);
      const next = { preflop: 'c1', c1: 'c2', c2: 'c3', c3: 'c4' }[this.phase];
      this.phase = next;
      this.emit('community_dealt', { cards: this.community, phase: this.phase });
    }
    if (this.phase === 'c4') {
      this.phase = 'river_intro';
      this.emit('river_intro', { state: this.publicState() });
      this.scheduleTimer(
        `river:${this.id}`,
        () => {
          this._dealCommunity(1);
          this.phase = 'c5';
          this.emit('community_dealt', { cards: this.community, phase: this.phase });
          this._showdown();
        },
        RIVER_INTRO_DURATION_MS
      );
      return;
    }
    if (this.phase === 'river_intro') {
      // Already in intro — cancel pending timer and deal the final card ourselves
      // to avoid running showdown with only 4 community cards.
      this.clearTimer(`river:${this.id}`);
      if (this.community.length < 5) this._dealCommunity(5 - this.community.length);
      this.phase = 'c5';
      this.emit('community_dealt', { cards: this.community, phase: this.phase });
      this._showdown();
      return;
    }
    this._showdown();
  }

  _endHandUncontested(winnerId) {
    this.clearTimer(`action:${this.id}`);
    this.clearTimer(`river:${this.id}`);
    const winner = this.players.get(winnerId);
    winner.stack += this.pot;
    winner.status = 'winner';
    this.lastWinners = [{ id: winnerId, name: winner.name, amount: this.pot, handName: null }];
    const endedPot = this.pot;
    this.pot = 0;
    this.phase = 'finished';
    this.emit('hand_ended', {
      uncontested: true,
      winners: this.lastWinners,
      reveals: [],
      pot: endedPot,
      community: this.community,
      state: this.publicState(),
    });
    this.scheduleTimer(`finish:${this.id}`, () => this._returnToWaiting(), FINISHED_DURATION_MS);
  }

  _showdown() {
    this.clearTimer(`action:${this.id}`);
    this.clearTimer(`river:${this.id}`);
    this.phase = 'showdown';
    const contestants = [...this.players.values()].filter(
      (p) => p.status === 'playing' || p.status === 'allin'
    );
    // Evaluate each
    const evaluated = contestants.map((p) => {
      const score = evaluate7([...p.hole, ...this.community]);
      return { id: p.id, name: p.name, hole: p.hole, score };
    });

    // Emit showdown start so client can start flipping.
    this.emit('showdown_start', {
      community: this.community,
      reveals: evaluated.map((e) => ({
        id: e.id,
        name: e.name,
        hole: e.hole,
        handName: e.score.name,
      })),
      state: this.publicState(),
    });

    // Compute side pots + winners.
    const pots = buildPots(
      [...this.players.values()].map((p) => ({
        id: p.id,
        totalContributed: p.totalContributed,
        folded: p.status === 'folded',
      }))
    );

    const awards = {}; // id -> total awarded
    const winnersSummary = [];
    for (const pot of pots) {
      const eligibleEvals = evaluated.filter((e) => pot.eligibleIds.includes(e.id));
      if (eligibleEvals.length === 0) continue;
      const winnerIds = determineWinners(eligibleEvals);
      const split = splitAmount(pot.amount, winnerIds);
      for (const id of Object.keys(split)) {
        awards[id] = (awards[id] || 0) + split[id];
      }
      for (const wid of winnerIds) {
        const e = eligibleEvals.find((x) => x.id === wid);
        winnersSummary.push({
          id: wid,
          name: e.name,
          amount: split[wid],
          handName: e.score.name,
        });
      }
    }

    // Apply awards + set statuses.
    for (const p of this.players.values()) {
      // Preserve 'waiting' for spectators who sat out (e.g. zero-stack) and
      // 'queued' for players who joined mid-hand and never participated.
      if (p.status !== 'waiting' && p.status !== 'queued') p.status = 'loser';
    }
    for (const [id, amt] of Object.entries(awards)) {
      const p = this.players.get(id);
      if (p) {
        p.stack += amt;
        p.status = 'winner';
      }
    }
    this.lastWinners = winnersSummary;

    // After a staggered reveal, emit hand_ended.
    const revealDelay =
      evaluated.length * SHOWDOWN_REVEAL_INTERVAL_MS + 1200;
    this.scheduleTimer(
      `showdown:${this.id}`,
      () => {
        const endedPot = this.pot;
        this.pot = 0;
        this.phase = 'finished';
        this.emit('hand_ended', {
          uncontested: false,
          winners: winnersSummary,
          reveals: evaluated.map((e) => ({
            id: e.id,
            name: e.name,
            hole: e.hole,
            handName: e.score.name,
          })),
          pot: endedPot,
          community: this.community,
          state: this.publicState(),
        });
        this.scheduleTimer(`finish:${this.id}`, () => this._returnToWaiting(), FINISHED_DURATION_MS);
      },
      revealDelay
    );
  }

  _returnToWaiting() {
    this.phase = 'waiting';
    this.actingIdx = -1;
    this.currentBet = 0;
    for (const p of this.players.values()) {
      p.hole = [];
      p.currentBet = 0;
      p.totalContributed = 0;
      p.hasActedThisRound = false;
      p.status = 'waiting';
    }
    this.community = [];

    // Clean up players who disconnected during the hand (kept around for side pots).
    const dealerId = this.seatOrder[this.dealerIdx];
    for (const [id, p] of [...this.players.entries()]) {
      if (!p.connected) {
        this.players.delete(id);
      }
    }
    this.seatOrder = this.seatOrder.filter((id) => this.players.has(id));
    // Restore dealerIdx pointing at the same player (if still present) else reset.
    const newDealerIdx = dealerId ? this.seatOrder.indexOf(dealerId) : -1;
    this.dealerIdx = newDealerIdx;
    // Re-assign host if current host disconnected.
    if (!this.hostSocketId || !this.players.has(this.hostSocketId)) {
      this.hostSocketId = this.seatOrder[0] || null;
    }

    this.emit('state_sync', this.publicState());

    // If the purge emptied the room entirely (everyone disconnected during
    // the hand), notify the owner so the room can be dropped from memory.
    if (this.players.size === 0 && typeof this.onEmpty === 'function') {
      this.onEmpty();
      return;
    }

    // Auto-start the next hand so latecomers (status='queued') and anyone with
    // chips left don't sit idle waiting for the host to manually click. The
    // host can leave the room to stop. We require at least 2 connected
    // players with stack > 0; otherwise we stay in 'waiting' until either a
    // new player joins or someone gets chips back.
    const eligible = [...this.players.values()].filter(
      (p) => p.connected && p.stack > 0,
    );
    if (eligible.length >= 2 && this.hostSocketId) {
      try {
        this.startHand(this.hostSocketId);
      } catch (e) {
        // Defensive: if anything blocks the auto-start, stay in 'waiting' so
        // the host can re-trigger manually.
        // eslint-disable-next-line no-console
        console.warn('[room] auto-start failed', e.message);
      }
    }
  }

  maybeAdvanceAfterPlayerGone(disconnectedId) {
    // NOTE: we intentionally keep disconnected players in seatOrder during an
    // active hand (see removePlayer), so seatOrder indices — including
    // actingIdx and dealerIdx — remain valid. The disconnected seat is now
    // marked folded/allin, so _advanceAfterAction → _nextActor will skip it.
    if (this.actingIdx >= this.seatOrder.length) this.actingIdx = 0;

    // If a NON-acting player disconnected, the current actor is mid-decision
    // and shouldn't have their turn skipped by _nextActor. Only check for
    // game-ending early-exit conditions (everyone folded, or everyone all-in)
    // and let the action timer keep running for the current actor.
    const actingId = this.seatOrder[this.actingIdx];
    if (disconnectedId && disconnectedId !== actingId) {
      const active = [...this.players.values()].filter(
        (p) => p.status === 'playing' || p.status === 'allin',
      );
      if (active.length === 1) {
        this._endHandUncontested(active[0].id);
        return;
      }
      const stillToAct = active.filter((p) => p.status === 'playing');
      if (stillToAct.length <= 1 && this._everyoneMatched()) {
        this._fastForwardToShowdown();
        return;
      }
      // Otherwise, let the current actor keep their turn untouched.
      return;
    }

    this._advanceAfterAction();
  }

  _startActionTimer() {
    this.clearTimer(`action:${this.id}`);
    this.actionDeadline = Date.now() + BETTING_DURATION_MS;
    this.emit('state_sync', this.publicState());
    this.scheduleTimer(
      `action:${this.id}`,
      () => this.autoActCurrent('timeout'),
      BETTING_DURATION_MS
    );
  }

  _emitPrivateHoles() {
    for (const p of this.players.values()) {
      if (p.hole.length > 0) {
        this.emit('__private__', { to: p.id, event: 'your_hole', payload: { hole: p.hole } });
      }
    }
  }

  // Public serializable state (hides hole cards, deck).
  publicState() {
    return {
      roomId: this.id,
      hostId: this.hostSocketId,
      phase: this.phase,
      handNumber: this.handNumber,
      community: this.community,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerId: this.seatOrder[this.dealerIdx] || null,
      actingId: this.seatOrder[this.actingIdx] || null,
      actionDeadline: this.actionDeadline,
      startingStack: this.startingStack,
      lastWinners: this.lastWinners,
      players: this.seatOrder.map((id) => {
        const p = this.players.get(id);
        return {
          id: p.id,
          name: p.name,
          stack: p.stack,
          status: p.status,
          currentBet: p.currentBet,
          totalContributed: p.totalContributed,
          connected: p.connected,
          micOn: p.micOn,
          holeCount: p.hole.length,
        };
      }),
    };
  }
}
