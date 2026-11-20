import { describe, expect, it } from 'vitest';
import {
  parseStreamingReply,
  parseTutorResponse,
  parseVocabCardsOnly,
} from './tutorParser';

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

  it('parses streaming replies with Q: line, <t> spans, and mid-stream partial tags', () => {
    const stillTypingQ = parseStreamingReply('Q: 이거 영어로');
    expect(stillTypingQ.userTranscript).toBe('이거 영어로');
    expect(stillTypingQ.segments).toEqual([]);

    const midStream = parseStreamingReply('Q: 이거 뭐예요?\n이건 <t>Rubik\'s Cube</t>라고 해요. <t>Twist it</');
    expect(midStream.userTranscript).toBe('이거 뭐예요?');
    expect(midStream.segments).toEqual([
      { text: '이건 ', isTarget: false },
      { text: "Rubik's Cube", isTarget: true },
      { text: '라고 해요. ', isTarget: false },
      { text: 'Twist it', isTarget: true },
    ]);
    expect(midStream.plainText).toBe("이건 Rubik's Cube라고 해요. Twist it");
  });

  it('parses Pass 2 vocab-cards-only JSON cleanly', () => {
    const res = parseVocabCardsOnly(
      JSON.stringify({
        translationSummary: '루빅스 큐브예요.',
        vocabCards: [
          {
            word: "Rubik's Cube",
            reading: '/ˈruːbɪks kjuːb/',
            koreanPronunciation: '루빅스 큐브',
            meaning: '루빅스 큐브',
            partOfSpeech: '명사',
            exampleTarget: "Can you solve this Rubik's Cube?",
            exampleKorean: '이 루빅스 큐브 맞출 수 있어요?',
            box2d: [200, 300, 700, 800],
          },
        ],
      }),
    );
    expect(res.translationSummary).toBe('루빅스 큐브예요.');
    expect(res.vocabCards).toHaveLength(1);
    expect(res.vocabCards[0].box2d).toEqual([200, 300, 700, 800]);
  });
});
