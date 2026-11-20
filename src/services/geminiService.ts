import { GoogleGenAI } from '@google/genai';
import { PROFICIENCY_LEVELS, TARGET_LANGUAGES } from '../config/languages';
import { PERSONAS } from '../config/personas';
import { base64ToUint8Array } from '../lib/audioUtils';
import { parseTutorResponse, TUTOR_RESPONSE_JSON_SCHEMA } from '../lib/tutorParser';
import type { AppSettings, PersonaId, TutorResponsePayload } from '../types/app';

export interface AskTutorParams {
  settings: AppSettings;
  imageBase64?: string;
  imageMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  audioBase64?: string;
  audioMimeType?: string;
  textQuestion?: string;
  previousInteractionId?: string;
}

export interface AskTutorResult {
  payload: TutorResponsePayload;
  interactionId?: string;
}

function createClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: { apiVersion: 'v1beta' },
  });
}

function getErrorStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const obj = err as Record<string, unknown>;
  if (typeof obj.statusCode === 'number') return obj.statusCode;
  if (typeof obj.status === 'number') return obj.status;
  return undefined;
}

export function formatGeminiError(err: unknown): string {
  console.error('[LensLingo Gemini Error]', err);
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const status = getErrorStatusCode(err);
    const prefix = status ? `[HTTP ${status}] ` : '';

    if (typeof obj.body === 'string' && obj.body.trim()) {
      try {
        const parsed = JSON.parse(obj.body) as Record<string, unknown>;
        const nestedErr = parsed.error as Record<string, unknown> | undefined;
        const bodyMsg =
          (typeof nestedErr?.message === 'string' && nestedErr.message) ||
          (typeof parsed.message === 'string' && parsed.message);
        if (bodyMsg) return `${prefix}${bodyMsg}`;
      } catch {
        return `${prefix}${obj.body.slice(0, 220)}`;
      }
    }

    if (obj.error && typeof obj.error === 'object') {
      const e1 = obj.error as Record<string, unknown>;
      const e2 = e1.error && typeof e1.error === 'object' ? (e1.error as Record<string, unknown>) : undefined;
      const errMsg =
        (typeof e2?.message === 'string' && e2.message) ||
        (typeof e1.message === 'string' && e1.message);
      if (errMsg) return `${prefix}${errMsg}`;
    }

    if (typeof obj.message === 'string' && obj.message) {
      return `${prefix}${obj.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
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

export async function askTutor({
  settings,
  imageBase64,
  imageMimeType = 'image/jpeg',
  audioBase64,
  audioMimeType = 'audio/wav',
  textQuestion,
  previousInteractionId,
}: AskTutorParams): Promise<AskTutorResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const lang = TARGET_LANGUAGES[settings.targetLanguage];
  const client = createClient(settings.apiKey);

  const promptText = audioBase64
    ? `Listen to the student's spoken question (which may mix Korean and ${lang.englishName}) about this scene, answer concisely as the tutor, and extract 1-3 vocabulary cards with bounding boxes.`
    : textQuestion?.trim()
      ? `Student question: "${textQuestion.trim()}". Answer concisely as the tutor based on the scene and extract 1-3 vocabulary cards with bounding boxes.`
      : `Identify the main focal object, menu item, or sign in this image. Teach its ${lang.englishName} name, natural pronunciation, and one quick practical phrase for using it in real life.`;

  type InputBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp' }
    | { type: 'audio'; data: string; mime_type: string };

  const inputBlocks: InputBlock[] = [{ type: 'text', text: promptText }];

  if (imageBase64) {
    inputBlocks.push({
      type: 'image',
      data: imageBase64,
      mime_type: imageMimeType,
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
    client.interactions.create({
      model: settings.tutorModel,
      system_instruction: buildSystemInstruction(settings),
      ...(prevId ? { previous_interaction_id: prevId } : {}),
      input: inputBlocks,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: TUTOR_RESPONSE_JSON_SCHEMA,
      },
    });

  let interaction;
  try {
    interaction = await runCreate(previousInteractionId?.trim() || undefined);
  } catch (err) {
    const status = getErrorStatusCode(err);
    if (previousInteractionId?.trim() && (status === 400 || status === 404)) {
      try {
        interaction = await runCreate(undefined);
      } catch (retryErr) {
        throw new Error(formatGeminiError(retryErr));
      }
    } else {
      throw new Error(formatGeminiError(err));
    }
  }

  const rawText = interaction.output_text ?? '';
  if (!rawText) {
    throw new Error('튜터 응답이 비어 있습니다.');
  }

  const payload = parseTutorResponse(
    rawText,
    textQuestion?.trim() || (audioBase64 ? '🎙️ 음성 질문' : '📸 이거 뭐예요?'),
  );

  return {
    payload,
    interactionId: interaction.id,
  };
}

export async function synthesizeGeminiTts(params: {
  apiKey: string;
  text: string;
  persona: PersonaId;
  expressive?: boolean;
}): Promise<Blob> {
  const client = createClient(params.apiKey);
  const personaCfg = PERSONAS[params.persona];
  const model = params.expressive ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts';

  const interaction = await client.interactions.create({
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
  });

  const audioData = interaction.output_audio?.data;
  if (!audioData) {
    throw new Error('Gemini TTS audio payload missing');
  }

  const mimeType = interaction.output_audio?.mime_type || 'audio/wav';
  const bytes = base64ToUint8Array(audioData);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: mimeType });
}

export async function verifyGeminiApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  if (!apiKey.trim()) {
    return { ok: false, message: 'API 키를 입력해 주세요.' };
  }
  try {
    const client = createClient(apiKey);
    const interaction = await client.interactions.create({
      model: 'gemini-3.5-flash-lite',
      input: 'Reply with OK.',
      store: false,
    });
    if (interaction.output_text || interaction.id) {
      return { ok: true, message: '연결 성공! Gemini 3.8 튜터를 사용할 수 있습니다.' };
    }
    return { ok: false, message: '응답을 받지 못했습니다.' };
  } catch (err) {
    return { ok: false, message: `연결 실패: ${formatGeminiError(err)}` };
  }
}
