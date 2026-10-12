// JmwSpinner: an editable recipe of moves, a static wheel view, a strobe view and a strobe solver.
(function () {
  'use strict';

  const M = window.JmwMaths;
  const R = window.JmwRender;
  const Rc = window.JmwRecipe;
  const H = window.JmwHistory;

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
  let syncs = []; // one per field control: refreshes it from the recipe after any change

  function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  }

  function moveName(move) {
    return `${recipe.moves.indexOf(move) + 1}. ${Rc.MOVE_TYPES[move.type].label}`;
  }

  // The choices for a reference field: none, or another move of the right kind. A ring
  // shows its count, since rings line up shape for shape when their counts match or divide.
  function refOptions(move, field) {
    if (field.ref === 'circle') {
      const options = [['', 'nothing (own radius)']];
      for (const m of recipe.moves) if (m.type === 'circle') options.push([m.id, moveName(m)]);
      return options;
    }
    const options = [['', 'the top of the wheel']];
    for (const m of Rc.countedMoves(recipe)) {
      if (m.id !== move.id) options.push([m.id, `${moveName(m)} (${m.count})`]);
    }
    return options;
  }

  // Grey out a field's controls when it has no effect (e.g. radius on an attached ring).
  function markInactive(move, field, label, inputs) {
    const inactive = Rc.fieldInactive(recipe, move, field.key);
    label.classList.toggle('inactive', inactive);
    for (const input of inputs) input.disabled = inactive;
  }

  // The controls for one field: a label, then a slider and number box kept in sync
  // (as in bindControl below), or a choice list. `onChange` runs after the field changes,
  // and a function that refreshes the controls from the move is added to `syncList`.
  function fieldControls(move, field, onChange, syncList) {
    const id = `move${move.id}-${field.key}`;
    const label = el('label', { for: id }, field.label);

    if (field.options || field.ref) {
      const select = el('select', { id, class: 'wide' });
      const fill = (options) => select.replaceChildren(...options.map(([value, text]) => el('option', { value }, text)));
      if (field.options) fill(field.options);
      select.addEventListener('change', () => {
        if (Rc.setField(move, field.key, select.value)) onChange();
      });
      syncList.push(() => {
        if (field.ref) fill(refOptions(move, field)); // names and counts may have changed
        select.value = move[field.key] ?? '';
        markInactive(move, field, label, [select]);
      });
      return [label, select];
    }

    const range = el('input', { type: 'range', id, min: field.min, max: field.max, step: field.step });
    const box = el('input', { type: 'number', min: field.min, step: field.integer ? 1 : 'any' });
    box.setAttribute('aria-label', field.label);
    // Shows where the move is actually drawn, for fields that can follow another move.
    const shown = () => Rc.shownValue(recipe, move, field.key);
    const show = () => {
      range.value = shown();
      box.value = Number(shown().toFixed(4));
      markInactive(move, field, label, [range, box]);
    };
    const set = (value) => {
      if (Rc.setField(move, field.key, value)) onChange();
      show();
    };
    range.addEventListener('input', () => set(range.value));
    box.addEventListener('change', () => set(box.value));
    syncList.push(show);
    return [label, range, box];
  }

  function moveCard(move, index) {
    const card = el('li', { class: 'move' });
    const head = el('div', { class: 'move-head' });
    head.append(el('span', { class: 'move-name' }, moveName(move)));

    const actions = [
      ...(move.type === 'circle' ? [['↻', 'Draw again', false, () => startDrawing(move)]] : []),
      ...(Rc.MOVE_TYPES[move.type].wobbly ? [['🎲', 'New wobble', false, () => Rc.rewobble(move)]] : []),
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
        remember();
      });
      head.append(button);
    }
    card.append(head);

    card.append(fieldsGrid(move, redrawRecipe, syncs));
    card.addEventListener('change', remember); // a slider let go, a box or choice changed
    return card;
  }

  function fieldsGrid(move, onChange, syncList) {
    const fields = el('div', { class: 'move-fields' });
    for (const field of Rc.MOVE_TYPES[move.type].fields) {
      fields.append(...fieldControls(move, field, onChange, syncList));
    }
    return fields;
  }

  // Rebuild the move cards after a move is added, removed or reordered.
  function recipeChanged() {
    renderCards();
    redrawRecipe();
  }

  function renderCards() {
    syncs = [];
    movesList.replaceChildren(...recipe.moves.map(moveCard));
    renderDraft();
  }

  // --- The next move: chosen and configured here, then drawn onto the wheel.

  const draftCard = document.getElementById('new-move');
  let draft = Rc.createMove('circle');
  let draftSyncs = [];

  function syncDraft() {
    for (const sync of draftSyncs) sync();
  }

  function renderDraft() {
    if (!Rc.attachedCircle(recipe, draft)) Rc.setField(draft, 'attach', null); // its circle was removed
    if (!Rc.alignedRing(recipe, draft)) Rc.setField(draft, 'align', null);
    if (draft.type === 'stepped' && !Rc.startRing(recipe, draft)) Rc.setField(draft, 'from', null);
    if (draft.type === 'wings') {
      if (!Rc.anchorRing(recipe, draft)) Rc.setField(draft, 'anchor', null);
      if (draft.anchor === null) {
        // Wings usually sit on semicircles, so start them on the most recent ring of them.
        const rings = recipe.moves.filter((m) => m.type === 'semicircles');
        if (rings.length) Rc.setField(draft, 'anchor', rings[rings.length - 1].id);
      }
      Rc.syncAnchors({ moves: [...recipe.moves, draft] });
    }
    if ((draft.type === 'nibbles' || draft.type === 'semicircles') && draft.attach === null) {
      // Nibbles only show in a circle, and semicircles usually sit on one, so start them on
      // the most recent circle.
      const circles = recipe.moves.filter((m) => m.type === 'circle');
      if (circles.length) Rc.setField(draft, 'attach', circles[circles.length - 1].id);
    }
    draftSyncs = [];

    const head = el('div', { class: 'move-head' });
    const typeLabel = el('label', { for: 'new-move-type', class: 'move-name' }, 'New move');
    const type = el('select', { id: 'new-move-type' });
    for (const [value, spec] of Object.entries(Rc.MOVE_TYPES)) type.append(el('option', { value }, spec.label));
    type.value = draft.type;
    type.addEventListener('change', () => {
      draft = Rc.createMove(type.value);
      renderDraft();
    });
    head.append(typeLabel, type);

    const drawButton = el('button', { type: 'button', id: 'draw-move', class: 'draw' }, 'Draw');
    drawButton.addEventListener('click', () => {
      const move = Rc.appendMove(recipe, draft);
      draft = Rc.createMove(move.type);
      if (move.type === 'circle') startDrawing(move);
      recipeChanged();
      remember();
    });

    draftCard.replaceChildren(head, fieldsGrid(draft, syncDraft, draftSyncs), drawButton);
    syncDraft();
  }

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

  // Redraw after any recipe change: the drawing, the move cards, the solver and the readout.
  function redrawRecipe() {
    redrawDrawing(); // (syncs anchored counts first, so the cards and readout see them)
    for (const sync of syncs) sync();
    updatePairChoice();
    updateReadout();
  }

  // Redraw the marks layer and the wheel view. While a circle is being drawn, the wheel
  // view turns under a pen held at the top and the circle is only partly there.
  function redrawDrawing() {
    Rc.syncAnchors(recipe); // anchored wings take their anchor's count
    const drawn = Rc.resolve(recipe);
    let angle = 0;
    let pen = null;
    if (drawing) {
      pen = drawn.moves.find((m) => m.id === drawing.id);
      if (pen) {
        pen.sweep = drawing.progress;
        angle = drawing.progress * M.TAU;
      }
    }

    const marksCtx = marks.getContext('2d');
    marksCtx.clearRect(0, 0, size, size);
    R.drawRecipe(marksCtx, size, drawn);

    const wsize = wheelCanvas.width;
    wheelCtx.clearRect(0, 0, wsize, wsize);
    R.drawBoard(wheelCtx, wsize);
    R.drawRecipe(wheelCtx, wsize, drawn, angle); // fresh draw so it is crisp at this canvas's size
    if (pen) R.drawPen(wheelCtx, wsize, pen.radius, pen.width);
  }

  // --- Drawing a circle: the wheel makes one slow turn under the pen.

  const DRAW_SECONDS = 2;
  let drawing = null; // { id, start, progress } while a circle is being drawn

  function startDrawing(move) {
    drawing = { id: move.id, start: null, progress: 0 };
  }

  // Advance the drawing to time `t` (seconds). Ends when the turn is done or the move is gone.
  function stepDrawing(t) {
    if (drawing.start === null) drawing.start = t;
    drawing.progress = Math.min(1, (t - drawing.start) / DRAW_SECONDS);
    if (drawing.progress >= 1 || !recipe.moves.some((m) => m.id === drawing.id)) drawing = null;
    redrawDrawing();
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
      so it ${describeDirection(d)}.${move.type === 'stepped' ? describeSpiral(move, s) : ''}${move.type === 'wings' ? describeWings(move, s) : ''}${warning}</p>`;
  }

  // How fast each wing seems to spin as it travels round.
  function describeWings(move, s) {
    const spin = deg(Rc.wingSpin(move, s));
    if (Math.abs(spin) < 0.05) return ' Each wing keeps its direction.';
    const way = spin > 0 ? 'clockwise' : 'anticlockwise';
    const warn = Math.abs(spin) > 150 ? ' <span class="warn">That is close to half a turn per flash, so the spin direction will look ambiguous.</span>' : '';
    return ` Each wing seems to spin <b>${fmt(Math.abs(spin), 1)}°</b> ${way} per flash, about <b>${fmt((Math.abs(spin) * params.strobe) / 360)} rev/s</b>.${warn}`;
  }

  const SPIRAL_READINGS = {
    in: 'spirals <b>inward</b>',
    out: 'spirals <b>outward</b>',
    breathes: '<b>breathes</b>: half the ring moves outward while the other half moves inward',
    still: 'shows <b>no in or out motion</b>, because the wheel skips no whole spacings between flashes',
  };

  // How long a shape takes to travel between the inner and outer radius, and how far round
  // the wheel it drifts meanwhile: one step along the sequence per flash, so a longer
  // flight needs more shapes (more turns) or more drift per flash.
  function describeFlight(move, s, flashes, lag) {
    const d = deg(M.apparentStep(s, move.count) + lag);
    const sweep = Math.abs(d * flashes);
    const way = Math.abs(d) < 1e-9 ? '' : d > 0 ? ' clockwise' : ' anticlockwise';
    const leg = move.pattern === 'out' ? 'to travel between the inner and outer radius' : 'to travel out';
    return `Each shape takes <b>${fmt(flashes / params.strobe)} s</b> (${fmt(flashes, 0)} flashes) ${leg},
      drifting <b>${fmt(sweep, 0)}°</b>${way} on the way. For a longer flight, add turns or drift faster.`;
  }

  // How a stepped ring reads in or out at this strobe setting, and whether it will hold up.
  function describeSpiral(move, s) {
    const drawn = Rc.resolve(recipe).moves.find((m) => m.id === move.id); // inner radius worked out
    const { reading, skip, strain, flashes, lag } = Rc.spiralReading(drawn, s);
    const shapes = move.count * move.turns;
    const why = reading === 'still' ? '' : ` (the wheel skips ${Math.abs(skip)} spacing${Math.abs(skip) === 1 ? '' : 's'} per flash)`;
    let text = ` With its ${shapes} shapes it ${SPIRAL_READINGS[reading]}${why}.`;
    if (reading !== 'still') text += ` ${describeFlight(move, s, flashes, lag)}`;
    if (reading === 'in' || reading === 'out') {
      text += ` Switch <i>Climbs</i> to make it spiral ${reading === 'in' ? 'outward' : 'inward'}.`;
    }
    if (strain > 0.75) {
      text += ` <span class="warn">The radius changes a lot between neighbouring shapes, so the eye may match the wrong ones and the motion may break up. Try more positions, more turns or a smaller radius range.</span>`;
    }
    return text;
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

    if (drawing) stepDrawing(t);

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

  // --- Undo and redo. A snapshot is the recipe plus the spin and strobe rates (which the
  // solver changes). A step is recorded after each finished change: a slider let go, a box
  // or choice changed, a button pressed. Afterglow and the New move card are not included.

  let history = null;
  const undoButton = document.getElementById('undo');
  const redoButton = document.getElementById('redo');

  function snapshot() {
    return JSON.stringify({ moves: recipe.moves, spin: params.spin, strobe: params.strobe });
  }

  function updateHistoryButtons() {
    undoButton.disabled = !H.canUndo(history);
    redoButton.disabled = !H.canRedo(history);
  }

  function remember() {
    if (H.commit(history, snapshot())) updateHistoryButtons();
  }

  function restore(state) {
    if (state === null) return;
    const { moves, spin, strobe } = JSON.parse(state);
    recipe.moves = moves;
    drawing = null;
    setters.spin(spin);
    setters.strobe(strobe);
    recipeChanged();
    updateHistoryButtons();
  }

  undoButton.addEventListener('click', () => restore(H.undo(history)));
  redoButton.addEventListener('click', () => restore(H.redo(history)));

  // --- Save and open: the whole setup (recipe, rates, afterglow, solver choices) as a
  // JSON file. Opening a file is a step that can be undone.

  const FILE_FORMAT = 'jmwspinner';
  const fileStatus = document.getElementById('file-status');
  const openInput = document.getElementById('open-file');
  const m1Box = document.getElementById('m1');
  const m2Box = document.getElementById('m2');

  function setupData() {
    return {
      format: FILE_FORMAT,
      version: 1,
      saved: new Date().toISOString(),
      moves: recipe.moves,
      spin: params.spin,
      strobe: params.strobe,
      afterglow: params.afterglow,
      solver: { pair: pairChosen ? pair : null, m1: Number(m1Box.value), m2: Number(m2Box.value) },
    };
  }

  function fileName() {
    const t = new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `jmwspinner-${t.getFullYear()}-${two(t.getMonth() + 1)}-${two(t.getDate())}-${two(t.getHours())}${two(t.getMinutes())}.json`;
  }

  // Use the browser's save dialog where there is one (Chrome, Edge), else a download.
  async function saveSetup() {
    const text = JSON.stringify(setupData(), null, 2);
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName(),
          types: [{ description: 'JmwSpinner setup', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        fileStatus.textContent = `Saved ${handle.name}.`;
      } else {
        const link = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: fileName() });
        link.click();
        URL.revokeObjectURL(link.href);
        fileStatus.textContent = `Saved ${link.download} to your downloads.`;
      }
    } catch (error) {
      if (error.name !== 'AbortError') fileStatus.textContent = `Could not save: ${error.message}`;
    }
  }

  function openSetup(text, name) {
    let data;
    try {
      data = JSON.parse(text);
      if (!data || data.format !== FILE_FORMAT) throw new Error('This is not a JmwSpinner setup file.');
      recipe.moves = Rc.movesFromSaved(data.moves);
    } catch (error) {
      fileStatus.textContent = `Could not open ${name}: ${error.message}`;
      return;
    }
    drawing = null;
    if (Number.isFinite(data.spin)) setters.spin(data.spin);
    if (Number.isFinite(data.strobe) && data.strobe > 0) setters.strobe(data.strobe);
    if (Number.isFinite(data.afterglow)) setters.afterglow(data.afterglow);
    const solver = data.solver || {};
    pair = Array.isArray(solver.pair) ? solver.pair : null;
    pairChosen = pair !== null;
    if (Number.isFinite(solver.m1)) m1Box.value = solver.m1;
    if (Number.isFinite(solver.m2)) m2Box.value = solver.m2;
    recipeChanged();
    remember();
    fileStatus.textContent = `Opened ${name}.`;
  }

  document.getElementById('save').addEventListener('click', saveSetup);
  document.getElementById('open').addEventListener('click', () => openInput.click());
  openInput.addEventListener('change', async () => {
    const file = openInput.files[0];
    if (file) openSetup(await file.text(), file.name);
    openInput.value = ''; // so the same file can be opened again
  });

  // ⌘Z / Ctrl+Z to undo; ⇧⌘Z, ⇧Ctrl+Z or Ctrl+Y to redo. Left alone while typing in a
  // number box, where the browser's own text undo applies. ⌘S / ⌘O save and open.
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key.toLowerCase() === 's' || event.key.toLowerCase() === 'o') {
      event.preventDefault();
      if (event.key.toLowerCase() === 's') saveSetup();
      else openInput.click();
      return;
    }
    if (event.target.matches?.('input[type="number"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) restore(H.undo(history));
    else if ((key === 'z' && event.shiftKey) || key === 'y') restore(H.redo(history));
    else return;
    event.preventDefault();
  });

  // --- Wiring.

  bindControl('spin', updateReadout);
  bindControl('strobe', () => {
    if (lastTime !== null) nextFlash = Math.min(nextFlash, lastTime + 1 / params.strobe);
    updateReadout();
  });
  bindControl('afterglow', () => {});

  document.getElementById('spin').closest('fieldset').addEventListener('change', remember);
  document.getElementById('solve-strobe').addEventListener('click', () => {
    solve('strobe');
    remember();
  });
  document.getElementById('solve-spin').addEventListener('click', () => {
    solve('spin');
    remember();
  });

  const pauseButton = document.getElementById('pause');
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    if (!paused) nextFlash = lastTime;
  });

  window.addEventListener('resize', rebuildLayers);

  renderCards();
  rebuildLayers();
  history = H.createHistory(snapshot());
  requestAnimationFrame(frame);
})();
