import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, LearningSession, SavedVocabCard } from '../types/app';

const SETTINGS_KEY = 'lens_lingo_settings_v1';
const DB_NAME = 'lens-lingo-db';
const DB_VERSION = 1;

interface LensLingoSchema extends DBSchema {
  vocabCards: {
    key: string;
    value: SavedVocabCard;
    indexes: { 'by-language': string; 'by-createdAt': number };
  };
  sessions: {
    key: string;
    value: LearningSession;
    indexes: { 'by-updatedAt': number };
  };
}

let dbPromise: Promise<IDBPDatabase<LensLingoSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<LensLingoSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<LensLingoSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('vocabCards')) {
          const store = db.createObjectStore('vocabCards', { keyPath: 'id' });
          store.createIndex('by-language', 'language');
          store.createIndex('by-createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('by-updatedAt', 'updatedAt');
        }
      },
    });
  }
  return dbPromise;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  demoMode: true,
  hasCompletedOnboarding: false,
  targetLanguage: 'en',
  persona: 'buddy',
  level: 'beginner',
  customPersonaPrompt: '',
  tutorModel: 'gemini-3.8-flash',
  ttsPreference: 'hybrid',
  autoPlayTts: true,
  vocabPopperBestScore: 0,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function getAllVocabCards(): Promise<SavedVocabCard[]> {
  const db = await getDb();
  const list = await db.getAll('vocabCards');
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putVocabCard(card: SavedVocabCard): Promise<void> {
  const db = await getDb();
  await db.put('vocabCards', card);
}

export async function putVocabCards(cards: SavedVocabCard[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('vocabCards', 'readwrite');
  for (const card of cards) {
    await tx.store.put(card);
  }
  await tx.done;
}

export async function deleteVocabCard(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('vocabCards', id);
}

export async function getAllSessions(): Promise<LearningSession[]> {
  const db = await getDb();
  const list = await db.getAll('sessions');
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putSession(session: LearningSession): Promise<void> {
  const db = await getDb();
  await db.put('sessions', session);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('sessions', id);
}

export async function clearAllDbData(): Promise<void> {
  const db = await getDb();
  await db.clear('vocabCards');
  await db.clear('sessions');
}

export interface LensLingoBackupPayload {
  version: 1;
  exportedAt: number;
  settings: Omit<AppSettings, 'apiKey'>;
  vocabCards: SavedVocabCard[];
  sessions: LearningSession[];
}

export async function exportBackupJson(): Promise<string> {
  const [vocabCards, sessions] = await Promise.all([getAllVocabCards(), getAllSessions()]);
  const settings = loadSettings();
  const { apiKey: _omitted, ...safeSettings } = settings;
  const payload: LensLingoBackupPayload = {
    version: 1,
    exportedAt: Date.now(),
    settings: safeSettings,
    vocabCards,
    sessions,
  };
  return JSON.stringify(payload, null, 2);
}

export async function importBackupJson(jsonText: string): Promise<{
  vocabCount: number;
  sessionCount: number;
}> {
  const parsed = JSON.parse(jsonText) as Partial<LensLingoBackupPayload>;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.vocabCards)) {
    throw new Error('올바른 LensLingo 백업 파일 형식이 아닙니다.');
  }
  const db = await getDb();

  const vocabTx = db.transaction('vocabCards', 'readwrite');
  for (const c of parsed.vocabCards) {
    if (c && typeof c.id === 'string' && typeof c.word === 'string') {
      await vocabTx.store.put(c);
    }
  }
  await vocabTx.done;

  let sessionCount = 0;
  if (Array.isArray(parsed.sessions)) {
    const sessTx = db.transaction('sessions', 'readwrite');
    for (const s of parsed.sessions) {
      if (s && typeof s.id === 'string' && Array.isArray(s.messages)) {
        await sessTx.store.put(s);
        sessionCount += 1;
      }
    }
    await sessTx.done;
  }

  return {
    vocabCount: parsed.vocabCards.length,
    sessionCount,
  };
}
