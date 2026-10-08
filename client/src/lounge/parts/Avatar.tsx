import type { CSSProperties } from 'react';
import { AVATARS, temperatureFace } from '../../../../shared/lounge';
import type { AvatarColor, AvatarKey } from '../../../../shared/lounge';
import './parts.css';

type AvatarLike = { avatar: AvatarKey; avatarColor: AvatarColor };

/**
 * 라운지 아바타: 색 테두리 + 연한 같은 색 바탕 + 동물 이모지.
 * 색은 범주 색 토큰(--m-1 ~ --m-8)이고, 사람 구분은 색만이 아니라 이름/이모지/위치와 함께 한다.
 * size: sm(24) md(36) lg(56). 지도처럼 크기를 직접 정하려면 `--avatar-size` 를 style 로 넘긴다.
 */
export default function Avatar({
  user,
  size = 'md',
  label,
  className,
  style,
}: {
  user: AvatarLike;
  size?: 'sm' | 'md' | 'lg';
  /** 주면 이미지(role=img)로 읽힌다. 이름이 옆에 이미 있으면 생략(장식). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const face = AVATARS.find((a) => a.key === user.avatar) ?? AVATARS[0];
  const n = user.avatarColor.replace('m', '');
  return (
    <span
      className={`lounge-avatar lounge-avatar--${size}${className ? ` ${className}` : ''}`}
      style={{ '--avatar-color': `var(--m-${n})`, ...style } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="lounge-avatar__face">{face.emoji}</span>
    </span>
  );
}

/** 매너온도: 숫자 + 단계 글자 + 얼굴 (색만으로 의미를 전달하지 않는다) */
export function TemperatureBadge({ value, compact = false }: { value: number; compact?: boolean }) {
  const face = temperatureFace(value);
  return (
    <span
      className={`lounge-temp lounge-temp--${face.tone}`}
      title={`매너온도 ${value.toFixed(1)}° · ${face.label}`}
    >
      <span aria-hidden="true">{face.emoji}</span>
      <span>{value.toFixed(1)}°</span>
      {!compact && <span className="lounge-temp__label">{face.label}</span>}
    </span>
  );
}
