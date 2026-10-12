// Canvas drawing for JmwSpinner. Drawing is in wheel units: the wheel has radius 1,
// angle 0 is at the top, and positive angles turn clockwise on screen.
(function (root) {
  'use strict';

  const { TAU } = root.JmwMaths;
  const { wobbleOf, steppedRadii } = root.JmwRecipe;

  const INK = '#1d1d24';
  const BOARD = '#fbfbf8';
  const RIM = '#c9c9c2';
  const MARGIN = 0.94; // fraction of the half-width used by the wheel

  // Make a canvas's backing store match its displayed size and the screen's pixel density.
  function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    return size;
  }

  function makeLayer(size) {
    const layer = document.createElement('canvas');
    layer.width = size;
    layer.height = size;
    return layer;
  }

  // Run `draw` with the context set up in wheel units, optionally rotated by `angle`.
  function inWheelSpace(ctx, size, angle, draw) {
    const half = size / 2;
    ctx.save();
    ctx.translate(half, half);
    ctx.scale(half * MARGIN, half * MARGIN);
    ctx.rotate(angle);
    draw(ctx);
    ctx.restore();
  }

  function drawBoard(ctx, size) {
    inWheelSpace(ctx, size, 0, (c) => {
      c.beginPath();
      c.arc(0, 0, 1, 0, TAU);
      c.fillStyle = BOARD;
      c.fill();
      c.lineWidth = 0.012;
      c.strokeStyle = RIM;
      c.stroke();
      c.beginPath();
      c.arc(0, 0, 0.025, 0, TAU);
      c.fillStyle = RIM;
      c.fill();
    });
  }

  // Single shapes, centred at radius `r` and angle `theta` (canvas angle, 0 along +x).
  // `j` is the shape's wobble (see JmwRecipe.wobbleOf), applied to size, tilt and pen width.

  // A short stroke along the radius.
  function markAt(c, r, theta, length, width, j) {
    const half = (length * j.scale) / 2;
    const dx = half * Math.cos(theta + j.tilt);
    const dy = half * Math.sin(theta + j.tilt);
    const cx = r * Math.cos(theta);
    const cy = r * Math.sin(theta);
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.lineWidth = width * j.width;
    c.beginPath();
    c.moveTo(cx - dx, cy - dy);
    c.lineTo(cx + dx, cy + dy);
    c.stroke();
  }

  // A semicircle whose flat side lies along the ring, bulging in towards the centre or out.
  function semicircleAt(c, r, theta, size, width, bulge, j) {
    // Angles on the ellipse are measured from its outward radial axis.
    const start = bulge === 'in' ? Math.PI / 2 : -Math.PI / 2;
    const along = size * j.scale; // half the flat side
    const depth = along * j.squash; // how far the curve bulges
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.lineWidth = width * j.width;
    c.beginPath();
    c.ellipse(r * Math.cos(theta), r * Math.sin(theta), depth, along, theta + j.tilt, start, start + Math.PI);
    c.stroke();
  }

  // A filled dot, `size` in radius.
  function dotAt(c, r, theta, size, j) {
    c.fillStyle = INK;
    c.beginPath();
    c.ellipse(r * Math.cos(theta), r * Math.sin(theta), size * j.scale * j.squash, size * j.scale, theta + j.tilt, 0, TAU);
    c.fill();
  }

  // A ring of short radial marks, evenly spaced, starting at the top (or at `phase`).
  // With wobble, each is slightly off in place, length, tilt and pen width.
  function drawMarkRing(c, move) {
    const spacing = TAU / move.count;
    for (let k = 0; k < move.count; k++) {
      const j = wobbleOf(move, k);
      const theta = (k + j.angle) * spacing + (move.phase || 0) - Math.PI / 2;
      markAt(c, move.radius + j.radial * move.length, theta, move.length, move.width, j);
    }
  }

  // A ring of small semicircles, evenly spaced, starting at the top (or at `phase`). Each
  // one's flat side lies along the ring and its curve bulges towards the centre or towards
  // the rim. With wobble, each is slightly off in place, size, shape, tilt and pen width.
  function drawSemicircleRing(c, move) {
    const spacing = TAU / move.count;
    for (let k = 0; k < move.count; k++) {
      const j = wobbleOf(move, k);
      const theta = (k + j.angle) * spacing + (move.phase || 0) - Math.PI / 2;
      semicircleAt(c, move.radius + j.radial * move.size, theta, move.size, move.width, move.bulge, j);
    }
  }

  // A stepped ring: dots, semicircles or marks at the ring's positions, going round
  // clockwise or anticlockwise, each at the next radius in the sequence (steppedRadii).
  function drawSteppedRing(c, move) {
    const spacing = TAU / move.count;
    const turn = move.climb === 'acw' ? -1 : 1;
    steppedRadii(move).forEach((radius, k) => {
      const j = wobbleOf(move, k);
      const theta = turn * (k + j.angle) * spacing + (move.phase || 0) - Math.PI / 2;
      const r = radius + j.radial * move.size;
      if (move.shape === 'dot') dotAt(c, r, theta, move.size, j);
      else if (move.shape === 'mark') markAt(c, r, theta, 2 * move.size, move.width, j);
      else semicircleAt(c, r, theta, move.size, move.width, move.bulge, j);
    });
  }

  // A circle in one wide pen stroke, drawn by turning the wheel under a pen held at the top.
  // `sweep` (0..1, default 1) is how much of a turn has passed under the pen so far: the
  // newest ink is at the pen, and older ink has turned clockwise away from it. Any nibble
  // rings attached to it (`move.nibbles`) are cut out of this circle's ink only.
  function drawSolidCircle(c, move) {
    if (move.nibbles && move.nibbles.length) {
      drawWithHoles(c, (s) => strokeCircle(s, move), (s) => move.nibbles.forEach((n) => cutNibbles(s, n)));
    } else {
      strokeCircle(c, move);
    }
  }

  function strokeCircle(c, move) {
    const sweep = move.sweep ?? 1;
    c.lineWidth = move.width;
    c.strokeStyle = INK;
    c.beginPath();
    if (sweep >= 1) {
      c.lineCap = 'butt';
      c.arc(0, 0, move.radius, 0, TAU);
    } else {
      c.lineCap = 'round';
      c.arc(0, 0, move.radius, -Math.PI / 2 - sweep * TAU, -Math.PI / 2);
    }
    c.stroke();
  }

  // Fill the bites of one nibble ring, each centred on the circle's edge so it cuts `depth`
  // into the stroke: an ellipse for round bites, a straight-sided notch for a cog.
  function cutNibbles(c, move) {
    const spacing = TAU / move.count;
    c.fillStyle = INK;
    for (let k = 0; k < move.count; k++) {
      const j = wobbleOf(move, k);
      const theta = (k + j.angle) * spacing + (move.phase || 0) - Math.PI / 2;
      const r = move.radius + j.radial * move.depth * 0.5;
      const half = (move.size / 2) * j.scale; // half the bite's width along the edge
      const depth = move.depth * j.squash;
      c.save();
      c.translate(r * Math.cos(theta), r * Math.sin(theta));
      c.rotate(theta + j.tilt); // x now points away from the centre
      c.beginPath();
      if (move.shape === 'cog') c.rect(-depth, -half, 2 * depth, 2 * half);
      else c.ellipse(0, 0, depth, half, 0, 0, TAU);
      c.fill();
      c.restore();
    }
  }

  // Draw some ink on its own, cut holes out of just that ink, then lay it onto `c`.
  // Uses a scratch canvas the size of c's, drawn with c's current transform.
  let scratch = null;
  function drawWithHoles(c, draw, holes) {
    const { width, height } = c.canvas;
    if (!scratch || scratch.width !== width || scratch.height !== height) {
      scratch = document.createElement('canvas');
      scratch.width = width;
      scratch.height = height;
    }
    const s = scratch.getContext('2d');
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, width, height);
    s.setTransform(c.getTransform());
    draw(s);
    s.globalCompositeOperation = 'destination-out';
    holes(s);
    s.globalCompositeOperation = 'source-over';

    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(scratch, 0, 0);
    c.restore();
  }

  const MOVES = {
    circle: drawSolidCircle,
    marks: drawMarkRing,
    semicircles: drawSemicircleRing,
    stepped: drawSteppedRing,
    nibbles: () => {}, // drawn as holes in their circle (see drawSolidCircle)
  };

  // Draw every move in the recipe, in the wheel's own frame turned by `angle`.
  function drawRecipe(ctx, size, recipe, angle = 0) {
    inWheelSpace(ctx, size, angle, (c) => {
      for (const move of recipe.moves) {
        MOVES[move.type](c, move);
      }
    });
  }

  // A pen held still over the top of the wheel, its nib on a circle of the given radius,
  // seen from above: the barrel leans in over the board so it stays in view.
  function drawPen(ctx, size, radius, width) {
    inWheelSpace(ctx, size, 0, (c) => {
      c.lineCap = 'round';
      c.lineWidth = 0.09;
      c.strokeStyle = 'rgba(60, 80, 150, 0.55)';
      c.beginPath();
      c.moveTo(0.03, -radius + 0.035);
      c.lineTo(0.26, -radius + 0.32);
      c.stroke();

      c.beginPath();
      c.arc(0, -radius, Math.max(width / 2, 0.012), 0, TAU);
      c.fillStyle = INK;
      c.fill();
      c.lineWidth = 0.008;
      c.strokeStyle = 'rgba(60, 80, 150, 0.9)';
      c.stroke();
    });
  }

  // Draw a layer rotated about the wheel centre.
  function drawRotated(ctx, size, layer, angle) {
    const half = size / 2;
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(angle);
    ctx.drawImage(layer, -half, -half);
    ctx.restore();
  }

  // Multiply the opacity of everything on a layer by `keep` (0 clears it, 1 leaves it).
  function fadeLayer(ctx, size, keep) {
    if (keep <= 0) {
      ctx.clearRect(0, 0, size, size);
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - keep})`;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  root.JmwRender = { fitCanvas, makeLayer, drawBoard, drawRecipe, drawPen, drawRotated, fadeLayer };
})(this);
