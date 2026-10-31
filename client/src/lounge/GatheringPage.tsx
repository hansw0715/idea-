import { useLocation, useNavigate, useParams } from 'react-router-dom';
import TableSheet from './sheets/TableSheet';

export default function GatheringPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const asked = (state as { backTo?: string } | null)?.backTo;
  // 돌아갈 수 있는 곳만 받는다: 미팅 목록, 캠퍼스 라운지(메타버스). 그 밖은 라운지 첫 화면
  const backTo = asked === '/lounge/meetup' || asked === '/lounge/campus' ? asked : '/lounge';
  return <TableSheet key={id} open presentation="page" gatheringId={id ?? null} onClose={() => navigate(backTo)} />;
}
