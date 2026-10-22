import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Badge, Button, EmptyState, LoadingBlock, TextField, useToast } from '../../ui';
import { loungeApi } from '../api';

type Item = { hint: string; withdrawnAt: string; releasedAt: string | null };

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/**
 * 관리자: 탈퇴한 학번. 탈퇴하면 그 학번으로는 다시 가입·연동할 수 없고, 여기서 학번을 입력해 풀어 줘야 한다.
 * 목록에는 가린 학번과 날짜만 있다 (학번 원문·실명은 저장하지 않는다). 문의한 사람의 학번을 직접 입력해서 푼다.
 */
export default function WithdrawnTab() {
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      setItems(await loungeApi.adminWithdrawn());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '목록을 불러오지 못했어요.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function release(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const id = studentId.trim();
    if (!/^\d{6,12}$/.test(id)) {
      setFormError('학번을 숫자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await loungeApi.adminReleaseWithdrawn(id);
      toast('재가입을 허용했어요. 이제 이 학번으로 다시 가입할 수 있어요.');
      setStudentId('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '처리하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lounge-admin-withdrawn">
      <form className="card lounge-admin-withdrawn__form" onSubmit={(e) => void release(e)}>
        <h3 className="card__title">재가입 허용</h3>
        <p className="text-sub text-sm">탈퇴한 학번은 여기서 풀어 주기 전까지 다시 가입할 수 없어요. 문의한 사람의 학번을 입력하세요.</p>
        <TextField
          label="학번"
          inputMode="numeric"
          autoComplete="off"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          error={formError}
        />
        <Button type="submit" loading={busy}>
          재가입 허용하기
        </Button>
      </form>

      {loadError ? (
        <Alert tone="danger" title="목록을 불러오지 못했어요">
          {loadError}
        </Alert>
      ) : !items ? (
        <LoadingBlock>불러오는 중입니다.</LoadingBlock>
      ) : items.length === 0 ? (
        <EmptyState icon="user" title="탈퇴한 학번이 없어요." />
      ) : (
        <ul className="list card lounge-admin-withdrawn__list">
          {items.map((it, i) => (
            <li key={`${it.hint}-${it.withdrawnAt}-${i}`} className="list__item">
              <div className="list__body">
                <div className="list__main tabular">{it.hint || '(학번 정보 없음)'}</div>
                <div className="list__sub">
                  {fmt(it.withdrawnAt)} 탈퇴{it.releasedAt ? ` · ${fmt(it.releasedAt)} 재가입 허용` : ''}
                </div>
              </div>
              <Badge tone={it.releasedAt ? 'success' : 'gray'}>{it.releasedAt ? '허용됨' : '막힘'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
