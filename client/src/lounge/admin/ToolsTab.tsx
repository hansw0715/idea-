import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AdminLogEntry, AdminTool } from '../../../../shared/lounge';
import { Alert, Button, LoadingBlock, TextField, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';
import AdminLog from './AdminLog';

/** 버튼 하나로 푸는 운영 문제들. 언제 쓰는지를 같이 적는다 */
const TOOLS: { tool: AdminTool; title: string; when: string; label: string }[] = [
  {
    tool: 'clearQuickQueue',
    title: '밥약 빠른 매칭 대기 비우기',
    when: '매칭이 안 되고 대기만 쌓여 있을 때. 기다리던 사람은 다시 찾기를 눌러야 해요.',
    label: '대기 비우기',
  },
  {
    tool: 'clearPresence',
    title: '라운지 접속 기록 지우기',
    when: '나간 사람이 라운지에 계속 서 있는 것처럼 보일 때. 지금 있는 사람은 몇 초 안에 다시 잡혀요.',
    label: '접속 기록 지우기',
  },
  {
    tool: 'sweepLectureAlerts',
    title: '미수강 강의 알림 지금 보내기',
    when: '새벽처럼 앱을 쓰는 사람이 없어 알림이 늦을 때. 마감 6시간 안인 강의 알림을 바로 보내요.',
    label: '지금 보내기',
  },
  {
    tool: 'closeOldReports',
    title: '오래된 신고 정리',
    when: '30일 넘게 처리하지 않은 신고를 기각으로 닫아요.',
    label: '정리하기',
  },
];

/**
 * 관리자 > 운영 도구: 코드나 DB 를 건드리지 않고 자주 생기는 문제를 버튼으로 푼다.
 * 전체 공지 알림, 그리고 모든 관리 조치의 기록도 여기서 본다.
 */
export default function ToolsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [log, setLog] = useState<AdminLogEntry[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadLog = useCallback(async () => {
    setLogError(null);
    try {
      setLog(await loungeApi.adminLog());
    } catch (err) {
      setLogError(err instanceof Error ? err.message : '관리 기록을 불러오지 못했어요.');
    }
  }, []);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  async function runTool(t: (typeof TOOLS)[number]) {
    let message = '';
    const ok = await confirm({
      title: t.title,
      message: t.when,
      confirmLabel: t.label,
      run: async () => {
        message = (await loungeApi.adminTool(t.tool)).message;
      },
    });
    if (!ok) return;
    toast(message);
    await loadLog();
  }

  async function broadcast(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setFormError('제목과 내용을 적어 주세요.');
      return;
    }
    setFormError(null);
    let sent = 0;
    const ok = await confirm({
      title: '전체 공지 알림 보내기',
      message: `폰 알림을 켠 모든 사람에게 「${title.trim()}」을 보내요. 보낸 뒤에는 취소할 수 없어요.`,
      confirmLabel: '보내기',
      tone: 'danger',
      run: async () => {
        sent = (await loungeApi.adminBroadcast(title, body)).sent;
      },
    });
    if (!ok) return;
    toast(`${sent}명에게 공지 알림을 보냈어요.`);
    setTitle('');
    setBody('');
    await loadLog();
  }

  return (
    <div className="lounge-admin-tools">
      <h2 className="section__title lounge-admin-dash__title">문제 바로 풀기</h2>
      <ul className="lounge-admin-list">
        {TOOLS.map((t) => (
          <li key={t.tool} className="card lounge-admin-tool">
            <div className="lounge-admin-tool__text">
              <p className="lounge-admin-tool__title">{t.title}</p>
              <p className="lounge-admin-tool__when">{t.when}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void runTool(t)}>
              {t.label}
            </Button>
          </li>
        ))}
      </ul>

      <h2 className="section__title lounge-admin-dash__title">전체 공지 알림</h2>
      <form className="card lounge-admin-broadcast" onSubmit={(e) => void broadcast(e)} noValidate>
        <TextField label="제목" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="예: 서버 점검 안내" />
        <TextField
          label="내용"
          value={body}
          maxLength={120}
          help={`${body.length}/120`}
          error={formError}
          onChange={(e) => setBody(e.target.value)}
          placeholder="예: 오늘 밤 12시부터 10분간 점검해요."
        />
        <Button type="submit">공지 알림 보내기</Button>
      </form>

      <div className="lounge-admin-toolbar">
        <h2 className="section__title">관리 기록</h2>
        <Button variant="text" size="sm" onClick={() => void loadLog()}>
          새로 고치기
        </Button>
      </div>
      {logError && <Alert tone="danger" title="관리 기록을 불러오지 못했어요.">{logError}</Alert>}
      {log ? (
        <AdminLog items={log} />
      ) : (
        !logError && (
          <div className="card">
            <LoadingBlock>관리 기록을 불러오는 중이에요.</LoadingBlock>
          </div>
        )
      )}
    </div>
  );
}
