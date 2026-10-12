const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/recipe.js');

const ids = (recipe) => recipe.moves.map((m) => m.id);

test('the default recipe is a blank wheel', () => {
  assert.deepEqual(R.defaultRecipe().moves, []);
});

// The two rings from the worked example in the brief.
function twoRings() {
  return {
    moves: [R.createMove('marks', { count: 12, radius: 0.8 }), R.createMove('marks', { count: 13, radius: 0.5 })],
  };
}

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
  const recipe = twoRings();
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
  const recipe = twoRings();
  const s = R.addMove(recipe, 'semicircles').id;
  const [a, b] = ids(recipe);
  assert.deepEqual(R.resolvePair(recipe, [s, a]), [s, a]);
  assert.deepEqual(R.resolvePair(recipe, [a, a]), [a, b]);
  R.removeMove(recipe, s);
  assert.deepEqual(R.resolvePair(recipe, [s, a]), [a, b]);
});

test('an attached semicircle ring sits on the inner or outer edge of its circle', () => {
  const recipe = twoRings();
  const circle = R.addMove(recipe, 'circle');
  R.setField(circle, 'radius', 0.8);
  R.setField(circle, 'width', 0.1);
  const semi = R.addMove(recipe, 'semicircles');
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

  close(R.effectiveRadius(recipe, semi), semi.radius); // not attached yet
  assert.equal(R.fieldInactive(recipe, semi, 'edge'), true);

  R.setField(semi, 'attach', String(circle.id)); // as a form would send it
  assert.equal(semi.attach, circle.id);
  close(R.effectiveRadius(recipe, semi), 0.75);
  R.setField(semi, 'edge', 'outer');
  close(R.effectiveRadius(recipe, semi), 0.85);
  assert.equal(R.fieldInactive(recipe, semi, 'radius'), true);

  R.setField(circle, 'radius', 0.5); // follows the circle
  close(R.resolve(recipe).moves.find((m) => m.id === semi.id).radius, 0.55);
  assert.equal(semi.radius, 0.6); // its own radius is kept for when it is detached
});

test('removing a circle detaches the moves attached to it', () => {
  const recipe = twoRings();
  const circle = R.addMove(recipe, 'circle');
  const semi = R.addMove(recipe, 'semicircles');
  R.setField(semi, 'attach', circle.id);
  R.removeMove(recipe, circle.id);
  assert.equal(semi.attach, null);
  assert.equal(R.effectiveRadius(recipe, semi), semi.radius);
  R.setField(semi, 'attach', '');
  assert.equal(semi.attach, null);
});

test('the default solver pair uses attached radii', () => {
  const recipe = { moves: [R.createMove('marks', { radius: 0.7 }), R.createMove('circle', { radius: 0.9 })] };
  const semi = R.createMove('semicircles', { radius: 0.2 });
  recipe.moves.push(semi);
  assert.deepEqual(R.defaultPair(recipe), [recipe.moves[0].id, semi.id]);
  R.setField(semi, 'attach', recipe.moves[1].id);
  assert.deepEqual(R.defaultPair(recipe), [semi.id, recipe.moves[0].id]);
});
