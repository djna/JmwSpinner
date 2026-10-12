// JmwSpinner: two rings of marks, a static wheel view, a strobe view and a strobe solver.
(function () {
  'use strict';

  const M = window.JmwMaths;
  const R = window.JmwRender;

  const MAX_FLASHES_PER_FRAME = 64;

  const wheelCanvas = document.getElementById('wheel-view');
  const strobeCanvas = document.getElementById('strobe-view');
  const wheelCtx = wheelCanvas.getContext('2d');
  const strobeCtx = strobeCanvas.getContext('2d');

  // --- Controls: each range slider is paired with a number box and kept in sync.
  // The number box can hold values beyond the slider's range (e.g. from the solver).

  const params = {};
  const setters = {};

  function bindControl(name, onChange) {
    const range = document.getElementById(name);
    const box = document.getElementById(`${name}-num`);
    const set = (value) => {
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      range.value = v;
      box.value = Number(v.toFixed(4));
      params[name] = v;
      onChange();
    };
    range.addEventListener('input', () => set(range.value));
    box.addEventListener('change', () => set(box.value));
    params[name] = Number(range.value);
    box.value = range.value;
    setters[name] = set;
  }

  // --- The drawing recipe, rebuilt from the controls.

  const RINGS = [1, 2];

  function ringCount(ring) {
    return Math.max(1, Math.round(params[`count${ring}`]));
  }

  function buildRecipe() {
    return {
      moves: RINGS.map((ring) => ({
        type: 'marks',
        count: ringCount(ring),
        radius: params[`radius${ring}`],
        length: 0.1,
        width: 0.03,
      })),
    };
  }

  // --- Layers. `marks` holds the recipe in the wheel's frame; `ink` accumulates strobe flashes.

  let size = 0;
  let marks = null;
  let ink = null;
  let inkCtx = null;
  let recipe = null;

  function rebuildLayers() {
    R.fitCanvas(wheelCanvas);
    size = R.fitCanvas(strobeCanvas);
    marks = R.makeLayer(size);
    ink = R.makeLayer(size);
    inkCtx = ink.getContext('2d');
    redrawRecipe();
  }

  function redrawRecipe() {
    recipe = buildRecipe();
    const marksCtx = marks.getContext('2d');
    marksCtx.clearRect(0, 0, size, size);
    R.drawRecipe(marksCtx, size, recipe);

    const wsize = wheelCanvas.width;
    wheelCtx.clearRect(0, 0, wsize, wsize);
    R.drawBoard(wheelCtx, wsize);
    R.drawRecipe(wheelCtx, wsize, recipe); // fresh draw so it is crisp at this canvas's size
    updateReadout();
  }

  // --- Readout: the strobe maths for the current settings.

  const readout = document.getElementById('readout');
  const deg = (rad) => (rad * 180) / Math.PI;
  const fmt = (x, digits = 2) => x.toFixed(digits);

  function describeDirection(d) {
    if (Math.abs(d) < 1e-9) return 'stands still';
    return d > 0 ? 'turns clockwise (with the wheel)' : 'turns anticlockwise (against the wheel)';
  }

  function describeRing(ring, s) {
    const n = ringCount(ring);
    const a = M.markSpacing(n);
    const d = M.apparentStep(s, n);
    const ratio = M.aliasingRatio(s, n);

    let warning = '';
    if (ratio > 0.8) {
      warning = ` <span class="warn">Close to the aliasing limit (${fmt(ratio * 100, 0)}% of half a mark spacing): the direction will look ambiguous.</span>`;
    }

    return `<p><b>Ring ${ring}</b> (${n} marks, ${fmt(deg(a))}° apart) appears to move
      <b>${fmt(deg(d))}°</b> per flash, about <b>${fmt(deg(d) * params.strobe, 1)}°/s</b>,
      so it ${describeDirection(d)}.${warning}</p>`;
  }

  function updateReadout() {
    const s = M.stepPerFlash(params.spin, params.strobe);
    readout.innerHTML = `
      <p>The wheel turns <b>${fmt(deg(s))}°</b> between flashes (${fmt(M.TAU / s)} flashes per revolution).</p>
      ${RINGS.map((ring) => describeRing(ring, s)).join('')}`;
  }

  // --- Solver: pick rates so the two rings drift at equal speed in opposite directions.

  const solverNote = document.getElementById('solver-note');

  function solvedStep() {
    const m1 = Math.max(1, Math.round(Number(document.getElementById('m1').value) || 1));
    const m2 = Math.max(1, Math.round(Number(document.getElementById('m2').value) || 1));
    return { s: M.opposingStep(ringCount(1), ringCount(2), m1, m2), m1, m2 };
  }

  function solve(target) {
    const { s, m1, m2 } = solvedStep();
    if (target === 'strobe') setters.strobe(M.strobeRateFor(s, params.spin));
    else setters.spin(M.spinRateFor(s, params.strobe));

    const n1 = ringCount(1);
    const n2 = ringCount(2);
    const opposite = Math.abs(M.apparentStep(s, n1) + M.apparentStep(s, n2)) < 1e-9;
    solverNote.textContent = opposite
      ? `Solved for ${target === 'strobe' ? 'strobe rate' : 'spin rate'} with ${m1} and ${m2} spacing${m1 === 1 && m2 === 1 ? '' : 's'} per flash.`
      : `These skip counts (${m1}, ${m2}) push a ring past its aliasing limit for ${n1} and ${n2} marks, so the drift won't be equal and opposite. Try smaller values.`;
  }

  // --- Strobe loop. The wheel angle is integrated over time so changing the spin rate
  // never makes it jump. Each flash fades the ink by the afterglow and stamps the marks
  // at the wheel angle of that flash. Several flashes can land in one display frame.

  let wheelAngle = 0;
  let lastTime = null;
  let nextFlash = null;
  let paused = false;

  function flash(angle, period) {
    const glow = params.afterglow / 1000;
    const keep = glow > 0 ? Math.exp(-period / glow) : 0;
    R.fadeLayer(inkCtx, size, keep);
    R.drawRotated(inkCtx, size, marks, angle);
  }

  function frame(now) {
    const t = now / 1000;
    if (lastTime === null) {
      lastTime = t;
      nextFlash = t;
    }

    if (!paused) {
      const omega = M.TAU * params.spin;
      const period = 1 / params.strobe;
      let count = 0;
      while (nextFlash <= t && count < MAX_FLASHES_PER_FRAME) {
        flash(wheelAngle + omega * (nextFlash - lastTime), period);
        nextFlash += period;
        count++;
      }
      if (nextFlash <= t) nextFlash = t + period; // fell behind (e.g. hidden tab): skip ahead
      wheelAngle = (wheelAngle + omega * (t - lastTime)) % M.TAU;
    }
    lastTime = t;

    strobeCtx.clearRect(0, 0, size, size);
    R.drawBoard(strobeCtx, size);
    strobeCtx.drawImage(ink, 0, 0);

    requestAnimationFrame(frame);
  }

  // --- Wiring.

  for (const ring of RINGS) {
    bindControl(`count${ring}`, redrawRecipe);
    bindControl(`radius${ring}`, redrawRecipe);
  }
  bindControl('spin', updateReadout);
  bindControl('strobe', () => {
    if (lastTime !== null) nextFlash = Math.min(nextFlash, lastTime + 1 / params.strobe);
    updateReadout();
  });
  bindControl('afterglow', () => {});

  document.getElementById('solve-strobe').addEventListener('click', () => solve('strobe'));
  document.getElementById('solve-spin').addEventListener('click', () => solve('spin'));

  const pauseButton = document.getElementById('pause');
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    if (!paused) nextFlash = lastTime;
  });

  window.addEventListener('resize', rebuildLayers);

  rebuildLayers();
  requestAnimationFrame(frame);
})();
