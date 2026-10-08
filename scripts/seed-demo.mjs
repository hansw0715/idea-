// 화면 확인용 시연 데이터를 넣는다. (개발 서버가 ADMIN_PASSWORD 로 떠 있어야 하며, 여러 번 실행해도 안전)
//   admin1~3@hansung.ac.kr : 시간표 + 회의 "캡스톤 디자인 팀" (+ 가능하면 시설 예약 1건)
// 사용: node scripts/seed-demo.mjs
const API = process.env.API_URL ?? 'http://localhost:3101/api';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Test1234!';

class Client {
  constructor(email) {
    this.email = email;
    this.cookie = '';
  }
  async call(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  async login() {
    const r = await this.call('POST', '/auth/login', { email: this.email, password: PASSWORD });
    if (r.status !== 200) throw new Error(`로그인 실패 ${this.email}: ${r.status} ${JSON.stringify(r.data)}`);
  }
}

const H = (h, m = 0) => h * 60 + m;
const PLAN = {
  admin1: [
    [0, H(10), H(12), '자료구조', '공학관 203'],
    [2, H(10), H(12), '자료구조', '공학관 203'],
    [1, H(13), H(15), '확률과통계', '상상관 101'],
    [4, H(9), H(10, 30), '근로', '학술정보관'],
  ],
  admin2: [
    [0, H(13), H(15), '알고리즘', '공학관 305'],
    [2, H(13), H(16), '운영체제', '공학관 401'],
    [3, H(10), H(12), '캡스톤 디자인', '상상관 202'],
  ],
  admin3: [
    [1, H(10), H(12), '데이터베이스', '공학관 204'],
    [3, H(13), H(15), '인공지능', '공학관 502'],
    [4, H(11), H(13), '아르바이트', ''],
  ],
};

const clients = {};
for (const who of Object.keys(PLAN)) {
  clients[who] = new Client(`${who}@hansung.ac.kr`);
  await clients[who].login();
}

// 1) 시간표 (이미 있으면 겹침 오류로 건너뛴다)
for (const [who, rows] of Object.entries(PLAN)) {
  let added = 0;
  for (const [day, startMin, endMin, title, place] of rows) {
    const r = await clients[who].call('POST', '/timetable', { day, startMin, endMin, title, place });
    if (r.status === 201 || r.status === 200) added++;
  }
  console.log(`${who}: 시간표 ${added}/${rows.length}건 추가`);
}

// 2) 회의 만들기 + 참가
const owner = clients.admin1;
const list = (await owner.call('GET', '/meetings')).data ?? [];
let meeting = list.find((m) => m.name === '캡스톤 디자인 팀');
if (!meeting) {
  const r = await owner.call('POST', '/meetings', { name: '캡스톤 디자인 팀' });
  meeting = r.data;
  console.log('회의 생성:', meeting?.name, meeting?.code);
}
for (const who of ['admin2', 'admin3']) {
  const r = await clients[who].call('POST', '/meetings/join', { code: meeting.code });
  console.log(`${who}: 회의 참가`, r.status, r.data?.alreadyMember ? '(이미 참여 중)' : '');
}

// 3) 공통 여유 시간에 시설 예약 한 건 (학교 현황 조회가 막혀도 앱 안 계획으로 남는다)
const existing = (await owner.call('GET', `/reservations/meeting/${meeting.id}`)).data ?? [];
if (existing.length === 0) {
  const slots = (await owner.call('GET', `/meetings/${meeting.id}/free-slots?duration=60`)).data ?? [];
  const today = new Date();
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  outer: for (let i = 1; i <= 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const day = (d.getDay() + 6) % 7;
    for (const s of slots.filter((x) => x.day === day && x.end - x.start >= 60)) {
      const date = ymd(d);
      const f = await owner.call(
        'GET',
        `/facilities?date=${date}&start=${s.start}&end=${s.start + 60}&people=3`,
      );
      const pick = f.data?.facilities?.find((x) => x.available !== false);
      if (!pick) continue;
      const r = await owner.call('POST', '/reservations', {
        meetingId: meeting.id,
        facilityId: pick.id,
        date,
        startMin: s.start,
        endMin: s.start + 60,
      });
      console.log('예약:', r.status, pick.name, date, s.start, r.data?.error ?? '');
      if (r.status < 300) break outer;
    }
  }
}
console.log('완료. 로그인: admin1~3@hansung.ac.kr / 비밀번호는 ADMIN_PASSWORD (기본 Test1234!)');
