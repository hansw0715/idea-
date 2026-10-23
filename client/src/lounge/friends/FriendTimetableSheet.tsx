import { useEffect, useMemo, useState } from 'react';
import type { QuickMember } from '../../../../shared/lounge';
import TimetableGrid from '../../components/TimetableGrid';
import type { GridEntry } from '../../components/TimetableGrid';
import { CLOSE_MIN, GRID_DEFAULT_CLOSE_MIN } from '../../time';
import { Alert, LoadingBlock, Sheet } from '../../ui';
import { useWeek } from '../../useWeek';
import { loungeApi } from '../api';
import type { FriendTimetableEntry } from '../api';

/**
 * 친구 시간표 보기 — 친구의 수업·일정을 주 단위로 본다 (보기만, 예약은 보이지 않는다).
 */
export default function FriendTimetableSheet({ friend, onClose }: { friend: QuickMember | null; onClose: () => void }) {
  const { weekStart, slide, prevWeek, nextWeek } = useWeek();
  const [entries, setEntries] = useState<FriendTimetableEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!friend) return;
    let cancelled = false;
    setError(null);
    loungeApi
      .friendTimetable(friend.id, weekStart)
      .then((r) => !cancelled && setEntries(r.entries))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : '시간표를 불러오지 못했어요.'));
    return () => {
      cancelled = true;
    };
  }, [friend, weekStart]);

  // 닫으면 다음에 다른 친구를 열 때 지난 시간표가 잠깐 보이지 않게 비운다
  useEffect(() => {
    if (!friend) setEntries(null);
  }, [friend]);

  const grid = useMemo<GridEntry[]>(
    () =>
      (entries ?? []).map((e) => ({
        id: e.id,
        day: e.day,
        startMin: e.startMin,
        endMin: e.endMin,
        title: e.title,
        place: e.place || undefined,
        kind: 'class' as const,
      })),
    [entries],
  );
  const latestEnd = grid.reduce((max, e) => Math.max(max, e.endMin), 0);
  const closeMin = Math.min(CLOSE_MIN, Math.max(GRID_DEFAULT_CLOSE_MIN, Math.ceil(latestEnd / 60) * 60));

  return (
    <Sheet open={friend !== null} onClose={onClose} title={friend ? `${friend.name} 님의 시간표` : '친구 시간표'} full>
      {error ? (
        <Alert tone="danger" title="시간표를 불러오지 못했어요.">
          {error}
        </Alert>
      ) : entries === null ? (
        <LoadingBlock>시간표를 불러오는 중이에요.</LoadingBlock>
      ) : (
        <>
          {grid.length === 0 && <p className="text-sub text-sm">이번 주에 등록한 수업이나 일정이 없어요.</p>}
          <TimetableGrid
            entries={grid}
            weekStart={weekStart}
            slide={slide}
            onPrevWeek={prevWeek}
            onNextWeek={nextWeek}
            closeMin={closeMin}
          />
        </>
      )}
    </Sheet>
  );
}
