(function(root, factory) {if (typeof module === 'object') module.exports = factory(); else root.FightInput = factory();})(globalThis, () => {
  class State {
    constructor() {this.down = new Map(); this.light = 0; this.heavy = 0; this.jump = 0;}
    press(id, action) {
      if (this.down.has(id)) return;
      this.down.set(id, action);
      if (['light', 'heavy', 'jump'].includes(action)) this[action]++;
    }
    release(id) {this.down.delete(id);}
    clear(counters = false) {this.down.clear(); if (counters) this.light = this.heavy = this.jump = 0;}
    snapshot() {
      const values = [...this.down.values()];
      return {move: Number(values.includes('right')) - Number(values.includes('left')), block: values.includes('block'), crouch: values.includes('crouch'), light: this.light, heavy: this.heavy, jump: this.jump};
    }
  }
  return {State};
});
