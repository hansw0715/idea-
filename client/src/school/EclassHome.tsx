/**
 * 홈 첫 화면의 "미수강 강의" — 연동한 학교 계정으로 한성대 e-class 의 강의·과제·출석 현황을 읽기만 해서 보여 준다.
 *
 * - 마지막으로 읽은 결과는 이 기기에만 둔다(localStorage, 사용자별). 먼저 그것을 보여 주고, 5분이 지났으면 한 번 새로 읽는다.
 * - 학교 계정은 필요한 순간에만 풀어(withCredentials) 서버로 보낸다. 인증 실패·잠금 뒤에는 자동으로 다시 시도하지 않는다.
 * - 모르는 상태("확인 필요")를 완료나 0개로 보여 주지 않는다. 강의 영상·제출·출석 처리는 이 화면에서 하지 않는다(e-class 에서).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import type { EclassItem, EclassSnapshot } from "../../../shared/school/eclass";
import {
  Alert,
  Button,
  Icon,
  LoadingBlock,
  btnClass,
} from "../ui";
import { schoolApi } from "./api";
import { isCredentialFailure, needsRelink, schoolErrorMessage } from "./errors";
import {
  ECLASS_STALE_MS,
  countsOf,
  deadlineOf,
  formatDue,
  isAvailable,
  isThisWeek,
  needsAttention,
  safeEclassUrl,
  shortDeadline,
  sortItems,
  ts,
} from "./eclassLogic";
import { useSchool } from "./SchoolContext";
import "./eclass.css";

const PAGE = 5;

/** 강좌 이름 정리: [분반] 표기와 NEW 표시를 떼어 낸다 */
function courseLabel(name: string): string {
  const cleaned = name
    .replace(/\[[^\]]*\]/g, "")
    .replace(/NEW.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || name;
}

/** 항목 아래 한 줄: 마감 시각 · 진도 · 확인 필요. 완료된 항목은 비운다(위 배지가 말해 준다) */
function detailOf(item: EclassItem, now: number): string {
  if (!isAvailable(item, now))
    return item.availableAt
      ? `${formatDue(item.availableAt)}에 공개돼요`
      : "아직 공개되지 않았어요";
  if (item.completion === "completed") return "";
  const parts: string[] = [];
  if (item.completion === "unknown") parts.push("완료 여부 확인 필요");
  if (item.dueAt) parts.push(formatDue(item.dueAt));
  if (item.kind === "lecture" && item.progress !== null && item.progress > 0)
    parts.push(`학습 ${Math.round(item.progress)}%`);
  return parts.join(" · ");
}

const cacheKey = (userId: number) => `sangsang-booke:eclass:${userId}`;

function readCache(userId: number): EclassSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const s = JSON.parse(raw) as EclassSnapshot;
    return Array.isArray(s?.items) && typeof s.syncedAt === "string" ? s : null;
  } catch {
    return null;
  }
}

function writeCache(userId: number, snapshot: EclassSnapshot): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(snapshot));
    // 홈 요약 카드(EclassHomeCard)가 새 결과를 다시 읽게 알린다
    window.dispatchEvent(new Event("sangsang-booke:eclass-updated"));
  } catch {
    /* 저장하지 못해도 이번 화면에서는 그대로 보인다 */
  }
}

export default function EclassHome() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const school = useSchool();
  const uid = user?.id ?? null;

  const [snapshot, setSnapshot] = useState<EclassSnapshot | null>(() =>
    uid === null ? null : readCache(uid),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    relink: boolean;
  } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [now, setNow] = useState(() => Date.now());
  const requestedItem = params.get("item");
  useEffect(() => {
    if (!requestedItem) return;
    // 홈에서 누른 항목이 접힌 범위(더 보기) 뒤에 있으면 다 펼친다
    setLimit(Number.MAX_SAFE_INTEGER);
  }, [requestedItem]);
  useEffect(() => {
    if (!requestedItem) return;
    const target = document.getElementById(`eclass-item-${requestedItem}`);
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [requestedItem, snapshot, limit]);
  const alive = useRef(true);
  const inFlight = useRef(false);
  // 인증 실패·잠금 뒤에는 이 방문 동안 자동으로 다시 시도하지 않는다
  const blocked = useRef(false);

  useEffect(() => {
    alive.current = true;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive.current = false;
      window.clearInterval(t);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current || uid === null) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await school.withCredentials((creds) =>
        schoolApi.eclass(creds),
      );
      if (!alive.current) return;
      blocked.current = false;
      setSnapshot(next);
      writeCache(uid, next);
      setNow(Date.now());
    } catch (err) {
      if (!alive.current) return;
      if (isCredentialFailure(err) || needsRelink(err)) blocked.current = true;
      setError({ message: schoolErrorMessage(err), relink: needsRelink(err) });
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, [school, uid]);

  // 들어왔을 때: 정보가 없거나 5분이 지났으면 한 번 읽는다 (연동이 쓸 수 있을 때만)
  useEffect(() => {
    if (!school.canUse || blocked.current) return;
    const at = ts(snapshot?.syncedAt ?? null);
    if (at === null || Date.now() - at > ECLASS_STALE_MS) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school.canUse]);

  const counts = useMemo(
    () => (snapshot ? countsOf(snapshot.items, now) : null),
    [snapshot, now],
  );
  const visible = useMemo(() => {
    if (!snapshot) return [];
    return sortItems(
      // 강의·과제를 함께. 꺼짐: 아직 안 한 것(공개 전은 제외) / 켜짐: 이번 주차에 완료한 것만
      snapshot.items.filter((i) =>
        showDone
          ? i.completion === "completed" &&
            isAvailable(i, now) &&
            isThisWeek(i, now)
          : needsAttention(i, now),
      ),
      now,
    );
  }, [snapshot, showDone, now]);
  // 보이는 항목을 강좌별로 묶는다 (강좌 순서는 가장 급한 항목 기준). 한 강좌 안에서는 강의 밑에 과제
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { courseId: string; name: string; items: EclassItem[] }
    >();
    for (const item of visible.slice(0, limit)) {
      const group = map.get(item.courseId) ?? {
        courseId: item.courseId,
        name: courseLabel(item.courseName),
        items: [],
      };
      group.items.push(item);
      map.set(item.courseId, group);
    }
    const groups = [...map.values()];
    // 정렬은 안정적이라 같은 종류 안에서는 급한 순서가 그대로 남는다
    for (const g of groups) g.items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "lecture" ? -1 : 1));
    return groups;
  }, [visible, limit]);
  // 접은 강좌 (강좌 이름 옆 화살표)
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggleFold = (courseId: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  const syncedAt = ts(snapshot?.syncedAt ?? null);

  const head = (
    <div className="section__head">
      <h2 className="section__title" id="eclass-title">
        강의·과제 현황
      </h2>
    </div>
  );

  // 연동 전 / 이 기기에서 쓸 수 없음
  if (!school.loading && !school.linked) {
    return (
      <section className="section" aria-labelledby="eclass-title">
        {head}
        <div className="card school-eclass-empty">
          <p className="bold">남은 강의와 과제를 한곳에서 확인해요</p>
          <p className="text-sub text-sm">
            학교 계정을 연동하면 미수강 강의와 미제출 과제, 마감까지 남은 시간을
            볼 수 있어요.
          </p>
          <Link to="/account" className={btnClass({ variant: "secondary" })}>
            학교 계정 연동하기
          </Link>
        </div>
      </section>
    );
  }
  if (!school.loading && school.linked && !school.canUse && !snapshot) {
    return (
      <section className="section" aria-labelledby="eclass-title">
        {head}
        <div className="card school-eclass-empty">
          <p className="bold">이 기기에서는 e-class를 확인할 수 없어요</p>
          <p className="text-sub text-sm">
            로그아웃한 뒤 다시 로그인하면 이 기기에서도 확인할 수 있어요.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="section"
      // 정보가 있으면 제목은 카드 안(강의/과제 선택 위)에 있다
      aria-labelledby={snapshot ? undefined : "eclass-title"}
      aria-label={snapshot ? "강의·과제 현황" : undefined}
      aria-busy={loading || undefined}
    >
      {!snapshot && head}

      {error && (
        <Alert
          tone="danger"
          title="e-class 정보를 불러오지 못했어요"
          actions={
            error.relink ? (
              <Link
                to="/account"
                className={btnClass({ variant: "secondary", size: "sm" })}
              >
                내 정보로 가기
              </Link>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                loading={loading}
                onClick={() => void refresh()}
              >
                다시 불러오기
              </Button>
            )
          }
        >
          {error.message}
          {snapshot ? " 마지막으로 확인한 정보를 보여 드려요." : ""}
        </Alert>
      )}

      {!snapshot ? (
        <div className="card">
          {loading || school.loading ? (
            <LoadingBlock>
              e-class를 확인하는 중입니다. 강좌가 많으면 조금 걸려요.
            </LoadingBlock>
          ) : (
            <div className="school-eclass-empty">
              <p className="text-sub">아직 e-class 정보를 확인하지 못했어요.</p>
              <Button variant="secondary" onClick={() => void refresh()}>
                지금 확인하기
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="card school-eclass">
          {counts && counts.unknownCompletion > 0 && (
            <p className="text-sub text-sm">
              완료 여부를 확인하지 못한 {counts.unknownCompletion}개는 위 숫자에
              넣지 않았어요.
            </p>
          )}

          {snapshot.warnings.length > 0 && (
            <Alert tone="warning" title="일부 정보는 e-class에서 확인해 주세요">
              <ul className="school-eclass__warnings">
                {snapshot.warnings.slice(0, 4).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}

          {/* 맨 위 줄: 미수강 강의 · 미제출 과제 남은 개수 (보여 주기만. 아래 목록은 강의·과제 함께) */}
          <div className="school-eclass__controls">
            <div className="school-eclass__tally">
              {(
                [
                  ["lecture", "미수강 강의", counts?.pendingLectures ?? 0],
                  ["assignment", "미제출 과제", counts?.pendingAssignments ?? 0],
                ] as const
              ).map(([value, label, count]) => (
                <div key={value} className={`school-eclass__tile${count > 0 ? " is-left" : ""}`}>
                  {/* 홈 카드와 같은 모양: 왼쪽 이름, 오른쪽 큰 남은 개수 */}
                  <span>{label}</span>
                  <strong className="tabular">{count}</strong>
                </div>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            // "챙길 …가 없어요" 문구는 두지 않는다(비어 있으면 아무것도 그리지 않는다)
            snapshot.items.length === 0 ? (
              <p className="school-eclass__none">확인된 강의·과제가 없어요.</p>
            ) : showDone ? (
              <p className="school-eclass__none">이번주에 완료한 강의·과제가 없어요.</p>
            ) : null
          ) : (
            <div className="school-eclass__groups">
              {groups.map((group) => (
                <section
                  key={group.courseId}
                  className="school-eclass__group"
                  aria-label={group.name}
                >
                  {/* 강좌 이름 · 남은 개수(접었을 때만) · 접기 */}
                  <div className="school-eclass__course">
                    <h3>{group.name}</h3>
                    {folded.has(group.courseId) && (
                      <span className="school-eclass__count tabular">
                        {group.items.length}개
                      </span>
                    )}
                    <button
                      type="button"
                      className="school-eclass__fold"
                      aria-expanded={!folded.has(group.courseId)}
                      aria-label={`${group.name} ${folded.has(group.courseId) ? "펼치기" : "접기"}`}
                      onClick={() => toggleFold(group.courseId)}
                    >
                      <Icon name={folded.has(group.courseId) ? "chevron-down" : "chevron-up"} />
                    </button>
                  </div>
                  {!folded.has(group.courseId) && (
                    <ul className="school-eclass__list">
                      {group.items.map((item) => {
                        const d = deadlineOf(item, now);
                        const detail = detailOf(item, now);
                        return (
                          <li
                            key={item.id}
                            id={`eclass-item-${item.id}`}
                            tabIndex={-1}
                            className={`school-eclass__item${requestedItem === item.id ? " is-requested" : ""}`}
                          >
                            {/* 카드 전체가 e-class 로 가는 링크: 왼쪽 남은 기간 · 제목 · 날짜 · 화살표 */}
                            <a
                              className="school-eclass__card"
                              href={safeEclassUrl(item.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span
                                className={`school-eclass__dday school-eclass__dday--${d.tone}`}
                                title={d.label}
                              >
                                {shortDeadline(d.label)}
                                <span className="sr-only"> ({d.label})</span>
                              </span>
                              <span className="school-eclass__body">
                                <span className="school-eclass__title">
                                  <b className={`school-eclass__kindtag school-eclass__kindtag--${item.kind}`}>
                                    {item.kind === "lecture" ? "강의" : "과제"}
                                  </b>
                                  {item.title}
                                </span>
                                {detail && <span className="school-eclass__sub">{detail}</span>}
                              </span>
                              <Icon name="chevron-right" className="school-eclass__go" />
                              <span className="sr-only">(e-class, 새 창으로 열림)</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}

          {visible.length > limit && (
            <Button
              variant="secondary"
              block
              onClick={() => setLimit((n) => n + PAGE)}
            >
              {PAGE}개 더 보기 ({Math.min(limit, visible.length)}/
              {visible.length})
            </Button>
          )}

          {/* 마지막 확인 바로 위: 이번주 완료 보기 (오른쪽) */}

          <div className="school-eclass__donerow">
            <button
              type="button"
              className="school-eclass__textbtn school-eclass__done"
              aria-pressed={showDone}
              onClick={() => {
                setShowDone((v) => !v);
                setLimit(PAGE);
              }}
            >
              {showDone && <Icon name="check" className="btn__icon" />}
              이번주 완료 보기
            </button>
          </div>

          <div className="school-eclass__foot">
            <span className="school-eclass__stamp">
              마지막 확인{" "}
              {syncedAt === null ? "-" : formatDue(snapshot.syncedAt)}
            </span>
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
          </div>
        </div>
      )}
    </section>
  );
}
