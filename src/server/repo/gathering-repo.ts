/**
 * 저장소 인터페이스. (담당: 한승원 / 구현체 교체는 팀 합의)
 *
 * 지금은 인메모리 구현만 있다. 나중에 Supabase나 Prisma로 갈아탈 때
 * 이 인터페이스를 만족하는 파일 하나만 새로 쓰고 server/context.ts에서 바꿔 끼우면 되고,
 * domain/ 과 API 라우트는 손댈 필요가 없다.
 */
import type { GatheringId, UserId } from '@/shared/types';
import type { User } from '@/shared/user';
import type { Gathering, GatheringKind } from '@/domain/gathering';
import type { Block, Report } from '@/domain/safety/safety';
import type { Message } from '@/domain/chat/chat';
import type { QuickRequest, QuickRoom } from '@/features/mealdate/quick-match';

export interface GatheringRepo {
  list(kind?: GatheringKind): Promise<Gathering[]>;
  find(id: GatheringId): Promise<Gathering | null>;
  save(gathering: Gathering): Promise<void>;
  /** 내가 주최했거나 참여 중인 모임 (마이페이지용) */
  listByUser(userId: UserId): Promise<Gathering[]>;
}

export interface UserRepo {
  list(): Promise<User[]>;
  find(id: UserId): Promise<User | null>;
  save(user: User): Promise<void>;
}

/** 차단·신고 (미팅·밥약 공통) */
export interface SafetyRepo {
  listBlocks(): Promise<Block[]>;
  saveBlock(block: Block): Promise<void>;
  removeBlock(blockerId: UserId, blockedId: UserId): Promise<void>;
  listReports(): Promise<Report[]>;
  saveReport(report: Report): Promise<void>;
}

/** 모임 단톡방 메시지 */
export interface ChatRepo {
  list(roomId: string): Promise<Message[]>;
  save(message: Message): Promise<void>;
  /** 방이 이미 열렸는지(= 시스템 안내가 나갔는지) */
  hasMessages(roomId: string): Promise<boolean>;
}

/** 밥약 빠른 매칭 대기열 */
export interface QuickMatchRepo {
  listRequests(): Promise<QuickRequest[]>;
  saveRequest(request: QuickRequest): Promise<void>;
  listRooms(): Promise<QuickRoom[]>;
  findRoom(id: string): Promise<QuickRoom | null>;
  saveRoom(room: QuickRoom): Promise<void>;
}
