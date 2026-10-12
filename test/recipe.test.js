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

test('a move configured before drawing can be appended', () => {
  const recipe = R.defaultRecipe();
  const move = R.createMove('semicircles');
  R.setField(move, 'count', 9);
  assert.equal(R.appendMove(recipe, move), move);
  assert.deepEqual(recipe.moves, [move]);
});

test('wobble is repeatable per move and shape, and zero wobble is perfect', () => {
  const move = R.createMove('semicircles');
  assert.equal(typeof move.seed, 'number');
  R.setField(move, 'wobble', 1);
  assert.deepEqual(R.wobbleOf(move, 3), R.wobbleOf(move, 3));
  assert.notDeepEqual(R.wobbleOf(move, 3), R.wobbleOf(move, 4));

  const j = R.wobbleOf(move, 5);
  assert.ok(Math.abs(j.angle) <= 0.12 && Math.abs(j.tilt) <= 0.3);
  assert.ok(j.scale >= 0.7 && j.scale <= 1.3);

  R.setField(move, 'wobble', 0);
  const perfect = Object.fromEntries(Object.entries(R.wobbleOf(move, 5)).map(([k, v]) => [k, v + 0])); // -0 to 0
  assert.deepEqual(perfect, { angle: 0, radial: 0, scale: 1, squash: 1, tilt: 0, width: 1 });
});

test('a new wobble changes the imperfections', () => {
  const move = R.createMove('semicircles');
  const before = R.wobbleOf(move, 0);
  move.seed = 1;
  R.rewobble(move);
  assert.notEqual(move.seed, 1);
  assert.notDeepEqual(R.wobbleOf(move, 0), before);
});

test('marks and semicircles can wobble, a solid circle cannot', () => {
  assert.equal(R.MOVE_TYPES.marks.wobbly, true);
  assert.equal(R.MOVE_TYPES.semicircles.wobbly, true);
  assert.ok(!R.MOVE_TYPES.circle.wobbly);
  assert.equal(typeof R.createMove('marks').seed, 'number');
  assert.equal(R.setField(R.createMove('circle'), 'wobble', 0.5), false);
});

test('offset shifts a ring by a fraction of its own spacing', () => {
  const recipe = R.defaultRecipe();
  const ring = R.addMove(recipe, 'semicircles'); // 13
  assert.equal(R.phaseOf(recipe, ring), 0);
  R.setField(ring, 'offset', 0.5);
  assert.ok(Math.abs(R.phaseOf(recipe, ring) - Math.PI / 13) < 1e-12);
  R.setField(ring, 'offset', -0.25); // either way
  assert.ok(Math.abs(R.phaseOf(recipe, ring) + Math.PI / 26) < 1e-12);
});

test('an aligned ring starts from the other ring, plus its own offset', () => {
  const recipe = R.defaultRecipe();
  const semis = R.addMove(recipe, 'semicircles');
  const nibbles = R.addMove(recipe, 'nibbles');
  R.setField(semis, 'offset', 0.2);
  R.setField(nibbles, 'align', String(semis.id));
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `expected ${b}, got ${a}`);
  close(R.phaseOf(recipe, nibbles), (0.2 * 2 * Math.PI) / 13);
  R.setField(nibbles, 'offset', 0.5);
  close(R.phaseOf(recipe, nibbles), (0.7 * 2 * Math.PI) / 13);

  assert.equal(R.setField(semis, 'align', semis.id), false); // not with itself
  R.setField(semis, 'align', nibbles.id); // a loop still gives an answer
  assert.ok(Number.isFinite(R.phaseOf(recipe, nibbles)));

  R.removeMove(recipe, semis.id);
  assert.equal(nibbles.align, null);
  close(R.phaseOf(recipe, nibbles), Math.PI / 13);
});

test('nibbles sit on an edge of their circle, and the circle carries them when resolved', () => {
  const recipe = R.defaultRecipe();
  const circle = R.addMove(recipe, 'circle'); // radius 0.9, width 0.08
  const inner = R.addMove(recipe, 'nibbles');
  const outer = R.addMove(recipe, 'nibbles');
  R.setField(inner, 'attach', circle.id);
  R.setField(inner, 'edge', 'inner');
  R.setField(outer, 'attach', circle.id);
  assert.ok(Math.abs(R.effectiveRadius(recipe, inner) - 0.86) < 1e-12);
  assert.ok(Math.abs(R.effectiveRadius(recipe, outer) - 0.94) < 1e-12);

  const drawn = R.resolve(recipe).moves.find((m) => m.id === circle.id);
  assert.deepEqual(drawn.nibbles.map((n) => n.id), [inner.id, outer.id]);
  assert.equal(drawn.nibbles[0].phase, 0);
  assert.equal(R.countedMoves(recipe).length, 2); // nibbles drift like any ring
});

test('nibbles cut their circle wherever they are in the recipe', () => {
  const recipe = R.defaultRecipe();
  const nib = R.addMove(recipe, 'nibbles');
  const circle = R.addMove(recipe, 'circle');
  R.setField(nib, 'attach', circle.id);
  assert.equal(R.resolve(recipe).moves[1].nibbles.length, 1);
});

const near = (actual, expected) =>
  assert.deepEqual(actual.map((x) => Math.round(x * 1e9) / 1e9), expected);

test('stepped radii: out only climbs then jumps back', () => {
  const move = R.createMove('stepped', { count: 5, pattern: 'out', inner: 0.2, outer: 0.6 });
  near(R.steppedRadii(move), [0.2, 0.3, 0.4, 0.5, 0.6]);
});

test('stepped radii: out and back over one turn goes out for half and back for half', () => {
  const move = R.createMove('stepped', { count: 4, pattern: 'loop', inner: 0.2, outer: 0.6 });
  near(R.steppedRadii(move), [0.2, 0.4, 0.6, 0.4]);
});

test('stepped radii: two turns give count × 2 shapes, a full turn out and a full turn back', () => {
  const move = R.createMove('stepped', { count: 4, turns: 2, pattern: 'loop', inner: 0.2, outer: 0.6 });
  near(R.steppedRadii(move), [0.2, 0.3, 0.4, 0.5, 0.6, 0.5, 0.4, 0.3]);
});

test('a stepped ring spirals in or out depending on the skip count and climb direction', () => {
  const move = R.createMove('stepped', { count: 12, pattern: 'out', climb: 'cw' });
  const a = (2 * Math.PI) / 12;
  assert.equal(R.spiralReading(move, a + 0.01).reading, 'in'); // one spacing on, drift with
  assert.equal(R.spiralReading(move, a - 0.01).reading, 'in'); // one spacing on, drift against
  assert.equal(R.spiralReading(move, 0.01).reading, 'still'); // no whole spacing skipped
  R.setField(move, 'climb', 'acw');
  assert.equal(R.spiralReading(move, a + 0.01).reading, 'out');
  assert.equal(R.spiralReading(move, -a).reading, 'in'); // wheel turning the other way
  R.setField(move, 'pattern', 'loop');
  assert.equal(R.spiralReading(move, a).reading, 'breathes');
});

test('the reading flags radial steps that are large next to the gap between shapes', () => {
  const gentle = R.createMove('stepped', { count: 12, inner: 0.4, outer: 0.5 });
  const steep = R.createMove('stepped', { count: 12, inner: 0.1, outer: 0.9 });
  const a = (2 * Math.PI) / 12;
  assert.ok(R.spiralReading(gentle, a).strain < 0.5);
  assert.ok(R.spiralReading(steep, a).strain > 0.75);
});

test('stepped ring fields that do not apply to the chosen shape are inactive', () => {
  const recipe = R.defaultRecipe();
  const move = R.addMove(recipe, 'stepped'); // dots
  assert.equal(R.fieldInactive(recipe, move, 'width'), true);
  assert.equal(R.fieldInactive(recipe, move, 'bulge'), true);
  R.setField(move, 'shape', 'semicircle');
  assert.equal(R.fieldInactive(recipe, move, 'width'), false);
  assert.equal(R.fieldInactive(recipe, move, 'bulge'), false);
});

test('a stepped ring can start just beyond another ring and follows it', () => {
  const recipe = R.defaultRecipe();
  const circle = R.addMove(recipe, 'circle'); // radius 0.9, width 0.08
  R.setField(circle, 'radius', 0.5);
  const semis = R.addMove(recipe, 'semicircles');
  R.setField(semis, 'attach', circle.id);
  R.setField(semis, 'edge', 'outer'); // flat side at 0.54
  R.setField(semis, 'bulge', 'out'); // reaching 0.54 + 0.05
  const dots = R.addMove(recipe, 'stepped');
  R.setField(dots, 'from', semis.id);
  R.setField(dots, 'gap', 0.01);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

  close(R.steppedInner(recipe, dots), 0.6);
  close(R.shownValue(recipe, dots, 'inner'), 0.6);
  assert.equal(R.fieldInactive(recipe, dots, 'inner'), true);
  assert.equal(R.fieldInactive(recipe, dots, 'gap'), false);
  close(R.resolve(recipe).moves.find((m) => m.id === dots.id).inner, 0.6);

  R.setField(circle, 'radius', 0.4); // the semicircles move, and the dots follow
  close(R.steppedInner(recipe, dots), 0.5);

  R.removeMove(recipe, semis.id);
  assert.equal(dots.from, null);
  close(R.steppedInner(recipe, dots), dots.inner);
});

test('trail and offset may be negative; a ring cannot start beyond itself', () => {
  const move = R.createMove('stepped');
  R.setField(move, 'trail', -0.4);
  assert.equal(move.trail, -0.4);
  assert.equal(R.setField(move, 'from', move.id), false);
});

test('flight length is one sequence step per flash per skipped spacing', () => {
  const a = (2 * Math.PI) / 13;
  const out = R.createMove('stepped', { count: 13, turns: 3, pattern: 'out' });
  assert.equal(R.spiralReading(out, a).flashes, 38); // 39 shapes, 38 steps out
  assert.equal(R.spiralReading(out, 2 * a).flashes, 19);
  const loop = R.createMove('stepped', { count: 13, turns: 2, pattern: 'loop' });
  assert.equal(R.spiralReading(loop, a).flashes, 13); // half of 26 each way
  assert.equal(R.spiralReading(out, 0.01).flashes, Infinity);
  R.setField(out, 'turns', 24);
  assert.equal(out.turns, 24);
});

test('trail slows the apparent turn of a shape climbing anticlockwise', () => {
  // Matches what the strobe view measured: 13 positions, 6 turns, out only, anticlockwise.
  const a = (2 * Math.PI) / 13;
  const move = R.createMove('stepped', { count: 13, turns: 6, pattern: 'out', climb: 'acw', trail: 1 });
  const { lag, flashes } = R.spiralReading(move, a + 0.05);
  assert.equal(flashes, 77);
  assert.ok(Math.abs(lag + a / 77) < 1e-12); // one spacing of lag spread over 77 steps
  R.setField(move, 'trail', 0);
  assert.ok(R.spiralReading(move, a + 0.05).lag === 0); // -0 is fine
});
