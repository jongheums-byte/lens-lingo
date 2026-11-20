import { TARGET_LANGUAGES } from '../config/languages';
import type {
  AppSettings,
  ReplySegment,
  TargetLanguageCode,
  TtsEngineKind,
} from '../types/app';
import { synthesizeGeminiTts } from './geminiService';

export type TtsPlaybackState = 'idle' | 'loading' | 'playing';

export interface SpeakSegmentsCallbacks {
  onStateChange?: (state: TtsPlaybackState, engine: TtsEngineKind) => void;
  onSegmentChange?: (index: number) => void;
}

class HybridTtsController {
  private audioEl: HTMLAudioElement | null = null;
  private audioCache = new Map<string, string>();
  private segmentTimerIds: number[] = [];
  private activeRunId = 0;

  /**
   * Call synchronously inside click/tap handlers so iOS Safari allows async audio playback afterwards.
   */
  public unlockAudio(): void {
    if (typeof window === 'undefined') return;
    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.preload = 'auto';
    }
    // Silent tiny WAV data URI to prime HTMLAudioElement on user gesture
    if (this.audioEl.paused) {
      this.audioEl.src =
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      this.audioEl.play().catch(() => undefined);
    }
  }

  public stop(): void {
    this.activeRunId += 1;
    for (const tid of this.segmentTimerIds) {
      window.clearTimeout(tid);
    }
    this.segmentTimerIds = [];

    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.onended = null;
      this.audioEl.onerror = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  private cachePut(key: string, url: string): void {
    if (this.audioCache.size >= 36) {
      const oldestKey = this.audioCache.keys().next().value;
      if (oldestKey) {
        const oldUrl = this.audioCache.get(oldestKey);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.audioCache.delete(oldestKey);
      }
    }
    this.audioCache.set(key, url);
  }

  public async speakSegments(
    segments: ReplySegment[],
    settings: AppSettings,
    callbacks: SpeakSegmentsCallbacks = {},
  ): Promise<void> {
    this.stop();
    const runId = ++this.activeRunId;
    const validSegments = segments.filter((s) => s.text.trim().length > 0);
    if (validSegments.length === 0) {
      callbacks.onStateChange?.('idle', 'browser');
      callbacks.onSegmentChange?.(-1);
      return;
    }

    const canTryGemini =
      !settings.demoMode &&
      Boolean(settings.apiKey.trim()) &&
      settings.ttsPreference !== 'browser_fast';

    if (canTryGemini) {
      try {
        callbacks.onStateChange?.('loading', 'gemini');
        const fullText = validSegments.map((s) => s.text).join(' ');
        const expressive = settings.ttsPreference === 'gemini_expressive';
        const cacheKey = `${settings.persona}:${expressive ? 'exp' : 'lite'}:${fullText}`;

        let blobUrl = this.audioCache.get(cacheKey);
        if (!blobUrl) {
          const timeoutPromise = new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error('Gemini TTS timeout')), 12000),
          );
          const blob = await Promise.race([
            synthesizeGeminiTts({
              apiKey: settings.apiKey,
              text: fullText,
              persona: settings.persona,
              expressive,
            }),
            timeoutPromise,
          ]);
          blobUrl = URL.createObjectURL(blob);
          this.cachePut(cacheKey, blobUrl);
        }

        if (runId !== this.activeRunId) return;

        await this.playAudioWithSegmentHighlights(blobUrl, validSegments, runId, callbacks);
        return;
      } catch {
        if (runId !== this.activeRunId) return;
        // Fall through seamlessly to browser speech synthesis
      }
    }

    await this.speakSegmentsWithBrowser(
      validSegments,
      settings.targetLanguage,
      runId,
      callbacks,
    );
  }

  private playAudioWithSegmentHighlights(
    blobUrl: string,
    segments: ReplySegment[],
    runId: number,
    callbacks: SpeakSegmentsCallbacks,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audioEl) {
        this.audioEl = new Audio();
      }
      const audio = this.audioEl;
      audio.src = blobUrl;

      const scheduleHighlights = () => {
        const totalDurationMs =
          Number.isFinite(audio.duration) && audio.duration > 0.2
            ? audio.duration * 1000
            : Math.max(1800, segments.reduce((acc, s) => acc + s.text.length * 85, 0));

        const weights = segments.map((s) => Math.max(2, s.text.trim().length + (s.isTarget ? 3 : 0)));
        const sumWeights = weights.reduce((a, b) => a + b, 0);

        let elapsed = 0;
        segments.forEach((_, idx) => {
          const tid = window.setTimeout(() => {
            if (runId === this.activeRunId) {
              callbacks.onSegmentChange?.(idx);
            }
          }, elapsed);
          this.segmentTimerIds.push(tid);
          elapsed += (weights[idx] / sumWeights) * totalDurationMs;
        });
      };

      audio.onloadedmetadata = () => {
        if (runId !== this.activeRunId) return;
        scheduleHighlights();
      };

      audio.onended = () => {
        if (runId === this.activeRunId) {
          callbacks.onSegmentChange?.(-1);
          callbacks.onStateChange?.('idle', 'gemini');
        }
        resolve();
      };

      audio.onerror = () => {
        if (runId === this.activeRunId) {
          callbacks.onSegmentChange?.(-1);
          callbacks.onStateChange?.('idle', 'gemini');
        }
        resolve();
      };

      callbacks.onStateChange?.('playing', 'gemini');
      callbacks.onSegmentChange?.(0);

      audio
        .play()
        .then(() => {
          if (this.segmentTimerIds.length === 0) {
            scheduleHighlights();
          }
        })
        .catch(() => {
          callbacks.onSegmentChange?.(-1);
          callbacks.onStateChange?.('idle', 'gemini');
          resolve();
        });
    });
  }

  private async speakSegmentsWithBrowser(
    segments: ReplySegment[],
    targetLanguage: TargetLanguageCode,
    runId: number,
    callbacks: SpeakSegmentsCallbacks,
  ): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      callbacks.onStateChange?.('idle', 'browser');
      callbacks.onSegmentChange?.(-1);
      return;
    }

    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const targetBcp47 = TARGET_LANGUAGES[targetLanguage].bcp47;

    const findVoice = (bcp47: string) => {
      const prefix = bcp47.split('-')[0].toLowerCase();
      return (
        voices.find((v) => v.lang.toLowerCase() === bcp47.toLowerCase()) ||
        voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
      );
    };

    callbacks.onStateChange?.('playing', 'browser');

    for (let i = 0; i < segments.length; i++) {
      if (runId !== this.activeRunId) return;
      const seg = segments[i];
      callbacks.onSegmentChange?.(i);

      await new Promise<void>((resolve) => {
        const utt = new SpeechSynthesisUtterance(seg.text);
        const langTag = seg.isTarget ? targetBcp47 : 'ko-KR';
        utt.lang = langTag;
        const matched = findVoice(langTag);
        if (matched) utt.voice = matched;
        utt.rate = seg.isTarget ? 0.92 : 1.03;

        const safetyTimer = window.setTimeout(resolve, Math.max(2500, seg.text.length * 190));
        this.segmentTimerIds.push(safetyTimer);

        utt.onend = () => {
          window.clearTimeout(safetyTimer);
          resolve();
        };
        utt.onerror = () => {
          window.clearTimeout(safetyTimer);
          resolve();
        };
        synth.speak(utt);
      });
    }

    if (runId === this.activeRunId) {
      callbacks.onSegmentChange?.(-1);
      callbacks.onStateChange?.('idle', 'browser');
    }
  }

  public async speakWord(
    word: string,
    language: TargetLanguageCode,
    settings: AppSettings,
  ): Promise<void> {
    const clean = word.replace(/\s*[（(][^)）]*[)）]\s*/g, ' ').trim() || word;
    await this.speakSegments([{ text: clean, isTarget: true }], {
      ...settings,
      targetLanguage: language,
    });
  }
}

export const ttsController = new HybridTtsController();
