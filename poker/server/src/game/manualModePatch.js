// Manual-hand mode patch.
// Keeps the table in waiting state after a hand ends. Only the host's
// explicit start_hand socket action may begin the next hand.

export function disableAutoStart(PokerRoom) {
  PokerRoom.prototype._returnToWaiting = function _returnToWaitingManualOnly() {
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

    // Clean up players who disconnected during the hand.
    const dealerId = this.seatOrder[this.dealerIdx];
    for (const [id, p] of [...this.players.entries()]) {
      if (!p.connected) this.players.delete(id);
    }
    this.seatOrder = this.seatOrder.filter((id) => this.players.has(id));

    // Restore dealerIdx pointing at the same player if still present.
    this.dealerIdx = dealerId ? this.seatOrder.indexOf(dealerId) : -1;

    // Re-assign host if current host disconnected.
    if (!this.hostSocketId || !this.players.has(this.hostSocketId)) {
      this.hostSocketId = this.seatOrder[0] || null;
    }

    this.emit('state_sync', this.publicState());

    if (this.players.size === 0 && typeof this.onEmpty === 'function') {
      this.onEmpty();
    }
  };
}
