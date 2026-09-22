-- 학교 셔틀 노선도 (담당: 한승원)
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하면 된다.
--
-- 읽기: 누구나 (로그인 없이 노선도를 볼 수 있어야 함)
-- 쓰기: 서버(service_role)만. 관리자 권한 검사는 Next.js API 쪽에서 한다.

create table if not exists bus_routes (
  id          text primary key,
  name        text not null,
  color       text not null default '#1f4fd8',
  sort_order  int  not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists bus_stops (
  id          text primary key,
  route_id    text not null references bus_routes(id) on delete cascade,
  name        text not null,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  sort_order  int  not null,
  -- 출발지에서 이 정류장까지 걸리는 분
  offset_min  int  not null default 0 check (offset_min >= 0)
);
create index if not exists bus_stops_route_idx on bus_stops(route_id, sort_order);

create table if not exists bus_timetables (
  route_id    text not null references bus_routes(id) on delete cascade,
  day_type    text not null check (day_type in ('weekday', 'weekend', 'vacation')),
  -- 출발지 출발 시각 "HH:mm" 목록
  departures  text[] not null default '{}',
  primary key (route_id, day_type)
);

create table if not exists bus_vacations (
  id          text primary key,
  label       text not null,
  start_date  date not null,
  end_date    date not null,
  check (start_date <= end_date)
);

create table if not exists bus_holidays (
  day date primary key
);

-- 실시간 위치: 기기(기사 폰 / GPS 트래커)당 최신 1행만 upsert
create table if not exists bus_positions (
  device_id   text primary key,
  route_id    text not null references bus_routes(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  heading     double precision,
  speed       double precision,
  updated_at  timestamptz not null default now()
);

alter table bus_routes     enable row level security;
alter table bus_stops      enable row level security;
alter table bus_timetables enable row level security;
alter table bus_vacations  enable row level security;
alter table bus_holidays   enable row level security;
alter table bus_positions  enable row level security;

create policy "bus_routes public read"     on bus_routes     for select using (true);
create policy "bus_stops public read"      on bus_stops      for select using (true);
create policy "bus_timetables public read" on bus_timetables for select using (true);
create policy "bus_vacations public read"  on bus_vacations  for select using (true);
create policy "bus_holidays public read"   on bus_holidays   for select using (true);
create policy "bus_positions public read"  on bus_positions  for select using (true);

-- 지도에서 버스 위치를 실시간 구독할 수 있게
alter publication supabase_realtime add table bus_positions;

-- 노선 하나(정류장 + 시간표 포함)를 통째로 저장. 여러 테이블을 한 트랜잭션으로 바꾸려고 함수로 뺐다.
create or replace function bus_save_route(route jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  rid text := route->>'id';
begin
  insert into bus_routes (id, name, color, sort_order, updated_at)
  values (rid, route->>'name', route->>'color', (route->>'order')::int, now())
  on conflict (id) do update
    set name = excluded.name, color = excluded.color,
        sort_order = excluded.sort_order, updated_at = now();

  delete from bus_stops where route_id = rid;
  insert into bus_stops (id, route_id, name, lat, lng, sort_order, offset_min)
  select s->>'id', rid, s->>'name', (s->>'lat')::float8, (s->>'lng')::float8,
         (s->>'order')::int, (s->>'offsetMin')::int
  from jsonb_array_elements(route->'stops') s;

  delete from bus_timetables where route_id = rid;
  insert into bus_timetables (route_id, day_type, departures)
  select rid, t.key, array(select jsonb_array_elements_text(t.value))
  from jsonb_each(route->'timetables') t;
end $$;

revoke execute on function bus_save_route(jsonb) from public, anon, authenticated;
