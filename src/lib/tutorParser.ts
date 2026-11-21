import type { Box2D, ExtractedVocab, ReplySegment, TutorResponsePayload } from '../types/app';

export const TUTOR_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    userTranscript: {
      type: 'string',
      description: 'Transcribed spoken user question (or summary of text/photo prompt).',
    },
    replySegments: {
      type: 'array',
      description:
        'Ordered segments of the tutor reply (1 to 3 sentences total). Set isTarget=true for foreign target-language words/phrases and isTarget=false for Korean explanations.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          isTarget: { type: 'boolean' },
        },
        required: ['text', 'isTarget'],
      },
    },
    translationSummary: {
      type: 'string',
      description: 'Natural Korean summary of the main target-language phrase taught.',
    },
    vocabCards: {
      type: 'array',
      description: '1 to 3 key target-language vocabulary items visible or discussed.',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'Target language word or short phrase.' },
          reading: {
            type: 'string',
            description: 'Target-language pronunciation guide (IPA, Furigana, Pinyin, etc.).',
          },
          koreanPronunciation: {
            type: 'string',
            description: 'Approximate Korean Hangul pronunciation guide for easy reading.',
          },
          meaning: { type: 'string', description: 'Concise Korean meaning.' },
          partOfSpeech: { type: 'string', description: 'e.g. 명사, 동사, 표현' },
          exampleTarget: { type: 'string', description: 'Short practical example in target language.' },
          exampleKorean: { type: 'string', description: 'Korean translation of exampleTarget.' },
          box2d: {
            type: 'array',
            description: 'Bounding box [ymin, xmin, ymax, xmax] normalized 0-1000 around the object in the photo.',
            items: { type: 'number' },
          },
        },
        required: [
          'word',
          'reading',
          'koreanPronunciation',
          'meaning',
          'partOfSpeech',
          'exampleTarget',
          'exampleKorean',
        ],
      },
    },
  },
  required: ['userTranscript', 'replySegments', 'translationSummary', 'vocabCards'],
} as const;

export const VOCAB_CARDS_ONLY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    translationSummary: {
      type: 'string',
      description: 'Concise 1-line Korean summary of the key expression taught.',
    },
    vocabCards: TUTOR_RESPONSE_JSON_SCHEMA.properties.vocabCards,
  },
  required: ['translationSummary', 'vocabCards'],
} as const;

function sanitizeBox2d(raw: unknown): Box2D | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const nums = raw.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  const ymin = clamp(Math.min(nums[0], nums[2]));
  const xmin = clamp(Math.min(nums[1], nums[3]));
  const ymax = clamp(Math.max(nums[0], nums[2]));
  const xmax = clamp(Math.max(nums[1], nums[3]));
  if (ymax - ymin < 5 || xmax - xmin < 5) return undefined;
  return [ymin, xmin, ymax, xmax];
}

function stripByteFallback(str: string): string {
  return str.replace(/<0x[0-9A-Fa-f]{2}>/g, '').trim();
}

function extractJsonObjectText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function parseVocabCardList(rawCards: unknown): ExtractedVocab[] {
  if (!Array.isArray(rawCards)) return [];
  return rawCards
    .map((card): ExtractedVocab | null => {
      if (!card || typeof card !== 'object') return null;
      const obj = card as Record<string, unknown>;
      const word = stripByteFallback(String(obj.word ?? ''));
      const meaning = stripByteFallback(String(obj.meaning ?? ''));
      if (!word || !meaning) return null;
      return {
        word,
        reading: stripByteFallback(String(obj.reading ?? word)),
        koreanPronunciation: stripByteFallback(String(obj.koreanPronunciation ?? '')),
        meaning,
        partOfSpeech: stripByteFallback(String(obj.partOfSpeech ?? '표현')),
        exampleTarget: stripByteFallback(String(obj.exampleTarget ?? word)),
        exampleKorean: stripByteFallback(String(obj.exampleKorean ?? meaning)),
        box2d: sanitizeBox2d(obj.box2d),
      };
    })
    .filter((c): c is ExtractedVocab => c !== null)
    .slice(0, 4);
}

export function parseTutorResponse(rawText: string, fallbackQuestion = ''): TutorResponsePayload {
  const jsonText = extractJsonObjectText(rawText);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  const rawSegments = Array.isArray(parsed.replySegments) ? parsed.replySegments : [];
  const replySegments: ReplySegment[] = rawSegments
    .map((seg) => {
      if (!seg || typeof seg !== 'object') return null;
      const obj = seg as Record<string, unknown>;
      const text = stripByteFallback(String(obj.text ?? ''));
      if (!text) return null;
      return {
        text,
        isTarget: Boolean(obj.isTarget),
      };
    })
    .filter((s): s is ReplySegment => s !== null);

  if (replySegments.length === 0) {
    replySegments.push({
      text: '사진 속 사물을 확인했어요! 다시 한 번 질문해 주실래요?',
      isTarget: false,
    });
  }

  return {
    userTranscript: stripByteFallback(String(parsed.userTranscript ?? fallbackQuestion)),
    replySegments,
    translationSummary: stripByteFallback(String(parsed.translationSummary ?? '')),
    vocabCards: parseVocabCardList(parsed.vocabCards),
  };
}

export function parseVocabCardsOnly(rawText: string): {
  translationSummary: string;
  vocabCards: ExtractedVocab[];
} {
  const jsonText = extractJsonObjectText(rawText);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  return {
    translationSummary: stripByteFallback(String(parsed.translationSummary ?? '')),
    vocabCards: parseVocabCardList(parsed.vocabCards),
  };
}

export interface ParsedStreamReply {
  userTranscript?: string;
  segments: ReplySegment[];
  plainText: string;
  /** True as soon as the spoken reply ends and inline W: card lines begin streaming. */
  replyReady: boolean;
  inlineCards: ExtractedVocab[];
}

function parseInlineCardLine(line: string): ExtractedVocab | null {
  const payload = line.replace(/^W:\s*/i, '').trim();
  const cols = payload.split('|').map((c) => stripByteFallback(c));
  if (cols.length < 3) return null;
  const word = cols[0];
  const readingOrPron = cols[1];
  const meaning = cols[2];
  if (!word || !meaning) return null;

  const exampleTarget = cols[3] || word;
  const exampleKorean = cols[4] || meaning;
  let box2d: Box2D | undefined;
  if (cols[5]) {
    const nums = cols[5]
      .replace(/[\[\]]/g, '')
      .split(',')
      .map((s) => Number(s.trim()));
    box2d = sanitizeBox2d(nums);
  }

  return {
    word,
    reading: readingOrPron || word,
    koreanPronunciation: readingOrPron || '',
    meaning,
    partOfSpeech: '표현',
    exampleTarget,
    exampleKorean,
    box2d,
  };
}

/**
 * Incrementally parses single-stream tutor output:
 *   Optional line 1: `Q: <transcript>`
 *   Reply text with `<t>target phrase</t>` markers
 *   Optional trailing lines: `W: word | pron | meaning | exTarget | exKo | ymin,xmin,ymax,xmax`
 * Never flashes incomplete `<t`, `</t`, or `W:` metadata in the spoken caption.
 */
export function parseStreamingReply(raw: string): ParsedStreamReply {
  const cleaned = raw.replace(/<0x[0-9A-Fa-f]{2}>/g, '').replace(/\r\n/g, '\n');
  let userTranscript: string | undefined;
  let rest = cleaned.trimStart();

  if (/^Q:/i.test(rest)) {
    const nl = rest.indexOf('\n');
    if (nl === -1) {
      return {
        userTranscript: rest.replace(/^Q:\s*/i, '').trim(),
        segments: [],
        plainText: '',
        replyReady: false,
        inlineCards: [],
      };
    }
    userTranscript = rest.slice(0, nl).replace(/^Q:\s*/i, '').trim();
    rest = rest.slice(nl + 1).trimStart();
  }

  // Split spoken reply from trailing inline `W:` vocab card lines
  let replyReady = false;
  let body = rest;
  const inlineCards: ExtractedVocab[] = [];

  const cardSectionMatch = rest.match(/(?:^|\n)W:/i);
  if (cardSectionMatch && cardSectionMatch.index !== undefined) {
    replyReady = true;
    const splitIdx = cardSectionMatch.index;
    body = rest.slice(0, splitIdx).trimEnd();
    const cardSection = rest.slice(splitIdx).trim();
    for (const line of cardSection.split('\n')) {
      const trimmed = line.trim();
      if (/^W:/i.test(trimmed)) {
        const parsed = parseInlineCardLine(trimmed);
        if (parsed) inlineCards.push(parsed);
      }
    }
  } else {
    // Strip partial trailing `\nW` before `:` arrives so it never flashes in caption
    body = body.replace(/\nW$/i, '');
  }

  // Strip any incomplete trailing tag prefix like "<", "<t", "</", "</t"
  body = body.replace(/<\/?t?$/i, '');

  const segments: ReplySegment[] = [];
  let cursor = 0;
  let inTarget = false;

  while (cursor < body.length) {
    if (!inTarget) {
      const openIdx = body.indexOf('<t>', cursor);
      if (openIdx === -1) {
        const tail = body.slice(cursor).replace(/<\/?t>/gi, '');
        if (tail) segments.push({ text: tail, isTarget: false });
        break;
      }
      if (openIdx > cursor) {
        const before = body.slice(cursor, openIdx).replace(/<\/t>/gi, '');
        if (before) segments.push({ text: before, isTarget: false });
      }
      cursor = openIdx + 3;
      inTarget = true;
    } else {
      const closeIdx = body.indexOf('</t>', cursor);
      if (closeIdx === -1) {
        const tail = body.slice(cursor).replace(/<t>/gi, '');
        if (tail) segments.push({ text: tail, isTarget: true });
        break;
      }
      if (closeIdx > cursor) {
        const inner = body.slice(cursor, closeIdx).replace(/<t>/gi, '');
        if (inner) segments.push({ text: inner, isTarget: true });
      }
      cursor = closeIdx + 4;
      inTarget = false;
    }
  }

  return {
    userTranscript,
    segments,
    plainText: segments.map((s) => s.text).join(''),
    replyReady,
    inlineCards: inlineCards.slice(0, 3),
  };
}
