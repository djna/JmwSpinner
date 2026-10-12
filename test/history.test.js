const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/history.js');

test('undo and redo step through committed states', () => {
  const h = H.createHistory('a');
  assert.equal(H.canUndo(h), false);
  H.commit(h, 'b');
  H.commit(h, 'c');
  assert.equal(H.undo(h), 'b');
  assert.equal(H.undo(h), 'a');
  assert.equal(H.undo(h), null);
  assert.equal(H.redo(h), 'b');
  assert.equal(H.redo(h), 'c');
  assert.equal(H.redo(h), null);
});

test('an unchanged state is not recorded', () => {
  const h = H.createHistory('a');
  assert.equal(H.commit(h, 'a'), false);
  assert.equal(H.canUndo(h), false);
});

test('a new change after undoing clears the redo steps', () => {
  const h = H.createHistory('a');
  H.commit(h, 'b');
  H.undo(h);
  assert.equal(H.canRedo(h), true);
  H.commit(h, 'x');
  assert.equal(H.canRedo(h), false);
  assert.equal(H.undo(h), 'a');
});

test('history keeps at most `limit` undo steps', () => {
  const h = H.createHistory(0, 3);
  for (let i = 1; i <= 5; i++) H.commit(h, i);
  assert.equal(h.past.length, 3);
  assert.equal(H.undo(h), 4);
  assert.equal(H.undo(h), 3);
  assert.equal(H.undo(h), 2);
  assert.equal(H.undo(h), null);
});
