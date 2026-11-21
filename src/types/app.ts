export type TargetLanguageCode = 'en' | 'ja' | 'zh' | 'es' | 'fr' | 'de' | 'it';

export type PersonaId = 'buddy' | 'nerdy' | 'secret_agent' | 'wizard';

export type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced';

export type TtsPreference = 'hybrid' | 'gemini_expressive' | 'browser_fast';

export type TutorModelId = 'gemini-3.1-flash-lite' | 'gemini-3.5-flash-lite' | 'gemini-3.8-flash';

export interface ReplySegment {
  text: string;
  isTarget: boolean;
}

/** Normalized [ymin, xmin, ymax, xmax] coordinates in [0, 1000]. */
export type Box2D = [number, number, number, number];

export interface ExtractedVocab {
  word: string;
  reading: string;
  koreanPronunciation: string;
  meaning: string;
  partOfSpeech: string;
  exampleTarget: string;
  exampleKorean: string;
  box2d?: Box2D;
}

export interface TutorResponsePayload {
  userTranscript: string;
  replySegments: ReplySegment[];
  translationSummary: string;
  vocabCards: ExtractedVocab[];
}

export type StickerShape = 'rounded' | 'circle' | 'pill' | 'polaroid';

export interface SavedVocabCard {
  id: string;
  language: TargetLanguageCode;
  word: string;
  reading: string;
  koreanPronunciation: string;
  meaning: string;
  partOfSpeech: string;
  exampleTarget: string;
  exampleKorean: string;
  stickerDataUrl: string;
  sourceImageDataUrl?: string;
  box2d?: Box2D;
  stickerShape: StickerShape;
  whiteBorder: boolean;
  createdAt: number;
  reviewCount: number;
  lastReviewedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'tutor';
  timestamp: number;
  text: string;
  imageDataUrl?: string;
  segments?: ReplySegment[];
  translationSummary?: string;
  vocabCardIds?: string[];
  extractedCards?: ExtractedVocab[];
  latencyMs?: number;
}

export interface LearningSession {
  id: string;
  language: TargetLanguageCode;
  persona: PersonaId;
  level: ProficiencyLevel;
  startedAt: number;
  updatedAt: number;
  previewImageDataUrl?: string;
  previousInteractionId?: string;
  messages: ChatMessage[];
}

export interface AppSettings {
  apiKey: string;
  demoMode: boolean;
  hasCompletedOnboarding: boolean;
  targetLanguage: TargetLanguageCode;
  persona: PersonaId;
  level: ProficiencyLevel;
  customPersonaPrompt: string;
  tutorModel: TutorModelId;
  ttsPreference: TtsPreference;
  autoPlayTts: boolean;
  vocabPopperBestScore: number;
  settingsVersion?: number;
}

export type ActiveView = 'hud' | 'vocab' | 'popper';

export type TtsEngineKind = 'gemini' | 'browser';
