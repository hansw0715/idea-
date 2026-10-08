/**
 * 모임 저장소 (Postgres). 모임 한 건 = lounge_gatherings 한 줄(data 에 Gathering 전체를 JSONB 로).
 *
 * `status`·`meet_at`·`kind`·`host_id` 는 목록 조회용 사본이고, 진실은 항상 `data` 다.
 * 모든 변경은 `mutateGathering` 하나로만 한다 — 아래 설명 참고.
 *
 * pg 는 jsonb 를 객체로 돌려주고 PGlite 도 같다. 혹시 문자열로 오면 파싱한다(어느 쪽이든 같은 코드가 돌게).
 */
import { all, get, run } from '../../db.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { ISODateTime, Result } from '../../../shared/lounge/types.js';
import { MAX_TEMPERATURE, MIN_TEMPERATURE, WARNINGS_TO_BAN } from '../../../shared/lounge/constants.js';
import type { Gathering, GatheringKind } from '../../../shared/lounge/gathering.js';

interface DataRow {
  data: unknown;
}
interface VersionedRow extends DataRow {
  version: number;
}

const parse = (data: unknown): Gathering =>
  (typeof data === 'string' ? JSON.parse(data) : data) as Gathering;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(n)));

export async function insertGathering(g: Gathering): Promise<void> {
  await run(
    `INSERT INTO lounge_gatherings (id, kind, host_id, meet_at, status, data, version, created_at)
     VALUES (?, ?, ?, ?::timestamptz, ?, ?::jsonb, 1, ?::timestamptz)`,
    [g.id, g.kind, Number(g.hostId), g.meetAt, g.status, JSON.stringify(g), g.createdAt],
  );
}

export async function findGathering(id: string): Promise<Gathering | undefined> {
  const row = await get<DataRow>('SELECT data FROM lounge_gatherings WHERE id = ?', [id]);
  return row ? parse(row.data) : undefined;
}

/** 변경 함수. 동기든 비동기든 된다 (서비스가 같은 문서 위에서 사용자 조회까지 하고 싶을 때가 있다). */
export type GatheringMutation = (g: Gathering) => Result<Gathering> | Promise<Result<Gathering>>;

/**
 * 모임 문서를 저장하면서 **같은 문장 안에서** 한 사용자의 평판을 바꾸는 부수효과.
 * 평가가 노쇼를 확정할 때처럼 "문서에 벌점을 줬다고 적는 일" 과 "users 의 온도·경고를 바꾸는 일" 이 둘 다 되거나 둘 다 안 돼야 할 때 쓴다.
 */
export type ReputationEffect = {
  userId: string;
  /** 온도에 더할 값 (좋았어요 ±0.4 와 노쇼 −5 를 서비스가 합쳐서 준다). 결과는 [MIN, MAX] 로 잘린다. */
  temperatureDelta: number;
  /** 경고에 더할 값 (노쇼 확정이면 1, 아니면 0). 더한 값이 `WARNINGS_TO_BAN` 에 닿으면 정지된다. */
  warningsDelta: number;
};

/** 변경 함수의 결과: 새 문서 + (있으면) 문서와 함께 반영할 평판 변화 */
export type GatheringMutationWithEffect = (
  g: Gathering,
) => Result<{ gathering: Gathering; effect?: ReputationEffect }> | Promise<Result<{ gathering: Gathering; effect?: ReputationEffect }>>;

const DEFAULT_RETRIES = 6;

/**
 * 버전이 맞을 때만 문서를 저장한다. 저장했으면 true.
 *
 * 평판 변화가 있으면 **한 문장**(데이터를 바꾸는 WITH)으로 문서와 users 를 함께 바꾼다 — Postgres 의 한 문장은 전체가 성공하거나
 * 전체가 되돌려지므로, 두 쓰기 사이에서 프로세스가 죽거나 연결이 끊겨도 "벌점은 줬다고 적혔는데 users 는 그대로" 인 상태가 생기지 않는다.
 * (예전에는 문서 저장과 users 갱신이 별개 문장이라 그 틈에서 벌점이 영영 사라질 수 있었다. db.ts 에 트랜잭션 헬퍼가 없어서 문장 하나로 묶었다)
 * users 는 문서가 실제로 저장된 경우(`saved` 에 한 줄이 있을 때)에만 바뀌므로 버전 경쟁에서 진 시도는 아무것도 바꾸지 않는다.
 *
 * 온도·경고·정지 계산은 users.ts 의 addTemperature · confirmNoshowDb 와 같은 규칙이다 (범위 [MIN, MAX], 소수 첫째 자리 반올림,
 * 경고가 기준에 닿으면 정지). 규칙을 바꿀 때는 두 곳을 함께 고치고, 같은 결과가 나오는지는 services/gathering.test.ts 가 비교한다.
 */
async function saveVersioned(
  id: string,
  next: Gathering,
  version: number,
  effect: ReputationEffect | undefined,
): Promise<boolean> {
  const docParams = [JSON.stringify(next), next.status, next.meetAt, id, version];
  if (!effect || (effect.temperatureDelta === 0 && effect.warningsDelta === 0)) {
    const { changes } = await run(
      `UPDATE lounge_gatherings
          SET data = ?::jsonb, status = ?, meet_at = ?::timestamptz, version = version + 1
        WHERE id = ? AND version = ?`,
      docParams,
    );
    return changes === 1;
  }

  const row = await get<{ changed: number }>(
    `WITH saved AS (
       UPDATE lounge_gatherings
          SET data = ?::jsonb, status = ?, meet_at = ?::timestamptz, version = version + 1
        WHERE id = ? AND version = ?
        RETURNING 1 AS one
     ), reputation AS (
       UPDATE users
          SET temperature = LEAST(${MAX_TEMPERATURE}, GREATEST(${MIN_TEMPERATURE}, ROUND((temperature + ?::float8)::numeric, 1))),
              warnings = warnings + ?::int,
              banned = banned OR (?::int > 0 AND warnings + ?::int >= ${WARNINGS_TO_BAN})
        WHERE id = ? AND EXISTS (SELECT 1 FROM saved)
     )
     SELECT COUNT(*)::int AS changed FROM saved`,
    [
      ...docParams,
      effect.temperatureDelta,
      effect.warningsDelta,
      effect.warningsDelta,
      effect.warningsDelta,
      Number(effect.userId),
    ],
  );
  return Number(row?.changed) === 1;
}

async function mutate(
  id: string,
  fn: GatheringMutationWithEffect,
  opts: { retries?: number },
): Promise<Result<Gathering>> {
  const retries = Math.max(0, Math.trunc(opts.retries ?? DEFAULT_RETRIES));
  for (let attempt = 0; attempt <= retries; attempt++) {
    const row = await get<VersionedRow>('SELECT data, version FROM lounge_gatherings WHERE id = ?', [id]);
    if (!row) return fail('NOT_FOUND', '모임을 찾을 수 없습니다.');

    const result = await fn(parse(row.data));
    if (!result.ok) return result;

    const { gathering: next, effect } = result.value;
    if (await saveVersioned(id, next, row.version, effect)) return ok(next);

    if (attempt < retries) await sleep(10 + Math.random() * 30);
  }
  return fail('CONFLICT');
}

/**
 * 낙관적 잠금으로 모임 한 건을 안전하게 바꾼다.
 *
 *   ① 읽기(문서 + version)  ② fn(도메인 함수)  ③ UPDATE … WHERE id=? AND version=?
 *   ④ 0행이면 그 사이 다른 요청이 먼저 바꾼 것 → **처음부터 다시**(읽기부터), 지연 10~40ms 무작위, 최대 `retries`번 다시
 *
 * 두 사람이 같은 의자에 동시에 앉으면 UPDATE 는 정확히 하나만 성공한다. 진 쪽은 다시 읽은 문서에 fn 을 또 돌려
 * 이번에는 도메인이 SLOT_FULL 을 돌려준다 — "빈 자리가 있다"는 판단이 항상 방금 읽은 문서 위에서만 이뤄지기 때문이다.
 * 끝내 계속 지면 CONFLICT. fn 이 실패(Result 실패)를 돌려주면 UPDATE 없이 그대로 돌려준다.
 *
 * fn 은 재시도 때마다 다시 불린다. 바깥 변수에 값을 남길 때는 매번 덮어써서 "마지막(성공한) 시도"의 값만 남게 하라.
 */
export function mutateGathering(
  id: string,
  fn: GatheringMutation,
  opts: { retries?: number } = {},
): Promise<Result<Gathering>> {
  return mutate(
    id,
    async (g) => {
      const result = await fn(g);
      return result.ok ? ok({ gathering: result.value }) : result;
    },
    opts,
  );
}

/**
 * `mutateGathering` 과 같지만 fn 이 문서와 함께 **한 사용자의 평판 변화**도 돌려준다. 둘은 한 문장으로 같이 반영된다
 * (saveVersioned 설명 참고). 버전 경쟁에서 지면 문서도 평판도 바뀌지 않고, fn 은 다시 읽은 문서로 처음부터 또 불린다.
 */
export function mutateGatheringWithReputation(
  id: string,
  fn: GatheringMutationWithEffect,
  opts: { retries?: number } = {},
): Promise<Result<Gathering>> {
  return mutate(id, fn, opts);
}

/** 목록용. 최신 글이 위(created_at 내림차순). `since` 는 "이 시각 이후에 만나는 모임만". */
export async function listGatherings(
  opts: { kind?: GatheringKind; since?: ISODateTime; limit?: number } = {},
): Promise<Gathering[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.kind) {
    where.push('kind = ?');
    params.push(opts.kind);
  }
  if (opts.since) {
    where.push('meet_at > ?::timestamptz');
    params.push(opts.since);
  }
  params.push(clampInt(opts.limit ?? 100, 1, 1000));
  // where 조각은 위에서 고정 문자열만 이어 붙인다. 값은 전부 ? 로 바인딩.
  const rows = await all<DataRow>(
    `SELECT data FROM lounge_gatherings
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id
      LIMIT ?`,
    params,
  );
  return rows.map((r) => parse(r.data));
}

/**
 * 내 모임: 내가 주최했거나, 앉아 있거나, 신청해 둔 것. 취소된 건 뺀다. 만나는 시각 오름차순.
 *
 * JSONB 안의 사람 찾기는 포함 연산자(`@>`)로 한다 — 값은 JSON 문자열로 바인딩되므로 SQL 주입이 불가능하고,
 * `LIKE '%3%'` 처럼 id "13" 이 "3" 으로 잘못 걸리는 일도 없다. (배열 포함은 "어느 원소든 일치"라는 뜻)
 */
export async function listMine(userId: string, since: ISODateTime, limit = 50): Promise<Gathering[]> {
  const seated = JSON.stringify({ slots: [{ memberIds: [userId] }] });
  const applied = JSON.stringify({ applicants: [{ userId }] });
  const rows = await all<DataRow>(
    `SELECT data FROM lounge_gatherings
      WHERE status <> 'cancelled'
        AND meet_at > ?::timestamptz
        AND (host_id = ? OR data @> ?::jsonb OR data @> ?::jsonb)
      ORDER BY meet_at ASC, id
      LIMIT ?`,
    [since, Number(userId), seated, applied, clampInt(limit, 1, 200)],
  );
  return rows.map((r) => parse(r.data));
}

/** 통계용: 전부. (캠퍼스 규모라 메모리에 올려 도메인 함수로 센다) */
export async function listAllGatherings(): Promise<Gathering[]> {
  const rows = await all<DataRow>('SELECT data FROM lounge_gatherings ORDER BY created_at DESC, id');
  return rows.map((r) => parse(r.data));
}
