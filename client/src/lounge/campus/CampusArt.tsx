/**
 * 아이소메트릭 캠퍼스. 흰색과 파란색 단계만 쓴다.
 *  - 바닥(땅·광장·길)은 평면 좌표 그대로 그리고 ISO_MATRIX 로 한 번에 눕힌다.
 *  - 건물·나무·성곽은 세운 상자라 아바타와 함께 앞뒤 정렬한다 (PropItem).
 *  - 이름표는 가려지지 않게 맨 위 겹(overlay)에 그린다.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import {
  AREAS, BUILDINGS, CAMPUS_H, CAMPUS_W, FORESTS, GATES, GROUND_R, PATHS, PAVILION, TURTLE, fromMap,
  type Building,
} from './campus';
import { seeded, type Pt, type Rect } from './geometry';
import { iso, isoBox, pts, type Sortable } from './iso';

export interface PropItem extends Sortable {
  node: ReactNode;
}

export const sortable = (key: string, foot: Rect, pad = 0): Sortable => ({
  key,
  foot,
  sx0: iso(foot.x, foot.y + foot.h).x - pad,
  sx1: iso(foot.x + foot.w, foot.y).x + pad,
});

const pathD = (list: Pt[]) => list.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

/** 건물 높이: 앞벽 값(층수 느낌)을 세워서 키운다 */
export const heightOf = (b: Building) => Math.round(26 + b.wall * 1.5);

/** 건물 발자국 (앞벽 자리까지 포함 — 충돌 영역과 같다) */
const footOf = (b: Building): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h + b.wall });

/* ── 나무 배치 (시드 고정) ─────────────────────────────────── */
const rnd = seeded(1946);
const TREES: (Pt & { s: number })[] = [];

/** 둥근 모서리 땅 안쪽인지 (가장자리에서 inset 만큼 들어온 곳) */
function onGround(p: Pt, inset: number) {
  const r = GROUND_R - inset;
  if (p.x < inset || p.y < inset || p.x > CAMPUS_W - inset || p.y > CAMPUS_H - inset) return false;
  const cx = Math.min(Math.max(p.x, GROUND_R), CAMPUS_W - GROUND_R);
  const cy = Math.min(Math.max(p.y, GROUND_R), CAMPUS_H - GROUND_R);
  return Math.hypot(p.x - cx, p.y - cy) <= r;
}
const inside = (p: Pt, r: Rect, m: number) => p.x > r.x - m && p.x < r.x + r.w + m && p.y > r.y - m && p.y < r.y + r.h + m;
const treeFree = (p: Pt) =>
  onGround(p, 24) &&
  !BUILDINGS.some((b) => inside(p, footOf(b), 14)) &&
  !AREAS.some((a) => a.kind !== 'forest' && inside(p, a, 8)) &&
  !GATES.some((g) => Math.hypot(p.x - g.x, p.y - g.y) < 40) &&
  Math.hypot(p.x - PAVILION.x, p.y - PAVILION.y) > 40 &&
  Math.hypot(p.x - TURTLE.x, p.y - TURTLE.y) > 36;
for (const f of FORESTS) {
  for (let i = 0; i < f.n; i++) {
    const p = fromMap(f.u0 + rnd() * (f.u1 - f.u0), f.v0 + rnd() * (f.v1 - f.v0));
    const s = 11 * (0.75 + rnd() * 0.5);
    if (treeFree(p)) TREES.push({ ...p, s });
  }
}

const PARASOLS: Pt[] = [fromMap(684, 486), fromMap(714, 504), fromMap(700, 468)];

/* ── 바닥 (평면 좌표, 바깥에서 ISO_MATRIX 로 눕힌다) ─────────── */
export function campusGround(): ReactNode {
  return (
    <g>
      <rect x={-30} y={-30} width={CAMPUS_W + 60} height={CAMPUS_H + 60} rx={GROUND_R + 30} className="i-base" />
      <rect width={CAMPUS_W} height={CAMPUS_H} rx={GROUND_R} className="i-ground" />
      <clipPath id="mv-ground-clip">
        <rect width={CAMPUS_W} height={CAMPUS_H} rx={GROUND_R} />
      </clipPath>
      <g clipPath="url(#mv-ground-clip)">
        {/* 바닥 격자 — 메타버스 바닥 느낌 */}
        {Array.from({ length: Math.floor(CAMPUS_W / 80) + 1 }).map((_, i) => (
          <line key={`v${i}`} x1={i * 80} x2={i * 80} y1={0} y2={CAMPUS_H} className="i-grid" />
        ))}
        {Array.from({ length: Math.floor(CAMPUS_H / 80) + 1 }).map((_, i) => (
          <line key={`h${i}`} y1={i * 80} y2={i * 80} x1={0} x2={CAMPUS_W} className="i-grid" />
        ))}
        {AREAS.map((a) => (
          <g key={a.id}>
            <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={a.kind === 'forest' ? 40 : 10} className={`i-area i-area--${a.kind}`} />
            {(a.kind === 'plaza' || a.kind === 'sunken') &&
              Array.from({ length: Math.floor(a.w / 20) }).map((_, i) => (
                <line key={i} x1={a.x + 10 + i * 20} x2={a.x + 10 + i * 20} y1={a.y + 6} y2={a.y + a.h - 6} className="i-tile" />
              ))}
            {a.kind === 'field' && (
              <g className="i-field-line">
                <rect x={a.x + 10} y={a.y + 10} width={a.w - 20} height={a.h - 20} />
                <line x1={a.x + a.w / 2} x2={a.x + a.w / 2} y1={a.y + 10} y2={a.y + a.h - 10} />
                <circle cx={a.x + a.w / 2} cy={a.y + a.h / 2} r={14} />
              </g>
            )}
          </g>
        ))}
        {PATHS.map((p, i) => (
          <path key={`e${i}`} d={pathD(p)} className="i-path-edge" />
        ))}
        {PATHS.map((p, i) => (
          <path key={`p${i}`} d={pathD(p)} className="i-path" />
        ))}
        {/* 의화정 바닥 */}
        <circle cx={PAVILION.x} cy={PAVILION.y} r={26} className="i-area i-area--plaza" />
      </g>
    </g>
  );
}

/* ── 세운 물체 ─────────────────────────────────────────────── */
export function campusProps(onBuilding: (id: string) => void): PropItem[] {
  const out: PropItem[] = [];
  for (const b of BUILDINGS) out.push({ ...sortable(`b-${b.id}`, footOf(b)), node: <BuildingBox key={b.id} b={b} onBuilding={onBuilding} /> });
  TREES.forEach((t, i) => out.push({ ...sortable(`t-${i}`, { x: t.x - 4, y: t.y - 4, w: 8, h: 8 }, t.s * 1.3), node: <Tree key={i} {...t} /> }));
  PARASOLS.forEach((p, i) => out.push({ ...sortable(`p-${i}`, { x: p.x - 4, y: p.y - 4, w: 8, h: 8 }, 26), node: <Parasol key={i} {...p} /> }));
  out.push({ ...sortable('turtle', { x: TURTLE.x - 20, y: TURTLE.y - 13, w: 40, h: 26 }), node: <Turtle key="turtle" /> });
  out.push({ ...sortable('pavilion', { x: PAVILION.x - 18, y: PAVILION.y - 18, w: 36, h: 36 }, 10), node: <Pavilion key="pavilion" /> });
  for (const g of GATES) out.push({ ...sortable(`g-${g.id}`, { x: g.x - 30, y: g.y - 6, w: 60, h: 12 }), node: <GatePosts key={g.id} p={g} /> });
  return out;
}

/* ── 이름표 겹 ─────────────────────────────────────────────── */
export function campusOverlay(): ReactNode {
  return (
    <g className="i-overlay">
      {BUILDINGS.map((b) => {
        const f = footOf(b);
        const top = iso(f.x + f.w / 2, f.y + f.h / 2, heightOf(b));
        const w = b.name.length * 15 + 22;
        return (
          <g key={b.id} transform={`translate(${top.x.toFixed(1)} ${top.y.toFixed(1)})`}>
            {b.rooms && (
              <g className="i-pin" transform="translate(0 -46)">
                <line y1={14} y2={34} />
                <rect x={-34} y={-13} width={68} height={26} rx={13} />
                <text y={5} textAnchor="middle">라운지 {b.rooms.length}</text>
              </g>
            )}
            <rect x={-w / 2} y={-12} width={w} height={24} rx={6} className="i-label" />
            <text y={5} textAnchor="middle" className="i-label-text">{b.name}</text>
          </g>
        );
      })}
      {AREAS.map((a) => {
        const p = iso(a.x + a.w / 2, a.y + a.h / 2);
        return (
          <text key={a.id} x={p.x} y={p.y + 5} textAnchor="middle" className="i-area-name">
            {a.name}
          </text>
        );
      })}
      {GATES.map((g) => {
        const p = iso(g.x, g.y, 30);
        return (
          <g key={g.id} transform={`translate(${p.x} ${p.y})`} className="i-gate">
            <rect x={-24} y={-13} width={48} height={26} rx={13} />
            <text y={5} textAnchor="middle">{g.name}</text>
          </g>
        );
      })}
      <text {...xy(iso(PAVILION.x, PAVILION.y, 50))} textAnchor="middle" className="i-area-name">의화정</text>
    </g>
  );
}

const xy = (p: Pt) => ({ x: p.x, y: p.y });

/* ── 조각들 ────────────────────────────────────────────────── */
function Faces({ r, h, z = 0, cls }: { r: Rect; h: number; z?: number; cls: string }) {
  const f = isoBox(r, h, z);
  return (
    <>
      <polygon points={pts(f.left)} className={`${cls}-l`} />
      <polygon points={pts(f.right)} className={`${cls}-r`} />
      <polygon points={pts(f.top)} className={`${cls}-t`} />
    </>
  );
}

function BuildingBox({ b, onBuilding }: { b: Building; onBuilding: (id: string) => void }) {
  const r = footOf(b);
  const h = heightOf(b);
  const rows = Math.max(1, Math.floor((h - 22) / 16));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onBuilding(b.id);
    }
  };
  const roofed = b.tone === 'heritage' || b.tone === 'brick';
  const door = [iso(r.x + r.w / 2 - 10, r.y + r.h), iso(r.x + r.w / 2 + 10, r.y + r.h), iso(r.x + r.w / 2 + 10, r.y + r.h, 18), iso(r.x + r.w / 2 - 10, r.y + r.h, 18)];
  return (
    <g
      className={`i-bld i-bld--${b.tone}${b.rooms ? ' is-lounge' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${b.name}${b.rooms ? ` · 라운지 ${b.rooms.length}곳` : ''} — ${b.sub}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onBuilding(b.id)}
      onKeyDown={onKey}
    >
      <Faces r={r} h={roofed ? h - 10 : h} cls="i-bf" />
      {/* 창문 띠: 왼쪽 앞면(x 방향) · 오른쪽 앞면(y 방향) */}
      {Array.from({ length: rows }).map((_, i) => {
        const z = 14 + i * 16;
        if (z > h - 14) return null;
        const a = iso(r.x + 8, r.y + r.h, z);
        const c = iso(r.x + r.w - 8, r.y + r.h, z);
        const d = iso(r.x + r.w, r.y + r.h - 8, z);
        const e = iso(r.x + r.w, r.y + 8, z);
        return (
          <g key={i} className="i-win">
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} />
            <line x1={d.x} y1={d.y} x2={e.x} y2={e.y} />
          </g>
        );
      })}
      {b.tone === 'glass' &&
        [0.25, 0.5, 0.75].map((f) => {
          const p = iso(r.x + r.w * f, r.y + r.h);
          const q = iso(r.x + r.w * f, r.y + r.h, h);
          return <line key={f} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="i-mullion" />;
        })}
      {roofed && <Roof r={r} z={h - 10} />}
      {b.tone === 'landmark' && <polygon points={pts(isoBox({ x: r.x + 18, y: r.y + 18, w: r.w - 36, h: r.h - 36 }, 0, h).top)} className="i-inset" />}
      {b.tone !== 'landmark' && !roofed && <polygon points={pts(isoBox({ x: r.x + 10, y: r.y + 10, w: r.w - 20, h: r.h - 20 }, 0, h).top)} className="i-roofline" />}
      <polygon points={pts(door)} className="i-door" />
    </g>
  );
}

/** 기와 지붕: 가운데 용마루로 모이는 낮은 지붕 */
function Roof({ r, z }: { r: Rect; z: number }) {
  const ridgeY = r.y + r.h / 2;
  const a = iso(r.x - 4, r.y + r.h + 4, z);
  const b = iso(r.x + r.w + 4, r.y + r.h + 4, z);
  const c = iso(r.x + r.w - 10, ridgeY, z + 18);
  const d = iso(r.x + 10, ridgeY, z + 18);
  const e = iso(r.x + r.w + 4, r.y - 4, z);
  return (
    <g>
      <polygon points={pts([iso(r.x - 4, r.y - 4, z), e, c, d])} className="i-roof-back" />
      <polygon points={pts([a, b, c, d])} className="i-roof" />
      <polygon points={pts([b, e, c])} className="i-roof-side" />
    </g>
  );
}

function Tree({ x, y, s }: Pt & { s: number }) {
  const apex = iso(x, y, s * 3);
  const base = 6;
  const l = iso(x - s, y + s, base);
  const f = iso(x + s, y + s, base);
  const rt = iso(x + s, y - s, base);
  const trunk0 = iso(x, y);
  return (
    <g className="i-tree">
      <line x1={trunk0.x} y1={trunk0.y} x2={trunk0.x} y2={trunk0.y - base - 2} className="i-trunk" />
      <polygon points={pts([apex, l, f])} className="i-tree-l" />
      <polygon points={pts([apex, f, rt])} className="i-tree-r" />
    </g>
  );
}

function Parasol({ x, y }: Pt) {
  const pole0 = iso(x, y);
  const top = iso(x, y, 34);
  const ring = [iso(x - 18, y - 18, 26), iso(x + 18, y - 18, 26), iso(x + 18, y + 18, 26), iso(x - 18, y + 18, 26)];
  return (
    <g>
      <polygon points={pts(isoBox({ x: x - 12, y: y - 12, w: 24, h: 24 }, 10).top)} className="i-table-t" />
      <line x1={pole0.x} y1={pole0.y} x2={top.x} y2={top.y} className="i-trunk" />
      <polygon points={pts([top, ring[3], ring[2]])} className="i-parasol-a" />
      <polygon points={pts([top, ring[2], ring[1]])} className="i-parasol-b" />
    </g>
  );
}

function Turtle() {
  const c = iso(TURTLE.x, TURTLE.y, 0);
  return (
    <g transform={`translate(${c.x} ${c.y})`} className="i-turtle">
      <Faces r={{ x: -24, y: -16, w: 48, h: 32 }} h={8} cls="i-plinth" />
      <ellipse cx={0} cy={-14} rx={20} ry={11} className="i-shell" />
      <path d="M-12 -18 L0 -22 L12 -18 M-14 -12 L14 -12" className="i-shell-line" />
      <circle cx={21} cy={-12} r={6} className="i-shell" />
    </g>
  );
}

function Pavilion() {
  const r = { x: PAVILION.x - 18, y: PAVILION.y - 18, w: 36, h: 36 };
  const posts = [iso(r.x, r.y + r.h), iso(r.x + r.w, r.y + r.h), iso(r.x + r.w, r.y)];
  return (
    <g>
      {posts.map((p, i) => (
        <line key={i} x1={p.x} y1={p.y} x2={p.x} y2={p.y - 26} className="i-post" />
      ))}
      <Roof r={r} z={26} />
    </g>
  );
}

function GatePosts({ p }: { p: Pt }) {
  return (
    <g>
      <Faces r={{ x: p.x - 30, y: p.y - 6, w: 12, h: 12 }} h={30} cls="i-gatepost" />
      <Faces r={{ x: p.x + 18, y: p.y - 6, w: 12, h: 12 }} h={30} cls="i-gatepost" />
    </g>
  );
}
