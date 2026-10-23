import { Router } from 'express';
import { all, get } from './db.js';
import { requireAuth, wrap } from './auth.js';
import { parseDateStrict } from './dates.js';
import { getCampusBusy, CAMPUS_SYSTEMS } from './campusSchedule.js';
import { BOOKING_STEP_MIN, OPEN_MIN, RESERVE_CLOSE_MIN, STEP_MIN } from './constants.js';
import { addDaysStr, todayStr } from './dates.js';

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
  /** 학교 규정: 한 번 최대 이용 시간(분) · 마감 시각(분) · 신청 리드타임(시간) · 며칠 전부터 */
  maxMinutes: number | null;
  closeMin: number | null;
  leadHours: number | null;
  aheadDays: number | null;
}

/** 이 시설의 학교 규정으로 [date, startMin~endMin] 을 신청할 수 없으면 그 이유. 되면 null */
export function facilityRuleReason(f: FacilityRow, date: string, startMin: number, endMin: number, now = new Date()): string | null {
  if (startMin % BOOKING_STEP_MIN !== 0 || endMin % BOOKING_STEP_MIN !== 0) return '1시간 단위(정각)로만 신청할 수 있어요';
  const maxMin = f.maxMinutes ?? 180;
  if (endMin - startMin > maxMin) return `한 번에 최대 ${maxMin / 60}시간까지예요`;
  const close = f.closeMin ?? 1260;
  if (endMin > close) return `${String(Math.floor(close / 60)).padStart(2, '0')}:00까지만 이용할 수 있어요`;
  const ahead = f.aheadDays ?? 7;
  if (date > addDaysStr(todayStr(), ahead)) return `이용일 ${ahead}일 전부터 신청할 수 있어요`;
  const lead = f.leadHours ?? 0;
  if (lead > 0) {
    const [y, m, d] = date.split('-').map(Number);
    // 한국 시간 시작 시각 → UTC
    const startAt = Date.UTC(y, m - 1, d, 0, startMin) - 9 * 3600_000;
    if (startAt - now.getTime() < lead * 3600_000) return `이용 ${lead >= 24 && lead % 24 === 0 ? `${lead / 24}일` : `${lead}시간`} 전까지 신청해야 해요`;
  }
  return null;
}

export const FACILITY_SELECT = `
  SELECT id, system_key AS "systemKey", campus_name AS "campusName", name, building,
         min_capacity AS "minCapacity", capacity, description,
         max_minutes AS "maxMinutes", close_min AS "closeMin", lead_hours AS "leadHours", ahead_days AS "aheadDays"
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
        const ruleReason = facilityRuleReason(f, date, startMin, endMin);
        return {
          ...decorate(f),
          plannedHere: plannedHere.has(f.id),
          campusState: campusState ?? null,
          ruleReason,
          available: !plannedHere.has(f.id) && campusState === undefined && ruleReason === null,
        };
      }),
    });
  }),
);
