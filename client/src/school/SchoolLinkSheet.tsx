import { useState } from 'react';
import type { SchoolProfile } from '../../../shared/school/types';
import { Button, Sheet } from '../ui';
import SchoolLinkForm, { LINK_ID_FIELD, SchoolLinkDone, SchoolLinkSubmit, useSchoolLinkForm } from './SchoolLinkForm';
import { SchoolFoot, useCloseGuard, useOpenSession } from './SchoolParts';

export interface SchoolLinkSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * 연동 성공 화면에서 "지금 가져오기"를 눌렀을 때. 넘기면 "학교 시간표를 지금 가져올까요?"를 묻고,
   * 넘기지 않으면 "닫기"만 둔다. 이 함수 안에서 시트를 닫고 시간표 시트를 열면 된다.
   */
  onImportRequested?: () => void;
  /** 연동이 끝나 상태가 갱신된 직후 */
  onLinked?: (profile: SchoolProfile) => void;
}

/**
 * 내 정보 등에서 여는 학교 계정 연동 시트(연동하기·다시 연동). 연동 폼은 가입 3단계와 같은 것을 쓴다.
 * 열 때마다 처음 상태(동의 해제·빈 입력칸)에서 시작한다.
 */
export default function SchoolLinkSheet(props: SchoolLinkSheetProps) {
  const session = useOpenSession(props.open);
  return <LinkSheetBody key={session} {...props} />;
}

function LinkSheetBody({ open, onClose, onImportRequested, onLinked }: SchoolLinkSheetProps) {
  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  const controller = useSchoolLinkForm({
    onLinked: (p) => {
      setProfile(p);
      onLinked?.(p);
    },
  });
  // 학교에 확인하는 동안에는 닫지 않는다 — 닫았다가 결과(키 저장)를 놓치지 않게
  const { close, overdue } = useCloseGuard(controller.busy, onClose);

  return (
    <Sheet
      open={open}
      onClose={close}
      title={profile ? '학교 계정을 연동했어요' : '학교 계정 연동하기'}
      initialFocus={`#${LINK_ID_FIELD}`}
      footer={
        profile ? (
          <SchoolFoot>
            {onImportRequested ? (
              <>
                <Button onClick={onImportRequested}>지금 가져오기</Button>
                <Button variant="tertiary" onClick={onClose}>
                  닫기
                </Button>
              </>
            ) : (
              <Button onClick={onClose}>닫기</Button>
            )}
          </SchoolFoot>
        ) : (
          <SchoolFoot>
            <SchoolLinkSubmit controller={controller} />
            <Button variant="tertiary" onClick={close} disabled={controller.busy}>
              취소
            </Button>
          </SchoolFoot>
        )
      }
    >
      {profile ? (
        <SchoolLinkDone profile={profile} canImport={Boolean(onImportRequested)} />
      ) : (
        <SchoolLinkForm controller={controller} overdue={overdue} />
      )}
    </Sheet>
  );
}
