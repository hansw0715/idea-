import type { Member } from '../types';
import { Icon } from '../ui';

/** 상세 화면과 예약 흐름에서 같은 참여자 선택을 사용한다. */
export default function MeetingParticipants({ members, activeIds, onToggle, disabled = false }: {
  members: Member[];
  activeIds: number[];
  onToggle: (id: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tag-group mtg-members" role="group" aria-label="회의에 참여할 팀원">
      {members.map((m) => {
        const selected = activeIds.includes(m.id);
        return (
          <button key={m.id} type="button" className={`tag mtg-chip${selected ? '' : ' is-off'}`}
            aria-pressed={selected} onClick={() => onToggle(m.id)} disabled={disabled}>
            <span className="mtg-chip__check" aria-hidden="true">
              <Icon name={selected ? 'check' : 'plus'} />
            </span>
            <span>{m.name}</span>
            {m.isOwner ? <span className="mtg-chip__role">방장</span> : null}
            {!selected && <span className="mtg-chip__role">제외</span>}
          </button>
        );
      })}
    </div>
  );
}
