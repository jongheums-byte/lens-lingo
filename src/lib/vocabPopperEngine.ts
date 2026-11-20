import { buildTargetMatchForms, extractPrimaryLearnTerm, matchesSpokenText } from './speechMatcher';

export type PopperDurationSec = 30 | 60 | 90;
export type PopperDifficulty = 'easy' | 'normal' | 'hard';
export type PopperMode = 'speak' | 'tap';
export type PopperEndReason = 'time_expired' | 'out_of_lives';
export type PopperSfxEvent = 'pop' | 'wrong' | 'gameover';

export const POPPER_DIFFICULTY_CONFIG: Record<
  PopperDifficulty,
  {
    label: string;
    maxSimultaneous: number;
    spawnIntervalMs: number;
    gravityScale: number;
  }
> = {
  easy: { label: '쉬움', maxSimultaneous: 2, spawnIntervalMs: 2000, gravityScale: 0.72 },
  normal: { label: '보통', maxSimultaneous: 3, spawnIntervalMs: 1550, gravityScale: 0.88 },
  hard: { label: '어려움', maxSimultaneous: 4, spawnIntervalMs: 1150, gravityScale: 1.08 },
};

export interface PopperDeckItem {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  stickerDataUrl: string;
  displayWord: string;
  targetMatchForms: Set<string>;
}

export interface PopperTarget {
  id: number;
  item: PopperDeckItem;
  x: number; // normalized [0..1]
  y: number; // normalized [0..1], y grows downward
  vx: number;
  vy: number;
  gravity: number;
  rotationDeg: number;
  angularVelDeg: number;
  colorIndex: number;
  popProgress: number | null;
  dismissProgress: number | null;
}

export interface PopperParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  colorIndex: number;
  life: number; // 0..1
}

export interface PopperGameState {
  phase: 'playing' | 'ended';
  mode: PopperMode;
  difficulty: PopperDifficulty;
  durationSec: PopperDurationSec;
  remainingMs: number;
  score: number;
  combo: number;
  maxCombo: number;
  poppedCount: number;
  lives: number;
  promptItem: PopperDeckItem | null;
  targets: PopperTarget[];
  particles: PopperParticle[];
  nextId: number;
  lastSpawnElapsedMs: number;
  elapsedMs: number;
  endReason?: PopperEndReason;
  poppedWords: PopperDeckItem[];
  missedWords: PopperDeckItem[];
}

export function toPopperDeckItem(card: {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  stickerDataUrl: string;
}): PopperDeckItem {
  return {
    id: card.id,
    word: card.word,
    reading: card.reading,
    meaning: card.meaning,
    stickerDataUrl: card.stickerDataUrl,
    displayWord: extractPrimaryLearnTerm(card.word),
    targetMatchForms: buildTargetMatchForms(card.word, card.reading),
  };
}

export function createPopperState(
  mode: PopperMode,
  difficulty: PopperDifficulty,
  durationSec: PopperDurationSec,
  deck: PopperDeckItem[],
  rng: () => number = Math.random,
): PopperGameState {
  const initialTargets: PopperTarget[] = [];
  let nextId = 1;

  if (deck.length > 0) {
    const firstItem = deck[Math.floor(rng() * deck.length)];
    initialTargets.push(spawnTarget(nextId++, firstItem, difficulty, rng));
  }

  const promptItem =
    mode === 'tap' && initialTargets.length > 0
      ? initialTargets[0].item
      : deck.length > 0
        ? deck[0]
        : null;

  return {
    phase: 'playing',
    mode,
    difficulty,
    durationSec,
    remainingMs: durationSec * 1000,
    score: 0,
    combo: 0,
    maxCombo: 0,
    poppedCount: 0,
    lives: 3,
    promptItem,
    targets: initialTargets,
    particles: [],
    nextId,
    lastSpawnElapsedMs: 0,
    elapsedMs: 0,
    poppedWords: [],
    missedWords: [],
  };
}

function spawnTarget(
  id: number,
  item: PopperDeckItem,
  difficulty: PopperDifficulty,
  rng: () => number,
): PopperTarget {
  const cfg = POPPER_DIFFICULTY_CONFIG[difficulty];
  const x = 0.2 + rng() * 0.6;
  const vx = (0.5 - x) * (0.28 + rng() * 0.25) + (rng() - 0.5) * 0.14;
  const vy = -(0.96 + rng() * 0.2);
  const gravity = 0.86 * cfg.gravityScale;
  return {
    id,
    item,
    x,
    y: 1.06,
    vx,
    vy,
    gravity,
    rotationDeg: (rng() - 0.5) * 18,
    angularVelDeg: (rng() - 0.5) * 34,
    colorIndex: Math.floor(rng() * 5),
    popProgress: null,
    dismissProgress: null,
  };
}

function createBurstParticles(
  startId: number,
  x: number,
  y: number,
  colorIndex: number,
  count = 10,
): { particles: PopperParticle[]; nextId: number } {
  const particles: PopperParticle[] = [];
  let id = startId;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const speed = 0.28 + (i % 3) * 0.14;
    particles.push({
      id: id++,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.08,
      radius: 4 + (i % 3) * 2,
      colorIndex,
      life: 1,
    });
  }
  return { particles, nextId: id };
}

function pickNextPrompt(targets: PopperTarget[], deck: PopperDeckItem[], rng: () => number): PopperDeckItem | null {
  const interactive = targets.filter((t) => t.popProgress === null && t.dismissProgress === null);
  if (interactive.length > 0) {
    return interactive[Math.floor(rng() * interactive.length)].item;
  }
  if (deck.length > 0) {
    return deck[Math.floor(rng() * deck.length)];
  }
  return null;
}

export function stepPopperState(
  state: PopperGameState,
  dtMs: number,
  deck: PopperDeckItem[],
  rng: () => number = Math.random,
): { state: PopperGameState; events: PopperSfxEvent[] } {
  if (state.phase !== 'playing') return { state, events: [] };

  const clampedDt = Math.max(0, Math.min(80, dtMs));
  const dt = clampedDt / 1000;
  const elapsedMs = state.elapsedMs + clampedDt;
  const remainingMs = Math.max(0, state.remainingMs - clampedDt);
  const events: PopperSfxEvent[] = [];

  if (remainingMs <= 0) {
    events.push('gameover');
    return {
      state: {
        ...state,
        phase: 'ended',
        remainingMs: 0,
        elapsedMs,
        endReason: 'time_expired',
      },
      events,
    };
  }

  let nextId = state.nextId;
  let missedWords = state.missedWords;
  let combo = state.combo;

  const updatedTargets: PopperTarget[] = [];
  for (const t of state.targets) {
    if (t.popProgress !== null) {
      const nextPop = t.popProgress + dt * 3.4;
      if (nextPop < 1) updatedTargets.push({ ...t, popProgress: nextPop });
      continue;
    }
    if (t.dismissProgress !== null) {
      const nextDismiss = t.dismissProgress + dt * 3.0;
      if (nextDismiss < 1) updatedTargets.push({ ...t, dismissProgress: nextDismiss });
      continue;
    }

    const vy = t.vy + t.gravity * dt;
    let x = t.x + t.vx * dt;
    let vx = t.vx;
    if (x < 0.14) {
      x = 0.14;
      vx = Math.abs(vx);
    } else if (x > 0.86) {
      x = 0.86;
      vx = -Math.abs(vx);
    }
    const y = t.y + vy * dt;
    const rotationDeg = t.rotationDeg + t.angularVelDeg * dt;

    if (y > 1.18 && vy > 0) {
      // Fell out of arena without being popped
      if (state.mode === 'tap' && state.promptItem?.id === t.item.id) {
        combo = 0;
        if (!missedWords.some((w) => w.id === t.item.id)) {
          missedWords = [...missedWords, t.item];
        }
      }
      continue;
    }

    updatedTargets.push({
      ...t,
      x,
      y,
      vx,
      vy,
      rotationDeg,
    });
  }

  // Advance particles
  const updatedParticles: PopperParticle[] = [];
  for (const p of state.particles) {
    const life = p.life - dt * 2.1;
    if (life <= 0) continue;
    updatedParticles.push({
      ...p,
      x: p.x + p.vx * dt,
      y: p.y + p.vy * dt,
      vy: p.vy + 0.45 * dt,
      life,
    });
  }

  // Spawn new target if needed
  const cfg = POPPER_DIFFICULTY_CONFIG[state.difficulty];
  const activeCount = updatedTargets.filter((t) => t.popProgress === null && t.dismissProgress === null).length;
  let lastSpawnElapsedMs = state.lastSpawnElapsedMs;

  if (
    deck.length > 0 &&
    activeCount < cfg.maxSimultaneous &&
    (activeCount === 0 || elapsedMs - lastSpawnElapsedMs >= cfg.spawnIntervalMs)
  ) {
    // Prefer promptItem in tap mode if it's missing from arena
    const activeIds = new Set(updatedTargets.map((t) => t.item.id));
    let chosen: PopperDeckItem;
    if (state.mode === 'tap' && state.promptItem && !activeIds.has(state.promptItem.id)) {
      chosen = state.promptItem;
    } else {
      const pool = deck.filter((d) => !activeIds.has(d.id));
      const candidates = pool.length > 0 ? pool : deck;
      chosen = candidates[Math.floor(rng() * candidates.length)];
    }
    updatedTargets.push(spawnTarget(nextId++, chosen, state.difficulty, rng));
    lastSpawnElapsedMs = elapsedMs;
  }

  // Ensure tap mode promptItem is valid among active targets when available
  let promptItem = state.promptItem;
  if (state.mode === 'tap') {
    const stillActive = updatedTargets.some(
      (t) => t.popProgress === null && t.dismissProgress === null && t.item.id === promptItem?.id,
    );
    if (!stillActive) {
      promptItem = pickNextPrompt(updatedTargets, deck, rng);
    }
  }

  return {
    state: {
      ...state,
      remainingMs,
      elapsedMs,
      combo,
      promptItem,
      targets: updatedTargets,
      particles: updatedParticles,
      nextId,
      lastSpawnElapsedMs,
      missedWords,
    },
    events,
  };
}

export function handlePopperTap(
  state: PopperGameState,
  targetId: number,
  deck: PopperDeckItem[],
  rng: () => number = Math.random,
): { state: PopperGameState; event: PopperSfxEvent | null } {
  if (state.phase !== 'playing') return { state, event: null };
  const idx = state.targets.findIndex(
    (t) => t.id === targetId && t.popProgress === null && t.dismissProgress === null,
  );
  if (idx === -1) return { state, event: null };

  const target = state.targets[idx];
  const isCorrect = state.mode === 'speak' || !state.promptItem || target.item.id === state.promptItem.id;

  if (isCorrect) {
    const combo = state.combo + 1;
    const maxCombo = Math.max(state.maxCombo, combo);
    const points = 100 + Math.min(combo - 1, 5) * 25;
    const burst = createBurstParticles(state.nextId, target.x, target.y, target.colorIndex);
    const targets = state.targets.map((t) =>
      t.id === targetId ? { ...t, popProgress: 0.01 } : t,
    );
    const poppedWords = state.poppedWords.some((w) => w.id === target.item.id)
      ? state.poppedWords
      : [...state.poppedWords, target.item];

    const nextPrompt = state.mode === 'tap' ? pickNextPrompt(targets, deck, rng) : state.promptItem;
    return {
      state: {
        ...state,
        score: state.score + points,
        combo,
        maxCombo,
        poppedCount: state.poppedCount + 1,
        targets,
        particles: [...state.particles, ...burst.particles],
        nextId: burst.nextId,
        promptItem: nextPrompt,
        poppedWords,
      },
      event: 'pop',
    };
  }

  // Wrong tap in TAP mode
  const nextLives = Math.max(0, state.lives - 1);
  const targets = state.targets.map((t) =>
    t.id === targetId ? { ...t, dismissProgress: 0.01 } : t,
  );
  const missedWords =
    state.promptItem && !state.missedWords.some((w) => w.id === state.promptItem!.id)
      ? [...state.missedWords, state.promptItem]
      : state.missedWords;

  if (nextLives <= 0) {
    return {
      state: {
        ...state,
        phase: 'ended',
        lives: 0,
        combo: 0,
        targets,
        missedWords,
        endReason: 'out_of_lives',
      },
      event: 'gameover',
    };
  }

  return {
    state: {
      ...state,
      lives: nextLives,
      combo: 0,
      targets,
      missedWords,
    },
    event: 'wrong',
  };
}

export function handlePopperSpeech(
  state: PopperGameState,
  transcript: string,
): { state: PopperGameState; poppedItems: PopperDeckItem[] } {
  if (state.phase !== 'playing' || !transcript.trim()) {
    return { state, poppedItems: [] };
  }

  const matchedTargets = state.targets.filter(
    (t) =>
      t.popProgress === null &&
      t.dismissProgress === null &&
      matchesSpokenText(transcript, t.item.targetMatchForms),
  );

  if (matchedTargets.length === 0) {
    return { state, poppedItems: [] };
  }

  const matchedIds = new Set(matchedTargets.map((t) => t.id));
  let combo = state.combo;
  let maxCombo = state.maxCombo;
  let score = state.score;
  let poppedCount = state.poppedCount;
  let nextId = state.nextId;
  const newParticles: PopperParticle[] = [];
  const poppedWords = [...state.poppedWords];
  const poppedItems: PopperDeckItem[] = [];

  for (const t of matchedTargets) {
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    score += 120 + Math.min(combo - 1, 5) * 30;
    poppedCount += 1;
    const burst = createBurstParticles(nextId, t.x, t.y, t.colorIndex);
    newParticles.push(...burst.particles);
    nextId = burst.nextId;
    poppedItems.push(t.item);
    if (!poppedWords.some((w) => w.id === t.item.id)) {
      poppedWords.push(t.item);
    }
  }

  const targets = state.targets.map((t) =>
    matchedIds.has(t.id) ? { ...t, popProgress: 0.01 } : t,
  );

  return {
    state: {
      ...state,
      score,
      combo,
      maxCombo,
      poppedCount,
      targets,
      particles: [...state.particles, ...newParticles],
      nextId,
      poppedWords,
    },
    poppedItems,
  };
}
