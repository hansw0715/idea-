import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Icon, LoadingBlock, useConfirm, useToast } from '../ui';
import { formatLinkedDate } from './format';
import SchoolLinkSheet from './SchoolLinkSheet';
import SchoolReservationsSheet from './SchoolReservationsSheet';
import SchoolTimetableSheet from './SchoolTimetableSheet';
import { useSchool } from './SchoolContext';

/**
 * "내 정보" 화면의 학교 계정 연동 카드 — 상태(연동됨 ***044 / 안 됨 / 이 기기에서 풀 수 없음),
 * 연동하기·다시 연동·연동 해제, 학교 시간표 가져오기, 내 학교 예약 보기.
 * Account.tsx 는 이 컴포넌트를 `<SchoolLinkCard />` 로 그대로 넣기만 한다 (props 없음).
 * 자기 구역(section)까지 그리므로 다른 구역과 같은 간격으로 놓인다.
 */
export default function SchoolLinkCard() {
  const school = useSchool();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();

  const [linkOpen, setLinkOpen] = useState(false);
  const [timetableOpen, setTimetableOpen] = useState(false);
  const [reservationsOpen, setReservationsOpen] = useState(false);

  const linkedDate = formatLinkedDate(school.linkedAt ?? null);
  // 별표 대신 끝 3자리를 스크린 리더에 읽어 준다 ("별 별 별 영 사 사"로 읽히지 않게)
  const hintDigits = school.hint?.replace(/\*/g, '') ?? '';
  const department = school.profileHint?.department;

  async function unlink() {
    const ok = await confirm({
      title: '학교 계정 연동을 해제할까요?',
      message:
        '서버에 저장된 암호문과 이 기기의 키가 지워져요. 다시 쓰려면 학교 계정을 새로 연동해야 해요. 이미 가져온 시간표 일정은 그대로 남아요.',
      tone: 'danger',
      confirmLabel: '연동 해제하기',
      cancelLabel: '돌아가기',
      run: () => school.unlink(),
    });
    if (ok) toast('학교 계정 연동을 해제했어요.');
  }

  /** 다른 시트에서 "다시 연동하기"를 눌렀을 때: 그 시트를 닫고 연동 시트를 연다 */
  function relink() {
    setTimetableOpen(false);
    setReservationsOpen(false);
    setLinkOpen(true);
  }

  function importNow() {
    setLinkOpen(false);
    setTimetableOpen(true);
  }

  return (
    <section className="section" aria-labelledby="school-card-title">
      <div className="section__head">
        <h2 className="section__title" id="school-card-title">
          학교 계정
        </h2>
      </div>

      <div className="card">
        {school.loading ? (
          <LoadingBlock>학교 연동 상태를 불러오는 중이에요.</LoadingBlock>
        ) : school.error && !school.linked ? (
          <Alert
            tone="danger"
            title="학교 연동 상태를 불러오지 못했어요."
            actions={
              <Button variant="secondary" size="sm" onClick={() => void school.refresh()}>
                다시 불러오기
              </Button>
            }
          >
            {school.error}
          </Alert>
        ) : !school.linked ? (
          <>
            <div className="school-card__head">
              <h3 className="card__title">연동 상태</h3>
              <Badge tone="gray">연동 안 됨</Badge>
            </div>
            <p className="school-card__lead">
              학교 계정을 연동하면 시간표를 가져오고 시설을 학교에 바로 신청할 수 있어요.
            </p>
            <div className="school-card__actions">
              <Button variant="secondary" size="sm" onClick={() => setLinkOpen(true)}>
                다시 연동
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="school-card__who">
              <p className="school-card__id">
                <span className="school-card__num" aria-hidden="true">
                  {school.hint}
                </span>
                <span className="sr-only">학번 끝 3자리 {hintDigits}</span>
                {department ? <span className="school-card__dept">{department}</span> : null}
              </p>
              {school.canUse ? <Badge tone="success">연동됨</Badge> : <Badge tone="warning">이 기기에서는 쓸 수 없음</Badge>}
            </div>
            {linkedDate && <p className="school-card__date">연동한 날 {linkedDate}</p>}

            {school.canUse ? (
              // 시간표 가져오기 : 예약 보기 : 연동 해제 = 4 : 4 : 2 (연동 해제는 조금 띄어서)
              <div className="school-card__row">
                <div className="school-card__split" role="group" aria-label="학교 계정 바로가기">
                  <button type="button" className="school-card__split-btn" onClick={() => setTimetableOpen(true)}>
                    <Icon name="calendar" className="btn__icon" />
                    시간표 가져오기
                  </button>
                  <button type="button" className="school-card__split-btn" onClick={() => setReservationsOpen(true)}>
                    <Icon name="pin" className="btn__icon" />
                    예약 보기
                  </button>
                </div>
                <button type="button" className="school-card__unlink" onClick={() => void unlink()}>
                  연동 해제
                </button>
              </div>
            ) : (
              <div className="school-card__warn">
                <Alert tone="warning">
                  이 기기에는 학교 계정을 풀 열쇠가 없거나 옛 방식으로 연동돼 있어요. 로그아웃한 뒤 다시 로그인하면 이 기기에서도 쓸 수 있어요. 그래도 안 되면 다시 연동해 주세요.
                </Alert>
              </div>
            )}

            {/* 이 기기에서 풀 수 없을 때만 아래 줄에 다시 연동·연동 해제를 둔다(복구 수단). 평소의 연동 해제는 위 줄에 있다 */}
            {!school.canUse && (
              <div className="school-card__actions">
                <Button variant="secondary" size="sm" onClick={() => setLinkOpen(true)}>
                  다시 연동
                </Button>
                <Button variant="danger" size="sm" onClick={() => void unlink()}>
                  연동 해제
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <SchoolLinkSheet
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onImportRequested={importNow}
      />
      <SchoolTimetableSheet
        open={timetableOpen}
        onClose={() => setTimetableOpen(false)}
        onRelink={relink}
        viewAction={{ label: '시간표 보기', onClick: () => navigate('/timetable') }}
      />
      <SchoolReservationsSheet open={reservationsOpen} onClose={() => setReservationsOpen(false)} onRelink={relink} />
    </section>
  );
}
