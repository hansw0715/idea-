/**
 * 서버 전용 Supabase 클라이언트. (담당: 공용)
 *
 * service_role 키는 RLS를 무시하므로 절대 브라우저로 보내면 안 된다 — 그래서 NEXT_PUBLIC_ 접두어가 없다.
 * env가 비어 있으면 null을 돌려주고, 각 기능은 인메모리 저장소로 폴백한다.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const g = globalThis as unknown as { __bookeSupabase?: SupabaseClient | null };

export function serverSupabase(): SupabaseClient | null {
  if (g.__bookeSupabase !== undefined) return g.__bookeSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.__bookeSupabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return g.__bookeSupabase;
}
