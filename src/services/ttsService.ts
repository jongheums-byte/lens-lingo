import { TARGET_LANGUAGES } from '../config/languages';
import { wrapPcm16BytesToWavBlob } from '../lib/audioUtils';
import type {
  AppSettings,
  ReplySegment,
  TargetLanguageCode,
  TtsEngineKind,
} from '../types/app';
import { streamGeminiTtsChunks } from './geminiService';

export type TtsPlaybackState = 'idle' | 'loading' | 'playing';

export interface SpeakSegmentsCallbacks {
  onStateChange?: (state: TtsPlaybackState, engine: TtsEngineKind) => void;
  onSegmentChange?: (index: number) => void;
}

class HybridTtsController {
  private audioEl: HTMLAudioElement | null = null;
  private playbackCtx: AudioContext | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private activeAbortController: AbortController | null = null;
  private audioCache = new Map<string, string>();
  private segmentTimerIds: number[] = [];
  private activeRunId = 0;

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
      this.playbackCtx = new AudioCtx();
    }
    return this.playbackCtx;
  }

  /**
   * Call synchronously inside click/tap handlers so iOS Safari allows async audio playback afterwards.
   */
  public unlockAudio(): void {
    if (typeof window === 'undefined') return;
    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.preload = 'auto';
    }
    if (this.audioEl.paused) {
      this.audioEl.src =
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      this.audioEl.play().catch(() => undefined);
    }
    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => undefined);
    }
  }

  public stop(): void {
    this.activeRunId += 1;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    for (const tid of this.segmentTimerIds) {
      window.clearTimeout(tid);
    }
    this.segmentTimerIds = [];

    for (const src of this.activeSources) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // ignore already stopped sources
      }
    }
    this.activeSources = [];

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

        const cachedBlobUrl = this.audioCache.get(cacheKey);
        if (cachedBlobUrl) {
          if (runId !== this.activeRunId) return;
          await this.playAudioWithSegmentHighlights(cachedBlobUrl, validSegments, runId, callbacks);
          return;
        }

        const streamed = await this.playStreamingGeminiPcm(
          {
            apiKey: settings.apiKey,
            text: fullText,
            persona: settings.persona,
            expressive,
          },
          validSegments,
          cacheKey,
          runId,
          callbacks,
        );
        if (streamed || runId !== this.activeRunId) {
          return;
        }
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

  private async playStreamingGeminiPcm(
    ttsParams: {
      apiKey: string;
      text: string;
      persona: AppSettings['persona'];
      expressive: boolean;
    },
    segments: ReplySegment[],
    cacheKey: string,
    runId: number,
    callbacks: SpeakSegmentsCallbacks,
  ): Promise<boolean> {
    const ctx = this.ensureAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }

    let gotFirstChunk = false;
    let nextStartTime = 0;
    let sampleRate = 24000;
    let leftoverByte: number | null = null;
    const rawChunksForCache: Uint8Array[] = [];
    let lastScheduledSource: AudioBufferSourceNode | null = null;
    let totalScheduledDurationSec = 0;

    const scheduleEstimatedHighlights = () => {
      const estTotalMs = Math.max(
        1400,
        segments.reduce((acc, s) => acc + s.text.length * (s.isTarget ? 88 : 74), 0),
      );
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
        elapsed += (weights[idx] / sumWeights) * estTotalMs;
      });
    };

    try {
      const abortCtrl = new AbortController();
      this.activeAbortController = abortCtrl;
      for await (const chunk of streamGeminiTtsChunks({ ...ttsParams, signal: abortCtrl.signal })) {
        if (runId !== this.activeRunId) return true;
        sampleRate = chunk.sampleRate || 24000;
        rawChunksForCache.push(chunk.pcmBytes);

        // Merge odd trailing byte from previous chunk so Int16 LE pairs align cleanly
        let bytes = chunk.pcmBytes;
        if (leftoverByte !== null) {
          const merged = new Uint8Array(bytes.byteLength + 1);
          merged[0] = leftoverByte;
          merged.set(bytes, 1);
          bytes = merged;
          leftoverByte = null;
        }
        if (bytes.byteLength % 2 === 1) {
          leftoverByte = bytes[bytes.byteLength - 1];
          bytes = bytes.subarray(0, bytes.byteLength - 1);
        }
        if (bytes.byteLength < 2) continue;

        const sampleCount = bytes.byteLength >> 1;
        const audioBuffer = ctx.createBuffer(1, sampleCount, sampleRate);
        const channel = audioBuffer.getChannelData(0);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < sampleCount; i++) {
          channel[i] = view.getInt16(i * 2, true) / 32768;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const startAt = Math.max(ctx.currentTime + 0.025, nextStartTime);
        source.start(startAt);
        nextStartTime = startAt + audioBuffer.duration;
        totalScheduledDurationSec += audioBuffer.duration;
        this.activeSources.push(source);
        lastScheduledSource = source;

        if (!gotFirstChunk) {
          gotFirstChunk = true;
          callbacks.onStateChange?.('playing', 'gemini');
          callbacks.onSegmentChange?.(0);
          scheduleEstimatedHighlights();
        }
      }
    } catch (err) {
      if (!gotFirstChunk) {
        throw err;
      }
    }

    if (!gotFirstChunk || !lastScheduledSource) {
      return false;
    }

    // Cache full WAV in memory for instant zero-API replay
    if (rawChunksForCache.length > 0) {
      const wavBlob = wrapPcm16BytesToWavBlob(rawChunksForCache, sampleRate);
      const wavUrl = URL.createObjectURL(wavBlob);
      this.cachePut(cacheKey, wavUrl);
    }

    await new Promise<void>((resolve) => {
      const safetyMs = Math.max(800, (totalScheduledDurationSec + 1.5) * 1000);
      const safetyTid = window.setTimeout(() => {
        if (runId === this.activeRunId) {
          callbacks.onSegmentChange?.(-1);
          callbacks.onStateChange?.('idle', 'gemini');
        }
        resolve();
      }, safetyMs);
      this.segmentTimerIds.push(safetyTid);

      lastScheduledSource!.onended = () => {
        window.clearTimeout(safetyTid);
        if (runId === this.activeRunId) {
          callbacks.onSegmentChange?.(-1);
          callbacks.onStateChange?.('idle', 'gemini');
        }
        resolve();
      };
    });

    return true;
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
        utt.rate = seg.isTarget ? 0.95 : 1.05;

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
