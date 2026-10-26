import type { GridEntry } from './components/TimetableGrid';

/** 겹치거나 맞닿은 팀원 일정을 요일 전체 폭의 회색 박스 하나로 합친다. */
export function mergeMeetingTimetable(entries: GridEntry[]): GridEntry[] {
  const classes = entries.filter((entry) => entry.kind !== 'reservation' && entry.startMin < entry.endMin);
  const blocks: GridEntry[] = [];
  const days = [...new Set(classes.map((entry) => entry.day))].sort((a, b) => a - b);

  for (const day of days) {
    const dayEntries = classes.filter((entry) => entry.day === day)
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    let current: GridEntry | null = null;

    for (const entry of dayEntries) {
      if (current && entry.startMin <= current.endMin) {
        current.endMin = Math.max(current.endMin, entry.endMin);
        current.sourceEntries!.push(entry);
        current.title = '팀원 일정';
        continue;
      }

      current = {
        id: -(blocks.length + 1),
        kind: 'class',
        day,
        startMin: entry.startMin,
        endMin: entry.endMin,
        title: entry.title,
        sourceEntries: [entry],
      };
      blocks.push(current);
    }
  }

  return [...blocks, ...entries.filter((entry) => entry.kind === 'reservation')];
}
