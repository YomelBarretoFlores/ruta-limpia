/** Rounds to one decimal, for public measurements (meters to decimeters, percentages to 0.1). */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
