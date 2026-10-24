import { describe, expect, it } from "vitest";
import type { EclassItem } from "../../../shared/school/eclass";
import {
  countsOf,
  deadlineOf,
  isOpen,
  isThisWeek,
  needsAttention,
  nextDeadlineSummary,
  safeEclassUrl,
  sortItems,
  thisWeekRange,
} from "./eclassLogic";

const NOW = Date.parse("2026-10-11T03:00:00Z");
const item = (over: Partial<EclassItem>): EclassItem => ({
  id: "x",
  courseId: "1",
  courseName: "과목",
  title: "항목",
  kind: "lecture",
  url: "https://learn.hansung.ac.kr/x",
  completion: "pending",
  attendance: "unknown",
  dueAt: null,
  availableAt: null,
  progress: null,
  ...over,
});

describe("e-class 표시 계산", () => {
  it("가장 급한 종류의 같은 날 마감을 묶고, 모르는 완료 상태·공개 전·지난 기한은 빼고 센다", () => {
    const now = Date.parse("2026-10-25T14:55:00Z"); // 일요일 23:55 KST
    const tomorrow = "2026-10-25T15:10:00Z"; // 월요일 00:10 KST
    expect(
      nextDeadlineSummary(
        [
          item({ id: "a", kind: "assignment", dueAt: tomorrow }),
          item({ id: "b", kind: "assignment", dueAt: "2026-10-26T10:00:00Z" }),
          item({
            id: "unknown",
            kind: "assignment",
            dueAt: tomorrow,
            completion: "unknown",
          }),
          item({
            id: "future",
            kind: "assignment",
            dueAt: tomorrow,
            availableAt: "2026-10-25T15:00:00Z",
          }),
          item({ id: "past", dueAt: "2026-10-25T14:00:00Z" }),
        ],
        now,
      ),
    ).toEqual({ label: "내일 마감 과제 2개", kind: "assignment" });
  });
  it("알려진 마감이 없으면 임의의 0개를 표시하지 않는다", () => {
    expect(
      nextDeadlineSummary(
        [
          item({}),
          item({
            completion: "unknown",
            dueAt: new Date(NOW + 60_000).toISOString(),
          }),
        ],
        NOW,
      ),
    ).toBeNull();
  });
  it("완료 여부를 모르면 미수강·미제출 숫자에 넣지 않는다", () => {
    const c = countsOf(
      [
        item({ completion: "unknown" }),
        item({ completion: "pending" }),
        item({ kind: "assignment", completion: "pending" }),
      ],
      NOW,
    );
    expect(c).toMatchObject({
      pendingLectures: 1,
      pendingAssignments: 1,
      unknownCompletion: 1,
    });
  });
  it("숫자는 미수강 강의·미제출 과제만 센다 (출석은 따로 세지 않는다)", () => {
    const c = countsOf(
      [
        item({ completion: "completed", attendance: "present" }),
        item({ attendance: "unknown" }),
      ],
      NOW,
    );
    expect(Object.keys(c).sort()).toEqual([
      "pendingAssignments",
      "pendingLectures",
      "unknownCompletion",
    ]);
    expect(c.pendingLectures).toBe(1);
  });
  it("기한이 지난 항목은 미수강·미제출 숫자와 알림 목록에 넣지 않는다", () => {
    const past = new Date(NOW - 3_600_000).toISOString();
    const soon = new Date(NOW + 3_600_000).toISOString();
    expect(isOpen(item({ dueAt: past }), NOW)).toBe(false);
    expect(needsAttention(item({ dueAt: past }), NOW)).toBe(false);
    expect(needsAttention(item({ dueAt: soon }), NOW)).toBe(true);
    expect(
      countsOf([item({ dueAt: past }), item({ dueAt: soon })], NOW)
        .pendingLectures,
    ).toBe(1);
  });
  it("이번 주차: 한국 시간 월요일~일요일에 시작하거나 마감되는 항목", () => {
    // NOW = 2026-10-11(일) 12:00 KST → 이번 주는 10/05(월) 00:00 ~ 10/12(월) 00:00 KST
    const { start, end } = thisWeekRange(NOW);
    expect(new Date(start).toISOString()).toBe("2026-10-04T15:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-10-11T15:00:00.000Z");
    const inWeek = item({
      availableAt: "2026-10-04T15:00:00.000Z",
      dueAt: "2026-10-11T14:59:59.000Z",
    });
    const nextWeek = item({
      availableAt: "2026-10-11T15:00:00.000Z",
      dueAt: "2026-10-18T14:59:59.000Z",
    });
    const lastWeek = item({
      availableAt: "2026-09-27T15:00:00.000Z",
      dueAt: "2026-10-04T14:59:59.000Z",
    });
    expect(isThisWeek(inWeek, NOW)).toBe(true);
    expect(isThisWeek(nextWeek, NOW)).toBe(false);
    expect(isThisWeek(lastWeek, NOW)).toBe(false);
    expect(isThisWeek(item({}), NOW)).toBe(false);
  });
  it("공개 전 항목은 할 일에 세지 않는다", () => {
    const future = new Date(NOW + 86_400_000).toISOString();
    expect(countsOf([item({ availableAt: future })], NOW).pendingLectures).toBe(
      0,
    );
    expect(needsAttention(item({ availableAt: future }), NOW)).toBe(false);
  });
  it("마감까지 남은 시간 문구와 강도", () => {
    expect(
      deadlineOf(
        item({ dueAt: new Date(NOW + 30 * 60_000).toISOString() }),
        NOW,
      ),
    ).toEqual({ label: "30분 남음", tone: "danger" });
    expect(
      deadlineOf(
        item({ dueAt: new Date(NOW + 5 * 3_600_000).toISOString() }),
        NOW,
      ),
    ).toMatchObject({ tone: "warning" });
    expect(
      deadlineOf(item({ dueAt: new Date(NOW - 1000).toISOString() }), NOW)
        .label,
    ).toBe("기한 지남");
    expect(deadlineOf(item({ dueAt: null }), NOW).label).toBe("기한 확인 필요");
    expect(
      deadlineOf(item({ completion: "completed", kind: "assignment" }), NOW)
        .label,
    ).toBe("제출 완료");
  });
  it("마감이 빠른 순으로, 완료는 뒤로 정렬한다", () => {
    const a = item({
      id: "a",
      dueAt: new Date(NOW + 3 * 86_400_000).toISOString(),
    });
    const b = item({
      id: "b",
      dueAt: new Date(NOW + 1 * 86_400_000).toISOString(),
    });
    const done = item({
      id: "c",
      completion: "completed",
      dueAt: new Date(NOW + 1000).toISOString(),
    });
    expect(sortItems([a, done, b], NOW).map((i) => i.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
  it("e-class 밖의 주소는 열지 않는다", () => {
    expect(safeEclassUrl("https://evil.example/x")).toBe(
      "https://learn.hansung.ac.kr/",
    );
    expect(safeEclassUrl("javascript:alert(1)")).toBe(
      "https://learn.hansung.ac.kr/",
    );
    expect(
      safeEclassUrl("https://learn.hansung.ac.kr/course/view.php?id=7"),
    ).toBe("https://learn.hansung.ac.kr/course/view.php?id=7");
  });
});
