// Canvas drawing for JmwSpinner. Drawing is in wheel units: the wheel has radius 1,
// angle 0 is at the top, and positive angles turn clockwise on screen.
(function (root) {
  'use strict';

  const { TAU } = root.JmwMaths;

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

  // A ring of short radial marks, evenly spaced, starting at the top.
  function drawMarkRing(c, move) {
    const spacing = TAU / move.count;
    const inner = move.radius - move.length / 2;
    const outer = move.radius + move.length / 2;
    c.lineWidth = move.width;
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.beginPath();
    for (let k = 0; k < move.count; k++) {
      const theta = k * spacing - Math.PI / 2;
      const x = Math.cos(theta);
      const y = Math.sin(theta);
      c.moveTo(inner * x, inner * y);
      c.lineTo(outer * x, outer * y);
    }
    c.stroke();
  }

  // A full circle in one wide pen stroke, like the stroke drawn while the wheel turns.
  function drawSolidCircle(c, move) {
    c.lineWidth = move.width;
    c.strokeStyle = INK;
    c.beginPath();
    c.arc(0, 0, move.radius, 0, TAU);
    c.stroke();
  }

  // A ring of small semicircles, evenly spaced, starting at the top. Each one's flat side
  // lies along the ring and its curve bulges towards the centre or towards the rim.
  function drawSemicircleRing(c, move) {
    const spacing = TAU / move.count;
    const turn = move.bulge === 'in' ? Math.PI / 2 : -Math.PI / 2;
    c.lineWidth = move.width;
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.beginPath();
    for (let k = 0; k < move.count; k++) {
      const theta = k * spacing - Math.PI / 2;
      const x = move.radius * Math.cos(theta);
      const y = move.radius * Math.sin(theta);
      const start = theta + turn;
      c.moveTo(x + move.size * Math.cos(start), y + move.size * Math.sin(start));
      c.arc(x, y, move.size, start, start + Math.PI);
    }
    c.stroke();
  }

  const MOVES = {
    circle: drawSolidCircle,
    marks: drawMarkRing,
    semicircles: drawSemicircleRing,
  };

  // Draw every move in the recipe, in the wheel's own frame.
  function drawRecipe(ctx, size, recipe) {
    inWheelSpace(ctx, size, 0, (c) => {
      for (const move of recipe.moves) {
        MOVES[move.type](c, move);
      }
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

  root.JmwRender = { fitCanvas, makeLayer, drawBoard, drawRecipe, drawRotated, fadeLayer };
})(this);
