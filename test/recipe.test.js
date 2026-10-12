const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/recipe.js');

const types = (recipe) => recipe.moves.map((m) => m.type);
const ids = (recipe) => recipe.moves.map((m) => m.id);

test('the default recipe is the 12 and 13 mark rings from the brief', () => {
  const recipe = R.defaultRecipe();
  assert.deepEqual(types(recipe), ['marks', 'marks']);
  assert.deepEqual(recipe.moves.map((m) => [m.count, m.radius]), [[12, 0.8], [13, 0.5]]);
});

test('every move type creates a move with its defaults and a unique id', () => {
  const made = Object.keys(R.MOVE_TYPES).map((type) => R.createMove(type));
  for (const move of made) {
    for (const [key, value] of Object.entries(R.MOVE_TYPES[move.type].defaults)) {
      assert.equal(move[key], value);
    }
  }
  assert.equal(new Set(made.map((m) => m.id)).size, made.length);
});

test('setField rounds counts, clamps to the minimum and checks choices', () => {
  const move = R.createMove('semicircles');
  R.setField(move, 'count', 7.6);
  assert.equal(move.count, 8);
  R.setField(move, 'count', -3);
  assert.equal(move.count, 1);
  assert.equal(R.setField(move, 'radius', 'abc'), false);
  assert.equal(R.setField(move, 'bulge', 'out'), true);
  assert.equal(move.bulge, 'out');
  assert.equal(R.setField(move, 'bulge', 'sideways'), false);
  assert.equal(move.bulge, 'out');
  assert.equal(R.setField(move, 'nonsense', 1), false);
});

test('values above the slider range are kept (the number box can exceed it)', () => {
  const move = R.createMove('marks');
  R.setField(move, 'count', 200);
  assert.equal(move.count, 200);
});

test('add, remove and reorder moves', () => {
  const recipe = R.defaultRecipe();
  const [a, b] = ids(recipe);
  const c = R.addMove(recipe, 'circle').id;
  assert.deepEqual(ids(recipe), [a, b, c]);

  assert.equal(R.shiftMove(recipe, c, -1), true);
  assert.deepEqual(ids(recipe), [a, c, b]);
  assert.equal(R.shiftMove(recipe, a, -1), false); // already first
  assert.equal(R.shiftMove(recipe, b, 1), false); // already last

  assert.equal(R.removeMove(recipe, a), true);
  assert.deepEqual(ids(recipe), [c, b]);
  assert.equal(R.removeMove(recipe, a), false);
});

test('only marks and semicircles are counted', () => {
  const recipe = { moves: [R.createMove('circle'), R.createMove('marks'), R.createMove('semicircles')] };
  assert.deepEqual(R.countedMoves(recipe).map((m) => m.type), ['marks', 'semicircles']);
});

test('the default solver pair is the outermost and innermost counted moves', () => {
  const recipe = {
    moves: [
      R.createMove('marks', { radius: 0.5 }),
      R.createMove('circle', { radius: 0.95 }),
      R.createMove('semicircles', { radius: 0.3 }),
      R.createMove('marks', { radius: 0.85 }),
    ],
  };
  const [, , s, m2] = ids(recipe);
  assert.deepEqual(R.defaultPair(recipe), [m2, s]);
  R.removeMove(recipe, m2);
  R.removeMove(recipe, s);
  assert.equal(R.defaultPair(recipe), null);
});

test('a chosen pair is kept while valid, and falls back to the default otherwise', () => {
  const recipe = R.defaultRecipe();
  const s = R.addMove(recipe, 'semicircles').id;
  const [a, b] = ids(recipe);
  assert.deepEqual(R.resolvePair(recipe, [s, a]), [s, a]);
  assert.deepEqual(R.resolvePair(recipe, [a, a]), [a, b]);
  R.removeMove(recipe, s);
  assert.deepEqual(R.resolvePair(recipe, [s, a]), [a, b]);
});
