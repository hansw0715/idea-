import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoungeOptional } from '../lounge/LoungeContext';
import { homeWeekStart } from '../homeSchedule';
import { todayStr } from '../time';
import { useSchool } from '../school/SchoolContext';
import { readEclassSnapshot, ECLASS_UPDATED_EVENT } from '../school/EclassHomeCard';
import type { InboxNotification } from '../../../shared/notifications';
import type { GatheringView, RoomSummary } from '../../../shared/lounge';
import type { Meeting, Reservation, TimetableEntry } from '../types';
import { buildActivity, scopeFor } from './activity';
import type { Activity, NoticeData, Scope } from './activity';

type Seen = Partial<Record<Scope, string[]>>;
type State = { items: Activity[]; loading: boolean; failed: boolean; unread: (scope: Scope, item?: Activity) => boolean; mark: (scope: Scope, item?: Activity) => void; refresh: () => void };
const Context = createContext<State>({ items: [], loading: true, failed: false, unread: () => false, mark: () => {}, refresh: () => {} });
export const useNotifications = () => useContext(Context);
const keyFor = (id: number) => `sangsang-booke:seen-notifications:${id}`;
function readSeen(id: number): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(id)) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter(([scope, ids]) => ['home', 'timetable', 'lounge', 'campus', 'account'].includes(scope) && Array.isArray(ids) && ids.every((id) => typeof id === 'string'))) as Seen;
  } catch { return {}; }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const lounge = useLoungeOptional();
  const school = useSchool();
  const hasProfile = Boolean(lounge?.profile && !lounge.needsProfile);
  const location = useLocation();
  const [items, setItems] = useState<Activity[]>([]);
  const [seen, setSeen] = useState<Seen>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    setItems([]);
    setSeen(user ? readSeen(user.id) : {});
  }, [user?.id]);
  useEffect(() => {
    if (!user || user.adminSession) return;
    let cancelled = false;
    let request = 0;
    const load = async () => {
      if (document.hidden) return;
      const seq = ++request;
      const results = await Promise.allSettled([
        api.get<{ reservations: Reservation[]; meetings: Meeting[]; timetable: TimetableEntry[] }>(`/dashboard?week=${homeWeekStart(todayStr())}`),
        api.get<NoticeData>('/notices'),
        lounge ? api.get<{ notifications: InboxNotification[] }>('/lounge/notifications') : Promise.resolve({ notifications: [] }),
        hasProfile ? api.get<{ gatherings: GatheringView[] }>('/lounge/mine') : Promise.resolve({ gatherings: [] }),
        hasProfile ? api.get<{ rooms: RoomSummary[] }>('/lounge/rooms') : Promise.resolve({ rooms: [] }),
      ]);
      if (cancelled || seq !== request) return;
      const [dashboard, notices, inbox, gatherings, rooms] = results;
      setItems((previous) => {
        const fresh = buildActivity({
          ...(dashboard.status === 'fulfilled' ? dashboard.value : {}),
          notices: notices.status === 'fulfilled' ? notices.value : undefined,
          inbox: inbox.status === 'fulfilled' ? inbox.value.notifications : undefined,
          gatherings: gatherings.status === 'fulfilled' ? gatherings.value.gatherings : undefined,
          rooms: rooms.status === 'fulfilled' ? rooms.value.rooms : undefined,
          learning: school.linked ? readEclassSnapshot(user.id)?.items : undefined,
        });
        const failedScopes = new Set<string>();
        if (dashboard.status === 'rejected') ['reservation', 'meeting', 'timetable'].forEach((k) => failedScopes.add(k));
        if (notices.status === 'rejected') failedScopes.add('notice');
        if (inbox.status === 'rejected' || gatherings.status === 'rejected') ['friend', 'lounge'].forEach((k) => failedScopes.add(k));
        if (rooms.status === 'rejected') failedScopes.add('chat');
        const ids = new Set(fresh.map((i) => i.id));
        return [...fresh, ...previous.filter((i) => failedScopes.has(i.kind) && !ids.has(i.id))];
      });
      setFailed(results.some((r) => r.status === 'rejected'));
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    const onVisible = () => { if (!document.hidden) void load(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [user?.id, hasProfile, Boolean(lounge), school.linked, attempt, location.pathname]);
  useEffect(() => { window.addEventListener(ECLASS_UPDATED_EVENT, refresh); return () => window.removeEventListener(ECLASS_UPDATED_EVENT, refresh); }, [refresh]);

  const mark = useCallback((scope: Scope, item?: Activity) => {
    if (!user) return;
    setSeen((previous) => {
      const ids = item ? [item.id] : items.filter((i) => scope === 'home' || i.scopes.includes(scope)).map((i) => i.id);
      const nextIds = [...new Set([...(previous[scope] ?? []), ...ids])].slice(-2000);
      if (nextIds.length === (previous[scope]?.length ?? 0) && nextIds.every((id, i) => id === previous[scope]?.[i])) return previous;
      const next = { ...previous, [scope]: nextIds };
      try { localStorage.setItem(keyFor(user.id), JSON.stringify(next)); } catch { /* 메모리 안에서 확인 상태 유지 */ }
      return next;
    });
  }, [items, user?.id]);
  useEffect(() => {
    const scope = scopeFor(location.pathname);
    if (!scope || scope === 'home') return;
    // 공지는 공지 탭에서, 친구 요청은 친구 화면에서 읽었을 때 확인한다.
    if (scope === 'campus') {
      const notices = new URLSearchParams(location.search).get('tab') === 'notices';
      items.filter((i) => i.scopes.includes(scope) && (notices ? i.kind === 'notice' : i.kind === 'learning')).forEach((i) => mark(scope, i));
      return;
    }
    if (scope === 'account' && location.pathname !== '/account/friends') return;
    if (scope === 'lounge') {
      items.filter((i) => i.scopes.includes(scope) && (i.kind !== 'chat' || location.pathname === i.to)).forEach((i) => mark(scope, i));
    } else mark(scope);
  }, [location.pathname, location.search, items, mark]);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (user && event.key === keyFor(user.id)) setSeen(readSeen(user.id)); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [user?.id]);
  const value = useMemo<State>(() => ({ items, loading, failed, refresh, mark, unread: (scope, item) => (item ? [item] : items).some((i) => (scope === 'home' || i.scopes.includes(scope)) && !(seen[scope] ?? []).includes(i.id)) }), [items, seen, loading, failed, mark, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
