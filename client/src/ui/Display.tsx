import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 화면 글자 크기. 본문 16px, 보조 글자 14px의 기본 배율을 사용한다.
 * html 글자 크기 = 62.5% × --zoom 이라 모든 rem 크기가 이 배율을 따른다.
 */
export const BASE_ZOOM = 1;

interface DisplayApi {
  zoom: number;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'sangsang-booke:appearance';
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch { return 'system'; }
}

/** 예전 설정(글자 크기·화면 모드)이 남긴 저장값과 쿠키 — 더 쓰지 않으니 지운다 */
const OLD_KEYS = [
  'sangsang-booke-display',
  'sangsang-booke-theme',
  'sangsang-booke-theme-choice',
  'sangsang-booke-theme-mode',
];

function apply(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty('--zoom', String(BASE_ZOOM));
  // 예전에 켜 두었던 "선명한 화면"·다크 모드 표시는 지운다
  root.removeAttribute('data-contrast');
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme === 'system' ? 'light dark' : theme;
}

// 첫 화면이 그려지기 전에 적용해 크기가 튀지 않게 한다.
if (typeof document !== 'undefined') apply(readTheme());

const DisplayContext = createContext<DisplayApi>({ zoom: BASE_ZOOM, theme: 'system', setTheme: () => undefined });

export function useDisplay(): DisplayApi {
  return useContext(DisplayContext);
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    apply(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* 이 방문에만 적용 */ }
  }, [theme]);
  useEffect(() => {
    try {
      OLD_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* 저장소가 막힌 환경 — 무시 */
    }
    document.cookie = 'sb-theme=; path=/; max-age=0; samesite=lax; secure';
  }, []);
  return <DisplayContext.Provider value={{ zoom: BASE_ZOOM, theme, setTheme }}>{children}</DisplayContext.Provider>;
}
