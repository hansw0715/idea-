import { EMOTES } from '../../../../shared/lounge';
import type { EmoteKey } from '../../../../shared/lounge';

/**
 * 하단 고정 이모트 바 (탭바 바로 위, `--bottom-offset`).
 * 누르면 내 머리 위에 말풍선이 5초 동안 뜨고 다른 접속자에게도 보인다.
 * 지도 모드와 목록 모드에서 모두 쓴다: 목록 모드 사용자도 인사를 보낼 수 있어야 기능이 같다.
 * 버튼은 각각 44px 이상이고, 이모지만으로는 뜻이 안 읽히므로 aria-label 에 이름을 쓴다.
 */
export default function EmoteBar({
  active,
  disabled,
  onSend,
}: {
  /** 지금 내 머리 위에 떠 있는 이모트 */
  active: EmoteKey | null;
  disabled: boolean;
  onSend: (key: EmoteKey) => void;
}) {
  return (
    <div className="lounge-world-emotes" role="group" aria-label="이모트 보내기">
      {EMOTES.map((e) => (
        <button
          key={e.key}
          type="button"
          className="lounge-world-emote"
          aria-label={`${e.label} 이모트 보내기`}
          aria-pressed={active === e.key}
          disabled={disabled}
          onClick={() => onSend(e.key)}
        >
          <span aria-hidden="true">{e.emoji}</span>
        </button>
      ))}
    </div>
  );
}
