// The drawing recipe for JmwSpinner: an ordered list of moves, each stored as parameters.
// Pure functions, no DOM. Loaded as a classic script in the browser (window.JmwRecipe)
// and via require() in tests.
(function (root) {
  'use strict';

  // Each move type: a label, whether it has a mark count (so it drifts under the strobe)
  // and if so a plural noun for that count, its editable fields and their defaults.
  // Number fields have a slider range; a field with `options` is a choice instead, and a
  // `circleRef` field holds the id of a solid circle in the recipe (or null for none).
  const COUNT = { key: 'count', label: 'Count', min: 1, max: 72, step: 1, integer: true };
  const RADIUS = { key: 'radius', label: 'Radius', min: 0.05, max: 0.95, step: 0.01 };

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
      ],
      defaults: { count: 12, radius: 0.8, length: 0.1, width: 0.03 },
    },
    semicircles: {
      label: 'Ring of semicircles',
      noun: 'semicircles',
      counted: true,
      fields: [
        COUNT,
        { key: 'attach', label: 'Attach to', circleRef: true },
        {
          key: 'edge',
          label: 'Edge',
          options: [
            ['inner', 'inner edge'],
            ['outer', 'outer edge'],
          ],
        },
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
      ],
      defaults: { count: 13, attach: null, edge: 'inner', radius: 0.6, size: 0.05, width: 0.02, bulge: 'in' },
    },
  };

  let nextId = 1;

  function createMove(type, overrides = {}) {
    const spec = MOVE_TYPES[type];
    if (!spec) throw new Error(`Unknown move type: ${type}`);
    const move = { id: nextId++, type, ...spec.defaults };
    for (const [key, value] of Object.entries(overrides)) setField(move, key, value);
    return move;
  }

  // Set one field, keeping it valid: numbers are clamped to at least the field's minimum
  // (a count is also rounded), a choice must be one of its options, and a circle
  // reference is an id or null ('' from a form counts as null).
  function setField(move, key, value) {
    const field = MOVE_TYPES[move.type].fields.find((f) => f.key === key);
    if (!field) return false;
    if (field.circleRef) {
      const id = value === null || value === '' ? null : Number(value);
      if (id !== null && !Number.isInteger(id)) return false;
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
    move[key] = Math.max(field.min, v);
    return true;
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
    for (const m of recipe.moves) if (m.attach === id) m.attach = null;
    return true;
  }

  // The solid circle a move is attached to, or null if none (or it no longer exists).
  function attachedCircle(recipe, move) {
    if (move.attach == null) return null;
    return recipe.moves.find((m) => m.id === move.attach && m.type === 'circle') || null;
  }

  // The radius a move is actually drawn at. An attached move sits with its flat side on
  // the inner or outer edge of its circle's pen stroke, so it follows that circle.
  function effectiveRadius(recipe, move) {
    const circle = attachedCircle(recipe, move);
    if (!circle) return move.radius;
    const half = circle.width / 2;
    return move.edge === 'outer' ? circle.radius + half : Math.max(0, circle.radius - half);
  }

  // Whether a field has no effect for this move as it stands, so the form can grey it out.
  function fieldInactive(recipe, move, key) {
    const attached = attachedCircle(recipe, move) !== null;
    if (key === 'radius') return attached;
    if (key === 'edge') return !attached;
    return false;
  }

  // The recipe as drawn: copies of the moves with attachments worked out into radii.
  function resolve(recipe) {
    return { moves: recipe.moves.map((m) => ({ ...m, radius: effectiveRadius(recipe, m) })) };
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
    removeMove,
    shiftMove,
    attachedCircle,
    effectiveRadius,
    fieldInactive,
    resolve,
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
