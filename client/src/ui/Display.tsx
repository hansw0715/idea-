import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 화면 글자 크기. 예전 "글자 크기 설정"의 80% 를 기본 크기로 고정했다 (설정 버튼은 없앴다).
 * html 글자 크기 = 62.5% × --zoom 이라 모든 rem 크기가 이 배율을 따른다.
 */
export const BASE_ZOOM = 0.8;

interface DisplayApi {
  zoom: number;
  /** 다크 모드 (내 정보 → 설정에서 켜고 끈다. 이 기기에 저장) */
  dark: boolean;
  setDark: (on: boolean) => void;
  /** 설정에서 따로 고르지 않아 휴대폰 화면 모드를 따르는 중인지 */
  followPhone: boolean;
  /** 고른 모드를 지우고 다시 휴대폰 화면 모드를 따른다 */
  followPhoneAgain: () => void;
}

const STORAGE_KEY = 'sangsang-booke-display';
/** 설정에서 직접 고른 화면 모드 ('dark' | 'light'). 예전 키(-theme)는 처음 실행 때 자동 저장된 값이라 쓰지 않는다 */
const THEME_KEY = 'sangsang-booke-theme-choice';
const OLD_THEME_KEY = 'sangsang-booke-theme';

const phoneDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

function readChoice(): 'dark' | 'light' | null {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch {
    return null;
  }
}

/**
 * 화면 모드. 설정에서 직접 고르기 전에는 휴대폰의 화면 모드(다크/라이트)를 그때그때 따른다.
 * 내 정보 → 설정의 화이트 모드/다크 모드 버튼으로 고르면 그 값을 저장해 그대로 쓴다.
 * (index.html 의 첫 스크립트도 같은 규칙으로 첫 화면이 그려지기 전에 적용한다)
 */
function readDark(): boolean {
  const choice = readChoice();
  return choice ? choice === 'dark' : phoneDark();
}

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  if (dark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181b' : '#ffffff');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'only dark' : 'only light');
}

function apply() {
  const root = document.documentElement;
  root.style.setProperty('--zoom', String(BASE_ZOOM));
  // 예전에 켜 두었던 "선명한 화면" 표시는 지운다
  root.removeAttribute('data-contrast');
}

// 첫 화면이 그려지기 전에 적용해 크기·색이 튀지 않게 한다.
if (typeof document !== 'undefined') {
  apply();
  applyTheme(readDark());
}

const DisplayContext = createContext<DisplayApi>({
  zoom: BASE_ZOOM,
  dark: false,
  setDark: () => {},
  followPhone: true,
  followPhoneAgain: () => {},
});

export function useDisplay(): DisplayApi {
  return useContext(DisplayContext);
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [dark, setDarkState] = useState(readDark);
  const [followPhone, setFollowPhone] = useState(() => readChoice() === null);
  const setDark = useCallback((on: boolean) => {
    setDarkState(on);
    setFollowPhone(false);
    applyTheme(on);
    try {
      localStorage.setItem(THEME_KEY, on ? 'dark' : 'light');
    } catch {
      /* 저장이 막혀도 이번에는 바뀐다 */
    }
    // 설치한 앱의 맨 아래 버튼 줄 색도 고른 모드를 따르도록 서버의 앱 설정 파일(/api/manifest)에 알린다
    document.cookie = `sb-theme=${on ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax; secure`;
  }, []);
  const followPhoneAgain = useCallback(() => {
    try {
      localStorage.removeItem(THEME_KEY);
    } catch {
      /* 저장소가 막힌 환경 — 무시 */
    }
    document.cookie = 'sb-theme=; path=/; max-age=0; samesite=lax; secure';
    setFollowPhone(true);
    const now = phoneDark();
    setDarkState(now);
    applyTheme(now);
  }, []);
  // 직접 고르기 전에는 휴대폰 화면 모드가 바뀌면 바로 따라간다.
  // 앱이 뒤에 있는 동안 바뀐 경우도 놓치지 않게, 앱으로 돌아올 때도 다시 확인한다
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const sync = () => {
      if (readChoice()) return;
      setDarkState(mq.matches);
      applyTheme(mq.matches);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    mq.addEventListener('change', sync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mq.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  useEffect(() => {
    apply();
    // 예전 설정(글자 크기·화면 모드) 저장값은 더 쓰지 않으니 지운다
    // 예전에 고른 모드가 있으면 서버의 앱 설정 파일도 알 수 있게 쿠키로 맞춰 둔다
    const choice = readChoice();
    if (choice) document.cookie = `sb-theme=${choice}; path=/; max-age=31536000; samesite=lax; secure`;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OLD_THEME_KEY);
    } catch {
      /* 저장소가 막힌 환경 — 무시 */
    }
  }, []);
  return (
    <DisplayContext.Provider value={{ zoom: BASE_ZOOM, dark, setDark, followPhone, followPhoneAgain }}>
      {children}
    </DisplayContext.Provider>
  );
}
