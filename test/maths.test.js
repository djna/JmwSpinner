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
