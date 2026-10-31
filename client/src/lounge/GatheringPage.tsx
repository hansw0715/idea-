import { useLocation, useNavigate, useParams } from 'react-router-dom';
import TableSheet from './sheets/TableSheet';
import { cachedGathering } from './world/useGatherings';

export default function GatheringPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const asked = (state as { backTo?: string } | null)?.backTo;
  // 돌아갈 수 있는 곳만 받는다: 미팅 목록. 그 밖은 라운지(방)
  const backTo = asked === '/lounge/meetup' ? asked : '/lounge';
  // 목록에서 이미 받아 둔 모임이면 그것부터 바로 그리고, 시트가 뒤에서 새로 받는다
  const initial = id ? cachedGathering(id) : null;
  return <TableSheet key={id} open presentation="page" gatheringId={id ?? null} initial={initial} onClose={() => navigate(backTo)} />;
}
