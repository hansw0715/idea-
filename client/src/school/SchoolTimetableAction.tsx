import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Icon } from '../ui';
import SchoolLinkSheet from './SchoolLinkSheet';
import SchoolTimetableSheet from './SchoolTimetableSheet';
import { useSchool } from './SchoolContext';

/**
 * 시간표 화면 위쪽에 끼우는 "학교 시간표 가져오기" 한 줄.
 *  - 연동되어 있고 이 기기에서 쓸 수 있을 때만 버튼을 보인다.
 *  - 연동은 됐는데 이 기기에서 쓸 수 없으면 버튼 대신 다시 연동 안내를 보인다.
 *  - 연동하지 않았다면 아무것도 그리지 않는다 (연동은 내 정보에서 한다).
 * 가져오기가 끝나면 onImported 로 시간표 목록을 새로고침하게 한다.
 * 주소에 `?school=import` 가 있으면(가입 직후 "지금 가져오기") 한 번 자동으로 시트를 연다.
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

  // 읽는 중이거나 연동하지 않았으면 그릴 것이 없다 (연동은 내 정보에서 한다)
  if (school.loading || !school.linked) return null;

  function relink() {
    setTimetableOpen(false);
    setLinkOpen(true);
  }

  return (
    <div className="school-tt-bar">
      {school.canUse ? (
        <Button variant="secondary" block onClick={() => setTimetableOpen(true)}>
          <Icon name="calendar" className="btn__icon" />
          학교 시간표 가져오기
        </Button>
      ) : (
        <Alert
          tone="info"
          actions={
            <Button variant="secondary" size="sm" onClick={() => setLinkOpen(true)}>
              다시 연동하기
            </Button>
          }
        >
          다른 기기에서 연동해서 이 기기에서는 학교 시간표를 가져올 수 없어요. 이 기기에서 쓰려면 다시 연동해 주세요.
        </Alert>
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
    </div>
  );
}
