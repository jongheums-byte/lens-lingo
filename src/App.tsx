import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CameraHudView } from './components/CameraHudView';
import { HistorySideSheet } from './components/HistorySideSheet';
import { OnboardingModal } from './components/OnboardingModal';
import { SettingsModal } from './components/SettingsModal';
import { StickerCutoutEditorModal } from './components/StickerCutoutEditorModal';
import { VocabBankView } from './components/VocabBankView';
import { VocabPopperView } from './components/VocabPopperView';
import { playSfx } from './lib/audioUtils';
import { createStickerDataUrlFromImage } from './lib/bboxCrop';
import {
  generateStarterVocabCards,
  runDemoTutor,
  type DemoSceneId,
} from './services/demoService';
import { extractVocabCardsAsync, streamTutorReply } from './services/geminiService';
import {
  deleteSession,
  deleteVocabCard,
  getAllSessions,
  getAllVocabCards,
  loadSettings,
  putSession,
  putVocabCard,
  putVocabCards,
  saveSettings,
} from './services/storageService';
import { ttsController, type TtsPlaybackState } from './services/ttsService';
import type {
  ActiveView,
  AppSettings,
  ChatMessage,
  LearningSession,
  SavedVocabCard,
  TargetLanguageCode,
  TtsEngineKind,
} from './types/app';

function createEmptySession(settings: AppSettings): LearningSession {
  const now = Date.now();
  return {
    id: `sess-${now}-${Math.random().toString(36).slice(2, 7)}`,
    language: settings.targetLanguage,
    persona: settings.persona,
    level: settings.level,
    startedAt: now,
    updatedAt: now,
    messages: [],
  };
}

function dataUrlToBase64Parts(dataUrl: string): {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
} {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/);
  if (match) {
    return {
      mimeType: match[1] as 'image/jpeg' | 'image/png' | 'image/webp',
      base64: match[2],
    };
  }
  const idx = dataUrl.indexOf(',');
  return {
    mimeType: 'image/jpeg',
    base64: idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl,
  };
}

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [activeView, setActiveView] = useState<ActiveView>('hud');
  const [savedCards, setSavedCards] = useState<SavedVocabCard[]>([]);
  const [recentTrayCards, setRecentTrayCards] = useState<SavedVocabCard[]>([]);
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [activeSession, setActiveSession] = useState<LearningSession>(() =>
    createEmptySession(loadSettings()),
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtractingCards, setIsExtractingCards] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [ttsState, setTtsState] = useState<TtsPlaybackState>('idle');
  const [ttsEngine, setTtsEngine] = useState<TtsEngineKind>('browser');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);
  const turnSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [editingCard, setEditingCard] = useState<SavedVocabCard | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const reloadDbData = useCallback(async () => {
    const [cards, loadedSessions] = await Promise.all([
      getAllVocabCards(),
      getAllSessions(),
    ]);
    setSavedCards(cards);
    setSessions(loadedSessions);
    if (loadedSessions.length > 0 && activeSession.messages.length === 0) {
      setActiveSession(loadedSessions[0]);
    }
  }, [activeSession.messages.length]);

  useEffect(() => {
    reloadDbData().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const ensureStarterDeckIfEmpty = useCallback(
    async (language: TargetLanguageCode) => {
      const existing = await getAllVocabCards();
      if (existing.some((c) => c.language === language)) return;
      const starters = await generateStarterVocabCards(language);
      await putVocabCards(starters);
      const refreshed = await getAllVocabCards();
      setSavedCards(refreshed);
    },
    [],
  );

  const handleCreateStarterCards = useCallback(
    async (language: TargetLanguageCode) => {
      const starters = await generateStarterVocabCards(language);
      await putVocabCards(starters);
      const refreshed = await getAllVocabCards();
      setSavedCards(refreshed);
      playSfx('save');
    },
    [],
  );

  const playTutorSegments = useCallback(
    (msg: ChatMessage, currentSettings: AppSettings) => {
      const segments =
        msg.segments && msg.segments.length > 0
          ? msg.segments
          : [{ text: msg.text, isTarget: false }];
      ttsController.speakSegments(segments, currentSettings, {
        onStateChange: (st, engine) => {
          setTtsState(st);
          setTtsEngine(engine);
        },
        onSegmentChange: (idx) => setActiveSegmentIndex(idx),
      });
    },
    [],
  );

  const handleCancelTurn = useCallback(() => {
    turnSeqRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    ttsController.stop();
    setIsProcessing(false);
    setIsExtractingCards(false);
    setActiveSession((prev) => {
      const last = prev.messages[prev.messages.length - 1];
      if (last && last.role === 'tutor' && !last.text) {
        return {
          ...prev,
          messages: prev.messages.slice(0, -2),
        };
      }
      return prev;
    });
  }, []);

  const handleSubmitTurn = async (params: {
    imageDataUrl: string;
    audioBase64?: string;
    audioMimeType?: string;
    textQuestion?: string;
    demoSceneId?: DemoSceneId;
  }) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const turnAbortController = new AbortController();
    abortControllerRef.current = turnAbortController;

    const turnSeq = ++turnSeqRef.current;
    setIsProcessing(true);
    setIsExtractingCards(false);
    setErrorBanner(null);
    ttsController.stop();

    const now = Date.now();
    const userMsgId = `msg-u-${now}`;
    const tutorMsgId = `msg-t-${now + 1}`;
    const baseSession = activeSession;
    const sessionId = baseSession.id;

    const initialUserMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      timestamp: now,
      text: params.textQuestion?.trim() || (params.audioBase64 ? '🎙️ 음성 질문 인식 중...' : '📸 장면 스캔'),
      imageDataUrl: params.imageDataUrl,
    };
    const streamingTutorMsg: ChatMessage = {
      id: tutorMsgId,
      role: 'tutor',
      timestamp: now + 1,
      text: '',
      segments: [],
    };

    const upsertTurnMessages = (
      uMsg: ChatMessage,
      tMsg: ChatMessage,
      nextInteractionId?: string,
    ) => {
      setActiveSession((prev) => {
        if (prev.id !== sessionId) return prev;
        const others = prev.messages.filter((m) => m.id !== userMsgId && m.id !== tutorMsgId);
        return {
          ...prev,
          language: settings.targetLanguage,
          persona: settings.persona,
          level: settings.level,
          updatedAt: now,
          previewImageDataUrl: prev.previewImageDataUrl || params.imageDataUrl,
          previousInteractionId: nextInteractionId ?? prev.previousInteractionId,
          messages: [...others, uMsg, tMsg],
        };
      });
    };

    upsertTurnMessages(initialUserMsg, streamingTutorMsg);

    try {
      const isDemo = settings.demoMode || !settings.apiKey.trim();

      if (isDemo) {
        const startMs = performance.now();
        const payload = runDemoTutor({
          sceneId: params.demoSceneId ?? 'cafe',
          language: settings.targetLanguage,
          persona: settings.persona,
          question: params.textQuestion,
        });

        const finalUserMsg: ChatMessage = {
          ...initialUserMsg,
          text: payload.userTranscript || initialUserMsg.text,
        };

        // Smooth fast simulated stream reveal in Demo Mode
        for (let i = 1; i <= payload.replySegments.length; i++) {
          await new Promise((r) => window.setTimeout(r, 38));
          if (turnSeq !== turnSeqRef.current) return;
          const partialSegs = payload.replySegments.slice(0, i);
          upsertTurnMessages(finalUserMsg, {
            ...streamingTutorMsg,
            text: partialSegs.map((s) => s.text).join(''),
            segments: partialSegs,
          });
        }

        const latencyMs = Math.round(performance.now() - startMs);
        const newCards: SavedVocabCard[] = await Promise.all(
          payload.vocabCards.map(async (vc, idx) => {
            const stickerDataUrl = await createStickerDataUrlFromImage(
              params.imageDataUrl,
              vc.box2d,
              { shape: 'rounded', whiteBorder: true },
            );
            return {
              id: `card-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
              language: settings.targetLanguage,
              word: vc.word,
              reading: vc.reading,
              koreanPronunciation: vc.koreanPronunciation,
              meaning: vc.meaning,
              partOfSpeech: vc.partOfSpeech,
              exampleTarget: vc.exampleTarget,
              exampleKorean: vc.exampleKorean,
              stickerDataUrl,
              sourceImageDataUrl: params.imageDataUrl,
              box2d: vc.box2d,
              stickerShape: 'rounded',
              whiteBorder: true,
              createdAt: now + idx,
              reviewCount: 0,
            };
          }),
        );

        if (newCards.length > 0) {
          await putVocabCards(newCards);
          setSavedCards((prev) => [...newCards, ...prev]);
          if (turnSeq === turnSeqRef.current) setRecentTrayCards(newCards);
          playSfx('save');
        }

        const finalTutorMsg: ChatMessage = {
          ...streamingTutorMsg,
          text: payload.replySegments.map((s) => s.text).join(''),
          segments: payload.replySegments,
          translationSummary: payload.translationSummary,
          vocabCardIds: newCards.map((c) => c.id),
          extractedCards: payload.vocabCards,
          latencyMs,
        };

        const completedSession: LearningSession = {
          ...baseSession,
          language: settings.targetLanguage,
          persona: settings.persona,
          level: settings.level,
          updatedAt: now,
          previewImageDataUrl: baseSession.previewImageDataUrl || params.imageDataUrl,
          messages: [...baseSession.messages, finalUserMsg, finalTutorMsg],
        };

        if (turnSeq === turnSeqRef.current) {
          upsertTurnMessages(finalUserMsg, finalTutorMsg);
          setIsProcessing(false);
        }
        await putSession(completedSession);
        setSessions((prev) => [completedSession, ...prev.filter((s) => s.id !== completedSession.id)]);

        if (settings.autoPlayTts && turnSeq === turnSeqRef.current) {
          playTutorSegments(finalTutorMsg, settings);
        }
        return;
      }

      // Live Gemini 2-Pass Streaming Pipeline
      const imgParts = dataUrlToBase64Parts(params.imageDataUrl);
      const streamRes = await streamTutorReply({
        settings,
        imageBase64: imgParts.base64,
        imageMimeType: imgParts.mimeType,
        audioBase64: params.audioBase64,
        audioMimeType: params.audioMimeType,
        textQuestion: params.textQuestion,
        previousInteractionId: baseSession.previousInteractionId,
        signal: turnAbortController.signal,
        onPartial: (partial) => {
          if (turnSeq !== turnSeqRef.current) return;
          upsertTurnMessages(
            {
              ...initialUserMsg,
              text: partial.userTranscript || initialUserMsg.text,
            },
            {
              ...streamingTutorMsg,
              text: partial.plainText,
              segments: partial.segments,
            },
          );
        },
      });

      const finalUserMsg: ChatMessage = {
        ...initialUserMsg,
        text: streamRes.userTranscript,
      };
      const pass1TutorMsg: ChatMessage = {
        ...streamingTutorMsg,
        text: streamRes.plainText,
        segments: streamRes.segments,
        latencyMs: streamRes.totalMs,
      };
      const nextInteractionId = streamRes.interactionId || baseSession.previousInteractionId;

      if (turnSeq === turnSeqRef.current) {
        upsertTurnMessages(finalUserMsg, pass1TutorMsg, nextInteractionId);
        setIsProcessing(false);
        setIsExtractingCards(true);
        setRecentTrayCards([]);
        if (settings.autoPlayTts) {
          // Kick off Streaming PCM TTS immediately in parallel with Pass 2!
          playTutorSegments(pass1TutorMsg, settings);
        }
      }

      const pass1Session: LearningSession = {
        ...baseSession,
        language: settings.targetLanguage,
        persona: settings.persona,
        level: settings.level,
        updatedAt: now,
        previewImageDataUrl: baseSession.previewImageDataUrl || params.imageDataUrl,
        previousInteractionId: nextInteractionId,
        messages: [...baseSession.messages, finalUserMsg, pass1TutorMsg],
      };
      await putSession(pass1Session);
      setSessions((prev) => [pass1Session, ...prev.filter((s) => s.id !== pass1Session.id)]);

      // Pass 2 (Background): Extract vocab cards + box2d and crop die-cut stickers
      const pass2 = await extractVocabCardsAsync({
        settings,
        replyText: streamRes.plainText,
        imageBase64: imgParts.base64,
        imageMimeType: imgParts.mimeType,
        signal: turnAbortController.signal,
      });

      const newCards: SavedVocabCard[] = await Promise.all(
        pass2.vocabCards.map(async (vc, idx) => {
          const stickerDataUrl = await createStickerDataUrlFromImage(
            params.imageDataUrl,
            vc.box2d,
            { shape: 'rounded', whiteBorder: true },
          );
          return {
            id: `card-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            language: settings.targetLanguage,
            word: vc.word,
            reading: vc.reading,
            koreanPronunciation: vc.koreanPronunciation,
            meaning: vc.meaning,
            partOfSpeech: vc.partOfSpeech,
            exampleTarget: vc.exampleTarget,
            exampleKorean: vc.exampleKorean,
            stickerDataUrl,
            sourceImageDataUrl: params.imageDataUrl,
            box2d: vc.box2d,
            stickerShape: 'rounded',
            whiteBorder: true,
            createdAt: now + idx,
            reviewCount: 0,
          };
        }),
      );

      if (newCards.length > 0) {
        await putVocabCards(newCards);
        setSavedCards((prev) => [...newCards, ...prev]);
        if (turnSeq === turnSeqRef.current) {
          setRecentTrayCards(newCards);
          playSfx('save');
        }
      }

      const finalTutorMsg: ChatMessage = {
        ...pass1TutorMsg,
        translationSummary: pass2.translationSummary || pass1TutorMsg.translationSummary,
        vocabCardIds: newCards.map((c) => c.id),
        extractedCards: pass2.vocabCards,
      };
      const finalSession: LearningSession = {
        ...pass1Session,
        messages: [...baseSession.messages, finalUserMsg, finalTutorMsg],
      };
      if (turnSeq === turnSeqRef.current) {
        upsertTurnMessages(finalUserMsg, finalTutorMsg, nextInteractionId);
      }
      await putSession(finalSession);
      setSessions((prev) => [finalSession, ...prev.filter((s) => s.id !== finalSession.id)]);
    } catch (err) {
      if (turnAbortController.signal.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setErrorBanner(`튜터 호출 오류: ${msg}`);
      // Roll back empty placeholder if Pass 1 failed completely
      setActiveSession((prev) => {
        if (prev.id !== sessionId) return prev;
        const target = prev.messages.find((m) => m.id === tutorMsgId);
        if (target && !target.text) {
          return {
            ...prev,
            messages: prev.messages.filter((m) => m.id !== userMsgId && m.id !== tutorMsgId),
          };
        }
        return prev;
      });
    } finally {
      if (turnSeq === turnSeqRef.current) {
        setIsProcessing(false);
        setIsExtractingCards(false);
      }
    }
  };

  const handleToggleSaveCard = async (card: SavedVocabCard) => {
    const exists = savedCards.some((c) => c.id === card.id);
    if (exists) {
      await deleteVocabCard(card.id);
      setSavedCards((prev) => prev.filter((c) => c.id !== card.id));
    } else {
      await putVocabCard(card);
      setSavedCards((prev) => [card, ...prev]);
      playSfx('save');
    }
  };

  const handleSaveEditedSticker = async (updated: SavedVocabCard) => {
    await putVocabCard(updated);
    setSavedCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setRecentTrayCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setEditingCard(null);
  };

  const handleDeleteSavedCard = async (id: string) => {
    await deleteVocabCard(id);
    setSavedCards((prev) => prev.filter((c) => c.id !== id));
    setRecentTrayCards((prev) => prev.filter((c) => c.id !== id));
  };

  const handleMarkReviewed = async (card: SavedVocabCard) => {
    const updated: SavedVocabCard = {
      ...card,
      reviewCount: card.reviewCount + 1,
      lastReviewedAt: Date.now(),
    };
    await putVocabCard(updated);
    setSavedCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    playSfx('save');
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSession.id === id) {
      setActiveSession(createEmptySession(settings));
      setRecentTrayCards([]);
    }
  };

  const handleSelectSession = (sess: LearningSession) => {
    ttsController.stop();
    setActiveSession(sess);
    const lastTutor = [...sess.messages].reverse().find((m) => m.role === 'tutor');
    if (lastTutor?.vocabCardIds) {
      const idSet = new Set(lastTutor.vocabCardIds);
      setRecentTrayCards(savedCards.filter((c) => idSet.has(c.id)));
    } else {
      setRecentTrayCards([]);
    }
  };

  return (
    <div className="app-viewport">
      <div className="phone-shell">
        {activeView === 'hud' && (
          <CameraHudView
            settings={settings}
            activeSession={activeSession}
            savedCards={savedCards}
            recentTrayCards={recentTrayCards}
            ttsState={ttsState}
            ttsEngine={ttsEngine}
            activeSegmentIndex={activeSegmentIndex}
            isProcessing={isProcessing}
            isExtractingCards={isExtractingCards}
            errorBanner={errorBanner}
            onClearError={() => setErrorBanner(null)}
            onUpdateSettings={handleUpdateSettings}
            onSubmitTurn={handleSubmitTurn}
            onCancelTurn={handleCancelTurn}
            onReplayTutorMessage={(msg) => playTutorSegments(msg, settings)}
            onStopTts={() => {
              ttsController.stop();
              setTtsState('idle');
              setActiveSegmentIndex(-1);
            }}
            onUnlockAudio={() => ttsController.unlockAudio()}
            onSpeakWord={(w) => {
              ttsController.unlockAudio();
              ttsController.speakWord(w, settings.targetLanguage, settings);
            }}
            onEditSticker={(card) => setEditingCard(card)}
            onToggleSaveCard={handleToggleSaveCard}
            onOpenVocabBank={() => {
              ttsController.stop();
              setActiveView('vocab');
            }}
            onOpenPopper={() => {
              ttsController.stop();
              setActiveView('popper');
            }}
            onOpenHistory={() => setShowHistory(true)}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}

        {activeView === 'vocab' && (
          <VocabBankView
            cards={savedCards}
            settings={settings}
            onBack={() => setActiveView('hud')}
            onOpenPopper={() => setActiveView('popper')}
            onSpeakWord={(word, lang) => {
              ttsController.unlockAudio();
              ttsController.speakWord(word, lang, settings);
            }}
            onEditSticker={(card) => setEditingCard(card)}
            onDeleteCard={handleDeleteSavedCard}
            onMarkReviewed={handleMarkReviewed}
            onCreateStarterCards={handleCreateStarterCards}
          />
        )}

        {activeView === 'popper' && (
          <VocabPopperView
            cards={savedCards}
            settings={settings}
            onBack={() => setActiveView('hud')}
            onSpeakWord={(word, lang) => {
              ttsController.unlockAudio();
              ttsController.speakWord(word, lang, settings);
            }}
            onBestScore={(score) =>
              handleUpdateSettings({ ...settings, vocabPopperBestScore: score })
            }
            onCreateStarterCards={handleCreateStarterCards}
          />
        )}

        {editingCard && (
          <StickerCutoutEditorModal
            card={editingCard}
            onClose={() => setEditingCard(null)}
            onSave={handleSaveEditedSticker}
          />
        )}

        {showHistory && (
          <HistorySideSheet
            sessions={sessions}
            activeSessionId={activeSession.id}
            onSelectSession={handleSelectSession}
            onNewSession={() => {
              ttsController.stop();
              setActiveSession(createEmptySession(settings));
              setRecentTrayCards([]);
            }}
            onDeleteSession={handleDeleteSession}
            onClose={() => setShowHistory(false)}
          />
        )}

        {showSettings && (
          <SettingsModal
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onDataImported={() => {
              reloadDbData().catch(() => undefined);
            }}
            onClose={() => setShowSettings(false)}
          />
        )}

        {!settings.hasCompletedOnboarding && (
          <OnboardingModal
            defaultLanguage={settings.targetLanguage}
            onStartWithKey={async (apiKey, language) => {
              const next: AppSettings = {
                ...settings,
                apiKey,
                demoMode: false,
                targetLanguage: language,
                hasCompletedOnboarding: true,
              };
              handleUpdateSettings(next);
              await ensureStarterDeckIfEmpty(language);
            }}
            onStartDemo={async (language) => {
              const next: AppSettings = {
                ...settings,
                demoMode: true,
                targetLanguage: language,
                hasCompletedOnboarding: true,
              };
              handleUpdateSettings(next);
              await ensureStarterDeckIfEmpty(language);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default App;
