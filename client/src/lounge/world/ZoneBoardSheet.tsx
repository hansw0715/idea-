import type { GatheringView } from '../../../../shared/lounge';
import { Alert, Button, EmptyState, LoadingBlock, Sheet } from '../../ui';
import GatheringListItem from '../parts/GatheringListItem';
import { MEAL_SLOTS, MEETUP_SLOTS, ZONE_NAME } from './layout';
import { boardList } from './tables';
import type { TableKind } from './tables';

/**
 * 구역 게시판: 그 구역(미팅 라운지/밥약 식당)의 모집글 전체 + "자리 만들기".
 * 지도에는 칸 수(미팅 6·밥약 4)만큼만 테이블이 보이므로, 나머지 글은 여기서 본다.
 * 키보드·스크린 리더 사용자가 지도의 간판을 눌렀을 때와 같은 내용이다.
 */
export default function ZoneBoardSheet({
  open,
  zone,
  gatherings,
  loaded,
  error,
  disabled,
  onRetry,
  onOpenGathering,
  onCreate,
  onClose,
}: {
  open: boolean;
  zone: TableKind;
  gatherings: GatheringView[];
  /** 모임 목록을 한 번이라도 받았는가 */
  loaded: boolean;
  error: string | null;
  /** 이용 정지 등으로 자리를 만들 수 없을 때 */
  disabled: boolean;
  onRetry: () => void;
  onOpenGathering: (g: GatheringView) => void;
  onCreate: (kind: TableKind) => void;
  onClose: () => void;
}) {
  const noun = zone === 'meetup' ? '미팅' : '밥약';
  const items = boardList(gatherings, zone);
  const shown = zone === 'meetup' ? MEETUP_SLOTS.length : MEAL_SLOTS.length;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${ZONE_NAME[zone]} 게시판`}
      footer={
        <Button variant="primary" block disabled={disabled} onClick={() => onCreate(zone)}>
          {noun} 자리 만들기
        </Button>
      }
    >
      <p className="text-sub text-sm">
        지도에는 {noun} 테이블이 최대 {shown}개까지 보입니다. 모집 중인 글은 모두 여기에서 볼 수 있습니다.
      </p>
      <div className="lounge-world-board">
        {!loaded && error ? (
          <Alert
            tone="danger"
            title="모집글을 불러오지 못했습니다."
            actions={
              <Button variant="secondary" onClick={onRetry}>
                다시 시도하기
              </Button>
            }
          >
            {error}
          </Alert>
        ) : !loaded ? (
          <LoadingBlock>모집글을 불러오는 중입니다.</LoadingBlock>
        ) : items.length === 0 ? (
          <EmptyState
            icon={zone === 'meetup' ? 'heart' : 'utensils'}
            title={`아직 모집 중인 ${noun}이 없습니다.`}
            description={`아래 버튼으로 첫 ${noun} 자리를 만들어 보세요.`}
          />
        ) : (
          <div className="list">
            {items.map((g) => (
              <GatheringListItem key={g.id} gathering={g} onOpen={onOpenGathering} />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
