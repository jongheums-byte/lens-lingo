import React, { useCallback, useEffect, useState } from 'react';
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
import { askTutor } from './services/geminiService';
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
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [ttsState, setTtsState] = useState<TtsPlaybackState>('idle');
  const [ttsEngine, setTtsEngine] = useState<TtsEngineKind>('browser');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);

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

  const handleSubmitTurn = async (params: {
    imageDataUrl: string;
    audioBase64?: string;
    audioMimeType?: string;
    textQuestion?: string;
    demoSceneId?: DemoSceneId;
  }) => {
    setIsProcessing(true);
    setErrorBanner(null);
    ttsController.stop();

    try {
      const isDemo = settings.demoMode || !settings.apiKey.trim();
      let payload;
      let nextInteractionId = activeSession.previousInteractionId;

      if (isDemo) {
        // Brief realistic delay in demo mode so scan animation is visible
        await new Promise((r) => window.setTimeout(r, 450));
        payload = runDemoTutor({
          sceneId: params.demoSceneId ?? 'cafe',
          language: settings.targetLanguage,
          persona: settings.persona,
          question: params.textQuestion,
        });
      } else {
        const imgParts = dataUrlToBase64Parts(params.imageDataUrl);
        const result = await askTutor({
          settings,
          imageBase64: imgParts.base64,
          imageMimeType: imgParts.mimeType,
          audioBase64: params.audioBase64,
          audioMimeType: params.audioMimeType,
          textQuestion: params.textQuestion,
          previousInteractionId: activeSession.previousInteractionId,
        });
        payload = result.payload;
        nextInteractionId = result.interactionId || nextInteractionId;
      }

      // Generate cropped die-cut photo stickers for each taught vocab card
      const now = Date.now();
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
        setRecentTrayCards(newCards);
        playSfx('save');
      }

      const userMsg: ChatMessage = {
        id: `msg-u-${now}`,
        role: 'user',
        timestamp: now,
        text: payload.userTranscript || params.textQuestion || '📸 장면 스캔',
        imageDataUrl: params.imageDataUrl,
      };

      const tutorText = payload.replySegments.map((s) => s.text).join('');
      const tutorMsg: ChatMessage = {
        id: `msg-t-${now + 1}`,
        role: 'tutor',
        timestamp: now + 1,
        text: tutorText,
        segments: payload.replySegments,
        translationSummary: payload.translationSummary,
        vocabCardIds: newCards.map((c) => c.id),
        extractedCards: payload.vocabCards,
      };

      const updatedSession: LearningSession = {
        ...activeSession,
        language: settings.targetLanguage,
        persona: settings.persona,
        level: settings.level,
        updatedAt: now,
        previewImageDataUrl: activeSession.previewImageDataUrl || params.imageDataUrl,
        previousInteractionId: nextInteractionId,
        messages: [...activeSession.messages, userMsg, tutorMsg],
      };

      setActiveSession(updatedSession);
      await putSession(updatedSession);
      setSessions((prev) => {
        const rest = prev.filter((s) => s.id !== updatedSession.id);
        return [updatedSession, ...rest];
      });

      if (settings.autoPlayTts) {
        playTutorSegments(tutorMsg, settings);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorBanner(`튜터 호출 오류: ${msg}`);
    } finally {
      setIsProcessing(false);
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
            errorBanner={errorBanner}
            onClearError={() => setErrorBanner(null)}
            onUpdateSettings={handleUpdateSettings}
            onSubmitTurn={handleSubmitTurn}
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
