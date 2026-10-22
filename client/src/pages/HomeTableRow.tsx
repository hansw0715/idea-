import { Link } from 'react-router-dom';

interface HomeTableRowProps {
  to: string;
  state?: unknown;
  /** 왼쪽 굵은 이름 */
  label: string;
  /** 가운데 흐린 한 줄 — 가장 가까운 항목 */
  preview: string;
  /** 오른쪽 동그라미 숫자. 0 이면 그리지 않는다 */
  count?: number;
  /** 동그라미 숫자를 화면 읽기로 읽어 줄 문장 */
  countLabel?: string;
}

/** 홈 표 한 줄: 굵은 이름 · 흐린 미리보기 · 오른쪽 동그라미 개수. 스타일은 home.css (home-table) */
export function HomeTableRow({ to, state, label, preview, count = 0, countLabel }: HomeTableRowProps) {
  return (
    <li>
      <Link to={to} state={state} className="home-table__row">
        <span className="home-table__label">{label}</span>
        <span className="home-table__preview">{preview}</span>
        {count > 0 && (
          <span className="home-table__count" aria-label={countLabel ?? `${count}건`}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    </li>
  );
}
