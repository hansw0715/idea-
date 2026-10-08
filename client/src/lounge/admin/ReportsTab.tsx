import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_RESTRICT_REPORTS, WARNINGS_TO_BAN, formatMeetAt } from '../../../../shared/lounge';
import type { ReportAction, ReportView } from '../../../../shared/lounge';
import { Alert, Badge, Button, EmptyState, LoadingBlock, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';
import { TemperatureBadge } from '../parts/Avatar';

/**
 * 관리자 > 신고: 들어온 신고를 보고 조치 완료 · 반려 · 이용 정지 · 정지 해제로 처리한다.
 * 서버는 닉네임·온도·경고·정지 여부만 내려 준다(실명·이메일·학과 없음). 규칙: docs/lounge/01-contract.md §6.
 */

type Filter = 'open' | 'all';

/** 신고가 접수된 곳(서버가 문자열로 저장) → 화면 문구 */
const CONTEXT_LABEL: Record<string, string> = {
  meetup: '미팅',
  meal: '밥약',
  chat: '채팅',
  profile: '프로필',
};

const ACTION_LABEL: Record<ReportAction, string> = {
  resolve: '조치 완료',
  dismiss: '반려',
  ban: '이용 정지',
  unban: '정지 해제',
};

const DONE_TOAST: Record<ReportAction, string> = {
  resolve: '조치 완료로 처리했어요.',
  dismiss: '신고를 반려했어요.',
  ban: '이용을 정지했어요.',
  unban: '정지를 풀었어요.',
};

const ACTION_VARIANT = {
  ban: 'danger',
  resolve: 'secondary',
  dismiss: 'tertiary',
  unban: 'tertiary',
} as const;

/** 동작마다 되돌릴 수 있는지·무슨 일이 생기는지를 문장으로 적는다 */
function confirmCopy(action: ReportAction, r: ReportView) {
  const who = `'${r.target.nickname}'님`;
  switch (action) {
    case 'resolve':
      return {
        title: '조치 완료로 처리할까요?',
        message: `${who}에 대한 이 신고를 조치 완료로 닫아요. 이용 정지와 경고는 그대로예요.`,
      };
    case 'dismiss':
      return {
        title: '신고를 반려할까요?',
        message: `신고 내용이 맞지 않다고 보고 이 신고만 닫아요. ${who}에게는 아무 일도 생기지 않고, 같은 사람에 대한 다른 신고는 그대로 남아요.`,
      };
    case 'ban':
      return {
        title: '이용을 정지할까요?',
        message: `${who}은 모임을 만들거나 참여할 수 없게 되고, 이 신고는 조치 완료로 닫혀요. 나중에 정지 해제로 되돌릴 수 있어요.`,
        tone: 'danger' as const,
      };
    case 'unban':
      return {
        title: '정지를 풀까요?',
        message: `${who}의 노쇼 경고가 0이 되고 이용 정지가 풀려요. ${
          r.openCountForTarget > 0 ? `이 사람에 대한 열린 신고 ${r.openCountForTarget}건도 모두 정리돼요(반려 처리). ` : ''
        }매너온도는 그대로예요.`,
      };
  }
}

/** 이 신고에서 누를 수 있는 동작. 이미 정지된 사람에게 다시 정지를 누를 일은 없으므로 정지 해제로 바뀐다. */
function actionsFor(r: ReportView): ReportAction[] {
  const list: ReportAction[] = [];
  if (r.status === 'open') {
    if (!r.target.banned) list.push('ban');
    list.push('resolve', 'dismiss');
  }
  if (r.target.banned) list.push('unban');
  return list;
}

export default function ReportsTab() {
  const confirm = useConfirm();
  const toast = useToast();
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  /** 오래 걸린 이전 요청의 응답이 나중 응답을 덮어쓰지 않게 요청 번호를 센다 */
  const seq = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (keepList: boolean): Promise<boolean> => {
    const mine = ++seq.current;
    setError(null);
    if (keepList) setRefreshing(true);
    else setReports(null);
    try {
      const list = await loungeApi.adminReports();
      if (mine === seq.current) setReports(list);
      return true;
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : '신고 목록을 불러오지 못했어요.');
      return false;
    } finally {
      if (mine === seq.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  async function handle(action: ReportAction, r: ReportView) {
    const copy = confirmCopy(action, r);
    const done = await confirm({
      ...copy,
      confirmLabel: ACTION_LABEL[action],
      // 응답이 올 때까지 다이얼로그를 유지하고, 실패하면 그 안에서 이유를 보여 준다
      run: async () => {
        await loungeApi.adminHandleReport(r.id, action);
      },
    });
    if (!done) return;
    toast(DONE_TOAST[action]);
    await load(true);
    // 처리한 카드가 목록에서 사라지면 포커스가 갈 곳을 잃으므로 목록 머리로 옮긴다
    headingRef.current?.focus({ preventScroll: true });
  }

  const openCount = reports?.filter((r) => r.status === 'open').length ?? 0;
  const shown = reports ? (filter === 'open' ? reports.filter((r) => r.status === 'open') : reports) : [];

  return (
    <div aria-busy={refreshing || reports === null ? true : undefined}>
      <h2 className="sr-only" tabIndex={-1} ref={headingRef}>
        신고 목록
      </h2>

      <div className="lounge-admin-toolbar">
        <p className="lounge-admin-toolbar__text">
          서로 다른 {AUTO_RESTRICT_REPORTS}명이 신고하면 관리자가 확인할 때까지 이용이 자동으로 정지돼요.
        </p>
        <Button variant="text" onClick={() => void load(reports !== null)} disabled={refreshing}>
          {refreshing ? '불러오는 중…' : '새로 고치기'}
        </Button>
      </div>

      {error && (
        <div className="lounge-admin-filter">
          <Alert
            tone="danger"
            title={reports ? '신고 목록을 새로 불러오지 못했어요.' : '신고 목록을 불러오지 못했어요.'}
            actions={
              <Button variant="secondary" onClick={() => void load(reports !== null)}>
                다시 시도하기
              </Button>
            }
          >
            {error}
            {reports && ' 지금 보이는 목록은 이전에 받은 것이라 달라졌을 수 있어요.'}
          </Alert>
        </div>
      )}

      {reports === null && !error && (
        <div className="card">
          <LoadingBlock>신고 목록을 불러오는 중이에요.</LoadingBlock>
        </div>
      )}

      {reports && (
        <>
          <div className="tag-group lounge-admin-filter" role="group" aria-label="신고 보기">
            <button type="button" className="tag" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>
              처리 대기 {openCount}
            </button>
            <button type="button" className="tag" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              전체 {reports.length}
            </button>
          </div>

          {shown.length === 0 ? (
            <div className="card">
              {reports.length === 0 ? (
                <EmptyState
                  icon="check-circle"
                  title="아직 접수된 신고가 없어요."
                  description="학우가 신고하면 이곳에 모여요. 새로 고치기로 다시 확인할 수 있어요."
                />
              ) : (
                <EmptyState
                  icon="check-circle"
                  title="처리할 신고가 없어요."
                  description={`전체 ${reports.length}건은 모두 처리를 마쳤어요. 지난 신고는 전체에서 볼 수 있어요.`}
                  action={
                    <Button variant="secondary" onClick={() => setFilter('all')}>
                      전체 신고 보기
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <ul className="lounge-admin-list">
              {shown.map((r) => (
                <li key={r.id}>
                  <ReportCard report={r} onAction={handle} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ReportCard({ report: r, onAction }: { report: ReportView; onAction: (a: ReportAction, r: ReportView) => void }) {
  const actions = actionsFor(r);
  const reachedLimit = r.openCountForTarget >= AUTO_RESTRICT_REPORTS;
  return (
    <article className="card lounge-admin-report">
      <h3 className="sr-only">
        {r.target.nickname}님에 대한 신고, {r.reason}
      </h3>

      <div className="lounge-admin-report__head">
        <div className="lounge-admin-report__badges">
          <Badge tone="danger">{r.reason}</Badge>
          <Badge tone="gray">{CONTEXT_LABEL[r.context] ?? '기타'}</Badge>
          {r.status === 'resolved' && <Badge tone="success">조치함</Badge>}
          {r.status === 'dismissed' && <Badge tone="gray">반려됨</Badge>}
        </div>
        <time className="lounge-admin-report__time tabular" dateTime={r.createdAt}>
          신고 {formatMeetAt(r.createdAt)}
          {r.handledAt && ` · 처리 ${formatMeetAt(r.handledAt)}`}
        </time>
      </div>

      <p className={`lounge-admin-report__detail${r.detail ? '' : ' lounge-admin-report__detail--empty'}`}>
        {r.detail || '자세한 내용을 적지 않았어요.'}
      </p>

      <p className="lounge-admin-report__who">
        <strong>{r.reporter.nickname}</strong>님이 <strong>{r.target.nickname}</strong>님을 신고했어요.
      </p>

      <dl className="lounge-admin-target">
        <div className="lounge-admin-target__item">
          <dt className="lounge-admin-target__key">신고 대상 매너온도</dt>
          <dd className="lounge-admin-target__val">
            <TemperatureBadge value={r.target.temperature} />
          </dd>
        </div>
        <div className="lounge-admin-target__item">
          <dt className="lounge-admin-target__key">이용 상태</dt>
          <dd className="lounge-admin-target__val">
            {r.target.banned ? <Badge tone="danger">이용 정지</Badge> : <Badge tone="success">정상</Badge>}
          </dd>
        </div>
      </dl>

      <p className="lounge-admin-report__open">
        <span>
          이 사람에 대한 열린 신고 <strong className="tabular">{r.openCountForTarget}건</strong>
        </span>
        {reachedLimit && <Badge tone="danger">자동 정지 기준 {AUTO_RESTRICT_REPORTS}명 이상</Badge>}
      </p>

      {actions.length > 0 && (
        <div className="lounge-admin-actions">
          {actions.map((a) => (
            <Button
              key={a}
              variant={ACTION_VARIANT[a]}
              aria-label={`${ACTION_LABEL[a]}: ${r.target.nickname}님에 대한 신고`}
              onClick={() => onAction(a, r)}
            >
              {ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
