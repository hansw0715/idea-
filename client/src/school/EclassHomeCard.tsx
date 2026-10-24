import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Icon } from "../ui";
import type { EclassItem, EclassSnapshot } from "../../../shared/school/eclass";
import {
  ECLASS_STALE_MS,
  formatDue,
  isAvailable,
  needsAttention,
  sortItems,
  nextDeadlineSummary,
  deadlineOf,
} from "./eclassLogic";
import { useSchool } from "./SchoolContext";

/** 홈에는 최근 조회 요약만 두고 학교에 대한 새 요청은 학사 알림에서 수행한다. */
const SHOW = 3;

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

/** "[01]자료구조 NEW" → "자료구조" */
function courseLabel(name: string): string {
  const cleaned = name
    .replace(/\[[^\]]*\]/g, "")
    .replace(/NEW.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || name;
}

/**
 * 학사 알림 화면이 이 기기에 저장한 강의·과제 조회 결과를 요약한다.
 * 홈에서는 학교에 새로 요청하지 않으며, 캐시가 없으면 학사 알림으로 안내한다.
 */
export default function EclassHomeCard() {
  const { user } = useAuth();
  const school = useSchool();
  const [items, setItems] = useState<EclassItem[] | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      const snap = readEclassSnapshot(user.id);
      const now = Date.now();
      setSyncedAt(snap?.syncedAt ?? null);
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

  const summary =
    school.linked && items ? nextDeadlineSummary(items, now) : null;
  const itemLink = (item: EclassItem) =>
    `/campus?tab=learning&kind=${item.kind}&item=${encodeURIComponent(item.id)}`;

  let body;
  if (school.loading)
    body = <p className="home-card__sub">학교 연동 상태를 확인하고 있어요.</p>;
  else if (!school.linked)
    body = <p className="home-card__sub">학교 계정을 연동하면 볼 수 있어요.</p>;
  else if (items === null)
    body = (
      <p className="home-card__sub">강의·과제에서 최신 현황을 확인하세요.</p>
    );
  else if (items.length === 0)
    body = (
      <p className="home-card__sub">최근 조회에서 남은 강의·과제가 없어요.</p>
    );
  else
    body = (
      <ul className="home-card__list">
        {items.slice(0, SHOW).map((i) => (
          <li key={i.id} className="home-card__line">
            <Link to={itemLink(i)} className="home-learning__item">
              <span className="home-learning__course">
                {courseLabel(i.courseName)}
              </span>
              <strong>{i.title}</strong>
              <span className="home-learning__itemmeta">
                {i.kind === "lecture" ? "강의" : "과제"} ·{" "}
                {i.completion === "unknown"
                  ? "완료 여부 확인 필요"
                  : deadlineOf(i, now).label}
              </span>
            </Link>
          </li>
        ))}
        {items.length > SHOW && (
          <li className="home-card__more-count">외 {items.length - SHOW}개</li>
        )}
      </ul>
    );

  return (
    <article className="home-panel home-learning">
      <h2 className="home-sum__title">강의·과제</h2>
      {summary && (
        <Link
          className="home-learning__urgent"
          to={`/campus?tab=learning&kind=${summary.kind}`}
        >
          {summary.label}
          <Icon name="chevron-right" />
        </Link>
      )}
      {body}
      {school.linked && syncedAt && (
        <p className="home-learning__stamp">
          {now - Date.parse(syncedAt) > ECLASS_STALE_MS
            ? "업데이트가 필요해요. "
            : ""}
          마지막 확인 {formatDue(syncedAt)}
        </p>
      )}
      <Link to="/campus" className="home-sum__link">
        전체 강의·과제 보기
        <Icon name="chevron-right" />
      </Link>
    </article>
  );
}
