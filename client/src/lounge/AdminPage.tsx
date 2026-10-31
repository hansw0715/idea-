import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, EmptyState, Icon, LoadingBlock, Tabs, btnClass, useToast } from '../ui';
import { useLounge } from './LoungeContext';
import DashboardTab from './admin/DashboardTab';
import GatheringsTab from './admin/GatheringsTab';
import MeetingsTab from './admin/MeetingsTab';
import ReportsTab from './admin/ReportsTab';
import ToolsTab from './admin/ToolsTab';
import UsersTab from './admin/UsersTab';
import WithdrawnTab from './admin/WithdrawnTab';
import './admin.css';

/**
 * 관리자 화면 (/admin): 대시보드 · 신고 · 사용자 · 모임 · 회의 · 운영 도구 · 탈퇴 학번.
 * 관리자가 코드나 DB 를 직접 만지지 않고 여기서 문제를 풀 수 있게 한다. 모든 조치는 관리 기록에 남는다. 관리자(useLounge().isAdmin)만 본다.
 * admin_아이디 로 들어온 관리자 모드 세션(user.adminSession)은 원래 계정과 상관없이 이 화면만 쓴다.
 * 서버도 /api/lounge/admin/* 를 관리자에게만 열어 두므로, 여기서 막는 것은 안내를 위한 것이다.
 * 규칙: docs/lounge/00-overview.md, docs/lounge/01-contract.md §6, docs/UI-KIT.md
 */

type TabKey = 'overview' | 'reports' | 'users' | 'gatherings' | 'meetings' | 'tools' | 'withdrawn';

const TABS: { value: TabKey; label: string }[] = [
  { value: 'overview', label: '대시보드' },
  { value: 'reports', label: '신고' },
  { value: 'users', label: '사용자' },
  { value: 'gatherings', label: '모임' },
  { value: 'meetings', label: '회의' },
  { value: 'tools', label: '운영 도구' },
  { value: 'withdrawn', label: '탈퇴 학번' },
];
const TAB_KEYS = TABS.map((t) => t.value);

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
  // 처음은 대시보드. 예전 주소(?tab=stats)도 대시보드로 연다
  const raw = params.get('tab');
  const tab: TabKey = (TAB_KEYS as string[]).includes(raw ?? '') ? (raw as TabKey) : 'overview';
  const [retrying, setRetrying] = useState(false);

  function changeTab(next: TabKey) {
    // 주소에 남겨 두면 새로 고침·공유해도 같은 탭이 열린다. 뒤로 가기로 탭 이력이 쌓이지 않게 replace.
    setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
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
          description="이 화면은 신고·사용자·모임·회의를 관리하는 관리자 전용 화면이에요."
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
        <p className="lounge-admin-lead">신고·사용자·모임·회의를 여기서 바로 처리해요. 모든 조치는 관리 기록에 남아요.</p>
        <div className="lounge-admin-tabs">
          <Tabs label="관리자 메뉴" value={tab} onChange={changeTab} tabs={TABS} idBase={ID_BASE} />
        </div>
        {/* 탭마다 열 때 불러온다 (신고 탭만 계속 붙여 두어 처리 중인 목록이 탭을 오가도 남는다) */}
        <div role="tabpanel" id={`${ID_BASE}-panel-overview`} aria-labelledby={`${ID_BASE}-tab-overview`} hidden={tab !== 'overview'}>
          {tab === 'overview' && <DashboardTab onGo={changeTab} />}
        </div>
        <div role="tabpanel" id={`${ID_BASE}-panel-reports`} aria-labelledby={`${ID_BASE}-tab-reports`} hidden={tab !== 'reports'}>
          <ReportsTab />
        </div>
        <div role="tabpanel" id={`${ID_BASE}-panel-users`} aria-labelledby={`${ID_BASE}-tab-users`} hidden={tab !== 'users'}>
          {tab === 'users' && <UsersTab />}
        </div>
        <div role="tabpanel" id={`${ID_BASE}-panel-gatherings`} aria-labelledby={`${ID_BASE}-tab-gatherings`} hidden={tab !== 'gatherings'}>
          {tab === 'gatherings' && <GatheringsTab />}
        </div>
        <div role="tabpanel" id={`${ID_BASE}-panel-meetings`} aria-labelledby={`${ID_BASE}-tab-meetings`} hidden={tab !== 'meetings'}>
          {tab === 'meetings' && <MeetingsTab />}
        </div>
        <div role="tabpanel" id={`${ID_BASE}-panel-tools`} aria-labelledby={`${ID_BASE}-tab-tools`} hidden={tab !== 'tools'}>
          {tab === 'tools' && <ToolsTab />}
        </div>
        <div role="tabpanel" id={`${ID_BASE}-panel-withdrawn`} aria-labelledby={`${ID_BASE}-tab-withdrawn`} hidden={tab !== 'withdrawn'}>
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
