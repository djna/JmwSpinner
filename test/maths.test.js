const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/maths.js');

const close = (actual, expected, tol = 1e-4) =>
  assert.ok(Math.abs(actual - expected) < tol, `expected ${expected}, got ${actual}`);

test('stepPerFlash converts rates to radians per flash', () => {
  close(M.stepPerFlash(1, 4), Math.PI / 2);
  close(M.stepPerFlash(2.5, 30), M.markSpacing(12));
});

test('a step of exactly one mark spacing looks stationary', () => {
  close(M.apparentStep(M.markSpacing(12), 12), 0);
  close(M.apparentStep(3 * M.markSpacing(12), 12), 0);
});

test('a step just short of a spacing appears to turn backwards', () => {
  const a = M.markSpacing(12);
  close(M.apparentStep(a - 0.01, 12), -0.01);
  close(M.apparentStep(a + 0.01, 12), 0.01);
});

test('worked example from the brief: 12 and 13 marks drift in opposite directions', () => {
  const s = Math.PI * (1 / 12 + 1 / 13);
  close(s, 0.5034);
  close(M.TAU / s, 12.48, 0.01);
  close(M.apparentStep(s, 12), -0.0201);
  close(M.apparentStep(s, 13), 0.0201);
});

test('aliasingRatio is 0 when stationary and 1 at half a spacing', () => {
  const a = M.markSpacing(8);
  close(M.aliasingRatio(a, 8), 0);
  close(M.aliasingRatio(a / 2 - 1e-9, 8), 1);
});

test('opposingStep matches the worked example and gives equal and opposite drift', () => {
  const s = M.opposingStep(12, 13);
  close(s, 0.5034);
  const d1 = M.apparentStep(s, 12);
  const d2 = M.apparentStep(s, 13);
  close(d1, -d2, 1e-12);
  assert.ok(d1 < 0 && d2 > 0);
});

test('opposingStep with m = 2 skips two spacings per flash', () => {
  const s = M.opposingStep(12, 13, 2, 2);
  close(M.apparentStep(s, 12), -M.apparentStep(s, 13), 1e-12);
  close(s, 2 * M.opposingStep(12, 13));
});

test('strobeRateFor and spinRateFor invert stepPerFlash', () => {
  const s = M.opposingStep(12, 13);
  close(M.strobeRateFor(s, 2.5), 31.2, 1e-9);
  close(M.spinRateFor(s, 31.2), 2.5, 1e-9);
  close(M.stepPerFlash(2.5, M.strobeRateFor(s, 2.5)), s, 1e-12);
});

test('flashesPerRev is the strobe rate over the spin rate', () => {
  close(M.flashesPerRev(2.5, 30), 12);
  close(M.flashesPerRev(2.42, 34.5), 14.26, 0.01);
});

test('driftFraction is count ÷ flashes per revolution less the nearest whole number', () => {
  close(M.driftFraction(12, 12), 0);
  close(M.driftFraction(12, 24), 0);
  close(M.driftFraction(12, 13), 1 / 12);
  close(M.driftFraction(12, 11), -1 / 12);
  close(M.driftFraction(12, 25), 1 / 12);
  close(M.driftFraction(12, 10), -1 / 6);
  // The readout example: 12 nibbles at 14.26 flashes per revolution drift back 4.75° of 30°.
  close(M.driftFraction(14.26, 12) * 30, -4.75, 0.01);
});

test('driftBand names how a drift reads', () => {
  assert.equal(M.driftBand(0), 'still');
  assert.equal(M.driftBand(-1 / 12), 'slow');
  assert.equal(M.driftBand(1 / 6), 'steady');
  assert.equal(M.driftBand(-0.25), 'fast');
  assert.equal(M.driftBand(0.35), 'unclear');
  assert.equal(M.driftBand(-0.5), 'ambiguous');
});

test('countGuide sorts counts by motion at 12 flashes per revolution', () => {
  const g = M.countGuide(12, 3, 30);
  assert.deepEqual(g.still, [12, 24]);
  assert.deepEqual(g.slow, { with: [13, 25], against: [11, 23] });
  assert.deepEqual(g.steady, { with: [14, 26], against: [10, 22] });
  assert.deepEqual(g.fast, { with: [3, 15, 27], against: [9, 21] });
  assert.deepEqual(g.unclear, [4, 8, 16, 20, 28]);
  assert.deepEqual(g.ambiguous, [5, 6, 7, 17, 18, 19, 29, 30]);
});

test('countFor turns an intent into a count', () => {
  assert.deepEqual([1, 2, 3].map((s) => M.countFor(1, 1, s, 12)), [13, 14, 15]);
  assert.deepEqual([1, 2, 3].map((s) => M.countFor(1, -1, s, 12)), [11, 10, 9]);
  assert.deepEqual([1, 2, 3].map((d) => M.countFor(d, 0, 1, 12)), [12, 24, 36]);
  assert.equal(M.countFor(2, 1, 1, 12), 25);
  assert.equal(M.countFor(3, -1, 2, 12), 34);
  assert.equal(M.countFor(1, 1, 1, 30 / 2.5000001), 13); // a hair under 12 still counts as 12
  assert.deepEqual([M.countFor(1, 1, 1, 12.5), M.countFor(1, -1, 1, 12.5)], [13, 12]);
  // Each moves its speed in twelfths of a spacing per flash, the way it says.
  close(M.driftFraction(12, M.countFor(2, -1, 3, 12)), -3 / 12);
});

test('countIntent reads a count back as an intent, or null', () => {
  assert.deepEqual(M.countIntent(10, 12), { density: 1, way: -1, speed: 2 });
  assert.deepEqual(M.countIntent(24, 12), { density: 2, way: 0, speed: 1 });
  assert.deepEqual(M.countIntent(37, 12), { density: 3, way: 1, speed: 1 });
  assert.equal(M.countIntent(18, 12), null);
  assert.equal(M.countIntent(5, 12), null);
  assert.deepEqual(M.nearestIntent(18, 12), { density: 2, way: -1, speed: 3 });
  assert.deepEqual(M.nearestIntent(5, 12), { density: 1, way: -1, speed: 3 });
});
