'use client';

/**
 * 셔틀 지도. Leaflet + OpenStreetMap 타일이라 API 키가 필요 없다. (담당: 한승원)
 * Leaflet은 window가 있어야 돌아가서 이 파일은 반드시 next/dynamic({ ssr: false })로 불러야 한다.
 */
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { BusPosition, BusRoute } from '@/features/bus/types';

/** 한성대 정문 근처. 노선이 없을 때 보여줄 기본 위치. */
const CAMPUS: [number, number] = [37.5826, 127.0102];

type Props = {
  route: BusRoute | null;
  positions: BusPosition[];
  selectedStopId: string | null;
  onSelectStop: (stopId: string) => void;
};

export default function BusMap({ route, positions, selectedStopId, onSelectStop }: Props) {
  const path = (route?.stops ?? []).map((s) => [s.lat, s.lng] as [number, number]);

  return (
    <MapContainer center={CAMPUS} zoom={15} scrollWheelZoom className="h-full w-full" attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToRoute routeId={route?.id ?? null} path={path} />

      {route && path.length > 1 && <Polyline positions={path} pathOptions={{ color: route.color, weight: 5, opacity: 0.8 }} />}

      {route?.stops.map((s) => {
        const selected = s.id === selectedStopId;
        return (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={selected ? 10 : 7}
            pathOptions={{ color: route.color, weight: 3, fillColor: selected ? route.color : '#ffffff', fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelectStop(s.id) }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {s.order + 1}. {s.name}
            </Tooltip>
          </CircleMarker>
        );
      })}

      {positions.map((p) => (
        <Marker key={p.deviceId} position={[p.lat, p.lng]} icon={busIcon(route?.color ?? '#1f4fd8')} zIndexOffset={1000}>
          <Tooltip direction="top" offset={[0, -14]}>
            실시간 위치 · {timeAgo(p.updatedAt)}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}

/** 노선을 바꿀 때만 화면을 노선에 맞춘다. (위치가 갱신될 때마다 움직이면 사용자가 지도를 못 만진다) */
function FitToRoute({ routeId, path }: { routeId: string | null; path: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (path.length === 0) return;
    map.fitBounds(L.latLngBounds(path), { padding: [28, 28], maxZoom: 17 });
    // path는 routeId가 같으면 같은 노선이므로 routeId만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, map]);
  return null;
}

/** 기본 마커 이미지는 번들러에서 경로가 깨져서, 이모지 divIcon을 쓴다. */
function busIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgb(0 0 0 / .35);font-size:16px">🚌</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function timeAgo(iso: string) {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return sec < 60 ? `${sec}초 전` : `${Math.floor(sec / 60)}분 전`;
}
