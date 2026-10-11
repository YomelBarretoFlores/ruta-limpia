import type { Clock } from '../application/clock.js';

export const systemClock: Clock = Object.freeze({ now: () => new Date() });
