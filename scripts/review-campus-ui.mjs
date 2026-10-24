// Local visual/interaction review. All API responses are fixtures; no school or production requests.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.UI_REVIEW_URL ?? "http://127.0.0.1:5274";
const out = path.resolve(".tmp/ui-review");
await fs.mkdir(out, { recursive: true });
const user = {
  id: 90001,
  username: "campus-preview",
  name: "김한성",
  isAdmin: false,
};
const now = new Date();
const iso = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
const monday = new Date(`${iso(now)}T12:00:00+09:00`);
const weekday = new Date(
  monday.toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
).getDay();
monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7));
const dates = Array.from({ length: 5 }, (_, i) => {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + i);
  return iso(d);
});
const meeting = {
  id: 1,
  name: "캡스톤 디자인 팀",
  code: "4821",
  ownerId: user.id,
  memberCount: 4,
  createdAt: now.toISOString(),
};
const timetable = [
  {
    id: 1,
    day: 0,
    startMin: 540,
    endMin: 630,
    title: "자료구조",
    place: "공학관 302호",
    repeatKind: "weekly",
  },
  {
    id: 2,
    day: 0,
    startMin: 660,
    endMin: 750,
    title: "사용자 경험 디자인",
    place: "상상관 504호",
    repeatKind: "weekly",
  },
  {
    id: 3,
    day: 1,
    startMin: 600,
    endMin: 690,
    title: "웹 프로그래밍",
    place: "공학관 401호",
    repeatKind: "weekly",
  },
  {
    id: 4,
    day: 2,
    startMin: 840,
    endMin: 930,
    title: "데이터베이스",
    place: "공학관 203호",
    repeatKind: "weekly",
  },
  {
    id: 5,
    day: 3,
    startMin: 540,
    endMin: 630,
    title: "자료구조",
    place: "공학관 302호",
    repeatKind: "weekly",
  },
];
const tomorrow = new Date(now);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const reservation = {
  id: 1,
  meetingId: 1,
  meetingName: meeting.name,
  date: iso(tomorrow),
  startMin: 840,
  endMin: 900,
  facilityName: "상상관 스터디룸 3",
  facilityId: 1,
  building: "상상관",
  userId: user.id,
  userName: user.name,
  schoolStatus: "submitted",
};
const profile = {
  id: String(user.id),
  nickname: user.name,
  avatar: "cat",
  avatarColor: "m1",
  college: "IT공과대학",
  department: "컴퓨터공학부",
  entranceYear: 2023,
  temperature: 36.5,
  noShowWarnings: 0,
  banned: false,
};
const gathering = {
  id: 'review-meetup', kind: 'meetup', title: '수업 끝나고 가볍게 이야기 나눌 학우를 찾아요', body: '부담 없이 이야기해요.', place: '학교 정문 앞 카페', meetAt: tomorrow.toISOString(), joinDeadline: tomorrow.toISOString(), joinPolicy: 'auto', meta: { tags: [] }, status: 'open', host: profile,
  slots: [{ key: 'host', label: '우리 쪽', capacity: 2, members: [profile], seatsLeft: 1 }, { key: 'guest', label: '상대 쪽', capacity: 2, members: [], seatsLeft: 2 }],
  applicants: [], applicantCount: 0, noshowIds: [], myReviews: {}, roomOpen: false, createdAt: now.toISOString(), viewer: { userId: profile.id, isHost: true, isMember: true, isApplicant: false, mySlotKey: 'host', canJoin: false, canApply: false, canLeave: false, canReview: false, blockedReason: null, timetableConflict: null }
};
const snapshot = {
  courseCount: 3,
  syncedAt: now.toISOString(),
  warnings: [],
  items: [
    {
      id: "lecture-1",
      courseId: "a",
      courseName: "자료구조",
      title: "8주차 · 트리와 순회",
      kind: "lecture",
      url: "https://learn.hansung.ac.kr/",
      completion: "pending",
      attendance: "unknown",
      dueAt: new Date(now.getTime() + 86400000).toISOString(),
      availableAt: null,
      progress: 25,
    },
    {
      id: "assignment-1",
      courseId: "b",
      courseName: "웹 프로그래밍",
      title: "반응형 페이지 구현",
      kind: "assignment",
      url: "https://learn.hansung.ac.kr/",
      completion: "pending",
      attendance: "not_applicable",
      dueAt: new Date(now.getTime() + 2 * 86400000).toISOString(),
      availableAt: null,
      progress: null,
    },
  ],
};
const board = (name) => ({
  name,
  url: "https://www.hansung.ac.kr/",
  items: [
    "2026학년도 2학기 중간고사 및 학과별 시험 일정과 강의실 변경 안내",
    "상상관 스터디룸 이용 안내",
    "진로·취업 프로그램 참가자 모집",
    "교내 장학금 신청 안내",
  ].map((title, i) => ({
    id: `${name}-${i}`,
    title,
    date: iso(now),
    url: "https://www.hansung.ac.kr/",
  })),
});
const browser = await chromium.launch({ channel: "msedge" });
const reports = [];
async function review(
  width,
  mode = "normal",
  colorScheme = "light",
  height = 950,
) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
  });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(err.message));
  await context.addInitScript(
    ({ user, snapshot }) => {
      localStorage.setItem("sangsang-booke:use-web", "1");
      localStorage.setItem("sangsang-booke-user", JSON.stringify(user));
      localStorage.setItem(
        `sangsang-booke:eclass:${user.id}`,
        JSON.stringify(snapshot),
      );
    },
    { user, snapshot },
  );
  let meetings = [meeting];
  let currentProfile = { ...profile };
  let dashboardFailed = mode === "error";
  let newNotice = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.slice(4);
    let body = {};
    let status = 200;
    if (key === "/auth/me") body = user;
    else if (key === "/school/link")
      body = { linked: mode === "linked", cipher: null, hint: null };
    else if (key === "/lounge/me") {
      if (route.request().method() === 'PUT') currentProfile = { ...currentProfile, ...route.request().postDataJSON() };
      body = { profile: currentProfile, needsProfile: false, isAdmin: false };
    }
    else if (key === "/dashboard") {
      if (dashboardFailed) {
        body = { error: "연결을 확인한 뒤 다시 시도해 주세요." };
        status = 503;
      } else
        body = {
          user,
          meetings: mode === "empty" ? [] : meetings,
          reservations: mode === "empty" ? [] : [reservation],
          weekReservations: [],
          timetable: mode === "empty" ? [] : timetable,
          weekStart: dates[0],
        };
    } else if (key === "/notices")
      body = {
        school: board("학교"),
        department: board("컴퓨터공학부"),
        departmentName: "컴퓨터공학부",
      };
    else if (key === "/meetings" && route.request().method() === "POST") {
      const m = {
        ...meeting,
        id: 2,
        name: route.request().postDataJSON().name,
      };
      meetings = [...meetings, m];
      body = m;
    } else if (key === "/meetings") body = meetings;
    else if (/^\/meetings\/\d+$/.test(key))
      body = {
        ...meetings.find((m) => String(m.id) === key.split("/").at(-1)),
        members: [{ id: user.id, name: user.name, isOwner: 1 }],
      };
    else if (key === "/lounge/friends")
      body = { friends: [], incoming: [], outgoing: [] };
    else if (key === '/lounge/notifications') body = { notifications: mode === 'empty' ? [] : [
      { id: 'friend-1', title: '이부기', body: '친구 요청을 보냈어요.', url: '/account/friends', createdAt: now.toISOString() },
      { id: 'invite-1', title: '회의 초대', body: '캡스톤 팀에 초대했어요.', url: '/meetings/1', createdAt: now.toISOString() }
    ] };
    else if (key === '/lounge/rooms') body = { rooms: mode === 'empty' ? [] : [
      { id: 'review-room', title: '점심 먹고 도서관에서 같이 공부할 학우를 찾습니다', kind: 'meal', meetAt: now.toISOString(), place: '학생식당', memberCount: 2, readOnly: false },
      { id: 'old-room', title: '지난 미팅 대화', kind: 'meetup', meetAt: '2026-01-01T03:00:00Z', place: '상상관', memberCount: 4, readOnly: true }
    ] };
    else if (key === '/lounge/gatherings/review-room/messages') body = { room: { id: 'review-room', title: '점심 채팅방', kind: 'meal', meetAt: now.toISOString(), place: '학생식당', readOnly: false, members: [profile], messages: [] } };
    else if (key === "/lounge/gatherings" || key === "/lounge/mine")
      body = { gatherings: mode === 'empty' ? [] : key === '/lounge/mine' ? [gathering] : [gathering, { ...gathering, id: 'review-meetup-2', title: '금요일 저녁에 함께할 친구를 찾아요' }] };
    else if (key === '/lounge/gatherings/review-meetup') body = { gathering };
    else if (key === '/lounge/meals/quick') body = { state: { request: null, room: null, members: [], gatheringId: null, waitingCount: 0, meId: profile.id, forming: [] } };
    else if (key === "/timetable") body = timetable;
    else if (
      key === "/reservations" ||
      key.startsWith("/reservations/meeting/") ||
      /^\/meetings\/\d+\/timetable$/.test(key)
    )
      body = [];
    else if (key.includes("/free")) body = { slots: [] };
    else if (key === "/courses") body = { courses: [] };
    if (key === '/notices' && newNotice) body.school.items.unshift({ id: 'new-notice', title: '새로 올라온 학교 공지', date: iso(now), url: 'https://www.hansung.ac.kr/' });
    await route.fulfill({ status, json: body });
  });
  async function capture(name) {
    if (mode === "large")
      await page.evaluate(() =>
        document.documentElement.style.setProperty("--zoom", "1.5"),
      );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    await page.screenshot({
      path: path.join(out, `${width}-${colorScheme}-${mode}-${name}.png`),
      fullPage: true,
    });
    const size = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: document.documentElement.clientWidth,
    }));
    if (size.scroll > size.width + 1)
      console.log(
        await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width && r.right > innerWidth + 1;
            })
            .map((e) => ({
              tag: e.tagName,
              class: e.className,
              right: e.getBoundingClientRect().right,
            }))
            .slice(0, 10),
        ),
      );
    assert.ok(
      size.scroll <= size.width + 1,
      `${name}: horizontal overflow ${JSON.stringify(size)}`,
    );
    assert.equal(
      await page.locator("h1").count(),
      1,
      `${name}: expected one page title`,
    );
    reports.push({
      width,
      mode,
      colorScheme,
      screen: name,
      overflow: false,
      font: await page.evaluate(
        () => getComputedStyle(document.body).fontFamily,
      ),
    });
    if (width === 1440 && mode === "normal" && name === "home") {
      const html = await page.content();
      await fs.writeFile(
        path.join(out, "rendered-home.html"),
        html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace("<head>", `<head><base href="${base}/">`),
      );
    }
  }
  await page.goto(base, { waitUntil: "networkidle" });
  await capture("home");
  assert.equal(await page.locator('.home-profile img').getAttribute('src'), '/avatars/nyangi.webp');
  assert.equal(await page.locator('.home-shortcuts').count(), 0);
  assert.deepEqual(await page.locator('.dashboard-layout h2').allTextContents(), [await page.locator('#home-week-title').innerText(), '알림', '강의·과제', '학교 소식']);
  assert.equal(await page.getByRole('heading', { name: '다음 시설 예약', exact: true }).count(), 0);
  if (mode === 'empty') {
    await page.goto(`${base}/lounge/meetings`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '코드로 참가하기', exact: true }).click();
    await page.getByRole('dialog', { name: '코드로 참가하기' }).waitFor();
    await capture('empty-join-sheet');
  }
  if (mode === "error") {
    dashboardFailed = false;
    await page.getByRole("button", { name: "다시 시도", exact: true }).first().click();
    await page.locator('.home-agenda').getByRole('link', { name: /자료구조/ }).waitFor();
  }
  if (["normal", "reduced", "linked"].includes(mode)) {
    await page.getByRole('button', { name: '모두 확인', exact: true }).click();
    assert.equal(await page.locator('.tabbar__item[href="/"] .nav-dot').count(), 0);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('.tabbar__item[href="/"] .nav-dot').count(), 0);
    await page.getByRole('button', { name: '이번 주', exact: true }).click();
    await page.getByRole('heading', { name: '이번 주 일정', exact: true }).waitFor();
    await page.getByRole('button', { name: '다음 주 일정', exact: true }).click();
    await page.getByRole('heading', { name: '다음 주 일정', exact: true }).waitFor();
    await page.getByRole("button", { name: /화.*[0-9]+개/ }).click();
    await page.locator('.home-agenda').getByRole("link", { name: /웹 프로그래밍/ }).waitFor();
    await page.goto(`${base}/lounge`, { waitUntil: 'networkidle' });
    await page.locator('.lounge-hub-btn--meeting').click();
    await page.getByRole('button', { name: '회의 만들기', exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "새 회의 만들기" });
    await dialog.waitFor();
    await capture("create-sheet");
    const rect = await dialog.boundingBox();
    assert.ok(
      rect && rect.y >= 0 && rect.y + rect.height <= height + 1,
      "Sheet must fit inside the viewport",
    );
    await dialog
      .getByRole("textbox", { name: /회의 이름/ })
      .fill("UI 검토 회의");
    await dialog.getByRole("button", { name: "만들기", exact: true }).click();
    await page.waitForURL("**/meetings/2");
    await page
      .getByRole("heading", { name: "UI 검토 회의", exact: true })
      .waitFor();
    await page.getByRole('status').filter({ hasText: '회의를 만들었습니다.' }).waitFor();
    const participant = page.locator('.mtg-chip').first();
    assert.equal(await participant.locator('.badge').count(), 0);
    await participant.click();
    assert.equal(await participant.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByText('제외됨', { exact: true }).count(), 0);
    await participant.click();
    await capture('toast');
    await page.getByRole('button', { name: '알림 닫기', exact: true }).click();
    await page.goto(`${base}/meetings`, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "회의 만들기", exact: true })
      .click();
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.goto(`${base}/campus?tab=notices`, { waitUntil: "networkidle" });
    await page
      .getByRole("heading", { name: "학교 공지", exact: true })
      .waitFor();
    await capture("notices");
    assert.equal(await page.locator('.tabs').evaluate((el) => el.scrollHeight > el.clientHeight + 1), false, 'Academic tabs must not have vertical overflow');
    await page.getByRole("tab", { name: "학교·학과 공지" }).focus();
    await page.keyboard.press("ArrowLeft");
    assert.match(page.url(), /tab=learning/);
    await page.getByRole("heading", { name: "강의·과제 현황" }).waitFor();
    await capture("learning");
    assert.equal(await page.locator('.tabbar__item[href="/campus"] .nav-dot').count(), 0);
    newNotice = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('.tabbar__item[href="/campus"] .nav-dot').waitFor({ state: 'attached' });
    for (const [route, label] of [
      ["/timetable", "timetable"],
      ["/meetings", "meetings"],
      ["/lounge", "lounge"],
      ["/lounge?tab=chats", "chats"],
      ["/lounge/meetup", "meetup"],
      ["/account", "account"],
    ]) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      await capture(label);
      if (label === 'lounge') {
        assert.equal(await page.getByRole('heading', { name: '친구', exact: true }).count(), 0);
        assert.equal(await page.locator('.lounge-hub-btn').count(), 3);
        assert.equal(await page.getByRole('button', { name: '회의 만들기', exact: true }).count(), 0);
        await page.locator('.lounge-hub-btn--meal').click();
        await page.getByRole('heading', { name: '밥약', exact: true, level: 1 }).waitFor();
        await page.getByRole('button', { name: '밥약 시작하기', exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        await capture('meal-page');
        await page.getByRole('button', { name: '뒤로 가기', exact: true }).click();
        assert.match(page.url(), /\/lounge$/);
      }
      if (label === 'meetup') {
        assert.equal(await page.locator('.lounge-gathering-list > li').count(), 2);
        await page.locator('.lounge-gathering-list .lounge-gath-item').first().click();
        await page.getByRole('heading', { name: '미팅 상세', exact: true, level: 1 }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        await capture('meetup-detail');
        await page.getByRole('button', { name: '뒤로 가기', exact: true }).click();
        assert.match(page.url(), /\/lounge\/meetup$/);
      }
      if (label === 'timetable') assert.equal(await page.locator('.tt-page .tabs').evaluate((el) => getComputedStyle(el, '::after').content), 'none');
      if (label === 'meetings') {
        assert.match(page.url(), /\/lounge\/meetings$/);
        await page.getByRole('heading', { name: '팀 회의', exact: true }).waitFor();
      }
      if (label === 'chats') {
        await page.getByRole('link', { name: /지난 미팅 대화/ }).waitFor();
        await page.getByRole('link', { name: /점심 먹고 도서관/ }).click();
        await page.getByRole('heading', { name: '점심 채팅방', exact: true }).waitFor();
        await page.getByRole('link', { name: '뒤로 가기', exact: true }).click();
        assert.match(page.url(), /lounge\?tab=chats/);
        await capture('chat-return');
      }
      if (label === 'account') {
        await page.getByRole('radio', { name: '자동', exact: true }).waitFor();
        await page.getByRole('button', { name: '프로필 이미지 바꾸기', exact: true }).click();
        const picker = page.getByRole('dialog', { name: '프로필 이미지 고르기' });
        await picker.waitFor();
        assert.equal(await picker.locator('.lounge-pick__item').count(), 5);
        for (const name of ['상상부기', '한성냥이', '상찌', '꼬꼬', '꾸꾸']) await picker.getByRole('button', { name, exact: true }).waitFor();
        await picker.getByRole('button', { name: '한성냥이', exact: true }).click();
        assert.equal(await picker.getByRole('button', { name: '한성냥이', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.equal(await picker.locator('.lounge-pick__item img').evaluateAll(async (imgs) => {
          await Promise.all(imgs.map((img) => img.decode()));
          return imgs.every((img) => img.naturalWidth === 512);
        }), true);
        await capture('mascot-picker');
        await picker.getByRole('button', { name: '저장', exact: true }).click();
        await picker.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.lounge-acct-who .lounge-avatar__img').getAttribute('src'), '/avatars/nyangi.webp');
        await page.getByRole('link', { name: /친구 요청.*시간표/ }).click();
        await page.getByRole('heading', { name: '친구', exact: true, level: 1 }).waitFor();
        assert.equal(await page.locator('.tabbar__item[href="/account"] .nav-dot').count(), 0);
        await capture('friends');
        await page.getByRole('button', { name: '친구 추가', exact: true }).click();
        await page.getByRole('dialog').waitFor();
        await capture('add-friend-sheet');
        await page.keyboard.press('Escape');
      }
    }
    if (mode === 'linked') {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('.home-learning__urgent').click();
      assert.match(page.url(), /kind=lecture/);
      await page.getByRole('link', { name: /8주차/ }).waitFor();
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('.home-learning__item').filter({ hasText: '반응형 페이지 구현' }).click();
      await page.locator('#eclass-item-assignment-1').waitFor();
      assert.equal(await page.getByRole('radio', { name: '과제', exact: true }).getAttribute('aria-checked'), 'true');
      await capture('assignment-deep-link');
    }
  }
  assert.deepEqual(
    errors,
    [],
    `Runtime errors at ${width}: ${errors.join(", ")}`,
  );
  await context.close();
}
try {
  if (process.argv.includes("--linked-dark")) {
    await review(390, "linked", "dark");
  } else {
    for (const width of [390, 768, 1440]) await review(width);
    await review(375, "empty");
    await review(390, "error");
    await review(390, "reduced");
    await review(390, "normal", "dark");
    await review(390, "linked");
    await review(375, "large");
    await review(844, "normal", "light", 390);
  }
  await fs.writeFile(
    path.join(
      out,
      process.argv.includes("--linked-dark")
        ? "report-linked-dark.json"
        : "report.json",
    ),
    JSON.stringify(reports, null, 2),
  );
  console.log(`Passed ${reports.length} screen checks. Screenshots: ${out}`);
} finally {
  await browser.close();
}
