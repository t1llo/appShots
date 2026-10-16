import assert from "node:assert/strict";
import { test } from "node:test";
import { atBase, rangeThrough } from "../../web/src/ui/range.ts";

// A browser's range input stops only on its start plus whole steps, so a slider's default has to lie on that grid.

/** Every value the slider can stop on. */
const stops = ({ min, max }: { min: number; max: number }, step: number) => Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + index * step);

test("a default off the grid of steps moves the ends in by less than a step", () => {
  const range = rangeThrough(0.95, 0.4, 1.6, 0.02);
  assert.deepEqual(range, { min: 0.41, max: 1.59 });
  assert.ok(stops(range, 0.02).some((value) => atBase(value, 0.95, 0.02)), "dragging can land on the default again");
});

test("a default already on the grid leaves the range as it is", () => {
  assert.deepEqual(rangeThrough(0, -20, 20, 1), { min: -20, max: 20 });
  assert.deepEqual(rangeThrough(1, 0.5, 1.5, 0.05), { min: 0.5, max: 1.5 });
});

test("a default at or beyond an end leaves the range as it is", () => {
  assert.deepEqual(rangeThrough(0, 0, 10, 3), { min: 0, max: 10 });
  assert.deepEqual(rangeThrough(12, 0, 10, 3), { min: 0, max: 10 });
});

test("a value that adding up steps left a hair off the default counts as the default", () => {
  assert.equal(atBase(0.41 + 27 * 0.02, 0.95, 0.02), true);
  assert.equal(atBase(0.97, 0.95, 0.02), false);
});
