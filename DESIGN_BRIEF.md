# JmwSpinner: design brief

Project folder: `/Users/davidartus/repos/JmwSpinner`

## Status: design agreed, nothing built yet

The open questions have been answered (see "Resolved questions" at the bottom). **Do not scaffold or build until David says to.**

## Workflow

Simple trunk model: `main` is the trunk, with short-lived branches for specific issues and features, merged back into `main`.

## Goal

A JavaScript emulation of the hand-drawn "spin art" animations by LimbaTrip (Yohei Kisanuki), in the phenakistoscope family. The emulation should use the computer to lower the skill needed for the incremental drawing process the artist uses.

## The technique being emulated

- A whiteboard-style wheel spins slowly. A wide pen draws a circle on it.
- The wheel is stopped. A finger makes indentations in the rim, and a *different number* of small semicircles is drawn on the inside.
- When the wheel is spun, the outer set of marks appears to rotate clockwise and the inner set anticlockwise.
- The **ratio of mark counts between the rings is vital**: it is what makes the rings drift in different directions.

## Decisions made so far

- **Configurable values.** The key values (mark counts, radii, strobe rate, spin rate, etc.) must be user-adjustable, not fixed in code.
- **Simple starting repertoire of drawing moves.** Start small and grow it.
- **Computer assistance** to lower the skill needed for the incremental drawing process. The exact form is still open (see below).
- **Viewing model: an adjustable strobe**, not a fixed-frame-rate camera. The user sets the strobe rate.
- **Stepped ring move.** A shape is placed around a ring at the same angular positions as that ring's notches/semicircles, but at *increasing radius* from one position to the next. Its count is tied to the chosen ring. Default is **out only**; a **loop-back (out then in)** is a second option. (Design note: with strobed apparent rotation the shapes should appear to spiral outward; out-only leaves a seam where the radius jumps back at the wrap-around, and loop-back avoids that.)
- **Spiral direction depends on the strobe.** Whether a stepped ring appears to spiral outward or inward depends on the sign of that ring's apparent step `d_N` *and* which way round the wheel the radius increases. The same drawing can spiral in at one strobe rate and out at another. The tool should show which way it will read, or flip the stepping direction to give the requested spiral.
- **Drawing as a recipe**, with freehand deferred to a later, separate feature.
- **Assistance starts as snapping plus ghost guides**: marks snap to evenly spaced positions and a faint preview shows where the next set will go. A step-by-step guided recipe can come later on the same move list.
- **Two views side by side**: the static wheel view and the strobe view, with adjustable persistence (zero gives a pure strobe).
- **Platform**: plain HTML/JS/canvas with no build step, openable directly in a browser. Revisit if it outgrows that.

## The maths worth building in

Let `s` be the angle the wheel advances between strobe flashes, in radians (`s = spin rate / strobe rate`). For a ring with `N` marks the spacing is `a = 2π/N`. What the viewer sees per flash is the leftover after removing whole mark spacings:

```
apparent step d_N = s − a · round(s / a)        (range −a/2 … +a/2)
```

Positive means the ring appears to turn in the same direction as the wheel, negative means the opposite. So **opposite apparent directions come from choosing the mark counts and the strobe rate together**.

To get two rings (`N1`, `N2`) drifting in opposite directions at equal angular speed, choose integers `m1`, `m2` (usually both 1) and solve for the step:

```
s = π · (m1/N1 + m2/N2)
```

Worked example: `N1 = 12`, `N2 = 13`, `m1 = m2 = 1` gives `s ≈ 0.5034 rad`, about 12.48 flashes per revolution. Ring 1 steps about −0.0202 rad per flash and ring 2 about +0.0201 rad per flash.

The tool should be able to **solve for the strobe rate from the chosen mark counts and desired apparent speeds**, rather than leaving David to tune it by eye. Note the aliasing limit: the apparent step must stay within ±a/2 per ring to read as smooth motion.

## Suggested architecture (open to challenge)

- **Drawing as a recipe, not pixels.** Store each move as parameters (ring radius, mark count, shape, phase, radial step, etc.) and re-render from them. Changing any value redraws everything. This fits the "configurable values" goal. Freehand strokes can be a later, separate feature.
- **Two views.** A static "wheel" view (what the artist is drawing, in the wheel's own frame) and a "strobe" view (what the viewer would see when spinning).
- **Strobe rendering.** Draw the wheel into an offscreen canvas, then at each flash time rotate it by the accumulated wheel angle. Optional persistence/decay between flashes to mimic an eye or camera exposure.
- **Starting moves** (agreed): solid circle (the wide-pen stroke), plain ring of marks, ring of semicircles, stepped ring.

## Resolved questions

1. **What does the "assistance" look like?** Snapping to evenly spaced positions plus ghost guides for the next mark set. A step-by-step guided recipe is deferred.
2. **Is drawing-as-a-recipe the right foundation?** Yes; freehand is deferred.
3. **Views?** Static wheel view and strobe view side by side, with adjustable persistence.
4. **Starting moves?** The suggested three, plus a solid circle.
5. **Platform?** Plain HTML/JS/canvas, no build step.
