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
              학교 계정을 연동하면 학교 시간표를 가져오고, 회의에서 잡은 시설을 학교에 바로 신청할 수 있어요.
            </p>
            <p className="school-card__lead">
              저장되는 건 암호문뿐이고, 풀 수 있는 키는 이 기기에만 있어요.
            </p>
            <div className="school-card__actions">
              <Button variant="secondary" onClick={() => setLinkOpen(true)}>
                학교 계정 연동하기
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="school-card__head">
              <h3 className="card__title">연동 상태</h3>
              {school.canUse ? <Badge tone="success">연동됨</Badge> : <Badge tone="warning">이 기기에서는 쓸 수 없음</Badge>}
            </div>

            <dl className="school-info">
              <div className="school-info__row">
                <dt className="school-info__key">학번</dt>
                <dd className="school-info__val">
                  <span aria-hidden="true">{school.hint}</span>
                  <span className="sr-only">끝 3자리 {hintDigits}</span>
                </dd>
              </div>
              {department ? (
                <div className="school-info__row">
                  <dt className="school-info__key">소속</dt>
                  <dd className="school-info__val">{department}</dd>
                </div>
              ) : null}
              {linkedDate && (
                <div className="school-info__row">
                  <dt className="school-info__key">연동한 날</dt>
                  <dd className="school-info__val">{linkedDate}</dd>
                </div>
              )}
            </dl>

            {school.canUse ? (
              <div className="list school-card__menu">
                <button type="button" className="list__item list__item--link" onClick={() => setTimetableOpen(true)}>
                  <Icon name="calendar" className="school-card__icon" />
                  <span className="list__body">
                    <span className="list__main">학교 시간표 가져오기</span>
                    <span className="list__sub">학교 개인시간표를 미리 보고 내 시간표에 넣어요.</span>
                  </span>
                  <Icon name="chevron-right" className="list__chev" />
                </button>
                <button type="button" className="list__item list__item--link" onClick={() => setReservationsOpen(true)}>
                  <Icon name="pin" className="school-card__icon" />
                  <span className="list__body">
                    <span className="list__main">내 학교 예약 보기</span>
                    <span className="list__sub">학교 예약 시스템에 접수된 내 신청내역이에요.</span>
                  </span>
                  <Icon name="chevron-right" className="list__chev" />
                </button>
              </div>
            ) : (
              <div className="school-card__warn">
                <Alert tone="warning">
                  이 기기에는 학교 계정을 풀 열쇠가 없거나 옛 방식으로 연동돼 있어요. 로그아웃한 뒤 다시 로그인하면 이 기기에서도 쓸 수 있어요. 그래도 안 되면 다시 연동해 주세요.
                </Alert>
              </div>
            )}

            <div className="school-card__actions">
              <Button variant={school.canUse ? 'tertiary' : 'secondary'} onClick={() => setLinkOpen(true)}>
                다시 연동
              </Button>
              <Button variant="danger" onClick={() => void unlink()}>
                연동 해제
              </Button>
            </div>
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
