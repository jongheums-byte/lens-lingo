/**
 * Pure Server-Sent Events (SSE) buffer parser and Gemini Interactions API event extractors.
 * Designed for direct native browser fetch + ReadableStream.getReader() with UTF-8 stream decoding.
 */

export interface ParsedSseEvent {
  event?: string;
  data: string;
}

export function parseSseBuffer(buffer: string): {
  events: ParsedSseEvent[];
  remainder: string;
} {
  const events: ParsedSseEvent[] = [];
  const separatorRegex = /\r?\n\r?\n/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = separatorRegex.exec(buffer)) !== null) {
    const rawFrame = buffer.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;

    const lines = rawFrame.split(/\r?\n/);
    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx).trim();
      const rawVal = line.slice(colonIdx + 1);
      const val = rawVal.startsWith(' ') ? rawVal.slice(1) : rawVal;

      if (field === 'event') {
        eventName = val;
      } else if (field === 'data') {
        dataLines.push(val);
      }
    }

    if (dataLines.length > 0) {
      events.push({
        event: eventName,
        data: dataLines.join('\n'),
      });
    }
  }

  return {
    events,
    remainder: buffer.slice(lastIndex),
  };
}

export function extractEventTextDelta(ev: Record<string, unknown>): string {
  const eventType = String(ev.event_type ?? '');
  if (eventType === 'step.delta' || eventType === 'content.delta') {
    const delta = ev.delta as Record<string, unknown> | undefined;
    if (delta && delta.type === 'text' && typeof delta.text === 'string') {
      return delta.text;
    }
  }
  return '';
}

export function extractEventAudioDelta(
  ev: Record<string, unknown>,
): { data: string; sampleRate: number } | null {
  const eventType = String(ev.event_type ?? '');
  if (eventType === 'step.delta' || eventType === 'content.delta') {
    const delta = ev.delta as Record<string, unknown> | undefined;
    if (delta && delta.type === 'audio' && typeof delta.data === 'string' && delta.data.length > 0) {
      const sr = typeof delta.sample_rate === 'number' && delta.sample_rate > 0 ? delta.sample_rate : 24000;
      return { data: delta.data, sampleRate: sr };
    }
  }
  return null;
}

/**
 * Extracts text from a full Interaction object (whether returned unary or inside interaction.completed).
 */
export function extractTextFromInteractionObject(obj: Record<string, unknown> | undefined): string {
  if (!obj) return '';
  if (typeof obj.output_text === 'string' && obj.output_text.trim()) {
    return obj.output_text;
  }

  const parts: string[] = [];

  if (Array.isArray(obj.steps)) {
    for (const step of obj.steps) {
      if (!step || typeof step !== 'object') continue;
      const st = step as Record<string, unknown>;
      if (st.type === 'model_output' && Array.isArray(st.content)) {
        for (const item of st.content) {
          if (item && typeof item === 'object') {
            const c = item as Record<string, unknown>;
            if (c.type === 'text' && typeof c.text === 'string') {
              parts.push(c.text);
            }
          }
        }
      }
    }
  }

  if (parts.length === 0 && Array.isArray(obj.outputs)) {
    for (const out of obj.outputs) {
      if (out && typeof out === 'object') {
        const o = out as Record<string, unknown>;
        if (o.type === 'text' && typeof o.text === 'string') {
          parts.push(o.text);
        }
      }
    }
  }

  return parts.join('');
}

export function extractCompletedFallbackText(ev: Record<string, unknown>): string {
  if (ev.event_type !== 'interaction.completed') return '';
  const interaction = ev.interaction as Record<string, unknown> | undefined;
  return extractTextFromInteractionObject(interaction);
}

export function extractAudioFromInteractionObject(
  obj: Record<string, unknown> | undefined,
): { data: string; mimeType: string } | null {
  if (!obj) return null;
  if (obj.output_audio && typeof obj.output_audio === 'object') {
    const oa = obj.output_audio as Record<string, unknown>;
    if (typeof oa.data === 'string' && oa.data) {
      return {
        data: oa.data,
        mimeType: typeof oa.mime_type === 'string' ? oa.mime_type : 'audio/wav',
      };
    }
  }

  if (Array.isArray(obj.steps)) {
    for (let i = obj.steps.length - 1; i >= 0; i--) {
      const st = obj.steps[i] as Record<string, unknown> | undefined;
      if (st && st.type === 'model_output' && Array.isArray(st.content)) {
        for (let j = st.content.length - 1; j >= 0; j--) {
          const item = st.content[j] as Record<string, unknown> | undefined;
          if (item && item.type === 'audio' && typeof item.data === 'string' && item.data) {
            return {
              data: item.data,
              mimeType: typeof item.mime_type === 'string' ? item.mime_type : 'audio/wav',
            };
          }
        }
      }
    }
  }

  return null;
}
