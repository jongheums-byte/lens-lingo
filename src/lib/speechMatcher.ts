/**
 * Speech normalization and matching utilities adapted from XR Language Teacher's
 * XrLanguageTeacherSpeechMatcher.kt for multilingual voice mini-games.
 */

const PAREN_REGEX = /\s*[（(][^)）]*[)）]\s*/g;
const DIACRITIC_REGEX = /[\u0300-\u036f]/g;
const PUNCT_REGEX = /[^\p{L}\p{N}\s]/gu;
const MULTI_SPACE_REGEX = /\s+/g;

export function extractPrimaryLearnTerm(rawWord: string): string {
  const cleaned = rawWord.replace(PAREN_REGEX, ' ').replace(MULTI_SPACE_REGEX, ' ').trim();
  return cleaned || rawWord.trim();
}

export function normalizeSpeechText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(DIACRITIC_REGEX, '')
    .toLowerCase()
    .replace(PUNCT_REGEX, ' ')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim();
}

export function buildTargetMatchForms(rawWord: string, reading?: string): Set<string> {
  const forms = new Set<string>();
  const candidates: string[] = [rawWord, extractPrimaryLearnTerm(rawWord)];

  if (reading) {
    candidates.push(reading);
  }

  // Extract parenthetical alternate forms e.g. "林檎 (りんご)"
  const parenMatches = rawWord.matchAll(/[（(]([^)）]+)[)）]/g);
  for (const m of parenMatches) {
    if (m[1]) candidates.push(m[1]);
  }

  for (const raw of candidates) {
    const norm = normalizeSpeechText(raw);
    if (!norm) continue;
    forms.add(norm);
    // Compact form without spaces for CJK or compound words
    const compact = norm.replace(/\s+/g, '');
    if (compact) forms.add(compact);
    // Split multi-word phrases so key words >= 3 chars can also match in noisy ASR
    const tokens = norm.split(' ').filter((t) => t.length >= 3);
    if (tokens.length > 1) {
      for (const tok of tokens) {
        forms.add(tok);
      }
    }
  }

  return forms;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = Math.min(prev, dp[j], dp[j - 1]) + 1;
      }
      prev = temp;
    }
  }
  return dp[b.length];
}

export function matchesSpokenText(transcript: string, targetForms: Set<string>): boolean {
  const normTranscript = normalizeSpeechText(transcript);
  if (!normTranscript) return false;

  const compactTranscript = normTranscript.replace(/\s+/g, '');
  const spokenTokens = normTranscript.split(' ').filter(Boolean);

  for (const target of targetForms) {
    if (!target) continue;
    if (normTranscript === target || compactTranscript === target) return true;
    if (target.length >= 2 && (normTranscript.includes(target) || compactTranscript.includes(target))) {
      return true;
    }
    if (target.length >= 4) {
      for (const tok of spokenTokens) {
        if (Math.abs(tok.length - target.length) <= 1 && levenshtein(tok, target) <= 1) {
          return true;
        }
      }
    }
  }
  return false;
}
