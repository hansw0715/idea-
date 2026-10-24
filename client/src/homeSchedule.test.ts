import { describe, expect, it } from "vitest";
import { homeWeekStart } from "./homeSchedule";

describe("홈의 기본 주", () => {
  it("평일에는 현재 주를 보여준다", () => {
    expect(homeWeekStart("2026-10-23")).toBe("2026-10-19");
    expect(homeWeekStart("2026-10-26")).toBe("2026-10-26");
  });
  it("토요일·일요일에는 다음 주를 보여준다", () => {
    expect(homeWeekStart("2026-10-24")).toBe("2026-10-26");
    expect(homeWeekStart("2026-10-25")).toBe("2026-10-26");
  });
  it("연도 경계에서도 다음 월요일을 계산한다", () => {
    expect(homeWeekStart("2022-12-31")).toBe("2023-01-02");
  });
});
