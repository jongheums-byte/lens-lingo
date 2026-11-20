import { describe, expect, it } from 'vitest';
import { parseTutorResponse } from './tutorParser';

describe('tutorParser', () => {
  it('parses fenced JSON, strips byte fallback tokens, and clamps box2d', () => {
    const raw = `\`\`\`json
    {
      "userTranscript": "이 커피 이름이 뭐예요?",
      "replySegments": [
        { "text": "사진 속 음료는 ", "isTarget": false },
        { "text": "Iced Latte", "isTarget": true },
        { "text": "예요!", "isTarget": false }
      ],
      "translationSummary": "아이스 라떼예요!",
      "vocabCards": [
        {
          "word": "Iced Latte<0xE3>",
          "reading": "/aɪst ˈlɑːteɪ/",
          "koreanPronunciation": "아이스드 라떼",
          "meaning": "아이스 라떼",
          "partOfSpeech": "명사",
          "exampleTarget": "One iced latte, please.",
          "exampleKorean": "아이스 라떼 한 잔 주세요.",
          "box2d": [-50, 200, 1200, 750]
        }
      ]
    }
    \`\`\``;

    const parsed = parseTutorResponse(raw);
    expect(parsed.replySegments).toHaveLength(3);
    expect(parsed.vocabCards[0].word).toBe('Iced Latte');
    expect(parsed.vocabCards[0].box2d).toEqual([0, 200, 1000, 750]);
  });
});
