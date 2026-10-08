import { useId, useMemo, useRef } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import type { AvatarColor, AvatarKey, EmoteKey, GatheringView, PresenceUser } from '../../../../shared/lounge';
import { Icon } from '../../ui';
import Floor from './Floor';
import { KIOSK, MEAL_SLOTS, MEETUP_SLOTS, SIGN_Y, ZONE_NAME, pctX, pctY } from './layout';
import type { MyPlace } from './usePresence';
import TableView from './TableView';
import { MyWalker, OtherWalker } from './Walker';
import type { PickedTables, TableKind } from './tables';
import './world.css';

/** 내용이 같으면 이전 객체를 그대로 돌려준다 (자식 memo 가 헛되이 깨지지 않게) */
function useStable<T>(value: T): T {
  const ref = useRef<{ json: string; value: T } | null>(null);
  const json = JSON.stringify(value);
  if (!ref.current || ref.current.json !== json) ref.current = { json, value };
  return ref.current.value;
}

export type WorldProps = {
  meId: string;
  meAvatar: { avatar: AvatarKey; avatarColor: AvatarColor };
  place: MyPlace;
  myEmote: EmoteKey | null;
  others: PresenceUser[];
  picked: PickedTables;
  /** 모임 목록을 한 번이라도 받았는가 (받기 전에는 "빈 테이블" 을 그리지 않는다) */
  loaded: boolean;
  /** 구역 게시판에 올라 있는(끝나지 않은) 모집글 수 */
  boardCounts: Record<TableKind, number>;
  /** 보이는 테이블에 앉은 사람들 (한 사람은 한 번만 그린다) */
  seated: Map<string, GatheringView>;
  /** 이용 정지 등으로 조작할 수 없을 때 */
  disabled: boolean;
  hint: string;
  onMove: (x: number, y: number) => void;
  /** 앉아 있는 상태에서 바닥을 눌렀다 */
  onSeatedTap: () => void;
  onOpenTable: (g: GatheringView, slotKey?: string) => void;
  onOpenZone: (zone: TableKind) => void;
  onCreate: (kind: TableKind) => void;
  onQuick: () => void;
  onOpenUser: (userId: string) => void;
};

/**
 * 라운지 지도. 모든 요소는 실제 <button> 이고 left/top 은 % 다.
 * 컨테이너 쿼리(container-type: inline-size)로 크기를 정해, 글자를 150% 로 키워도 지도의 비율이 그대로다.
 * 빈 바닥을 누르면 내 아바타가 걸어간다(포인터 전용). 테이블·의자·간판·키오스크는 Tab 으로 닿고 Enter 로 열린다.
 */
export default function World({
  meId,
  meAvatar,
  place,
  myEmote,
  others,
  picked,
  loaded,
  boardCounts,
  seated,
  disabled,
  hint,
  onMove,
  onSeatedTap,
  onOpenTable,
  onOpenZone,
  onCreate,
  onQuick,
  onOpenUser,
}: WorldProps) {
  const hintId = useId();
  const sitting = seated.has(meId);

  // 앉은 사람들의 말풍선 (타인은 presence 의 emote, 나는 방금 보낸 것)
  const emotes = useStable(
    useMemo(() => {
      const map: Record<string, EmoteKey> = {};
      for (const p of others) if (p.emote) map[p.user.id] = p.emote;
      if (myEmote) map[meId] = myEmote;
      return map;
    }, [others, myEmote, meId]),
  );

  const walking = useMemo(() => others.filter((p) => !seated.has(p.user.id)), [others, seated]);

  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    // 버튼(테이블·의자·간판·키오스크·타인 아바타) 위를 눌렀다면 그 버튼이 처리한다
    if ((e.target as Element).closest('button')) return;
    if (disabled) return;
    if (sitting) {
      onSeatedTap();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onMove((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  const sign = (zone: TableKind) => (
    <button
      type="button"
      className="lounge-world-sign"
      style={{ '--y': SIGN_Y[zone] } as CSSProperties}
      aria-label={`${ZONE_NAME[zone]} 게시판 열기. 모집글 ${boardCounts[zone]}개`}
      onClick={() => onOpenZone(zone)}
    >
      <Icon name={zone === 'meetup' ? 'heart' : 'utensils'} className="lounge-world-sign__icon" />
      <span className="truncate">{ZONE_NAME[zone]} 게시판</span>
      <span className="lounge-world-sign__count">{boardCounts[zone]}</span>
    </button>
  );

  const slots = (zone: TableKind) => {
    const defs = zone === 'meetup' ? MEETUP_SLOTS : MEAL_SLOTS;
    return defs.map((slot) => {
      const g = picked[zone][slot.index];
      if (g) {
        return <TableView key={g.id} g={g} cx={slot.cx} cy={slot.cy} meId={meId} emotes={emotes} onOpen={onOpenTable} />;
      }
      if (!loaded) return null;
      const noun = zone === 'meetup' ? '미팅' : '밥약';
      return (
        <div key={`empty-${zone}-${slot.index}`} className="lounge-world-cell" style={{ left: pctX(slot.cx), top: pctY(slot.cy) }}>
          <button
            type="button"
            className="lounge-world-empty"
            disabled={disabled}
            aria-label={`빈 ${noun} 테이블. 누르면 ${noun} 자리를 만듭니다`}
            onClick={() => onCreate(zone)}
          >
            <span>빈 테이블</span>
            <span className="lounge-world-empty__action">
              <Icon name="plus" className="lounge-world-empty__icon" />
              자리 만들기
            </span>
          </button>
        </div>
      );
    });
  };

  return (
    <div className="lounge-world-mapwrap">
      <div className="lounge-world-map" role="group" aria-label="라운지 지도" aria-describedby={hintId}>
        {/* 눌림 처리는 포인터 전용이다. 키보드 사용자는 목록 모드를 쓴다 */}
        <div className="lounge-world-stage" onClick={onStageClick} data-disabled={disabled || undefined}>
          <Floor />
          <span className="lounge-world-zonename" style={{ top: pctY(10) }}>
            {ZONE_NAME.plaza}
          </span>
          {sign('meetup')}
          {slots('meetup')}
          {sign('meal')}
          {slots('meal')}
          <button
            type="button"
            className="lounge-world-kiosk"
            style={{ left: pctX(KIOSK.cx), top: pctY(KIOSK.cy) }}
            disabled={disabled}
            aria-label="빠른 매칭 키오스크. 조건을 고르면 같이 밥 먹을 사람을 찾아 줍니다"
            onClick={onQuick}
          >
            <Icon name="utensils" className="lounge-world-kiosk__icon" />
            <span>빠른 매칭</span>
          </button>
          {walking.map((p) => (
            <OtherWalker
              key={p.user.id}
              id={p.user.id}
              nickname={p.user.nickname}
              avatar={p.user.avatar}
              avatarColor={p.user.avatarColor}
              x={p.x}
              y={p.y}
              zone={p.zone}
              emote={p.emote}
              onOpen={onOpenUser}
            />
          ))}
          {!sitting && (
            <MyWalker x={place.x} y={place.y} avatar={meAvatar.avatar} avatarColor={meAvatar.avatarColor} emote={myEmote} />
          )}
        </div>
      </div>
      <p className="lounge-world-hint" id={hintId}>
        {hint}
      </p>
    </div>
  );
}
