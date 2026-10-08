import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AVATARS, AVATAR_CHARACTERS } from '../../../../shared/lounge';
import type { AvatarKey } from '../../../../shared/lounge';
import { Alert, Button, Sheet, btnClass, useToast } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import Avatar from '../parts/Avatar';
import { factLine } from '../parts/fact';
import '../parts/parts.css';
import '../gathering.css';

/**
 * 라운지 프로필 시트. 이름(가림)·학과·학번은 연동한 학교 계정에서 자동으로 정해져 고칠 수 없고,
 * 내가 고를 수 있는 것은 **캐릭터 프로필 이미지**뿐이다(같은 캐릭터끼리 모아 보여 준다).
 * 서버가 "프로필이 필요해요(428)"라고 하면 LoungeProvider 가 이 시트를 연다: 학교 계정을 연동하면 된다는 안내를 한다.
 */
export default function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, setProfile } = useLounge();
  const toast = useToast();
  const [face, setFace] = useState<AvatarKey>(AVATARS[0].key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 열릴 때마다 지금 내 값으로 시작한다
  useEffect(() => {
    if (open && profile) {
      setFace(profile.avatar);
      setError(null);
    }
  }, [open, profile]);

  async function save() {
    if (busy || !profile) return;
    setBusy(true);
    setError(null);
    try {
      setProfile(await loungeApi.saveProfile({ avatar: face, avatarColor: profile.avatarColor }));
      toast('프로필 이미지를 바꿨어요.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={profile ? '프로필 이미지 고르기' : '라운지 프로필'}
      footer={
        profile ? (
          <Button size="lg" block loading={busy} onClick={() => void save()}>
            저장
          </Button>
        ) : (
          <Link to="/account" className={btnClass({ variant: 'primary', size: 'lg', block: true })} onClick={onClose}>
            내 정보에서 학교 계정 연동하기
          </Link>
        )
      }
    >
      {profile ? (
        <div className="lounge-pick">
          {error && (
            <Alert tone="danger" title="저장하지 못했어요">
              {error}
            </Alert>
          )}
          <div className="lounge-pick__preview">
            <Avatar user={{ avatar: face, avatarColor: profile.avatarColor }} size="lg" />
            <div>
              <p className="bold">{profile.nickname}</p>
              <p className="text-sub text-sm">{factLine(profile)}</p>
            </div>
          </div>
          <p className="text-sub text-sm">이름·학과·학번은 연동한 학교 계정에서 가져와요. 프로필 이미지만 바꿀 수 있어요.</p>

          {AVATAR_CHARACTERS.map((c) => (
            <fieldset key={c.key} className="lounge-pick__group">
              <legend className="lounge-pick__legend">{c.label}</legend>
              <div className="lounge-pick__grid">
                {AVATARS.filter((a) => a.character === c.key).map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className="lounge-pick__item"
                    aria-pressed={face === a.key}
                    aria-label={a.label}
                    onClick={() => setFace(a.key)}
                  >
                    <img src={`/avatars/${a.key}.webp`} alt="" width="256" height="256" loading="lazy" draggable={false} />
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : (
        <Alert tone="primary" title="학교 계정을 연동하면 라운지를 쓸 수 있어요">
          라운지의 이름(가림)·학과·학번은 연동한 학교 계정에서 자동으로 가져와요. 다른 학우에게는 이 사실만 보이고, 실명 전체와
          연락처는 보이지 않아요.
        </Alert>
      )}
    </Sheet>
  );
}
