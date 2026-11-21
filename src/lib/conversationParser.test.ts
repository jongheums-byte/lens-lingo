import { describe, expect, it } from 'vitest';
import { parseConversationStream } from './conversationParser';

describe('conversationParser', () => {
  it('handles partial streaming chunks without leaking metadata prefixes', () => {
    const partialQ = parseConversationStream('Q: I want coffee');
    expect(partialQ.userTranscript).toBe('I want coffee');
    expect(partialQ.replyText).toBe('');
    expect(partialQ.replyReady).toBe(false);

    const midReply = parseConversationStream('Q: I want coffee\nSure! Hot or iced?\nTR');
    expect(midReply.userTranscript).toBe('I want coffee');
    expect(midReply.replyText).toBe('Sure! Hot or iced?');
    expect(midReply.replyReady).toBe(false);
  });

  it('parses full conversation stream with TR, TIP, H, and W lines', () => {
    const full = [
      'Q: I want coffee please.',
      'Sure thing! Would you like it hot or iced today?',
      'TR: 물론이죠! 오늘은 따뜻한 걸로 드릴까요, 아이스로 드릴까요?',
      'TIP: Could I get a coffee, please? | "I want"보다 "Could I get~"이 훨씬 자연스럽고 정중해요.',
      'H: Iced latte, please. | 아이스 라떼로 주세요.',
      'H: A hot Americano, please. | 따뜻한 아메리카노 주세요.',
      'W: Could I get | 쿠드 아이 겟 | ~로 주시겠어요? | Could I get an iced latte? | 아이스 라떼 한 잔 주시겠어요?',
    ].join('\n');

    const parsed = parseConversationStream(full);
    expect(parsed.userTranscript).toBe('I want coffee please.');
    expect(parsed.replyReady).toBe(true);
    expect(parsed.replyText).toBe('Sure thing! Would you like it hot or iced today?');
    expect(parsed.koreanTranslation).toBe('물론이죠! 오늘은 따뜻한 걸로 드릴까요, 아이스로 드릴까요?');
    expect(parsed.coachingTip).toEqual({
      betterPhrase: 'Could I get a coffee, please?',
      koreanNote: '"I want"보다 "Could I get~"이 훨씬 자연스럽고 정중해요.',
    });
    expect(parsed.suggestedReplies).toHaveLength(2);
    expect(parsed.suggestedReplies[0]).toEqual({
      text: 'Iced latte, please.',
      korean: '아이스 라떼로 주세요.',
    });
    expect(parsed.vocabCards).toHaveLength(1);
    expect(parsed.vocabCards[0].word).toBe('Could I get');
    expect(parsed.vocabCards[0].koreanPronunciation).toBe('쿠드 아이 겟');
  });

  it('ignores TIP: NONE cleanly', () => {
    const raw = [
      'Sounds great! What kind of music do you usually listen to?',
      'TR: 좋네요! 평소 어떤 음악을 주로 들으세요?',
      'TIP: NONE',
      'H: I mostly listen to indie pop. | 주로 인디 팝을 들어요.',
    ].join('\n');

    const parsed = parseConversationStream(raw);
    expect(parsed.coachingTip).toBeUndefined();
    expect(parsed.suggestedReplies).toHaveLength(1);
  });
});
