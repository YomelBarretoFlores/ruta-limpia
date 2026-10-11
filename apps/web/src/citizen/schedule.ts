import type { ScheduleEntry } from './api/types';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** The week as people read it: Monday first, Sunday last. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The printed schedule as short lines, joining consecutive days with the same start:
 * `Lunes a viernes: 07:00`, `Sábado: 08:00`.
 */
export function formatSchedule(schedule: readonly ScheduleEntry[]): string[] {
  const days = WEEK_ORDER.flatMap((weekday) =>
    schedule
      .filter((entry) => entry.weekday === weekday)
      .map((entry) => ({ weekday, time: entry.plannedStart })),
  );
  const groups: { first: number; last: number; time: string; count: number }[] = [];
  for (const day of days) {
    const group = groups[groups.length - 1];
    const follows =
      group !== undefined &&
      group.time === day.time &&
      WEEK_ORDER.indexOf(day.weekday) === WEEK_ORDER.indexOf(group.last) + 1;
    if (follows) {
      group.last = day.weekday;
      group.count += 1;
    } else {
      groups.push({ first: day.weekday, last: day.weekday, time: day.time, count: 1 });
    }
  }
  return groups.map(({ first, last, time, count }) => {
    const label =
      count === 1
        ? WEEKDAYS[first]!
        : `${WEEKDAYS[first]!} ${count === 2 ? 'y' : 'a'} ${WEEKDAYS[last]!}`;
    return `${capitalize(label)}: ${time}`;
  });
}
