/** 캠퍼스와 라운지를 같은 걷기 엔진에 넣기 위한 장면 정의 */
import { AREAS, BUILDINGS, CAMPUS_BLOCKED, CAMPUS_H, CAMPUS_SPAWN, CAMPUS_W, GATES, doorOf } from './campus';
import { ROOM_DOOR, ROOM_H, ROOM_W, ROOM_WALL, seatsOf, type Room, type SeatPos } from './rooms';
import type { Pt, Rect } from './geometry';

export type InteractKind = 'door' | 'info' | 'seat' | 'exit';

export interface Interactable extends Pt {
  id: string;
  kind: InteractKind;
  /** 이 거리 안에 들어오면 행동 버튼이 뜬다 */
  r: number;
  label: string;
  title?: string;
  text?: string;
  buildingId?: string;
  seat?: SeatPos;
}

export interface Scene {
  id: string;
  kind: 'campus' | 'room';
  name: string;
  width: number;
  height: number;
  blocked: Rect[];
  spawn: Pt;
  interactables: Interactable[];
  seats: SeatPos[];
  room?: Room;
}

export function campusScene(): Scene {
  const interactables: Interactable[] = [];
  for (const b of BUILDINGS) {
    const d = doorOf(b);
    interactables.push(
      b.rooms
        ? { id: `door-${b.id}`, kind: 'door', ...d, r: 44, label: `${b.name} 들어가기`, buildingId: b.id }
        : { id: `info-${b.id}`, kind: 'info', ...d, r: 40, label: `${b.name} 살펴보기`, title: b.name, text: b.info, buildingId: b.id },
    );
  }
  for (const a of AREAS) {
    interactables.push({ id: `area-${a.id}`, kind: 'info', x: a.x + a.w / 2, y: a.y + a.h / 2, r: Math.min(a.w, a.h) / 2, label: `${a.name} 살펴보기`, title: a.name, text: a.info });
  }
  for (const g of GATES) {
    interactables.push({ id: `gate-${g.id}`, kind: 'info', x: g.x, y: g.y, r: 46, label: `${g.name} 살펴보기`, title: g.name, text: g.info });
  }
  return {
    id: 'campus', kind: 'campus', name: '한성대학교 캠퍼스', width: CAMPUS_W, height: CAMPUS_H,
    blocked: CAMPUS_BLOCKED, spawn: CAMPUS_SPAWN, interactables, seats: [],
  };
}

export function roomScene(room: Room): Scene {
  const seats = room.tables.flatMap(seatsOf);
  const blocked: Rect[] = [{ x: 0, y: 0, w: ROOM_W, h: ROOM_WALL }, ...room.tables];
  if (room.counter) blocked.push(room.counter);
  const interactables: Interactable[] = seats.map((s) => {
    const table = room.tables.find((tb) => tb.id === s.tableId)!;
    return { id: `seat-${s.tableId}-${s.idx}`, kind: 'seat', x: s.x, y: s.y, r: 22, label: `'${table.title}' 자리에 앉기`, seat: s };
  });
  interactables.push({ id: 'exit', kind: 'exit', ...ROOM_DOOR, r: 34, label: '캠퍼스로 나가기' });
  return {
    id: room.id, kind: 'room', name: room.name, width: ROOM_W, height: ROOM_H,
    blocked, spawn: { x: ROOM_DOOR.x, y: ROOM_DOOR.y - 44 }, interactables, seats, room,
  };
}
