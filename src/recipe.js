// The drawing recipe for JmwSpinner: an ordered list of moves, each stored as parameters.
// Pure functions, no DOM. Loaded as a classic script in the browser (window.JmwRecipe)
// and via require() in tests.
(function (root) {
  'use strict';

  const TAU = 2 * Math.PI;

  // Each move type: a label, whether it has a mark count (so it drifts under the strobe)
  // and if so a plural noun for that count, its editable fields and their defaults.
  // Number fields have a slider range; a field with `options` is a choice instead, and a
  // `ref` field holds the id of another move (a solid 'circle', or a counted 'ring'), or null.
  const COUNT = { key: 'count', label: 'Count', min: 1, max: 72, step: 1, integer: true };
  const RADIUS = { key: 'radius', label: 'Radius', min: 0.05, max: 0.95, step: 0.01 };
  const ATTACH = { key: 'attach', label: 'Attach to', ref: 'circle' };
  const EDGE = {
    key: 'edge',
    label: 'Edge',
    options: [
      ['inner', 'inner edge'],
      ['outer', 'outer edge'],
    ],
  };
  // Where a ring's shapes sit around the wheel: from the top, or from another ring's
  // positions, shifted by `offset` of this ring's own spacing (0.5 is halfway between).
  const ALIGN = { key: 'align', label: 'Align with', ref: 'ring' };
  const OFFSET = { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.05, signed: true };
  // Hand-drawn imperfection for moves drawn shape by shape (see wobbleOf). A solid circle
  // has none: the pen is held still while the wheel turns, so it comes out true.
  const WOBBLE = { key: 'wobble', label: 'Wobble', min: 0, max: 1, step: 0.05 };

  const MOVE_TYPES = {
    circle: {
      label: 'Solid circle',
      counted: false,
      fields: [RADIUS, { key: 'width', label: 'Pen width', min: 0.005, max: 0.3, step: 0.005 }],
      defaults: { radius: 0.9, width: 0.08 },
    },
    marks: {
      label: 'Ring of marks',
      noun: 'marks',
      counted: true,
      fields: [
        COUNT,
        RADIUS,
        { key: 'length', label: 'Length', min: 0.02, max: 0.3, step: 0.005 },
        { key: 'width', label: 'Pen width', min: 0.005, max: 0.1, step: 0.005 },
        ALIGN,
        OFFSET,
        WOBBLE,
      ],
      defaults: { count: 12, radius: 0.8, length: 0.1, width: 0.03, align: null, offset: 0, wobble: 0.3 },
      wobbly: true,
    },
    semicircles: {
      label: 'Ring of semicircles',
      noun: 'semicircles',
      counted: true,
      fields: [
        COUNT,
        ATTACH,
        EDGE,
        RADIUS,
        { key: 'size', label: 'Size', min: 0.01, max: 0.2, step: 0.005 },
        { key: 'width', label: 'Pen width', min: 0.005, max: 0.1, step: 0.005 },
        {
          key: 'bulge',
          label: 'Bulges',
          options: [
            ['in', 'towards the centre'],
            ['out', 'towards the rim'],
          ],
        },
        ALIGN,
        OFFSET,
        WOBBLE,
      ],
      defaults: {
        count: 13,
        attach: null,
        edge: 'inner',
        radius: 0.6,
        size: 0.05,
        width: 0.02,
        bulge: 'in',
        align: null,
        offset: 0,
        wobble: 0.3,
      },
      wobbly: true,
    },
    // Bites taken out of a solid circle's stroke, from its inner or outer edge. They draw
    // nothing themselves: the circle they are attached to is drawn with them cut away.
    nibbles: {
      label: 'Ring of nibbles',
      noun: 'nibbles',
      counted: true,
      fields: [
        COUNT,
        ATTACH,
        EDGE,
        {
          key: 'shape',
          label: 'Shape',
          options: [
            ['round', 'semicircular'],
            ['cog', 'cog (square notch)'],
          ],
        },
        { key: 'size', label: 'Width', min: 0.01, max: 0.3, step: 0.005 },
        { key: 'depth', label: 'Depth', min: 0.005, max: 0.3, step: 0.005 },
        ALIGN,
        OFFSET,
        WOBBLE,
      ],
      defaults: {
        count: 13,
        attach: null,
        edge: 'outer',
        shape: 'round',
        size: 0.06,
        depth: 0.04,
        align: null,
        offset: 0,
        wobble: 0.3,
        radius: 0.9, // only used while not attached to a circle
      },
      wobbly: true,
    },
    // Shapes at the ring's positions, stepping in radius from one to the next, so the still
    // wheel shows a coil and the strobe makes it move in or out. The pattern can run over
    // several turns, giving `count × turns` shapes (see steppedRadii).
    stepped: {
      label: 'Stepped ring',
      noun: 'positions',
      counted: true,
      fields: [
        COUNT,
        { key: 'turns', label: 'Turns', min: 1, max: 24, step: 1, integer: true },
        {
          key: 'pattern',
          label: 'Pattern',
          options: [
            ['loop', 'out and back'],
            ['out', 'out only'],
          ],
        },
        {
          key: 'climb',
          label: 'Climbs',
          options: [
            ['cw', 'clockwise'],
            ['acw', 'anticlockwise'],
          ],
        },
        // The inner radius can instead sit `gap` beyond the reach of another ring, and follow it.
        { key: 'from', label: 'Start beyond', ref: 'ring' },
        { key: 'gap', label: 'Gap', min: 0, max: 0.2, step: 0.005 },
        { key: 'inner', label: 'Inner radius', min: 0.05, max: 0.95, step: 0.01 },
        { key: 'outer', label: 'Outer radius', min: 0.05, max: 0.95, step: 0.01 },
        {
          key: 'shape',
          label: 'Shape',
          options: [
            ['dot', 'dots'],
            ['semicircle', 'semicircles'],
            ['mark', 'marks'],
          ],
        },
        { key: 'size', label: 'Size', min: 0.005, max: 0.15, step: 0.005 },
        { key: 'width', label: 'Pen width', min: 0.005, max: 0.1, step: 0.005 },
        {
          key: 'bulge',
          label: 'Bulges',
          options: [
            ['in', 'towards the centre'],
            ['out', 'towards the rim'],
          ],
        },
        ALIGN,
        OFFSET,
        // Shapes further out lag further behind (against the spin), by up to `trail` of a
        // spacing at the outer radius, as if thrown from the inner end.
        { key: 'trail', label: 'Trail', min: -3, max: 3, step: 0.05, signed: true },
        WOBBLE,
      ],
      defaults: {
        count: 13,
        turns: 1,
        pattern: 'loop',
        climb: 'cw',
        from: null,
        gap: 0.02,
        inner: 0.3,
        outer: 0.7,
        shape: 'dot',
        size: 0.03,
        width: 0.02,
        bulge: 'in',
        align: null,
        offset: 0,
        trail: 0,
        wobble: 0.3,
      },
      wobbly: true,
    },
  };

  let nextId = 1;

  function newSeed() {
    return Math.floor(Math.random() * 2 ** 31);
  }

  function createMove(type, overrides = {}) {
    const spec = MOVE_TYPES[type];
    if (!spec) throw new Error(`Unknown move type: ${type}`);
    const move = { id: nextId++, type, ...spec.defaults };
    if (spec.wobbly) move.seed = newSeed();
    for (const [key, value] of Object.entries(overrides)) setField(move, key, value);
    return move;
  }

  // Set one field, keeping it valid: numbers are clamped to at least the field's minimum
  // (a count is also rounded), a choice must be one of its options, and a reference is
  // another move's id or null ('' from a form counts as null).
  function setField(move, key, value) {
    const field = MOVE_TYPES[move.type].fields.find((f) => f.key === key);
    if (!field) return false;
    if (field.ref) {
      const id = value === null || value === '' ? null : Number(value);
      if (id !== null && (!Number.isInteger(id) || id === move.id)) return false;
      move[key] = id;
      return true;
    }
    if (field.options) {
      if (!field.options.some(([v]) => v === value)) return false;
      move[key] = value;
      return true;
    }
    let v = Number(value);
    if (!Number.isFinite(v)) return false;
    if (field.integer) v = Math.round(v);
    move[key] = field.signed ? v : Math.max(field.min, v);
    return true;
  }

  // A small seeded random generator (mulberry32), so a move's wobble is the same every redraw.
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // How the k-th shape of a wobbly move differs from a perfect one, as if drawn by hand.
  // Scaled by the move's `wobble` (0 is perfect): `angle` is a fraction of the spacing,
  // `radial` a fraction of the shape's size (a mark's length), `tilt` in radians, the rest
  // are multipliers. Marks use all but `squash`.
  function wobbleOf(move, k) {
    const w = move.wobble || 0;
    const random = seededRandom(Math.imul(move.seed || 0, 1000003) + k);
    const jitter = (amount) => (random() * 2 - 1) * w * amount;
    return {
      angle: jitter(0.12),
      radial: jitter(0.35),
      scale: 1 + jitter(0.3),
      squash: 1 + jitter(0.25),
      tilt: jitter(0.3),
      width: 1 + jitter(0.3),
    };
  }

  // Give a move a fresh set of imperfections.
  function rewobble(move) {
    move.seed = newSeed();
  }

  // Rebuild moves from saved data (e.g. a file), keeping their ids, seeds and any valid
  // fields. Unknown move types and fields are skipped; missing fields keep their defaults.
  // New moves made afterwards get ids above the loaded ones.
  function movesFromSaved(saved) {
    if (!Array.isArray(saved)) throw new Error('No list of moves found.');
    const moves = [];
    for (const data of saved) {
      if (!data || !MOVE_TYPES[data.type] || !Number.isInteger(data.id)) continue;
      const move = createMove(data.type);
      move.id = data.id;
      if (Number.isInteger(data.seed)) move.seed = data.seed;
      for (const field of MOVE_TYPES[data.type].fields) {
        if (field.key in data) setField(move, field.key, data[field.key]);
      }
      moves.push(move);
      nextId = Math.max(nextId, move.id + 1);
    }
    return moves;
  }

  // The starting recipe: a blank wheel, built up by adding moves.
  function defaultRecipe() {
    return { moves: [] };
  }

  function addMove(recipe, type) {
    return appendMove(recipe, createMove(type));
  }

  // Add a move made earlier with createMove (e.g. one configured before drawing).
  function appendMove(recipe, move) {
    recipe.moves.push(move);
    return move;
  }

  function removeMove(recipe, id) {
    const i = recipe.moves.findIndex((m) => m.id === id);
    if (i < 0) return false;
    recipe.moves.splice(i, 1);
    for (const m of recipe.moves) {
      if (m.attach === id) m.attach = null;
      if (m.align === id) m.align = null;
      if (m.from === id) m.from = null;
    }
    return true;
  }

  // The counted ring a move is aligned with, or null if none (or it no longer exists).
  function alignedRing(recipe, move) {
    if (move.align == null) return null;
    return recipe.moves.find((m) => m.id === move.align && MOVE_TYPES[m.type].counted) || null;
  }

  // The angle (radians, clockwise from the top) of a ring's first shape: its own offset,
  // added to the phase of the ring it is aligned with. A loop of alignments stops at the
  // first ring met twice.
  function phaseOf(recipe, move, seen = new Set()) {
    const own = ((move.offset || 0) * TAU) / move.count;
    const target = alignedRing(recipe, move);
    if (!target || seen.has(move.id)) return own;
    seen.add(move.id);
    return own + phaseOf(recipe, target, seen);
  }

  // The solid circle a move is attached to, or null if none (or it no longer exists).
  function attachedCircle(recipe, move) {
    if (move.attach == null) return null;
    return recipe.moves.find((m) => m.id === move.attach && m.type === 'circle') || null;
  }

  // The radius a move is actually drawn at. An attached move sits with its flat side on
  // the inner or outer edge of its circle's pen stroke, so it follows that circle.
  function effectiveRadius(recipe, move) {
    if (move.type === 'stepped') return (steppedInner(recipe, move) + move.outer) / 2; // its middle, for sorting
    const circle = attachedCircle(recipe, move);
    if (!circle) return move.radius;
    const half = circle.width / 2;
    return move.edge === 'outer' ? circle.radius + half : Math.max(0, circle.radius - half);
  }

  // The ring a stepped ring starts beyond, or null if none (or it no longer exists).
  function startRing(recipe, move) {
    if (move.from == null) return null;
    return recipe.moves.find((m) => m.id === move.from && MOVE_TYPES[m.type].counted) || null;
  }

  // How far out a ring's shapes reach from the centre.
  function ringReach(recipe, move, seen = new Set()) {
    const r = effectiveRadius(recipe, move);
    if (move.type === 'marks') return r + move.length / 2;
    if (move.type === 'semicircles') return r + (move.bulge === 'out' ? move.size : 0);
    if (move.type === 'stepped') {
      return Math.max(steppedInner(recipe, move, seen), move.outer) + move.size;
    }
    return r; // nibbles: the circle's edge
  }

  // A stepped ring's inner radius: its own, or `gap` beyond the reach of the ring it starts
  // from. A loop of rings starting from each other stops at the first ring met twice.
  function steppedInner(recipe, move, seen = new Set()) {
    const from = startRing(recipe, move);
    if (!from || seen.has(move.id)) return move.inner;
    seen.add(move.id);
    return ringReach(recipe, from, seen) + move.gap;
  }

  // The value a number field shows: where the move is really drawn, for fields that follow
  // another move (radius on an attached ring, inner radius on a stepped ring that starts
  // beyond another), otherwise the move's own value.
  function shownValue(recipe, move, key) {
    if (key === 'radius') return effectiveRadius(recipe, move);
    if (key === 'inner' && move.type === 'stepped') return steppedInner(recipe, move);
    return move[key];
  }

  // Whether a field has no effect for this move as it stands, so the form can grey it out.
  function fieldInactive(recipe, move, key) {
    const attached = attachedCircle(recipe, move) !== null;
    if (key === 'radius') return attached;
    if (key === 'edge') return !attached;
    if (move.type === 'stepped') {
      const starts = startRing(recipe, move) !== null;
      if (key === 'inner') return starts;
      if (key === 'gap') return !starts;
      if (key === 'width') return move.shape === 'dot';
      if (key === 'bulge') return move.shape !== 'semicircle';
    }
    return false;
  }

  // The radius of each shape in a stepped ring, in order round the wheel: `count × turns`
  // shapes climbing from inner to outer radius. Out only climbs all the way, then jumps
  // back (a seam). Out and back climbs for the first half and comes back for the second,
  // so the last shape leads smoothly into the first.
  function steppedRadii(move) {
    const total = move.count * move.turns;
    const climb = (u) => move.inner + (move.outer - move.inner) * u;
    const radii = [];
    for (let k = 0; k < total; k++) {
      if (move.pattern === 'out') radii.push(climb(total > 1 ? k / (total - 1) : 0));
      else radii.push(climb(k <= total / 2 ? (2 * k) / total : (2 * (total - k)) / total));
    }
    return radii;
  }

  // How a stepped ring reads under a strobe that turns the wheel `step` radians per flash.
  // Each flash, the wheel moves on about `skip` whole spacings, so at every position the
  // shape `skip` places back along the sequence takes over (or forward, if it climbs
  // anticlockwise). Returns 'in' or 'out' (a spiral), 'breathes' (out and back: half the
  // ring moves out and half in) or 'still' (no whole spacings skipped: no radial motion),
  // plus `strain`: how far the radius moves per flash compared with the gap between
  // neighbouring shapes (near 1 the eye may match a neighbour instead), `flashes`: how
  // many flashes a shape takes to travel from the inner radius to the outer one, at one
  // step along the sequence per skipped spacing, and `lag`: how much trail changes each
  // shape's apparent turn per flash on the way out (radians, clockwise positive), on top
  // of the ring's drift.
  function spiralReading(move, step) {
    const a = TAU / move.count;
    const skip = Math.round(step / a);
    const radii = steppedRadii(move);
    const rise = radii.length > 1 ? Math.abs(radii[1] - radii[0]) : 0;
    const gap = Math.max(1e-9, Math.min(move.inner, move.outer) * a);
    const strain = (Math.abs(skip) * rise) / gap;
    const outSteps = move.pattern === 'out' ? radii.length - 1 : radii.length / 2;
    const flashes = skip === 0 ? Infinity : outSteps / Math.abs(skip);
    // Trail sets shapes back by up to `trail` spacings over the climb: each step along the
    // sequence lags a further trail·a/outSteps, which the strobe turns into a slower (or,
    // climbing clockwise, faster) apparent turn.
    const turn = move.climb === 'cw' ? 1 : -1;
    const lag = outSteps > 0 ? (skip * turn * (move.trail || 0) * a) / outSteps : 0;
    if (skip === 0 || rise === 0) return { reading: 'still', skip, strain, flashes, lag: 0 };
    if (move.pattern === 'loop') return { reading: 'breathes', skip, strain, flashes, lag };
    const inward = skip * turn > 0;
    return { reading: inward ? 'in' : 'out', skip, strain, flashes, lag };
  }

  // The recipe as drawn: copies of the moves with attachments and alignments worked out
  // into radii and phases. Each circle also gets the list of nibble rings that cut it.
  function resolve(recipe) {
    const moves = recipe.moves.map((m) => {
      const copy = { ...m, radius: effectiveRadius(recipe, m) };
      if (m.type === 'stepped') copy.inner = steppedInner(recipe, m);
      if (MOVE_TYPES[m.type].counted) copy.phase = phaseOf(recipe, m);
      return copy;
    });
    for (const circle of moves) {
      if (circle.type !== 'circle') continue;
      circle.nibbles = moves.filter((m) => m.type === 'nibbles' && m.attach === circle.id);
    }
    return { moves };
  }

  // Move a move up (delta -1) or down (+1) the list. Later moves draw over earlier ones.
  function shiftMove(recipe, id, delta) {
    const i = recipe.moves.findIndex((m) => m.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= recipe.moves.length) return false;
    const [move] = recipe.moves.splice(i, 1);
    recipe.moves.splice(j, 0, move);
    return true;
  }

  // Moves with a mark count: the ones that drift under the strobe.
  function countedMoves(recipe) {
    return recipe.moves.filter((m) => MOVE_TYPES[m.type].counted);
  }

  // The pair of counted moves the solver uses by default: outermost and innermost.
  // Ties keep list order. Returns null with fewer than two counted moves.
  function defaultPair(recipe) {
    const counted = countedMoves(resolve(recipe));
    if (counted.length < 2) return null;
    let outer = counted[0];
    let inner = counted[1];
    if (inner.radius > outer.radius) [outer, inner] = [inner, outer];
    for (const m of counted.slice(2)) {
      if (m.radius > outer.radius) outer = m;
      else if (m.radius < inner.radius) inner = m;
    }
    return [outer.id, inner.id];
  }

  // Keep a chosen solver pair if both moves are still counted and distinct, else the default.
  function resolvePair(recipe, pair) {
    const ids = new Set(countedMoves(recipe).map((m) => m.id));
    if (pair && pair[0] !== pair[1] && ids.has(pair[0]) && ids.has(pair[1])) return pair;
    return defaultPair(recipe);
  }

  const api = {
    MOVE_TYPES,
    createMove,
    setField,
    defaultRecipe,
    addMove,
    appendMove,
    movesFromSaved,
    removeMove,
    shiftMove,
    attachedCircle,
    alignedRing,
    phaseOf,
    effectiveRadius,
    startRing,
    ringReach,
    steppedInner,
    shownValue,
    fieldInactive,
    steppedRadii,
    spiralReading,
    resolve,
    wobbleOf,
    rewobble,
    countedMoves,
    defaultPair,
    resolvePair,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.JmwRecipe = api;
  }
})(this);
