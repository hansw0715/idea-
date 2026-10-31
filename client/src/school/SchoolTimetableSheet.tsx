import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SchoolClass, TimetableImportResult, TimetablePreview } from '../../../shared/school/types';
import { Alert, Button, EmptyState, Sheet, useToast } from '../ui';
import { schoolApi } from './api';
import { DAY_LABELS } from './format';
import { SchoolErrorAlert, SchoolFoot, SchoolWaiting, useCloseGuard, useOpenSession } from './SchoolParts';
import { useSchool } from './SchoolContext';

export interface SchoolTimetableSheetProps {
  open: boolean;
  onClose: () => void;
  /** 가져오기가 끝난 직후 (시간표 목록을 새로고침하는 데 쓴다) */
  onImported?: (result: TimetableImportResult) => void;
  /** "다시 연동하기" — 저장된 계정 정보로 진행할 수 없을 때 (이 안에서 시트를 닫고 연동 시트를 연다) */
  onRelink?: () => void;
  /** 완료 토스트에 붙일 행동 (예: 내 정보에서 가져왔다면 "시간표 보기") */
  viewAction?: { label: string; onClick: () => void };
}

type Phase = 'loading' | 'ready' | 'importing';

/** 요일(월~금) 순서로 묶고, 같은 요일 안에서는 시작 시각 순으로 */
function groupByDay(classes: SchoolClass[]): { day: number; items: SchoolClass[] }[] {
  const groups = new Map<number, SchoolClass[]>();
  for (const c of [...classes].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))) {
    groups.set(c.day, [...(groups.get(c.day) ?? []), c]);
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }));
}

/**
 * 학교 시간표 미리보기 → 가져오기. 시트를 열면(= 사용자가 "학교 시간표 가져오기"를 누르면) 학교에서 한 번 읽어 와 보여 주고,
 * "가져오기"를 눌러야 시간표에 넣는다. 열 때마다 처음부터 시작한다.
 */
export default function SchoolTimetableSheet(props: SchoolTimetableSheetProps) {
  const session = useOpenSession(props.open);
  return <TimetableSheetBody key={session} {...props} />;
}

function TimetableSheetBody({ open, onClose, onImported, onRelink, viewAction }: SchoolTimetableSheetProps) {
  const { withCredentials } = useSchool();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<TimetablePreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  // 열리자마자 한 번만 읽는다. 개발 모드(StrictMode)의 이중 실행이나 다시 그리기로 학교에 두 번 요청하지 않게 막는다.
  const started = useRef(false);

  const loadPreview = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      setPreview(await withCredentials((creds) => schoolApi.timetablePreview(creds)));
    } catch (err) {
      setError(err);
    } finally {
      setPhase('ready');
    }
  }, [withCredentials]);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void loadPreview();
  }, [open, loadPreview]);

  const busy = phase !== 'ready';
  const { close, overdue } = useCloseGuard(busy, onClose);
  const groups = useMemo(() => (preview ? groupByDay(preview.classes) : []), [preview]);

  async function runImport() {
    if (phase !== 'ready' || !preview || preview.classes.length === 0) return;
    setPhase('importing');
    setError(null);
    try {
      // 미리보기에서 이미 받은 수업을 저장만 한다 (학교를 한 번 더 읽지 않는다)
      const result = await schoolApi.timetableSave(preview.classes);
      toast(
        result.imported > 0
          ? `${result.imported}개 수업을 가져왔어요.`
          : '가져올 수업이 없어서 기존 일정은 그대로 두었어요.',
        viewAction ? { action: viewAction } : undefined,
      );
      onImported?.(result);
      onClose();
    } catch (err) {
      // 미리보기는 그대로 두고 오류만 알린다. 다시 가져오려면 사용자가 직접 한 번 더 누른다
      setError(err);
      setPhase('ready');
    }
  }

  const hasClasses = preview !== null && preview.classes.length > 0;

  return (
    <Sheet
      open={open}
      onClose={close}
      title="학교 시간표 가져오기"
      footer={
        <SchoolFoot>
          {hasClasses ? (
            <>
              <Button onClick={() => void runImport()} loading={phase === 'importing'} disabled={phase === 'loading'}>
                {phase === 'importing' ? '가져오는 중…' : '가져오기'}
              </Button>
              <Button variant="tertiary" onClick={close} disabled={busy && !overdue}>
                취소
              </Button>
            </>
          ) : (
            <Button variant="tertiary" onClick={close} disabled={busy && !overdue}>
              닫기
            </Button>
          )}
        </SchoolFoot>
      }
    >
      {phase === 'loading' && !preview && !error && <SchoolWaiting label="학교에서 시간표를 불러오는 중…" overdue={overdue} />}

      {/* 가져오는 동안은 버튼의 '가져오는 중…'만 보인다 (미리보기를 가리지 않는다) */}
      {error !== null && (
        <div className="school-alert">
          <SchoolErrorAlert
            error={error}
            title={preview ? '시간표를 가져오지 못했어요.' : '시간표를 불러오지 못했어요.'}
            onRelink={onRelink}
            onRetry={preview ? undefined : () => void loadPreview()}
          >
            {preview && <p>미리보기는 그대로 두었어요. 문제를 확인한 뒤 가져오기를 다시 눌러 주세요.</p>}
          </SchoolErrorAlert>
        </div>
      )}

      {preview && !hasClasses && (
        <EmptyState
          icon="calendar"
          title="가져올 수업이 없어요."
          description="학교 시간표에 아직 수업이 올라오지 않았을 수 있어요. 이미 가져온 일정은 그대로 두고, 직접 입력한 일정도 건드리지 않아요."
        />
      )}

      {preview && hasClasses && (
        <>
          <div className="school-alert">
            <Alert tone="info" title="가져오면 이렇게 바뀌어요">
              <p>학교에서 가져왔던 기존 일정은 새 일정으로 바뀌고, 직접 입력한 일정은 그대로예요.</p>
            </Alert>
          </div>

          {(preview.adjusted > 0 || preview.skipped.length > 0) && (
            <div className="school-notes">
              {preview.adjusted > 0 && (
                <Alert tone="info" title={`수업 ${preview.adjusted}개의 시간을 조금 맞췄어요`}>
                  <p>시간표가 30분 단위라서, 시작은 앞 칸으로 끝은 뒤 칸으로 맞춰 넣어요.</p>
                </Alert>
              )}
              {preview.skipped.length > 0 && (
                <Alert tone="warning" title={`${preview.skipped.length}개는 가져오지 않아요`}>
                  <ul className="school-notes__list">
                    {preview.skipped.map((s, i) => (
                      <li key={`${s.subject}-${i}`}>
                        {s.subject}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          )}

          <div className="school-summary">
            <p className="school-summary__who">
              {[preview.profile.name.trim(), preview.profile.department].filter(Boolean).join(' · ')}
            </p>
            <p className="school-summary__count">수업 {preview.classes.length}개</p>
          </div>

          {groups.map((g) => (
            <section key={g.day} className="school-day" aria-labelledby={`school-day-${g.day}`}>
              <h3 className="school-day__title" id={`school-day-${g.day}`}>
                {DAY_LABELS[g.day] ?? `${g.day}`}
              </h3>
              <ul>
                {g.items.map((c, i) => (
                  <li key={`${c.start}-${c.subject}-${i}`} className="school-class">
                    <p className="school-class__time">
                      {c.start}~{c.end}
                    </p>
                    <p className="school-class__name">{c.subject}</p>
                    <p className="school-class__meta">
                      {[c.room, c.professor, c.section ? `${c.section}${c.section.includes('분반') ? '' : '분반'}` : '']
                        .filter(Boolean)
                        .join(' · ') || '강의실·교수 정보가 없어요'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </Sheet>
  );
}
