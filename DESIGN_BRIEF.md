# JmwSpinner: design brief

Project folder: `/Users/davidartus/repos/JmwSpinner`

## Status: design agreed, nothing built yet

The open questions have been answered (see "Resolved questions" at the bottom). **Do not scaffold or build until David says to.**

## Workflow

Simple trunk model: `main` is the trunk, with short-lived branches for specific issues and features, merged back into `main`.

## Roadmap (agreed order of slices)

1. **First slice** (done, `feature/first-slice`): one ring of marks, wheel and strobe views, spin/strobe/afterglow controls, strobe maths readout.
2. **Second ring and strobe solver** (done, `feature/second-ring`): two rings, and solving the strobe rate (keeping spin) or the spin rate (keeping strobe) for equal and opposite drift, with the skip counts `m1`, `m2` adjustable.
3. **More moves and an editable recipe** (done, `feature/more-moves`): solid circle, ring of semicircles; add, remove and reorder moves. A ring of semicircles can attach to the inner or outer edge of a solid circle and follow it, with the bulge direction chosen separately (prongs or hoops). Rings of marks and semicircles have a configurable wobble (seeded hand-drawn imperfections) that gives a living pulse under the strobe; a solid circle needs none, since the pen is held still while the wheel turns. A move is configured before it is drawn, and a solid circle is drawn by turning the wheel under a pen. The solver works on any two counted rings (rings A and B), defaulting to the outermost and innermost.
4. **Nibbles and alignment** (done, `feature/nibbles`): rings of bites cut into a solid circle from its inner or outer edge, semicircular or cog-shaped (square notch), with wobble. Every counted ring can align with another ring and be offset by a fraction of its spacing (0 in line, 0.5 halfway between); shapes line up one for one when the counts match or divide. Also undo and redo for the recipe and the spin and strobe rates.
5. **Stepped ring** (done, `feature/stepped-ring`): dots, semicircles or marks at a ring's positions (its own count), stepping in radius from inner to outer. Patterns: out and back (the default) or out only, over one or more turns, so one turn out and back goes half a rotation out and half back, and two turns go a full rotation out and a full rotation back. The radius can climb clockwise or anticlockwise. To look as if the shapes are thrown from another ring (e.g. outward semicircles), the inner radius can start just beyond that ring (a gap, following it), and a trail makes shapes lag further behind the further out they are. The readout says how it reads at the current strobe: spiralling in or out (set by the whole spacings skipped per flash, `round(s/a)`, and the climb direction; the leftover drift `d_N` sets the twist), breathing (out and back: half the ring moves out and half in), or no radial motion, and warns when the radial step is large next to the gap between shapes. It also gives the flight: how long a shape takes to travel out and how far round it drifts meanwhile (one sequence step per flash, so a longer flight needs more shapes or more drift; trail is included). Also: save and open the whole setup as a JSON file.
6. **Ring of wings** (done, `feature/wings`): triangular wings, base on an anchor (by default the top of each semicircle in a ring, taking that ring's count, positions and wobble) and point outward. The top wing points straight out; each next one round the ring leans a further `spins × 360°/N`, by default against the ring (with 12, 1 o'clock leans 30° left, 11 o'clock 30° right), so on the still wheel they are all parallel and under the strobe each seems to spin. Options: lean with the ring, spins (0 = all straight out), length, base width, gap, filled or outline, wobble. The readout gives each wing's apparent spin per flash. Also: new semicircle rings default to the latest circle's outer edge, bulging to the rim.
7. **Birds and bats** (done, `feature/birds`): the stepped ring can draw cartoon outline birds (gulls) or bats instead of dots, heading away from the centre. Neighbours in the sequence are drawn at successive points of a wingbeat (Flap: drawings per beat), so under the strobe they flap as they fly; the readout gives the flap rate and warns when too few drawings per beat make it jumbled.
8. **Colour** (done, `feature/colour`): each drawing move has its own colour (nibbles have none, since they cut ink away). Colour changes from one shape to the next in a sequence would flicker if abrupt; gradual changes (e.g. dots shifting colour as they fly out) could work like the flapping, and are a possible next step.
9. **Fractional turns** (`feature/fractional-turns`): a stepped ring's turns need not be whole (quarter steps on the slider, any value in the box), giving `round(count × turns)` shapes; the extra shapes share positions with the first ones, further out. Prompted by a photo of the artist's thrown dots: about 16 positions, 1¼ turns out only, from just outside the central pattern (about 0.55 of the radius) to near the rim (about 0.95), big dots, and a flight of about 1.5 s, which needs about 13 flashes/s and a spin of about 0.83 rev/s (one spacing skipped per flash).
10. **Snapping and ghost guides** (postponed).
11. **Later**: guided step-by-step recipe, then freehand strokes.

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
- **Stepped ring move.** A shape is placed around a ring at evenly spaced angular positions, but at *increasing radius* from one position to the next. It has its own count (it can align with another ring). Default is **loop-back (out then in)**; **out only** is the other option, and either can span several turns. (Design note: with strobed apparent rotation the shapes should appear to spiral outward; out-only leaves a seam where the radius jumps back at the wrap-around, and loop-back avoids that.)
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
- **Starting moves** (agreed): solid circle (the wide-pen stroke), plain ring of marks, ring of semicircles, nibbles (bites from a circle's edge), stepped ring.

## Resolved questions

1. **What does the "assistance" look like?** Snapping to evenly spaced positions plus ghost guides for the next mark set. A step-by-step guided recipe is deferred.
2. **Is drawing-as-a-recipe the right foundation?** Yes; freehand is deferred.
3. **Views?** Static wheel view and strobe view side by side, with adjustable persistence.
4. **Starting moves?** The suggested three, plus a solid circle.
5. **Platform?** Plain HTML/JS/canvas, no build step.
