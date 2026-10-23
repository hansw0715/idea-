import { useState } from 'react';
import { BAN_NOTICE_GENERIC, GENDER_LABEL } from '../../../../shared/lounge';
import type { Gender } from '../../../../shared/lounge';
import { Alert, Button, EmptyState, LoadingBlock, Segmented, useToast } from '../../ui';
import { useAuth } from '../../auth';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import Avatar, { TemperatureBadge } from '../parts/Avatar';
import { factLine } from '../parts/fact';

/**
 * 내 정보의 "라운지 프로필" 구역: 아바타·이름(가림)·학과·학번·매너온도(같은 줄), 정지 안내, 고치기/만들기 버튼.
 * 값은 LoungeContext 가 들고 있는 내 프로필이다 — 프로필 시트에서 저장하면 이 카드도 바로 바뀐다.
 * 스타일: pages/account.css (접두사 lounge-acct-)
 */
export default function LoungeProfileCard() {
  const { profile, needsProfile, loading, error, refresh, openProfileSheet, setProfile } = useLounge();
  const { user } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const [savingGender, setSavingGender] = useState(false);
  const [genderError, setGenderError] = useState<string | null>(null);
  const toast = useToast();

  /** 학교 계정에서 성별을 못 읽은 경우에만 직접 고른다. 미팅에서 남자/여자 자리를 고를 때 쓴다 */
  async function saveGender(gender: Gender) {
    if (!profile || savingGender || profile.gender === gender) return;
    setSavingGender(true);
    setGenderError(null);
    try {
      setProfile(await loungeApi.saveProfile({ avatar: profile.avatar, avatarColor: profile.avatarColor, gender }));
      toast('성별을 저장했어요.');
    } catch (err) {
      setGenderError(err instanceof Error ? err.message : '성별을 저장하지 못했어요.');
    } finally {
      setSavingGender(false);
    }
  }

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
            {/* 내 정보에서는 실명을 보여 준다. 다른 사람에게는 가린 이름(닉네임)으로 보인다 */}
            <p className="lounge-acct-nick">{user?.name || profile.nickname}</p>
            {/* 학과·학번과 매너온도를 같은 줄에, 같은 크기로 */}
            <p className="lounge-acct-sub lounge-acct-line">
              <span>{factLine(profile)}</span>
              <TemperatureBadge value={profile.temperature} />
            </p>
          </div>
        </div>

        <div className="lounge-acct-gender">
          {/* 성별은 가입 때 정하면 바꿀 수 없어 글자로만 보여 준다. 성별이 없는 옛 계정만 한 번 고른다 */}
          {profile.gender ? (
            <p className="lounge-acct-help">
              성별: <strong>{GENDER_LABEL[profile.gender]}</strong>
            </p>
          ) : (
            <Segmented
              label="성별"
              value={'' as Gender}
              onChange={(g) => void saveGender(g)}
              options={[
                { value: 'male', label: '남' },
                { value: 'female', label: '여' },
              ]}
              help="미팅에 참여하려면 성별을 골라 주세요. 한 번 고르면 바꿀 수 없어요."
            />
          )}
          {genderError && (
            <Alert tone="danger" title="저장하지 못했어요">
              {genderError}
            </Alert>
          )}
        </div>

        <p className="lounge-acct-help">
          이름·학과·학번은 학교 계정에서 가져와요. 라운지에서 다른 사람에게는 이름이 {profile.nickname}(으)로 보여요.
        </p>
        <Button variant="secondary" size="sm" onClick={openProfileSheet}>
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
