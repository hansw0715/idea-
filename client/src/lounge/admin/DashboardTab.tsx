import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview } from '../../../../shared/lounge';
import { Alert, Button, Icon, LoadingBlock } from '../../ui';
import { loungeApi } from '../api';
import AdminLog from './AdminLog';

type Go = 'reports' | 'users' | 'gatherings' | 'meetings' | 'tools';

const KIND_LABEL: Record<string, string> = { meal: '밥약', meetup: '미팅', team: '팀' };

/** 숫자 + 작은 회색 단위 */
function Num({ value, unit }: { value: number | string; unit?: string }) {
  return (
    <span className="adm-num">
      <span className="adm-num__v tabular">{value}</span>
      {unit && <span className="adm-num__u">{unit}</span>}
    </span>
  );
}

/**
 * 관리자 > 대시보드. 화면이 답하는 질문: "지금 내가 처리할 게 있나?"
 *  ① 처리할 일 (신고가 있으면 맨 위에 한 줄로, 바로 처리하기)
 *  ② 핵심 숫자 한 줄 (칸을 나눈 띠 하나)
 *  ③ 가입 추이 · 모임 현황 표 · 확인할 것 목록 · 최근 관리 기록
 * 색은 주의가 필요한 숫자와 막대에만 쓴다.
 */
export default function DashboardTab({ onGo }: { onGo: (tab: Go) => void }) {
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
  const signups14 = data.signups.reduce((sum, d) => sum + d.count, 0);
  const pending = data.reports.open;

  // 확인할 것: 0 이 아닌 것만 위로, 0 은 회색으로 아래에
  const checks: { label: string; value: number; unit: string; go: Go; warn?: boolean }[] = [
    { label: '처리 안 한 신고', value: data.reports.open, unit: '건', go: 'reports', warn: true },
    { label: '이용 정지 중', value: data.users.banned, unit: '명', go: 'users' },
    { label: '경고가 쌓인 사람', value: data.users.warned, unit: '명', go: 'users' },
    { label: '밥약 빠른 매칭 대기', value: data.quickWaiting, unit: '명', go: 'tools' },
    { label: '보낼 강의 알림', value: data.lectureAlerts.pending, unit: '건', go: 'tools' },
  ];

  return (
    <div className="adm-dash">
      {/* ① 처리할 일 */}
      <section className={`adm-lead${pending > 0 ? ' is-alert' : ''}`} aria-label="지금 처리할 일">
        <div className="adm-lead__text">
          <p className="adm-lead__label">{pending > 0 ? '처리 안 한 신고' : '지금 처리할 신고'}</p>
          <p className="adm-lead__value">{pending > 0 ? <Num value={pending} unit="건" /> : '없어요'}</p>
          <p className="adm-lead__sub">이번 주 들어온 신고 {data.reports.thisWeek}건</p>
        </div>
        <div className="adm-lead__actions">
          {pending > 0 && <Button onClick={() => onGo('reports')}>신고 처리하기</Button>}
          <Button variant="text" size="sm" loading={refreshing} onClick={() => void load()}>
            새로 고치기
          </Button>
        </div>
      </section>

      {/* ② 핵심 숫자: 칸을 나눈 띠 하나 */}
      <dl className="adm-strip">
        <div className="adm-strip__cell">
          <dt>가입자</dt>
          <dd>
            <Num value={data.users.total} unit="명" />
          </dd>
          <dd className="adm-strip__sub">이번 주 +{data.users.newThisWeek}</dd>
        </div>
        <div className="adm-strip__cell">
          <dt>지금 라운지</dt>
          <dd>
            <Num value={data.onlineNow} unit="명" />
          </dd>
          <dd className="adm-strip__sub">접속 중</dd>
        </div>
        <div className="adm-strip__cell">
          <dt>평균 매너온도</dt>
          <dd>
            <Num value={data.health.averageTemperature ? data.health.averageTemperature.toFixed(1) : '—'} unit="°" />
          </dd>
          <dd className="adm-strip__sub">
            노쇼율 {data.health.finishedParticipants ? `${data.health.noshowRate}%` : '—'}
          </dd>
        </div>
        <div className="adm-strip__cell">
          <dt>폰 알림 켬</dt>
          <dd>
            <Num value={data.push.users} unit="명" />
          </dd>
          <dd className="adm-strip__sub">기기 {data.push.devices}대</dd>
        </div>
      </dl>

      <div className="adm-grid">
        {/* ③-1 가입 추이 */}
        <section className="card adm-panel" aria-labelledby="adm-signups">
          <header className="adm-panel__head">
            <h3 id="adm-signups">최근 14일 가입</h3>
            <span className="adm-panel__aside">
              <Num value={signups14} unit="명" />
            </span>
          </header>
          <ol className="adm-bars" aria-label="날짜별 가입 수">
            {data.signups.map((d, i) => {
              const last = i === data.signups.length - 1;
              return (
                <li key={d.date} className={`adm-bars__day${last ? ' is-today' : ''}`}>
                  <span className="adm-bars__n">{d.count || ''}</span>
                  <span className="adm-bars__track">
                    <span className="adm-bars__bar" style={{ height: `${(d.count / peak) * 100}%` }} />
                  </span>
                  <span className="adm-bars__date">{i % 2 === 1 || last ? Number(d.date.slice(8)) : ''}</span>
                  <span className="sr-only">{`${d.date} ${d.count}명`}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* ③-2 확인할 것 */}
        <section className="card adm-panel" aria-labelledby="adm-checks">
          <header className="adm-panel__head">
            <h3 id="adm-checks">확인할 것</h3>
          </header>
          <ul className="adm-rows">
            {[...checks].sort((a, b) => Number(b.value > 0) - Number(a.value > 0)).map((c) => (
              <li key={c.label}>
                <button type="button" className={`adm-row${c.value === 0 ? ' is-zero' : ''}${c.warn && c.value > 0 ? ' is-warn' : ''}`} onClick={() => onGo(c.go)}>
                  <span className="adm-row__label">{c.label}</span>
                  <Num value={c.value} unit={c.unit} />
                  <Icon name="chevron-right" className="adm-row__chev" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ③-3 모임 현황 표 */}
        <section className="card adm-panel" aria-labelledby="adm-gatherings">
          <header className="adm-panel__head">
            <h3 id="adm-gatherings">모임</h3>
            <Button variant="text" size="sm" onClick={() => onGo('gatherings')}>
              목록 보기
            </Button>
          </header>
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">종류</th>
                <th scope="col">모집 중</th>
                <th scope="col">오늘</th>
                <th scope="col">이번 주 끝남</th>
              </tr>
            </thead>
            <tbody>
              {data.gatherings.map((g) => (
                <tr key={g.kind}>
                  <th scope="row">{KIND_LABEL[g.kind] ?? g.kind}</th>
                  <td className={g.live === 0 ? 'is-zero' : ''}>{g.live}</td>
                  <td className={g.today === 0 ? 'is-zero' : ''}>{g.today}</td>
                  <td className={g.doneThisWeek === 0 ? 'is-zero' : ''}>{g.doneThisWeek}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ③-4 회의 */}
        <section className="card adm-panel" aria-labelledby="adm-meetings">
          <header className="adm-panel__head">
            <h3 id="adm-meetings">회의</h3>
            <Button variant="text" size="sm" onClick={() => onGo('meetings')}>
              목록 보기
            </Button>
          </header>
          <ul className="adm-rows adm-rows--static">
            <li className="adm-row">
              <span className="adm-row__label">만들어진 회의</span>
              <Num value={data.meetings.total} unit="개" />
            </li>
            <li className="adm-row">
              <span className="adm-row__label">이번 주 새 회의</span>
              <Num value={data.meetings.newThisWeek} unit="개" />
            </li>
            <li className="adm-row">
              <span className="adm-row__label">다가오는 시설 예약</span>
              <Num value={data.meetings.upcomingReservations} unit="건" />
            </li>
          </ul>
        </section>
      </div>

      {/* ④ 최근 관리 기록 */}
      <section className="adm-log-section" aria-labelledby="adm-log">
        <header className="adm-panel__head">
          <h3 id="adm-log">최근 관리 기록</h3>
          <Button variant="text" size="sm" onClick={() => onGo('tools')}>
            전체 보기
          </Button>
        </header>
        <AdminLog items={data.recentLog} />
      </section>
    </div>
  );
}
