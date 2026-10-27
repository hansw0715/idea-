import { useEffect, useState } from "react";
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
} from "./eclassLogic";
import type { EclassCounts } from "./eclassLogic";
import { useSchool } from "./SchoolContext";
import "./eclass.css";

/** 홈에는 최근 조회 요약만 두고 학교에 대한 새 요청은 학사 알림에서 수행한다.
 *  강의·과제 각각 가장 급한 것 몇 개만 한 줄씩 (강의만 많아도 과제가 묻히지 않게 종류마다 따로 센다) */
const SHOW_PER_KIND = 2;

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

/**
 * 학사 알림 화면이 이 기기에 저장한 강의·과제 조회 결과를 요약한다.
 * 홈에서는 학교에 새로 요청하지 않으며, 캐시가 없으면 학사 알림으로 안내한다.
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

  const itemLink = (item: EclassItem) =>
    `/campus?tab=learning&item=${encodeURIComponent(item.id)}`;
  const shown = items
    ? sortItems(
        [
          ...items.filter((i) => i.kind === "lecture").slice(0, SHOW_PER_KIND),
          ...items.filter((i) => i.kind === "assignment").slice(0, SHOW_PER_KIND),
        ],
        now,
      )
    : [];

  let body;
  if (school.loading)
    body = <p className="home-card__sub">학교 연동 상태를 확인하고 있어요.</p>;
  else if (!school.linked)
    body = <p className="home-card__sub">학교 계정을 연동하면 볼 수 있어요.</p>;
  else if (items === null || counts === null)
    body = (
      <p className="home-card__sub">학사 알림에서 최신 현황을 확인하세요.</p>
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
        {/* 강의·과제 각각 가장 급한 것 한 줄씩: 남은 기간 · [강의/과제] 제목 */}
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
      <h2 className="home-sum__title">강의·과제</h2>
      {body}
      <div className="home-learning__foot">
        {school.linked && syncedAt ? (
          <span className="home-learning__stamp">
            {now - Date.parse(syncedAt) > ECLASS_STALE_MS ? "업데이트 필요 · " : ""}
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
