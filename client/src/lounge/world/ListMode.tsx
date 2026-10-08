import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { GatheringView, PresenceUser } from '../../../../shared/lounge';
import { Alert, Button, EmptyState, Icon, LoadingBlock } from '../../ui';
import Avatar from '../parts/Avatar';
import GatheringListItem from '../parts/GatheringListItem';
import { ZONE_NAME, zoneAt } from './layout';
import { boardList } from './tables';
import type { TableKind } from './tables';
import './world.css';

/** 접속자 목록은 처음 이만큼만 그린다 (200명이 한꺼번에 몰려도 화면이 길어지지 않게) */
const USERS_PAGE = 30;

/**
 * 목록 모드 — 지도와 기능이 같은 접근성 대안.
 * 지도에서 하는 일(접속자 보기, 내 약속, 미팅·밥약 글 열기, 자리 만들기, 빠른 매칭)을
 * 모두 버튼과 목록으로 할 수 있다. 포인터 없이 키보드·스크린 리더만으로 끝까지 쓸 수 있어야 한다.
 */
export default function ListMode({
  users,
  all,
  mine,
  loaded,
  error,
  stale,
  disabled,
  onRetry,
  onOpenGathering,
  onOpenUser,
  onCreate,
  onQuick,
}: {
  users: PresenceUser[];
  all: GatheringView[];
  mine: GatheringView[];
  loaded: boolean;
  error: string | null;
  /** 한 번 받은 뒤 새로 받지 못하고 있다 */
  stale: boolean;
  disabled: boolean;
  onRetry: () => void;
  onOpenGathering: (g: GatheringView) => void;
  onOpenUser: (userId: string) => void;
  onCreate: (kind: TableKind) => void;
  onQuick: () => void;
}) {
  const ids = useId();
  const [showUsers, setShowUsers] = useState(false);
  const [userLimit, setUserLimit] = useState(USERS_PAGE);

  const meetups = boardList(all, 'meetup');
  const meals = boardList(all, 'meal');

  const gatheringList = (items: GatheringView[]) => (
    <div className="list">
      {items.map((g) => (
        <GatheringListItem key={g.id} gathering={g} onOpen={onOpenGathering} />
      ))}
    </div>
  );

  const section = (key: string, title: string, count: number | null, body: ReactNode) => (
    <section className="section" aria-labelledby={`${ids}-${key}`}>
      <div className="section__head">
        <h2 className="section__title" id={`${ids}-${key}`}>
          {title}
          {count !== null && <span className="lounge-world-list__count"> {count}</span>}
        </h2>
      </div>
      {body}
    </section>
  );

  const placeholder =
    !loaded && error ? (
      <Alert
        tone="danger"
        title="모임 목록을 불러오지 못했습니다."
        actions={
          <Button variant="secondary" onClick={onRetry}>
            다시 시도하기
          </Button>
        }
      >
        {error}
      </Alert>
    ) : !loaded ? (
      <LoadingBlock>모임을 불러오는 중입니다.</LoadingBlock>
    ) : null;

  return (
    <div className="lounge-world-list">
      <section className="section" aria-labelledby={`${ids}-actions`}>
        <div className="section__head">
          <h2 className="section__title" id={`${ids}-actions`}>
            바로 하기
          </h2>
        </div>
        <div className="stack-sm">
          <Button variant="primary" size="lg" block disabled={disabled} onClick={onQuick}>
            빠른 매칭
          </Button>
          <Button variant="secondary" block disabled={disabled} onClick={() => onCreate('meetup')}>
            미팅 자리 만들기
          </Button>
          <Button variant="secondary" block disabled={disabled} onClick={() => onCreate('meal')}>
            밥약 자리 만들기
          </Button>
        </div>
      </section>

      {loaded && stale && (
        <p className="lounge-world-note" role="status">
          <Icon name="alert" className="lounge-world-note__icon" />
          목록을 새로 받지 못하고 있습니다. 마지막으로 받은 내용을 보여 드립니다.
        </p>
      )}

      {placeholder ?? (
        <>
          {section(
            'mine',
            '내 약속',
            mine.length,
            mine.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="아직 약속이 없습니다."
                description="아래 모집글에 앉거나 새 자리를 만들면 이곳에 모입니다."
              />
            ) : (
              gatheringList(mine)
            ),
          )}
          {section(
            'meetup',
            '미팅 글',
            meetups.length,
            meetups.length === 0 ? (
              <EmptyState
                icon="heart"
                title="아직 모집 중인 미팅이 없습니다."
                description="첫 미팅 자리를 만들어 보세요."
                action={
                  <Button variant="secondary" disabled={disabled} onClick={() => onCreate('meetup')}>
                    미팅 자리 만들기
                  </Button>
                }
              />
            ) : (
              gatheringList(meetups)
            ),
          )}
          {section(
            'meal',
            '밥약 글',
            meals.length,
            meals.length === 0 ? (
              <EmptyState
                icon="utensils"
                title="아직 모집 중인 밥약이 없습니다."
                description="같이 먹을 사람을 모집하거나 빠른 매칭으로 찾아 보세요."
                action={
                  <Button variant="secondary" disabled={disabled} onClick={() => onCreate('meal')}>
                    밥약 자리 만들기
                  </Button>
                }
              />
            ) : (
              gatheringList(meals)
            ),
          )}
        </>
      )}

      <section className="section" aria-labelledby={`${ids}-users`}>
        <div className="section__head">
          <h2 className="section__title" id={`${ids}-users`}>
            접속 중인 학우
            <span className="lounge-world-list__count"> {users.length}</span>
          </h2>
          <Button
            variant="text"
            aria-expanded={showUsers}
            aria-controls={`${ids}-users-body`}
            onClick={() => setShowUsers((v) => !v)}
          >
            {showUsers ? '접기' : '보기'}
          </Button>
        </div>
        <div id={`${ids}-users-body`} hidden={!showUsers}>
          {users.length === 0 ? (
            <EmptyState title="지금은 다른 학우가 없습니다." description="접속하는 학우가 생기면 이곳에 보입니다." />
          ) : (
            <div className="list">
              {users.slice(0, userLimit).map((p) => (
                <button
                  key={p.user.id}
                  type="button"
                  className="list__item list__item--link"
                  aria-label={`${p.user.nickname}, ${ZONE_NAME[zoneAt(p.x, p.y)]}에 있음. 누르면 프로필 카드가 열립니다`}
                  onClick={() => onOpenUser(p.user.id)}
                >
                  <Avatar user={p.user} />
                  <span className="list__body">
                    <span className="list__main truncate" style={{ display: 'block' }}>
                      {p.user.nickname}
                    </span>
                    <span className="list__sub" style={{ display: 'block' }}>
                      {ZONE_NAME[zoneAt(p.x, p.y)]}에 있음
                    </span>
                  </span>
                  <Icon name="chevron-right" className="list__chev" />
                </button>
              ))}
            </div>
          )}
          {users.length > userLimit && (
            <Button variant="tertiary" block onClick={() => setUserLimit((n) => n + USERS_PAGE)}>
              더 보기
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
