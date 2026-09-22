/**
 * 가짜 버스를 노선 위로 달리게 한다 — 실시간 위치 시연/테스트용. (담당: 한승원)
 *
 *   npm run bus:simulate                       # 첫 번째 노선, localhost:3000
 *   npm run bus:simulate -- sungshin-station   # 노선 지정
 *   BASE_URL=https://배포주소 BUS_DEVICE_TOKEN=... npm run bus:simulate
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const TOKEN = process.env.BUS_DEVICE_TOKEN ?? '';
const INTERVAL_MS = 3000;
/** 정류장 사이를 몇 번에 나눠 움직일지 */
const STEPS_PER_LEG = 6;

const snapshot = await fetch(`${BASE}/api/bus`).then((r) => r.json());
const route = snapshot.network.routes.find((r) => r.id === process.argv[2]) ?? snapshot.network.routes[0];
if (!route) throw new Error('노선이 없습니다.');

const points = [];
const stops = route.stops;
for (let i = 0; i < stops.length - 1; i++) {
  for (let k = 0; k < STEPS_PER_LEG; k++) {
    const t = k / STEPS_PER_LEG;
    points.push({ lat: stops[i].lat + (stops[i + 1].lat - stops[i].lat) * t, lng: stops[i].lng + (stops[i + 1].lng - stops[i].lng) * t });
  }
}
points.push({ lat: stops.at(-1).lat, lng: stops.at(-1).lng });
// 왕복
const loop = [...points, ...points.slice(1, -1).reverse()];

console.log(`🚌 ${route.name} 시뮬레이션 시작 (${BASE}) — Ctrl+C로 종료`);
let i = 0;
setInterval(async () => {
  const p = loop[i++ % loop.length];
  const res = await fetch(`${BASE}/api/bus/positions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: `sim-${route.id}`, routeId: route.id, lat: p.lat, lng: p.lng }),
  });
  console.log(res.ok ? `  → ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : `  ✗ ${res.status} ${await res.text()}`);
}, INTERVAL_MS);
