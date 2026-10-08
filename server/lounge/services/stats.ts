/**
 * 관리자 통계. 숫자만 내려가고 개인을 가리키는 정보는 없다.
 * 모임 쪽은 상태 계산(currentStatus)과 노쇼 확정(confirmedNoshows)이 도메인 함수라, 모임을 읽어 와서 같은 함수로 센다.
 * (캠퍼스 규모라 충분하다. 규모가 커지면 status 사본 컬럼으로 SQL 집계를 쓰면 된다)
 */
import { get } from '../../db.js';
import type { AdminStats } from '../../../shared/lounge/view.js';
import type { GatheringKind } from '../../../shared/lounge/gathering.js';
import { confirmedNoshows, currentStatus, memberIds } from '../domain/gathering.js';
import { listAllGatherings } from '../repo/gatherings.js';

const KINDS: GatheringKind[] = ['meetup', 'meal', 'team'];

const round1 = (n: number) => Math.round(n * 10) / 10;

interface UserAggregate {
  total: number;
  profiled: number;
  banned: number;
  average: number | string | null;
}

export async function adminStats(now: string = new Date().toISOString()): Promise<AdminStats> {
  const [agg, all] = await Promise.all([
    // 정지 수와 평균 온도는 프로필을 만든 사용자만 센다 (프로필 없는 계정은 라운지에 없는 사람이다)
    get<UserAggregate>(
      `SELECT COUNT(*)::int AS total,
              (COUNT(*) FILTER (WHERE profile_done))::int AS profiled,
              (COUNT(*) FILTER (WHERE profile_done AND banned))::int AS banned,
              AVG(temperature) FILTER (WHERE profile_done) AS average
         FROM users`,
    ),
    listAllGatherings(),
  ]);

  const gatherings = KINDS.map((kind) => {
    const list = all.filter((g) => g.kind === kind);
    const statuses = list.map((g) => currentStatus(g, now));
    return {
      kind,
      total: list.length,
      open: statuses.filter((s) => s === 'open' || s === 'full').length,
      done: statuses.filter((s) => s === 'done').length,
      cancelled: statuses.filter((s) => s === 'cancelled').length,
      participants: list.reduce((sum, g) => sum + memberIds(g).length, 0),
    };
  });

  // 노쇼율 = 확정 노쇼 수 / 끝난 모임의 참여자 수 (%, 소수 한 자리)
  const finished = all.filter((g) => currentStatus(g, now) === 'done');
  const participants = finished.reduce((sum, g) => sum + memberIds(g).length, 0);
  const confirmed = finished.reduce((sum, g) => sum + confirmedNoshows(g).length, 0);

  return {
    users: {
      total: Number(agg?.total ?? 0),
      profiled: Number(agg?.profiled ?? 0),
      banned: Number(agg?.banned ?? 0),
      averageTemperature: agg?.average == null ? 0 : round1(Number(agg.average)),
    },
    gatherings,
    noshow: { confirmed, participants, rate: participants ? round1((confirmed / participants) * 100) : 0 },
  };
}
