import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Icon } from "../ui";
import type { EclassItem, EclassSnapshot } from "../../../shared/school/eclass";
import {
  ECLASS_STALE_MS,
  countsOf,
  formatDue,
  isAvailable,
  needsAttention,
  shortDeadline,
  sortItems,
  deadlineOf,
  ts,
} from "./eclassLogic";
import type { EclassCounts } from "./eclassLogic";
import { schoolApi } from "./api";
import { isCredentialFailure, needsRelink } from "./errors";
import { useSchool } from "./SchoolContext";
import "./eclass.css";

/** 홈에서도 들어왔을 때 5분이 지났으면 한 번 새로 읽고(학사 알림과 같은 규칙), 오른쪽 위 버튼으로 바로 새로고침한다.
 *  안 한 강의·과제는 급한 순서로 전부 한 줄씩 */

const KIND_LABEL = { lecture: "강의", assignment: "과제" } as const;

/** e-class 결과가 새로 저장되면 알리는 이벤트 (EclassHome 이 저장할 때 보낸다) */
export const ECLASS_UPDATED_EVENT = "sangsang-booke:eclass-updated";

const cacheKey = (userId: number) => `sangsang-booke:eclass:${userId}`;

export function readEclassSnapshot(userId: number): EclassSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const s = JSON.parse(raw) as EclassSnapshot;
    return Array.isArray(s?.items) ? s : null;
  } catch {
    return null;
  }
}

/** 새로 읽은 결과를 이 기기에 두고, 화면들(홈 카드 · 학사 알림)에 알린다 */
function writeEclassSnapshot(userId: number, snapshot: EclassSnapshot): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(snapshot));
  } catch {
    /* 저장하지 못해도 이번 화면에서는 알림으로 다시 그린다 */
  }
  window.dispatchEvent(new Event(ECLASS_UPDATED_EVENT));
}

/**
 * 이 기기에 저장한 강의·과제 조회 결과를 요약한다. 결과가 없거나 5분이 지났으면 들어왔을 때 한 번 새로 읽는다.
 * 인증 실패·다시 연동 필요 뒤에는 이 방문 동안 자동으로 다시 시도하지 않는다(학사 알림과 같은 규칙).
 */
export default function EclassHomeCard() {
  const { user } = useAuth();
  const school = useSchool();
  const [items, setItems] = useState<EclassItem[] | null>(null);
  const [counts, setCounts] = useState<EclassCounts | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      const snap = readEclassSnapshot(user.id);
      const now = Date.now();
      setSyncedAt(snap?.syncedAt ?? null);
      setCounts(snap ? countsOf(snap.items, now) : null);
      setNow(now);
      setItems(
        snap
          ? sortItems(
              snap.items.filter(
                (i) => isAvailable(i, now) && needsAttention(i, now),
              ),
              now,
            )
          : null,
      );
    };
    load();
    window.addEventListener(ECLASS_UPDATED_EVENT, load);
    const timer = window.setInterval(load, 30_000);
    return () => {
      window.removeEventListener(ECLASS_UPDATED_EVENT, load);
      window.clearInterval(timer);
    };
  }, [user]);

  // 학교에서 새로 읽기 (오른쪽 위 새로고침 · 들어왔을 때 자동)
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const blocked = useRef(false);
  const uid = user?.id ?? null;
  const refresh = useCallback(async () => {
    if (inFlight.current || uid === null) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const next = await school.withCredentials((creds) => schoolApi.eclass(creds));
      blocked.current = false;
      writeEclassSnapshot(uid, next);
    } catch (err) {
      if (isCredentialFailure(err) || needsRelink(err)) blocked.current = true;
      setFailed(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [school, uid]);
  useEffect(() => {
    if (!school.canUse || blocked.current || uid === null) return;
    const at = ts(readEclassSnapshot(uid)?.syncedAt ?? null);
    if (at === null || Date.now() - at > ECLASS_STALE_MS) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school.canUse, uid]);

  const itemLink = (item: EclassItem) =>
    `/campus?tab=learning&item=${encodeURIComponent(item.id)}`;
  // 안 한 강의·과제는 개수 칸과 맞게 전부 보여 준다 (이미 급한 순서로 정렬돼 있다)
  const shown = items ?? [];

  let body;
  if (school.loading)
    body = <p className="home-card__sub">학교 연동 상태를 확인하고 있어요.</p>;
  else if (!school.linked)
    body = <p className="home-card__sub">학교 계정을 연동하면 볼 수 있어요.</p>;
  else if (items === null || counts === null)
    body = (
      <p className="home-card__sub">
        {loading ? "e-class를 확인하는 중이에요." : "새로고침을 눌러 최신 현황을 확인하세요."}
      </p>
    );
  else
    body = (
      <>
        {/* 한눈에: 남은 개수 두 칸 (누르면 학사 알림 목록으로) */}
        <div className="home-learning__counts">
          {(
            [
              ["lecture", "미수강 강의", counts.pendingLectures],
              ["assignment", "미제출 과제", counts.pendingAssignments],
            ] as const
          ).map(([kind, label, count]) => (
            <Link
              key={kind}
              to="/campus?tab=learning"
              className={`home-learning__count${count > 0 ? " is-left" : ""}`}
            >
              <span>{label}</span>
              <strong className="tabular">{count}</strong>
            </Link>
          ))}
        </div>
        {/* 안 한 강의·과제 전부 급한 순서로 한 줄씩: 남은 기간 · [강의/과제] 제목 */}
        {shown.length === 0 ? (
          <p className="home-card__sub">남은 강의·과제가 없어요.</p>
        ) : (
          <ul className="home-learning__next">
            {shown.map((i) => {
              const d = deadlineOf(i, now);
              return (
                <li key={i.id}>
                  <Link to={itemLink(i)}>
                    <span
                      className={`school-eclass__dday school-eclass__dday--${d.tone}`}
                    >
                      {i.completion === "unknown" ? "확인" : shortDeadline(d.label)}
                    </span>
                    <span className="home-learning__title">
                      <b className={`school-eclass__kindtag school-eclass__kindtag--${i.kind}`}>
                        {KIND_LABEL[i.kind]}
                      </b>
                      {i.title}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );

  return (
    <article className="home-panel home-learning">
      {/* 제목 줄 오른쪽 끝에 새로고침 (학사 알림은 맨 아래에 두지만, 홈 카드는 아래 공간이 없어 위로) */}
      <div className="home-sum__head home-learning__head">
        <h2 className="home-sum__title">강의·과제</h2>
        {school.linked && (
          <button
            type="button"
            className="school-eclass__textbtn school-eclass__refresh"
            disabled={loading || !school.canUse}
            aria-busy={loading || undefined}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" className="btn__icon" />
            {loading ? "확인 중" : "새로고침"}
          </button>
        )}
      </div>
      {body}
      <div className="home-learning__foot">
        {school.linked && syncedAt ? (
          <span className="home-learning__stamp">
            {failed ? "새로 읽지 못했어요 · " : ""}
            {formatDue(syncedAt)} 확인
          </span>
        ) : (
          <span />
        )}
        <Link to="/campus" className="home-sum__link">
          전체 보기
          <Icon name="chevron-right" />
        </Link>
      </div>
    </article>
  );
}
