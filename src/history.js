// Undo and redo for JmwSpinner. Keeps whole snapshots (strings, e.g. JSON), which are
// small for a recipe. Pure functions, no DOM. Loaded as a classic script in the browser
// (window.JmwHistory) and via require() in tests.
(function (root) {
  'use strict';

  function createHistory(initial, limit = 200) {
    return { past: [], present: initial, future: [], limit };
  }

  // Record a new state after a change. Returns false (and records nothing) if it is the
  // same as the current state. A new change clears anything that could have been redone.
  function commit(history, snapshot) {
    if (snapshot === history.present) return false;
    history.past.push(history.present);
    if (history.past.length > history.limit) history.past.shift();
    history.present = snapshot;
    history.future = [];
    return true;
  }

  // Step back (or forward); returns the state to restore, or null if there is none.
  function undo(history) {
    if (!history.past.length) return null;
    history.future.push(history.present);
    history.present = history.past.pop();
    return history.present;
  }

  function redo(history) {
    if (!history.future.length) return null;
    history.past.push(history.present);
    history.present = history.future.pop();
    return history.present;
  }

  const canUndo = (history) => history.past.length > 0;
  const canRedo = (history) => history.future.length > 0;

  const api = { createHistory, commit, undo, redo, canUndo, canRedo };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.JmwHistory = api;
  }
})(this);
