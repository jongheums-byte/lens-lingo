import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Flame,
  Gamepad2,
  Heart,
  Mic,
  MousePointerClick,
  Play,
  RotateCcw,
  Sparkles,
  Trophy,
  Volume2,
} from 'lucide-react';
import { TARGET_LANGUAGES } from '../config/languages';
import { playSfx } from '../lib/audioUtils';
import {
  createPopperState,
  handlePopperSpeech,
  handlePopperTap,
  POPPER_DIFFICULTY_CONFIG,
  stepPopperState,
  toPopperDeckItem,
  type PopperDeckItem,
  type PopperDifficulty,
  type PopperDurationSec,
  type PopperGameState,
  type PopperMode,
} from '../lib/vocabPopperEngine';
import type { AppSettings, SavedVocabCard, TargetLanguageCode } from '../types/app';

interface VocabPopperViewProps {
  cards: SavedVocabCard[];
  settings: AppSettings;
  onBack: () => void;
  onSpeakWord: (word: string, language: TargetLanguageCode) => void;
  onBestScore: (score: number) => void;
  onCreateStarterCards: (language: TargetLanguageCode) => Promise<void>;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstanceLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const PARTICLE_COLORS = ['#38BDF8', '#34D399', '#FBBF24', '#A78BFA', '#FB7185'];

export const VocabPopperView: React.FC<VocabPopperViewProps> = ({
  cards,
  settings,
  onBack,
  onSpeakWord,
  onBestScore,
  onCreateStarterCards,
}) => {
  const hasAsrSupport = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  const [mode, setMode] = useState<PopperMode>(hasAsrSupport ? 'speak' : 'tap');
  const [durationSec, setDurationSec] = useState<PopperDurationSec>(60);
  const [difficulty, setDifficulty] = useState<PopperDifficulty>('normal');
  const [gameState, setGameState] = useState<PopperGameState | null>(null);
  const [heardText, setHeardText] = useState<string>('');
  const [asrStatus, setAsrStatus] = useState<string>('');
  const [creatingDeck, setCreatingDeck] = useState(false);

  const deckCards = useMemo(() => {
    const langCards = cards.filter((c) => c.language === settings.targetLanguage);
    return langCards.length >= 3 ? langCards : cards;
  }, [cards, settings.targetLanguage]);

  const deckItems: PopperDeckItem[] = useMemo(
    () => deckCards.map((c) => toPopperDeckItem(c)),
    [deckCards],
  );

  const deckRef = useRef<PopperDeckItem[]>(deckItems);
  deckRef.current = deckItems;

  const gameStateRef = useRef<PopperGameState | null>(null);
  gameStateRef.current = gameState;

  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const activeRunRef = useRef(false);

  // Stop ASR cleanly when unmounting or ending round
  const stopAsr = () => {
    activeRunRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopAsr();
  }, []);

  // Main physics loop when playing
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') {
      stopAsr();
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dtMs = now - lastTime;
      lastTime = now;

      setGameState((prev) => {
        if (!prev || prev.phase !== 'playing') return prev;
        const { state: next, events } = stepPopperState(prev, dtMs, deckRef.current);
        for (const ev of events) {
          if (ev === 'gameover') {
            playSfx('fanfare');
            if (next.score > settings.vocabPopperBestScore) {
              onBestScore(next.score);
            }
          }
        }
        return next;
      });

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [gameState?.phase, onBestScore, settings.vocabPopperBestScore]);

  // Speak prompt automatically when TAP prompt changes
  useEffect(() => {
    if (gameState?.phase === 'playing' && gameState.mode === 'tap' && gameState.promptItem) {
      const lang =
        deckCards.find((c) => c.id === gameState.promptItem?.id)?.language ||
        settings.targetLanguage;
      onSpeakWord(gameState.promptItem.displayWord, lang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, gameState?.mode, gameState?.promptItem?.id]);

  // Start Web Speech ASR when in SPEAK mode
  const startAsrSession = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setAsrStatus('현재 브라우저는 실시간 음성 인식을 지원하지 않아 탭으로 터뜨릴 수도 있어요.');
      return;
    }

    stopAsr();
    activeRunRef.current = true;

    const launch = () => {
      if (!activeRunRef.current) return;
      const rec = new Ctor();
      rec.lang = TARGET_LANGUAGES[settings.targetLanguage].bcp47;
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = (ev) => {
        let latest = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          latest += ` ${ev.results[i][0]?.transcript || ''}`;
        }
        const trimmed = latest.trim();
        if (!trimmed) return;
        setHeardText(trimmed);

        setGameState((prev) => {
          if (!prev || prev.phase !== 'playing') return prev;
          const res = handlePopperSpeech(prev, trimmed);
          if (res.poppedItems.length > 0) {
            playSfx('pop');
          }
          return res.state;
        });
      };

      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed') {
          setAsrStatus('마이크 권한이 거부되었습니다. TAP 모드로 전환해 즐겨보세요.');
          activeRunRef.current = false;
        }
      };

      rec.onend = () => {
        if (activeRunRef.current && gameStateRef.current?.phase === 'playing') {
          window.setTimeout(launch, 150);
        }
      };

      try {
        rec.start();
        recognitionRef.current = rec;
        setAsrStatus('🎙️ 날아오는 단어 스티커를 소리 내어 읽어보세요!');
      } catch {
        setAsrStatus('음성 인식을 시작할 수 없어 TAP 조작도 함께 지원합니다.');
      }
    };

    launch();
  };

  const handleStartGame = async () => {
    if (deckItems.length < 3) {
      setCreatingDeck(true);
      try {
        await onCreateStarterCards(settings.targetLanguage);
      } finally {
        setCreatingDeck(false);
      }
      return;
    }

    setHeardText('');
    setAsrStatus('');
    const initial = createPopperState(mode, difficulty, durationSec, deckItems);
    setGameState(initial);
    if (mode === 'speak') {
      startAsrSession();
    }
  };

  const handleTargetClick = (targetId: number) => {
    setGameState((prev) => {
      if (!prev || prev.phase !== 'playing') return prev;
      const { state: next, event } = handlePopperTap(prev, targetId, deckRef.current);
      if (event === 'pop') playSfx('pop');
      else if (event === 'wrong') playSfx('wrong');
      else if (event === 'gameover') {
        playSfx('fanfare');
        if (next.score > settings.vocabPopperBestScore) {
          onBestScore(next.score);
        }
      }
      return next;
    });
  };

  // 1. Setup Screen
  if (!gameState) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background:
            'radial-gradient(circle at top, rgba(56, 189, 248, 0.16), #0b1020 55%)',
          padding: 'calc(14px + var(--safe-top)) 16px calc(22px + var(--safe-bottom))',
          overflowY: 'auto',
          gap: '16px',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button type="button" className="icon-btn" onClick={onBack} aria-label="돌아가기">
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Vocab Popper</h1>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                스티커 발음 & 순발력 복습 게임
              </div>
            </div>
          </div>

          <div className="glass-pill" style={{ borderColor: 'rgba(251,191,36,0.4)' }}>
            <Trophy size={14} color="#FBBF24" />
            <span>최고 {settings.vocabPopperBestScore}</span>
          </div>
        </header>

        <div
          className="glass-panel"
          style={{
            borderRadius: '22px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              플레이 방식
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setMode('speak')}
                style={{
                  padding: '12px',
                  borderRadius: '16px',
                  textAlign: 'left',
                  background: mode === 'speak' ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255,255,255,0.05)',
                  border: mode === 'speak' ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '14px' }}>
                  <Mic size={16} color="#38BDF8" /> 말하기 (SPEAK)
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  날아오는 단어를 소리 내어 발음하면 펑!
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('tap')}
                style={{
                  padding: '12px',
                  borderRadius: '16px',
                  textAlign: 'left',
                  background: mode === 'tap' ? 'rgba(52, 211, 153, 0.22)' : 'rgba(255,255,255,0.05)',
                  border: mode === 'tap' ? '1px solid #34D399' : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '14px' }}>
                  <MousePointerClick size={16} color="#34D399" /> 탭하기 (TAP)
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  들려주는 뜻/발음에 맞는 스티커를 터치!
                </div>
              </button>
            </div>
            {!hasAsrSupport && mode === 'speak' && (
              <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#FDE68A' }}>
                ⚠️ 이 브라우저에서는 Web Speech 음성 인식이 제한될 수 있어 <strong>탭하기(TAP)</strong> 모드를 권장합니다.
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              제한 시간
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {([30, 60, 90] as PopperDurationSec[]).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setDurationSec(sec)}
                  style={{
                    padding: '10px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '13px',
                    background: durationSec === sec ? 'rgba(56, 189, 248, 0.24)' : 'rgba(255,255,255,0.05)',
                    border: durationSec === sec ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {sec}초
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              난이도
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {(['easy', 'normal', 'hard'] as PopperDifficulty[]).map((diff) => (
                <button
                  key={diff}
                  type="button"
                  onClick={() => setDifficulty(diff)}
                  style={{
                    padding: '10px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '13px',
                    background: difficulty === diff ? 'rgba(167, 139, 250, 0.24)' : 'rgba(255,255,255,0.05)',
                    border: difficulty === diff ? '1px solid #A78BFA' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {POPPER_DIFFICULTY_CONFIG[diff].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Deck readiness */}
        <div
          className="glass-panel"
          style={{
            borderRadius: '18px',
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 700 }}>
              준비된 단어 카드: {deckItems.length}개
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {deckItems.length >= 3
                ? `${TARGET_LANGUAGES[settings.targetLanguage].flag} 저장된 스티커로 바로 시작합니다`
                : '최소 3개의 단어 카드가 필요해요 (스타터 덱 자동 생성 가능)'}
            </div>
          </div>
          <Gamepad2 size={22} color="#34D399" />
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={handleStartGame}
          disabled={creatingDeck}
          style={{ width: '100%', padding: '15px', fontSize: '15px', marginTop: 'auto' }}
        >
          {deckItems.length < 3 ? (
            <>
              <Sparkles size={17} />
              {creatingDeck ? '스타터 스티커 생성 중...' : '스타터 덱 4개 생성하기'}
            </>
          ) : (
            <>
              <Play size={17} fill="currentColor" /> 게임 시작하기
            </>
          )}
        </button>
      </div>
    );
  }

  // 2. End Summary Screen
  if (gameState.phase === 'ended') {
    const isNewBest = gameState.score > 0 && gameState.score >= settings.vocabPopperBestScore;
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #0b1020 0%, #111827 100%)',
          padding: 'calc(18px + var(--safe-top)) 16px calc(22px + var(--safe-bottom))',
          overflowY: 'auto',
          gap: '14px',
        }}
      >
        <div
          className="glass-panel-strong anim-fade-up"
          style={{
            borderRadius: '24px',
            padding: '22px 16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Trophy size={36} color={isNewBest ? '#FBBF24' : '#38BDF8'} />
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#BAE6FD' }}>
            {gameState.endReason === 'out_of_lives' ? '하트가 모두 소진되었어요!' : '라운드 종료!'}
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: '#FFFFFF' }}>
            {gameState.score}점
          </div>
          {isNewBest && (
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '9999px',
                background: 'rgba(251, 191, 36, 0.2)',
                border: '1px solid rgba(251, 191, 36, 0.5)',
                color: '#FDE68A',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              🎉 신기록 달성!
            </span>
          )}

          <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span>성공 {gameState.poppedCount}개</span>
            <span>·</span>
            <span>최대 콤보 {gameState.maxCombo}x</span>
          </div>
        </div>

        {/* Review words */}
        <div
          className="glass-panel no-scrollbar"
          style={{
            flex: 1,
            borderRadius: '20px',
            padding: '14px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            이번 라운드 단어 복습
          </div>
          {[...gameState.missedWords, ...gameState.poppedWords].length === 0 ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
              아직 맞춘 단어가 없어요. 다시 도전해 보세요!
            </div>
          ) : (
            [...gameState.missedWords, ...gameState.poppedWords].map((item, idx) => {
              const isMissed = idx < gameState.missedWords.length;
              return (
                <div
                  key={`${item.id}-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '14px',
                    background: isMissed
                      ? 'rgba(251, 113, 133, 0.12)'
                      : 'rgba(52, 211, 153, 0.12)',
                  }}
                >
                  <img
                    src={item.stickerDataUrl}
                    alt={item.word}
                    style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{item.word}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.meaning}</div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onSpeakWord(item.displayWord, settings.targetLanguage)}
                    aria-label="발음 듣기"
                    style={{ width: '34px', height: '34px' }}
                  >
                    <Volume2 size={15} color="#38BDF8" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              stopAsr();
              setGameState(null);
            }}
            style={{ flex: 1 }}
          >
            설정으로
          </button>
          <button type="button" className="btn-primary" onClick={handleStartGame} style={{ flex: 1.5 }}>
            <RotateCcw size={15} /> 다시 하기
          </button>
        </div>
      </div>
    );
  }

  // 3. Live Arena
  const timePct = Math.max(0, Math.min(100, (gameState.remainingMs / (gameState.durationSec * 1000)) * 100));

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'radial-gradient(circle at 50% 25%, #162447 0%, #070b18 75%)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Top HUD */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: 'calc(12px + var(--safe-top)) 14px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              stopAsr();
              setGameState(null);
            }}
            aria-label="게임 나가기"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="glass-pill" style={{ gap: '8px' }}>
            <span style={{ fontWeight: 800, color: '#38BDF8' }}>{gameState.score}점</span>
            {gameState.combo > 1 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', color: '#FBBF24' }}>
                <Flame size={13} /> {gameState.combo}x
              </span>
            )}
          </div>

          {gameState.mode === 'tap' ? (
            <div className="glass-pill" style={{ gap: '4px' }}>
              {[0, 1, 2].map((i) => (
                <Heart
                  key={i}
                  size={15}
                  fill={i < gameState.lives ? '#FB7185' : 'transparent'}
                  color={i < gameState.lives ? '#FB7185' : '#475569'}
                />
              ))}
            </div>
          ) : (
            <div className="glass-pill" style={{ borderColor: 'rgba(56,189,248,0.45)' }}>
              <Mic size={14} color="#38BDF8" /> 음성 인식 중
            </div>
          )}
        </div>

        {/* Timer Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              flex: 1,
              height: '6px',
              borderRadius: '9999px',
              background: 'rgba(255,255,255,0.12)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${timePct}%`,
                height: '100%',
                background: timePct < 25 ? '#FB7185' : 'linear-gradient(90deg, #38BDF8, #34D399)',
                transition: 'width 0.1s linear',
              }}
            />
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, minWidth: '34px', textAlign: 'right' }}>
            {Math.ceil(gameState.remainingMs / 1000)}s
          </span>
        </div>

        {/* Prompt Banner */}
        {gameState.mode === 'tap' && gameState.promptItem ? (
          <div
            className="glass-panel"
            style={{
              borderRadius: '16px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>이 뜻에 맞는 스티커를 터치!</div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#A7F3D0' }}>
                {gameState.promptItem.meaning}
              </div>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() =>
                onSpeakWord(gameState.promptItem!.displayWord, settings.targetLanguage)
              }
              aria-label="단어 다시 듣기"
            >
              <Volume2 size={16} color="#38BDF8" />
            </button>
          </div>
        ) : (
          <div
            className="glass-panel"
            style={{
              borderRadius: '14px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#BAE6FD',
              textAlign: 'center',
            }}
          >
            {heardText ? `인식됨: "${heardText}"` : asrStatus || '날아오는 단어를 말하거나 직접 터치하세요!'}
          </div>
        )}
      </div>

      {/* Physics Arena */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {gameState.targets.map((target) => {
          const scale =
            target.popProgress !== null
              ? 1 + target.popProgress * 0.45
              : target.dismissProgress !== null
                ? 1 - target.dismissProgress * 0.4
                : 1;
          const opacity =
            target.popProgress !== null
              ? Math.max(0, 1 - target.popProgress)
              : target.dismissProgress !== null
                ? Math.max(0, 1 - target.dismissProgress)
                : 1;

          return (
            <button
              key={target.id}
              type="button"
              onClick={() => handleTargetClick(target.id)}
              style={{
                position: 'absolute',
                left: `${target.x * 100}%`,
                top: `${target.y * 100}%`,
                transform: `translate(-50%, -50%) rotate(${target.rotationDeg.toFixed(1)}deg) scale(${scale.toFixed(2)})`,
                opacity,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                pointerEvents: target.popProgress === null && target.dismissProgress === null ? 'auto' : 'none',
                touchAction: 'manipulation',
              }}
            >
              <img
                src={target.item.stickerDataUrl}
                alt={target.item.displayWord}
                draggable={false}
                style={{
                  width: '92px',
                  height: '92px',
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.5))',
                }}
              />
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '9999px',
                  background: 'rgba(15, 23, 42, 0.88)',
                  border: `1.5px solid ${PARTICLE_COLORS[target.colorIndex % PARTICLE_COLORS.length]}`,
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
                }}
              >
                {target.item.displayWord}
              </span>
            </button>
          );
        })}

        {/* Burst particles */}
        {gameState.particles.map((p) => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              width: `${p.radius * 2}px`,
              height: `${p.radius * 2}px`,
              borderRadius: '9999px',
              background: PARTICLE_COLORS[p.colorIndex % PARTICLE_COLORS.length],
              opacity: p.life,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
};
