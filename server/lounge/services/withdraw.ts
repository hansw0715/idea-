/**
 * 회원 탈퇴 때의 라운지 자료 정리. `DELETE /api/auth/me` 가 users 행을 지우기 **전에** 부른다 (server/auth.ts).
 *
 * 왜 필요한가
 *  - lounge_gatherings.host_id 는 `ON DELETE CASCADE` 라서, 아무 처리 없이 주최자를 지우면 이미 자리가 찬 모임과
 *    단톡방이 다른 참여자에게서 통째로 사라진다 (그 모임의 메시지 행은 room_id 에 FK 가 없어 고아로 남는다).
 *  - 탈퇴한 사용자의 메시지는 user_id 만 NULL 이 되고 본문은 그대로 남는다.
 *  - 탈퇴한 사용자의 승인 대기 신청이 남아 있으면 주최자가 "(탈퇴한 사용자)" 를 승인해 유령 자리를 만들 수 있다.
 *
 * 정책 (계약 §3.4 의 "탈퇴한 사용자 자리는 unknownUser" 를 지키면서)
 *  1. 주최 중인 모임: 다른 참여자가 있으면 **가장 먼저 앉은 사람**(자리 순서, 정지 안 된 사람 우선)에게 주최를 넘긴다.
 *     문서의 hostId 와 인덱스용 host_id 컬럼을 같이 바꾼다. 앉은 사람이 아무도 없는 모임만 지우고, 그 방 메시지도 함께 지운다.
 *     탈퇴자의 자리는 일반 참여자가 탈퇴했을 때와 똑같이 "(탈퇴한 사용자)" 로 남는다.
 *  2. 승인 대기 중이던 신청은 지운다.
 *  3. 탈퇴자가 쓴 메시지는 본문을 지우고 "탈퇴한 사용자의 메시지예요." 안내(system)로 바꾼다. 대화 흐름(시간 순서)은 남기되
 *     내용은 남기지 않는다. 차단한 사용자의 메시지를 가리는 방식(domain/chat 의 hideBlocked)과 같은 모양이다.
 *
 * 동시성: 모임 문서는 version 낙관적 잠금이다. 여기서도 "읽기 → 판단 → UPDATE … WHERE version = ?" 를 충돌하면 처음부터 다시 한다.
 * 그래서 탈퇴와 동시에 누군가 그 모임에 앉아도 (방금 앉은 사람을 포함해서) 다시 읽은 문서로 승계 대상을 정한다.
 * 이 함수가 끝내 실패하면 예외를 던지고, 호출한 쪽은 사용자 행을 지우지 않는다 — 탈퇴는 다시 시도할 수 있지만 지워진 모임은 못 되돌린다.
 */
import { all, get, run } from '../../db.js';
import type { Gathering } from '../../../shared/lounge/gathering.js';
import { loadUsers } from '../users.js';

/** 탈퇴한 사용자가 쓴 말풍선 자리에 대신 보이는 문장 */
export const WITHDRAWN_MESSAGE_TEXT = '탈퇴한 사용자의 메시지예요.';

/** 같은 모임을 다른 요청이 계속 바꿔서 이 횟수만큼 져도 끝내지 못하면 예외 */
const MAX_ATTEMPTS = 8;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const parse = (data: unknown): Gathering => (typeof data === 'string' ? JSON.parse(data) : data) as Gathering;

type Candidate = { banned: boolean };

/**
 * 주최를 이어받을 사람. 앉은 순서(자리 목록 순서, 자리 안에서는 앉은 순서)로 첫 번째이고, 지금도 있는 사용자여야 한다.
 * 이용이 정지된 사람은 주최 일(승인·취소)을 못 하므로, 정지 안 된 후보가 있으면 그 사람을 먼저 고른다.
 * 후보가 없으면 null (모임을 지운다). 순수 함수.
 */
export function pickHeir(g: Pick<Gathering, 'slots'>, leavingId: string, alive: ReadonlyMap<string, Candidate>): string | null {
  const seated = g.slots.flatMap((s) => s.memberIds).filter((id) => id !== leavingId && alive.has(id));
  return seated.find((id) => !alive.get(id)?.banned) ?? seated[0] ?? null;
}

type Outcome = 'transferred' | 'deleted' | 'unchanged';

/** 내가 주최한 모임 한 건을 넘기거나 지운다. */
async function releaseHosted(gatheringId: string, leavingId: string): Promise<Outcome> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await get<{ data: unknown; version: number }>(
      'SELECT data, version FROM lounge_gatherings WHERE id = ?',
      [gatheringId],
    );
    if (!row) return 'unchanged';
    const g = parse(row.data);
    if (g.hostId !== leavingId) return 'unchanged'; // 다른 요청이 이미 넘겼다

    const seated = [...new Set(g.slots.flatMap((s) => s.memberIds))].filter((id) => id !== leavingId);
    const heir = pickHeir(g, leavingId, await loadUsers(seated));

    if (heir === null) {
      const { changes } = await run('DELETE FROM lounge_gatherings WHERE id = ? AND version = ?', [gatheringId, row.version]);
      if (changes === 1) {
        await run('DELETE FROM lounge_messages WHERE room_id = ?', [gatheringId]);
        return 'deleted';
      }
    } else {
      // 문서의 hostId 와 인덱스용 사본(host_id)을 한 문장으로 같이 바꾼다 — 따로 바꾸면 사이에 어긋난 모임이 보인다.
      const { changes } = await run(
        `UPDATE lounge_gatherings
            SET data = ?::jsonb, host_id = ?, version = version + 1
          WHERE id = ? AND version = ?`,
        [JSON.stringify({ ...g, hostId: heir }), Number(heir), gatheringId, row.version],
      );
      if (changes === 1) return 'transferred';
    }
    await sleep(10 + Math.random() * 30);
  }
  throw new Error(`모임 ${gatheringId} 의 주최자를 넘기지 못했습니다 (동시에 계속 바뀌었습니다).`);
}

/** 혼자뿐인 모임은 지우고, 정원 2명짜리 밥약은 취소하고 대화를 비운다. 그 밖의 모임은 건드리지 않는다. */
async function dropSeat(gatheringId: string, leavingId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await get<{ data: unknown; version: number }>(
      'SELECT data, version FROM lounge_gatherings WHERE id = ?',
      [gatheringId],
    );
    if (!row) return;
    const g = parse(row.data);
    if (!g.slots.some((s) => s.memberIds.includes(leavingId))) return;
    const slots = g.slots.map((s) => ({ ...s, memberIds: s.memberIds.filter((m) => m !== leavingId) }));
    const remaining = new Set(slots.flatMap((s) => s.memberIds));
    const capacity = g.slots.reduce((n, s) => n + s.capacity, 0);
    if (remaining.size === 0) {
      const { changes } = await run('DELETE FROM lounge_gatherings WHERE id = ? AND version = ?', [gatheringId, row.version]);
      if (changes === 1) {
        await run('DELETE FROM lounge_messages WHERE room_id = ?', [gatheringId]);
        return;
      }
    } else {
      // 3명 이상이 모이는 일반 모임은 그대로 둔다 — 이미 열린 단톡방을 남은 사람들이 계속 쓴다(탈퇴자는 "탈퇴한 사용자"로 보인다).
      // 정원이 2명뿐인 밥약만 취소하고 대화를 비운다: 둘 중 하나가 사라진 약속과 방은 의미가 없고, 다음 밥약을 막으면 안 된다.
      if (!(g.kind === 'meal' && capacity === 2)) return;
      const { changes } = await run(
        "UPDATE lounge_gatherings SET data = ?::jsonb, status = 'cancelled', version = version + 1 WHERE id = ? AND version = ?",
        [JSON.stringify({ ...g, slots, status: 'cancelled' }), gatheringId, row.version],
      );
      if (changes === 1) {
        await run('DELETE FROM lounge_messages WHERE room_id = ?', [gatheringId]);
        return;
      }
    }
    await sleep(10 + Math.random() * 30);
  }
  throw new Error(`모임 ${gatheringId} 에서 자리를 빼지 못했습니다 (동시에 계속 바뀌었습니다).`);
}

/** 다른 모임에 걸어 둔 내 승인 대기 신청을 지운다. */
async function dropApplications(gatheringId: string, leavingId: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await get<{ data: unknown; version: number }>(
      'SELECT data, version FROM lounge_gatherings WHERE id = ?',
      [gatheringId],
    );
    if (!row) return false;
    const g = parse(row.data);
    const applicants = g.applicants.filter((a) => a.userId !== leavingId);
    if (applicants.length === g.applicants.length) return false;

    const { changes } = await run(
      'UPDATE lounge_gatherings SET data = ?::jsonb, version = version + 1 WHERE id = ? AND version = ?',
      [JSON.stringify({ ...g, applicants }), gatheringId, row.version],
    );
    if (changes === 1) return true;
    await sleep(10 + Math.random() * 30);
  }
  throw new Error(`모임 ${gatheringId} 의 신청을 정리하지 못했습니다 (동시에 계속 바뀌었습니다).`);
}

export type WithdrawalReport = {
  /** 다른 참여자에게 주최를 넘긴 모임 수 */
  transferred: number;
  /** 혼자라서 (메시지와 함께) 지운 모임 수 */
  deleted: number;
  /** 승인 대기 신청을 지운 모임 수 */
  applicationsDropped: number;
  /** 본문을 지운 메시지 수 */
  messagesBlanked: number;
};

/**
 * 탈퇴하는 사용자의 라운지 자료를 정리한다. users 행을 지우기 전에 부른다.
 * 여러 번 불러도 안전하다 (이미 정리된 것은 건드리지 않는다).
 */
export async function releaseLoungeForWithdrawal(userId: string): Promise<WithdrawalReport> {
  const n = Number(userId);
  if (!Number.isInteger(n)) throw new Error('사용자 id 가 올바르지 않습니다.');
  const report: WithdrawalReport = { transferred: 0, deleted: 0, applicationsDropped: 0, messagesBlanked: 0 };

  // 1) 주최 중인 모임
  const hosted = await all<{ id: string }>('SELECT id FROM lounge_gatherings WHERE host_id = ?', [n]);
  for (const { id } of hosted) {
    const outcome = await releaseHosted(id, userId);
    if (outcome === 'transferred') report.transferred += 1;
    if (outcome === 'deleted') report.deleted += 1;
  }

  // 1-2) 앉아 있던 자리 정리: 주최를 넘긴 모임을 포함해 내가 앉은 모든 모임에서 자리를 뺀다.
  //      그대로 두면 탈퇴한 사용자가 자리에 남아 "탈퇴한 사용자"로만 보이는 방이 생긴다. 둘뿐인 밥약은 통째로 취소하고 대화를 비운다.
  const seatedIn = await all<{ id: string }>('SELECT id FROM lounge_gatherings WHERE data @> ?::jsonb', [
    JSON.stringify({ slots: [{ memberIds: [userId] }] }),
  ]);
  for (const { id } of seatedIn) await dropSeat(id, userId);

  // 2) 남의 모임에 걸어 둔 신청. 값은 JSON 문자열로 바인딩된다 (repo/gatherings.ts 의 listMine 과 같은 포함 연산자).
  const applied = await all<{ id: string }>(
    'SELECT id FROM lounge_gatherings WHERE data @> ?::jsonb',
    [JSON.stringify({ applicants: [{ userId }] })],
  );
  for (const { id } of applied) {
    if (await dropApplications(id, userId)) report.applicationsDropped += 1;
  }

  // 3) 내가 쓴 메시지: 본문을 지우고 안내로 바꾼다. user_id 도 지금 비워서 곧 일어날 SET NULL 과 같은 상태로 만든다.
  const blanked = await run(
    `UPDATE lounge_messages SET kind = 'system', text = ?, user_id = NULL WHERE user_id = ? AND kind = 'text'`,
    [WITHDRAWN_MESSAGE_TEXT, n],
  );
  report.messagesBlanked = blanked.changes;

  return report;
}
