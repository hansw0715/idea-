import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Meeting } from '../types';

export default function Meetings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.get<Meeting[]>('/meetings').then(setMeetings).catch(() => undefined);
  }, []);

  async function createMeeting(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setPending(true);
    try {
      const meeting = await api.post<Meeting>('/meetings', { name });
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '회의를 만들지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  async function joinMeeting(e: FormEvent) {
    e.preventDefault();
    setJoinError(null);
    setJoinNotice(null);
    setPending(true);
    try {
      const meeting = await api.post<Meeting & { alreadyMember?: boolean; isOwner?: boolean }>(
        '/meetings/join',
        { code },
      );
      if (meeting.alreadyMember) {
        setJoinNotice(
          `${user?.name}님은 이미 '${meeting.name}'의 ${
            meeting.isOwner ? '방장입니다' : '멤버입니다'
          }. 다른 팀원이 참가하려면 그 사람의 계정으로 로그인한 뒤 코드를 입력해야 합니다.`,
        );
        return;
      }
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : '회의에 참가하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">회의</h1>
      <p className="page-sub">회의를 만들어 코드를 공유하거나, 받은 코드로 참가해 보세요.</p>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">새 회의 만들기</h2>
          {createError && <div className="alert alert-error">{createError}</div>}
          <form onSubmit={createMeeting}>
            <div className="field">
              <label htmlFor="m-name">회의 이름</label>
              <input
                id="m-name"
                className="input"
                type="text"
                placeholder="예: 캡스톤 디자인 팀"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              회의 만들기
            </button>
          </form>
        </section>

        <section className="card">
          <h2 className="card-title">코드로 참가하기</h2>
          {joinError && <div className="alert alert-error">{joinError}</div>}
          {joinNotice && <div className="alert alert-info">{joinNotice}</div>}
          <form onSubmit={joinMeeting}>
            <div className="field">
              <label htmlFor="m-code">회의 코드</label>
              <input
                id="m-code"
                className="input code-badge"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 0316"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required
              />
            </div>
            <button type="submit" className="btn btn-outline" disabled={pending}>
              참가하기
            </button>
          </form>
        </section>
      </div>

      <hr className="divider" />

      <section>
        <h2 className="section-title">내 회의 목록</h2>
        {meetings.length === 0 ? (
          <p className="empty-note">아직 참여 중인 회의가 없습니다. 위에서 회의를 만들어 보세요.</p>
        ) : (
          <div className="card" style={{ padding: '8px 20px' }}>
            <div className="row-list">
              {meetings.map((m) => (
                <div
                  key={m.id}
                  className="row-item linkable"
                  onClick={() => navigate(`/meetings/${m.id}`)}
                >
                  <div className="grow">
                    <div className="row-main">{m.name}</div>
                    <div className="row-sub">멤버 {m.memberCount}명</div>
                  </div>
                  <span className="badge badge-neutral code-badge">{m.code}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
