import { useCallback, useEffect, useState } from 'react';
import type { AdminGatheringRow } from '../../../../shared/lounge';
import { Alert, Badge, Button, EmptyState, LoadingBlock, Segmented, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';

type Kind = 'all' | 'meal' | 'meetup' | 'team';
type Status = 'live' | 'done' | 'cancelled' | 'all';

const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'meal', label: '밥약' },
  { value: 'meetup', label: '미팅' },
  { value: 'team', label: '팀' },
];
const STATUSES: { value: Status; label: string }[] = [
  { value: 'live', label: '진행 중' },
  { value: 'done', label: '끝난' },
  { value: 'cancelled', label: '취소된' },
  { value: 'all', label: '전체' },
];
const KIND_LABEL: Record<string, string> = { meal: '밥약', meetup: '미팅', team: '팀' };
const STATUS_BADGE: Record<string, { label: string; tone: 'primary' | 'success' | 'gray' | 'danger' | 'info' }> = {
  open: { label: '모집 중', tone: 'primary' },
  full: { label: '모집 완료', tone: 'info' },
  done: { label: '끝남', tone: 'gray' },
  cancelled: { label: '취소됨', tone: 'danger' },
};

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * 관리자 > 모임: 밥약·미팅·팀 모임 목록. 문제가 된 모임은 취소하고, 문제를 일으킨 참여자는 모임에서 뺀다.
 * 신고 수·대화 수를 같이 보여 줘 어느 모임을 먼저 볼지 고를 수 있다.
 */
export default function GatheringsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState<Status>('live');
  const [list, setList] = useState<AdminGatheringRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await loungeApi.adminGatherings(kind, status));
    } catch (err) {
      setError(err instanceof Error ? err.message : '모임을 불러오지 못했어요.');
    }
  }, [kind, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(g: AdminGatheringRow) {
    const ok = await confirm({
      title: `「${g.title}」 모임 취소`,
      message: '참여자 단톡방에 "관리자가 이 모임을 취소했어요."가 남고, 더는 참여할 수 없어요. 되돌릴 수 없어요.',
      confirmLabel: '모임 취소',
      tone: 'danger',
      run: async () => {
        await loungeApi.adminCancelGathering(g.id, '운영 정책');
      },
    });
    if (!ok) return;
    toast('모임을 취소했어요.');
    await load();
  }

  async function kick(g: AdminGatheringRow, m: AdminGatheringRow['members'][number]) {
    const ok = await confirm({
      title: `${m.nickname}님을 모임에서 빼기`,
      message: `「${g.title}」 자리에서 빠지고 단톡방에도 들어갈 수 없어요.`,
      confirmLabel: '빼기',
      tone: 'danger',
      run: async () => {
        await loungeApi.adminKick(g.id, m.id);
      },
    });
    if (!ok) return;
    toast(`${m.nickname}님을 뺐어요.`);
    await load();
  }

  return (
    <div>
      <div className="lounge-admin-filter lounge-admin-filter--pair">
        <Segmented label="종류" value={kind} onChange={setKind} options={KINDS} />
        <Segmented label="상태" value={status} onChange={setStatus} options={STATUSES} />
      </div>

      {error && (
        <Alert tone="danger" title="모임을 불러오지 못했어요." actions={<Button variant="secondary" onClick={() => void load()}>다시 시도하기</Button>}>
          {error}
        </Alert>
      )}
      {!list ? (
        !error && (
          <div className="card">
            <LoadingBlock>모임을 불러오는 중이에요.</LoadingBlock>
          </div>
        )
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState icon="calendar" title="조건에 맞는 모임이 없어요." />
        </div>
      ) : (
        <ul className="lounge-admin-list">
          <li className="lounge-admin-count">{list.length}개 · 만나는 시각이 늦은 순</li>
          {list.map((g) => {
            const expanded = open === g.id;
            const badge = STATUS_BADGE[g.status] ?? { label: g.status, tone: 'gray' as const };
            const live = g.status === 'open' || g.status === 'full';
            return (
              <li key={g.id} className="card lounge-admin-row">
                <button type="button" className="lounge-admin-row__head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : g.id)}>
                  <span className="lounge-admin-row__title">
                    <span className="lounge-admin-row__kind">{KIND_LABEL[g.kind] ?? g.kind}</span> {g.title}
                  </span>
                  <span className="lounge-admin-row__badges">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    {g.reports > 0 && <Badge tone="danger">신고 {g.reports}</Badge>}
                  </span>
                  <span className="lounge-admin-row__meta">
                    {fmt(g.meetAt)} · {g.place || '장소 미정'} · {g.members.length}/{g.capacity}명
                    {g.applicants > 0 ? ` · 신청 ${g.applicants}` : ''} · 대화 {g.messages}개 · 주최 {g.host}
                  </span>
                </button>
                {expanded && (
                  <div className="lounge-admin-row__more">
                    <ul className="lounge-admin-members">
                      {g.members.map((m) => (
                        <li key={m.id}>
                          <span>
                            {m.nickname}
                            {m.host && <span className="lounge-admin-row__sub"> · 주최</span>}
                          </span>
                          {live && !m.host && (
                            <Button size="sm" variant="tertiary" onClick={() => void kick(g, m)}>
                              빼기
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {live && (
                      <div className="lounge-admin-row__actions">
                        <Button size="sm" variant="secondary" onClick={() => void cancel(g)}>
                          모임 취소
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
