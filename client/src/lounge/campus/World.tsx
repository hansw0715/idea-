/**
 * 아이소메트릭 캠퍼스 모형. 사람은 그리지 않고 건물·탁자·의자만 한 화면에 다 들어오게 맞춘다.
 * 캠퍼스에서는 건물을, 라운지 안에서는 탁자와 의자를 누른다. 앉은 자리는 채운 의자로 보인다.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { campusBounds, campusGround, campusOverlay, campusProps, type PropItem } from './CampusArt';
import { depthSort, ISO_C, ISO_S, isoBounds } from './iso';
import { ROOM_WALL_H, roomGround, roomProps, roomWalls } from './RoomArt';
import type { SeatPos } from './rooms';
import type { Scene } from './scene';

interface Props {
  scene: Scene;
  /** 채워 보일 의자 (`탁자id:번호`) */
  taken: Set<string>;
  /** 건물별 모임에 앉아 있는 사람 수 */
  counts: ReadonlyMap<string, number>;
  onBuilding: (id: string) => void;
  onTable: (tableId: string) => void;
}

const PAD_TOP = 72;
const PAD = 16;
/** 바닥(평면 좌표)을 아이소메트릭으로 눕히는 행렬 */
const ISO_MATRIX = `matrix(${ISO_C} ${ISO_S} ${-ISO_C} ${ISO_S} 0 0)`;

export function World({ scene, taken, counts, onBuilding, onTable }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 640 });

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const room = scene.room;
  const onSeat = useCallback((st: SeatPos) => onTable(st.tableId), [onTable]);
  const ground = useMemo(() => (room ? roomGround(room) : campusGround()), [room]);
  const backdrop = useMemo(() => (room ? roomWalls(room) : null), [room]);
  const sorted = useMemo<PropItem[]>(
    () => depthSort(room ? roomProps(room, taken, onSeat, onTable) : campusProps(onBuilding, counts)),
    [room, taken, counts, onSeat, onTable, onBuilding],
  );

  // 장면 전체(벽·건물 높이 포함)가 화면에 들어오도록 맞춘다
  const b = room ? isoBounds(scene.width, scene.height) : campusBounds();
  const minY = room ? b.minY - ROOM_WALL_H : b.minY;
  const viewW = Math.max(100, size.w - PAD * 2);
  const viewH = Math.max(100, size.h - PAD_TOP - PAD * 2);
  const s = Math.min(viewW / (b.maxX - b.minX), viewH / (b.maxY - minY));
  const ox = PAD + (viewW - (b.maxX - b.minX) * s) / 2 - b.minX * s;
  const oy = PAD_TOP + PAD + (viewH - (b.maxY - minY) * s) / 2 - minY * s;
  // 이름표·사람 수는 지도를 줄여도 읽히는 크기로 (화면에서 원래 크기의 0.8배 이상)
  const ui = Math.min(3.2, Math.max(1, 0.8 / s));
  const overlay = useMemo(() => (room ? null : campusOverlay(counts, ui)), [room, counts, ui]);

  return (
    <div ref={wrapRef} className={`mv-world${room ? ' mv-world--room' : ''}`}>
      <svg width={size.w} height={size.h} className="mv-svg" role="group" aria-label={`${scene.name} 지도`}>
        <g transform={`translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${s})`}>
          {backdrop}
          <g transform={ISO_MATRIX}>{ground}</g>
          {sorted.map((it) => (
            <Fragment key={it.key}>{it.node}</Fragment>
          ))}
          {overlay}
        </g>
      </svg>
    </div>
  );
}
