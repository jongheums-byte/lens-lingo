import React, { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { descaleBox2d, loadImageElement, renderStickerToCanvas } from '../lib/bboxCrop';
import { playSfx } from '../lib/audioUtils';
import type { SavedVocabCard, StickerShape } from '../types/app';

interface StickerCutoutEditorModalProps {
  card: SavedVocabCard;
  onClose: () => void;
  onSave: (updated: SavedVocabCard) => void;
}

const SHAPE_OPTIONS: { id: StickerShape; label: string }[] = [
  { id: 'rounded', label: '둥근 사각' },
  { id: 'circle', label: '원형' },
  { id: 'pill', label: '알약형' },
  { id: 'polaroid', label: '폴라로이드' },
];

export const StickerCutoutEditorModal: React.FC<StickerCutoutEditorModalProps> = ({
  card,
  onClose,
  onSave,
}) => {
  const [shape, setShape] = useState<StickerShape>(card.stickerShape);
  const [whiteBorder, setWhiteBorder] = useState<boolean>(card.whiteBorder);
  const [zoom, setZoom] = useState<number>(1);
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(0);
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  useEffect(() => {
    let mounted = true;
    const src = card.sourceImageDataUrl || card.stickerDataUrl;
    loadImageElement(src)
      .then((img) => {
        if (mounted) setSourceImg(img);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [card.sourceImageDataUrl, card.stickerDataUrl]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !sourceImg) return;

    const baseRect = card.sourceImageDataUrl
      ? descaleBox2d(card.box2d, sourceImg.naturalWidth || sourceImg.width, sourceImg.naturalHeight || sourceImg.height)
      : {
          x: 0,
          y: 0,
          width: sourceImg.naturalWidth || sourceImg.width,
          height: sourceImg.naturalHeight || sourceImg.height,
        };

    const rendered = renderStickerToCanvas(sourceImg, baseRect, {
      shape,
      whiteBorder,
      outputSize: 360,
      zoom,
      offsetX,
      offsetY,
    });

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height);
    }
  }, [sourceImg, card.sourceImageDataUrl, card.box2d, shape, whiteBorder, zoom, offsetX, offsetY]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offsetX,
      baseY: offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const dx = (e.clientX - dragRef.current.startX) / 240;
    const dy = (e.clientY - dragRef.current.startY) / 240;
    setOffsetX(Math.max(-0.8, Math.min(0.8, dragRef.current.baseX - dx)));
    setOffsetY(Math.max(-0.8, Math.min(0.8, dragRef.current.baseY - dy)));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const handleReset = () => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    setShape('rounded');
    setWhiteBorder(true);
  };

  const handleSave = () => {
    if (!sourceImg) {
      onClose();
      return;
    }
    const baseRect = card.sourceImageDataUrl
      ? descaleBox2d(card.box2d, sourceImg.naturalWidth || sourceImg.width, sourceImg.naturalHeight || sourceImg.height)
      : {
          x: 0,
          y: 0,
          width: sourceImg.naturalWidth || sourceImg.width,
          height: sourceImg.naturalHeight || sourceImg.height,
        };
    const finalCanvas = renderStickerToCanvas(sourceImg, baseRect, {
      shape,
      whiteBorder,
      outputSize: 360,
      zoom,
      offsetX,
      offsetY,
    });
    const webp = finalCanvas.toDataURL('image/webp', 0.88);
    const stickerDataUrl = webp.startsWith('data:image/webp')
      ? webp
      : finalCanvas.toDataURL('image/png');

    playSfx('save');
    onSave({
      ...card,
      stickerDataUrl,
      stickerShape: shape,
      whiteBorder,
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: 'rgba(4, 7, 17, 0.82)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="glass-panel-strong anim-fade-up"
        style={{
          width: '100%',
          maxHeight: '92%',
          borderRadius: '26px',
          padding: '18px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="#38BDF8" />
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800 }}>스티커 컷아웃 편집</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {card.word} · {card.meaning}
              </div>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        {/* Interactive Canvas Preview */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            padding: '14px',
            borderRadius: '20px',
            background:
              'radial-gradient(circle at center, rgba(56, 189, 248, 0.14), rgba(10, 14, 28, 0.7))',
            border: '1px dashed rgba(255,255,255,0.18)',
          }}
        >
          <canvas
            ref={previewCanvasRef}
            width={240}
            height={240}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              width: '210px',
              height: '210px',
              touchAction: 'none',
              cursor: 'grab',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            스티커를 드래그해 위치를 조절하세요
          </span>
        </div>

        {/* Shape Selector */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            스티커 모양
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {SHAPE_OPTIONS.map((opt) => {
              const active = shape === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setShape(opt.id)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    background: active ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255,255,255,0.06)',
                    border: active ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.12)',
                    color: active ? '#E0F2FE' : 'var(--text-secondary)',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Zoom + White Border */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>확대 / 축소</span>
              <span>{zoom.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min={0.7}
              max={2.4}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#38BDF8' }}
            />
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: '14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <span>화이트 다이컷 스티커 테두리</span>
            <input
              type="checkbox"
              checked={whiteBorder}
              onChange={(e) => setWhiteBorder(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#38BDF8' }}
            />
          </label>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
          <button type="button" className="btn-secondary" onClick={handleReset} style={{ flex: 1 }}>
            <RotateCcw size={15} /> 초기화
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} style={{ flex: 2 }}>
            <Check size={16} /> 스티커 저장
          </button>
        </div>
      </div>
    </div>
  );
};
