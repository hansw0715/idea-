import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { Choice } from './Form';

/** 글자 크기: 80 / 90 / 100 / 110% (저장돼 있던 그 밖의 값은 100% 로 돌아간다) */
export const ZOOM_OPTIONS = [
  { value: 0.8, label: '80%', desc: '가장 작게' },
  { value: 0.9, label: '90%', desc: '작게' },
  { value: 1, label: '100%', desc: '기본' },
  { value: 1.1, label: '110%', desc: '조금 크게' },
] as const;

interface DisplayState {
  zoom: number;
}

interface DisplayApi extends DisplayState {
  openSettings: () => void;
}

const STORAGE_KEY = 'sangsang-booke-display';
const DEFAULTS: DisplayState = { zoom: 1 };

function read(): DisplayState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DisplayState>;
      const zoom = ZOOM_OPTIONS.some((o) => o.value === parsed.zoom) ? (parsed.zoom as number) : 1;
      return { zoom };
    }
  } catch {
    /* 저장소가 막힌 환경에서는 기본값으로 시작 */
  }
  return DEFAULTS;
}

function apply(state: DisplayState) {
  const root = document.documentElement;
  root.style.setProperty('--zoom', String(state.zoom));
  // "선명한 화면" 모드는 없앴다. 예전에 켜 두었던 사람도 일반 화면으로 보이게 표시를 지운다
  root.removeAttribute('data-contrast');
}

// 첫 화면이 그려지기 전에 적용해 크기가 튀지 않게 한다.
if (typeof document !== 'undefined') apply(read());

const DisplayContext = createContext<DisplayApi>({
  ...DEFAULTS,
  openSettings: () => undefined,
});

export function useDisplay(): DisplayApi {
  return useContext(DisplayContext);
}

/** "글자 크기 설정": 모든 화면 헤더의 AA 버튼으로 연다 */
export function DisplayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DisplayState>(read);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    apply(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 무시 */
    }
  }, [state]);

  const openSettings = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ ...state, openSettings }), [state, openSettings]);

  return (
    <DisplayContext.Provider value={value}>
      {children}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="글자 크기 설정"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setState(DEFAULTS)}>
              초기화
            </Button>
            <Button onClick={() => setOpen(false)}>적용하기</Button>
          </>
        }
      >
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">글자 크기</legend>
          {ZOOM_OPTIONS.map((o) => (
            <Choice
              key={o.value}
              type="radio"
              name="display-zoom"
              label={`${o.label} · ${o.desc}`}
              checked={state.zoom === o.value}
              onChange={() => setState((s) => ({ ...s, zoom: o.value }))}
            />
          ))}
        </fieldset>
      </Sheet>
    </DisplayContext.Provider>
  );
}
