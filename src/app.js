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
  // onChange is told whether the user made the change or the code did (solver, undo, open).

  const params = {};
  const setters = {};

  function bindControl(name, onChange) {
    const range = document.getElementById(name);
    const box = document.getElementById(`${name}-num`);
    const update = (value, byUser) => {
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      range.value = v;
      box.value = Number(v.toFixed(4));
      params[name] = v;
      onChange(byUser);
    };
    const set = (value) => update(value, false);
    range.addEventListener('input', () => update(range.value, true));
    box.addEventListener('change', () => update(box.value, true));
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

  // --- Technical view: number boxes beside the sliders, and colour codes beside the colour
  // pickers. Off by default, since sliders, choices and (later) the wheel itself should be
  // enough; a calipers button on each card turns it on and off everywhere.

  let technical = false;
  const CALIPERS = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
    <path d="M2 4.5h20v3H2z"/><path d="M3.5 7.5V21l3.5-6.5v-7"/>
    <path d="M13 2.5h6v7h-6z"/><path d="M14 9.5V21l3.5-6.5v-5"/></svg>`;

  function techButton() {
    const button = el('button', {
      type: 'button',
      class: 'tech-toggle',
      title: 'Show numbers (technical view)',
      'aria-label': 'Show numbers',
      'aria-pressed': String(technical),
    });
    button.innerHTML = CALIPERS;
    button.addEventListener('click', () => setTechnical(!technical));
    return button;
  }

  function setTechnical(on) {
    technical = on;
    document.body.classList.toggle('technical', on);
    for (const sync of [...syncs, ...draftSyncs]) sync(); // some rows show only in it
    for (const button of document.querySelectorAll('.tech-toggle')) button.setAttribute('aria-pressed', String(on));
  }

  // Moves proper: everything but nibbles, which are part of their circle.
  function mainMoves() {
    return recipe.moves.filter((m) => !Rc.isPart(m));
  }

  // A move's name, numbered in drawing order (e.g. "2. Ring of marks"). Nibbles are named by
  // their circle, edge and the way they seem to turn, numbered if two sets share all three.
  function moveName(move) {
    if (Rc.isPart(move)) return `${nibbleCircleName(move)}, ${nibbleName(move).toLowerCase()}`;
    return `${mainMoves().indexOf(move) + 1}. ${Rc.MOVE_TYPES[move.type].label}`;
  }

  function nibbleCircleName(move) {
    const circle = Rc.attachedCircle(recipe, move);
    return circle ? moveName(circle) : 'No circle';
  }

  const WAYS = { 1: 'clockwise', '-1': 'anticlockwise', 0: 'still' };

  function nibbleName(move) {
    const circle = Rc.attachedCircle(recipe, move);
    const way = (m) => Rc.turnWay(m.count, perRev);
    const same = circle
      ? Rc.nibblesOf(recipe, circle).filter((m) => m.edge === move.edge && way(m) === way(move))
      : [move];
    const edge = move.edge === 'inner' ? 'Inner' : 'Outer';
    return `${edge} nibbles, ${WAYS[way(move)]}${same.length > 1 ? ` ${same.indexOf(move) + 1}` : ''}`;
  }

  // The choices for a reference field: none, or another move of the right kind. A ring
  // shows its count, since rings line up shape for shape when their counts match or divide.
  function refOptions(move, field) {
    if (field.ref === 'circle') {
      // Nibbles must bite into a circle, so they have no "nothing" choice.
      const options = Rc.MOVE_TYPES[move.type].needsCircle ? [] : [['', 'nothing (own radius)']];
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

    if (field.colour) {
      // A colour picker: the wheel follows as you pick; the finished choice is one undo step.
      const picker = el('input', { type: 'color', id, class: 'wide' });
      picker.addEventListener('input', () => {
        if (Rc.setField(move, field.key, picker.value)) onChange();
      });
      // Its code, e.g. #1c1c1f, shown in the technical view.
      const code = el('input', { type: 'text', class: 'tech-only colour-code', maxlength: 7, spellcheck: 'false' });
      code.setAttribute('aria-label', `${field.label} code`);
      code.addEventListener('change', () => {
        const text = code.value.trim();
        if (Rc.setField(move, field.key, text.startsWith('#') ? text : `#${text}`)) onChange();
        code.value = picker.value = move[field.key];
      });
      syncList.push(() => {
        code.value = picker.value = move[field.key];
      });
      return [label, picker, code];
    }

    if (field.cycle) {
      const choices = field.options.map(([value, text, short]) => [value, short || text, text]);
      const cell = cycler(id, field.label, choices, (value) => {
        if (Rc.setField(move, field.key, value)) onChange();
      });
      syncList.push(() => {
        cell.choose(move[field.key]);
        markInactive(move, field, cell.caption, [cell.button]);
      });
      return [cell];
    }

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

  // Buttons that change the recipe, then rebuild the cards and record an undo step.
  function actionButtons(move, actions) {
    return actions.map(([symbol, title, disabled, act]) => {
      const button = el('button', { type: 'button', title, 'aria-label': `${title}: ${moveName(move)}` }, symbol);
      button.disabled = disabled;
      button.addEventListener('click', () => {
        act();
        recipeChanged();
        remember();
      });
      return button;
    });
  }

  function moveCard(move, index, list) {
    const card = el('li', { class: 'move', 'data-id': move.id });
    const head = el('div', { class: 'move-head' });
    head.append(el('span', { class: 'move-name' }, moveName(move)));
    head.append(
      ...actionButtons(move, [
        ...(move.type === 'circle' ? [['↻', 'Draw again', false, () => startDrawing(move)]] : []),
        ...(Rc.MOVE_TYPES[move.type].wobbly ? [['🎲', 'New wobble', false, () => Rc.rewobble(move)]] : []),
        ['↑', 'Move up', index === 0, () => Rc.shiftMove(recipe, move.id, -1)],
        ['↓', 'Move down', index === list.length - 1, () => Rc.shiftMove(recipe, move.id, 1)],
        ['✕', 'Remove', false, () => Rc.removeMove(recipe, move.id)],
      ]),
      techButton(),
    );
    card.append(head, fieldsGrid(move, redrawRecipe, syncs));
    if (move.type === 'circle') card.append(nibblesSection(move));
    card.addEventListener('change', remember); // a slider let go, a box or choice changed
    return card;
  }

  // A circle's sets of nibbles, each with its own fields, and a button to add another.
  function nibblesSection(circle) {
    const section = el('div', { class: 'nibbles' });
    const sets = Rc.nibblesOf(recipe, circle);
    const head = el('div', { class: 'move-head' });
    head.append(el('span', { class: 'move-name' }, 'Nibbles'));
    const [add] = actionButtons(circle, [
      ['+ Add nibbles', 'Add a set of nibbles', sets.length >= Rc.MAX_NIBBLE_SETS, () => Rc.addNibbles(recipe, circle, perRev)],
    ]);
    if (add.disabled) add.title = `A circle can have up to ${Rc.MAX_NIBBLE_SETS} sets of nibbles.`;
    head.append(add);
    section.append(head);
    if (!sets.length) section.append(el('p', { class: 'note' }, 'Bites cut from the edge of this circle.'));
    for (const set of sets) {
      const box = el('div', { class: 'nibble-set' });
      const setHead = el('div', { class: 'move-head' });
      const name = el('span', { class: 'move-name' }, nibbleName(set));
      const rename = () => {
        name.textContent = nibbleName(set); // follows its edge, count and the rates
      };
      rename.rates = true;
      syncs.push(rename);
      setHead.append(
        name,
        ...actionButtons(set, [
          ['🎲', 'New wobble', false, () => Rc.rewobble(set)],
          ['✕', 'Remove', false, () => Rc.removeMove(recipe, set.id)],
        ]),
      );
      box.append(setHead, fieldsGrid(set, redrawRecipe, syncs, ['attach']));
      section.append(box);
    }
    return section;
  }

  // A stepped ring's flight time: how long a shape takes from inner to outer radius at the
  // current rates. Not stored: setting it sets Turns. Its sync is marked `rates` so the
  // readout refreshes it when the spin or strobe rate changes.
  function flightControls(move, onChange, syncList) {
    const id = `move${move.id}-flight`;
    const label = el('label', { for: id }, 'Flight (s)');
    const range = el('input', { type: 'range', id, min: 0.1, max: 5, step: 0.05 });
    const box = el('input', { type: 'number', min: 0.01, step: 'any' });
    box.setAttribute('aria-label', 'Flight (s)');
    const step = () => M.stepPerFlash(params.spin, params.strobe);
    const show = () => {
      const seconds = Rc.spiralReading(move, step()).flashes / params.strobe;
      const flies = Number.isFinite(seconds);
      range.value = flies ? seconds : range.min;
      box.value = flies ? Number(seconds.toFixed(2)) : '';
      box.placeholder = flies ? '' : 'none';
      label.title = flies ? 'Sets Turns to make the flight last this long at the current rates.'
        : 'Nothing flies: the wheel skips no whole spacings per flash at this count.';
      label.classList.toggle('inactive', !flies);
      range.disabled = box.disabled = !flies;
    };
    show.rates = true;
    const set = (value) => {
      const turns = Rc.turnsForFlight(move, step(), Number(value) * params.strobe);
      if (turns !== null && Rc.setField(move, 'turns', turns)) onChange();
      show();
    };
    range.addEventListener('input', () => set(range.value));
    box.addEventListener('change', () => set(box.value));
    syncList.push(show);
    return [label, range, box];
  }

  // Lining a ring up with another, offered only when some ring's count fits (equal, or one a
  // multiple of the other), since otherwise the two coincide at just one point. Once a ring
  // is chosen: where the shapes sit, in line, halfway between, or elsewhere on a slider. The
  // technical view shows all of it, including an offset from the top of the wheel.
  function lineUpControls(move, onChange, syncList) {
    const offsetField = Rc.MOVE_TYPES[move.type].fields.find((f) => f.key === 'offset');
    const id = `move${move.id}-align`;
    const label = el('label', { for: id }, 'Line up with');
    const select = el('select', { id, class: 'wide' });
    select.addEventListener('change', () => {
      if (Rc.setField(move, 'align', select.value)) onChange();
    });

    let custom = false; // chosen "elsewhere": keep the slider while it passes 0 or 0.5
    const PLACES = [['inline', 'in line'], ['between', 'between', 'halfway between'], ['custom', 'elsewhere']];
    const [placeLabel, place] = segmented(`move${move.id}-place`, 'Shapes sit', PLACES, (value) => {
      custom = value === 'custom';
      if (!custom && Rc.setField(move, 'offset', value === 'between' ? 0.5 : 0)) onChange();
      show();
    });
    const offset = fieldControls(move, offsetField, onChange, syncList); // label, slider, box

    const show = () => {
      const choices = Rc.lineUpChoices(recipe, move);
      const target = Rc.alignedRing(recipe, move);
      const options = [['', 'nothing'], ...choices.map((m) => [m.id, `${moveName(m)} (${m.count})`])];
      if (target && !choices.includes(target)) {
        options.push([target.id, `${moveName(target)} (${target.count}: counts don't fit)`]);
      }
      select.replaceChildren(...options.map(([value, text]) => el('option', { value }, text)));
      select.value = move.align ?? '';
      const inactive = Rc.fieldInactive(recipe, move, 'align'); // e.g. anchored wings
      label.classList.toggle('inactive', inactive);
      select.disabled = inactive;
      for (const button of place.buttons) button.disabled = inactive;
      label.hidden = select.hidden = !technical && (inactive || (!choices.length && !target));

      const off = move.offset || 0;
      if (Math.abs(off) > 1e-9 && Math.abs(Math.abs(off) - 0.5) > 1e-9) custom = true;
      place.choose(custom ? 'custom' : Math.abs(off) > 1e-9 ? 'between' : 'inline');
      placeLabel.hidden = place.hidden = !target || (inactive && !technical);
      for (const node of offset) node.hidden = !technical && !(target && custom && !inactive);
    };
    syncList.push(show);
    return [label, select, placeLabel, place, ...offset];
  }

  // A ring's count by intent: how many shapes (about 1, 2 or 3 times the flashes per
  // revolution), which way they seem to turn, and how fast. Each choice sets the count, and
  // the choices are read back from it at the current rates. A count that matches no intent
  // (or the technical view) shows the count slider too. Anchored wings take their anchor's.
  const INTENT_CHOICES = {
    density: [[1, 'few'], [2, 'more'], [3, 'lots']],
    way: [[1, 'clockwise'], [-1, 'anticlockwise'], [0, 'still']],
    speed: [[1, 'slow'], [2, 'fast'], [3, 'very fast']],
  };
  const INTENT_LABELS = { density: 'How many', way: 'Direction', speed: 'Speed' };

  // A row of buttons acting as radio buttons, all options on one line. `pick` runs with the
  // chosen value; a change event then bubbles up, so the card records an undo step.
  // Returns the group, with `choose(value)` to show a value as chosen (none for null).
  function segmented(id, labelText, choices, pick) {
    const label = el('span', { id: `${id}-label`, class: 'seg-label' }, labelText);
    const group = el('div', { id, class: 'segmented wide', role: 'radiogroup', 'aria-labelledby': `${id}-label` });
    const buttons = choices.map(([value, text, title]) => {
      const button = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false' }, text);
      if (title) button.title = title;
      button.dataset.value = value;
      button.addEventListener('click', () => {
        pick(value);
        group.dispatchEvent(new Event('change', { bubbles: true }));
      });
      group.append(button);
      return button;
    });
    group.choose = (value) => {
      for (const button of buttons) button.setAttribute('aria-checked', String(button.dataset.value === String(value)));
    };
    group.buttons = buttons;
    return [label, group];
  }

  // A button that steps through its choices on each click (shift-click steps back), with a
  // small caption above saying what it sets. Several sit side by side on one line.
  // `pick(value)` runs with the next choice; a change event then bubbles up, so the card
  // records an undo step. Returns the cell, with `choose(value, guessed)` to show a value:
  // guessed shows the nearest choice dimmed, and a click then takes that choice first.
  function cycler(id, caption, choices, pick) {
    const button = el('button', { id, type: 'button', class: 'cycle' });
    const cell = el('div', { class: 'cycle-cell' });
    cell.caption = el('label', { for: id, class: 'cycle-caption' }, caption);
    cell.append(cell.caption, button);
    let index = 0;
    let guessed = false;
    button.addEventListener('click', (event) => {
      const next = guessed ? index : (index + (event.shiftKey ? choices.length - 1 : 1)) % choices.length;
      pick(choices[next][0]);
      button.dispatchEvent(new Event('change', { bubbles: true }));
    });
    cell.choose = (value, guess = false) => {
      index = Math.max(0, choices.findIndex(([v]) => String(v) === String(value)));
      guessed = guess;
      const [, text, title] = choices[index];
      button.textContent = text;
      button.classList.toggle('guessed', guess);
      button.title = guess ? `nearest: ${text}. Click to use it` : `${title || text}. Click for ${choices[(index + 1) % choices.length][1]}`;
    };
    cell.button = button;
    return cell;
  }

  function countControls(move, field, onChange, syncList) {
    const cells = {};
    const row = el('div', { class: 'cycles' });
    for (const key of Object.keys(INTENT_CHOICES)) {
      cells[key] = cycler(`move${move.id}-${key}`, INTENT_LABELS[key], INTENT_CHOICES[key], (value) => {
        const intent = { ...(M.countIntent(move.count, perRev) || M.nearestIntent(move.count, perRev)) };
        intent[key] = value;
        sliding = false;
        if (Rc.setField(move, 'count', M.countFor(intent.density, intent.way, intent.speed, perRev))) onChange();
        show();
      });
      row.append(cells[key]);
    }
    const count = fieldControls(move, field, onChange, syncList); // label, slider, box
    // Once the slider is in use, it stays while it passes counts that match an intent.
    let sliding = false;
    for (const type of ['pointerdown', 'keydown']) count[1].addEventListener(type, () => (sliding = true));

    const show = () => {
      const intent = M.countIntent(move.count, perRev);
      const shown = intent || M.nearestIntent(move.count, perRev); // none matches: the nearest, dimmed
      const inactive = Rc.fieldInactive(recipe, move, 'count');
      for (const [key, cell] of Object.entries(cells)) cell.choose(shown[key], !intent);
      cells.density.button.title += ` (about ${Math.round(shown.density * perRev)} at these rates)`;
      cells.speed.classList.toggle('unused', shown.way === 0); // still: no speed
      row.hidden = inactive;
      for (const node of count) node.hidden = !technical && (inactive || (intent !== null && !sliding));
    };
    show.rates = true; // the intent depends on flashes per revolution
    syncList.push(show);
    return [row, ...count];
  }

  function fieldsGrid(move, onChange, syncList, skip = []) {
    const fields = el('div', { class: 'move-fields' });
    for (const field of Rc.MOVE_TYPES[move.type].fields) {
      if (skip.includes(field.key) || field.key === 'offset') continue; // offset: with Line up with
      if (field.key === 'align') {
        fields.append(...lineUpControls(move, onChange, syncList));
        continue;
      }
      if (field.key === 'count') {
        fields.append(...countControls(move, field, onChange, syncList));
        continue;
      }
      const controls = fieldControls(move, field, onChange, syncList);
      if (field.cycle) {
        // Neighbouring cycling choices share one line.
        let row = fields.lastElementChild;
        if (!row?.classList.contains('field-cycles')) fields.append((row = el('div', { class: 'cycles field-cycles' })));
        row.append(...controls);
        continue;
      }
      fields.append(...controls);
      if (field.key === 'turns') fields.append(...flightControls(move, onChange, syncList));
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
    movesList.replaceChildren(...mainMoves().map(moveCard));
    renderDraft();
    renderTabs();
  }

  // --- Panel tabs. The side panel shows one card at a time: the overview (spin and strobe,
  // readout, count guide, solver), one move's card, or the New move card.

  const tabs = document.getElementById('tabs');
  const overview = document.getElementById('overview');
  let panelShown = 'new'; // 'overview', 'new' or a move id; New move to start with

  function showPanel(which) {
    panelShown = which;
    renderTabs();
  }

  function renderTabs() {
    if (typeof panelShown === 'number' && !mainMoves().some((m) => m.id === panelShown)) panelShown = 'new';
    const entries = [
      ['overview', 'Spin and strobe'],
      ...mainMoves().map((move) => [move.id, moveName(move)]),
      ['new', '+ New move'],
    ];
    tabs.replaceChildren(
      ...entries.map(([key, text]) => {
        const tab = el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(key === panelShown) }, text);
        tab.addEventListener('click', () => showPanel(key));
        return tab;
      }),
    );
    overview.hidden = panelShown !== 'overview';
    draftCard.hidden = panelShown !== 'new';
    movesList.hidden = typeof panelShown !== 'number';
    for (const card of movesList.children) card.hidden = Number(card.dataset.id) !== panelShown;
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
    if (draft.type === 'semicircles' && draft.attach === null) {
      // Semicircles usually sit on a circle, so start them on the most recent one.
      const circles = recipe.moves.filter((m) => m.type === 'circle');
      if (circles.length) Rc.setField(draft, 'attach', circles[circles.length - 1].id);
    }
    draftSyncs = [];

    const head = el('div', { class: 'move-head' });
    const typeLabel = el('label', { for: 'new-move-type', class: 'move-name' }, 'New move');
    const type = el('select', { id: 'new-move-type' });
    for (const [value, spec] of Object.entries(Rc.MOVE_TYPES)) {
      if (!spec.needsCircle) type.append(el('option', { value }, spec.label)); // nibbles: on a circle's card
    }
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
      panelShown = move.id; // show the new move's card, to adjust it
      if (move.type === 'circle') startDrawing(move);
      recipeChanged();
      remember();
    });

    const drawRow = el('div', { class: 'buttons draw-row' });
    drawRow.append(drawButton, techButton());
    draftCard.replaceChildren(head, fieldsGrid(draft, syncDraft, draftSyncs), drawRow);
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
    if (pen) R.drawPen(wheelCtx, wsize, pen.radius, pen.width, pen.colour);
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

  const BAND_WORDS = { slow: 'slowly', steady: 'steadily', fast: 'fast', unclear: 'fast', ambiguous: 'fast' };

  // A fraction of a spacing, as 1/k when it is close to one.
  function spacingFraction(f) {
    const k = Math.round(1 / Math.abs(f));
    const nice = k >= 2 && k <= 100 && Math.abs(1 / Math.abs(f) - k) < 0.02 * k;
    return nice ? `1/${k}` : fmt(Math.abs(f), 3);
  }

  // How a counted ring moves: count ÷ flashes per revolution, less the nearest whole
  // number, is how far it seems to move per flash as a fraction of its spacing.
  function describeMotion(move, s) {
    const n = move.count;
    const d = M.apparentStep(s, n);
    if (s === 0) return 'stands still, because the wheel is not spinning';
    const perRev = M.TAU / s;
    const f = M.driftFraction(perRev, n);
    const band = M.driftBand(f);
    const sum = `${n} ÷ ${fmt(perRev)} = ${fmt(n / perRev, 3)}`;
    if (band === 'still') return `${sum}, a whole number, so it <b>stands still</b>`;
    const way = d > 0 ? 'with the wheel</b> (clockwise)' : 'against the wheel</b> (anticlockwise)';
    const pass = 1 / (Math.abs(f) * params.strobe);
    return `${sum}, so it moves <b>${BAND_WORDS[band]} ${way}, ${spacingFraction(f)} of a spacing
      (${fmt(Math.abs(deg(d)))}°) per flash. Each takes <b>${fmt(pass)} s</b> to reach its neighbour's place`;
  }

  function describeRing(move, s) {
    const n = move.count;
    const a = M.markSpacing(n);
    const band = s === 0 ? 'still' : M.driftBand(M.driftFraction(M.TAU / s, n));

    let warning = '';
    if (band === 'ambiguous') {
      warning = ' <span class="warn">That is close to half a spacing per flash, so the direction will look ambiguous.</span>';
    } else if (band === 'unclear') {
      warning = ' <span class="warn">At over 0.3 of a spacing per flash the direction may be hard to read.</span>';
    }

    return `<p><b>${moveName(move)}</b> (${n} ${Rc.MOVE_TYPES[move.type].noun}, ${fmt(deg(a))}° apart):
      ${describeMotion(move, s)}.${move.type === 'stepped' ? describeSpiral(move, s) : ''}${move.type === 'wings' ? describeWings(move, s) : ''}${warning}</p>`;
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
    const shapes = Rc.steppedTotal(move);
    const why = reading === 'still' ? '' : ` (the wheel skips ${Math.abs(skip)} spacing${Math.abs(skip) === 1 ? '' : 's'} per flash)`;
    let text = ` With its ${shapes} shapes it ${SPIRAL_READINGS[reading]}${why}.`;
    if (reading !== 'still') text += ` ${describeFlight(move, s, flashes, lag)}`;
    if ((move.shape === 'bird' || move.shape === 'bat') && move.flap > 0 && skip !== 0) {
      // Each flash moves on `skip` drawings along the sequence, so `skip` steps of the beat.
      const beats = (Math.abs(skip) * params.strobe) / move.flap;
      text += ` The ${move.shape}s flap about <b>${fmt(beats, 1)}</b> times a second.`;
      if (Math.abs(skip) * 2 >= move.flap) {
        text += ` <span class="warn">With ${move.flap} drawings per beat and ${Math.abs(skip)} skipped per flash, the beat will look jumbled; use more drawings per beat.</span>`;
      }
    }
    if (reading === 'in' || reading === 'out') {
      text += ` Switch <i>Climbs</i> to make it spiral ${reading === 'in' ? 'outward' : 'inward'}.`;
    }
    if (strain > 0.75) {
      text += ` <span class="warn">The radius changes a lot between neighbouring shapes, so the eye may match the wrong ones and the motion may break up. Try more positions, more turns or a smaller radius range.</span>`;
    }
    return text;
  }

  // Whether the screen can show the strobe as described: it shows only so many frames a
  // second, and a strobe rate that divides evenly into that lands the same way every frame.
  function describeScreen(perRev) {
    if (screenRate === null) return '';
    const shown = `Your screen shows about ${screenRate} frames a second`;
    if (params.strobe > screenRate * 1.02) {
      return ` <span class="warn">${shown}, fewer than the ${fmt(params.strobe, 1)} flashes, so the strobe view cannot show every flash and may not match this description. Lower the spin rate to bring the strobe rate down.</span>`;
    }
    const k = Math.round(screenRate / params.strobe);
    const even = screenRate / k;
    if (Math.abs(params.strobe - even) < 0.01 * even || !Number.isFinite(perRev)) return '';
    return ` ${shown}; strobe rates that divide evenly into it look steadiest. A spin rate of ${fmt(even / perRev, 3)} rev/s would give ${fmt(even, 1)} flashes a second.`;
  }

  function updateReadout() {
    const s = M.stepPerFlash(params.spin, params.strobe);
    const perRev = M.TAU / s;
    const wheel = s === 0
      ? 'The wheel is not spinning.'
      : `<b>${fmt(perRev)} flashes per revolution</b> at ${fmt(params.spin)} rev/s, so the strobe flashes
        <b>${fmt(params.strobe, 1)} times a second</b> and the wheel turns ${fmt(deg(s))}° between flashes.`;
    readout.innerHTML = `
      <p>${wheel}${describeScreen(perRev)}</p>
      ${Rc.countedMoves(recipe).map((move) => describeRing(move, s)).join('')}`;
    updateCountGuide(perRev);
    for (const sync of [...syncs, ...draftSyncs]) if (sync.rates) sync();
  }

  // --- Count guide: which counts stand still or move, and which way, at the current
  // flashes per revolution. The same for marks, semicircles, nibbles, wings and stepped rings.

  const countGuide = document.getElementById('count-guide');
  const GUIDE_ROWS = [
    ['slow', 'Slowly', 'up to 1/10'],
    ['steady', 'Steadily', 'up to 1/5'],
    ['fast', 'Fast', 'up to 3/10'],
  ];

  function updateCountGuide(perRev) {
    if (!Number.isFinite(perRev)) {
      countGuide.innerHTML = '<p class="note">Set the wheel spinning to see which counts move.</p>';
      return;
    }
    const g = M.countGuide(perRev, 3, 48);
    const list = (counts) => (counts.length ? counts.join(', ') : '—');
    const rows = GUIDE_ROWS.map(
      ([key, label, how]) => `<tr><th>${label}<br><span class="note">${how} spacing per flash</span></th>
        <td>${list(g[key].with)}</td><td>${list(g[key].against)}</td></tr>`,
    ).join('');
    countGuide.innerHTML = `
      <p class="note">Counts from 3 to 48 at ${fmt(perRev)} flashes per revolution.</p>
      <table>
        <tr><th></th><th>With the wheel</th><th>Against the wheel</th></tr>
        ${rows}
      </table>
      <p class="note"><b>Still:</b> ${list(g.still)}.</p>
      <p class="note"><b>Hard to read:</b> ${list(g.unclear)}. <b>Ambiguous:</b> ${list(g.ambiguous)}.</p>`;
  }

  // --- Solver: pick rates so rings A and B drift at equal speed in opposite directions.

  const solverNote = document.getElementById('solver-note');
  const ringChoice = [document.getElementById('ring-a'), document.getElementById('ring-b')];
  const solveButton = document.getElementById('solve');
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
    solveButton.disabled = !pair;
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

  // Sets flashes per revolution, keeping the spin rate (so the strobe rate follows).
  function solve() {
    const [a, b] = pair.map((id) => recipe.moves.find((m) => m.id === id));
    const m1 = Math.max(1, Math.round(Number(document.getElementById('m1').value) || 1));
    const m2 = Math.max(1, Math.round(Number(document.getElementById('m2').value) || 1));
    const s = M.opposingStep(a.count, b.count, m1, m2);
    perRev = M.TAU / s;
    if (params.spin > 0) setters.strobe(perRev * params.spin);
    else {
      setters.fpr(perRev);
      updateReadout();
    }

    const opposite = Math.abs(M.apparentStep(s, a.count) + M.apparentStep(s, b.count)) < 1e-9;
    solverNote.textContent = opposite
      ? `Set ${fmt(perRev)} flashes per revolution, with ${m1} and ${m2} spacing${m1 === 1 && m2 === 1 ? '' : 's'} per flash.`
      : `These skip counts (${m1}, ${m2}) push a ring past its aliasing limit for ${a.count} and ${b.count}, so the drift won't be equal and opposite. Try smaller values.`;
  }

  // --- Strobe loop. The wheel angle is integrated over time so changing the spin rate
  // never makes it jump. Each flash fades the ink by the afterglow and stamps the marks
  // at the wheel angle of that flash. Several flashes can land in one display frame.

  let wheelAngle = 0;
  let lastTime = null;
  let nextFlash = null;
  let paused = false;

  // Flashes are timed from a frame time plus this, so a strobe rate that divides evenly into
  // the screen's never sits on a frame boundary, where jitter would show two flashes, then none.
  const FLASH_OFFSET = 0.004;

  // The screen's refresh rate, measured from frame times, for the readout.
  let screenRate = null;
  const frameGaps = [];

  function measureScreen(gap) {
    if (!(gap > 0 && gap < 0.1)) return; // skip the first frame and stalls
    frameGaps.push(gap);
    if (frameGaps.length < 60) return;
    const sorted = frameGaps.splice(0).sort((x, y) => x - y);
    const rate = Math.round(1 / sorted[30]);
    if (screenRate === null || Math.abs(rate - screenRate) > 2) {
      screenRate = rate;
      updateReadout();
    }
  }

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
      nextFlash = t + FLASH_OFFSET;
    }
    measureScreen(t - lastTime);

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
      if (nextFlash <= t) nextFlash = t + FLASH_OFFSET; // fell behind (e.g. hidden tab): skip ahead
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

  // Spin and strobe rates are what is saved and undone. Flashes per revolution links them:
  // changing it or the spin rate moves the strobe rate to keep the pattern; changing the
  // strobe rate (or the solver changing either rate) moves it. It is held while the wheel
  // is stopped, so spinning up again restores the same pattern.
  let perRev = 12;

  function holdPerRev() {
    if (params.spin > 0 && params.strobe > 0) perRev = M.flashesPerRev(params.spin, params.strobe);
    setters.fpr(perRev);
  }

  bindControl('fpr', (byUser) => {
    if (!byUser) return;
    if (params.fpr > 0) perRev = params.fpr;
    if (params.spin > 0) setters.strobe(perRev * params.spin);
    else holdPerRev();
  });
  bindControl('spin', (byUser) => {
    if (byUser && params.spin > 0) setters.strobe(perRev * params.spin); // (updates the readout)
    else {
      holdPerRev();
      updateReadout();
    }
  });
  bindControl('strobe', () => {
    if (lastTime !== null) nextFlash = Math.min(nextFlash, lastTime + FLASH_OFFSET + 1 / params.strobe);
    holdPerRev();
    updateReadout();
  });
  bindControl('afterglow', () => {});
  holdPerRev();

  document.getElementById('spin').closest('fieldset').addEventListener('change', remember);
  solveButton.addEventListener('click', () => {
    solve();
    remember();
  });

  const pauseButton = document.getElementById('pause');
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    if (!paused) nextFlash = lastTime + FLASH_OFFSET;
  });

  window.addEventListener('resize', rebuildLayers);

  const pauseRow = el('div', { class: 'buttons' });
  pauseButton.replaceWith(pauseRow);
  pauseRow.append(pauseButton, techButton());
  setTechnical(false);

  renderCards();
  rebuildLayers();
  history = H.createHistory(snapshot());
  requestAnimationFrame(frame);
})();
