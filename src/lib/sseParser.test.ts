import { describe, expect, it } from 'vitest';
import {
  extractAudioFromInteractionObject,
  extractCompletedFallbackText,
  extractEventAudioDelta,
  extractEventTextDelta,
  parseSseBuffer,
} from './sseParser';

describe('sseParser', () => {
  it('parses split SSE chunks with CRLF/LF boundaries and preserves remainder', () => {
    const chunk1 = 'event: step.delta\r\ndata: {"event_type":"step.delta","delta":{"type":"text","text":"안녕"}}\r\n\r\nevent: step.delta\ndata: {"event_type":"step.delta"';
    const r1 = parseSseBuffer(chunk1);
    expect(r1.events).toHaveLength(1);
    expect(extractEventTextDelta(JSON.parse(r1.events[0].data))).toBe('안녕');
    expect(r1.remainder).toContain('event: step.delta');

    const chunk2 = r1.remainder + ',"delta":{"type":"text","text":"하세요"}}\n\nevent: done\ndata: [DONE]\n\n';
    const r2 = parseSseBuffer(chunk2);
    expect(r2.events).toHaveLength(2);
    expect(extractEventTextDelta(JSON.parse(r2.events[0].data))).toBe('하세요');
    expect(r2.events[1].data).toBe('[DONE]');
    expect(r2.remainder).toBe('');
  });

  it('supports content.delta, audio deltas, and interaction.completed fallback text/audio', () => {
    expect(
      extractEventTextDelta({
        event_type: 'content.delta',
        delta: { type: 'text', text: 'Hello' },
      }),
    ).toBe('Hello');

    expect(
      extractEventAudioDelta({
        event_type: 'step.delta',
        delta: { type: 'audio', data: 'AAAA', sample_rate: 24000 },
      }),
    ).toEqual({ data: 'AAAA', sampleRate: 24000 });

    expect(
      extractCompletedFallbackText({
        event_type: 'interaction.completed',
        interaction: {
          steps: [
            {
              type: 'model_output',
              content: [{ type: 'text', text: 'LCD Writing Tablet' }],
            },
          ],
        },
      }),
    ).toBe('LCD Writing Tablet');

    expect(
      extractAudioFromInteractionObject({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'audio', data: 'UklGRg==', mime_type: 'audio/wav' }],
          },
        ],
      }),
    ).toEqual({ data: 'UklGRg==', mimeType: 'audio/wav' });
  });
});
