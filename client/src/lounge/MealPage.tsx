import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, LoadingBlock } from '../ui';
import { useLounge } from './LoungeContext';
import QuickMatchSheet from './sheets/QuickMatchSheet';

export default function MealPage() {
  const navigate = useNavigate();
  const { profile, loading, needsProfile, openProfileSheet } = useLounge();
  if (!loading && !needsProfile && profile) return <QuickMatchSheet open presentation="page" onClose={() => navigate('/lounge')} />;
  return <><AppHeader title="밥약" backTo="/lounge" /><main id="main" className="app-main">
    {loading ? <LoadingBlock>불러오는 중입니다.</LoadingBlock> : <Alert tone="primary" title="학교 계정을 연동하면 밥약에 참여할 수 있어요" actions={<Button onClick={openProfileSheet}>안내 보기</Button>}>학교 계정 연동 정보를 확인해 주세요.</Alert>}
  </main></>;
}
