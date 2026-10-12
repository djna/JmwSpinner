// JmwSpinner: an editable recipe of moves, a static wheel view, a strobe view and a strobe solver.
(function () {
  'use strict';

  const M = window.JmwMaths;
  const R = window.JmwRender;
  const Rc = window.JmwRecipe;

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

  // --- The drawing recipe: a list of moves, each edited through its own card.

  const recipe = Rc.defaultRecipe();
  let pair = Rc.defaultPair(recipe); // ids of the two counted moves the solver uses
  let pairChosen = false; // until the user picks, the pair follows the outermost and innermost

  const movesList = document.getElementById('moves');

  function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  }

  function moveName(move) {
    return `${recipe.moves.indexOf(move) + 1}. ${Rc.MOVE_TYPES[move.type].label}`;
  }

  // The controls for one field: a label, then a slider and number box kept in sync
  // (as in bindControl below), or a choice list.
  function fieldControls(move, field) {
    const id = `move${move.id}-${field.key}`;
    const label = el('label', { for: id }, field.label);

    if (field.options) {
      const select = el('select', { id, class: 'wide' });
      for (const [value, text] of field.options) select.append(el('option', { value }, text));
      select.value = move[field.key];
      select.addEventListener('change', () => {
        if (Rc.setField(move, field.key, select.value)) redrawRecipe();
      });
      return [label, select];
    }

    const range = el('input', { type: 'range', id, min: field.min, max: field.max, step: field.step });
    const box = el('input', { type: 'number', min: field.min, step: field.integer ? 1 : 'any' });
    box.setAttribute('aria-label', field.label);
    const show = () => {
      range.value = move[field.key];
      box.value = Number(move[field.key].toFixed(4));
    };
    const set = (value) => {
      if (Rc.setField(move, field.key, value)) redrawRecipe();
      show();
    };
    range.addEventListener('input', () => set(range.value));
    box.addEventListener('change', () => set(box.value));
    show();
    return [label, range, box];
  }

  function moveCard(move, index) {
    const card = el('li', { class: 'move' });
    const head = el('div', { class: 'move-head' });
    head.append(el('span', { class: 'move-name' }, moveName(move)));

    const actions = [
      ['↑', 'Move up', index === 0, () => Rc.shiftMove(recipe, move.id, -1)],
      ['↓', 'Move down', index === recipe.moves.length - 1, () => Rc.shiftMove(recipe, move.id, 1)],
      ['✕', 'Remove', false, () => Rc.removeMove(recipe, move.id)],
    ];
    for (const [symbol, title, disabled, act] of actions) {
      const button = el('button', { type: 'button', title, 'aria-label': `${title}: ${moveName(move)}` }, symbol);
      button.disabled = disabled;
      button.addEventListener('click', () => {
        act();
        recipeChanged();
      });
      head.append(button);
    }
    card.append(head);

    const fields = el('div', { class: 'move-fields' });
    for (const field of Rc.MOVE_TYPES[move.type].fields) fields.append(...fieldControls(move, field));
    card.append(fields);
    return card;
  }

  // Rebuild the move cards after a move is added, removed or reordered.
  function recipeChanged() {
    movesList.replaceChildren(...recipe.moves.map(moveCard));
    redrawRecipe();
  }

  const newMoveType = document.getElementById('new-move-type');
  for (const [type, spec] of Object.entries(Rc.MOVE_TYPES)) {
    newMoveType.append(el('option', { value: type }, spec.label));
  }
  document.getElementById('add-move').addEventListener('click', () => {
    Rc.addMove(recipe, newMoveType.value);
    recipeChanged();
  });

  // --- Layers. `marks` holds the recipe in the wheel's frame; `ink` accumulates strobe flashes.

  let size = 0;
  let marks = null;
  let ink = null;
  let inkCtx = null;

  function rebuildLayers() {
    R.fitCanvas(wheelCanvas);
    size = R.fitCanvas(strobeCanvas);
    marks = R.makeLayer(size);
    ink = R.makeLayer(size);
    inkCtx = ink.getContext('2d');
    redrawRecipe();
  }

  function redrawRecipe() {
    const marksCtx = marks.getContext('2d');
    marksCtx.clearRect(0, 0, size, size);
    R.drawRecipe(marksCtx, size, recipe);

    const wsize = wheelCanvas.width;
    wheelCtx.clearRect(0, 0, wsize, wsize);
    R.drawBoard(wheelCtx, wsize);
    R.drawRecipe(wheelCtx, wsize, recipe); // fresh draw so it is crisp at this canvas's size
    updatePairChoice();
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

  function describeRing(move, s) {
    const n = move.count;
    const a = M.markSpacing(n);
    const d = M.apparentStep(s, n);
    const ratio = M.aliasingRatio(s, n);

    let warning = '';
    if (ratio > 0.8) {
      warning = ` <span class="warn">Close to the aliasing limit (${fmt(ratio * 100, 0)}% of half a mark spacing): the direction will look ambiguous.</span>`;
    }

    return `<p><b>${moveName(move)}</b> (${n} ${Rc.MOVE_TYPES[move.type].noun}, ${fmt(deg(a))}° apart) appears to move
      <b>${fmt(deg(d))}°</b> per flash, about <b>${fmt(deg(d) * params.strobe, 1)}°/s</b>,
      so it ${describeDirection(d)}.${warning}</p>`;
  }

  function updateReadout() {
    const s = M.stepPerFlash(params.spin, params.strobe);
    readout.innerHTML = `
      <p>The wheel turns <b>${fmt(deg(s))}°</b> between flashes (${fmt(M.TAU / s)} flashes per revolution).</p>
      ${Rc.countedMoves(recipe).map((move) => describeRing(move, s)).join('')}`;
  }

  // --- Solver: pick rates so rings A and B drift at equal speed in opposite directions.

  const solverNote = document.getElementById('solver-note');
  const ringChoice = [document.getElementById('ring-a'), document.getElementById('ring-b')];
  const solveButtons = [document.getElementById('solve-strobe'), document.getElementById('solve-spin')];
  const SOLVER_HINT = solverNote.textContent;
  const NEEDS_PAIR = 'Needs at least two rings of marks or semicircles.';

  // Refresh the ring A/B choice lists, keeping a pair the user chose while it is still valid.
  function updatePairChoice() {
    pair = pairChosen ? Rc.resolvePair(recipe, pair) : Rc.defaultPair(recipe);
    const counted = Rc.countedMoves(recipe);
    ringChoice.forEach((select, i) => {
      select.replaceChildren(
        ...counted.map((move) =>
          el('option', { value: move.id }, `${moveName(move)} (${move.count})`),
        ),
      );
      select.disabled = !pair;
      if (pair) select.value = pair[i];
    });
    for (const button of solveButtons) button.disabled = !pair;
    if (!pair) solverNote.textContent = NEEDS_PAIR;
    else if (solverNote.textContent === NEEDS_PAIR) solverNote.textContent = SOLVER_HINT;
  }

  // Choosing the ring already picked for the other slot swaps the two.
  ringChoice.forEach((select, i) => {
    select.addEventListener('change', () => {
      const chosen = Number(select.value);
      const other = pair[1 - i];
      const next = [...pair];
      next[i] = chosen;
      if (chosen === other) next[1 - i] = pair[i];
      pair = next;
      pairChosen = true;
      updatePairChoice();
    });
  });

  function solve(target) {
    const [a, b] = pair.map((id) => recipe.moves.find((m) => m.id === id));
    const m1 = Math.max(1, Math.round(Number(document.getElementById('m1').value) || 1));
    const m2 = Math.max(1, Math.round(Number(document.getElementById('m2').value) || 1));
    const s = M.opposingStep(a.count, b.count, m1, m2);
    if (target === 'strobe') setters.strobe(M.strobeRateFor(s, params.spin));
    else setters.spin(M.spinRateFor(s, params.strobe));

    const opposite = Math.abs(M.apparentStep(s, a.count) + M.apparentStep(s, b.count)) < 1e-9;
    solverNote.textContent = opposite
      ? `Solved for ${target === 'strobe' ? 'strobe rate' : 'spin rate'} with ${m1} and ${m2} spacing${m1 === 1 && m2 === 1 ? '' : 's'} per flash.`
      : `These skip counts (${m1}, ${m2}) push a ring past its aliasing limit for ${a.count} and ${b.count}, so the drift won't be equal and opposite. Try smaller values.`;
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

  movesList.replaceChildren(...recipe.moves.map(moveCard));
  rebuildLayers();
  requestAnimationFrame(frame);
})();
