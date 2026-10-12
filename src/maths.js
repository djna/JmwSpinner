// Strobe maths for JmwSpinner. Pure functions, no DOM.
// Loaded as a classic script in the browser (window.JmwMaths) and via require() in tests.
(function (root) {
  'use strict';

  const TAU = 2 * Math.PI;

  // Angle the wheel advances between strobe flashes, in radians.
  // spinRate is in revolutions per second, strobeRate in flashes per second.
  function stepPerFlash(spinRate, strobeRate) {
    return (TAU * spinRate) / strobeRate;
  }

  // Angular spacing between marks on a ring of N marks.
  function markSpacing(count) {
    return TAU / count;
  }

  // What the viewer sees per flash for a ring of `count` marks: the wheel step
  // with whole mark spacings removed. Range -a/2 .. +a/2. Positive means the ring
  // appears to turn the same way as the wheel, negative means the opposite way.
  function apparentStep(step, count) {
    const a = markSpacing(count);
    return step - a * Math.round(step / a);
  }

  // How close the apparent step is to the aliasing limit, as a fraction of a/2.
  // Near 1 the direction of motion becomes ambiguous.
  function aliasingRatio(step, count) {
    return Math.abs(apparentStep(step, count)) / (markSpacing(count) / 2);
  }

  const api = { TAU, stepPerFlash, markSpacing, apparentStep, aliasingRatio };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.JmwMaths = api;
  }
})(this);
