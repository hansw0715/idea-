import { useCallback, useEffect, useRef, useState } from 'react';
import { temperatureFace } from '../../../../shared/lounge';
import type { AdminStats } from '../../../../shared/lounge';
import { Alert, Button, LoadingBlock } from '../../ui';
import { loungeApi } from '../api';

/**
 * 관리자 > 통계: 라운지 이용 현황. 숫자만 던져 두지 않고, 분모와 읽는 법을 같이 적는다.
 * 서버는 개인을 가리키는 정보 없이 합계만 내려 준다. 규칙: docs/lounge/01-contract.md §6.
 */

/** 서버가 kind 문자열로 내려 주는 모임 종류 */
const KIND_LABEL: Record<string, string> = { meetup: '미팅', meal: '밥약', team: '팀빌딩' };

/** 통계를 한 문단으로 풀어 쓴다 — 표를 읽지 않아도 지금 상태를 알 수 있게 */
function usersSentence(s: AdminStats): string {
  const { profiled, banned, total } = s.users;
  if (profiled === 0) return `가입자 ${total}명 중 라운지 프로필을 만든 사람이 아직 없어요.`;
  const stage = temperatureFace(s.users.averageTemperature).label;
  const first = `프로필을 만든 ${profiled}명 중 ${banned > 0 ? `${banned}명이 이용 정지 상태이고` : '이용 정지 상태인 사람은 없고'}, 평균 매너온도는 ${s.users.averageTemperature.toFixed(1)}°(${stage})예요.`;
  const { confirmed, participants, rate } = s.noshow;
  const second =
    participants === 0
      ? '아직 끝난 모임이 없어서 노쇼율은 계산하지 않았어요.'
      : `끝난 모임에 참여한 ${participants}명 중 ${confirmed}명이 노쇼로 확정돼 노쇼율은 ${rate}%예요.`;
  return `${first} ${second}`;
}

function gatheringsSentence(s: AdminStats): string {
  const total = s.gatherings.reduce((sum, g) => sum + g.total, 0);
  if (total === 0) return '아직 만들어진 모임이 없어요.';
  const open = s.gatherings.reduce((sum, g) => sum + g.open, 0);
  const top = [...s.gatherings].sort((a, b) => b.total - a.total)[0];
  return `지금까지 모임 ${total}개가 만들어졌고, 그중 ${open}개가 모집 중이에요. 가장 많이 만든 모임은 ${KIND_LABEL[top.kind] ?? top.kind}(${top.total}개)예요.`;
}

export default function StatsTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (keep: boolean) => {
    const mine = ++seq.current;
    setError(null);
    if (keep) setRefreshing(true);
    else setStats(null);
    try {
      const next = await loungeApi.adminStats();
      if (mine === seq.current) setStats(next);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : '통계를 불러오지 못했어요.');
    } finally {
      if (mine === seq.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div aria-busy={refreshing || (stats === null && !error) ? true : undefined}>
      <div className="lounge-admin-toolbar">
        <h2 className="section__title">이용 현황</h2>
        <Button variant="text" onClick={() => void load(stats !== null)} disabled={refreshing}>
          {refreshing ? '불러오는 중…' : '새로 고치기'}
        </Button>
      </div>

      {error && (
        <div className="lounge-admin-filter">
          <Alert
            tone="danger"
            title="통계를 불러오지 못했어요."
            actions={
              <Button variant="secondary" onClick={() => void load(stats !== null)}>
                다시 시도하기
              </Button>
            }
          >
            {error}
            {stats && ' 지금 보이는 숫자는 이전에 받은 것이에요.'}
          </Alert>
        </div>
      )}

      {stats === null && !error && (
        <div className="card">
          <LoadingBlock>통계를 불러오는 중이에요.</LoadingBlock>
        </div>
      )}

      {stats && <Body stats={stats} />}
    </div>
  );
}

function Body({ stats: s }: { stats: AdminStats }) {
  const noTemp = s.users.profiled === 0;
  const face = temperatureFace(s.users.averageTemperature);
  const noNoshow = s.noshow.participants === 0;
  return (
    <>
      <p className="lounge-admin-summary">{usersSentence(s)}</p>

      <dl className="lounge-admin-stats">
        <div className="card lounge-admin-stat">
          <dt className="lounge-admin-stat__label">프로필 만든 사용자</dt>
          <dd className="lounge-admin-stat__value">{s.users.profiled}명</dd>
          <dd className="lounge-admin-stat__note">전체 가입자 {s.users.total}명 중</dd>
        </div>
        <div className="card lounge-admin-stat">
          <dt className="lounge-admin-stat__label">평균 매너온도</dt>
          <dd className="lounge-admin-stat__value">{noTemp ? '집계 전' : `${s.users.averageTemperature.toFixed(1)}°`}</dd>
          <dd className="lounge-admin-stat__note">
            {noTemp ? '프로필을 만든 사용자가 아직 없어요' : `${face.emoji} ${face.label} · 프로필 만든 ${s.users.profiled}명 기준`}
          </dd>
        </div>
        <div className="card lounge-admin-stat">
          <dt className="lounge-admin-stat__label">이용 정지</dt>
          <dd className="lounge-admin-stat__value">{s.users.banned}명</dd>
          <dd className="lounge-admin-stat__note">프로필 만든 {s.users.profiled}명 중</dd>
        </div>
        <div className="card lounge-admin-stat">
          <dt className="lounge-admin-stat__label">노쇼율</dt>
          <dd className="lounge-admin-stat__value">{noNoshow ? '집계 전' : `${s.noshow.rate}%`}</dd>
          <dd className="lounge-admin-stat__note">
            {noNoshow
              ? '끝난 모임이 아직 없어요'
              : `끝난 모임 참여 ${s.noshow.participants}명 중 ${s.noshow.confirmed}명이 노쇼로 확정`}
          </dd>
        </div>
      </dl>

      <section className="section" aria-labelledby="lounge-admin-kinds-title">
        <div className="section__head">
          <h2 className="section__title" id="lounge-admin-kinds-title">
            기능별 모임
          </h2>
        </div>
        <p className="lounge-admin-summary">{gatheringsSentence(s)}</p>
        <ul className="lounge-admin-kinds">
          {s.gatherings.map((g) => (
            <li key={g.kind} className="card">
              <div className="lounge-admin-kind__head">
                <h3 className="lounge-admin-kind__name">{KIND_LABEL[g.kind] ?? g.kind}</h3>
                <span className="lounge-admin-kind__cancel">취소된 모임 {g.cancelled}개</span>
              </div>
              <dl className="lounge-admin-kind__grid">
                <div>
                  <dt className="lounge-admin-kind__key">전체</dt>
                  <dd className="lounge-admin-kind__val">{g.total}</dd>
                </div>
                <div>
                  <dt className="lounge-admin-kind__key">모집 중</dt>
                  <dd className="lounge-admin-kind__val">{g.open}</dd>
                </div>
                <div>
                  <dt className="lounge-admin-kind__key">종료</dt>
                  <dd className="lounge-admin-kind__val">{g.done}</dd>
                </div>
                <div>
                  <dt className="lounge-admin-kind__key">참여</dt>
                  <dd className="lounge-admin-kind__val">{g.participants}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <p className="lounge-admin-note">
          모집 중은 신청을 받고 있거나 정원이 찬 모임이에요. 참여는 모임마다 앉은 사람 수를 더한 값이라, 한 사람이 여러 모임에
          참여하면 그만큼 여러 번 세요. 팀빌딩은 아직 라운지에서 만들 수 없어 0으로 보여요.
        </p>
      </section>
    </>
  );
}
