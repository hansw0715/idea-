import { useState } from 'react';
import type { SchoolProfile } from '../../../shared/school/types';
import { Button } from '../ui';
import SchoolLinkForm, { SchoolLinkDone, SchoolLinkSubmit, useSchoolLinkForm } from './SchoolLinkForm';

/** 가입을 마친 뒤 어디로 갈지: 홈, 또는 시간표 화면에서 학교 시간표 가져오기 시트를 바로 연 상태 */
export type SignupSchoolDestination = '/' | '/timetable?school=import';

interface Props {
  /**
   * 방금 가입한 사용자 id. 가입이 끝났어도 앱 전체의 로그인 정보(setUser)는 이 단계가 끝나야 올라가므로
   * 연동에 쓸 키를 이 id 로 만든다 (서버 쿠키는 이미 로그인 상태라 /api/school/* 가 동작한다).
   */
  user: { id: number; username: string };
  /** 연동을 마쳤거나 건너뛰었을 때 */
  onFinish: (destination: SignupSchoolDestination) => void;
}

/** 가입 3단계(선택): 학교 계정 연동. 연동 폼은 내 정보의 연동 시트와 같은 것을 쓴다 */
export default function SignupSchoolStep({ user, onFinish }: Props) {
  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  const controller = useSchoolLinkForm({ forUser: user, onLinked: setProfile });

  if (profile) {
    return (
      <div>
        <h2 className="school-step__title" id="signup-school-title" tabIndex={-1}>
          학교 계정 연동
        </h2>
        <SchoolLinkDone profile={profile} canImport />
        <div className="school-step__actions">
          <Button size="lg" block onClick={() => onFinish('/timetable?school=import')}>
            지금 가져오기
          </Button>
          <Button variant="tertiary" block onClick={() => onFinish('/')}>
            나중에
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="school-step__title" id="signup-school-title" tabIndex={-1}>
        학교 계정 연동 (선택)
      </h2>
      <SchoolLinkForm controller={controller}>
        <div className="school-step__actions">
          <SchoolLinkSubmit controller={controller} size="lg" block />
          <Button variant="tertiary" block disabled={controller.busy} onClick={() => onFinish('/')}>
            나중에 하기
          </Button>
        </div>
      </SchoolLinkForm>
    </div>
  );
}
