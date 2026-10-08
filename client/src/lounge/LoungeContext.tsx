import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import type { Profile } from '../../../shared/lounge';
import { loungeApi } from './api';
import ProfileSheet from './sheets/ProfileSheet';

interface LoungeState {
  /** 내 라운지 프로필. 아직 안 만들었으면 null */
  profile: Profile | null;
  /** 프로필을 만들어야 라운지 기능을 쓸 수 있다 */
  needsProfile: boolean;
  isAdmin: boolean;
  loading: boolean;
  /** /lounge/me 를 불러오지 못한 이유 (연결 오류 등) */
  error: string | null;
  refresh: () => Promise<void>;
  setProfile: (profile: Profile) => void;
  profileSheetOpen: boolean;
  openProfileSheet: () => void;
  closeProfileSheet: () => void;
  /** 라운지 기능을 쓰기 전에 부른다. 프로필이 없으면 프로필 시트를 열고 false 를 돌려준다. */
  ensureProfile: () => boolean;
  /**
   * API 오류 처리 도우미. PROFILE_REQUIRED(428)이면 프로필 시트를 열고 true 를 돌려준다
   * (호출한 쪽은 별도 오류 문구를 띄우지 않아도 된다).
   */
  handleError: (err: unknown) => boolean;
}

const LoungeContext = createContext<LoungeState | null>(null);

export function useLounge(): LoungeState {
  const ctx = useContext(LoungeContext);
  if (!ctx) throw new Error('useLounge 는 LoungeProvider 안에서만 쓸 수 있습니다.');
  return ctx;
}

/** 로그인한 동안 내 라운지 프로필을 들고 있고, 프로필 만들기 시트를 한 곳에서 연다. */
export function LoungeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await loungeApi.me();
      setProfileState(me.profile);
      setNeedsProfile(me.needsProfile);
      setIsAdmin(me.isAdmin);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '라운지 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileState(null);
      setNeedsProfile(false);
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [user, refresh]);

  const setProfile = useCallback((next: Profile) => {
    setProfileState(next);
    setNeedsProfile(false);
  }, []);

  const value = useMemo<LoungeState>(
    () => ({
      profile,
      needsProfile,
      isAdmin,
      loading,
      error,
      refresh,
      setProfile,
      profileSheetOpen: sheetOpen,
      openProfileSheet: () => setSheetOpen(true),
      closeProfileSheet: () => setSheetOpen(false),
      ensureProfile: () => {
        if (needsProfile) {
          setSheetOpen(true);
          return false;
        }
        return true;
      },
      handleError: (err) => {
        if (err instanceof ApiError && err.code === 'PROFILE_REQUIRED') {
          setNeedsProfile(true);
          setSheetOpen(true);
          return true;
        }
        return false;
      },
    }),
    [profile, needsProfile, isAdmin, loading, error, refresh, setProfile, sheetOpen],
  );

  return (
    <LoungeContext.Provider value={value}>
      {children}
      {user && <ProfileSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />}
    </LoungeContext.Provider>
  );
}
