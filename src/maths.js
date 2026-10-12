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

  // The step per flash that makes two rings (count1, count2 marks) drift at equal speed
  // in opposite directions. m1 and m2 are how many whole mark spacings each ring
  // advances per flash before the leftover drift (usually both 1).
  //   s = m1·a1 + d = m2·a2 − d   =>   s = π·(m1/N1 + m2/N2)
  function opposingStep(count1, count2, m1 = 1, m2 = 1) {
    return Math.PI * (m1 / count1 + m2 / count2);
  }

  // Rates that give a wanted step per flash, holding the other rate fixed.
  function strobeRateFor(step, spinRate) {
    return (TAU * spinRate) / step;
  }

  function spinRateFor(step, strobeRate) {
    return (step * strobeRate) / TAU;
  }

  const api = {
    TAU,
    stepPerFlash,
    markSpacing,
    apparentStep,
    aliasingRatio,
    opposingStep,
    strobeRateFor,
    spinRateFor,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.JmwMaths = api;
  }
})(this);
