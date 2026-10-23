// 학교 예약 시스템의 공간별 설정(신청 단위·시작 시각·대상)을 로그인 없이 읽어 우리 시설 목록과 비교해 보여 준다.
// 사용: npx tsx scripts/check-facility-rules.ts
import { SchoolHttp } from '../server/school/http.js';
import { ResveClient } from '../server/school/resve.js';
import { systemForFacility, findSpace } from '../server/school/facilityMap.js';
import { FACILITY_SEED } from '../server/db.js';

const client = new ResveClient(new SchoolHttp('resve'));
const spacesBySystem = new Map<string, Awaited<ReturnType<ResveClient['spaces']>>>();

for (const f of FACILITY_SEED) {
  const system = systemForFacility(f.systemKey);
  if (!system) {
    console.log(`${f.name} | 연결된 학교 시스템 없음`);
    continue;
  }
  try {
    if (!spacesBySystem.has(system.key)) spacesBySystem.set(system.key, await client.spaces(system.key));
    const space = findSpace(spacesBySystem.get(system.key)!, f.campusName);
    if (!space) {
      console.log(`${f.name} | 학교 공간 목록에서 못 찾음`);
      continue;
    }
    const setup = await client.setup(system.key, space.id);
    const info = await client.info(system.key, space.id).catch(() => null);
    console.log(
      JSON.stringify({
        name: f.name,
        ourMin: f.minCapacity,
        ourMax: f.maxCapacity,
        termMin: setup?.termMin ?? null,
        slots: setup?.slots ?? null,
        days: setup?.posblDay ?? null,
        leadHours: setup?.posblTm ?? null,
        info,
      }),
    );
  } catch (err) {
    console.log(`${f.name} | 읽기 실패: ${(err as Error).message}`);
  }
}
