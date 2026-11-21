import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CameraHudView } from './components/CameraHudView';
import { ConversationChatView } from './components/ConversationChatView';
import { HistorySideSheet } from './components/HistorySideSheet';
import { OnboardingModal } from './components/OnboardingModal';
import { SettingsModal } from './components/SettingsModal';
import { StickerCutoutEditorModal } from './components/StickerCutoutEditorModal';
import { VocabBankView } from './components/VocabBankView';
import { VocabPopperView } from './components/VocabPopperView';
import { PERSONAS } from './config/personas';
import { CONVERSATION_SCENARIOS } from './config/scenarios';
import { playSfx } from './lib/audioUtils';
import { createStickerDataUrlFromImage, createTextStickerDataUrl } from './lib/bboxCrop';
import {
  generateStarterVocabCards,
  runDemoConversationTurn,
  runDemoTutor,
  type DemoSceneId,
} from './services/demoService';
import {
  extractVocabCardsAsync,
  streamConversationReply,
  streamTutorReply,
} from './services/geminiService';
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
  ConversationScenarioId,
  ExtractedVocab,
  LearningSession,
  SavedVocabCard,
  TargetLanguageCode,
  TtsEngineKind,
} from './types/app';

function createEmptySession(settings: AppSettings): LearningSession {
  const now = Date.now();
  return {
    id: `sess-${now}-${Math.random().toString(36).slice(2, 7)}`,
    mode: 'scan',
    language: settings.targetLanguage,
    persona: settings.persona,
    level: settings.level,
    startedAt: now,
    updatedAt: now,
    messages: [],
  };
}

function createEmptyChatSession(
  settings: AppSettings,
  scenarioId: ConversationScenarioId = 'free_talk',
  customTopic?: string,
): LearningSession {
  const now = Date.now();
  const sc = CONVERSATION_SCENARIOS[scenarioId];
  return {
    id: `chat-${now}-${Math.random().toString(36).slice(2, 7)}`,
    mode: 'chat',
    scenarioId,
    scenarioTitle: scenarioId === 'custom' && customTopic?.trim() ? customTopic.trim() : sc.title,
    customTopic: customTopic?.trim() || undefined,
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
  const [activeChatSession, setActiveChatSession] = useState<LearningSession>(() =>
    createEmptyChatSession(loadSettings()),
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<string>('👀 장면을 살펴보는 중...');
  const [isExtractingCards, setIsExtractingCards] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [ttsState, setTtsState] = useState<TtsPlaybackState>('idle');
  const [ttsEngine, setTtsEngine] = useState<TtsEngineKind>('browser');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
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
    const latestScan = loadedSessions.find((s) => s.mode !== 'chat');
    if (latestScan && activeSession.messages.length === 0) {
      setActiveSession(latestScan);
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
      setPlayingMessageId(msg.id);
      ttsController.speakSegments(segments, currentSettings, {
        onStateChange: (st, engine) => {
          setTtsState(st);
          setTtsEngine(engine);
          if (st === 'idle') setPlayingMessageId(null);
        },
        onSegmentChange: (idx) => setActiveSegmentIndex(idx),
      });
    },
    [],
  );

  const playChatTargetMessage = useCallback(
    (msg: ChatMessage, currentSettings: AppSettings) => {
      if (!msg.text.trim()) return;
      setPlayingMessageId(msg.id);
      ttsController.speakSegments([{ text: msg.text, isTarget: true }], currentSettings, {
        onStateChange: (st, engine) => {
          setTtsState(st);
          setTtsEngine(engine);
          if (st === 'idle') setPlayingMessageId(null);
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
    setPlayingMessageId(null);
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
    setActiveChatSession((prev) => {
      const last = prev.messages[prev.messages.length - 1];
      if (last && last.role === 'tutor' && !last.text) {
        const dropCount = prev.messages.length >= 2 && prev.messages[prev.messages.length - 2].role === 'user' ? 2 : 1;
        return {
          ...prev,
          messages: prev.messages.slice(0, -dropCount),
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
    setProcessingStage('📡 AI 서버에 장면 전송 중...');
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

      // Live Gemini Single-Stream Fast Pipeline (<10s cut):
      // Streams spoken reply first, fires TTS as soon as reply finishes (even before inline W: cards end),
      // and extracts sticker cards from inline W: lines with ZERO second image upload or extra LLM call!
      const isFollowUpQuestion = Boolean(params.textQuestion?.trim() || params.audioBase64);
      const lastTutorText = isFollowUpQuestion
        ? [...baseSession.messages].reverse().find((m) => m.role === 'tutor')?.text
        : undefined;
      const imgParts = dataUrlToBase64Parts(params.imageDataUrl);
      let ttsStartedEarly = false;

      const streamRes = await streamTutorReply({
        settings,
        imageBase64: imgParts.base64,
        imageMimeType: imgParts.mimeType,
        audioBase64: params.audioBase64,
        audioMimeType: params.audioMimeType,
        textQuestion: params.textQuestion,
        previousReplyContext: lastTutorText,
        signal: turnAbortController.signal,
        onStage: (stage) => {
          if (turnSeq === turnSeqRef.current) setProcessingStage(stage);
        },
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
        onReplyReady: (partial) => {
          if (turnSeq !== turnSeqRef.current || ttsStartedEarly || !settings.autoPlayTts) return;
          if (partial.segments.length > 0 && partial.plainText.trim()) {
            ttsStartedEarly = true;
            playTutorSegments(
              {
                ...streamingTutorMsg,
                text: partial.plainText,
                segments: partial.segments,
              },
              settings,
            );
          }
        },
      });

      const finalUserMsg: ChatMessage = {
        ...initialUserMsg,
        text: streamRes.userTranscript,
      };
      const firstCardSummary =
        streamRes.inlineCards.length > 0
          ? `${streamRes.inlineCards[0].word} = ${streamRes.inlineCards[0].meaning}`
          : undefined;
      const pass1TutorMsg: ChatMessage = {
        ...streamingTutorMsg,
        text: streamRes.plainText,
        segments: streamRes.segments,
        translationSummary: firstCardSummary,
        latencyMs: streamRes.totalMs,
      };
      const nextInteractionId = streamRes.interactionId || baseSession.previousInteractionId;

      const hasInlineCards = streamRes.inlineCards.length > 0;

      if (turnSeq === turnSeqRef.current) {
        upsertTurnMessages(finalUserMsg, pass1TutorMsg, nextInteractionId);
        setIsProcessing(false);
        if (!hasInlineCards) {
          setIsExtractingCards(true);
          setRecentTrayCards([]);
        }
        if (settings.autoPlayTts && !ttsStartedEarly) {
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

      // Use zero-cost inline W: cards if emitted; only call Pass 2 fallback if none arrived
      let extractedVocab = streamRes.inlineCards;
      let summaryText = firstCardSummary || '';
      if (!hasInlineCards) {
        const pass2 = await extractVocabCardsAsync({
          settings,
          replyText: streamRes.plainText,
          imageBase64: imgParts.base64,
          imageMimeType: imgParts.mimeType,
          signal: turnAbortController.signal,
        });
        extractedVocab = pass2.vocabCards;
        summaryText = pass2.translationSummary || summaryText;
      }

      const newCards: SavedVocabCard[] = await Promise.all(
        extractedVocab.map(async (vc, idx) => {
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
        translationSummary: summaryText || pass1TutorMsg.translationSummary,
        vocabCardIds: newCards.map((c) => c.id),
        extractedCards: extractedVocab,
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

  const [lastMainView, setLastMainView] = useState<'hud' | 'chat'>('hud');

  const runChatTurnInternal = async (params: {
    baseSession: LearningSession;
    text?: string;
    audioBase64?: string;
    audioMimeType?: string;
    isOpening?: boolean;
  }) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const turnAbortController = new AbortController();
    abortControllerRef.current = turnAbortController;

    const turnSeq = ++turnSeqRef.current;
    const { baseSession, text, audioBase64, audioMimeType, isOpening = false } = params;
    const scenarioId = baseSession.scenarioId ?? 'free_talk';
    const sessionId = baseSession.id;

    setIsProcessing(true);
    setProcessingStage(isOpening ? '💬 회화 시작 인사 준비 중...' : '💬 답변 생각하는 중...');
    setErrorBanner(null);
    ttsController.stop();
    setPlayingMessageId(null);

    const now = Date.now();
    const userMsgId = `chat-u-${now}`;
    const tutorMsgId = `chat-t-${now + 1}`;

    const initialUserMsg: ChatMessage | null = isOpening
      ? null
      : {
          id: userMsgId,
          role: 'user',
          timestamp: now,
          text: text?.trim() || '🎙️ 음성 인식 중...',
        };

    const streamingTutorMsg: ChatMessage = {
      id: tutorMsgId,
      role: 'tutor',
      timestamp: now + 1,
      text: '',
    };

    const upsertChatMessages = (uMsg: ChatMessage | null, tMsg: ChatMessage) => {
      setActiveChatSession((prev) => {
        if (prev.id !== sessionId) return prev;
        const others = prev.messages.filter((m) => m.id !== userMsgId && m.id !== tutorMsgId);
        return {
          ...prev,
          language: settings.targetLanguage,
          persona: settings.persona,
          level: settings.level,
          updatedAt: now,
          messages: uMsg ? [...others, uMsg, tMsg] : [...others, tMsg],
        };
      });
    };

    setActiveChatSession({
      ...baseSession,
      language: settings.targetLanguage,
      persona: settings.persona,
      level: settings.level,
      updatedAt: now,
      messages: initialUserMsg
        ? [...baseSession.messages, initialUserMsg, streamingTutorMsg]
        : [...baseSession.messages, streamingTutorMsg],
    });

    try {
      const isDemo = settings.demoMode || !settings.apiKey.trim();

      if (isDemo) {
        const startMs = performance.now();
        const userTurnsSoFar = baseSession.messages.filter((m) => m.role === 'user').length;
        const demo = runDemoConversationTurn({
          scenarioId,
          language: settings.targetLanguage,
          level: settings.level,
          turnCount: userTurnsSoFar,
          userText: text,
          isOpening,
        });

        await new Promise((r) => window.setTimeout(r, 220));
        if (turnSeq !== turnSeqRef.current) return;

        const finalUserMsg: ChatMessage | null = initialUserMsg
          ? { ...initialUserMsg, text: demo.userTranscript || initialUserMsg.text }
          : null;
        const finalTutorMsg: ChatMessage = {
          ...streamingTutorMsg,
          text: demo.replyText,
          koreanTranslation: demo.koreanTranslation,
          coachingTip: demo.coachingTip,
          suggestedReplies: demo.suggestedReplies,
          extractedCards: demo.vocabCards,
          latencyMs: Math.round(performance.now() - startMs),
        };

        const completed: LearningSession = {
          ...baseSession,
          language: settings.targetLanguage,
          persona: settings.persona,
          level: settings.level,
          updatedAt: now,
          messages: finalUserMsg
            ? [...baseSession.messages, finalUserMsg, finalTutorMsg]
            : [...baseSession.messages, finalTutorMsg],
        };

        upsertChatMessages(finalUserMsg, finalTutorMsg);
        setIsProcessing(false);
        await putSession(completed);
        setSessions((prev) => [completed, ...prev.filter((s) => s.id !== completed.id)]);

        if (settings.autoPlayTts && turnSeq === turnSeqRef.current) {
          playChatTargetMessage(finalTutorMsg, settings);
        }
        return;
      }

      // Live Gemini Conversation Stream (<10s cut, typically 1.5-4s with zero image payload)
      let ttsStartedEarly = false;
      const streamRes = await streamConversationReply({
        settings,
        scenarioId,
        customTopic: baseSession.customTopic,
        history: baseSession.messages,
        userText: text,
        audioBase64,
        audioMimeType,
        isOpening,
        signal: turnAbortController.signal,
        onStage: (stage) => {
          if (turnSeq === turnSeqRef.current) setProcessingStage(stage);
        },
        onPartial: (partial) => {
          if (turnSeq !== turnSeqRef.current) return;
          const nextUser = initialUserMsg
            ? { ...initialUserMsg, text: partial.userTranscript || initialUserMsg.text }
            : null;
          upsertChatMessages(nextUser, {
            ...streamingTutorMsg,
            text: partial.replyText,
            koreanTranslation: partial.koreanTranslation,
            coachingTip: partial.coachingTip,
            suggestedReplies: partial.suggestedReplies,
            extractedCards: partial.vocabCards,
          });
        },
        onReplyReady: (partial) => {
          if (turnSeq !== turnSeqRef.current || ttsStartedEarly || !settings.autoPlayTts) return;
          if (partial.replyText.trim()) {
            ttsStartedEarly = true;
            playChatTargetMessage(
              {
                ...streamingTutorMsg,
                text: partial.replyText,
              },
              settings,
            );
          }
        },
      });

      const finalUserMsg: ChatMessage | null = initialUserMsg
        ? {
            ...initialUserMsg,
            text: streamRes.userTranscript || initialUserMsg.text,
          }
        : null;

      const finalTutorMsg: ChatMessage = {
        ...streamingTutorMsg,
        text: streamRes.replyText,
        koreanTranslation: streamRes.koreanTranslation,
        coachingTip: streamRes.coachingTip,
        suggestedReplies: streamRes.suggestedReplies,
        extractedCards: streamRes.vocabCards,
        latencyMs: streamRes.totalMs,
      };

      const completedSession: LearningSession = {
        ...baseSession,
        language: settings.targetLanguage,
        persona: settings.persona,
        level: settings.level,
        updatedAt: now,
        messages: finalUserMsg
          ? [...baseSession.messages, finalUserMsg, finalTutorMsg]
          : [...baseSession.messages, finalTutorMsg],
      };

      if (turnSeq === turnSeqRef.current) {
        upsertChatMessages(finalUserMsg, finalTutorMsg);
        setIsProcessing(false);
        if (settings.autoPlayTts && !ttsStartedEarly) {
          playChatTargetMessage(finalTutorMsg, settings);
        }
      }
      await putSession(completedSession);
      setSessions((prev) => [completedSession, ...prev.filter((s) => s.id !== completedSession.id)]);
    } catch (err) {
      if (turnAbortController.signal.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setErrorBanner(`회화 호출 오류: ${msg}`);
      setActiveChatSession((prev) => {
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
      }
    }
  };

  const handleStartChatScenario = async (
    scenarioId: ConversationScenarioId,
    customTopic?: string,
  ) => {
    const fresh = createEmptyChatSession(settings, scenarioId, customTopic);
    await runChatTurnInternal({ baseSession: fresh, isOpening: true });
  };

  const handleSendChatTurn = async (params: {
    text?: string;
    audioBase64?: string;
    audioMimeType?: string;
  }) => {
    const base =
      activeChatSession.messages.length > 0
        ? activeChatSession
        : createEmptyChatSession(settings, 'free_talk');
    await runChatTurnInternal({
      baseSession: base,
      text: params.text,
      audioBase64: params.audioBase64,
      audioMimeType: params.audioMimeType,
      isOpening: false,
    });
  };

  const handleSaveChatVocab = async (vocab: ExtractedVocab) => {
    const exists = savedCards.some(
      (c) =>
        c.language === settings.targetLanguage &&
        c.word.trim().toLowerCase() === vocab.word.trim().toLowerCase(),
    );
    if (exists) return;

    const scenario = CONVERSATION_SCENARIOS[activeChatSession.scenarioId ?? 'free_talk'];
    const persona = PERSONAS[settings.persona];
    const stickerDataUrl = createTextStickerDataUrl(
      vocab.word,
      scenario.emoji,
      persona.accentColor,
    );

    const newCard: SavedVocabCard = {
      id: `chat-card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      language: settings.targetLanguage,
      word: vocab.word,
      reading: vocab.reading || vocab.word,
      koreanPronunciation: vocab.koreanPronunciation || '',
      meaning: vocab.meaning,
      partOfSpeech: vocab.partOfSpeech || '회화 표현',
      exampleTarget: vocab.exampleTarget || vocab.word,
      exampleKorean: vocab.exampleKorean || vocab.meaning,
      stickerDataUrl,
      stickerShape: 'rounded',
      whiteBorder: true,
      createdAt: Date.now(),
      reviewCount: 0,
    };

    await putVocabCard(newCard);
    setSavedCards((prev) => [newCard, ...prev]);
    playSfx('save');
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
    if (activeChatSession.id === id) {
      setActiveChatSession(createEmptyChatSession(settings));
    }
  };

  const handleSelectSession = (sess: LearningSession) => {
    ttsController.stop();
    setPlayingMessageId(null);
    if (sess.mode === 'chat') {
      setActiveChatSession(sess);
      setLastMainView('chat');
      setActiveView('chat');
      return;
    }
    setActiveSession(sess);
    setLastMainView('hud');
    setActiveView('hud');
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
            processingStage={processingStage}
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
              setPlayingMessageId(null);
            }}
            onUnlockAudio={() => ttsController.unlockAudio()}
            onSpeakWord={(w) => {
              ttsController.unlockAudio();
              ttsController.speakWord(w, settings.targetLanguage, settings);
            }}
            onEditSticker={(card) => setEditingCard(card)}
            onToggleSaveCard={handleToggleSaveCard}
            onOpenChat={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setErrorBanner(null);
              setLastMainView('chat');
              setActiveView('chat');
            }}
            onOpenVocabBank={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setLastMainView('hud');
              setActiveView('vocab');
            }}
            onOpenPopper={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setLastMainView('hud');
              setActiveView('popper');
            }}
            onOpenHistory={() => setShowHistory(true)}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}

        {activeView === 'chat' && (
          <ConversationChatView
            settings={settings}
            activeChatSession={activeChatSession}
            savedCards={savedCards}
            ttsState={ttsState}
            ttsEngine={ttsEngine}
            playingMessageId={playingMessageId}
            isProcessing={isProcessing}
            processingStage={processingStage}
            errorBanner={errorBanner}
            onClearError={() => setErrorBanner(null)}
            onUpdateSettings={handleUpdateSettings}
            onStartScenario={handleStartChatScenario}
            onSendChatTurn={handleSendChatTurn}
            onResetToScenarios={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setErrorBanner(null);
              setActiveChatSession(createEmptyChatSession(settings));
            }}
            onCancelTurn={handleCancelTurn}
            onSpeakMessage={(msg) => playChatTargetMessage(msg, settings)}
            onStopTts={() => {
              ttsController.stop();
              setTtsState('idle');
              setPlayingMessageId(null);
            }}
            onUnlockAudio={() => ttsController.unlockAudio()}
            onSpeakWord={(w) => {
              ttsController.unlockAudio();
              ttsController.speakWord(w, settings.targetLanguage, settings);
            }}
            onSaveExtractedVocab={handleSaveChatVocab}
            onSwitchToScan={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setErrorBanner(null);
              setLastMainView('hud');
              setActiveView('hud');
            }}
            onOpenVocabBank={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setLastMainView('chat');
              setActiveView('vocab');
            }}
            onOpenPopper={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setLastMainView('chat');
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
            onBack={() => setActiveView(lastMainView)}
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
            onBack={() => setActiveView(lastMainView)}
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
            activeSessionId={activeView === 'chat' ? activeChatSession.id : activeSession.id}
            onSelectSession={handleSelectSession}
            onNewSession={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setActiveSession(createEmptySession(settings));
              setRecentTrayCards([]);
              setLastMainView('hud');
              setActiveView('hud');
            }}
            onNewChatSession={() => {
              ttsController.stop();
              setPlayingMessageId(null);
              setActiveChatSession(createEmptyChatSession(settings));
              setLastMainView('chat');
              setActiveView('chat');
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
