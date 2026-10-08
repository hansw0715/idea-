import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MyReservationsResult, SchoolReservation } from '../../../shared/school/types';
import { Alert, Badge, Button, EmptyState, Sheet } from '../ui';
import { schoolApi } from './api';
import { statusTone, systemLabel } from './format';
import { SchoolErrorAlert, SchoolFoot, SchoolWaiting, useCloseGuard, useOpenSession } from './SchoolParts';
import { useSchool } from './SchoolContext';

export interface SchoolReservationsSheetProps {
  open: boolean;
  onClose: () => void;
  /** "다시 연동하기" — 저장된 계정 정보로 진행할 수 없을 때 */
  onRelink?: () => void;
}

/** 시스템(시설 종류)별로 묶는다. 처음 나온 순서를 지킨다 */
function groupBySystem(reservations: SchoolReservation[]): { key: string; label: string; items: SchoolReservation[] }[] {
  const groups = new Map<string, { key: string; label: string; items: SchoolReservation[] }>();
  for (const r of reservations) {
    const group = groups.get(r.facility) ?? { key: r.facility, label: r.facilityLabel || systemLabel(r.facility), items: [] };
    group.items.push(r);
    groups.set(r.facility, group);
  }
  return [...groups.values()];
}

/** 내 학교 예약: 학교 예약 시스템(상상파크·상상베이스 등)에 접수된 내 신청내역을 시스템별로 보여 준다 */
export default function SchoolReservationsSheet(props: SchoolReservationsSheetProps) {
  const session = useOpenSession(props.open);
  return <ReservationsSheetBody key={session} {...props} />;
}

function ReservationsSheetBody({ open, onClose, onRelink }: SchoolReservationsSheetProps) {
  const { withCredentials } = useSchool();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<MyReservationsResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await withCredentials((creds) => schoolApi.reservations(creds)));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [withCredentials]);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void load();
  }, [open, load]);

  const { close, overdue } = useCloseGuard(loading, onClose);
  const groups = useMemo(() => (result ? groupBySystem(result.reservations) : []), [result]);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="내 학교 예약"
      footer={
        <SchoolFoot>
          <Button variant="tertiary" onClick={close} disabled={loading && !overdue}>
            닫기
          </Button>
        </SchoolFoot>
      }
    >
      {loading && <SchoolWaiting label="학교에서 내 신청내역을 불러오는 중…" overdue={overdue} />}

      {error !== null && (
        <div className="school-alert">
          <SchoolErrorAlert
            error={error}
            title="내 학교 예약을 불러오지 못했어요."
            onRelink={onRelink}
            onRetry={() => void load()}
          />
        </div>
      )}

      {result && result.failed.length > 0 && (
        <div className="school-alert">
          <Alert tone="warning" title="일부 예약 시스템은 불러오지 못했어요">
            <ul className="school-notes__list">
              {result.failed.map((f) => (
                <li key={f.facility}>
                  {systemLabel(f.facility)}: {f.reason}
                </li>
              ))}
            </ul>
            <p>이 시스템의 신청내역은 학교 사이트에서 직접 확인해 주세요.</p>
          </Alert>
        </div>
      )}

      {result && result.reservations.length === 0 && (
        <EmptyState
          icon="pin"
          title={result.failed.length > 0 ? '불러온 시스템에는 신청내역이 없어요.' : '학교에 접수된 신청내역이 없어요.'}
          description="회의 화면의 예약 현황에서 '학교에 바로 신청하기'를 누르면 이곳에 나타나요."
        />
      )}

      {groups.map((g) => (
        <section key={g.key} className="school-group" aria-labelledby={`school-group-${g.key.replace(/\W/g, '-')}`}>
          <h3 className="school-group__title" id={`school-group-${g.key.replace(/\W/g, '-')}`}>
            {g.label}
          </h3>
          <ul>
            {g.items.map((r, i) => (
              <li key={`${r.no}-${i}`} className="school-res">
                <div className="school-res__head">
                  <p className="school-res__title">{r.space || g.label}</p>
                  <Badge tone={statusTone(r.status)}>{r.status || '상태 정보 없음'}</Badge>
                </div>
                <p className="school-res__meta">
                  {[r.date, r.time].filter(Boolean).join(' ') || '날짜·시간 정보가 없어요'}
                </p>
                <p className="school-res__meta">
                  {[r.no ? `신청번호 ${r.no}` : '', r.applied ? `신청일 ${r.applied}` : ''].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
