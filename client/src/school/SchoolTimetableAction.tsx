import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SchoolLinkSheet from './SchoolLinkSheet';
import SchoolTimetableSheet from './SchoolTimetableSheet';
import { useSchool } from './SchoolContext';
import './school.css';
import { Button } from '../ui';

/**
 * 시간표 화면 제목 오른쪽의 작은 "학교 시간표 가져오기" 글자 버튼과 그 시트 묶음. 학교 계정이 연동돼 있을 때만 버튼이 보인다.
 * 주소에 `?school=import` 가 있으면(내 정보·가입 직후 "지금 가져오기") 한 번 자동으로 시트를 연다.
 * 가져오기가 끝나면 onImported 로 시간표 목록을 새로고침하게 한다.
 */
export default function SchoolTimetableAction({ onImported }: { onImported: () => void }) {
  const school = useSchool();
  const [params, setParams] = useSearchParams();
  const [timetableOpen, setTimetableOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const wantsImport = params.get('school') === 'import';
  useEffect(() => {
    // 연동 상태를 다 읽은 뒤에 한 번만 처리하고, 주소에서 표시를 지워 새로고침해도 다시 열리지 않게 한다
    if (!wantsImport || school.loading) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('school');
        return next;
      },
      { replace: true },
    );
    if (school.linked && school.canUse) setTimetableOpen(true);
  }, [wantsImport, school.loading, school.linked, school.canUse, setParams]);

  if (school.loading || !school.linked) return null;
  const canImport = school.canUse;

  function relink() {
    setTimetableOpen(false);
    setLinkOpen(true);
  }

  return (
    <>
      {canImport && (
        <Button variant="text" size="sm" className="school-inline-action" onClick={() => setTimetableOpen(true)}>
          학교 시간표 가져오기
        </Button>
      )}
      <SchoolTimetableSheet
        open={timetableOpen}
        onClose={() => setTimetableOpen(false)}
        onImported={onImported}
        onRelink={relink}
      />
      <SchoolLinkSheet
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onImportRequested={() => {
          setLinkOpen(false);
          setTimetableOpen(true);
        }}
      />
    </>
  );
}
