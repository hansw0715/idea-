import { useState } from 'react';
import { BAN_NOTICE_GENERIC } from '../../../../shared/lounge';
import { Alert, Button, EmptyState, LoadingBlock } from '../../ui';
import { useLounge } from '../LoungeContext';
import Avatar, { TemperatureBadge } from '../parts/Avatar';
import { factLine } from '../parts/fact';

/**
 * 내 정보의 "라운지 프로필" 구역: 아바타·이름(가림)·학과·학번·매너온도(같은 줄), 정지 안내, 고치기/만들기 버튼.
 * 값은 LoungeContext 가 들고 있는 내 프로필이다 — 프로필 시트에서 저장하면 이 카드도 바로 바뀐다.
 * 스타일: pages/account.css (접두사 lounge-acct-)
 */
export default function LoungeProfileCard() {
  const { profile, needsProfile, loading, error, refresh, openProfileSheet } = useLounge();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  }

  let body;
  if (profile) {
    body = (
      <>
        {profile.banned && (
          <div className="lounge-acct-ban">
            <Alert tone="danger" title="이용 정지 안내">
              {profile.banReason ?? BAN_NOTICE_GENERIC} 정지 중에는 모임을 만들거나 참여할 수 없어요.
            </Alert>
          </div>
        )}

        <div className="lounge-acct-who">
          <Avatar user={profile} size="lg" />
          <div className="lounge-acct-who__text">
            <p className="lounge-acct-nick">{profile.nickname}</p>
            {/* 학과·학번과 매너온도를 같은 줄에, 같은 크기로 */}
            <p className="lounge-acct-sub lounge-acct-line">
              <span>{factLine(profile)}</span>
              <TemperatureBadge value={profile.temperature} />
            </p>
          </div>
        </div>

        <p className="lounge-acct-help">이름·학과·학번은 연동한 학교 계정에서 가져와요. 직접 고칠 수 없어요. 불쾌한 일은 라운지에서 신고할 수 있어요.</p>
        <Button variant="secondary" block onClick={openProfileSheet}>
          프로필 이미지 바꾸기
        </Button>
      </>
    );
  } else if (needsProfile) {
    body = (
      <EmptyState
        icon="user"
        title="학교 계정을 연동하면 라운지를 쓸 수 있어요."
        description="이름·학과·학번은 연동한 학교 계정에서 자동으로 가져와요."
        action={
          <Button variant="secondary" onClick={openProfileSheet}>
            안내 보기
          </Button>
        }
      />
    );
  } else if (error && !loading) {
    // 프로필이 없다고 단정하지 않는다 — 받아오지 못한 것이다
    body = (
      <Alert
        tone="danger"
        title="라운지 프로필을 불러오지 못했어요."
        actions={
          <Button variant="secondary" loading={retrying} onClick={retry}>
            {retrying ? '불러오는 중…' : '다시 시도하기'}
          </Button>
        }
      >
        {error}
      </Alert>
    );
  } else {
    body = <LoadingBlock>라운지 프로필을 불러오는 중이에요.</LoadingBlock>;
  }

  return (
    <section className="section" aria-labelledby="lounge-acct-title">
      <div className="section__head">
        <h2 className="section__title" id="lounge-acct-title">
          라운지 프로필
        </h2>
      </div>
      <div className="card lounge-acct-card">{body}</div>
    </section>
  );
}
