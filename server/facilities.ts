import { Router } from 'express';
import { all } from './db.js';
import { requireAuth, wrap } from './auth.js';
import { parseDateStrict } from './dates.js';
import { getCampusBusy, CAMPUS_SYSTEMS } from './campusSchedule.js';
import { OPEN_MIN, RESERVE_CLOSE_MIN, STEP_MIN } from './constants.js';

export const facilitiesRouter = Router();

facilitiesRouter.use(requireAuth);

export interface FacilityRow {
  id: number;
  systemKey: string | null;
  campusName: string | null;
  name: string;
  building: string;
  minCapacity: number | null;
  capacity: number | null;
  description: string | null;
}

export const FACILITY_SELECT = `
  SELECT id, system_key AS "systemKey", campus_name AS "campusName", name, building,
         min_capacity AS "minCapacity", capacity, description
  FROM facilities
`;

const systemById = new Map(CAMPUS_SYSTEMS.map((s) => [s.key, s]));

function decorate(f: FacilityRow) {
  const system = f.systemKey ? systemById.get(f.systemKey) : undefined;
  return {
    ...f,
    systemLabel: system?.label ?? null,
    reserveUrl: system?.reserveUrl ?? null,
    contact: system?.contact ?? null,
  };
}

facilitiesRouter.get(
  '/',
  wrap(async (req, res) => {
    const { date, start, end } = req.query;
    const facilities = await all<FacilityRow>(`${FACILITY_SELECT} ORDER BY building, name`);

    // 참여 인원이 주어지면 그 인원이 쓸 수 있는 시설만 남긴다.
    const people = Number(req.query.people);
    const fits = (f: FacilityRow) =>
      !Number.isInteger(people) ||
      people <= 0 ||
      ((f.minCapacity === null || people >= f.minCapacity) &&
        (f.capacity === null || people <= f.capacity));
    const suitable = facilities.filter(fits);
    const hiddenByCapacity = facilities.length - suitable.length;

    if (date === undefined && start === undefined && end === undefined) {
      res.json({
        facilities: suitable.map(decorate),
        hiddenByCapacity,
        campusStatus: 'skipped',
      });
      return;
    }

    const startMin = Number(start);
    const endMin = Number(end);
    const parsed = typeof date === 'string' ? parseDateStrict(date) : null;
    if (
      typeof date !== 'string' ||
      !parsed ||
      !Number.isInteger(startMin) ||
      !Number.isInteger(endMin) ||
      startMin % STEP_MIN !== 0 ||
      endMin % STEP_MIN !== 0 ||
      startMin < OPEN_MIN ||
      endMin > RESERVE_CLOSE_MIN ||
      startMin >= endMin
    ) {
      res.status(400).json({ error: '조회 조건이 올바르지 않습니다.' });
      return;
    }

    // 우리 앱 안에서 잡아 둔 계획
    const plannedRows = await all<{ facilityId: number }>(
      `SELECT DISTINCT facility_id AS "facilityId" FROM reservations
       WHERE date = ? AND NOT (end_min <= ? OR start_min >= ?)`,
      [date, startMin, endMin],
    );
    const plannedHere = new Set(plannedRows.map((r) => r.facilityId));

    // 학교 시스템의 실제 예약·휴무 현황
    const campus = await getCampusBusy(parsed.getFullYear(), parsed.getMonth() + 1);
    const campusBusy = new Map<string, 'reserved' | 'closed'>();
    if (campus) {
      for (const b of campus) {
        if (b.date !== date) continue;
        if (b.endMin <= startMin || b.startMin >= endMin) continue;
        const key = `${b.systemKey}|${b.campusName}`;
        // 휴무(closed)가 예약보다 강한 상태이므로 덮어쓴다.
        if (b.reason === 'closed' || !campusBusy.has(key)) campusBusy.set(key, b.reason);
      }
    }

    res.json({
      campusStatus: campus ? 'ok' : 'unavailable',
      hiddenByCapacity,
      facilities: suitable.map((f) => {
        const campusState =
          f.systemKey && f.campusName
            ? campusBusy.get(`${f.systemKey}|${f.campusName}`)
            : undefined;
        return {
          ...decorate(f),
          plannedHere: plannedHere.has(f.id),
          campusState: campusState ?? null,
          available: !plannedHere.has(f.id) && campusState === undefined,
        };
      }),
    });
  }),
);
