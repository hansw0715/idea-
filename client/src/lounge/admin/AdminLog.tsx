import type { AdminLogEntry } from '../../../../shared/lounge';
import { EmptyState } from '../../ui';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** 관리 기록 목록: 누가 언제 무엇을 했는지 (대시보드·운영 도구가 함께 쓴다) */
export default function AdminLog({ items }: { items: AdminLogEntry[] }) {
  if (items.length === 0) {
    return (
      <div className="card">
        <EmptyState icon="list" title="아직 관리 기록이 없어요." description="관리자 탭에서 한 조치가 여기에 쌓여요." />
      </div>
    );
  }
  return (
    <ul className="card list lounge-admin-log">
      {items.map((e) => (
        <li key={e.id} className="lounge-admin-log__row">
          <span className="lounge-admin-log__at tabular">{fmt(e.at)}</span>
          <span className="lounge-admin-log__body">
            <strong>{e.action}</strong>
            {e.target && <span> · {e.target}</span>}
            {e.detail && <span className="lounge-admin-log__detail">{e.detail}</span>}
          </span>
          <span className="lounge-admin-log__who">{e.admin}</span>
        </li>
      ))}
    </ul>
  );
}
