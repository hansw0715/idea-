import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Button, EmptyState, Icon, LoadingBlock, Sheet, TextField, useToast } from '../ui';
import type { Meeting } from '../types';
import './meetings.css';
import { StaggerList, StaggerItem } from '../ui/motion';

type SheetKind = 'create' | 'join';

const NAME_MAX = 30;
const CODE_LENGTH = 4;
const SHEET_CLOSE_MS = 450;

const CREATE_NAME_ID = 'meet-create-name';
const JOIN_CODE_ID = 'meet-join-code';

type JoinResult = Meeting & { alreadyMember?: boolean; isOwner?: boolean };

/** 서버가 만드는 회의 코드에 쓰이는 글자(server/meetings.ts 의 CODE_CHARS)와 같게 맞춘다. 지금은 숫자뿐이다. */
const CODE_INVALID_CHARS = /[^0-9]/g;

/**
 * 입력·붙여넣기 값을 코드 모양으로 정리한다.
 * 메신저에서 복사한 "9 6 3 9", "96-39" 처럼 공백·하이픈이 섞여도 받아야 하므로
 * (입력칸의 maxLength 속성은 정리 전의 글자 수로 값을 잘라 버린다) 길이는 여기서 제한한다.
 * 순서: 전각→반각 → 공백·하이픈 제거 → 대문자 → 허용 글자만 → 길이 제한.
 */
function sanitizeCode(value: string): string {
  return value
    .normalize('NFKC') // 전각 숫자(１２３４)와 전각 공백·하이픈을 반각으로
    .replace(/[\s‐-―−-]/g, '') // 줄바꿈 포함 공백, 하이픈·여러 가지 대시, 빼기 기호
    .toUpperCase()
    .replace(CODE_INVALID_CHARS, '')
    .slice(0, CODE_LENGTH);
}

function focusLater(id: string) {
  window.setTimeout(() => document.getElementById(id)?.focus(), 0);
}

export default function Meetings() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuth();

  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<{ text: string; meetingId: number } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api
      .get<Meeting[]>('/meetings')
      .then((list) => {
        if (!cancelled) setMeetings(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const resetForms = useCallback(() => {
    setName('');
    setNameError(null);
    setCreateError(null);
    setCode('');
    setCodeError(null);
    setJoinError(null);
    setJoinNotice(null);
  }, []);

  const openSheet = useCallback(
    (kind: SheetKind) => {
      resetForms();
      setSheet(kind);
    },
    [resetForms],
  );

  // 시트가 닫히면 입력과 오류를 비운다. (닫히는 400ms 동안은 내용을 그대로 두어 화면이 튀지 않게 한다)
  useEffect(() => {
    if (sheet !== null) return;
    const t = window.setTimeout(resetForms, SHEET_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [sheet, resetForms]);

  function closeSheet() {
    // 요청을 보내는 동안에는 닫지 않는다. (응답이 와야 이동·오류 표시가 맞는다)
    if (pending) return;
    setSheet(null);
  }

  // 홈의 빈 상태에서 "회의 만들기"·"코드로 참가하기"로 들어오면 해당 시트를 바로 연다.
  useEffect(() => {
    const requested = (location.state as { sheet?: string } | null)?.sheet;
    if (requested === 'create' || requested === 'join') {
      openSheet(requested);
      navigate(location.pathname, { replace: true, state: null });
    }
    // 처음 한 번만 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createMeeting(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setNameError('회의 이름이 비어 있습니다. 팀원이 알아볼 이름을 입력해 주세요.');
      focusLater(CREATE_NAME_ID);
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(`회의 이름이 너무 깁니다. ${NAME_MAX}자 이하로 줄여 주세요.`);
      focusLater(CREATE_NAME_ID);
      return;
    }
    setNameError(null);
    setCreateError(null);
    setPending(true);
    try {
      const meeting = await api.post<Meeting>('/meetings', { name: trimmed });
      toast('회의를 만들었습니다.');
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '회의를 만들지 못했습니다.');
      focusLater(CREATE_NAME_ID);
    } finally {
      setPending(false);
    }
  }

  async function joinMeeting(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (code.length !== CODE_LENGTH) {
      setCodeError('회의 코드가 4자리가 아닙니다. 방장에게 받은 숫자 4자리를 입력해 주세요.');
      focusLater(JOIN_CODE_ID);
      return;
    }
    setCodeError(null);
    setJoinError(null);
    setJoinNotice(null);
    setPending(true);
    try {
      const meeting = await api.post<JoinResult>('/meetings/join', { code });
      if (meeting.alreadyMember) {
        setJoinNotice({
          text: `${user?.name}님은 이미 '${meeting.name}'의 ${
            meeting.isOwner ? '방장입니다' : '멤버입니다'
          }. 다른 팀원이 참가하려면 그 사람의 계정으로 로그인한 뒤 코드를 입력해야 합니다.`,
          meetingId: meeting.id,
        });
        return;
      }
      toast('회의에 참가했습니다.');
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : '회의에 참가하지 못했습니다.');
      focusLater(JOIN_CODE_ID);
    } finally {
      setPending(false);
    }
  }

  const total = meetings?.length ?? 0;

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main meetings-page">
        <div className="page-head">
          <p className="eyebrow">함께 맞추는 일정</p>
          <h1 className="page-title">우리의 회의</h1>
          <p className="page-lead">회의를 만들어 코드를 공유하거나, 받은 코드로 참가해 보세요.</p>
        </div>

        <div className="meet-actions">
          <Button variant="primary" onClick={() => openSheet('create')}>
            회의 만들기
          </Button>
          <Button variant="secondary" onClick={() => openSheet('join')}>
            코드로 참가하기
          </Button>
        </div>

        <section className="section" aria-labelledby="meet-list-title">
          <div className="section__head">
            <h2 className="section__title" id="meet-list-title">
              내 회의 목록
            </h2>
            {meetings && meetings.length > 0 && <span className="text-sub text-sm tabular">총 {total}개</span>}
          </div>

          {loadError ? (
            <Alert
              tone="danger"
              title="회의 목록을 불러오지 못했습니다."
              actions={
                <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                  다시 시도하기
                </Button>
              }
            >
              {loadError}
            </Alert>
          ) : meetings === null ? (
            <div className="card">
              <LoadingBlock>회의 목록을 불러오는 중입니다.</LoadingBlock>
            </div>
          ) : meetings.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="users"
                title="아직 참여 중인 회의가 없습니다."
                description="회의를 만들면 4자리 코드가 생기고, 팀원은 그 코드로 참가할 수 있습니다."
                action={
                  <Button variant="secondary" onClick={() => openSheet('create')}>
                    회의 만들기
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="meet-card--rows">
              <StaggerList className="list meet-ul">
                {meetings.map((m) => (
                  <StaggerItem key={m.id}>
                    <Link to={`/meetings/${m.id}`} className="list__item list__item--link">
                      <div className="list__body">
                        <div className="list__main">{m.name}</div>
                        {typeof m.memberCount === 'number' && (
                          <div className="list__sub">멤버 {m.memberCount}명</div>
                        )}
                      </div>
                      <span className="badge badge--gray code-chip">
                        <span className="sr-only">회의 코드 </span>
                        {m.code}
                      </span>
                      <Icon name="chevron-right" className="list__chev" />
                    </Link>
                  </StaggerItem>
                ))}
              </StaggerList>
            </div>
          )}
        </section>
      </main>

      {/* 회의 만들기 */}
      <Sheet
        open={sheet === 'create'}
        onClose={closeSheet}
        title="새 회의 만들기"
        initialFocus="input"
        footer={
          <>
            <Button variant="tertiary" onClick={closeSheet} disabled={pending}>
              취소
            </Button>
            <Button type="submit" form="meet-create-form" loading={pending}>
              {pending ? '만드는 중…' : '만들기'}
            </Button>
          </>
        }
      >
        <form id="meet-create-form" onSubmit={createMeeting} noValidate>
          {createError && (
            <div className="meet-alert">
              <Alert tone="danger" title="회의를 만들지 못했습니다.">
                {createError}
              </Alert>
            </div>
          )}
          <TextField
            id={CREATE_NAME_ID}
            label="회의 이름"
            required
            type="text"
            placeholder="예: 캡스톤 디자인 팀"
            autoComplete="off"
            enterKeyHint="done"
            help={`팀원이 회의를 구분할 이름입니다. 1자 이상 ${NAME_MAX}자 이하로 입력해 주세요.`}
            error={nameError}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
          />
        </form>
      </Sheet>

      {/* 코드로 참가하기 */}
      <Sheet
        open={sheet === 'join'}
        onClose={closeSheet}
        title="코드로 참가하기"
        initialFocus="input"
        footer={
          <>
            <Button variant="tertiary" onClick={closeSheet} disabled={pending}>
              취소
            </Button>
            <Button
              type="submit"
              form="meet-join-form"
              loading={pending}
              disabled={code.length !== CODE_LENGTH}
            >
              {pending ? '참가하는 중…' : '참가하기'}
            </Button>
          </>
        }
      >
        <form id="meet-join-form" onSubmit={joinMeeting} noValidate>
          {joinError && (
            <div className="meet-alert">
              <Alert tone="danger" title="회의에 참가하지 못했습니다.">
                {joinError}
              </Alert>
            </div>
          )}
          {joinNotice && (
            <div className="meet-alert">
              <Alert
                tone="info"
                actions={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const id = joinNotice.meetingId;
                      setSheet(null);
                      navigate(`/meetings/${id}`);
                    }}
                  >
                    회의 열기
                  </Button>
                }
              >
                {joinNotice.text}
              </Alert>
            </div>
          )}
          <TextField
            id={JOIN_CODE_ID}
            label="회의 코드"
            required
            size="lg"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="go"
            placeholder="0000"
            className="code-chip meet-code"
            help="방장에게 받은 숫자 4자리를 모두 입력하면 참가할 수 있습니다."
            error={codeError}
            value={code}
            onChange={(e) => {
              setCode(sanitizeCode(e.target.value));
              if (codeError) setCodeError(null);
              if (joinError) setJoinError(null);
              if (joinNotice) setJoinNotice(null);
            }}
          />
        </form>
      </Sheet>
    </>
  );
}
