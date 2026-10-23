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
}

const STORAGE_KEY = 'sangsang-booke-display';
const THEME_KEY = 'sangsang-booke-theme';

function readDark(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark';
  } catch {
    return false;
  }
}

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  if (dark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181b' : '#ffffff');
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

const DisplayContext = createContext<DisplayApi>({ zoom: BASE_ZOOM, dark: false, setDark: () => {} });

export function useDisplay(): DisplayApi {
  return useContext(DisplayContext);
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [dark, setDarkState] = useState(readDark);
  const setDark = useCallback((on: boolean) => {
    setDarkState(on);
    applyTheme(on);
    try {
      localStorage.setItem(THEME_KEY, on ? 'dark' : 'light');
    } catch {
      /* 저장이 막혀도 이번에는 바뀐다 */
    }
  }, []);
  useEffect(() => {
    apply();
    // 예전 설정(글자 크기·화면 모드) 저장값은 더 쓰지 않으니 지운다
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 저장소가 막힌 환경 — 무시 */
    }
  }, []);
  return <DisplayContext.Provider value={{ zoom: BASE_ZOOM, dark, setDark }}>{children}</DisplayContext.Provider>;
}
