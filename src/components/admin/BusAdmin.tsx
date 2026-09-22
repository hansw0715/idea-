'use client';

/**
 * 관리자 — 셔틀 데이터 편집. (담당: 한승원)
 * 노선 하나(정류장·시간표 포함)를 폼에서 고친 뒤 통째로 저장한다. 검증은 서버(validateRoute)가 한다.
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Tabs, Textarea } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { deleteBusRoute, fetchBus, saveBusCalendar, saveBusRoute } from '@/lib/bus-api';
import type { BusSnapshot } from '@/features/bus/service';
import { DAY_TYPE_LABEL, DAY_TYPES, type BusRoute, type BusStop, type VacationPeriod } from '@/features/bus/types';

const NEW = '__new__';

const blankRoute = (): BusRoute => ({
  id: `route-${Date.now().toString(36)}`,
  name: '',
  color: '#1f4fd8',
  order: 99,
  stops: [],
  timetables: { weekday: [], weekend: [], vacation: [] },
});

/** "08:00, 08:20\n09:00" → ["08:00","08:20","09:00"] */
const parseTimes = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/^\d:\d\d$/.test(t) ? `0${t}` : t));

export function BusAdmin() {
  const [snapshot, setSnapshot] = useState<BusSnapshot | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [draft, setDraft] = useState<BusRoute | null>(null);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function apply(s: BusSnapshot, keep?: string) {
    setSnapshot(s);
    const id = keep && s.network.routes.some((r) => r.id === keep) ? keep : (s.network.routes[0]?.id ?? NEW);
    pick(id, s);
  }

  const reload = async (keep?: string) => apply(await fetchBus(), keep);

  function pick(id: string, s = snapshot) {
    setSelected(id);
    const route = id === NEW ? blankRoute() : structuredClone(s!.network.routes.find((r) => r.id === id)!);
    setDraft(route);
    setTimes(Object.fromEntries(DAY_TYPES.map((d) => [d, route.timetables[d].join(', ')])));
    setMsg(null);
  }

  useEffect(() => {
    fetchBus()
      .then((s) => apply(s))
      .catch(() => setMsg({ ok: false, text: '불러오기 실패' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!snapshot || !draft) return <div className="h-40 animate-pulse rounded-lg bg-surface-muted" />;

  const setStop = (i: number, patch: Partial<BusStop>) =>
    setDraft({ ...draft, stops: draft.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const moveStop = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.stops.length) return;
    const stops = [...draft.stops];
    [stops[i], stops[j]] = [stops[j], stops[i]];
    setDraft({ ...draft, stops });
  };

  const addStop = () => {
    const last = draft.stops.at(-1);
    setDraft({
      ...draft,
      stops: [
        ...draft.stops,
        {
          id: `${draft.id}-s${Date.now().toString(36)}`,
          name: '',
          // 새 정류장은 직전 정류장 근처(없으면 학교)에 두고 나중에 좌표를 고친다.
          lat: last?.lat ?? 37.5826,
          lng: last?.lng ?? 127.0102,
          order: draft.stops.length,
          offsetMin: (last?.offsetMin ?? 0) + 2,
        },
      ],
    });
  };

  async function run(action: () => Promise<unknown>, okText: string, keep?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      await reload(keep);
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : '저장 실패' });
    } finally {
      setBusy(false);
    }
  }

  const save = () => {
    const route: BusRoute = {
      ...draft,
      timetables: Object.fromEntries(DAY_TYPES.map((d) => [d, parseTimes(times[d] ?? '')])) as BusRoute['timetables'],
    };
    return run(() => saveBusRoute(route), '노선을 저장했어요.', route.id);
  };

  const remove = () => {
    if (selected === NEW) return;
    if (!window.confirm(`'${draft.name}' 노선을 삭제할까요? 되돌릴 수 없어요.`)) return;
    return run(() => deleteBusRoute(draft.id), '노선을 삭제했어요.');
  };

  return (
    <div className="space-y-4">
      {snapshot.storage === 'memory' && (
        <p className="rounded-md bg-accent/15 px-3 py-2 text-xs text-accent">
          Supabase가 연결되지 않아 인메모리 저장소를 쓰고 있어요. 서버를 재시작하면 수정 내용이 seed.json 값으로 돌아가요.
        </p>
      )}

      <Tabs
        items={[
          ...snapshot.network.routes.map((r) => ({ value: r.id, label: r.name || r.id })),
          { value: NEW, label: '+ 새 노선' },
        ]}
        value={selected}
        onChange={(v) => pick(v)}
      />

      <Card className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="노선 이름">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="예) 한성대입구역 ↔ 학교" />
          </Field>
          <Field label="색">
            <Input type="color" className="w-14 p-1" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </Field>
        </div>
        <Field label="표시 순서" hint="작을수록 앞에 나와요">
          <Input type="number" value={draft.order} onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) })} />
        </Field>
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">정류장 ({draft.stops.length})</h3>
          <Button size="sm" variant="secondary" onClick={addStop}>
            + 정류장
          </Button>
        </div>
        <p className="text-xs text-muted">
          소요(분) = 출발지에서 이 정류장까지 걸리는 시간. 좌표는 네이버/카카오 지도에서 우클릭 → 좌표 복사로 구할 수 있어요.
        </p>
        {draft.stops.length === 0 && <EmptyState title="정류장이 없어요" />}
        {draft.stops.map((s, i) => (
          <div key={s.id} className="space-y-2 rounded-md border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="w-5 text-center text-xs font-bold text-muted">{i + 1}</span>
              <Input value={s.name} placeholder="정류장 이름" onChange={(e) => setStop(i, { name: e.target.value })} />
              <Button size="sm" variant="ghost" onClick={() => moveStop(i, -1)} aria-label="위로">
                ↑
              </Button>
              <Button size="sm" variant="ghost" onClick={() => moveStop(i, 1)} aria-label="아래로">
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="삭제"
                onClick={() => setDraft({ ...draft, stops: draft.stops.filter((_, j) => j !== i) })}
              >
                ✕
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2 pl-7">
              <Field label="위도">
                <Input type="number" step="0.0001" value={s.lat} onChange={(e) => setStop(i, { lat: Number(e.target.value) })} />
              </Field>
              <Field label="경도">
                <Input type="number" step="0.0001" value={s.lng} onChange={(e) => setStop(i, { lng: Number(e.target.value) })} />
              </Field>
              <Field label="소요(분)">
                <Input type="number" min={0} value={s.offsetMin} onChange={(e) => setStop(i, { offsetMin: Number(e.target.value) })} />
              </Field>
            </div>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-bold">출발 시각 (첫 정류장 기준)</h3>
        {DAY_TYPES.map((d) => (
          <Field key={d} label={DAY_TYPE_LABEL[d]} hint="HH:mm을 쉼표나 줄바꿈으로 구분. 비우면 그날 운행 안 함.">
            <Textarea
              value={times[d] ?? ''}
              onChange={(e) => setTimes({ ...times, [d]: e.target.value })}
              placeholder="08:00, 08:20, 08:40"
              className="font-mono text-xs"
            />
          </Field>
        ))}
      </Card>

      {msg && <Badge tone={msg.ok ? 'success' : 'danger'}>{msg.text}</Badge>}

      <div className="flex gap-2">
        <Button block onClick={save} disabled={busy}>
          {selected === NEW ? '노선 추가' : '저장'}
        </Button>
        {selected !== NEW && (
          <Button variant="danger" onClick={remove} disabled={busy}>
            삭제
          </Button>
        )}
      </div>

      <CalendarEditor
        vacations={snapshot.network.vacations}
        holidays={snapshot.network.holidays}
        onSave={(c) => run(() => saveBusCalendar(c), '방학·공휴일을 저장했어요.', selected)}
        busy={busy}
      />
    </div>
  );
}

function CalendarEditor({
  vacations: initialVacations,
  holidays: initialHolidays,
  onSave,
  busy,
}: {
  vacations: VacationPeriod[];
  holidays: string[];
  onSave: (c: { vacations: VacationPeriod[]; holidays: string[] }) => void;
  busy: boolean;
}) {
  const [vacations, setVacations] = useState(initialVacations);
  const [holidays, setHolidays] = useState(initialHolidays.join('\n'));

  const setV = (i: number, patch: Partial<VacationPeriod>) =>
    setVacations(vacations.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">방학 기간 · 공휴일</h3>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setVacations([...vacations, { id: `vac-${Date.now().toString(36)}`, label: '', start: '', end: '' }])}
        >
          + 방학
        </Button>
      </div>
      <p className="text-xs text-muted">방학 기간엔 요일과 상관없이 방학 시간표, 공휴일엔 주말 시간표가 적용돼요.</p>
      {vacations.map((v, i) => (
        <div key={v.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-border p-2">
          <Input value={v.label} placeholder="예) 2026 겨울방학" onChange={(e) => setV(i, { label: e.target.value })} />
          <Button size="sm" variant="ghost" aria-label="삭제" onClick={() => setVacations(vacations.filter((_, j) => j !== i))}>
            ✕
          </Button>
          <div className="col-span-2 grid grid-cols-2 gap-2">
            <Input type="date" value={v.start} onChange={(e) => setV(i, { start: e.target.value })} />
            <Input type="date" value={v.end} onChange={(e) => setV(i, { end: e.target.value })} />
          </div>
        </div>
      ))}
      <Field label="공휴일" hint="YYYY-MM-DD, 한 줄에 하나">
        <Textarea value={holidays} onChange={(e) => setHolidays(e.target.value)} className="font-mono text-xs" />
      </Field>
      <Button
        variant="secondary"
        block
        disabled={busy}
        onClick={() => onSave({ vacations, holidays: holidays.split(/\s+/).filter(Boolean) })}
      >
        방학·공휴일 저장
      </Button>
    </Card>
  );
}
