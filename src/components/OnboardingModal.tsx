import React, { useState } from 'react';
import { Camera, ExternalLink, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { LANGUAGE_LIST } from '../config/languages';
import type { TargetLanguageCode } from '../types/app';

interface OnboardingModalProps {
  defaultLanguage: TargetLanguageCode;
  onStartWithKey: (apiKey: string, language: TargetLanguageCode) => void;
  onStartDemo: (language: TargetLanguageCode) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  defaultLanguage,
  onStartWithKey,
  onStartDemo,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [selectedLang, setSelectedLang] = useState<TargetLanguageCode>(defaultLanguage);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        background:
          'radial-gradient(circle at top, rgba(56, 189, 248, 0.2), rgba(6, 9, 19, 0.96) 55%)',
        backdropFilter: 'blur(18px)',
        padding: 'calc(20px + var(--safe-top)) 18px calc(20px + var(--safe-bottom))',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <div
        className="glass-panel-strong anim-fade-up"
        style={{
          borderRadius: '28px',
          padding: '22px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #38BDF8, #6366F1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#061121',
              flexShrink: 0,
            }}
          >
            <Camera size={24} strokeWidth={2.4} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '21px', fontWeight: 800, letterSpacing: '-0.02em' }}>
              LensLingo AI 튜터
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              세상을 비추며 말로 배우는 AR 언어 튜터
            </p>
          </div>
        </div>

        {/* Language Picker */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            먼저 배우고 싶은 언어를 골라주세요
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {LANGUAGE_LIST.map((lang) => {
              const active = selectedLang === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setSelectedLang(lang.code)}
                  style={{
                    padding: '7px 11px',
                    borderRadius: '9999px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    background: active ? 'rgba(56, 189, 248, 0.24)' : 'rgba(255,255,255,0.06)',
                    border: active ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.12)',
                    color: active ? '#E0F2FE' : 'var(--text-secondary)',
                  }}
                >
                  {lang.flag} {lang.koreanName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Option 1: BYOK Gemini Key */}
        <div
          style={{
            padding: '14px',
            borderRadius: '18px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', fontWeight: 700 }}>
              <KeyRound size={15} color="#38BDF8" /> Gemini API 키로 실전 AI 시작
            </span>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11.5px',
                color: '#7DD3FC',
                textDecoration: 'none',
              }}
            >
              키 발급 <ExternalLink size={11} />
            </a>
          </div>

          <input
            type="password"
            className="field-input"
            placeholder="AIza... Gemini API 키 입력"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
            <ShieldCheck size={14} color="#34D399" />
            <span>입력한 키는 내 기기 브라우저(localStorage)에만 안전하게 저장됩니다.</span>
          </div>

          <button
            type="button"
            className="btn-primary"
            disabled={!apiKey.trim()}
            onClick={() => onStartWithKey(apiKey.trim(), selectedLang)}
          >
            API 키 저장하고 시작하기
          </button>
        </div>

        {/* Option 2: Zero-friction Demo Mode */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onStartDemo(selectedLang)}
          style={{ width: '100%', padding: '13px 16px' }}
        >
          <Sparkles size={16} color="#FBBF24" /> API 키 없이 데모 모드로 바로 체험하기
        </button>
      </div>
    </div>
  );
};
