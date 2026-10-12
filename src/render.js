// Canvas drawing for JmwSpinner. Drawing is in wheel units: the wheel has radius 1,
// angle 0 is at the top, and positive angles turn clockwise on screen.
(function (root) {
  'use strict';

  const { TAU } = root.JmwMaths;
  const { wobbleOf, steppedRadii, flapOf, leanStep } = root.JmwRecipe;

  const INK = '#1d1d24';
  const BOARD = '#fbfbf8';
  const RIM = '#c9c9c2';
  const MARGIN = 0.94; // fraction of the half-width used by the wheel

  // The colour of the move being drawn (set by drawRecipe from the move's `colour`).
  let ink = INK;

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
    c.strokeStyle = ink;
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
    c.strokeStyle = ink;
    c.lineWidth = width * j.width;
    c.beginPath();
    c.ellipse(r * Math.cos(theta), r * Math.sin(theta), depth, along, theta + j.tilt, start, start + Math.PI);
    c.stroke();
  }

  // A filled dot, `size` in radius.
  function dotAt(c, r, theta, size, j) {
    c.fillStyle = ink;
    c.beginPath();
    c.ellipse(r * Math.cos(theta), r * Math.sin(theta), size * j.scale * j.squash, size * j.scale, theta + j.tilt, 0, TAU);
    c.fill();
  }

  // Cartoon flyers, drawn as outlines heading away from the centre. `size` is half the
  // wingspan and `flap` where the wings are in their beat (1 up, -1 down). They are drawn
  // in a local frame with the head towards -y and the wings along x.
  function flyerAt(c, r, theta, size, width, flap, j, draw) {
    c.save();
    c.translate(r * Math.cos(theta), r * Math.sin(theta));
    c.rotate(theta + Math.PI / 2 + j.tilt); // local -y now points away from the centre
    c.scale(size * j.scale, size * j.scale);
    c.lineWidth = (width * j.width) / (size * j.scale);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = ink;
    c.beginPath();
    draw(c, flap);
    c.stroke();
    c.restore();
  }

  // A gull: two curved wings meeting at the body, tips raised or lowered with the beat.
  function drawBird(c, flap) {
    const tip = -0.15 - 0.45 * flap; // wing tips: up (-y) at the top of the beat
    const hump = -0.5 - 0.15 * flap;
    c.moveTo(-1, tip);
    c.quadraticCurveTo(-0.45, hump, 0, 0.05);
    c.quadraticCurveTo(0.45, hump, 1, tip);
  }

  // A bat: head with ears, wings with a scalloped trailing edge, and a short tail. The
  // wings rise and narrow a little at the top of the beat.
  function drawBat(c, flap) {
    const tipY = -0.2 - 0.35 * flap;
    const tipX = 0.88 + 0.12 * flap;
    const half = (side) => {
      // Leading edge from the shoulder out to the tip, then back along three scallops.
      c.quadraticCurveTo(side * 0.5, tipY - 0.25, side * tipX, tipY);
      const end = [side * 0.12, 0.22];
      for (let i = 1; i <= 3; i++) {
        const x = side * tipX + (end[0] - side * tipX) * (i / 3);
        const y = tipY + (end[1] - tipY) * (i / 3);
        const px = side * tipX + (end[0] - side * tipX) * ((i - 0.5) / 3);
        const py = tipY + (end[1] - tipY) * ((i - 0.5) / 3) - 0.14;
        c.quadraticCurveTo(px, py, x, y);
      }
    };
    c.moveTo(-0.1, -0.2);
    c.lineTo(-0.14, -0.42); // left ear
    c.lineTo(-0.04, -0.27);
    c.lineTo(0.04, -0.27);
    c.lineTo(0.14, -0.42); // right ear
    c.lineTo(0.1, -0.2);
    half(1);
    c.lineTo(0, 0.34); // tail
    c.lineTo(-0.12, 0.22);
    // Left wing, traced back from the body to the shoulder.
    for (let i = 2; i >= 0; i--) {
      const x = -tipX + (-0.12 + tipX) * (i / 3);
      const y = tipY + (0.22 - tipY) * (i / 3);
      const px = -tipX + (-0.12 + tipX) * ((i + 0.5) / 3);
      const py = tipY + (0.22 - tipY) * ((i + 0.5) / 3) - 0.14;
      c.quadraticCurveTo(px, py, x, y);
    }
    c.quadraticCurveTo(-0.5, tipY - 0.25, -0.1, -0.2);
    c.closePath();
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
  // With trail, each lags behind its position (anticlockwise, against the spin) in
  // proportion to how far out it is.
  function drawSteppedRing(c, move) {
    const spacing = TAU / move.count;
    const turn = move.climb === 'acw' ? -1 : 1;
    const range = move.outer - move.inner;
    steppedRadii(move).forEach((radius, k) => {
      const j = wobbleOf(move, k);
      const lag = (move.trail || 0) * (range ? (radius - move.inner) / range : 0) * spacing;
      const theta = turn * (k + j.angle) * spacing + (move.phase || 0) - lag - Math.PI / 2;
      const r = radius + j.radial * move.size;
      if (move.shape === 'dot') dotAt(c, r, theta, move.size, j);
      else if (move.shape === 'mark') markAt(c, r, theta, 2 * move.size, move.width, j);
      else if (move.shape === 'bird') flyerAt(c, r, theta, move.size, move.width, flapOf(move, k), j, drawBird);
      else if (move.shape === 'bat') flyerAt(c, r, theta, move.size, move.width, flapOf(move, k), j, drawBat);
      else semicircleAt(c, r, theta, move.size, move.width, move.bulge, j);
    });
  }

  // A ring of triangular wings: base on the ring, point outward, each leaning a further
  // step (leanStep) from the one before, starting straight out at the top. Anchored wings
  // follow their anchor's shapes, including its wobble.
  function drawWingRing(c, move) {
    const spacing = TAU / move.count;
    const lean = leanStep(move);
    c.fillStyle = ink;
    c.strokeStyle = ink;
    c.lineJoin = 'round';
    for (let k = 0; k < move.count; k++) {
      const j = wobbleOf(move, k);
      const place = move.anchorWobble ? wobbleOf(move.anchorWobble, k) : j;
      const theta = (k + place.angle) * spacing + (move.phase || 0) - Math.PI / 2;
      const point = theta + k * lean + j.tilt; // the direction the wing points
      const bx = move.radius * Math.cos(theta);
      const by = move.radius * Math.sin(theta);
      const length = move.length * j.scale;
      const half = (move.base / 2) * j.squash;
      c.beginPath();
      c.moveTo(bx + length * Math.cos(point), by + length * Math.sin(point));
      c.lineTo(bx - half * Math.sin(point), by + half * Math.cos(point));
      c.lineTo(bx + half * Math.sin(point), by - half * Math.cos(point));
      c.closePath();
      if (move.fill === 'outline') {
        c.lineWidth = move.width * j.width;
        c.stroke();
      } else {
        c.fill();
      }
    }
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
    c.strokeStyle = ink;
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
    wings: drawWingRing,
    nibbles: () => {}, // drawn as holes in their circle (see drawSolidCircle)
  };

  // Draw every move in the recipe, in the wheel's own frame turned by `angle`.
  function drawRecipe(ctx, size, recipe, angle = 0) {
    inWheelSpace(ctx, size, angle, (c) => {
      for (const move of recipe.moves) {
        ink = move.colour || INK;
        MOVES[move.type](c, move);
      }
      ink = INK;
    });
  }

  // A pen held still over the top of the wheel, its nib on a circle of the given radius,
  // seen from above: the barrel leans in over the board so it stays in view.
  function drawPen(ctx, size, radius, width, colour = INK) {
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
      c.fillStyle = colour;
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
