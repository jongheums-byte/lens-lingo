import { PROFICIENCY_LEVELS, TARGET_LANGUAGES } from '../config/languages';
import { PERSONAS } from '../config/personas';
import { base64ToUint8Array } from '../lib/audioUtils';
import {
  extractAudioFromInteractionObject,
  extractCompletedFallbackText,
  extractEventAudioDelta,
  extractEventTextDelta,
  extractTextFromInteractionObject,
  parseSseBuffer,
} from '../lib/sseParser';
import {
  parseStreamingReply,
  parseTutorResponse,
  parseVocabCardsOnly,
  TUTOR_RESPONSE_JSON_SCHEMA,
  VOCAB_CARDS_ONLY_JSON_SCHEMA,
  type ParsedStreamReply,
} from '../lib/tutorParser';
import type {
  AppSettings,
  ExtractedVocab,
  PersonaId,
  ReplySegment,
  TutorModelId,
  TutorResponsePayload,
} from '../types/app';

const INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export interface AskTutorParams {
  settings: AppSettings;
  imageBase64?: string;
  imageMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  audioBase64?: string;
  audioMimeType?: string;
  textQuestion?: string;
  previousInteractionId?: string;
  previousReplyContext?: string;
  signal?: AbortSignal;
}

export interface AskTutorResult {
  payload: TutorResponsePayload;
  interactionId?: string;
}

export interface StreamTutorResult {
  userTranscript: string;
  segments: ReplySegment[];
  plainText: string;
  inlineCards: ExtractedVocab[];
  interactionId?: string;
  ttftMs: number;
  totalMs: number;
}

export class GeminiHttpError extends Error {
  public readonly status: number;
  public readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'GeminiHttpError';
    this.status = status;
    this.detail = detail;
  }
}

export function getFastThinkingLevel(model: TutorModelId): 'minimal' | 'low' {
  return model === 'gemini-3.8-flash' ? 'low' : 'minimal';
}

function extractApiErrorDetail(status: number, rawBody: string): string {
  let detail = '';
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      if (first && typeof first === 'object') {
        const obj = first as Record<string, unknown>;
        const nested = obj.error as Record<string, unknown> | undefined;
        detail =
          (typeof nested?.message === 'string' && nested.message) ||
          (typeof obj.message === 'string' && obj.message) ||
          '';
      }
    } catch {
      detail = rawBody.slice(0, 180);
    }
  }

  if (status === 429) {
    return `무료 요청 한도 초과(429): 잠시 후 다시 시도하거나 모델을 변경해 주세요.${detail ? ` (${detail})` : ''}`;
  }
  if (status === 401 || status === 403) {
    return `API 키 인증 오류(${status}): 설정에서 Gemini API 키를 확인해 주세요.${detail ? ` (${detail})` : ''}`;
  }
  if (status === 503 || status === 500) {
    return `Google AI 서버 일시 혼잡(${status}): 잠시 후 다시 시도해 주세요.`;
  }
  return `[HTTP ${status}] ${detail || '요청 처리 중 오류가 발생했습니다.'}`;
}

export function formatGeminiError(err: unknown): string {
  console.error('[LensLingo Gemini Error]', err);
  if (err instanceof GeminiHttpError) {
    return err.detail;
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return '요청 시간이 초과되었거나 취소되었습니다.';
  }
  return err instanceof Error ? err.message : String(err);
}

function createTimedController(timeoutMs: number, externalSignal?: AbortSignal): {
  controller: AbortController;
  didTimeout: () => boolean;
  clear: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timerId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    didTimeout: () => timedOut,
    clear: () => {
      window.clearTimeout(timerId);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function fetchInteractionJson(
  apiKey: string,
  body: Record<string, unknown>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const { timeoutMs = 10000, signal } = options;
  const timed = createTimedController(timeoutMs, signal);

  try {
    const res = await fetch(INTERACTIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify(body),
      signal: timed.controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new GeminiHttpError(res.status, extractApiErrorDetail(res.status, text));
    }

    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    if (timed.didTimeout()) {
      throw new Error(`응답 시간 초과 (${Math.round(timeoutMs / 1000)}초) — 다시 시도해 주세요.`);
    }
    throw err;
  } finally {
    timed.clear();
  }
}

function buildSystemInstruction(settings: AppSettings): string {
  const lang = TARGET_LANGUAGES[settings.targetLanguage];
  const level = PROFICIENCY_LEVELS[settings.level];
  const persona = PERSONAS[settings.persona];

  const template = settings.customPersonaPrompt.trim() || persona.defaultPromptTemplate;
  const resolvedPersona = template
    .replaceAll('{MAIN_LANGUAGE}', 'Korean')
    .replaceAll('{LEARN_LANGUAGE}', lang.englishName);

  return `${resolvedPersona}
Level: ${level.koreanLabel}. ${level.promptRule}
Reply in 1-2 short sentences mixing Korean and ${lang.englishName}, extract 1-2 vocabCards with ${lang.readingGuideInstruction}, Korean pronunciation, and [ymin,xmin,ymax,xmax] 0-1000 box2d.`;
}

/**
 * Ultra-compact single-stream prompt:
 * Emits spoken reply first (with <t>target</t> tags), then 1-2 compact `W:` card lines.
 * Eliminates the slow Pass 2 LLM roundtrip & duplicate image upload!
 */
function buildFastSingleStreamInstruction(settings: AppSettings, hasAudio: boolean): string {
  const lang = TARGET_LANGUAGES[settings.targetLanguage];
  const level = PROFICIENCY_LEVELS[settings.level];
  const persona = PERSONAS[settings.persona];

  const custom = settings.customPersonaPrompt.trim();
  const personaLine = custom
    ? custom.replaceAll('{MAIN_LANGUAGE}', 'Korean').replaceAll('{LEARN_LANGUAGE}', lang.englishName)
    : `You are ${persona.name} (${persona.koreanTitle}), a concise ${lang.englishName} tutor for a Korean learner (${level.koreanLabel}).`;

  const qRule = hasAudio ? `Line 1: "Q: <what user said>"\n` : '';

  return `${personaLine}
Output strictly in this fast format (NO markdown, NO JSON):
${qRule}Reply (1-2 short spoken sentences in Korean; wrap EVERY ${lang.englishName} phrase in <t>...</t>).
Then 1-2 lines starting with "W:":
W: <${lang.englishName} word> | <한글발음/읽기> | <한국어 뜻> | <short ${lang.englishName} example> | <한국어 예문뜻> | <ymin,xmin,ymax,xmax in 0-1000>`;
}

/**
 * Sub-10s Fast Single-Stream Tutor with 4.5s Hedged Tail-Latency Killer:
 * - Uses `store: false`, `thinking_level: minimal/low`, `resolution: low`, `max_output_tokens: 260`.
 * - Fires `onReplyReady` the moment the spoken reply finishes (even before `W:` cards complete) so TTS starts immediately.
 * - If zero text tokens arrive within 4.5s (Free Tier tail-latency spike), races a parallel hedged `gemini-3.1-flash-lite`
 *   unary request and immediately takes whichever answers first — enforcing a hard ~10s ceiling!
 */
export async function streamTutorReply(
  params: AskTutorParams & {
    onPartial: (partial: ParsedStreamReply) => void;
    onReplyReady?: (partial: ParsedStreamReply) => void;
    onStage?: (stage: string) => void;
  },
): Promise<StreamTutorResult> {
  const {
    settings,
    imageBase64,
    imageMimeType = 'image/jpeg',
    audioBase64,
    audioMimeType = 'audio/wav',
    textQuestion,
    previousReplyContext,
    signal,
    onPartial,
    onReplyReady,
    onStage,
  } = params;

  if (!settings.apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const lang = TARGET_LANGUAGES[settings.targetLanguage];
  const startMs = performance.now();

  const contextPrefix = previousReplyContext?.trim()
    ? `Previous tutor reply: "${previousReplyContext.trim().slice(0, 140)}". `
    : '';

  const promptText = audioBase64
    ? `${contextPrefix}Answer the user's spoken question about the image.`
    : textQuestion?.trim()
      ? `${contextPrefix}User asks: "${textQuestion.trim()}". Answer briefly.`
      : `Teach the main object in this image in ${lang.englishName} with 1 useful phrase.`;

  type InputBlock =
    | { type: 'text'; text: string }
    | {
        type: 'image';
        data: string;
        mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
        resolution?: 'low' | 'medium' | 'high';
      }
    | { type: 'audio'; data: string; mime_type: string };

  const inputBlocks: InputBlock[] = [{ type: 'text', text: promptText }];
  if (imageBase64) {
    inputBlocks.push({
      type: 'image',
      data: imageBase64,
      mime_type: imageMimeType,
      resolution: 'low',
    });
  }
  if (audioBase64) {
    inputBlocks.push({
      type: 'audio',
      data: audioBase64,
      mime_type: audioMimeType,
    });
  }

  const systemInstruction = buildFastSingleStreamInstruction(settings, Boolean(audioBase64));
  const makePayload = (model: TutorModelId, stream: boolean): Record<string, unknown> => ({
    model,
    system_instruction: systemInstruction,
    input: inputBlocks,
    store: false,
    generation_config: {
      thinking_level: getFastThinkingLevel(model),
      max_output_tokens: 260,
    },
    stream,
  });

  const fallbackTranscript =
    textQuestion?.trim() || (audioBase64 ? '🎙️ 음성 질문' : '📸 이거 뭐예요?');

  // Overall hard ceiling controller (10.5s max before first token, 15s total)
  const primaryCtrl = new AbortController();
  const hedgeCtrl = new AbortController();
  let settled = false;
  let gotFirstToken = false;
  let firedReplyReady = false;

  const linkExternal = () => {
    primaryCtrl.abort();
    hedgeCtrl.abort();
  };
  if (signal) {
    if (signal.aborted) {
      linkExternal();
    } else {
      signal.addEventListener('abort', linkExternal, { once: true });
    }
  }

  const runPrimarySse = async (): Promise<StreamTutorResult> => {
    let timed = createTimedController(10500, primaryCtrl.signal);

    try {
      onStage?.('📡 AI 서버 연결 중...');
      const res = await fetch(INTERACTIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-goog-api-key': settings.apiKey.trim(),
        },
        body: JSON.stringify(makePayload(settings.tutorModel, true)),
        signal: timed.controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new GeminiHttpError(res.status, extractApiErrorDetail(res.status, errText));
      }

      if (!settled) onStage?.('🧠 장면 분석 중...');

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.body || contentType.includes('application/json')) {
        const jsonText = await res.text();
        const data = JSON.parse(jsonText) as Record<string, unknown>;
        const rawText = extractTextFromInteractionObject(data);
        const parsed = parseStreamingReply(rawText);
        if (!settled) {
          onPartial(parsed);
          if (!firedReplyReady && parsed.plainText.trim()) {
            firedReplyReady = true;
            onReplyReady?.(parsed);
          }
        }
        const totalMs = Math.round(performance.now() - startMs);
        return {
          userTranscript: parsed.userTranscript || fallbackTranscript,
          segments:
            parsed.segments.length > 0
              ? parsed.segments
              : [{ text: parsed.plainText || rawText, isTarget: false }],
          plainText: parsed.plainText || rawText,
          inlineCards: parsed.inlineCards,
          interactionId: typeof data.id === 'string' ? data.id : undefined,
          ttftMs: totalMs,
          totalMs,
        };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let sseBuffer = '';
      let accumulated = '';
      let ttftMs = 0;
      let completedId: string | undefined;
      let latestParsed: ParsedStreamReply = {
        segments: [],
        plainText: '',
        replyReady: false,
        inlineCards: [],
      };

      const processFrameData = (rawData: string): boolean => {
        if (rawData === '[DONE]') return true;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(rawData) as Record<string, unknown>;
        } catch {
          return false;
        }

        if (ev.event_type === 'error') {
          const errObj = ev.error as Record<string, unknown> | undefined;
          throw new Error(
            (typeof errObj?.message === 'string' && errObj.message) || 'Gemini 스트리밍 오류',
          );
        }

        const deltaText = extractEventTextDelta(ev);
        if (deltaText && !settled) {
          if (!gotFirstToken) {
            gotFirstToken = true;
            ttftMs = Math.round(performance.now() - startMs);
            // Primary won! Cancel any hedged backup immediately and extend read window
            hedgeCtrl.abort();
            timed.clear();
            timed = createTimedController(10000, primaryCtrl.signal);
          }
          accumulated += deltaText;
          latestParsed = parseStreamingReply(accumulated);
          onPartial(latestParsed);
          if (latestParsed.replyReady && !firedReplyReady && latestParsed.plainText.trim()) {
            firedReplyReady = true;
            onReplyReady?.(latestParsed);
          }
        }

        if (ev.event_type === 'interaction.completed') {
          const interaction = ev.interaction as Record<string, unknown> | undefined;
          if (typeof interaction?.id === 'string') {
            completedId = interaction.id;
          }
          if (!accumulated.trim() && !settled) {
            const fallbackText = extractCompletedFallbackText(ev);
            if (fallbackText) {
              gotFirstToken = true;
              hedgeCtrl.abort();
              accumulated = fallbackText;
              latestParsed = parseStreamingReply(accumulated);
              onPartial(latestParsed);
            }
          }
        }
        return false;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const finalText = decoder.decode();
          if (finalText) sseBuffer += finalText;
          if (sseBuffer.trim()) {
            const { events } = parseSseBuffer(sseBuffer + '\n\n');
            for (const e of events) processFrameData(e.data);
          }
          break;
        }

        sseBuffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseBuffer(sseBuffer);
        sseBuffer = remainder;

        let sawDone = false;
        for (const e of events) {
          if (processFrameData(e.data)) {
            sawDone = true;
            break;
          }
        }
        if (sawDone) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }

      const totalMs = Math.round(performance.now() - startMs);
      if (!latestParsed.plainText.trim()) {
        throw new Error('튜터 응답이 비어 있습니다.');
      }

      return {
        userTranscript: latestParsed.userTranscript || fallbackTranscript,
        segments:
          latestParsed.segments.length > 0
            ? latestParsed.segments
            : [{ text: latestParsed.plainText, isTarget: false }],
        plainText: latestParsed.plainText,
        inlineCards: latestParsed.inlineCards,
        interactionId: completedId,
        ttftMs: ttftMs || totalMs,
        totalMs,
      };
    } catch (err) {
      if (timed.didTimeout() && !signal?.aborted) {
        throw new Error('응답 시간 초과 (10초) — 다시 스캔해 주세요.');
      }
      throw err;
    } finally {
      timed.clear();
    }
  };

  const runHedgedFastBackup = async (): Promise<StreamTutorResult> => {
    // Wait 4.5s before hedging so normal fast calls only ever spend 1 API request
    await new Promise<void>((resolve, reject) => {
      const tid = window.setTimeout(resolve, 4500);
      const onAbort = () => {
        window.clearTimeout(tid);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (hedgeCtrl.signal.aborted) {
        onAbort();
      } else {
        hedgeCtrl.signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    if (gotFirstToken || settled || hedgeCtrl.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    onStage?.('⚡ 초고속 예비 경로 가동 중...');
    const data = await fetchInteractionJson(
      settings.apiKey,
      makePayload('gemini-3.1-flash-lite', false),
      { timeoutMs: 6500, signal: hedgeCtrl.signal },
    );

    if (gotFirstToken || settled) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const rawText = extractTextFromInteractionObject(data);
    if (!rawText.trim()) {
      throw new Error('튜터 응답이 비어 있습니다.');
    }
    const parsed = parseStreamingReply(rawText);
    const totalMs = Math.round(performance.now() - startMs);
    onPartial(parsed);
    return {
      userTranscript: parsed.userTranscript || fallbackTranscript,
      segments:
        parsed.segments.length > 0
          ? parsed.segments
          : [{ text: parsed.plainText || rawText, isTarget: false }],
      plainText: parsed.plainText || rawText,
      inlineCards: parsed.inlineCards,
      interactionId: typeof data.id === 'string' ? data.id : undefined,
      ttftMs: totalMs,
      totalMs,
    };
  };

  try {
    // Race primary SSE against 4.5s-delayed hedged fast backup; first success wins!
    const primaryPromise = runPrimarySse();
    const hedgePromise = runHedgedFastBackup();

    const result = await new Promise<StreamTutorResult>((resolve, reject) => {
      let primaryErr: unknown = null;
      let hedgeErr: unknown = null;
      let primaryDone = false;
      let hedgeDone = false;

      const finishWin = (res: StreamTutorResult, winner: 'primary' | 'hedge') => {
        if (settled) return;
        settled = true;
        if (winner === 'primary') hedgeCtrl.abort();
        else primaryCtrl.abort();
        resolve(res);
      };

      const checkBothFailed = () => {
        if (!settled && primaryDone && hedgeDone) {
          settled = true;
          reject(primaryErr || hedgeErr || new Error('응답을 받지 못했습니다.'));
        }
      };

      primaryPromise.then(
        (res) => finishWin(res, 'primary'),
        (err) => {
          primaryDone = true;
          primaryErr = err;
          // If primary failed immediately with auth/rate-limit/400 error, don't wait 4.5s for hedge
          if (err instanceof GeminiHttpError && (err.status === 400 || err.status === 401 || err.status === 403 || err.status === 429)) {
            hedgeCtrl.abort();
            settled = true;
            reject(err);
            return;
          }
          checkBothFailed();
        },
      );

      hedgePromise.then(
        (res) => finishWin(res, 'hedge'),
        (err) => {
          hedgeDone = true;
          hedgeErr = err;
          checkBothFailed();
        },
      );
    });

    return result;
  } catch (err) {
    if (signal?.aborted) {
      throw err;
    }
    throw new Error(formatGeminiError(err));
  } finally {
    settled = true;
    primaryCtrl.abort();
    hedgeCtrl.abort();
    signal?.removeEventListener('abort', linkExternal);
  }
}

/**
 * Fallback Pass 2 (only called if Pass 1 didn't emit inline `W:` cards).
 */
export async function extractVocabCardsAsync(params: {
  settings: AppSettings;
  replyText: string;
  imageBase64?: string;
  imageMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  signal?: AbortSignal;
}): Promise<{ translationSummary: string; vocabCards: ExtractedVocab[] }> {
  const { settings, replyText, imageBase64, imageMimeType = 'image/jpeg', signal } = params;
  if (!settings.apiKey.trim()) {
    return { translationSummary: '', vocabCards: [] };
  }

  const lang = TARGET_LANGUAGES[settings.targetLanguage];

  type InputBlock =
    | { type: 'text'; text: string }
    | {
        type: 'image';
        data: string;
        mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
        resolution?: 'low' | 'medium' | 'high';
      };

  const inputBlocks: InputBlock[] = [
    {
      type: 'text',
      text: `Tutor taught:\n"${replyText}"\nExtract 1-2 ${lang.englishName} vocabCards with ${lang.readingGuideInstruction} and [ymin,xmin,ymax,xmax] 0-1000 box2d.`,
    },
  ];

  if (imageBase64) {
    inputBlocks.push({
      type: 'image',
      data: imageBase64,
      mime_type: imageMimeType,
      resolution: 'low',
    });
  }

  try {
    const data = await fetchInteractionJson(
      settings.apiKey,
      {
        model: 'gemini-3.1-flash-lite',
        input: inputBlocks,
        store: false,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: VOCAB_CARDS_ONLY_JSON_SCHEMA,
        },
        generation_config: {
          thinking_level: 'minimal',
          max_output_tokens: 280,
        },
      },
      { timeoutMs: 8000, signal },
    );

    const rawText = extractTextFromInteractionObject(data);
    if (!rawText) return { translationSummary: '', vocabCards: [] };
    return parseVocabCardsOnly(rawText);
  } catch (err) {
    console.warn('[LensLingo Pass 2 card extraction warning]', formatGeminiError(err));
    return { translationSummary: '', vocabCards: [] };
  }
}

export async function askTutor({
  settings,
  imageBase64,
  imageMimeType = 'image/jpeg',
  audioBase64,
  audioMimeType = 'audio/wav',
  textQuestion,
  signal,
}: AskTutorParams): Promise<AskTutorResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const lang = TARGET_LANGUAGES[settings.targetLanguage];

  const promptText = audioBase64
    ? `Answer the user's spoken question about this scene concisely.`
    : textQuestion?.trim()
      ? `User asks: "${textQuestion.trim()}". Answer concisely.`
      : `Identify the main object in this image and teach its ${lang.englishName} name and 1 useful phrase.`;

  const inputBlocks: Record<string, unknown>[] = [{ type: 'text', text: promptText }];
  if (imageBase64) {
    inputBlocks.push({
      type: 'image',
      data: imageBase64,
      mime_type: imageMimeType,
      resolution: 'low',
    });
  }
  if (audioBase64) {
    inputBlocks.push({
      type: 'audio',
      data: audioBase64,
      mime_type: audioMimeType,
    });
  }

  const data = await fetchInteractionJson(
    settings.apiKey,
    {
      model: settings.tutorModel,
      system_instruction: buildSystemInstruction(settings),
      input: inputBlocks,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: TUTOR_RESPONSE_JSON_SCHEMA,
      },
      generation_config: {
        thinking_level: getFastThinkingLevel(settings.tutorModel),
        max_output_tokens: 340,
      },
    },
    { timeoutMs: 10000, signal },
  );

  const rawText = extractTextFromInteractionObject(data);
  if (!rawText) {
    throw new Error('튜터 응답이 비어 있습니다.');
  }

  const payload = parseTutorResponse(
    rawText,
    textQuestion?.trim() || (audioBase64 ? '🎙️ 음성 질문' : '📸 이거 뭐예요?'),
  );

  return {
    payload,
    interactionId: typeof data.id === 'string' ? data.id : undefined,
  };
}

/**
 * Streams raw 16-bit signed LE mono PCM audio chunks (default 24kHz) directly via native fetch
 * with a snappy 3.5-second first-chunk timeout so slow Free Tier TTS falls back immediately to browser speech.
 */
export async function* streamGeminiTtsChunks(params: {
  apiKey: string;
  text: string;
  persona: PersonaId;
  expressive?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<{ pcmBytes: Uint8Array; sampleRate: number }> {
  const personaCfg = PERSONAS[params.persona];
  const model = params.expressive ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts';
  let timed = createTimedController(3500, params.signal);
  let gotFirstChunk = false;

  try {
    const res = await fetch(INTERACTIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-goog-api-key': params.apiKey.trim(),
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            type: 'user_input',
            content: [
              {
                type: 'text',
                text: params.text,
                annotations: [
                  {
                    type: 'speech_metadata',
                    style: personaCfg.ttsStyle,
                  },
                ],
              },
            ],
          },
        ],
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ voice: personaCfg.geminiVoice }],
        },
        stream: true,
      }),
      signal: timed.controller.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new GeminiHttpError(res.status, extractApiErrorDetail(res.status, errText));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let sseBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const finalText = decoder.decode();
        if (finalText) sseBuffer += finalText;
        break;
      }

      sseBuffer += decoder.decode(value, { stream: true });
      const { events, remainder } = parseSseBuffer(sseBuffer);
      sseBuffer = remainder;

      for (const e of events) {
        if (e.data === '[DONE]') {
          await reader.cancel().catch(() => undefined);
          return;
        }
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(e.data) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (ev.event_type === 'error') {
          throw new Error('Gemini TTS stream error');
        }

        const audioDelta = extractEventAudioDelta(ev);
        if (audioDelta) {
          if (!gotFirstChunk) {
            gotFirstChunk = true;
            timed.clear();
            timed = createTimedController(15000, params.signal);
          }
          const pcmBytes = base64ToUint8Array(audioDelta.data);
          if (pcmBytes.byteLength > 0) {
            yield { pcmBytes, sampleRate: audioDelta.sampleRate };
          }
        }
      }
    }
  } finally {
    timed.clear();
  }
}

export async function synthesizeGeminiTts(params: {
  apiKey: string;
  text: string;
  persona: PersonaId;
  expressive?: boolean;
}): Promise<Blob> {
  const personaCfg = PERSONAS[params.persona];
  const model = params.expressive ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts';

  const data = await fetchInteractionJson(
    params.apiKey,
    {
      model,
      store: false,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: params.text,
              annotations: [
                {
                  type: 'speech_metadata',
                  style: personaCfg.ttsStyle,
                },
              ],
            },
          ],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ voice: personaCfg.geminiVoice }],
      },
    },
    { timeoutMs: 8000 },
  );

  const audioObj = extractAudioFromInteractionObject(data);
  if (!audioObj) {
    throw new Error('Gemini TTS audio payload missing');
  }

  const bytes = base64ToUint8Array(audioObj.data);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: audioObj.mimeType });
}

export async function verifyGeminiApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  if (!apiKey.trim()) {
    return { ok: false, message: 'API 키를 입력해 주세요.' };
  }
  try {
    const data = await fetchInteractionJson(
      apiKey,
      {
        model: 'gemini-3.1-flash-lite',
        input: 'Reply with OK.',
        store: false,
        generation_config: {
          thinking_level: 'minimal',
          max_output_tokens: 16,
        },
      },
      { timeoutMs: 8000 },
    );
    const out = extractTextFromInteractionObject(data);
    if (out || data.id) {
      return { ok: true, message: '연결 성공! Gemini 3.1 초고속 튜터를 사용할 수 있습니다.' };
    }
    return { ok: false, message: '응답을 받지 못했습니다.' };
  } catch (err) {
    return { ok: false, message: `연결 실패: ${formatGeminiError(err)}` };
  }
}
