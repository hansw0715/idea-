import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, EmptyState, Icon, LoadingBlock, Tabs, btnClass, useToast } from '../ui';
import { useLounge } from './LoungeContext';
import ReportsTab from './admin/ReportsTab';
import StatsTab from './admin/StatsTab';
import WithdrawnTab from './admin/WithdrawnTab';
import './admin.css';

/**
 * 관리자 화면 (/admin): 신고 처리 · 이용 통계. 관리자(useLounge().isAdmin)만 본다.
 * admin_아이디 로 들어온 관리자 모드 세션(user.adminSession)은 원래 계정과 상관없이 이 화면만 쓴다.
 * 서버도 /api/lounge/admin/* 를 관리자에게만 열어 두므로, 여기서 막는 것은 안내를 위한 것이다.
 * 규칙: docs/lounge/00-overview.md, docs/lounge/01-contract.md §6, docs/UI-KIT.md
 */

type TabKey = 'reports' | 'stats' | 'withdrawn';

const TABS: { value: TabKey; label: string }[] = [
  { value: 'reports', label: '신고' },
  { value: 'stats', label: '통계' },
  { value: 'withdrawn', label: '탈퇴 학번' },
];

const ID_BASE = 'lounge-admin';

export default function AdminPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const lounge = useLounge();
  // 관리자 모드 세션은 라운지 정보를 불러오지 않고 세션만으로 관리자로 본다
  const adminSession = Boolean(user?.adminSession);
  const isAdmin = adminSession || lounge.isAdmin;
  const loading = !adminSession && lounge.loading;
  const { error, refresh } = lounge;
  const [loggingOut, setLoggingOut] = useState(false);
  const [params, setParams] = useSearchParams();
  // 통계 탭은 처음 열 때 불러오고, 이후에는 숨기기만 해서 탭을 오가도 다시 받지 않는다
  const raw = params.get('tab');
  const tab: TabKey = raw === 'stats' || raw === 'withdrawn' ? raw : 'reports';
  const [statsOpened, setStatsOpened] = useState(tab === 'stats');
  const [retrying, setRetrying] = useState(false);

  function changeTab(next: TabKey) {
    if (next === 'stats') setStatsOpened(true);
    // 주소에 남겨 두면 새로 고침·공유해도 같은 탭이 열린다. 뒤로 가기로 탭 이력이 쌓이지 않게 replace.
    setParams(next === 'reports' ? {} : { tab: next }, { replace: true });
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
    } catch {
      // 서버에 닿지 못해도 이 기기의 로그인 상태는 정리한다
    }
    setUser(null);
    toast('로그아웃했습니다.');
    navigate('/login', { replace: true });
  }

  async function retry() {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  }

  let body;
  if (loading) {
    body = (
      <div className="card">
        <LoadingBlock>관리자 정보를 확인하는 중이에요.</LoadingBlock>
      </div>
    );
  } else if (error && !isAdmin) {
    // 내 정보를 못 받았을 뿐인데 "관리자가 아니다" 라고 단정하지 않는다
    body = (
      <Alert
        tone="danger"
        title="관리자 정보를 확인하지 못했어요."
        actions={
          <Button variant="secondary" loading={retrying} onClick={retry}>
            {retrying ? '확인하는 중…' : '다시 시도하기'}
          </Button>
        }
      >
        {error}
      </Alert>
    );
  } else if (!isAdmin) {
    body = (
      <div className="card">
        <EmptyState
          icon="shield"
          title="관리자만 볼 수 있어요."
          description="이 화면은 신고 처리와 이용 통계를 확인하는 관리자 전용 화면이에요."
          action={
            <Link to="/" className={btnClass({ variant: 'secondary' })}>
              홈으로 가기
            </Link>
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        <p className="lounge-admin-lead">라운지에 들어온 신고를 처리하고, 이용 현황을 확인해요.</p>
        <div className="lounge-admin-tabs">
          <Tabs label="관리자 메뉴" value={tab} onChange={changeTab} tabs={TABS} idBase={ID_BASE} />
        </div>
        <div
          role="tabpanel"
          id={`${ID_BASE}-panel-reports`}
          aria-labelledby={`${ID_BASE}-tab-reports`}
          hidden={tab !== 'reports'}
        >
          <ReportsTab />
        </div>
        <div
          role="tabpanel"
          id={`${ID_BASE}-panel-stats`}
          aria-labelledby={`${ID_BASE}-tab-stats`}
          hidden={tab !== 'stats'}
        >
          {statsOpened && <StatsTab />}
        </div>
        <div
          role="tabpanel"
          id={`${ID_BASE}-panel-withdrawn`}
          aria-labelledby={`${ID_BASE}-tab-withdrawn`}
          hidden={tab !== 'withdrawn'}
        >
          {tab === 'withdrawn' && <WithdrawnTab />}
        </div>
      </>
    );
  }

  return (
    <>
      {adminSession ? (
        // 돌아갈 원래 계정 화면이 없으니 뒤로 가기 대신 서비스 이름 + 로그아웃
        <AppHeader
          actions={
            <Button variant="tertiary" loading={loggingOut} onClick={logout}>
              {!loggingOut && <Icon name="logout" className="btn__icon" />}
              로그아웃
            </Button>
          }
        />
      ) : (
        <AppHeader title="관리자" backTo="/account" />
      )}
      <main id="main" className="app-main">
        {body}
      </main>
    </>
  );
}
