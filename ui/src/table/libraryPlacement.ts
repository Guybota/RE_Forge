import type { Choice } from '../engine';

export function placementIndices(choice: Choice) {
  const all = (choice.options ?? []).map((_, i) => i);
  const permutation = choice.kind === 'arrange';
  const movable = permutation ? all.filter(i => choice.movable?.includes(i)) : all;
  const fixed = all.filter(i => !movable.includes(i));
  return { all, movable, fixed, permutation };
}

/** Keep the engine's answer contract: Scry returns a full permutation, Surveil a selected ordered subset. */
export function placementAnswer(choice: Choice, top: number[], moved: number[]) {
  const { fixed, permutation } = placementIndices(choice);
  return permutation ? [...top, ...fixed, ...moved] : choice.placement === 'top' ? top : moved;
}
