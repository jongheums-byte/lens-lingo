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
  return model === 'gemini-3.5-flash-lite' ? 'minimal' : 'low';
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
    return `무료 요청 한도 초과(429): 잠시 후 다시 시도하거나 설정에서 모델을 변경해 주세요.${detail ? ` (${detail})` : ''}`;
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

/**
 * Links an optional external AbortSignal with a hard timeout AbortController.
 */
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
  const { timeoutMs = 12000, signal } = options;
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
      throw new Error(`응답 시간 초과 (${Math.round(timeoutMs / 1000)}초) — 네트워크 상태를 확인하고 다시 시도해 주세요.`);
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

Teaching Level: ${level.koreanLabel} (${settings.level}). ${level.promptRule}

Strict Response & Output Rules:
1. Respond in natural Korean mixed with short, directly usable ${lang.englishName} (${lang.nativeName}) target words or phrases.
2. Keep the entire reply concise: strictly 1 to 3 short sentences total.
3. Split your reply cleanly into \`replySegments\`. Mark EVERY ${lang.englishName} phrase with \`isTarget: true\` and EVERY Korean explanation/particle with \`isTarget: false\`. Never put both Korean and ${lang.englishName} inside the same segment.
4. For \`vocabCards\`, pick 1 to 3 focal items from the photo or conversation. Provide \`reading\` as ${lang.readingGuideInstruction}, plus easy-to-read \`koreanPronunciation\` in Hangul.
5. Whenever an image is provided, populate \`box2d\` as [ymin, xmin, ymax, xmax] normalized from 0 to 1000 tightly wrapping each corresponding object in the photo.
6. If audio is provided, transcribe what the student said (even if mixed Korean + ${lang.englishName}) into \`userTranscript\`.`;
}

function buildStreamingSystemInstruction(settings: AppSettings, hasAudio: boolean): string {
  const lang = TARGET_LANGUAGES[settings.targetLanguage];
  const level = PROFICIENCY_LEVELS[settings.level];
  const persona = PERSONAS[settings.persona];

  const template = settings.customPersonaPrompt.trim() || persona.defaultPromptTemplate;
  const resolvedPersona = template
    .replaceAll('{MAIN_LANGUAGE}', 'Korean')
    .replaceAll('{LEARN_LANGUAGE}', lang.englishName);

  const audioPrefixRule = hasAudio
    ? `Start with ONE short first line "Q: <what the student said>" then a newline, then your reply.`
    : `Output ONLY the reply immediately without any preamble.`;

  return `${resolvedPersona}

Teaching Level: ${level.koreanLabel} (${settings.level}). ${level.promptRule}

Fast Real-Time Tutoring Rules:
1. ${audioPrefixRule}
2. Reply in natural Korean mixed with practical ${lang.englishName} (${lang.nativeName}) phrases.
3. Keep it crisp and spoken-friendly: strictly 1 to 2 short sentences total.
4. Wrap EVERY ${lang.englishName} word or phrase in <t>...</t> tags (e.g. 이건 <t>Rubik's Cube</t>예요. <t>Can I try it?</t>처럼 말해보세요!). Never nest tags and never output JSON.`;
}

/**
 * Pass 1 (Fast Streaming with Hard Timeout & Non-Streaming Fallback):
 * Uses direct native fetch + ReadableStream.getReader() so mobile browsers never hang in SDK retries.
 */
export async function streamTutorReply(
  params: AskTutorParams & {
    onPartial: (partial: ParsedStreamReply) => void;
  },
): Promise<StreamTutorResult> {
  const {
    settings,
    imageBase64,
    imageMimeType = 'image/jpeg',
    audioBase64,
    audioMimeType = 'audio/wav',
    textQuestion,
    previousInteractionId,
    signal,
    onPartial,
  } = params;

  if (!settings.apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const lang = TARGET_LANGUAGES[settings.targetLanguage];
  const startMs = performance.now();

  const promptText = audioBase64
    ? `Answer the student's spoken question about this scene concisely.`
    : textQuestion?.trim()
      ? `Student question: "${textQuestion.trim()}". Answer concisely based on the scene.`
      : `Identify the focal item in this image and teach its ${lang.englishName} expression and one quick useful phrase.`;

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

  const makePayload = (prevId: string | undefined, stream: boolean): Record<string, unknown> => ({
    model: settings.tutorModel,
    system_instruction: buildStreamingSystemInstruction(settings, Boolean(audioBase64)),
    ...(prevId ? { previous_interaction_id: prevId } : {}),
    input: inputBlocks,
    generation_config: {
      thinking_level: getFastThinkingLevel(settings.tutorModel),
    },
    stream,
  });

  const fallbackTranscript =
    textQuestion?.trim() || (audioBase64 ? '🎙️ 음성 질문' : '📸 이거 뭐예요?');

  const runUnaryFallback = async (prevId?: string): Promise<StreamTutorResult> => {
    const data = await fetchInteractionJson(settings.apiKey, makePayload(prevId, false), {
      timeoutMs: 12000,
      signal,
    });
    const rawText = extractTextFromInteractionObject(data);
    if (!rawText.trim()) {
      throw new Error('튜터 응답이 비어 있습니다.');
    }
    const parsed = parseStreamingReply(rawText);
    onPartial(parsed);
    const totalMs = Math.round(performance.now() - startMs);
    return {
      userTranscript: parsed.userTranscript || fallbackTranscript,
      segments:
        parsed.segments.length > 0
          ? parsed.segments
          : [{ text: parsed.plainText || rawText, isTarget: false }],
      plainText: parsed.plainText || rawText,
      interactionId: typeof data.id === 'string' ? data.id : undefined,
      ttftMs: totalMs,
      totalMs,
    };
  };

  const runSse = async (prevId?: string): Promise<StreamTutorResult> => {
    // 10s hard deadline to receive first text token; reset/extended once tokens flow
    let timed = createTimedController(10000, signal);
    let gotFirstToken = false;

    try {
      const res = await fetch(INTERACTIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-goog-api-key': settings.apiKey.trim(),
        },
        body: JSON.stringify(makePayload(prevId, true)),
        signal: timed.controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new GeminiHttpError(res.status, extractApiErrorDetail(res.status, errText));
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.body || contentType.includes('application/json')) {
        const jsonText = await res.text();
        const data = JSON.parse(jsonText) as Record<string, unknown>;
        const rawText = extractTextFromInteractionObject(data);
        const parsed = parseStreamingReply(rawText);
        onPartial(parsed);
        const totalMs = Math.round(performance.now() - startMs);
        return {
          userTranscript: parsed.userTranscript || fallbackTranscript,
          segments:
            parsed.segments.length > 0
              ? parsed.segments
              : [{ text: parsed.plainText || rawText, isTarget: false }],
          plainText: parsed.plainText || rawText,
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
      let latestParsed: ParsedStreamReply = { segments: [], plainText: '' };

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
        if (deltaText) {
          if (!gotFirstToken) {
            gotFirstToken = true;
            ttftMs = Math.round(performance.now() - startMs);
            // Extend remaining stream timeout once first token arrives
            timed.clear();
            timed = createTimedController(15000, signal);
          }
          accumulated += deltaText;
          latestParsed = parseStreamingReply(accumulated);
          onPartial(latestParsed);
        }

        if (ev.event_type === 'interaction.completed') {
          const interaction = ev.interaction as Record<string, unknown> | undefined;
          if (typeof interaction?.id === 'string') {
            completedId = interaction.id;
          }
          if (!accumulated.trim()) {
            const fallbackText = extractCompletedFallbackText(ev);
            if (fallbackText) {
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
        interactionId: completedId,
        ttftMs: ttftMs || totalMs,
        totalMs,
      };
    } catch (err) {
      // If user explicitly cancelled, rethrow AbortError cleanly
      if (signal?.aborted) {
        throw err;
      }
      // If SSE timed out before receiving a single token (e.g. mobile proxy buffering SSE),
      // automatically fall back to a clean unary request once.
      if (timed.didTimeout() && !gotFirstToken) {
        return runUnaryFallback(prevId);
      }
      throw err;
    } finally {
      timed.clear();
    }
  };

  try {
    return await runSse(previousInteractionId?.trim() || undefined);
  } catch (err) {
    if (signal?.aborted) {
      throw err;
    }
    if (
      previousInteractionId?.trim() &&
      err instanceof GeminiHttpError &&
      (err.status === 400 || err.status === 404)
    ) {
      try {
        return await runSse(undefined);
      } catch (retryErr) {
        throw new Error(formatGeminiError(retryErr));
      }
    }
    throw new Error(formatGeminiError(err));
  }
}

/**
 * Pass 2 (Background Non-Blocking): Uses ultra-fast gemini-3.5-flash-lite with minimal thinking
 * to extract 1-3 sticker vocabulary cards + bounding boxes while Pass 1 TTS is already playing.
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
      text: `Tutor taught this ${lang.englishName} lesson:\n"${replyText}"\n\nExtract 1 to 3 key ${lang.englishName} vocabulary cards matching what was taught and visible in the image. For \`reading\`, provide ${lang.readingGuideInstruction}. Populate \`box2d\` as [ymin, xmin, ymax, xmax] normalized 0-1000 around each object.`,
    },
  ];

  if (imageBase64) {
    inputBlocks.push({
      type: 'image',
      data: imageBase64,
      mime_type: imageMimeType,
      resolution: 'medium',
    });
  }

  try {
    const data = await fetchInteractionJson(
      settings.apiKey,
      {
        model: 'gemini-3.5-flash-lite',
        input: inputBlocks,
        store: false,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: VOCAB_CARDS_ONLY_JSON_SCHEMA,
        },
        generation_config: {
          thinking_level: 'minimal',
        },
      },
      { timeoutMs: 12000, signal },
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
  previousInteractionId,
  signal,
}: AskTutorParams): Promise<AskTutorResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const lang = TARGET_LANGUAGES[settings.targetLanguage];

  const promptText = audioBase64
    ? `Listen to the student's spoken question (which may mix Korean and ${lang.englishName}) about this scene, answer concisely as the tutor, and extract 1-3 vocabulary cards with bounding boxes.`
    : textQuestion?.trim()
      ? `Student question: "${textQuestion.trim()}". Answer concisely as the tutor based on the scene and extract 1-3 vocabulary cards with bounding boxes.`
      : `Identify the main focal object, menu item, or sign in this image. Teach its ${lang.englishName} name, natural pronunciation, and one quick practical phrase for using it in real life.`;

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

  const runCreate = (prevId?: string) =>
    fetchInteractionJson(
      settings.apiKey,
      {
        model: settings.tutorModel,
        system_instruction: buildSystemInstruction(settings),
        ...(prevId ? { previous_interaction_id: prevId } : {}),
        input: inputBlocks,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: TUTOR_RESPONSE_JSON_SCHEMA,
        },
        generation_config: {
          thinking_level: getFastThinkingLevel(settings.tutorModel),
        },
      },
      { timeoutMs: 14000, signal },
    );

  let data: Record<string, unknown>;
  try {
    data = await runCreate(previousInteractionId?.trim() || undefined);
  } catch (err) {
    if (
      previousInteractionId?.trim() &&
      err instanceof GeminiHttpError &&
      (err.status === 400 || err.status === 404)
    ) {
      data = await runCreate(undefined);
    } else {
      throw new Error(formatGeminiError(err));
    }
  }

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
 * with an 8-second first-chunk timeout so TTS never hangs silently.
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
  let timed = createTimedController(8000, params.signal);
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
    { timeoutMs: 12000 },
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
        model: 'gemini-3.5-flash-lite',
        input: 'Reply with OK.',
        store: false,
        generation_config: {
          thinking_level: 'minimal',
        },
      },
      { timeoutMs: 8000 },
    );
    const out = extractTextFromInteractionObject(data);
    if (out || data.id) {
      return { ok: true, message: '연결 성공! Gemini 초고속 튜터를 사용할 수 있습니다.' };
    }
    return { ok: false, message: '응답을 받지 못했습니다.' };
  } catch (err) {
    return { ok: false, message: `연결 실패: ${formatGeminiError(err)}` };
  }
}
