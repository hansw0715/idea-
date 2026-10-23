import { Link } from 'react-router-dom';
import { Icon, btnClass } from '../../ui';
import { useLounge } from '../LoungeContext';

/**
 * 내 정보 "설정" 줄의 라운지 행 — 관리자 화면 링크(관리자에게만).
 * 차단한 사용자는 라운지 프로필 카드의 "프로필 이미지 바꾸기" 옆으로 옮겼다 (LoungeProfileCard).
 * 라운지가 꺼져 있으면 Account 가 이 컴포넌트를 아예 그리지 않는다(useLounge 가 Provider 를 요구하기 때문).
 */
export default function LoungeAccountRows() {
  // 관리자 화면 링크는 라운지 쪽 판단(AdminPage 와 같은 값)을 따라야 눌렀는데 막히는 일이 없다
  const { isAdmin } = useLounge();
  if (!isAdmin) return null;
  return (
    <section className="section account-tools" aria-label="설정">
      <Link to="/admin" className={btnClass({ variant: 'secondary', size: 'sm' })}>
        <Icon name="shield" className="btn__icon" />
        관리자 화면
      </Link>
    </section>
  );
}
