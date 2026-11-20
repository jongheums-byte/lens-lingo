/**
 * Browser audio conversion (to 16kHz mono PCM WAV) and subtle Web Audio earcon synthesizer.
 * Avoids any Node Buffer dependency so it runs cleanly in all mobile browsers.
 */

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function stripMimeCodecs(mimeType: string): string {
  return mimeType.split(';')[0]?.trim() || 'audio/webm';
}

function encodeMonoWav16k(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Converts any browser MediaRecorder Blob (webm/mp4/ogg) into a clean 16kHz mono WAV base64 string,
 * falling back to the raw blob base64 with codec parameters stripped if decodeAudioData fails.
 */
export async function blobTo16kWavBase64(
  blob: Blob,
): Promise<{ base64: string; mimeType: string }> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (AudioCtx) {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const targetRate = 16000;
      const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, frameCount, targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      const channelData = rendered.getChannelData(0);
      const wavBytes = encodeMonoWav16k(channelData, targetRate);
      return {
        base64: uint8ArrayToBase64(wavBytes),
        mimeType: 'audio/wav',
      };
    } catch {
      // Fallback below
    } finally {
      ctx?.close().catch(() => undefined);
    }
  }

  return {
    base64: uint8ArrayToBase64(new Uint8Array(arrayBuffer)),
    mimeType: stripMimeCodecs(blob.type || 'audio/webm'),
  };
}

/**
 * Fast path for Gemini audio upload: sends webm/ogg/wav directly without AudioContext decoding,
 * and falls back to 16kHz WAV conversion only for containers like mp4/m4a (e.g. iOS Safari).
 */
export async function prepareAudioForGemini(
  blob: Blob,
): Promise<{ base64: string; mimeType: string }> {
  const mime = stripMimeCodecs(blob.type || 'audio/webm');
  if (mime === 'audio/webm' || mime === 'audio/ogg' || mime === 'audio/wav') {
    const buf = new Uint8Array(await blob.arrayBuffer());
    return {
      base64: uint8ArrayToBase64(buf),
      mimeType: mime,
    };
  }
  return blobTo16kWavBase64(blob);
}

/**
 * Wraps streamed 16-bit signed little-endian mono PCM chunks into a standard RIFF WAV Blob
 * so completed Gemini streaming TTS audio can be cached for instant zero-API replay.
 */
export function wrapPcm16BytesToWavBlob(
  pcmChunks: Uint8Array[],
  sampleRate = 24000,
): Blob {
  const totalBytes = pcmChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const alignedBytes = totalBytes - (totalBytes % 2);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + alignedBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, alignedBytes, true);

  const combined = new Uint8Array(44 + alignedBytes);
  combined.set(new Uint8Array(header), 0);
  let offset = 44;
  for (const chunk of pcmChunks) {
    const remaining = 44 + alignedBytes - offset;
    if (remaining <= 0) break;
    if (chunk.byteLength <= remaining) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    } else {
      combined.set(chunk.subarray(0, remaining), offset);
      offset += remaining;
    }
  }

  return new Blob([combined.buffer], { type: 'audio/wav' });
}

let sharedSfxCtx: AudioContext | null = null;

function getSfxContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedSfxCtx || sharedSfxCtx.state === 'closed') {
    sharedSfxCtx = new AudioCtx();
  }
  if (sharedSfxCtx.state === 'suspended') {
    sharedSfxCtx.resume().catch(() => undefined);
  }
  return sharedSfxCtx;
}

export function playSfx(
  kind: 'shutter' | 'micStart' | 'micStop' | 'pop' | 'wrong' | 'save' | 'fanfare',
): void {
  const ctx = getSfxContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const tone = (freq: number, startOffset: number, dur: number, type: OscillatorType = 'sine', gainVal = 0.08) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + startOffset);
    gain.gain.setValueAtTime(0.001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + startOffset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + dur + 0.02);
  };

  if (kind === 'micStart') {
    tone(520, 0, 0.09, 'sine', 0.07);
    tone(760, 0.06, 0.11, 'sine', 0.07);
  } else if (kind === 'micStop') {
    tone(660, 0, 0.08, 'sine', 0.06);
    tone(440, 0.06, 0.1, 'sine', 0.06);
  } else if (kind === 'shutter') {
    tone(920, 0, 0.05, 'triangle', 0.07);
    tone(620, 0.04, 0.06, 'triangle', 0.05);
  } else if (kind === 'pop') {
    tone(580, 0, 0.07, 'sine', 0.1);
    tone(960, 0.04, 0.09, 'triangle', 0.09);
  } else if (kind === 'wrong') {
    tone(220, 0, 0.14, 'sawtooth', 0.06);
    tone(165, 0.08, 0.16, 'sawtooth', 0.06);
  } else if (kind === 'save') {
    tone(523.25, 0, 0.09, 'sine', 0.07);
    tone(659.25, 0.07, 0.12, 'sine', 0.07);
  } else if (kind === 'fanfare') {
    tone(523.25, 0, 0.12, 'triangle', 0.08);
    tone(659.25, 0.1, 0.12, 'triangle', 0.08);
    tone(783.99, 0.2, 0.18, 'triangle', 0.09);
    tone(1046.5, 0.32, 0.26, 'sine', 0.09);
  }
}
