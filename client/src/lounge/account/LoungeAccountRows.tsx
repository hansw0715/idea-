import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../ui';
import { useLounge } from '../LoungeContext';
import BlockListSheet from '../sheets/BlockListSheet';

/**
 * 내 정보 "설정" 목록의 라운지 행들(차단한 사용자 · 관리자 화면).
 * 라운지가 꺼져 있으면 Account 가 이 컴포넌트를 아예 그리지 않는다(useLounge 가 Provider 를 요구하기 때문).
 */
export default function LoungeAccountRows() {
  // 관리자 화면 링크는 라운지 쪽 판단(AdminPage 와 같은 값)을 따라야 눌렀는데 막히는 일이 없다
  const { isAdmin } = useLounge();
  const [blockOpen, setBlockOpen] = useState(false);

  return (
    <>
      <button type="button" className="list__item list__item--link" onClick={() => setBlockOpen(true)}>
        <Icon name="block" className="account-menu__icon" />
        <span className="list__body">
          <span className="list__main">차단한 사용자</span>
          <span className="list__sub">차단하면 서로 라운지에서 보이지 않아요</span>
        </span>
        <Icon name="chevron-right" className="list__chev" />
      </button>
      {isAdmin && (
        <Link to="/admin" className="list__item list__item--link">
          <Icon name="shield" className="account-menu__icon" />
          <span className="list__body">
            <span className="list__main">관리자 화면</span>
            <span className="list__sub">신고 처리와 이용 통계</span>
          </span>
          <Icon name="chevron-right" className="list__chev" />
        </Link>
      )}
      <BlockListSheet open={blockOpen} onClose={() => setBlockOpen(false)} />
    </>
  );
}
