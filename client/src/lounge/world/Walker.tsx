import { memo } from 'react';
import type { CSSProperties } from 'react';
import { EMOTES } from '../../../../shared/lounge';
import type { AvatarColor, AvatarKey, EmoteKey, Zone } from '../../../../shared/lounge';
import Avatar from '../parts/Avatar';
import { ZONE_NAME } from './layout';

const emoteOf = (key: EmoteKey | null | undefined) => (key ? EMOTES.find((e) => e.key === key) : undefined);

/** 머리 위 말풍선. 장식이라 낭독은 상위 요소의 aria-label 이 맡는다. */
export function EmoteBubble({ emote }: { emote: EmoteKey | null | undefined }) {
  const e = emoteOf(emote);
  if (!e) return null;
  return (
    <span className="lounge-world-bubble" aria-hidden="true">
      {e.emoji}
    </span>
  );
}

type WalkerProps = {
  id: string;
  nickname: string;
  avatar: AvatarKey;
  avatarColor: AvatarColor;
  /** 0~1 정규화 좌표 */
  x: number;
  y: number;
  zone: Zone;
  emote: EmoteKey | null;
  onOpen: (userId: string) => void;
};

/**
 * 다른 접속자의 걷는 아바타. 눌러서 사용자 카드를 연다.
 * 접속자가 최대 200명이라 memo 로 감싸고 props 를 원시값으로만 받는다: 3초 폴링마다 위치가 바뀐 사람만 다시 그려진다.
 * left/top 이 바뀌면 css transition(0.9초 선형)이 미끄러지듯 옮긴다.
 */
export const OtherWalker = memo(function OtherWalker({ id, nickname, avatar, avatarColor, x, y, zone, emote, onOpen }: WalkerProps) {
  const e = emoteOf(emote);
  return (
    <button
      type="button"
      className="lounge-world-walker"
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, zIndex: 10 + Math.round(y * 100) } as CSSProperties}
      aria-label={`${nickname}, ${ZONE_NAME[zone]}에 있음${e ? `, ${e.label} 이모트` : ''}. 누르면 프로필 카드가 열립니다`}
      onClick={() => onOpen(id)}
    >
      <EmoteBubble emote={emote} />
      <Avatar user={{ avatar, avatarColor }} />
      <span className="lounge-world-nick">{nickname}</span>
    </button>
  );
});

/**
 * 내 아바타. 눌림을 받지 않는다(pointer-events: none): 내 주변 바닥을 눌러 조금씩 걸어갈 수 있게.
 * 인디고 링 + "나" 라벨로 구분하고, 라벨은 색만이 아니라 글자로도 나를 알린다.
 */
export function MyWalker({
  x,
  y,
  avatar,
  avatarColor,
  emote,
}: {
  x: number;
  y: number;
  avatar: AvatarKey;
  avatarColor: AvatarColor;
  emote: EmoteKey | null;
}) {
  return (
    <div
      className="lounge-world-walker lounge-world-walker--me"
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, zIndex: 11 + Math.round(y * 100) } as CSSProperties}
      role="img"
      aria-label={`내 아바타${emoteOf(emote) ? `, ${emoteOf(emote)?.label} 이모트` : ''}`}
    >
      <EmoteBubble emote={emote} />
      <Avatar user={{ avatar, avatarColor }} />
      <span className="lounge-world-nick" aria-hidden="true">
        나
      </span>
    </div>
  );
}
