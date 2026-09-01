import { GatheringFeed } from '@/components/GatheringFeed';

export default function MeetupsPage() {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-bold">미팅</h2>
        <p className="text-[12px] text-muted">
          글을 올리면 빈 자리에 선착순으로 앉습니다. 우리 학교는 미팅할 자리가 없으니까, 자리를
          만들어 두는 게 이 기능의 목적입니다.
        </p>
      </header>
      <GatheringFeed
        kind="meetup"
        newHref="/meetups/new"
        ctaLabel="미팅 글쓰기"
        emptyText="아직 올라온 미팅이 없어요. 첫 글을 올려 보세요!"
      />
    </section>
  );
}
