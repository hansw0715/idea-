import type { CSSProperties } from 'react';
import { AVATARS, normalizeAvatar, temperatureFace } from '../../../../shared/lounge';
import { Icon } from '../../ui';
import type { AvatarColor, AvatarKey } from '../../../../shared/lounge';
import './parts.css';

type AvatarLike = { avatar?: AvatarKey; avatarColor: AvatarColor; nickname?: string };

/**
 * 라운지 아바타: 동일한 배경·모서리를 가진 새 마스코트 이미지.
 * 이전 캐릭터 선택도 같은 마스코트로 연결하며, 사용자 구분은 이름과 함께 제공한다.
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
  const face = AVATARS.find((a) => a.key === normalizeAvatar(user.avatar)) ?? AVATARS[0];
  const n = user.avatarColor.replace('m', '');
  return (
    <span
      className={`lounge-avatar lounge-avatar--${size}${className ? ` ${className}` : ''}`}
      style={{ '--avatar-color': `var(--m-${n})`, ...style } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <img className="lounge-avatar__img" src={face.src} alt="" width="256" height="256" loading="lazy" draggable={false} />
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
      <Icon name="thermometer" className="lounge-temp__icon" />
      <span>{value.toFixed(1)}°</span>
      {!compact && <span className="lounge-temp__label">{face.label}</span>}
    </span>
  );
}
