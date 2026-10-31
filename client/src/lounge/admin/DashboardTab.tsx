import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview } from '../../../../shared/lounge';
import { Alert, Button, LoadingBlock } from '../../ui';
import { loungeApi } from '../api';
import StatsTab from './StatsTab';
import AdminLog from './AdminLog';

const KIND_LABEL: Record<string, string> = { meal: '밥약', meetup: '미팅', team: '팀' };

/**
 * 관리자 > 대시보드: 지금 챙길 것(미처리 신고·정지·빠른 매칭 대기)을 맨 위에, 그 아래 이용 현황과 최근 관리 기록.
 * 카드를 누르면 해당 탭으로 간다 (onGo). 숫자만 있고 개인을 가리키는 정보는 없다.
 */
export default function DashboardTab({ onGo }: { onGo: (tab: 'reports' | 'users' | 'gatherings' | 'meetings' | 'tools') => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setData(await loungeApi.adminOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : '대시보드를 불러오지 못했어요.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return error ? (
      <Alert tone="danger" title="대시보드를 불러오지 못했어요." actions={<Button variant="secondary" onClick={() => void load()}>다시 시도하기</Button>}>
        {error}
      </Alert>
    ) : (
      <div className="card">
        <LoadingBlock>대시보드를 불러오는 중이에요.</LoadingBlock>
      </div>
    );
  }

  const peak = Math.max(1, ...data.signups.map((d) => d.count));
  const todo = [
    { key: 'reports', label: '처리 안 한 신고', value: data.reports.open, note: `이번 주 들어온 신고 ${data.reports.thisWeek}건`, go: 'reports', urgent: data.reports.open > 0 },
    { key: 'banned', label: '이용 정지', value: data.users.banned, note: `경고 받은 사람 ${data.users.warned}명`, go: 'users', urgent: false },
    { key: 'quick', label: '밥약 빠른 매칭 대기', value: data.quickWaiting, note: '오래 남아 있으면 운영 도구에서 비울 수 있어요', go: 'tools', urgent: false },
  ] as const;

  return (
    <div className="lounge-admin-dash">
      <div className="lounge-admin-toolbar">
        <p className="lounge-admin-toolbar__text">지금 챙길 것과 이용 현황이에요. 카드를 누르면 그 탭으로 가요.</p>
        <Button variant="text" size="sm" loading={refreshing} onClick={() => void load()}>
          새로 고치기
        </Button>
      </div>

      <h2 className="section__title lounge-admin-dash__title">지금 챙길 것</h2>
      <div className="lounge-admin-stats">
        {todo.map((t) => (
          <button key={t.key} type="button" className={`card lounge-admin-stat lounge-admin-tile${t.urgent ? ' is-urgent' : ''}`} onClick={() => onGo(t.go)}>
            <span className="lounge-admin-stat__label">{t.label}</span>
            <span className="lounge-admin-stat__value">{t.value}</span>
            <span className="lounge-admin-stat__note">{t.note}</span>
          </button>
        ))}
      </div>

      <h2 className="section__title lounge-admin-dash__title">사람</h2>
      <div className="lounge-admin-stats">
        <button type="button" className="card lounge-admin-stat lounge-admin-tile" onClick={() => onGo('users')}>
          <span className="lounge-admin-stat__label">가입자</span>
          <span className="lounge-admin-stat__value">{data.users.total}명</span>
          <span className="lounge-admin-stat__note">이번 주 새로 {data.users.newThisWeek}명 · 라운지 프로필 {data.users.profiled}명</span>
        </button>
        <div className="card lounge-admin-stat">
          <span className="lounge-admin-stat__label">지금 라운지 접속</span>
          <span className="lounge-admin-stat__value">{data.onlineNow}명</span>
          <span className="lounge-admin-stat__note">최근 45초 안에 신호를 보낸 사람</span>
        </div>
        <div className="card lounge-admin-stat">
          <span className="lounge-admin-stat__label">폰 알림을 켠 사람</span>
          <span className="lounge-admin-stat__value">{data.push.users}명</span>
          <span className="lounge-admin-stat__note">기기 {data.push.devices}대 · 관리자 {data.users.admins}명</span>
        </div>
      </div>

      <div className="card lounge-admin-chart">
        <p className="lounge-admin-stat__label">최근 14일 가입</p>
        <ol className="lounge-admin-bars" aria-label="최근 14일 날짜별 가입 수">
          {data.signups.map((d) => (
            <li key={d.date} className="lounge-admin-bars__day">
              <span className="lounge-admin-bars__n">{d.count || ''}</span>
              <span className="lounge-admin-bars__bar" style={{ height: `${(d.count / peak) * 100}%` }} />
              <span className="lounge-admin-bars__date">{Number(d.date.slice(8))}</span>
              <span className="sr-only">{`${d.date} ${d.count}명`}</span>
            </li>
          ))}
        </ol>
      </div>

      <h2 className="section__title lounge-admin-dash__title">모임 · 회의</h2>
      <div className="lounge-admin-stats">
        {data.gatherings.map((g) => (
          <button key={g.kind} type="button" className="card lounge-admin-stat lounge-admin-tile" onClick={() => onGo('gatherings')}>
            <span className="lounge-admin-stat__label">{KIND_LABEL[g.kind] ?? g.kind} 모집 중</span>
            <span className="lounge-admin-stat__value">{g.live}개</span>
            <span className="lounge-admin-stat__note">오늘 만나는 {g.today}개 · 이번 주 끝난 {g.doneThisWeek}개</span>
          </button>
        ))}
        <button type="button" className="card lounge-admin-stat lounge-admin-tile" onClick={() => onGo('meetings')}>
          <span className="lounge-admin-stat__label">회의</span>
          <span className="lounge-admin-stat__value">{data.meetings.total}개</span>
          <span className="lounge-admin-stat__note">이번 주 새로 {data.meetings.newThisWeek}개 · 다가오는 예약 {data.meetings.upcomingReservations}건</span>
        </button>
        <div className="card lounge-admin-stat">
          <span className="lounge-admin-stat__label">미수강 강의 알림</span>
          <span className="lounge-admin-stat__value">{data.lectureAlerts.pending}건 대기</span>
          <span className="lounge-admin-stat__note">이번 주 보낸 알림 {data.lectureAlerts.sentThisWeek}건</span>
        </div>
      </div>

      <h2 className="section__title lounge-admin-dash__title">최근 관리 기록</h2>
      <AdminLog items={data.recentLog} />

      <div className="lounge-admin-dash__stats">
        <StatsTab />
      </div>
    </div>
  );
}
