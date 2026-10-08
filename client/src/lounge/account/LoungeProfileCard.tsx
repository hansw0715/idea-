import { useState } from 'react';
import { BAN_NOTICE_GENERIC, WARNINGS_TO_BAN, admissionLabel } from '../../../../shared/lounge';
import { Alert, Button, EmptyState, LoadingBlock } from '../../ui';
import { useLounge } from '../LoungeContext';
import Avatar, { TemperatureBadge } from '../parts/Avatar';

/**
 * 내 정보의 "라운지 프로필" 구역: 아바타·닉네임·단과대·학번, 매너온도, 노쇼 경고, 정지 안내, 고치기/만들기 버튼.
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
            <p className="lounge-acct-sub">
              {profile.college} · {admissionLabel(profile.admissionYear)}
            </p>
          </div>
        </div>

        <dl className="lounge-acct-stats">
          <div className="lounge-acct-stat">
            <dt className="lounge-acct-stat__key">매너온도</dt>
            <dd className="lounge-acct-stat__val">
              <TemperatureBadge value={profile.temperature} />
            </dd>
          </div>
          <div className="lounge-acct-stat">
            <dt className="lounge-acct-stat__key">노쇼 경고</dt>
            <dd className="lounge-acct-stat__val tabular">
              {profile.warnings}/{WARNINGS_TO_BAN}회
            </dd>
          </div>
        </dl>
        <p className="lounge-acct-help">
          노쇼가 확정되면 경고가 1회 쌓이고, {WARNINGS_TO_BAN}회가 되면 이용이 정지돼요.
        </p>

        <Button variant="secondary" block onClick={openProfileSheet}>
          프로필 고치기
        </Button>
      </>
    );
  } else if (needsProfile) {
    body = (
      <EmptyState
        icon="user"
        title="아직 라운지 프로필이 없어요."
        description="닉네임과 아바타를 정하면 라운지에서 미팅과 밥약에 참여할 수 있어요."
        action={
          <Button variant="secondary" onClick={openProfileSheet}>
            라운지 프로필 만들기
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
