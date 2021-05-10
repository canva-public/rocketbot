/**
 * Do what zip does in every other language ever
 */
export function zip<S, T>(xs: S[], ys: T[]): [S, T][] {
  if (xs.length !== ys.length) {
    throw new Error('xs and ys must have the same length');
  }
  return xs.map((x, i) => [x, ys[i]]);
}
