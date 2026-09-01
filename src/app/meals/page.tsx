import { GatheringFeed } from '@/components/GatheringFeed';

export default function MealsPage() {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-bold">밥약</h2>
        <p className="text-[12px] text-muted">
          주최자가 방을 열고 신청을 받아 수락합니다. 혼밥하기 싫은 날, 한 끼만 같이 먹을 사람을
          찾는 기능이에요.
        </p>
      </header>
      <GatheringFeed
        kind="meal"
        newHref="/meals/new"
        ctaLabel="밥약 만들기"
        emptyText="열린 밥약이 없어요. 직접 방을 만들어 보세요!"
      />
    </section>
  );
}
