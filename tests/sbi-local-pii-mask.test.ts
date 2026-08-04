import { describe, expect, it, vi } from 'vitest';
import { applySbiPiiMaskPlan, createSbiLocalPiiMaskPlan, pointIsMasked } from '@/import/sbi/local-pii-mask';

const page = { width: 1_000, height: 1_400 };
function word(text: string, x0: number, y0: number, x1 = x0 + 100, confidence = 95) {
  return { text, confidence, bbox: { x0, y0, x1, y1: y0 + 20 } };
}

describe('SBI local PII masking plan', () => {
  it('returns only bounded mask geometry when all required identity anchors are trusted', () => {
    const secretName = '合成秘密名';
    const secretAddress = '合成県秘密市1-2-3';
    const secretAccount = '0123456789';
    const plan = createSbiLocalPiiMaskPlan(page, [
      word('お名前', 60, 80), word(secretName, 220, 80, 420),
      word('ご住所', 60, 120), word(secretAddress, 220, 120, 520),
      word('口座番号', 60, 160), word(secretAccount, 220, 160, 360),
      word('国内株式', 60, 300), word('銘柄名', 60, 330), word('数量', 560, 330), word('取得価格', 690, 330), word('買付金額', 860, 330),
    ]);

    expect(plan.status).toBe('ready');
    expect(plan.detectedKinds).toEqual(['name', 'address', 'account']);
    expect(pointIsMasked(plan, 300, 90)).toBe(true);
    expect(pointIsMasked(plan, 20, 90)).toBe(true);
    expect(pointIsMasked(plan, 300, 130)).toBe(true);
    expect(pointIsMasked(plan, 300, 170)).toBe(true);
    expect(pointIsMasked(plan, 300, 250)).toBe(true);
    expect(pointIsMasked(plan, 300, 310)).toBe(false);
    expect(JSON.stringify(plan)).not.toContain(secretName);
    expect(JSON.stringify(plan)).not.toContain(secretAddress);
    expect(JSON.stringify(plan)).not.toContain(secretAccount);
  });

  it('burns a ready mask plan into a canvas and refuses incomplete plans', () => {
    const ready = createSbiLocalPiiMaskPlan(page, [word('お名前', 60, 80), word('ご住所', 60, 120), word('口座番号', 60, 160), word('国内株式', 60, 300), word('銘柄名', 60, 330), word('数量', 560, 330), word('取得価格', 690, 330), word('買付金額', 860, 330)]);
    const fillRect = vi.fn();
    const context = { fillStyle: '', fillRect } as unknown as CanvasRenderingContext2D;
    expect(applySbiPiiMaskPlan(context, ready)).toBe(true);
    expect(context.fillStyle).toBe('#000000');
    expect(fillRect).toHaveBeenCalledTimes(1);

    const incomplete = createSbiLocalPiiMaskPlan(page, [word('お名前', 60, 80)]);
    fillRect.mockClear();
    expect(applySbiPiiMaskPlan(context, incomplete)).toBe(false);
    expect(fillRect).not.toHaveBeenCalled();
  });

  it('refuses coincident identity anchors or a missing later financial-section boundary', () => {
    const coincident = createSbiLocalPiiMaskPlan(page, [
      word('お名前', 60, 80), word('ご住所', 180, 80), word('口座番号', 300, 80), word('国内株式', 60, 300), word('銘柄名', 60, 330), word('数量', 560, 330), word('取得価格', 690, 330), word('買付金額', 860, 330),
    ]);
    expect(coincident.status).toBe('review_required');
    expect(coincident.masks).toEqual([]);

    const noBoundary = createSbiLocalPiiMaskPlan(page, [
      word('お名前', 60, 80), word('ご住所', 60, 120), word('口座番号', 60, 160),
    ]);
    expect(noBoundary.status).toBe('review_required');
    expect(noBoundary.masks).toEqual([]);
  });

  it('rejects duplicate or overlapping identity anchors and an uncorroborated section token', () => {
    const table = [word('国内株式', 60, 300), word('銘柄名', 60, 330), word('数量', 560, 330),
      word('取得価格', 690, 330), word('買付金額', 860, 330)];
    const duplicate = createSbiLocalPiiMaskPlan(page, [word('お名前', 60, 60), word('氏名', 60, 80),
      word('ご住所', 60, 120), word('口座番号', 60, 160), ...table]);
    const overlapping = createSbiLocalPiiMaskPlan(page, [word('お名前', 60, 80), word('ご住所', 60, 90),
      word('口座番号', 60, 100), ...table]);
    const loneSection = createSbiLocalPiiMaskPlan(page, [word('お名前', 60, 80), word('ご住所', 60, 120),
      word('口座番号', 60, 160), word('国内株式', 60, 210), word('秘密値', 200, 240)]);
    const clusteredBoundary = createSbiLocalPiiMaskPlan(page, [word('お名前', 60, 80), word('ご住所', 60, 120),
      word('口座番号', 60, 160), word('国内株式', 60, 300), word('銘柄名', 60, 330), word('数量', 62, 330),
      word('取得価格', 64, 330), word('買付金額', 66, 330)]);
    for (const plan of [duplicate, overlapping, loneSection, clusteredBoundary]) {
      expect(plan.status).toBe('review_required');
      expect(plan.masks).toEqual([]);
    }
  });

  it('recognizes only nearby trusted label fragments on the same line', () => {
    const plan = createSbiLocalPiiMaskPlan(page, [
      word('お', 60, 80, 78), word('名前', 82, 80, 130),
      word('ご住所', 60, 120, 130),
      word('口座', 60, 160, 105), word('番号', 110, 160, 155),
      word('国内株式', 60, 300), word('銘柄名', 60, 330), word('数量', 560, 330), word('取得価格', 690, 330), word('買付金額', 860, 330),
    ]);
    expect(plan.status).toBe('ready');
    expect(plan.detectedKinds).toEqual(['name', 'address', 'account']);
  });
});
