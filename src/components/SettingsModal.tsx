import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  KeyRound,
  RotateCcw,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { LEVEL_LIST } from '../config/languages';
import { PERSONA_LIST } from '../config/personas';
import { verifyGeminiApiKey } from '../services/geminiService';
import {
  clearAllDbData,
  exportBackupJson,
  importBackupJson,
} from '../services/storageService';
import type {
  AppSettings,
  TtsPreference,
  TutorModelId,
} from '../types/app';

interface SettingsModalProps {
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onDataImported: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onDataImported,
  onClose,
}) => {
  const [draftKey, setDraftKey] = useState(settings.apiKey);
  const [testStatus, setTestStatus] = useState<{ ok?: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleTestKey = async () => {
    setTesting(true);
    setTestStatus(null);
    const res = await verifyGeminiApiKey(draftKey);
    setTestStatus({ ok: res.ok, msg: res.message });
    if (res.ok) {
      onUpdateSettings({
        ...settings,
        apiKey: draftKey.trim(),
        demoMode: false,
      });
    }
    setTesting(false);
  };

  const handleSaveKeyOnly = () => {
    const trimmed = draftKey.trim();
    onUpdateSettings({
      ...settings,
      apiKey: trimmed,
      demoMode: trimmed ? settings.demoMode : true,
    });
    setTestStatus({ ok: true, msg: trimmed ? 'API 키가 기기에 저장되었습니다.' : 'API 키가 비워져 데모 모드로 전환됩니다.' });
  };

  const handleExport = async () => {
    try {
      const json = await exportBackupJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lens-lingo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg('백업 JSON 파일을 다운로드했습니다.');
    } catch (e) {
      setBackupMsg(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importBackupJson(text);
      onDataImported();
      setBackupMsg(`복원 완료! 단어 ${res.vocabCount}개, 대화 ${res.sessionCount}개를 불러왔습니다.`);
    } catch (err) {
      setBackupMsg(`복원 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('저장된 단어 카드와 대화 이력을 모두 삭제할까요?')) return;
    await clearAllDbData();
    onDataImported();
    setBackupMsg('로컬 단어장과 대화 이력이 초기화되었습니다.');
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 70,
        background: 'rgba(4, 7, 17, 0.82)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel-strong anim-fade-up no-scrollbar"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxHeight: '90%',
          borderRadius: '28px 28px 0 0',
          padding: '18px 18px calc(22px + var(--safe-bottom))',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>튜터 & 앱 설정</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="설정 닫기">
            <X size={18} />
          </button>
        </div>

        {/* Mode & API Key */}
        <section
          style={{
            padding: '14px',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 700 }}>
              <KeyRound size={15} color="#38BDF8" /> Gemini API & 데모 모드
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={settings.demoMode}
                onChange={(e) => onUpdateSettings({ ...settings, demoMode: e.target.checked })}
                style={{ accentColor: '#FBBF24', width: '16px', height: '16px' }}
              />
              데모 모드
            </label>
          </div>

          <input
            type="password"
            className="field-input"
            placeholder="AIza... Gemini API 키"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
          />

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={handleSaveKeyOnly} style={{ flex: 1 }}>
              키 저장
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleTestKey}
              disabled={testing || !draftKey.trim()}
              style={{ flex: 1 }}
            >
              {testing ? '확인 중...' : '연결 테스트'}
            </button>
          </div>

          {testStatus && (
            <div
              style={{
                fontSize: '12px',
                padding: '8px 10px',
                borderRadius: '10px',
                background: testStatus.ok ? 'rgba(52, 211, 153, 0.16)' : 'rgba(251, 113, 133, 0.16)',
                color: testStatus.ok ? '#A7F3D0' : '#FECDD3',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <CheckCircle2 size={14} />
              <span>{testStatus.msg}</span>
            </div>
          )}
        </section>

        {/* AI Model & TTS */}
        <section
          style={{
            padding: '14px',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 700 }}>
            <Volume2 size={15} color="#A78BFA" /> AI 모델 & 음성(TTS) 엔진
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            튜터 멀티모달 모델
            <select
              className="field-input"
              value={settings.tutorModel}
              onChange={(e) =>
                onUpdateSettings({ ...settings, tutorModel: e.target.value as TutorModelId })
              }
            >
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite (최고속 10초컷 추천)</option>
              <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (균형 고속)</option>
              <option value="gemini-3.8-flash">Gemini 3.8 Flash (고정확 · Low Thinking)</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            음성 읽기(TTS) 방식
            <select
              className="field-input"
              value={settings.ttsPreference}
              onChange={(e) =>
                onUpdateSettings({ ...settings, ttsPreference: e.target.value as TtsPreference })
              }
            >
              <option value="hybrid">하이브리드 (Gemini 3.8 Lite TTS + 브라우저 폴백)</option>
              <option value="gemini_expressive">고표현력 AI 음성 (Gemini 3.8 Flash TTS)</option>
              <option value="browser_fast">브라우저 내장 음성 전용 (즉시 재생)</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', paddingTop: '2px' }}>
            <span>답변 도착 시 자동으로 소리 내어 읽기</span>
            <input
              type="checkbox"
              checked={settings.autoPlayTts}
              onChange={(e) => onUpdateSettings({ ...settings, autoPlayTts: e.target.checked })}
              style={{ width: '18px', height: '18px', accentColor: '#38BDF8' }}
            />
          </label>
        </section>

        {/* Persona & Level & Custom Prompt */}
        <section
          style={{
            padding: '14px',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700 }}>튜터 페르소나 & 난이도</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {PERSONA_LIST.map((p) => {
              const active = settings.persona === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, persona: p.id })}
                  style={{
                    padding: '9px 10px',
                    borderRadius: '12px',
                    textAlign: 'left',
                    background: active ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.04)',
                    border: active ? `1px solid ${p.accentColor}` : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>
                    {p.emoji} {p.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {p.koreanTitle}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {LEVEL_LIST.map((lvl) => {
              const active = settings.level === lvl.id;
              return (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, level: lvl.id })}
                  style={{
                    padding: '8px',
                    borderRadius: '10px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    background: active ? 'rgba(52, 211, 153, 0.22)' : 'rgba(255,255,255,0.05)',
                    border: active ? '1px solid #34D399' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {lvl.koreanLabel}
                </button>
              );
            })}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            커스텀 페르소나 지시사항 (선택)
            <textarea
              className="field-input"
              rows={2}
              placeholder="비워두면 선택한 페르소나 기본 스타일이 적용됩니다."
              value={settings.customPersonaPrompt}
              onChange={(e) =>
                onUpdateSettings({ ...settings, customPersonaPrompt: e.target.value })
              }
            />
          </label>
        </section>

        {/* Data Backup & Reset */}
        <section
          style={{
            padding: '14px',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700 }}>로컬 데이터 백업 및 관리 (IndexedDB)</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={handleExport} style={{ flex: 1 }}>
              <Download size={15} /> JSON 내보내기
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              style={{ flex: 1 }}
            >
              <Upload size={15} /> 백업 복원
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                onUpdateSettings({ ...settings, hasCompletedOnboarding: false })
              }
              style={{ flex: 1, fontSize: '12.5px' }}
            >
              <RotateCcw size={14} /> 온보딩 다시 보기
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClearAll}
              style={{
                flex: 1,
                fontSize: '12.5px',
                color: '#FDA4AF',
                borderColor: 'rgba(251, 113, 133, 0.35)',
              }}
            >
              <Trash2 size={14} /> 단어·대화 초기화
            </button>
          </div>

          {backupMsg && (
            <div style={{ fontSize: '12px', color: '#BAE6FD' }}>{backupMsg}</div>
          )}
        </section>
      </div>
    </div>
  );
};
