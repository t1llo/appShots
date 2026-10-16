// The arithmetic of a slider whose middle is a default: kept apart from React so it can be tested on its own.

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * The ends of a range input whose steps pass through `base`. A browser only stops on the start plus whole steps, so
 * a default off that grid, such as a size of 95% on a slider from 40% in steps of 2%, could not be reached again
 * by dragging or by the arrow keys. The ends move in by less than a step where they have to.
 */
export function rangeThrough(base: number, min: number, max: number, step: number): { min: number; max: number } {
  if (!(base > min && base < max)) return { min, max };
  const start = round(base - Math.floor(round((base - min) / step)) * step);
  return { min: start, max: round(start + Math.floor(round((max - start) / step)) * step) };
}

/** Whether a slider stands on its default, give or take what adding up steps in floating point leaves behind. */
export const atBase = (value: number, base: number, step: number) => Math.abs(value - base) < step / 1000;
