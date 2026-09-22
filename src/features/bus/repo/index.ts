/** env에 Supabase가 설정돼 있으면 Supabase, 아니면 인메모리. (담당: 한승원) */
import { serverSupabase } from '@/server/supabase';
import type { BusRepo } from './bus-repo';
import { memoryBusRepo } from './memory-bus-repo';
import { supabaseBusRepo } from './supabase-bus-repo';

export function busRepo(): BusRepo {
  const db = serverSupabase();
  return db ? supabaseBusRepo(db) : memoryBusRepo;
}

export type { BusRepo };
