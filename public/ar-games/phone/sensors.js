(function(root, factory) {
  if (typeof module === 'object') module.exports = factory(require('./motion'));
  else root.ARGameSensors = factory(root.ARSensors);
})(globalThis, function(sensors) {
  'use strict';
  class SensorController extends sensors.SensorHub {
    constructor(options = {}) {
      const latest = new Map();
      const neutral = new Map();
      super({ ...options, onSample: (channel, sample, timestamp) => {
        latest.set(channel, structuredClone(sample));
        const reference = neutral.get(channel);
        if (channel === 'orientation' && reference) {
          const difference = angle => (sample[angle] - reference[angle] + 540) % 360 - 180;
          sample = { ...sample, relative: { alpha: difference('alpha'), beta: difference('beta'), gamma: difference('gamma') } };
        }
        options.onSample?.(channel, sample, timestamp);
      } });
      this.latest = latest;
      this.neutral = neutral;
    }
    calibrate(channel = 'orientation') {
      if (channel !== 'orientation' || !this.latest.has(channel)) return false;
      this.neutral.set(channel, structuredClone(this.latest.get(channel)));
      return true;
    }
    stop(channel) {
      super.stop(channel);
      if (channel) { this.latest.delete(channel); this.neutral.delete(channel); }
      else { this.latest.clear(); this.neutral.clear(); }
    }
  }
  return { SensorController };
});
