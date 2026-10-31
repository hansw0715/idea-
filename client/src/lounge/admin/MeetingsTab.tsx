import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AdminMeetingRow } from '../../../../shared/lounge';
import { Alert, Button, EmptyState, LoadingBlock, TextField, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';

const fmtDate = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(new Date(iso));

/**
 * 관리자 > 회의: 만들어진 회의 목록. 코드를 잃어버린 사람에게 참가 코드를 알려 주고,
 * 장난으로 만든 회의나 주인이 떠난 회의는 지운다 (예약·팀원도 함께 지워진다).
 */
export default function MeetingsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<AdminMeetingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await loungeApi.adminMeetings(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : '회의를 불러오지 못했어요.');
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  function search(e: FormEvent) {
    e.preventDefault();
    setQuery(q.trim());
  }

  async function remove(m: AdminMeetingRow) {
    const ok = await confirm({
      title: `「${m.name}」 회의 삭제`,
      message: `팀원 ${m.members}명이 이 회의를 더는 볼 수 없고, 예약 ${m.reservations}건도 함께 지워져요. 되돌릴 수 없어요.`,
      confirmLabel: '삭제하기',
      tone: 'danger',
      run: async () => {
        await loungeApi.adminDeleteMeeting(m.id);
      },
    });
    if (!ok) return;
    toast('회의를 삭제했어요.');
    await load();
  }

  return (
    <div>
      <form className="lounge-admin-search" onSubmit={search} role="search">
        <TextField label="회의 이름·참가 코드로 찾기" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 캡스톤, 3266" />
        <Button type="submit" variant="secondary">
          찾기
        </Button>
      </form>

      {error && (
        <Alert tone="danger" title="회의를 불러오지 못했어요." actions={<Button variant="secondary" onClick={() => void load()}>다시 시도하기</Button>}>
          {error}
        </Alert>
      )}
      {!list ? (
        !error && (
          <div className="card">
            <LoadingBlock>회의를 불러오는 중이에요.</LoadingBlock>
          </div>
        )
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState icon="users" title="맞는 회의가 없어요." />
        </div>
      ) : (
        <ul className="lounge-admin-list">
          <li className="lounge-admin-count">{list.length}개 · 최근에 만든 순</li>
          {list.map((m) => (
            <li key={m.id} className="card lounge-admin-row">
              <div className="lounge-admin-row__head is-static">
                <span className="lounge-admin-row__title">{m.name}</span>
                <span className="lounge-admin-row__badges">
                  <span className="lounge-admin-code tabular">코드 {m.code}</span>
                </span>
                <span className="lounge-admin-row__meta">
                  만든 사람 {m.owner}
                  {m.ownerUsername ? ` (@${m.ownerUsername})` : ''} · {fmtDate(m.createdAt)} · 팀원 {m.members}명 · 예약 {m.reservations}건
                  {m.upcomingReservations > 0 ? ` (다가오는 ${m.upcomingReservations}건)` : ''}
                </span>
              </div>
              <div className="lounge-admin-row__actions">
                <Button size="sm" variant="tertiary" onClick={() => void remove(m)}>
                  회의 삭제
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
