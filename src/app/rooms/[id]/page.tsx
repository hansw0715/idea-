import { ChatRoom } from '@/components/chat/ChatRoom';

/** 모임 단톡방. 방 id = 모임 id. */
export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatRoom roomId={id} />;
}
