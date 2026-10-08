import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../auth';
import type { LinkStatus, SchoolCredentials, SchoolProfile } from '../../../shared/school/types';
import { schoolApi } from './api';
import { SchoolKeyMissingError, isCredentialFailure, needsRelink } from './errors';
import { linkAccount, runWithCredentials, unlinkAccount } from './linkFlow';
import { vault } from './vault';
import './school.css';

// 계약: 예전부터 이 파일에서 내보내던 이름이다 (정의는 errors.ts — react 없이 시험하려고 옮겼다)
export { SchoolKeyMissingError };

/**
 * 학교 계정 연동 상태와 동작. 평문 비밀번호는 React 상태·localStorage·sessionStorage·URL·콘솔 어디에도 두지 않고,
 * `withCredentials` 안에서만 잠깐 존재한다.
 * 담당: 작업 C5. 계약(타입)은 바꾸지 않고 optional 만 덧붙였다.
 */
export interface SchoolState {
  loading: boolean;
  linked: boolean;
  /** 학번 힌트 "***044" */
  hint: string | null;
  /** 연동할 때 읽은 학과·입학년도 (라운지 프로필 기본값) */
  profileHint: { department: string; admissionYear: number | null } | null;
  /**
   * 이 브라우저에 쓸 수 있는 복호화 키가 있는가. linked 이지만 false 면 "다시 연동"해야 쓸 수 있다.
   * 키가 있는 것만이 아니라 서버의 최신 암호문을 실제로 풀 수 있을 때만 true 다
   * (다른 기기에서 다시 연동해 암호문이 바뀐 경우를 걸러낸다).
   */
  canUse: boolean;
  refresh: () => Promise<void>;
  /**
   * 학교에 한 번 로그인해 보고, 성공하면 이 기기의 키(로그인 때 만든 것)로 암호화해 저장한다.
   * 실패하면 ApiError(code=SCHOOL_AUTH_FAILED 등), 이 기기에 키가 없으면 SchoolKeyMissingError.
   * forUser: 가입 직후처럼 아직 앱 전체에 로그인 정보가 올라가기 전에, 방금 가입한 사용자를 직접 알려 줄 때만 쓴다.
   */
  link: (creds: SchoolCredentials, forUser?: { id: number; username: string }) => Promise<SchoolProfile>;
  unlink: () => Promise<void>;
  /**
   * 필요한 순간에만 암호문을 풀어 fn 에 넘긴다. 키가 없으면 SchoolKeyMissingError.
   * fn 이 끝나면 평문은 더 이상 어디에도 남지 않는다.
   */
  withCredentials: <T>(fn: (creds: SchoolCredentials) => Promise<T>) => Promise<T>;
  /** (덧붙임) 연동한 시각 ISO. 연동 전이면 null */
  linkedAt?: string | null;
  /** (덧붙임) 연동 상태를 불러오지 못한 이유(연결 오류 등). 정상이면 null. 이때 linked=false 는 "안 됨"이 아니라 "모름"이다 */
  error?: string | null;
}

const inert: SchoolState = {
  loading: false,
  linked: false,
  hint: null,
  profileHint: null,
  canUse: false,
  refresh: async () => undefined,
  link: async () => {
    throw new Error('학교 연동을 쓸 수 없는 화면이에요.');
  },
  unlink: async () => undefined,
  withCredentials: async () => {
    throw new SchoolKeyMissingError();
  },
};

const SchoolContext = createContext<SchoolState>(inert);

export const useSchool = (): SchoolState => useContext(SchoolContext);

interface Loaded {
  /** 어느 사용자의 상태인가 (계정이 바뀌면 이전 사람의 상태를 보여 주지 않는다) */
  uid: number;
  status: LinkStatus;
  /** 이 기기의 키로 서버의 최신 암호문을 풀 수 있는가 */
  keyOk: boolean;
  error: string | null;
}

const EMPTY_STATUS: LinkStatus = { linked: false, hint: null, linkedAt: null, cipher: null, profileHint: null };

const deps = { vault, remote: schoolApi } as const;

/** 로그인한 동안 학교 연동 상태를 들고 있다. 로그아웃하면 비운다. */
export function SchoolProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  // 비동기 응답이 돌아왔을 때 그 사이 로그아웃·계정 전환이 있었는지 알아보려는 최신 사용자 id
  const uidRef = useRef(uid);
  uidRef.current = uid;
  // 암호문에는 아이디가 묶여 있어 풀 때 로그인한 사용자의 아이디가 필요하다
  const nameRef = useRef<string | null>(user?.username ?? null);
  nameRef.current = user?.username ?? null;

  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const refresh = useCallback(async () => {
    const id = uidRef.current;
    if (id === null) {
      setLoaded(null);
      return;
    }
    try {
      const status = await schoolApi.getLink();
      const name = nameRef.current;
      const keyOk = status.linked && status.cipher && name ? await vault.canOpen(id, name, status.cipher) : false;
      if (uidRef.current !== id) return;
      setLoaded({ uid: id, status, keyOk, error: null });
    } catch (err) {
      if (uidRef.current !== id) return;
      const message = err instanceof Error ? err.message : '학교 연동 상태를 불러오지 못했어요.';
      // 연결 오류로 값을 잃지 않는다: 이전에 받은 상태가 있으면 그대로 두고 이유만 알린다
      setLoaded((prev) =>
        prev && prev.uid === id ? { ...prev, error: message } : { uid: id, status: EMPTY_STATUS, keyOk: false, error: message },
      );
    }
  }, []);

  useEffect(() => {
    if (uid === null) {
      setLoaded(null);
      return;
    }
    void refresh();
  }, [uid, refresh]);

  const link = useCallback(
    async (creds: SchoolCredentials, forUser?: { id: number; username: string }): Promise<SchoolProfile> => {
      const id = forUser?.id ?? uidRef.current;
      const name = forUser?.username ?? nameRef.current;
      if (id === null || !name) throw new Error('로그인한 뒤에 학교 계정을 연동할 수 있어요.');
      const profile = await linkAccount(deps, id, name, creds);
      if (uidRef.current === id) await refresh();
      return profile;
    },
    [refresh],
  );

  const unlink = useCallback(async () => {
    const id = uidRef.current;
    if (id === null) throw new Error('로그인한 뒤에 연동을 해제할 수 있어요.');
    await unlinkAccount(deps);
    await refresh();
  }, [refresh]);

  const withCredentials = useCallback(
    async <T,>(fn: (creds: SchoolCredentials) => Promise<T>): Promise<T> => {
      const id = uidRef.current;
      const name = nameRef.current;
      if (id === null || !name) throw new SchoolKeyMissingError();
      try {
        return await runWithCredentials(deps, id, name, fn);
      } catch (err) {
        // 인증 실패·잠금·키 없음 뒤에는 상태를 다시 읽어 화면(카드·버튼)이 "다시 연동" 쪽으로 맞춰지게 한다.
        // 자동으로 다시 시도하지는 않는다 — 다음 시도는 사용자가 직접 누를 때만 한다.
        if (isCredentialFailure(err) || needsRelink(err)) void refresh();
        throw err;
      }
    },
    [refresh],
  );

  const current = loaded && loaded.uid === uid ? loaded : null;

  const value = useMemo<SchoolState>(
    () => ({
      loading: uid !== null && current === null,
      linked: current?.status.linked ?? false,
      hint: current?.status.hint ?? null,
      profileHint: current?.status.profileHint ?? null,
      canUse: Boolean(current?.status.linked && current.keyOk),
      linkedAt: current?.status.linkedAt ?? null,
      error: current?.error ?? null,
      refresh,
      link,
      unlink,
      withCredentials,
    }),
    [uid, current, refresh, link, unlink, withCredentials],
  );

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}
