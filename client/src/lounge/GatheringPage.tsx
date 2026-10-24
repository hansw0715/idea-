import { useLocation, useNavigate, useParams } from 'react-router-dom';
import TableSheet from './sheets/TableSheet';

export default function GatheringPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const backTo = (state as { backTo?: string } | null)?.backTo === '/lounge/meetup' ? '/lounge/meetup' : '/lounge';
  return <TableSheet key={id} open presentation="page" gatheringId={id ?? null} onClose={() => navigate(backTo)} />;
}
