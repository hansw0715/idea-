import { memo } from 'react';
import { MAP_H, MAP_W, ZONE_RECTS } from './layout';

/**
 * 지도 바닥과 장식. 평면 색 면 + 1px 보더 + 4px 라운드, 장식은 보더만 있는 단순 도형이다.
 * 그림자·그라데이션을 쓰지 않는다(KRDS). 색은 css 클래스(world.css)가 토큰으로 칠한다.
 * 순수 장식이라 보조기기에는 숨기고(aria-hidden), 눌림은 아래 지도가 받도록 pointer-events 를 끈다.
 */
const Floor = memo(function Floor() {
  const { plaza, meetup, meal } = ZONE_RECTS;
  return (
    <svg
      className="lounge-world-floor"
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* 광장: 분수 · 나무 · 벤치 · 산책로 */}
      <rect className="lw-zone lw-zone--plaza" x={plaza.x} y={plaza.y} width={plaza.w} height={plaza.h} rx="4" />
      <path className="lw-path" d="M 14 98 H 346" />
      <circle className="lw-water" cx="180" cy="52" r="22" />
      <circle className="lw-water lw-water--inner" cx="180" cy="52" r="12" />
      <circle className="lw-water lw-water--dot" cx="180" cy="52" r="3" />
      {[
        [40, 34],
        [320, 34],
        [86, 62],
        [274, 62],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <rect className="lw-tree lw-tree--trunk" x={cx - 2} y={cy + 8} width="4" height="8" />
          <circle className="lw-tree" cx={cx} cy={cy} r="11" />
        </g>
      ))}
      <rect className="lw-bench" x="112" y="84" width="30" height="8" rx="2" />
      <rect className="lw-bench" x="218" y="84" width="30" height="8" rx="2" />

      {/* 미팅 라운지: 카펫 */}
      <rect className="lw-zone lw-zone--meetup" x={meetup.x} y={meetup.y} width={meetup.w} height={meetup.h} rx="4" />
      <rect className="lw-carpet" x={meetup.x + 8} y={meetup.y + 32} width={meetup.w - 16} height={meetup.h - 40} rx="4" />

      {/* 밥약 식당: 타일 바닥 */}
      <rect className="lw-zone lw-zone--meal" x={meal.x} y={meal.y} width={meal.w} height={meal.h} rx="4" />
      <path className="lw-tile" d="M 12 596 H 348 M 12 697 H 348" />
      <path className="lw-tile" d="M 180 498 V 697" />
    </svg>
  );
});

export default Floor;
