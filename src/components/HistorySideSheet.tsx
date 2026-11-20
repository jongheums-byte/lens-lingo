import React from 'react';
import { Clock, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { TARGET_LANGUAGES } from '../config/languages';
import { PERSONAS } from '../config/personas';
import type { LearningSession } from '../types/app';

interface HistorySideSheetProps {
  sessions: LearningSession[];
  activeSessionId: string;
  onSelectSession: (session: LearningSession) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onClose: () => void;
}

function formatRelativeTime(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const HistorySideSheet: React.FC<HistorySideSheetProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onClose,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 55,
        background: 'rgba(4, 7, 17, 0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <aside
        className="glass-panel-strong anim-slide-right"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '86%',
          maxWidth: '360px',
          height: '100%',
          borderRadius: '26px 0 0 26px',
          padding: 'calc(18px + var(--safe-top)) 16px calc(18px + var(--safe-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={18} color="#38BDF8" />
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>학습 대화 기록</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="기록 닫기">
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            onNewSession();
            onClose();
          }}
          style={{ width: '100%' }}
        >
          <Plus size={16} /> 새 장면 대화 시작하기
        </button>

        <div
          className="no-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {sessions.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '36px 16px',
                color: 'var(--text-muted)',
                fontSize: '13px',
                lineHeight: 1.6,
              }}
            >
              아직 저장된 학습 대화가 없어요.
              <br />
              카메라로 사물을 비추고 질문해 보세요!
            </div>
          ) : (
            sessions.map((sess) => {
              const lang = TARGET_LANGUAGES[sess.language];
              const persona = PERSONAS[sess.persona];
              const isCurrent = sess.id === activeSessionId;
              const lastMsg = sess.messages[sess.messages.length - 1];

              return (
                <div
                  key={sess.id}
                  onClick={() => {
                    onSelectSession(sess);
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px',
                    borderRadius: '16px',
                    background: isCurrent
                      ? 'rgba(56, 189, 248, 0.16)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: isCurrent
                      ? '1px solid rgba(56, 189, 248, 0.55)'
                      : '1px solid rgba(255, 255, 255, 0.1)',
                    cursor: 'pointer',
                    alignItems: 'center',
                  }}
                >
                  {sess.previewImageDataUrl ? (
                    <img
                      src={sess.previewImageDataUrl}
                      alt="장면 썸네일"
                      style={{
                        width: '54px',
                        height: '54px',
                        borderRadius: '12px',
                        objectFit: 'cover',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '54px',
                        height: '54px',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <MessageSquare size={20} color="#94A3B8" />
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                      <span style={{ fontSize: '13px' }}>{lang.flag}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#BAE6FD' }}>
                        {persona.emoji} {persona.name}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {formatRelativeTime(sess.updatedAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {lastMsg?.text || '대화 시작됨'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      메시지 {sess.messages.length}개
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(sess.id);
                    }}
                    aria-label="세션 삭제"
                    style={{
                      padding: '6px',
                      color: 'var(--text-muted)',
                      borderRadius: '8px',
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
