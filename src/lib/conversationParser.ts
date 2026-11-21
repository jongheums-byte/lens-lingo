import type { CoachingTip, ExtractedVocab, SuggestedReply } from '../types/app';

export interface ParsedConversationReply {
  userTranscript?: string;
  replyText: string;
  /** True as soon as the main target-language reply finishes and TR:/TIP:/H:/W: metadata begins. */
  replyReady: boolean;
  koreanTranslation?: string;
  coachingTip?: CoachingTip;
  suggestedReplies: SuggestedReply[];
  vocabCards: ExtractedVocab[];
}

function stripArtifacts(str: string): string {
  return str
    .replace(/<0x[0-9A-Fa-f]{2}>/g, '')
    .replace(/<\/?t>/gi, '')
    .trim();
}

function parseTipLine(line: string): CoachingTip | undefined {
  const payload = line.replace(/^TIP:\s*/i, '').trim();
  if (!payload || /^(?:none|n\/a|없음|-)$/i.test(payload)) return undefined;
  const cols = payload.split('|').map((c) => stripArtifacts(c));
  const betterPhrase = cols[0];
  const koreanNote = cols[1] || '';
  if (!betterPhrase || /^(?:none|n\/a|없음|-)$/i.test(betterPhrase)) return undefined;
  return {
    betterPhrase,
    koreanNote: koreanNote || '이렇게 말하면 더 자연스러워요!',
  };
}

function parseHintLine(line: string): SuggestedReply | null {
  const payload = line.replace(/^H:\s*/i, '').trim();
  if (!payload) return null;
  const cols = payload.split('|').map((c) => stripArtifacts(c));
  const text = cols[0];
  if (!text) return null;
  return {
    text,
    korean: cols[1] || '',
  };
}

function parseVocabLine(line: string): ExtractedVocab | null {
  const payload = line.replace(/^W:\s*/i, '').trim();
  const cols = payload.split('|').map((c) => stripArtifacts(c));
  if (cols.length < 3) return null;
  const word = cols[0];
  const pron = cols[1];
  const meaning = cols[2];
  if (!word || !meaning) return null;
  return {
    word,
    reading: pron || word,
    koreanPronunciation: pron || '',
    meaning,
    partOfSpeech: '회화 표현',
    exampleTarget: cols[3] || word,
    exampleKorean: cols[4] || meaning,
  };
}

/**
 * Incrementally parses single-stream conversation partner output:
 *   Optional line 1: `Q: <transcribed user audio>`
 *   Reply lines in target language
 *   `TR: <Korean translation>`
 *   Optional `TIP: <better phrase> | <Korean coaching tip>`
 *   `H: <suggested reply> | <Korean meaning>` (1-2 lines)
 *   Optional `W: <word> | <pron> | <meaning> | <exampleTarget> | <exampleKo>`
 */
export function parseConversationStream(raw: string): ParsedConversationReply {
  const cleaned = raw.replace(/<0x[0-9A-Fa-f]{2}>/g, '').replace(/\r\n/g, '\n');
  let userTranscript: string | undefined;
  let rest = cleaned.trimStart();

  if (/^Q:/i.test(rest)) {
    const nl = rest.indexOf('\n');
    if (nl === -1) {
      return {
        userTranscript: stripArtifacts(rest.replace(/^Q:\s*/i, '')),
        replyText: '',
        replyReady: false,
        suggestedReplies: [],
        vocabCards: [],
      };
    }
    userTranscript = stripArtifacts(rest.slice(0, nl).replace(/^Q:\s*/i, ''));
    rest = rest.slice(nl + 1).trimStart();
  }

  let replyReady = false;
  let body = rest;
  let koreanTranslation: string | undefined;
  let coachingTip: CoachingTip | undefined;
  const suggestedReplies: SuggestedReply[] = [];
  const vocabCards: ExtractedVocab[] = [];

  const metaMatch = rest.match(/(?:^|\n)(?:TR|TIP|H|W):/i);
  if (metaMatch && metaMatch.index !== undefined) {
    replyReady = true;
    body = rest.slice(0, metaMatch.index).trimEnd();
    const metaSection = rest.slice(metaMatch.index).trim();
    for (const rawLine of metaSection.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^TR:/i.test(line)) {
        const tr = stripArtifacts(line.replace(/^TR:\s*/i, ''));
        if (tr) koreanTranslation = tr;
      } else if (/^TIP:/i.test(line)) {
        const parsedTip = parseTipLine(line);
        if (parsedTip) coachingTip = parsedTip;
      } else if (/^H:/i.test(line)) {
        const hint = parseHintLine(line);
        if (hint) suggestedReplies.push(hint);
      } else if (/^W:/i.test(line)) {
        const vc = parseVocabLine(line);
        if (vc) vocabCards.push(vc);
      }
    }
  } else {
    // Strip incomplete trailing metadata marker so it never flashes in chat bubble
    body = body.replace(/\n(?:T|TR|TI|TIP|H|W)$/i, '');
  }

  const replyText = stripArtifacts(body.replace(/^(?:AI|Partner|Tutor):\s*/i, ''));

  return {
    userTranscript,
    replyText,
    replyReady,
    koreanTranslation,
    coachingTip,
    suggestedReplies: suggestedReplies.slice(0, 3),
    vocabCards: vocabCards.slice(0, 2),
  };
}
