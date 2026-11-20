import { describe, expect, it } from 'vitest';
import {
  createPopperState,
  handlePopperSpeech,
  handlePopperTap,
  stepPopperState,
  toPopperDeckItem,
} from './vocabPopperEngine';

const sampleDeck = [
  toPopperDeckItem({ id: '1', word: 'Latte', reading: 'lɑːteɪ', meaning: '라떼', stickerDataUrl: 'data:1' }),
  toPopperDeckItem({ id: '2', word: 'Croissant', reading: 'krwɑːsɒ̃', meaning: '크루아상', stickerDataUrl: 'data:2' }),
  toPopperDeckItem({ id: '3', word: 'Espresso', reading: 'ɛsprɛsoʊ', meaning: '에스프레소', stickerDataUrl: 'data:3' }),
];

describe('vocabPopperEngine', () => {
  it('pops matching targets via speech and increments score & combo', () => {
    const state = createPopperState('speak', 'normal', 30, sampleDeck, () => 0.1);
    const firstWord = state.targets[0].item.word;
    const res = handlePopperSpeech(state, `I want ${firstWord}`);
    expect(res.poppedItems).toHaveLength(1);
    expect(res.state.score).toBe(120);
    expect(res.state.combo).toBe(1);
    expect(res.state.targets[0].popProgress).not.toBeNull();
  });

  it('deducts lives on wrong tap in tap mode and ends when lives reach 0', () => {
    let state = createPopperState('tap', 'easy', 30, [sampleDeck[0]], () => 0.2);
    // Inject a second distinct target that does not match promptItem
    state = {
      ...state,
      promptItem: sampleDeck[0],
      targets: [
        ...state.targets,
        {
          ...state.targets[0],
          id: 99,
          item: sampleDeck[1],
        },
      ],
    };

    const r1 = handlePopperTap(state, 99, sampleDeck, () => 0.2);
    expect(r1.event).toBe('wrong');
    expect(r1.state.lives).toBe(2);

    const r2 = handlePopperTap({ ...r1.state, targets: state.targets }, 99, sampleDeck, () => 0.2);
    expect(r2.state.lives).toBe(1);

    const r3 = handlePopperTap({ ...r2.state, targets: state.targets }, 99, sampleDeck, () => 0.2);
    expect(r3.event).toBe('gameover');
    expect(r3.state.phase).toBe('ended');
    expect(r3.state.endReason).toBe('out_of_lives');
  });

  it('expires round when timer reaches 0', () => {
    let state = createPopperState('tap', 'normal', 30, sampleDeck, () => 0.3);
    state = { ...state, remainingMs: 40 };
    const stepped = stepPopperState(state, 50, sampleDeck, () => 0.3);
    expect(stepped.state.phase).toBe('ended');
    expect(stepped.state.endReason).toBe('time_expired');
    expect(stepped.events).toContain('gameover');
  });
});
