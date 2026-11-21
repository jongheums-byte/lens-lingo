import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  ChevronDown,
  Clock,
  Gamepad2,
  Languages,
  Lightbulb,
  MessageCircle,
  Mic,
  Plus,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { LANGUAGE_LIST, LEVEL_LIST, PROFICIENCY_LEVELS, TARGET_LANGUAGES } from '../config/languages';
import { PERSONA_LIST, PERSONAS } from '../config/personas';
import { CONVERSATION_SCENARIOS, SCENARIO_PRESET_LIST } from '../config/scenarios';
import { playSfx, prepareAudioForGemini } from '../lib/audioUtils';
import type { TtsPlaybackState } from '../services/ttsService';
import type {
  AppSettings,
  ChatMessage,
  ConversationScenarioId,
  ExtractedVocab,
  LearningSession,
  SavedVocabCard,
  TtsEngineKind,
} from '../types/app';

interface ConversationChatViewProps {
  settings: AppSettings;
  activeChatSession: LearningSession;
  savedCards: SavedVocabCard[];
  ttsState: TtsPlaybackState;
  ttsEngine: TtsEngineKind;
  playingMessageId: string | null;
  isProcessing: boolean;
  processingStage: string;
  errorBanner: string | null;
  onClearError: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onStartScenario: (scenarioId: ConversationScenarioId, customTopic?: string) => Promise<void>;
  onSendChatTurn: (params: {
    text?: string;
    audioBase64?: string;
    audioMimeType?: string;
  }) => Promise<void>;
  onResetToScenarios: () => void;
  onCancelTurn: () => void;
  onSpeakMessage: (msg: ChatMessage) => void;
  onStopTts: () => void;
  onUnlockAudio: () => void;
  onSpeakWord: (word: string) => void;
  onSaveExtractedVocab: (vocab: ExtractedVocab) => Promise<void>;
  onSwitchToScan: () => void;
  onOpenVocabBank: () => void;
  onOpenPopper: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

export const ConversationChatView: React.FC<ConversationChatViewProps> = ({
  settings,
  activeChatSession,
  savedCards,
  ttsState,
  ttsEngine,
  playingMessageId,
  isProcessing,
  processingStage,
  errorBanner,
  onClearError,
  onUpdateSettings,
  onStartScenario,
  onSendChatTurn,
  onResetToScenarios,
  onCancelTurn,
  onSpeakMessage,
  onStopTts,
  onUnlockAudio,
  onSpeakWord,
  onSaveExtractedVocab,
  onSwitchToScan,
  onOpenVocabBank,
  onOpenPopper,
  onOpenHistory,
  onOpenSettings,
}) => {
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [customTopicDraft, setCustomTopicDraft] = useState('');
  const [textDraft, setTextDraft] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [translationOverrides, setTranslationOverrides] = useState<Record<string, boolean>>({});

  const currentLang = TARGET_LANGUAGES[settings.targetLanguage];
  const currentPersona = PERSONAS[settings.persona];
  const currentLevel = PROFICIENCY_LEVELS[settings.level];

  const hasStarted = activeChatSession.messages.length > 0;
  const activeScenario = CONVERSATION_SCENARIOS[activeChatSession.scenarioId ?? 'free_talk'];

  const savedWordSet = new Set(
    savedCards
      .filter((c) => c.language === settings.targetLanguage)
      .map((c) => c.word.trim().toLowerCase()),
  );

  const latestTutorMsg = [...activeChatSession.messages]
    .reverse()
    .find((m) => m.role === 'tutor');

  const activeSuggestions =
    !isProcessing && latestTutorMsg?.suggestedReplies ? latestTutorMsg.suggestedReplies : [];

  useEffect(() => {
    if (!isProcessing) {
      setElapsedSec(0);
      return;
    }
    const start = Date.now();
    setElapsedSec(0);
    const tid = window.setInterval(() => {
      setElapsedSec((Date.now() - start) / 1000);
    }, 250);
    return () => window.clearInterval(tid);
  }, [isProcessing]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeChatSession.messages.length, latestTutorMsg?.text, isProcessing]);

  const handleSendText = async (overrideText?: string) => {
    const clean = (overrideText ?? textDraft).trim();
    if (!clean || isProcessing) return;
    onUnlockAudio();
    if (!overrideText) setTextDraft('');
    await onSendChatTurn({ text: clean });
  };

  const handleMicToggle = async () => {
    onUnlockAudio();
    if (isProcessing) return;

    if (isRecording) {
      playSfx('micStop');
      setIsRecording(false);
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return;
    }

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const supportedMime = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = supportedMime
        ? new MediaRecorder(micStream, { mimeType: supportedMime })
        : new MediaRecorder(micStream);

      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        micStream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size < 400) return;

        try {
          const { base64, mimeType } = await prepareAudioForGemini(blob);
          await onSendChatTurn({
            audioBase64: base64,
            audioMimeType: mimeType,
          });
        } catch {
          await onSendChatTurn({ text: 'Hello! Can you say that again?' });
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      playSfx('micStart');
      setIsRecording(true);
    } catch {
      // Microphone permission denied — user can continue typing
    }
  };

  const isTranslationVisible = (msgId: string): boolean => {
    if (msgId in translationOverrides) {
      return translationOverrides[msgId];
    }
    return settings.level === 'beginner';
  };

  const toggleTranslation = (msgId: string) => {
    setTranslationOverrides((prev) => ({
      ...prev,
      [msgId]: !isTranslationVisible(msgId),
    }));
  };

  const handleQuickStartCustom = async () => {
    const topic = customTopicDraft.trim();
    if (!topic || isProcessing) return;
    onUnlockAudio();
    setCustomTopicDraft('');
    await onStartScenario('custom', topic);
  };

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 80% 10%, rgba(56, 189, 248, 0.14) 0%, rgba(7, 11, 24, 1) 48%, rgba(12, 19, 38, 1) 100%)',
      }}
    >
      {/* Top Glass Header */}
      <header
        style={{
          position: 'relative',
          zIndex: 15,
          padding: 'calc(12px + var(--safe-top)) 14px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <button
            type="button"
            className="glass-pill"
            onClick={() => {
              setShowLangPicker((v) => !v);
              setShowPersonaPicker(false);
            }}
          >
            <span>{currentLang.flag}</span>
            <span>{currentLang.koreanName}</span>
            <ChevronDown size={14} />
          </button>

          <button
            type="button"
            className="glass-pill"
            onClick={() => {
              setShowPersonaPicker((v) => !v);
              setShowLangPicker(false);
            }}
            style={{ borderColor: `${currentPersona.accentColor}66` }}
          >
            <span>{currentPersona.emoji}</span>
            <span
              style={{
                maxWidth: '92px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentPersona.name} · {currentLevel.koreanLabel}
            </span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button type="button" className="icon-btn" onClick={onOpenHistory} aria-label="학습 기록">
            <Clock size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="설정">
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </header>

      {/* Mode Switcher & Quick Controls Strip */}
      <div
        className="no-scrollbar"
        style={{
          position: 'relative',
          zIndex: 14,
          padding: '2px 14px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {/* 1-Tap Mode Switcher: Scan vs Conversation */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px',
            borderRadius: '9999px',
            background: 'rgba(15, 23, 42, 0.78)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onSwitchToScan}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 9px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 700,
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            <Camera size={12} /> 스캔
          </button>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 800,
              background: 'linear-gradient(135deg, rgba(56,189,248,0.34), rgba(99,102,241,0.34))',
              color: '#E0F2FE',
              border: '1px solid rgba(56, 189, 248, 0.55)',
              whiteSpace: 'nowrap',
            }}
          >
            <MessageCircle size={12} /> 회화
          </button>
        </div>

        {/* 1-Tap Level Cycler */}
        <button
          type="button"
          className="glass-pill"
          onClick={() => {
            const order: AppSettings['level'][] = ['beginner', 'intermediate', 'advanced'];
            const nextLevel = order[(order.indexOf(settings.level) + 1) % order.length];
            onUpdateSettings({ ...settings, level: nextLevel });
          }}
          style={{
            padding: '4px 10px',
            fontSize: '11.5px',
            background: 'rgba(52, 211, 153, 0.16)',
            borderColor: 'rgba(52, 211, 153, 0.45)',
            color: '#A7F3D0',
          }}
        >
          🎯 {currentLevel.koreanLabel}
        </button>

        {!settings.demoMode ? (
          <button
            type="button"
            className="glass-pill"
            onClick={() => {
              const order: AppSettings['tutorModel'][] = [
                'gemini-3.1-flash-lite',
                'gemini-3.5-flash-lite',
                'gemini-3.8-flash',
              ];
              const nextModel = order[(order.indexOf(settings.tutorModel) + 1) % order.length];
              onUpdateSettings({ ...settings, tutorModel: nextModel });
            }}
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              background:
                settings.tutorModel === 'gemini-3.1-flash-lite'
                  ? 'rgba(52, 211, 153, 0.22)'
                  : settings.tutorModel === 'gemini-3.5-flash-lite'
                    ? 'rgba(56, 189, 248, 0.2)'
                    : 'rgba(167, 139, 250, 0.2)',
              borderColor:
                settings.tutorModel === 'gemini-3.1-flash-lite'
                  ? 'rgba(52, 211, 153, 0.55)'
                  : settings.tutorModel === 'gemini-3.5-flash-lite'
                    ? 'rgba(56, 189, 248, 0.5)'
                    : 'rgba(167, 139, 250, 0.5)',
            }}
          >
            {settings.tutorModel === 'gemini-3.1-flash-lite'
              ? '⚡ 3.1 초고속'
              : settings.tutorModel === 'gemini-3.5-flash-lite'
                ? '⚡ 3.5 Lite'
                : '🎯 3.8 Flash'}
          </button>
        ) : (
          <span
            className="glass-pill"
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              background: 'rgba(251, 191, 36, 0.18)',
              borderColor: 'rgba(251, 191, 36, 0.45)',
              color: '#FDE68A',
            }}
          >
            ✨ 데모 모드
          </span>
        )}

        {hasStarted && (
          <button
            type="button"
            className="glass-pill"
            onClick={onResetToScenarios}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <RotateCcw size={12} /> 새 주제
          </button>
        )}
      </div>

      {/* Popover: Language Picker */}
      {showLangPicker && (
        <div
          className="glass-panel-strong anim-fade-up"
          style={{
            position: 'absolute',
            top: 'calc(62px + var(--safe-top))',
            left: '14px',
            right: '14px',
            zIndex: 30,
            borderRadius: '20px',
            padding: '12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '6px',
          }}
        >
          {LANGUAGE_LIST.map((lang) => {
            const active = settings.targetLanguage === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  onUpdateSettings({ ...settings, targetLanguage: lang.code });
                  setShowLangPicker(false);
                }}
                style={{
                  padding: '9px 10px',
                  borderRadius: '12px',
                  textAlign: 'left',
                  fontSize: '13px',
                  fontWeight: 700,
                  background: active ? 'rgba(56, 189, 248, 0.24)' : 'rgba(255,255,255,0.05)',
                  border: active ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {lang.flag} {lang.koreanName}{' '}
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({lang.nativeName})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Popover: Persona, Level & Model Picker */}
      {showPersonaPicker && (
        <div
          className="glass-panel-strong anim-fade-up"
          style={{
            position: 'absolute',
            top: 'calc(62px + var(--safe-top))',
            left: '14px',
            right: '14px',
            zIndex: 30,
            borderRadius: '20px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            회화 상대 캐릭터
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {PERSONA_LIST.map((p) => {
              const active = settings.persona === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onUpdateSettings({ ...settings, persona: p.id });
                    setShowPersonaPicker(false);
                  }}
                  style={{
                    padding: '9px 10px',
                    borderRadius: '12px',
                    textAlign: 'left',
                    background: active ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                    border: active ? `1px solid ${p.accentColor}` : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>
                    {p.emoji} {p.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.koreanTitle}</div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            회화 난이도 (레벨)
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
                    padding: '7px',
                    borderRadius: '10px',
                    fontSize: '12px',
                    fontWeight: 700,
                    background: active ? 'rgba(52, 211, 153, 0.22)' : 'rgba(255,255,255,0.05)',
                    border: active ? '1px solid #34D399' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {lvl.koreanLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorBanner && (
        <div
          className="glass-panel anim-fade-up"
          style={{
            margin: '0 14px 8px',
            padding: '10px 12px',
            borderRadius: '14px',
            background: 'rgba(159, 18, 57, 0.78)',
            borderColor: 'rgba(251, 113, 133, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: '12.5px',
            flexShrink: 0,
          }}
        >
          <span>{errorBanner}</span>
          <button type="button" onClick={onClearError} aria-label="오류 닫기">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Main Content: Either Scenario Launcher OR Scrollable Chat Thread */}
      <div
        className="no-scrollbar"
        onClick={() => {
          if (showLangPicker) setShowLangPicker(false);
          if (showPersonaPicker) setShowPersonaPicker(false);
        }}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 14px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {!hasStarted ? (
          /* Scenario & Level Launcher */
          <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
              className="glass-panel"
              style={{
                borderRadius: '22px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    background: `${currentPersona.accentColor}26`,
                    border: `1px solid ${currentPersona.accentColor}66`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    flexShrink: 0,
                  }}
                >
                  {currentPersona.emoji}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15.5px', fontWeight: 800 }}>
                    {currentPersona.name}와 {currentLang.koreanName} 실전 회화
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    카메라 없이 가볍게! 레벨에 맞춰 먼저 말을 걸어드려요.
                  </div>
                </div>
              </div>

              {/* Level Selector right inside launcher */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                  {LEVEL_LIST.map((lvl) => {
                    const active = settings.level === lvl.id;
                    return (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => onUpdateSettings({ ...settings, level: lvl.id })}
                        style={{
                          padding: '8px 6px',
                          borderRadius: '12px',
                          fontSize: '12.5px',
                          fontWeight: 800,
                          background: active
                            ? 'rgba(52, 211, 153, 0.22)'
                            : 'rgba(255, 255, 255, 0.05)',
                          border: active
                            ? '1px solid rgba(52, 211, 153, 0.7)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          color: active ? '#A7F3D0' : 'var(--text-secondary)',
                        }}
                      >
                        {lvl.koreanLabel}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', paddingLeft: '2px' }}>
                  {settings.level === 'beginner'
                    ? '🌱 쉬운 단어 · 짧은 문장 + 한국어 번역 기본 표시'
                    : settings.level === 'intermediate'
                      ? '🌿 자연스러운 일상 회화 + 필요할 때만 번역 펼쳐보기'
                      : '🔥 원어민 뉘앙스 · 관용구 중심 + 1줄 표현 코칭'}
                </div>
              </div>
            </div>

            {/* Scenario Preset Grid */}
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', paddingLeft: '2px' }}>
              상황을 고르면 AI가 먼저 말을 걸어줘요
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {SCENARIO_PRESET_LIST.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    onUnlockAudio();
                    onStartScenario(sc.id);
                  }}
                  className="glass-panel"
                  style={{
                    borderRadius: '18px',
                    padding: '13px 12px',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    borderColor: `${sc.accentColor}44`,
                  }}
                >
                  <div style={{ fontSize: '22px' }}>{sc.emoji}</div>
                  <div style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {sc.title}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {sc.subtitle}
                  </div>
                </button>
              ))}
            </div>

            {/* Custom Topic Input Card */}
            <div
              className="glass-panel"
              style={{
                borderRadius: '18px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderColor: 'rgba(45, 212, 191, 0.35)',
              }}
            >
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#99F6E4' }}>
                ✏️ 원하는 상황·주제 직접 입력하기
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  className="field-input"
                  placeholder="예: 병원에서 증상 설명하기, 좋아하는 영화 얘기"
                  value={customTopicDraft}
                  onChange={(e) => setCustomTopicDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQuickStartCustom();
                  }}
                  style={{ fontSize: '13px', padding: '9px 12px' }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={isProcessing || !customTopicDraft.trim()}
                  onClick={handleQuickStartCustom}
                  style={{ padding: '0 14px', fontSize: '12.5px', flexShrink: 0 }}
                >
                  시작
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Active Conversation Thread */
          <>
            <div
              style={{
                alignSelf: 'center',
                padding: '5px 12px',
                borderRadius: '9999px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: '11.5px',
                color: 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {activeScenario.emoji}{' '}
              {activeChatSession.scenarioTitle ||
                activeChatSession.customTopic ||
                activeScenario.title}{' '}
              · {currentLevel.koreanLabel}
            </div>

            {activeChatSession.messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              const isLast = idx === activeChatSession.messages.length - 1;
              const isThisPlaying = playingMessageId === msg.id && ttsState !== 'idle';

              if (isUser) {
                return (
                  <div
                    key={msg.id}
                    className="anim-fade-up"
                    style={{
                      alignSelf: 'flex-end',
                      maxWidth: '84%',
                      padding: '10px 14px',
                      borderRadius: '18px 18px 4px 18px',
                      background:
                        'linear-gradient(135deg, rgba(56, 189, 248, 0.28), rgba(99, 102, 241, 0.32))',
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      fontSize: '14px',
                      lineHeight: 1.5,
                      fontWeight: 500,
                      color: '#F8FAFC',
                    }}
                  >
                    {msg.text}
                  </div>
                );
              }

              const showTr = isTranslationVisible(msg.id);

              return (
                <div
                  key={msg.id}
                  className="anim-fade-up"
                  style={{
                    alignSelf: 'flex-start',
                    maxWidth: '92%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  {/* Main AI Bubble */}
                  <div
                    className="glass-panel"
                    style={{
                      borderRadius: '18px 18px 18px 4px',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      borderColor: isThisPlaying
                        ? 'rgba(56, 189, 248, 0.65)'
                        : 'rgba(255, 255, 255, 0.14)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        fontSize: '11.5px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#BAE6FD' }}>
                        {currentPersona.emoji} {currentPersona.name}
                      </span>
                      <span>
                        {isThisPlaying
                          ? ttsState === 'loading'
                            ? '음성 준비중...'
                            : ttsEngine === 'gemini'
                              ? '🔊 Gemini 음성'
                              : '🔊 음성 재생'
                          : msg.latencyMs
                            ? `⚡ ${(msg.latencyMs / 1000).toFixed(1)}s`
                            : ''}
                      </span>
                    </div>

                    {/* Spoken Target-Language Reply */}
                    <div
                      onClick={() => {
                        if (!msg.text || isProcessing) return;
                        onUnlockAudio();
                        if (isThisPlaying) onStopTts();
                        else onSpeakMessage(msg);
                      }}
                      style={{
                        fontSize: '15px',
                        lineHeight: 1.55,
                        fontWeight: 600,
                        color: '#F8FAFC',
                        cursor: msg.text ? 'pointer' : undefined,
                      }}
                    >
                      {isLast && isProcessing && !msg.text ? (
                        <span style={{ color: '#BAE6FD', fontWeight: 500, fontSize: '13.5px' }}>
                          {processingStage} ({elapsedSec.toFixed(1)}초)
                        </span>
                      ) : (
                        <>
                          {msg.text}
                          {isLast && isProcessing && <span className="stream-cursor" />}
                        </>
                      )}
                    </div>

                    {/* Korean Translation (auto-open for beginner, toggleable for intermediate/advanced) */}
                    {msg.koreanTranslation && showTr && (
                      <div
                        style={{
                          fontSize: '12.5px',
                          lineHeight: 1.48,
                          color: '#CBD5E1',
                          paddingTop: '6px',
                          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                      >
                        {msg.koreanTranslation}
                      </div>
                    )}

                    {/* Bubble Actions Footer */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        marginTop: '2px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {msg.koreanTranslation && (
                          <button
                            type="button"
                            className="glass-pill"
                            onClick={() => toggleTranslation(msg.id)}
                            style={{ padding: '4px 9px', fontSize: '11px' }}
                          >
                            <Languages size={12} color="#94A3B8" />
                            {showTr ? '번역 숨기기' : '번역 보기'}
                          </button>
                        )}
                      </div>

                      {isLast && isProcessing ? (
                        <button
                          type="button"
                          className="glass-pill"
                          onClick={onCancelTurn}
                          style={{
                            padding: '4px 9px',
                            fontSize: '11px',
                            borderColor: 'rgba(251, 113, 133, 0.5)',
                            color: '#FECDD3',
                          }}
                        >
                          <X size={12} color="#FB7185" /> 취소
                        </button>
                      ) : msg.text ? (
                        <button
                          type="button"
                          className="glass-pill"
                          onClick={() => {
                            onUnlockAudio();
                            if (isThisPlaying) onStopTts();
                            else onSpeakMessage(msg);
                          }}
                          style={{ padding: '4px 9px', fontSize: '11px' }}
                        >
                          {isThisPlaying ? (
                            <>
                              <VolumeX size={12} color="#FB7185" /> 정지
                            </>
                          ) : (
                            <>
                              <Volume2 size={12} color="#38BDF8" /> 듣기
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Gentle 1-Line Coaching Tip */}
                  {msg.coachingTip && (
                    <div
                      style={{
                        borderRadius: '14px',
                        padding: '9px 11px',
                        background: 'rgba(16, 185, 129, 0.12)',
                        border: '1px solid rgba(52, 211, 153, 0.34)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            color: '#6EE7B7',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Sparkles size={11} /> 더 자연스러운 표현
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              onUnlockAudio();
                              onSpeakWord(msg.coachingTip!.betterPhrase);
                            }}
                            aria-label="교정 표현 듣기"
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '9999px',
                              background: 'rgba(255,255,255,0.08)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Volume2 size={12} color="#38BDF8" />
                          </button>
                          <button
                            type="button"
                            disabled={savedWordSet.has(
                              msg.coachingTip.betterPhrase.trim().toLowerCase(),
                            )}
                            onClick={() =>
                              onSaveExtractedVocab({
                                word: msg.coachingTip!.betterPhrase,
                                reading: msg.coachingTip!.betterPhrase,
                                koreanPronunciation: '',
                                meaning: msg.coachingTip!.koreanNote,
                                partOfSpeech: '교정 표현',
                                exampleTarget: msg.coachingTip!.betterPhrase,
                                exampleKorean: msg.coachingTip!.koreanNote,
                              })
                            }
                            style={{
                              padding: '3px 8px',
                              borderRadius: '9999px',
                              fontSize: '10.5px',
                              fontWeight: 800,
                              background: savedWordSet.has(
                                msg.coachingTip.betterPhrase.trim().toLowerCase(),
                              )
                                ? 'rgba(52, 211, 153, 0.28)'
                                : 'rgba(255,255,255,0.1)',
                              color: savedWordSet.has(
                                msg.coachingTip.betterPhrase.trim().toLowerCase(),
                              )
                                ? '#6EE7B7'
                                : '#E2E8F0',
                            }}
                          >
                            {savedWordSet.has(msg.coachingTip.betterPhrase.trim().toLowerCase())
                              ? '✓ 저장됨'
                              : '+ 단어장'}
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#ECFDF5' }}>
                        “{msg.coachingTip.betterPhrase}”
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#A7F3D0', lineHeight: 1.4 }}>
                        {msg.coachingTip.koreanNote}
                      </div>
                    </div>
                  )}

                  {/* Useful Expression Save Chips */}
                  {msg.extractedCards && msg.extractedCards.length > 0 && (
                    <div
                      className="no-scrollbar"
                      style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}
                    >
                      {msg.extractedCards.map((vc, vcIdx) => {
                        const isSaved = savedWordSet.has(vc.word.trim().toLowerCase());
                        return (
                          <div
                            key={`${msg.id}-vc-${vcIdx}`}
                            style={{
                              flexShrink: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '5px 8px 5px 10px',
                              borderRadius: '9999px',
                              background: 'rgba(15, 23, 42, 0.78)',
                              border: '1px solid rgba(56, 189, 248, 0.28)',
                              fontSize: '11.5px',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onUnlockAudio();
                                onSpeakWord(vc.word);
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                color: '#E0F2FE',
                                fontWeight: 700,
                              }}
                            >
                              <Volume2 size={11} color="#38BDF8" />
                              <span>{vc.word}</span>
                              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                                · {vc.meaning}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={isSaved}
                              onClick={() => onSaveExtractedVocab(vc)}
                              aria-label={isSaved ? '저장됨' : '단어장에 저장'}
                              style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '9999px',
                                background: isSaved
                                  ? 'rgba(52, 211, 153, 0.28)'
                                  : 'rgba(56, 189, 248, 0.24)',
                                color: isSaved ? '#34D399' : '#BAE6FD',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                fontWeight: 800,
                              }}
                            >
                              {isSaved ? '✓' : <Plus size={12} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <div ref={scrollEndRef} />
          </>
        )}
      </div>

      {/* Stuck-Helper: Suggested Reply Chips (only during active conversation) */}
      {hasStarted && activeSuggestions.length > 0 && (
        <div
          style={{
            padding: '4px 14px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#FDE68A',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Lightbulb size={12} /> 막힐 때 추천 답변 (탭해서 전송 · 🔊 발음 먼저 듣기)
          </div>
          <div className="no-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
            {activeSuggestions.map((hint, i) => (
              <div
                key={`hint-${i}`}
                style={{
                  flexShrink: 0,
                  maxWidth: '250px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 8px 7px 11px',
                  borderRadius: '14px',
                  background: 'rgba(30, 41, 59, 0.88)',
                  border: '1px solid rgba(251, 191, 36, 0.34)',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleSendText(hint.text)}
                  style={{
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#F8FAFC' }}>
                    {hint.text}
                  </span>
                  {hint.korean && (
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      {hint.korean}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnlockAudio();
                    onSpeakWord(hint.text);
                  }}
                  aria-label="추천 답변 발음 듣기"
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '9999px',
                    background: 'rgba(56, 189, 248, 0.16)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Volume2 size={13} color="#38BDF8" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Dock: Nav + Text Input + Voice Mic Orb */}
      <div
        style={{
          padding: '8px 12px calc(12px + var(--safe-bottom))',
          background: 'rgba(6, 9, 19, 0.88)',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenVocabBank}
          aria-label="단어장 열기"
          style={{ position: 'relative', width: '38px', height: '38px', flexShrink: 0 }}
        >
          <BookOpen size={17} />
          {savedCards.length > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                minWidth: '17px',
                height: '17px',
                padding: '0 4px',
                borderRadius: '9999px',
                background: '#38BDF8',
                color: '#061121',
                fontSize: '10px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {savedCards.length}
            </span>
          )}
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenPopper}
          aria-label="단어 게임"
          style={{ width: '38px', height: '38px', flexShrink: 0 }}
        >
          <Gamepad2 size={17} color="#34D399" />
        </button>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 6px 4px 12px',
            borderRadius: '9999px',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
          }}
        >
          <input
            type="text"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendText();
            }}
            placeholder={
              hasStarted
                ? `${currentLang.koreanName}나 한국어로 답해보세요...`
                : '먼저 주제를 고르거나 바로 말해보세요...'
            }
            disabled={isProcessing || isRecording}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '13.5px',
              color: 'var(--text-primary)',
              padding: '6px 0',
            }}
          />
          {textDraft.trim() && (
            <button
              type="button"
              onClick={() => handleSendText()}
              disabled={isProcessing}
              aria-label="메시지 전송"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '9999px',
                background: 'linear-gradient(135deg, #38BDF8, #6366F1)',
                color: '#061121',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Send size={15} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`mic-orb ${isRecording ? 'recording' : ''}`}
          onClick={handleMicToggle}
          disabled={isProcessing}
          aria-label={isRecording ? '녹음 멈추고 말하기' : '음성으로 말하기'}
          style={{ width: '48px', height: '48px' }}
        >
          {isRecording ? <Square size={18} fill="currentColor" /> : <Mic size={20} strokeWidth={2.3} />}
        </button>
      </div>
    </div>
  );
};
