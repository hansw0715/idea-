'use client';

/**
 * 기사님 폰용 위치 송신 화면. (담당: 한승원)
 *
 * AirTag는 위치를 꺼내 쓸 공개 API가 없어서, 지금은 버스에 둔 폰으로 이 페이지를 열어 GPS를 보낸다.
 * GPS 트래커를 사면 같은 API(POST /api/bus/positions)로 보내게만 하면 지도는 그대로 동작한다.
 *
 * 주의: 브라우저 위치 권한은 HTTPS(또는 localhost)에서만 동작한다 → 실제 테스트는 배포 주소에서.
 */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fetchBus } from '@/lib/bus-api';
import type { BusRoute } from '@/features/bus/types';

const SEND_EVERY_MS = 5_000;
const LS_KEY = 'booke.bus.driver';

type Saved = { deviceId: string; token: string; routeId: string };

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {}
  return { deviceId: `bus-${Math.random().toString(36).slice(2, 8)}`, token: '', routeId: '' };
}

function save(s: Saved) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function DriverConsole() {
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [cfg, setCfg] = useState<Saved | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger' | 'neutral'; text: string }>({
    tone: 'neutral',
    text: '대기 중',
  });
  const [sent, setSent] = useState(0);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  // localStorage는 브라우저에만 있으므로 마운트 뒤에 읽는다(서버 렌더와 어긋나지 않게).
  useEffect(() => {
    const saved = loadSaved();
    fetchBus()
      .then((s) => {
        setRoutes(s.network.routes);
        setCfg(!saved.routeId && s.network.routes[0] ? { ...saved, routeId: s.network.routes[0].id } : saved);
      })
      .catch(() => {
        setCfg(saved);
        setStatus({ tone: 'danger', text: '노선 목록을 못 불러왔어요' });
      });
  }, []);

  // 페이지를 떠나면 GPS 감시와 화면 켜짐 유지를 푼다.
  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      void wakeLock.current?.release().catch(() => {});
    },
    [],
  );

  if (!cfg) return null;

  const update = (patch: Partial<Saved>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    save(next);
  };

  async function send(pos: GeolocationPosition) {
    const now = Date.now();
    if (now - lastSent.current < SEND_EVERY_MS) return;
    lastSent.current = now;
    try {
      const res = await fetch('/api/bus/positions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg!.token}` },
        body: JSON.stringify({
          deviceId: cfg!.deviceId,
          routeId: cfg!.routeId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(data.error ?? { code: 'INVALID', message: `전송 실패 (${res.status})` });
      }
      setSent((n) => n + 1);
      setStatus({
        tone: 'success',
        text: `전송 중 · 정확도 ±${Math.round(pos.coords.accuracy)}m · ${new Date().toLocaleTimeString('ko-KR')}`,
      });
    } catch (e) {
      setStatus({ tone: 'danger', text: e instanceof ApiError ? e.message : '네트워크 오류 — 계속 재시도해요' });
    }
  }

  async function start() {
    if (!('geolocation' in navigator)) {
      setStatus({ tone: 'danger', text: '이 기기는 위치를 지원하지 않아요' });
      return;
    }
    lastSent.current = 0;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => void send(p),
      (err) =>
        setStatus({
          tone: 'danger',
          text: err.code === err.PERMISSION_DENIED ? '위치 권한을 허용해 주세요 (HTTPS 주소에서만 가능)' : `위치 오류: ${err.message}`,
        }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    // 화면이 꺼지면 브라우저가 GPS를 멈추므로 화면 켜짐 유지를 요청한다(지원하는 브라우저만).
    try {
      wakeLock.current = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {}
    setRunning(true);
    setStatus({ tone: 'neutral', text: 'GPS 신호를 기다리는 중…' });
  }

  function stop() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setRunning(false);
    setStatus({ tone: 'neutral', text: '멈춤' });
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">버스 위치 보내기</h1>
      <p className="text-sm text-muted">운행하는 동안 이 화면을 켜 두세요. 5초마다 현재 위치가 지도에 반영돼요.</p>

      <Card className="space-y-3">
        <Field label="노선">
          <Select value={cfg.routeId} disabled={running} onChange={(e) => update({ routeId: e.target.value })}>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="기기 토큰" hint="관리자에게 받은 값 (서버의 BUS_DEVICE_TOKEN). 개발 모드에선 비워도 돼요.">
          <Input
            type="password"
            value={cfg.token}
            disabled={running}
            onChange={(e) => update({ token: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <Field label="기기 이름" hint="버스가 여러 대면 대마다 다르게">
          <Input value={cfg.deviceId} disabled={running} onChange={(e) => update({ deviceId: e.target.value })} />
        </Field>
      </Card>

      <Badge tone={status.tone}>{status.text}</Badge>
      {running && <p className="text-xs text-muted">보낸 횟수 {sent}</p>}

      {running ? (
        <Button variant="danger" size="lg" block onClick={stop}>
          운행 종료
        </Button>
      ) : (
        <Button size="lg" block onClick={start} disabled={!cfg.routeId}>
          운행 시작
        </Button>
      )}
    </div>
  );
}
