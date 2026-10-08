import type { ReactNode } from 'react';
import { Icon } from '../../ui';

/**
 * 시트 안에 남기는 성공 안내 (화면에 잠깐 머무는 한 줄).
 *
 * 왜 Alert 가 아닌가: 모달 시트가 열려 있으면 토스트는 시트 뒤에 가려져 보이지 않는다. 그래서 눈에 보이는 안내는 시트 안에 두고,
 * 화면 낭독기에는 토스트(aria-live)가 한 번 읽어 준다. 여기에 role=status 까지 두면 같은 말이 두 번 읽히므로 역할을 주지 않는다.
 */
export default function InlineNotice({ children }: { children: ReactNode }) {
  return (
    <div className="alert alert--success">
      <Icon name="check-circle" className="alert__icon" />
      <div className="alert__body">
        <div>{children}</div>
      </div>
    </div>
  );
}
