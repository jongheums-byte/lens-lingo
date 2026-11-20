import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Gamepad2,
  Layers,
  Pencil,
  RotateCw,
  Search,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { LANGUAGE_LIST, TARGET_LANGUAGES } from '../config/languages';
import type { AppSettings, SavedVocabCard, TargetLanguageCode } from '../types/app';

interface VocabBankViewProps {
  cards: SavedVocabCard[];
  settings: AppSettings;
  onBack: () => void;
  onOpenPopper: () => void;
  onSpeakWord: (word: string, language: TargetLanguageCode) => void;
  onEditSticker: (card: SavedVocabCard) => void;
  onDeleteCard: (id: string) => void;
  onMarkReviewed: (card: SavedVocabCard) => void;
  onCreateStarterCards: (language: TargetLanguageCode) => Promise<void>;
}

export const VocabBankView: React.FC<VocabBankViewProps> = ({
  cards,
  settings,
  onBack,
  onOpenPopper,
  onSpeakWord,
  onEditSticker,
  onDeleteCard,
  onMarkReviewed,
  onCreateStarterCards,
}) => {
  const [langFilter, setLangFilter] = useState<'all' | TargetLanguageCode>(settings.targetLanguage);
  const [query, setQuery] = useState('');
  const [flashcardMode, setFlashcardMode] = useState(false);
  const [flashIndex, setFlashIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [creatingStarter, setCreatingStarter] = useState(false);

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (langFilter !== 'all' && c.language !== langFilter) return false;
      if (!q) return true;
      return (
        c.word.toLowerCase().includes(q) ||
        c.meaning.toLowerCase().includes(q) ||
        c.reading.toLowerCase().includes(q) ||
        c.koreanPronunciation.toLowerCase().includes(q)
      );
    });
  }, [cards, langFilter, query]);

  const activeFlashCard =
    filteredCards.length > 0 ? filteredCards[flashIndex % filteredCards.length] : null;

  const handleCreateStarters = async () => {
    setCreatingStarter(true);
    try {
      const targetLang = langFilter === 'all' ? settings.targetLanguage : langFilter;
      await onCreateStarterCards(targetLang);
    } finally {
      setCreatingStarter(false);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #0b1020 0%, #0f172a 100%)',
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '14px 16px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button type="button" className="icon-btn" onClick={onBack} aria-label="카메라로 돌아가기">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>스티커 단어장</h1>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              저장된 단어 {filteredCards.length}개
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="glass-pill"
            onClick={() => {
              setFlashcardMode((v) => !v);
              setFlashIndex(0);
              setFlipped(false);
            }}
            disabled={filteredCards.length === 0}
            style={{
              background: flashcardMode ? 'rgba(56, 189, 248, 0.25)' : undefined,
              borderColor: flashcardMode ? '#38BDF8' : undefined,
            }}
          >
            <Layers size={14} /> {flashcardMode ? '목록' : '복습'}
          </button>
          <button
            type="button"
            className="glass-pill"
            onClick={onOpenPopper}
            style={{
              background: 'linear-gradient(135deg, rgba(52,211,153,0.28), rgba(56,189,248,0.28))',
              borderColor: 'rgba(52, 211, 153, 0.5)',
            }}
          >
            <Gamepad2 size={14} /> 게임
          </button>
        </div>
      </header>

      {/* Search & Language Filter */}
      {!flashcardMode && (
        <div style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={15}
              color="#94A3B8"
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              className="field-input"
              placeholder="단어, 뜻, 발음 검색..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: '36px' }}
            />
          </div>

          <div className="no-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
            <button
              type="button"
              onClick={() => setLangFilter('all')}
              className="glass-pill"
              style={{
                flexShrink: 0,
                padding: '6px 11px',
                fontSize: '12px',
                background: langFilter === 'all' ? 'rgba(56, 189, 248, 0.24)' : undefined,
                borderColor: langFilter === 'all' ? '#38BDF8' : undefined,
              }}
            >
              전체
            </button>
            {LANGUAGE_LIST.map((lang) => {
              const active = langFilter === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLangFilter(lang.code)}
                  className="glass-pill"
                  style={{
                    flexShrink: 0,
                    padding: '6px 11px',
                    fontSize: '12px',
                    background: active ? 'rgba(56, 189, 248, 0.24)' : undefined,
                    borderColor: active ? '#38BDF8' : undefined,
                  }}
                >
                  {lang.flag} {lang.koreanName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Body */}
      {flashcardMode && activeFlashCard ? (
        <div
          style={{
            flex: 1,
            padding: '12px 18px 24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
            카드 {(flashIndex % filteredCards.length) + 1} / {filteredCards.length} · 카드를 탭해서 뒤집기
          </div>

          <div
            onClick={() => setFlipped((f) => !f)}
            className="glass-panel-strong"
            style={{
              flex: 1,
              maxHeight: '440px',
              borderRadius: '28px',
              padding: '24px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: '14px',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            {!flipped ? (
              <>
                <img
                  src={activeFlashCard.stickerDataUrl}
                  alt={activeFlashCard.word}
                  style={{
                    width: '156px',
                    height: '156px',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.45))',
                  }}
                />
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#FFFFFF' }}>
                  {activeFlashCard.word}
                </div>
                <div style={{ fontSize: '14px', color: '#7DD3FC' }}>
                  {activeFlashCard.reading}
                </div>
                <button
                  type="button"
                  className="glass-pill"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSpeakWord(activeFlashCard.word, activeFlashCard.language);
                  }}
                >
                  <Volume2 size={15} color="#38BDF8" /> 발음 듣기
                </button>
              </>
            ) : (
              <>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '4px 10px',
                    borderRadius: '9999px',
                    background: 'rgba(56, 189, 248, 0.2)',
                    color: '#BAE6FD',
                    fontWeight: 700,
                  }}
                >
                  {TARGET_LANGUAGES[activeFlashCard.language].flag} {activeFlashCard.partOfSpeech}
                </span>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#34D399' }}>
                  {activeFlashCard.meaning}
                </div>
                {activeFlashCard.koreanPronunciation && (
                  <div style={{ fontSize: '14px', color: '#E2E8F0' }}>
                    발음: [{activeFlashCard.koreanPronunciation}]
                  </div>
                )}
                <div
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '16px',
                    background: 'rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>
                    {activeFlashCard.exampleTarget}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    {activeFlashCard.exampleKorean}
                  </div>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  누적 복습 {activeFlashCard.reviewCount}회
                </div>
              </>
            )}

            <div
              style={{
                position: 'absolute',
                bottom: '14px',
                right: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              <RotateCw size={12} /> 뒤집기
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFlipped(false);
                setFlashIndex((i) => i + 1);
              }}
              style={{ flex: 1 }}
            >
              다음 카드
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onMarkReviewed(activeFlashCard);
                setFlipped(false);
                setFlashIndex((i) => i + 1);
              }}
              style={{ flex: 1.4 }}
            >
              <Check size={16} /> 외웠어요!
            </button>
          </div>
        </div>
      ) : (
        <div
          className="no-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 16px 24px',
          }}
        >
          {filteredCards.length === 0 ? (
            <div
              className="glass-panel"
              style={{
                borderRadius: '22px',
                padding: '28px 18px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                marginTop: '20px',
              }}
            >
              <Sparkles size={28} color="#38BDF8" />
              <div style={{ fontSize: '15px', fontWeight: 700 }}>
                저장된 단어 스티커가 아직 없어요
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                카메라로 사물을 스캔하면 자동으로 스티커 단어 카드가 만들어집니다.
                <br />
                또는 기본 스타터 단어 세트를 바로 추가해 볼 수도 있어요!
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={creatingStarter}
                onClick={handleCreateStarters}
              >
                <Sparkles size={15} />
                {creatingStarter ? '스티커 생성 중...' : '스타터 단어 스티커 4개 추가하기'}
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '12px',
              }}
            >
              {filteredCards.map((card) => {
                const lang = TARGET_LANGUAGES[card.language];
                return (
                  <article
                    key={card.id}
                    className="glass-panel"
                    style={{
                      borderRadius: '20px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
                        {lang.flag} {card.partOfSpeech}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          onClick={() => onEditSticker(card)}
                          aria-label="스티커 편집"
                          style={{ padding: '4px', color: 'var(--text-secondary)' }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteCard(card.id)}
                          aria-label="단어 삭제"
                          style={{ padding: '4px', color: 'var(--text-muted)' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div
                      onClick={() => onEditSticker(card)}
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: '4px 0',
                        cursor: 'pointer',
                      }}
                    >
                      <img
                        src={card.stickerDataUrl}
                        alt={card.word}
                        style={{
                          width: '104px',
                          height: '104px',
                          objectFit: 'contain',
                          filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.4))',
                        }}
                      />
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '15px',
                          fontWeight: 800,
                          color: '#FFFFFF',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {card.word}
                      </div>
                      <div
                        style={{
                          fontSize: '11.5px',
                          color: '#7DD3FC',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {card.koreanPronunciation || card.reading}
                      </div>
                      <div
                        style={{
                          fontSize: '12.5px',
                          color: 'var(--text-secondary)',
                          marginTop: '2px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {card.meaning}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onSpeakWord(card.word, card.language)}
                      style={{
                        padding: '7px 10px',
                        fontSize: '12px',
                        borderRadius: '11px',
                        width: '100%',
                      }}
                    >
                      <Volume2 size={14} color="#38BDF8" /> 발음 듣기
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
