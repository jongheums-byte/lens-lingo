import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  ChevronDown,
  Clock,
  Gamepad2,
  ImagePlus,
  Keyboard,
  Mic,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { LANGUAGE_LIST, LEVEL_LIST, TARGET_LANGUAGES } from '../config/languages';
import { PERSONA_LIST, PERSONAS } from '../config/personas';
import { playSfx, prepareAudioForGemini } from '../lib/audioUtils';
import { DEMO_SCENES, renderDemoSceneDataUrl, type DemoSceneId } from '../services/demoService';
import type { TtsPlaybackState } from '../services/ttsService';
import type {
  AppSettings,
  ChatMessage,
  LearningSession,
  SavedVocabCard,
  TtsEngineKind,
} from '../types/app';

interface CameraHudViewProps {
  settings: AppSettings;
  activeSession: LearningSession;
  savedCards: SavedVocabCard[];
  recentTrayCards: SavedVocabCard[];
  ttsState: TtsPlaybackState;
  ttsEngine: TtsEngineKind;
  activeSegmentIndex: number;
  isProcessing: boolean;
  processingStage: string;
  isExtractingCards: boolean;
  errorBanner: string | null;
  onClearError: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onSubmitTurn: (params: {
    imageDataUrl: string;
    audioBase64?: string;
    audioMimeType?: string;
    textQuestion?: string;
    demoSceneId?: DemoSceneId;
  }) => Promise<void>;
  onCancelTurn: () => void;
  onReplayTutorMessage: (msg: ChatMessage) => void;
  onStopTts: () => void;
  onUnlockAudio: () => void;
  onSpeakWord: (word: string) => void;
  onEditSticker: (card: SavedVocabCard) => void;
  onToggleSaveCard: (card: SavedVocabCard) => void;
  onOpenVocabBank: () => void;
  onOpenPopper: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

export const CameraHudView: React.FC<CameraHudViewProps> = ({
  settings,
  activeSession,
  savedCards,
  recentTrayCards,
  ttsState,
  ttsEngine,
  activeSegmentIndex,
  isProcessing,
  processingStage,
  isExtractingCards,
  errorBanner,
  onClearError,
  onUpdateSettings,
  onSubmitTurn,
  onCancelTurn,
  onReplayTutorMessage,
  onStopTts,
  onUnlockAudio,
  onSpeakWord,
  onEditSticker,
  onToggleSaveCard,
  onOpenVocabBank,
  onOpenPopper,
  onOpenHistory,
  onOpenSettings,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [useDemoBackdrop, setUseDemoBackdrop] = useState(settings.demoMode);
  const [demoSceneId, setDemoSceneId] = useState<DemoSceneId>('cafe');
  const [frozenFrameUrl, setFrozenFrameUrl] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

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

  const currentLang = TARGET_LANGUAGES[settings.targetLanguage];
  const currentPersona = PERSONAS[settings.persona];

  const latestTutorMsg = [...activeSession.messages]
    .reverse()
    .find((m) => m.role === 'tutor');
  const latestUserMsg = [...activeSession.messages]
    .reverse()
    .find((m) => m.role === 'user');

  useEffect(() => {
    if (!settings.demoMode && !cameraDenied) {
      setUseDemoBackdrop(false);
    }
  }, [settings.demoMode, cameraDenied]);

  // Initialize live camera stream when not using demo backdrop
  useEffect(() => {
    if (useDemoBackdrop) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraReady(false);
      return;
    }

    let cancelled = false;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraDenied(true);
        setUseDemoBackdrop(true);
        return;
      }
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
        setCameraDenied(false);
      } catch {
        if (!cancelled) {
          setCameraDenied(true);
          setCameraReady(false);
          setUseDemoBackdrop(true);
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facingMode, useDemoBackdrop]);

  // Capture current visual frame (frozen frame -> live video -> demo scene)
  const captureCurrentImageDataUrl = (): string => {
    if (frozenFrameUrl) return frozenFrameUrl;

    if (cameraReady && videoRef.current && videoRef.current.videoWidth > 0) {
      const vid = videoRef.current;
      const maxDim = 512;
      const ratio = Math.min(1, maxDim / Math.max(vid.videoWidth, vid.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vid.videoWidth * ratio);
      canvas.height = Math.round(vid.videoHeight * ratio);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.68);
      }
    }

    return renderDemoSceneDataUrl(demoSceneId);
  };

  const handleQuickScan = async () => {
    onUnlockAudio();
    playSfx('shutter');
    const imgUrl = captureCurrentImageDataUrl();
    setFrozenFrameUrl(imgUrl);
    await onSubmitTurn({
      imageDataUrl: imgUrl,
      demoSceneId: useDemoBackdrop || !cameraReady ? demoSceneId : undefined,
    });
  };

  const handleSendText = async () => {
    const q = textDraft.trim();
    if (!q || isProcessing) return;
    onUnlockAudio();
    const imgUrl = captureCurrentImageDataUrl();
    setFrozenFrameUrl(imgUrl);
    setTextDraft('');
    setShowKeyboard(false);
    await onSubmitTurn({
      imageDataUrl: imgUrl,
      textQuestion: q,
      demoSceneId: useDemoBackdrop || !cameraReady ? demoSceneId : undefined,
    });
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
      setShowKeyboard(true);
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

        const imgUrl = captureCurrentImageDataUrl();
        setFrozenFrameUrl(imgUrl);

        try {
          const { base64, mimeType } = await prepareAudioForGemini(blob);
          await onSubmitTurn({
            imageDataUrl: imgUrl,
            audioBase64: base64,
            audioMimeType: mimeType,
            demoSceneId: useDemoBackdrop || !cameraReady ? demoSceneId : undefined,
          });
        } catch {
          await onSubmitTurn({
            imageDataUrl: imgUrl,
            textQuestion: currentLang.sampleQuestion,
            demoSceneId: useDemoBackdrop || !cameraReady ? demoSceneId : undefined,
          });
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      playSfx('micStart');
      setIsRecording(true);
    } catch {
      setShowKeyboard(true);
    }
  };

  const handleGalleryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxDim = 640;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressedUrl = canvas.toDataURL('image/jpeg', 0.72);
        setFrozenFrameUrl(compressedUrl);
        onUnlockAudio();
        await onSubmitTurn({ imageDataUrl: compressedUrl });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const savedIdSet = new Set(savedCards.map((c) => c.id));
  const demoSceneImg = renderDemoSceneDataUrl(demoSceneId);

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', background: '#070b18' }}>
      {/* Background Viewport Layer */}
      {frozenFrameUrl ? (
        <img
          src={frozenFrameUrl}
          alt="고정된 장면"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : useDemoBackdrop || !cameraReady ? (
        <img
          src={demoSceneImg}
          alt="데모 AR 장면"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : null}

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: frozenFrameUrl || useDemoBackdrop || !cameraReady ? 'none' : 'block',
          transform: facingMode === 'user' ? 'scaleX(-1)' : undefined,
        }}
      />

      {/* Top & Bottom Gradient Scrims for crisp readability */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(6,9,19,0.72) 0%, rgba(6,9,19,0.08) 28%, rgba(6,9,19,0.18) 56%, rgba(6,9,19,0.92) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* AR Corner Reticle */}
      <div className={`ar-reticle ${isProcessing ? 'scanning' : ''}`}>
        <div className="ar-corner tl" />
        <div className="ar-corner tr" />
        <div className="ar-corner bl" />
        <div className="ar-corner br" />
        {isProcessing && <div className="ar-scan-beam" />}
      </div>

      {/* Top Glass HUD Bar */}
      <header
        style={{
          position: 'relative',
          zIndex: 15,
          padding: 'calc(12px + var(--safe-top)) 14px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
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
            style={{
              borderColor: `${currentPersona.accentColor}66`,
            }}
          >
            <span>{currentPersona.emoji}</span>
            <span style={{ maxWidth: '88px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentPersona.name}
            </span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button type="button" className="icon-btn" onClick={onOpenHistory} aria-label="학습 기록">
            <Clock size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="설정">
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </header>

      {/* Mode Status & Demo Scene Switcher Chips */}
      <div
        className="no-scrollbar"
        style={{
          position: 'relative',
          zIndex: 14,
          padding: '2px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          overflowX: 'auto',
        }}
      >
        {settings.demoMode && (
          <span
            className="glass-pill"
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              background: 'rgba(251, 191, 36, 0.18)',
              borderColor: 'rgba(251, 191, 36, 0.45)',
              color: '#FDE68A',
              flexShrink: 0,
            }}
          >
            ✨ 데모 모드
          </span>
        )}

        {frozenFrameUrl ? (
          <button
            type="button"
            className="glass-pill"
            onClick={() => setFrozenFrameUrl(null)}
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              background: 'rgba(56, 189, 248, 0.22)',
              borderColor: 'rgba(56, 189, 248, 0.5)',
              flexShrink: 0,
            }}
          >
            <span>📌 고정된 장면으로 대화 중</span>
            <X size={12} />
          </button>
        ) : null}

        {(useDemoBackdrop || !cameraReady) &&
          DEMO_SCENES.map((sc) => {
            const active = demoSceneId === sc.id && !frozenFrameUrl;
            return (
              <button
                key={sc.id}
                type="button"
                className="glass-pill"
                onClick={() => {
                  setFrozenFrameUrl(null);
                  setDemoSceneId(sc.id);
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: '11.5px',
                  flexShrink: 0,
                  background: active ? 'rgba(56, 189, 248, 0.24)' : undefined,
                  borderColor: active ? '#38BDF8' : undefined,
                }}
              >
                {sc.badge}
              </button>
            );
          })}

        {!settings.demoMode && (
          <button
            type="button"
            className="glass-pill"
            onClick={() =>
              onUpdateSettings({
                ...settings,
                tutorModel:
                  settings.tutorModel === 'gemini-3.5-flash-lite'
                    ? 'gemini-3.8-flash'
                    : 'gemini-3.5-flash-lite',
              })
            }
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              flexShrink: 0,
              background:
                settings.tutorModel === 'gemini-3.5-flash-lite'
                  ? 'rgba(56, 189, 248, 0.2)'
                  : 'rgba(167, 139, 250, 0.2)',
              borderColor:
                settings.tutorModel === 'gemini-3.5-flash-lite'
                  ? 'rgba(56, 189, 248, 0.5)'
                  : 'rgba(167, 139, 250, 0.5)',
            }}
          >
            {settings.tutorModel === 'gemini-3.5-flash-lite' ? '⚡ 3.5 Lite' : '🎯 3.8 Flash'}
          </button>
        )}

        {!cameraDenied && (
          <button
            type="button"
            className="glass-pill"
            onClick={() => {
              setFrozenFrameUrl(null);
              setUseDemoBackdrop((v) => !v);
            }}
            style={{ padding: '4px 10px', fontSize: '11.5px', flexShrink: 0 }}
          >
            <Camera size={12} />
            {useDemoBackdrop ? '실제 카메라 켜기' : '샘플 장면 보기'}
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

      {/* Popover: Persona & Level Picker */}
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
            튜터 캐릭터 선택
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
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            응답 속도 / AI 모델
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ ...settings, tutorModel: 'gemini-3.5-flash-lite' })
              }
              style={{
                padding: '8px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 700,
                background:
                  settings.tutorModel === 'gemini-3.5-flash-lite'
                    ? 'rgba(56, 189, 248, 0.24)'
                    : 'rgba(255,255,255,0.05)',
                border:
                  settings.tutorModel === 'gemini-3.5-flash-lite'
                    ? '1px solid #38BDF8'
                    : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              ⚡ 초고속 3.5 Lite
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ ...settings, tutorModel: 'gemini-3.8-flash' })
              }
              style={{
                padding: '8px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 700,
                background:
                  settings.tutorModel === 'gemini-3.8-flash'
                    ? 'rgba(167, 139, 250, 0.24)'
                    : 'rgba(255,255,255,0.05)',
                border:
                  settings.tutorModel === 'gemini-3.8-flash'
                    ? '1px solid #A78BFA'
                    : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              🎯 고정확 3.8 Flash
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorBanner && (
        <div
          className="glass-panel anim-fade-up"
          style={{
            position: 'relative',
            zIndex: 20,
            margin: '8px 14px 0',
            padding: '10px 12px',
            borderRadius: '14px',
            background: 'rgba(159, 18, 57, 0.78)',
            borderColor: 'rgba(251, 113, 133, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: '12.5px',
          }}
        >
          <span>{errorBanner}</span>
          <button type="button" onClick={onClearError} aria-label="오류 닫기">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Bottom Floating HUD Stack */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 12,
          padding: '0 14px calc(14px + var(--safe-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {/* Floating Bilingual Tutor Caption Card */}
        {latestTutorMsg ? (
          <div
            className="glass-panel anim-fade-up"
            style={{
              borderRadius: '22px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {latestUserMsg && (
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  나: {latestUserMsg.text}
                </span>
                <span style={{ flexShrink: 0, color: '#BAE6FD', marginLeft: '8px' }}>
                  {ttsState === 'playing'
                    ? ttsEngine === 'gemini'
                      ? 'Gemini 실시간 음성'
                      : '브라우저 음성'
                    : ttsState === 'loading'
                      ? '음성 준비중...'
                      : latestTutorMsg.latencyMs
                        ? `⚡ ${(latestTutorMsg.latencyMs / 1000).toFixed(1)}s`
                        : ''}
                </span>
              </div>
            )}

            <div style={{ fontSize: '14.5px', lineHeight: 1.58, fontWeight: 500 }}>
              {isProcessing && !latestTutorMsg.text ? (
                <span style={{ color: '#BAE6FD' }}>
                  {processingStage} ({elapsedSec.toFixed(1)}초)
                </span>
              ) : (
                <>
                  {(latestTutorMsg.segments && latestTutorMsg.segments.length > 0
                    ? latestTutorMsg.segments
                    : [{ text: latestTutorMsg.text, isTarget: false }]
                  ).map((seg, idx) => {
                    const isActive = ttsState === 'playing' && activeSegmentIndex === idx;
                    return (
                      <span
                        key={idx}
                        className={`${seg.isTarget ? 'seg-target' : 'seg-native'} ${isActive ? 'active' : ''}`}
                        onClick={seg.isTarget ? () => onSpeakWord(seg.text) : undefined}
                        style={{ cursor: seg.isTarget ? 'pointer' : undefined }}
                      >
                        {seg.text}
                      </span>
                    );
                  })}
                  {isProcessing && <span className="stream-cursor" />}
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11.5px',
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {isProcessing
                  ? `${settings.tutorModel === 'gemini-3.5-flash-lite' ? '⚡ 3.5 Lite' : '🎯 3.8 Flash'} 분석 중`
                  : latestTutorMsg.translationSummary}
              </span>

              {isProcessing ? (
                <button
                  type="button"
                  className="glass-pill"
                  onClick={onCancelTurn}
                  style={{
                    padding: '5px 10px',
                    fontSize: '11.5px',
                    flexShrink: 0,
                    borderColor: 'rgba(251, 113, 133, 0.5)',
                    color: '#FECDD3',
                  }}
                >
                  <X size={13} color="#FB7185" /> 취소
                </button>
              ) : (
                <button
                  type="button"
                  className="glass-pill"
                  onClick={() => {
                    onUnlockAudio();
                    if (ttsState !== 'idle') onStopTts();
                    else onReplayTutorMessage(latestTutorMsg);
                  }}
                  style={{ padding: '5px 10px', fontSize: '11.5px', flexShrink: 0 }}
                >
                  {ttsState === 'playing' || ttsState === 'loading' ? (
                    <>
                      <VolumeX size={13} color="#FB7185" /> 정지
                    </>
                  ) : (
                    <>
                      <Volume2 size={13} color="#38BDF8" /> 다시 듣기
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            className="glass-panel"
            style={{
              borderRadius: '20px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 700 }}>
                {currentPersona.emoji} 무엇이든 비추고 물어보세요!
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                마이크 버튼을 눌러 말하거나 📸 스캔 버튼을 눌러보세요.
              </div>
            </div>
            <Sparkles size={20} color="#38BDF8" />
          </div>
        )}

        {/* Horizontal Sticker Vocab Tray (or Shimmer Placeholders while Pass 2 extracts cards) */}
        {(recentTrayCards.length > 0 || isExtractingCards) && (
          <div
            className="no-scrollbar"
            style={{
              display: 'flex',
              gap: '10px',
              overflowX: 'auto',
              padding: '2px 2px',
            }}
          >
            {isExtractingCards &&
              recentTrayCards.length === 0 &&
              [0, 1].map((idx) => (
                <div
                  key={`shimmer-${idx}`}
                  className="glass-panel shimmer-card"
                  style={{
                    flexShrink: 0,
                    width: '200px',
                    height: '74px',
                    borderRadius: '18px',
                    padding: '9px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      width: '52px',
                      height: '52px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.12)',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div
                      style={{
                        height: '12px',
                        width: '72%',
                        borderRadius: '6px',
                        background: 'rgba(255,255,255,0.16)',
                      }}
                    />
                    <div
                      style={{
                        height: '10px',
                        width: '52%',
                        borderRadius: '5px',
                        background: 'rgba(56,189,248,0.2)',
                      }}
                    />
                  </div>
                </div>
              ))}
            {recentTrayCards.map((card) => {
              const isSaved = savedIdSet.has(card.id);
              return (
                <div
                  key={card.id}
                  className="glass-panel anim-fade-up"
                  style={{
                    flexShrink: 0,
                    width: '216px',
                    borderRadius: '18px',
                    padding: '9px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                  }}
                >
                  <img
                    src={card.stickerDataUrl}
                    alt={card.word}
                    onClick={() => onEditSticker(card)}
                    style={{
                      width: '56px',
                      height: '56px',
                      objectFit: 'contain',
                      flexShrink: 0,
                      cursor: 'pointer',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card.word}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#7DD3FC',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card.koreanPronunciation || card.reading}
                    </div>
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card.meaning}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => onSpeakWord(card.word)}
                      aria-label="단어 발음 듣기"
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '9999px',
                        background: 'rgba(255,255,255,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Volume2 size={13} color="#38BDF8" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSaveCard(card)}
                      aria-label={isSaved ? '저장됨' : '저장하기'}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '9999px',
                        background: isSaved ? 'rgba(52, 211, 153, 0.25)' : 'rgba(255,255,255,0.08)',
                        color: isSaved ? '#34D399' : '#CBD5E1',
                        fontSize: '11px',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSaved ? '✓' : '+'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quiet-mode Text Input Drawer */}
        {showKeyboard && (
          <div
            className="glass-panel-strong anim-fade-up"
            style={{
              borderRadius: '18px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div className="no-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
              {['이건 뭐예요?', '어떻게 주문해요?', '비슷한 회화 표현 알려줘'].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="glass-pill"
                  onClick={() => setTextDraft(chip)}
                  style={{ padding: '4px 10px', fontSize: '11.5px', flexShrink: 0 }}
                >
                  {chip}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="field-input"
                placeholder={`${currentLang.koreanName}로 물어보고 싶은 내용을 입력하세요...`}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendText();
                }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={handleSendText}
                disabled={isProcessing || !textDraft.trim()}
                style={{ padding: '0 14px', flexShrink: 0 }}
                aria-label="질문 전송"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Bottom Thumb Control Dock */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '4px',
            paddingTop: '2px',
          }}
        >
          {/* Left Navigation Cluster */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              className="icon-btn"
              onClick={onOpenVocabBank}
              aria-label="단어장 열기"
              style={{ position: 'relative', width: '38px', height: '38px' }}
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
              style={{ width: '38px', height: '38px' }}
            >
              <Gamepad2 size={17} color="#34D399" />
            </button>
          </div>

          {/* Center Action Cluster: Quick Scan + Expressive Mic Orb + Keyboard */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
            <button
              type="button"
              className="glass-pill"
              onClick={isProcessing ? onCancelTurn : handleQuickScan}
              disabled={isRecording}
              style={{
                padding: '8px 10px',
                gap: '4px',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                background: isProcessing ? 'rgba(159, 18, 57, 0.78)' : 'rgba(15, 23, 42, 0.85)',
                borderColor: isProcessing ? 'rgba(251, 113, 133, 0.55)' : undefined,
              }}
            >
              {isProcessing ? <X size={14} color="#FECDD3" /> : <Camera size={14} color="#38BDF8" />}
              <span>{isProcessing ? '취소' : '스캔'}</span>
            </button>

            <button
              type="button"
              className={`mic-orb ${isRecording ? 'recording' : ''}`}
              onClick={handleMicToggle}
              disabled={isProcessing}
              aria-label={isRecording ? '녹음 멈추고 질문하기' : '음성으로 질문하기'}
            >
              {isRecording ? <Square size={22} fill="currentColor" /> : <Mic size={24} strokeWidth={2.3} />}
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowKeyboard((v) => !v)}
              aria-label="텍스트 입력 열기"
              style={{
                width: '38px',
                height: '38px',
                background: showKeyboard ? 'rgba(56, 189, 248, 0.25)' : undefined,
                borderColor: showKeyboard ? '#38BDF8' : undefined,
              }}
            >
              <Keyboard size={17} />
            </button>
          </div>

          {/* Right Media Cluster */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => galleryInputRef.current?.click()}
              aria-label="앨범 사진 불러오기"
              style={{ width: '38px', height: '38px' }}
            >
              <ImagePlus size={17} />
            </button>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleGalleryUpload}
            />

            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setFrozenFrameUrl(null);
                if (useDemoBackdrop || !cameraReady) {
                  const idx = DEMO_SCENES.findIndex((s) => s.id === demoSceneId);
                  setDemoSceneId(DEMO_SCENES[(idx + 1) % DEMO_SCENES.length].id);
                } else {
                  setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
                }
              }}
              aria-label="카메라 전환"
              style={{ width: '38px', height: '38px' }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
