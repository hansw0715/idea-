import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AdminUserAction, AdminUserRow } from '../../../../shared/lounge';
import { Alert, Badge, Button, EmptyState, LoadingBlock, Segmented, TextField, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';

type Filter = 'all' | 'reported' | 'banned' | 'warned' | 'admin';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'reported', label: '신고됨' },
  { value: 'banned', label: '정지' },
  { value: 'warned', label: '경고' },
  { value: 'admin', label: '관리자' },
];

/** 조치마다: 버튼 글자, 확인 문구, 끝난 뒤 알림 */
const ACTIONS: Record<AdminUserAction, { label: string; confirm: string; done: string; danger?: boolean }> = {
  ban: { label: '이용 정지', confirm: '라운지(밥약·미팅·채팅)를 쓸 수 없게 돼요.', done: '이용을 정지했어요.', danger: true },
  unban: { label: '정지 해제', confirm: '정지를 풀고 경고도 0으로 돌려요.', done: '정지를 풀었어요.' },
  clearWarnings: { label: '경고 초기화', confirm: '쌓인 경고(노쇼 등)를 0으로 돌려요.', done: '경고를 0으로 돌렸어요.' },
  resetTemperature: { label: '매너온도 초기화', confirm: '매너온도를 처음 값(36.5°)으로 돌려요.', done: '매너온도를 36.5°로 돌렸어요.' },
  closeReports: { label: '남은 신고 닫기', confirm: '이 사람에 대한 처리 안 한 신고를 모두 기각으로 닫아요.', done: '남은 신고를 닫았어요.' },
  clearPush: { label: '폰 알림 등록 지우기', confirm: '알림이 이상하게 오거나 안 올 때 써요. 앱을 다시 열면 다시 등록돼요.', done: '폰 알림 등록을 지웠어요.' },
  clearPresence: { label: '라운지 접속 지우기', confirm: '라운지에 계속 서 있는 것처럼 보일 때 써요.', done: '라운지 접속 기록을 지웠어요.' },
};

const fmtDate = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(new Date(iso));

/**
 * 관리자 > 사용자: 아이디·닉네임으로 찾아서 정지·경고·매너온도·알림 문제를 바로 푼다.
 * 실명·이메일·학과·학번은 보이지 않는다 (서버가 내려 주지 않는다).
 */
export default function UsersTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await loungeApi.adminUsers(query, filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : '사용자를 불러오지 못했어요.');
    }
  }, [query, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  function search(e: FormEvent) {
    e.preventDefault();
    setQuery(q.trim());
  }

  async function act(u: AdminUserRow, action: AdminUserAction) {
    const a = ACTIONS[action];
    const ok = await confirm({
      title: `${u.nickname || u.username}님 · ${a.label}`,
      message: a.confirm,
      confirmLabel: a.label,
      tone: a.danger ? 'danger' : 'primary',
      run: async () => {
        await loungeApi.adminUserAction(u.id, action);
      },
    });
    if (!ok) return;
    toast(a.done);
    await load();
  }

  return (
    <div>
      <form className="lounge-admin-search" onSubmit={search} role="search">
        <TextField label="아이디·닉네임으로 찾기" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: hansw, 보리" />
        <Button type="submit" variant="secondary">
          찾기
        </Button>
      </form>
      <div className="lounge-admin-filter">
        <Segmented label="보기" value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      {error && (
        <Alert tone="danger" title="사용자를 불러오지 못했어요." actions={<Button variant="secondary" onClick={() => void load()}>다시 시도하기</Button>}>
          {error}
        </Alert>
      )}
      {!users ? (
        !error && (
          <div className="card">
            <LoadingBlock>사용자를 불러오는 중이에요.</LoadingBlock>
          </div>
        )
      ) : users.length === 0 ? (
        <div className="card">
          <EmptyState icon="search" title="맞는 사용자가 없어요." />
        </div>
      ) : (
        <ul className="lounge-admin-list">
          <li className="lounge-admin-count">{users.length === 100 ? '최근 가입 100명까지 보여요. 찾기로 좁혀 주세요.' : `${users.length}명`}</li>
          {users.map((u) => {
            const expanded = open === u.id;
            return (
              <li key={u.id} className="card lounge-admin-row">
                <button type="button" className="lounge-admin-row__head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : u.id)}>
                  <span className="lounge-admin-row__title">
                    {u.nickname || '(프로필 없음)'} <span className="lounge-admin-row__sub">@{u.username || u.id}</span>
                  </span>
                  <span className="lounge-admin-row__badges">
                    {u.isAdmin && <Badge tone="info">관리자</Badge>}
                    {u.banned && <Badge tone="danger">정지</Badge>}
                    {u.warnings > 0 && <Badge tone="warning">경고 {u.warnings}</Badge>}
                    {u.openReports > 0 && <Badge tone="danger">신고 {u.openReports}</Badge>}
                    {!u.profileDone && <Badge>프로필 없음</Badge>}
                  </span>
                  <span className="lounge-admin-row__meta">
                    {u.temperature.toFixed(1)}° · 가입 {fmtDate(u.createdAt)} · 알림 기기 {u.pushDevices}대
                  </span>
                </button>
                {expanded && (
                  <div className="lounge-admin-row__actions">
                    {u.banned ? (
                      <Button size="sm" variant="secondary" onClick={() => void act(u, 'unban')}>
                        정지 해제
                      </Button>
                    ) : (
                      !u.isAdmin && (
                        <Button size="sm" variant="secondary" onClick={() => void act(u, 'ban')}>
                          이용 정지
                        </Button>
                      )
                    )}
                    {u.warnings > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => void act(u, 'clearWarnings')}>
                        경고 초기화
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => void act(u, 'resetTemperature')}>
                      매너온도 초기화
                    </Button>
                    {u.openReports > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => void act(u, 'closeReports')}>
                        남은 신고 닫기
                      </Button>
                    )}
                    <Button size="sm" variant="tertiary" onClick={() => void act(u, 'clearPush')}>
                      폰 알림 등록 지우기
                    </Button>
                    <Button size="sm" variant="tertiary" onClick={() => void act(u, 'clearPresence')}>
                      라운지 접속 지우기
                    </Button>
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
