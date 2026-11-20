import { describe, expect, it } from 'vitest';
import { adjustCropRect, descaleBox2d } from './bboxCrop';

describe('bboxCrop', () => {
  it('descales normalized [ymin, xmin, ymax, xmax] with padding and bounds clamping', () => {
    const rect = descaleBox2d([200, 300, 600, 700], 1000, 800, 0.1);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1000);
    expect(rect.y + rect.height).toBeLessThanOrEqual(800);
    expect(rect.width).toBeGreaterThan(350);
  });

  it('falls back to centered square when box2d is missing or tiny', () => {
    const missing = descaleBox2d(undefined, 800, 600);
    expect(missing).toEqual({ x: 205, y: 105, width: 390, height: 390 });

    const tiny = descaleBox2d([100, 100, 102, 102], 800, 600);
    expect(tiny.width).toBe(360);
    expect(tiny.height).toBe(360);
  });

  it('applies zoom and pan offset safely inside image bounds', () => {
    const base = { x: 100, y: 100, width: 400, height: 400 };
    const zoomed = adjustCropRect(base, 800, 600, 2, 0.4, -0.4);
    expect(zoomed.width).toBe(200);
    expect(zoomed.height).toBe(200);
    expect(zoomed.x).toBeGreaterThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(0);
    expect(zoomed.x + zoomed.width).toBeLessThanOrEqual(800);
    expect(zoomed.y + zoomed.height).toBeLessThanOrEqual(600);
  });
});
