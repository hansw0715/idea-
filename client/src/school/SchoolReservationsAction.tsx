import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon } from '../ui';
import SchoolReservationsSheet from './SchoolReservationsSheet';
import { useSchool } from './SchoolContext';
import './school.css';

/**
 * 회의 화면 제목 오른쪽의 작은 "학교 예약 보기" 글자 버튼 — 학교 시스템에 신청된 내 시설 예약을 시트로 보여 준다.
 * 학교 계정이 연동돼 있고 이 기기에서 쓸 수 있을 때만 보인다. 다시 연동이 필요하면 내 정보로 보낸다.
 */
export default function SchoolReservationsAction() {
  const school = useSchool();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (school.loading || !school.linked || !school.canUse) return null;
  return (
    <>
      <Button variant="text" size="sm" className="school-inline-action" onClick={() => setOpen(true)}>
        <Icon name="pin" className="btn__icon" />
        학교 예약 보기
      </Button>
      <SchoolReservationsSheet
        open={open}
        onClose={() => setOpen(false)}
        onRelink={() => {
          setOpen(false);
          navigate('/account');
        }}
      />
    </>
  );
}
