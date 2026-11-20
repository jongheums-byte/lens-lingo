import type { ProficiencyLevel, TargetLanguageCode } from '../types/app';

export interface LanguageConfig {
  code: TargetLanguageCode;
  koreanName: string;
  englishName: string;
  nativeName: string;
  flag: string;
  bcp47: string;
  readingGuideInstruction: string;
  sampleQuestion: string;
}

export const TARGET_LANGUAGES: Record<TargetLanguageCode, LanguageConfig> = {
  en: {
    code: 'en',
    koreanName: '영어',
    englishName: 'English',
    nativeName: 'English',
    flag: '🇺🇸',
    bcp47: 'en-US',
    readingGuideInstruction: 'IPA 또는 자연스러운 한글 발음 가이드',
    sampleQuestion: '이건 영어로 뭐라고 하고, 주문할 때 어떻게 말해요?',
  },
  ja: {
    code: 'ja',
    koreanName: '일본어',
    englishName: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    bcp47: 'ja-JP',
    readingGuideInstruction: '히라가나 후리가나 및 로마자 발음 (예: りんご / ringo)',
    sampleQuestion: '이건 일본어로 뭐예요? 정중하게 주문하는 법도 알려주세요!',
  },
  zh: {
    code: 'zh',
    koreanName: '중국어',
    englishName: 'Mandarin Chinese',
    nativeName: '中文',
    flag: '🇨🇳',
    bcp47: 'zh-CN',
    readingGuideInstruction: '성조가 포함된 병음(Pinyin) (예: kāfēi)',
    sampleQuestion: '이 표현은 중국어로 어떻게 읽고 말하나요?',
  },
  es: {
    code: 'es',
    koreanName: '스페인어',
    englishName: 'Spanish',
    nativeName: 'Español',
    flag: '🇪🇸',
    bcp47: 'es-ES',
    readingGuideInstruction: '강세 음절을 표시한 발음 표기',
    sampleQuestion: '스페인어로 이걸 어떻게 부르나요? 짧은 예문도 알려주세요.',
  },
  fr: {
    code: 'fr',
    koreanName: '프랑스어',
    englishName: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    bcp47: 'fr-FR',
    readingGuideInstruction: '연음과 묵음을 반영한 쉬운 발음 표기',
    sampleQuestion: '이건 프랑스어로 뭐라고 읽나요? 카페에서 쓸 표현도 알려주세요.',
  },
  de: {
    code: 'de',
    koreanName: '독일어',
    englishName: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    bcp47: 'de-DE',
    readingGuideInstruction: '관사(der/die/das)를 포함한 발음 표기',
    sampleQuestion: '독일어로 이 사물의 이름과 관사를 알려주세요!',
  },
  it: {
    code: 'it',
    koreanName: '이탈리아어',
    englishName: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    bcp47: 'it-IT',
    readingGuideInstruction: '강세 위치와 자음 발음 가이드',
    sampleQuestion: '이탈리아어로 이걸 어떻게 말하고 주문하나요?',
  },
};

export const LANGUAGE_LIST: LanguageConfig[] = Object.values(TARGET_LANGUAGES);

export interface LevelConfig {
  id: ProficiencyLevel;
  koreanLabel: string;
  description: string;
  promptRule: string;
}

export const PROFICIENCY_LEVELS: Record<ProficiencyLevel, LevelConfig> = {
  beginner: {
    id: 'beginner',
    koreanLabel: '초급',
    description: '쉬운 핵심 단어와 짧은 기초 문장 중심',
    promptRule:
      'Use beginner-friendly vocabulary and short, practical phrases. Keep Korean explanations crystal clear and encouraging.',
  },
  intermediate: {
    id: 'intermediate',
    koreanLabel: '중급',
    description: '자연스러운 일상 회화와 실용 표현 위주',
    promptRule:
      'Use natural everyday conversational phrasing, useful collocations, and polite expressions suitable for travel or daily life.',
  },
  advanced: {
    id: 'advanced',
    koreanLabel: '고급',
    description: '원어민 뉘앙스·관용구·문화적 맥락 포함',
    promptRule:
      'Include nuanced native expressions, idiomatic phrasing, and brief cultural/register tips while remaining concise.',
  },
};

export const LEVEL_LIST: LevelConfig[] = Object.values(PROFICIENCY_LEVELS);
