/**
 * src/features/bus/seed.json 을 Supabase에 넣는다. 마이그레이션(0001_bus.sql) 실행 후 한 번만.
 *   npm run bus:seed
 * (.env.local 의 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 사용)
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('.env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');

const db = createClient(url, key, { auth: { persistSession: false } });
const seed = JSON.parse(readFileSync(new URL('../src/features/bus/seed.json', import.meta.url), 'utf8'));

for (const r of seed.routes) {
  const route = { ...r, stops: r.stops.map(({ _todo, ...s }) => s) };
  const { error } = await db.rpc('bus_save_route', { route });
  if (error) throw new Error(`${r.id}: ${error.message}`);
  console.log(`✓ 노선 ${r.name}`);
}

const vac = await db
  .from('bus_vacations')
  .upsert(seed.vacations.map((v) => ({ id: v.id, label: v.label, start_date: v.start, end_date: v.end })));
if (vac.error) throw new Error(vac.error.message);
const hol = await db.from('bus_holidays').upsert(seed.holidays.map((day) => ({ day })));
if (hol.error) throw new Error(hol.error.message);
console.log(`✓ 방학 ${seed.vacations.length}개, 공휴일 ${seed.holidays.length}개`);
