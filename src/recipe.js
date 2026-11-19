// The drawing recipe for JmwSpinner: an ordered list of moves, each stored as parameters.
// Pure functions, no DOM. Loaded as a classic script in the browser (window.JmwRecipe)
// and via require() in tests.
(function (root) {
  'use strict';

  const TAU = 2 * Math.PI;

  // Each move type: a label, whether it has a mark count (so it drifts under the strobe)
  // and if so a plural noun for that count, its editable fields and their defaults.
  // Number fields have a slider range; a field with `options` is a choice instead (each
  // [value, text], or [value, text, short text]; `cycle` shows it as a button stepping
  // through them, beside its neighbours, rather than a list), and a
  // `ref` field holds the id of another move (a solid 'circle', or a counted 'ring'), or null.
  const COUNT = { key: 'count', label: 'Count', min: 1, max: 72, step: 1, integer: true };
  const RADIUS = { key: 'radius', label: 'Radius', min: 0.05, max: 0.95, step: 0.01 };
  const ATTACH = { key: 'attach', label: 'Attach to', ref: 'circle' };
  const EDGE = {
    key: 'edge',
    label: 'Edge',
    cycle: true,
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
  // The ink a move is drawn in, as #rrggbb. Nibbles have none: they cut ink away.
  const INK = '#1d1d24';
  const COLOUR = { key: 'colour', label: 'Colour', colour: true };

  const MOVE_TYPES = {
    circle: {
      label: 'Solid circle',
      counted: false,
      fields: [RADIUS, { key: 'width', label: 'Pen width', min: 0.005, max: 0.3, step: 0.005 }, COLOUR],
      defaults: { radius: 0.9, width: 0.08, colour: INK },
    },
    marks: {
      label: 'Ring of marks',
      noun: 'marks',
      counted: true,
      fields: [
        COUNT,
        {
          key: 'shape',
          label: 'Shape',
          cycle: true,
          options: [
            ['line', 'line'],
            ['freeform', 'freeform'],
          ],
        },
        // Freeform animation (see animationOf): the marks around the ring are the frames,
        // going from key A to key B and back, the cycle repeated around the ring.
        {
          key: 'motion',
          label: 'Motion',
          cycle: true,
          shown: (move) => move.shape === 'freeform',
          options: [
            ['none', 'none'],
            ['swing', 'back and forth', 'swing'],
          ],
        },
        {
          key: 'easing',
          label: 'Easing',
          cycle: true,
          shown: animated,
          options: [
            ['smooth', 'smooth: slows into each key', 'smooth'],
            ['even', 'even: the same change every frame', 'even'],
          ],
        },
        // How many times the cycle goes round the ring: a divisor of the count (see repeatsOf).
        { key: 'repeats', label: 'Repeats', cycle: true, divisors: true, integer: true, min: 1, shown: animated },
        // Freeform: layers drawn by hand (see cleanLayers), each with its own pen and its
        // strokes in key A and key B. Strokes are lists of [x, y] points in a square from
        // -1 to 1, with -y pointing away from the centre; Length is the square's side.
        { key: 'layers', label: 'Drawing', layers: true },
        RADIUS,
        { key: 'length', label: 'Length', min: 0.02, max: 0.3, step: 0.005 },
        // A line's pen; a freeform ring's layers each have their own, set on the pad.
        { key: 'width', label: 'Pen width', min: 0.005, max: 0.1, step: 0.005, shown: (move) => move.shape !== 'freeform' },
        ALIGN,
        OFFSET,
        { ...WOBBLE, shown: (move) => !animated(move) }, // animation takes its place
        { ...COLOUR, shown: (move) => move.shape !== 'freeform' },
      ],
      defaults: {
        count: 11,
        shape: 'line',
        motion: 'none',
        easing: 'smooth',
        repeats: 1,
        layers: [],
        radius: 0.8,
        length: 0.1,
        width: 0.03,
        align: null,
        offset: 0,
        wobble: 0.3,
        colour: INK,
      },
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
        COLOUR,
      ],
      defaults: {
        count: 13,
        attach: null,
        edge: 'outer',
        radius: 0.6,
        size: 0.05,
        width: 0.02,
        bulge: 'out',
        align: null,
        offset: 0,
        wobble: 0.3,
        colour: INK,
      },
      wobbly: true,
    },
    // Bites taken out of a solid circle's stroke, from its inner or outer edge. They draw
    // nothing themselves: the circle they are attached to is drawn with them cut away.
    nibbles: {
      label: 'Ring of nibbles',
      noun: 'nibbles',
      counted: true,
      needsCircle: true, // bites cut from a circle: nothing to see without one
      fields: [
        COUNT,
        ATTACH,
        EDGE,
        {
          key: 'shape',
          label: 'Shape',
          cycle: true,
          options: [
            ['round', 'semicircular'],
            ['cog', 'cog (square notch)', 'cog'],
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
    // any number of turns, whole or not, giving about `count × turns` shapes (see steppedTotal).
    stepped: {
      label: 'Stepped ring',
      noun: 'positions',
      counted: true,
      fields: [
        COUNT,
        { key: 'turns', label: 'Turns', min: 0.25, max: 24, step: 0.25 },
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
            ['bird', 'birds (outline)'],
            ['bat', 'bats (outline)'],
          ],
        },
        { key: 'size', label: 'Size', min: 0.005, max: 0.15, step: 0.005 },
        // Birds and bats: drawings per wingbeat. Neighbours in the sequence are drawn at
        // successive points of the beat, so under the strobe they flap (0: wings still).
        { key: 'flap', label: 'Flap', min: 0, max: 12, step: 1, integer: true },
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
        COLOUR,
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
        flap: 4,
        width: 0.02,
        bulge: 'in',
        align: null,
        offset: 0,
        trail: 0,
        wobble: 0.3,
        colour: INK,
      },
      wobbly: true,
    },
    // Triangular wings, base on an anchor and point outward. The first (at the top) points
    // straight out; each next one round the ring leans a further `spins` × 360°/count, by
    // default against the ring's direction (with 12, the one at 1 o'clock leans 30° left),
    // so under the strobe each wing seems to spin. Anchored to a ring, the wings sit at the
    // top of that ring's shapes and take its count and positions.
    wings: {
      label: 'Ring of wings',
      noun: 'wings',
      counted: true,
      fields: [
        { key: 'anchor', label: 'Anchor to', ref: 'ring' },
        { key: 'gap', label: 'Gap', min: 0, max: 0.2, step: 0.005 },
        COUNT,
        RADIUS,
        { key: 'length', label: 'Length', min: 0.01, max: 0.4, step: 0.005 },
        { key: 'base', label: 'Base width', min: 0.005, max: 0.2, step: 0.005 },
        {
          key: 'lean',
          label: 'Lean',
          options: [
            ['against', 'against the ring (1 o’clock leans left)'],
            ['with', 'with the ring (1 o’clock leans right)'],
          ],
        },
        { key: 'spins', label: 'Spins', min: 0, max: 6, step: 1, integer: true },
        {
          key: 'fill',
          label: 'Fill',
          options: [
            ['solid', 'filled'],
            ['outline', 'outline'],
          ],
        },
        { key: 'width', label: 'Pen width', min: 0.005, max: 0.1, step: 0.005 },
        ALIGN,
        OFFSET,
        WOBBLE,
        COLOUR,
      ],
      defaults: {
        anchor: null,
        gap: 0,
        count: 12,
        radius: 0.6,
        length: 0.12,
        base: 0.05,
        lean: 'against',
        spins: 1,
        fill: 'solid',
        width: 0.015,
        align: null,
        offset: 0,
        wobble: 0.2,
        colour: INK,
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
    if (field.nullable && (value === null || value === '')) {
      move[key] = null;
      return true;
    }
    if (field.ref) {
      const id = value === null || value === '' ? null : Number(value);
      if (id !== null && (!Number.isInteger(id) || id === move.id)) return false;
      move[key] = id;
      return true;
    }
    if (field.layers) {
      const layers = cleanLayers(value);
      if (layers === undefined) return false;
      move[key] = layers;
      return true;
    }
    if (field.colour) {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return false;
      move[key] = value.toLowerCase();
      return true;
    }
    if (field.options) {
      if (!field.options.some(([v]) => v === value)) return false;
      if (move.type === 'marks' && key === 'shape' && value === 'freeform' && !hasStrokes(move)) {
        // A drawing wants more room and a finer pen than a line.
        move.length = Math.max(move.length, 0.16);
        move.width = Math.min(move.width, 0.012);
      }
      move[key] = value;
      return true;
    }
    let v = Number(value);
    if (!Number.isFinite(v)) return false;
    if (field.integer) v = Math.round(v);
    move[key] = field.signed ? v : Math.max(field.min, v);
    return true;
  }

  // Whether a freeform ring has anything drawn, in any layer or key.
  function hasStrokes(move) {
    return (move.layers || []).some((layer) => layer.keys.length);
  }

  // Whether a ring of marks animates: freeform, moving back and forth, with something drawn.
  function animated(move) {
    return move.shape === 'freeform' && move.motion === 'swing' && hasStrokes(move);
  }

  // The repeats a ring's cycle can have: divisors of its count leaving at least 3 frames.
  function repeatChoices(count) {
    const choices = [];
    for (let d = 1; count / d >= 3; d++) if (count % d === 0) choices.push(d);
    return choices.length ? choices : [1];
  }

  // The repeats actually used: the largest choice not above the ring's own, so a count
  // changed since still gives a seamless loop.
  function repeatsOf(move) {
    const choices = repeatChoices(move.count);
    return choices.filter((d) => d <= (move.repeats || 1)).pop() || 1;
  }

  // Points spaced evenly along a stroke, `n` of them, from its start to its end.
  function resample(stroke, n) {
    const lengths = [0];
    for (let i = 1; i < stroke.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]));
    }
    const total = lengths[lengths.length - 1];
    const points = [];
    let i = 1;
    for (let p = 0; p < n; p++) {
      const at = (total * p) / (n - 1);
      while (i < stroke.length - 1 && lengths[i] < at) i++;
      const span = lengths[i] - lengths[i - 1];
      const f = span ? Math.min(1, Math.max(0, (at - lengths[i - 1]) / span)) : 0;
      const [ax, ay] = stroke[i - 1];
      const [bx, by] = stroke[i] || stroke[i - 1];
      points.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
    }
    return points;
  }

  // The first part of a stroke, a fraction `f` of its length (null for none).
  function partial(stroke, f) {
    if (f <= 0) return null;
    if (f >= 1) return stroke;
    const lengths = [0];
    for (let i = 1; i < stroke.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]));
    }
    const at = f * lengths[lengths.length - 1];
    const points = [stroke[0]];
    for (let i = 1; i < stroke.length; i++) {
      if (lengths[i] < at) {
        points.push(stroke[i]);
        continue;
      }
      const span = lengths[i] - lengths[i - 1];
      const g = span ? (at - lengths[i - 1]) / span : 0;
      const [ax, ay] = stroke[i - 1];
      points.push([ax + (stroke[i][0] - ax) * g, ay + (stroke[i][1] - ay) * g]);
      break;
    }
    return points;
  }

  // Two keys' strokes, paired in drawing order. A pair is resampled to matching points
  // spaced along its length (the second drawn the other way round is reversed) to
  // blend. A stroke only in the later key grows in, drawn on from where it starts; one
  // only in the earlier key shrinks away the same way.
  function pairStrokes(a, b) {
    a = a || [];
    b = b || [];
    const pairs = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      let [strokeA, strokeB] = [a[i], b[i]];
      if (!strokeB) {
        pairs.push({ shrink: strokeA });
        continue;
      }
      if (!strokeA) {
        pairs.push({ grow: strokeB });
        continue;
      }
      const [a0, a1] = [strokeA[0], strokeA[strokeA.length - 1]];
      const [b0, b1] = [strokeB[0], strokeB[strokeB.length - 1]];
      const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (dist(a0, b1) + dist(a1, b0) < dist(a0, b0) + dist(a1, b1)) strokeB = strokeB.slice().reverse();
      const n = Math.min(Math.max(strokeA.length, strokeB.length, 2) * 4, 120);
      pairs.push({ from: resample(strokeA, n), to: resample(strokeB, n) });
    }
    return pairs;
  }

  // The strokes of paired strokes `u` of the way from one key to the next.
  function blendPairs(pairs, u) {
    const strokes = [];
    for (const pair of pairs) {
      if (pair.grow) strokes.push(partial(pair.grow, u));
      else if (pair.shrink) strokes.push(partial(pair.shrink, 1 - u));
      else strokes.push(pair.from.map(([x, y], i) => [x + (pair.to[i][0] - x) * u, y + (pair.to[i][1] - y) * u]));
    }
    return strokes.filter(Boolean);
  }

  // Keys sit along the swing, `at` 0 at key A (the first frame) to 1 at key B (halfway
  // round the cycle), so they keep their place when the number of frames changes. Two
  // keys closer than KEY_GAP are the same key.
  const KEY_GAP = 1e-3;

  // Where the k-th of `frames` frames is along the swing: out to B and back again.
  function swingAt(k, frames) {
    const half = Math.floor(frames / 2);
    const f = ((k % frames) + frames) % frames;
    return f <= half ? f / half : (frames - f) / (frames - half);
  }

  // The frame (on the way out) nearest a place along the swing.
  function frameAt(at, frames) {
    return Math.round(at * Math.floor(frames / 2));
  }

  // A layer's keys, each with its pen worked out: a key's own width and colour, or else
  // the key before's (the first key's is the layer's).
  function keyPens(layer) {
    let pen = { width: layer.width, colour: layer.colour };
    return layer.keys.map((key, i) => {
      if (i > 0) pen = { width: key.width ?? pen.width, colour: key.colour ?? pen.colour };
      return pen;
    });
  }

  // A layer `at` a place along the swing, as strokes and a pen: from each key to the next,
  // eased (smooth slows into each key), held after the last key, and grown in from nothing
  // before the first.
  function layerAt(layer, at, easing = 'smooth') {
    const keys = layer.keys;
    const pens = keyPens(layer);
    if (!keys.length) return { strokes: [], width: layer.width, colour: layer.colour };
    const ease = (u) => (easing === 'even' ? u : (1 - Math.cos(Math.PI * u)) / 2);
    let i = -1;
    while (i + 1 < keys.length && keys[i + 1].at <= at + KEY_GAP) i++;
    if (i === keys.length - 1) return { strokes: keys[i].strokes, ...pens[i] };
    const [from, to] = i < 0 ? [{ at: 0, strokes: [] }, keys[0]] : [keys[i], keys[i + 1]];
    const [penFrom, penTo] = i < 0 ? [pens[0], pens[0]] : [pens[i], pens[i + 1]];
    const u = ease(to.at > from.at ? (at - from.at) / (to.at - from.at) : 1);
    return {
      strokes: blendPairs(pairStrokes(from.strokes, to.strokes), u),
      width: penFrom.width + (penTo.width - penFrom.width) * u,
      colour: mixColour(penFrom.colour, penTo.colour, u),
    };
  }

  // A ring of marks as an animation: `frames` in each cycle, and `layers(k)` the k-th
  // mark's drawing, as layers of strokes each with a pen (width and colour). Frame 0 is
  // key A and frame `keyB` (halfway) key B; `at(k)` is where frame k is along the swing.
  // Played forwards or backwards it looks the same, so it does not matter which
  // neighbour the strobe brings next. A ring that does not animate shows each layer's
  // first key at every mark.
  function animationOf(move) {
    const layers = move.layers || [];
    if (!animated(move)) {
      const still = layers.map((layer) => layerAt(layer, 0, 'even'));
      return { frames: 1, keyB: null, at: () => 0, layers: () => still };
    }
    const frames = move.count / repeatsOf(move);
    const at = (k) => swingAt(k, frames);
    const cache = new Map(); // mirrored frames are the same
    const layersAt = (k) => {
      const t = at(k);
      if (!cache.has(t)) cache.set(t, layers.map((layer) => layerAt(layer, t, move.easing)));
      return cache.get(t);
    };
    return { frames, keyB: Math.floor(frames / 2), at, layers: layersAt };
  }

  // A new layer, drawn with the given pen (e.g. the ring's, or the layer before's).
  function newLayer(pen) {
    return { width: pen.width, colour: pen.colour || INK, keys: [] };
  }

  // The index of a layer's key at a place along the swing, or -1.
  function keyIndex(layer, at) {
    return layer.keys.findIndex((key) => Math.abs(key.at - at) < KEY_GAP);
  }

  // A copy of a layer with its key at `at` given these strokes: added if new, removed if
  // there are none.
  function withKeyStrokes(layer, at, strokes) {
    const keys = layer.keys.filter((key) => Math.abs(key.at - at) >= KEY_GAP);
    const old = layer.keys[keyIndex(layer, at)];
    if (strokes && strokes.length) keys.push({ width: null, colour: null, ...old, at, strokes });
    keys.sort((a, b) => a.at - b.at);
    return { ...layer, keys };
  }

  // A copy of a layer with the pen of its key at `at` changed (`prop` 'width' or
  // 'colour'). The first key's pen is the layer's own; later keys follow the key before
  // until given their own.
  function withKeyPen(layer, at, prop, value) {
    const i = keyIndex(layer, at);
    if (i <= 0) return { ...layer, [prop]: value };
    const keys = layer.keys.map((key, j) => (j === i ? { ...key, [prop]: value } : key));
    return { ...layer, keys };
  }

  // A colour `u` of the way from #rrggbb `a` to `b`.
  function mixColour(a, b, u) {
    if (a === b) return a;
    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [ca, cb] = [channels(a), channels(b)];
    return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * u).toString(16).padStart(2, '0')).join('')}`;
  }

  // A freeform drawing, kept valid: a list of strokes, each of at least two [x, y] points
  // inside the square from -1 to 1, rounded to 3 places. Null (or no strokes) is no
  // drawing; anything else unreadable gives undefined.
  const MAX_STROKES = 60;
  const MAX_POINTS = 400;
  function cleanDrawing(value) {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) return undefined;
    const round = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 1000) / 1000;
    const strokes = [];
    for (const stroke of value.slice(0, MAX_STROKES)) {
      if (!Array.isArray(stroke)) return undefined;
      const points = [];
      for (const point of stroke.slice(0, MAX_POINTS)) {
        if (!Array.isArray(point) || !point.slice(0, 2).every(Number.isFinite) || point.length < 2) return undefined;
        points.push([round(point[0]), round(point[1])]);
      }
      if (points.length) strokes.push(points.length === 1 ? [points[0], points[0]] : points);
    }
    return strokes.length ? strokes : null;
  }

  // A freeform ring's layers, kept valid: up to MAX_LAYERS, each with its pen and up to
  // MAX_KEYS keys, each key a place along the swing (0 to 1), its strokes (see
  // cleanDrawing; a key with none is dropped) and its pen (null to follow the key
  // before's). Layers saved with key A and key B (before keys could go anywhere) become
  // keys at 0 and 1. Anything unreadable gives undefined.
  const MAX_LAYERS = 8;
  const MAX_KEYS = 24;
  function cleanLayers(value) {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) return undefined;
    const width = (w) => (Number.isFinite(w) ? Math.min(0.2, Math.max(0.002, w)) : null);
    const colour = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);
    const layers = [];
    for (const layer of value.slice(0, MAX_LAYERS)) {
      if (!layer || typeof layer !== 'object') return undefined;
      let saved = layer.keys;
      if (!Array.isArray(saved)) {
        saved = [
          { at: 0, strokes: layer.A },
          { at: 1, strokes: layer.B, width: layer.widthB, colour: layer.colourB },
        ];
      }
      const keys = [];
      for (const key of saved.slice(0, MAX_KEYS)) {
        if (!key || typeof key !== 'object' || !Number.isFinite(key.at)) return undefined;
        const strokes = cleanDrawing(key.strokes);
        if (strokes === undefined) return undefined;
        const at = Math.round(Math.min(1, Math.max(0, key.at)) * 1e4) / 1e4;
        if (!strokes || keys.some((k) => Math.abs(k.at - at) < KEY_GAP)) continue;
        keys.push({ at, strokes, width: width(key.width), colour: colour(key.colour) });
      }
      keys.sort((a, b) => a.at - b.at);
      layers.push({ width: width(layer.width) ?? 0.012, colour: colour(layer.colour) || INK, keys });
    }
    return layers;
  }

  // Fewer points for a stroke drawn by hand, keeping its shape to within `tolerance`
  // (Ramer-Douglas-Peucker).
  function simplifyStroke(points, tolerance = 0.01) {
    if (points.length < 3) return points.slice();
    const [ax, ay] = points[0];
    const [bx, by] = points[points.length - 1];
    const dx = bx - ax;
    const dy = by - ay;
    const span = Math.hypot(dx, dy);
    let far = 0;
    let at = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const [px, py] = points[i];
      const d = span ? Math.abs(dy * (px - ax) - dx * (py - ay)) / span : Math.hypot(px - ax, py - ay);
      if (d > far) [far, at] = [d, i];
    }
    if (far <= tolerance) return [points[0], points[points.length - 1]];
    const left = simplifyStroke(points.slice(0, at + 1), tolerance);
    return [...left.slice(0, -1), ...simplifyStroke(points.slice(at), tolerance)];
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
      if (data.type === 'marks' && !('layers' in data) && (data.drawing || data.keyB)) {
        // Saved before layers: one drawing (and key B), in the ring's pen (and key B's).
        const { drawing: A, keyB: B, width, colour, widthB, colourB } = data;
        setField(move, 'layers', [{ A, B, width, colour, widthB, colourB }]);
      }
      moves.push(move);
      nextId = Math.max(nextId, move.id + 1);
    }
    // Moves that need a circle but have none (from files saved before that was required) go
    // on the latest circle drawn before them (else the first after), or are dropped if there
    // is no circle at all.
    for (const move of moves.filter((m) => MOVE_TYPES[m.type].needsCircle)) {
      const circles = moves.filter((m) => m.type === 'circle');
      if (circles.some((c) => c.id === move.attach)) continue;
      const at = moves.indexOf(move);
      const before = circles.filter((c) => moves.indexOf(c) < at);
      const circle = before.length ? before[before.length - 1] : circles[0];
      if (circle) move.attach = circle.id;
      else removeMove({ moves }, move.id);
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

  // Remove a move. Moves that refer to it let go, except those that need a circle (nibbles),
  // which go with their circle.
  function removeMove(recipe, id) {
    const i = recipe.moves.findIndex((m) => m.id === id);
    if (i < 0) return false;
    recipe.moves.splice(i, 1);
    for (const m of recipe.moves.filter((n) => n.attach === id && MOVE_TYPES[n.type].needsCircle)) {
      removeMove(recipe, m.id);
    }
    for (const m of recipe.moves) {
      if (m.attach === id) m.attach = null;
      if (m.align === id) m.align = null;
      if (m.from === id) m.from = null;
      if (m.anchor === id) m.anchor = null;
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
    const anchor = anchorRing(recipe, move);
    if (anchor && !seen.has(move.id)) {
      seen.add(move.id);
      return phaseOf(recipe, anchor, seen); // anchored wings sit exactly on their anchor's shapes
    }
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
    if (move.type === 'wings') return wingsRadius(recipe, move);
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

  // The ring a ring of wings is anchored to, or null if none (or it no longer exists).
  function anchorRing(recipe, move) {
    if (move.type !== 'wings' || move.anchor == null) return null;
    return recipe.moves.find((m) => m.id === move.anchor && m.id !== move.id && MOVE_TYPES[m.type].counted) || null;
  }

  // Anchored wings take their anchor's count. Called before each redraw, so everything
  // that reads `count` (drift, solver, readout) sees the anchored value.
  function syncAnchors(recipe) {
    for (let pass = 0; pass < recipe.moves.length; pass++) {
      let changed = false;
      for (const move of recipe.moves) {
        const anchor = anchorRing(recipe, move);
        if (anchor && move.count !== anchor.count) {
          move.count = anchor.count;
          changed = true;
        }
      }
      if (!changed) break; // chains of wings on wings settle in a few passes
    }
  }

  // How far out a ring's shapes reach from the centre.
  function ringReach(recipe, move, seen = new Set()) {
    if (move.type === 'wings') return wingsRadius(recipe, move, seen) + move.length;
    const r = effectiveRadius(recipe, move);
    if (move.type === 'marks') return r + move.length / 2;
    if (move.type === 'semicircles') return r + (move.bulge === 'out' ? move.size : 0);
    if (move.type === 'stepped') {
      return Math.max(steppedInner(recipe, move, seen), move.outer) + move.size;
    }
    return r; // nibbles: the circle's edge
  }

  // Where a ring of wings has its bases: its own radius, or `gap` beyond the reach of its
  // anchor ring (the top of each semicircle). A loop of anchors stops at the first met twice.
  function wingsRadius(recipe, move, seen = new Set()) {
    const anchor = anchorRing(recipe, move);
    if (!anchor || seen.has(move.id)) return move.radius;
    seen.add(move.id);
    return ringReach(recipe, anchor, seen) + move.gap;
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
    if (move.type === 'wings') {
      const anchored = anchorRing(recipe, move) !== null;
      if (['count', 'radius', 'align', 'offset'].includes(key)) return anchored;
      if (key === 'gap') return !anchored;
      if (key === 'width') return move.fill === 'solid';
      return false;
    }
    const attached = attachedCircle(recipe, move) !== null;
    if (key === 'radius') return attached;
    if (key === 'edge') return !attached;
    if (key === 'layers') return move.shape !== 'freeform';
    if (move.type === 'stepped') {
      const starts = startRing(recipe, move) !== null;
      if (key === 'inner') return starts;
      if (key === 'gap') return !starts;
      if (key === 'width') return move.shape === 'dot';
      if (key === 'bulge') return move.shape !== 'semicircle';
      if (key === 'flap') return move.shape !== 'bird' && move.shape !== 'bat';
    }
    return false;
  }

  // How many shapes a stepped ring has: one per position for each turn, rounded, so turns
  // need not be whole (1.25 turns of 16 positions is 20 shapes, the last 4 sharing a
  // position with the first 4, further out).
  function steppedTotal(move) {
    return Math.max(1, Math.round(move.count * move.turns));
  }

  // The radius of each shape in a stepped ring, in order round the wheel: steppedTotal
  // shapes climbing from inner to outer radius. Out only climbs all the way, then jumps
  // back (a seam). Out and back climbs for the first half and comes back for the second,
  // so over whole turns the last shape leads smoothly into the first.
  function steppedRadii(move) {
    const total = steppedTotal(move);
    const climb = (u) => move.inner + (move.outer - move.inner) * u;
    const radii = [];
    for (let k = 0; k < total; k++) {
      if (move.pattern === 'out') radii.push(climb(total > 1 ? k / (total - 1) : 0));
      else radii.push(climb(k <= total / 2 ? (2 * k) / total : (2 * (total - k)) / total));
    }
    return radii;
  }

  // Where the k-th bird or bat is in its wingbeat, from 1 (wings up) to -1 (wings down).
  // With no flap, all are drawn part way up.
  function flapOf(move, k) {
    if (!move.flap) return 0.5;
    return Math.cos((TAU * k) / move.flap);
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

  // The turns that make a stepped ring's flight (inner to outer radius) last about `flashes`
  // flashes at `step` per flash: the inverse of spiralReading's flashes, rounded to a whole
  // number of shapes. Null when the wheel skips no whole spacings, so nothing flies.
  function turnsForFlight(move, step, flashes) {
    const skip = Math.round(step / (TAU / move.count));
    if (skip === 0 || !(flashes > 0)) return null;
    const outSteps = flashes * Math.abs(skip);
    const total = Math.max(2, Math.round(move.pattern === 'out' ? outSteps + 1 : 2 * outSteps));
    return total / move.count;
  }

  // The recipe as drawn: copies of the moves with attachments and alignments worked out
  // into radii and phases. Each circle also gets the list of nibble rings that cut it.
  function resolve(recipe) {
    const moves = recipe.moves.map((m) => {
      const copy = { ...m, radius: effectiveRadius(recipe, m) };
      if (m.type === 'stepped') copy.inner = steppedInner(recipe, m);
      const anchor = anchorRing(recipe, m);
      if (anchor) copy.anchorWobble = { seed: anchor.seed, wobble: anchor.wobble }; // follow its shapes
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
  // Nibbles are part of their circle (their place in the list doesn't matter, since they are
  // drawn as holes in it), so a move steps past them to the next move proper.
  function shiftMove(recipe, id, delta) {
    const i = recipe.moves.findIndex((m) => m.id === id);
    let j = i + delta;
    while (j >= 0 && j < recipe.moves.length && isPart(recipe.moves[j])) j += delta;
    if (i < 0 || j < 0 || j >= recipe.moves.length) return false;
    const [move] = recipe.moves.splice(i, 1);
    recipe.moves.splice(j, 0, move);
    return true;
  }

  // A move that is part of its circle (nibbles) rather than a move of its own.
  function isPart(move) {
    return Boolean(MOVE_TYPES[move.type].needsCircle);
  }

  // Up to this many sets of nibbles per circle, one for each slot: an edge and a way of
  // turning. Sets on the same circle can seem to turn different ways.
  const MAX_NIBBLE_SETS = 4;
  const NIBBLE_SLOTS = [
    ['outer', 1],
    ['inner', 1],
    ['outer', -1],
    ['inner', -1],
  ];

  function nibblesOf(recipe, circle) {
    return recipe.moves.filter((m) => isPart(m) && m.attach === circle.id);
  }

  // Which way a ring of `count` seems to turn at `perRev` flashes per revolution: 1 with the
  // wheel (clockwise), -1 against it, 0 still.
  function turnWay(count, perRev) {
    const step = TAU / perRev;
    const a = TAU / count;
    const d = step - a * Math.round(step / a);
    return Math.abs(d) < 1e-9 ? 0 : Math.sign(d);
  }

  // Add a set of nibbles to a circle, listed after its other sets (or the circle). It takes
  // the first slot in the order outer clockwise, inner clockwise, outer anticlockwise, inner
  // anticlockwise that no set fills at `perRev` flashes per revolution, with a count that
  // drifts slowly that way (13 or 11 at 12). Null when the circle already has the most sets.
  function addNibbles(recipe, circle, perRev = 12) {
    const sets = nibblesOf(recipe, circle);
    if (sets.length >= MAX_NIBBLE_SETS) return null;
    const filled = (edge, way) => sets.some((m) => m.edge === edge && turnWay(m.count, perRev) === way);
    const [edge, way] = NIBBLE_SLOTS.find(([e, w]) => !filled(e, w)) || NIBBLE_SLOTS[0];
    const count = Math.max(3, way > 0 ? Math.floor(perRev) + 1 : Math.ceil(perRev) - 1);
    const move = createMove('nibbles', { attach: circle.id, edge, count });
    const last = sets.length ? sets[sets.length - 1] : circle;
    recipe.moves.splice(recipe.moves.indexOf(last) + 1, 0, move);
    return move;
  }

  // Whether rings of `a` and `b` shapes line up shape for shape: equal counts, or one a
  // multiple of the other. Otherwise they coincide at just one point.
  function countsFit(a, b) {
    return a === b || a % b === 0 || b % a === 0;
  }

  // The rings a counted move can usefully line up with: other counted rings whose counts fit.
  // Nibbles line up with other nibbles only across their circle (inner with outer), where
  // staggered bites make a zigzag band.
  function lineUpChoices(recipe, move) {
    return countedMoves(recipe).filter(
      (m) =>
        m.id !== move.id &&
        countsFit(m.count, move.count) &&
        !(isPart(m) && isPart(move) && (m.attach !== move.attach || m.edge === move.edge)),
    );
  }

  // Moves with a mark count: the ones that drift under the strobe.
  function countedMoves(recipe) {
    return recipe.moves.filter((m) => MOVE_TYPES[m.type].counted);
  }

  // How much each wing seems to turn per flash, in radians (clockwise positive): at each
  // position the wing `skip` places back takes over, leaning `lean step` differently, while
  // the ring drifts. Leaning against the ring, one spin, it turns about one step a flash.
  function wingSpin(move, step) {
    const a = TAU / move.count;
    const skip = Math.round(step / a);
    const d = step - a * skip;
    return d - skip * leanStep(move);
  }

  // The extra lean of each wing over the one before it, in radians (clockwise positive).
  function leanStep(move) {
    return (move.lean === 'with' ? 1 : -1) * move.spins * (TAU / move.count);
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
    INK,
    MOVE_TYPES,
    createMove,
    setField,
    defaultRecipe,
    addMove,
    appendMove,
    movesFromSaved,
    removeMove,
    shiftMove,
    isPart,
    MAX_NIBBLE_SETS,
    nibblesOf,
    turnWay,
    countsFit,
    lineUpChoices,
    addNibbles,
    attachedCircle,
    alignedRing,
    phaseOf,
    effectiveRadius,
    startRing,
    ringReach,
    steppedInner,
    shownValue,
    fieldInactive,
    cleanDrawing,
    animated,
    repeatChoices,
    repeatsOf,
    resample,
    pairStrokes,
    animationOf,
    keyPens,
    layerAt,
    swingAt,
    frameAt,
    keyIndex,
    withKeyStrokes,
    withKeyPen,
    newLayer,
    cleanLayers,
    hasStrokes,
    partial,
    blendPairs,
    mixColour,
    simplifyStroke,
    steppedRadii,
    flapOf,
    spiralReading,
    turnsForFlight,
    steppedTotal,
    anchorRing,
    syncAnchors,
    wingsRadius,
    leanStep,
    wingSpin,
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
