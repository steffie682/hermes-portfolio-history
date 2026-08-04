const MIN_CONFIDENCE = 70;
const HEADER_LIMIT = 0.35;
const KINDS = ['name', 'address', 'account'] as const;
const LABELS: Record<PiiKind, RegExp> = {
  name: /^(?:お?名前|氏名)$/, address: /^(?:ご?住所|住所)$/, account: /^(?:口座番号|お客様番号|顧客コード)$/,
};
type PiiKind = typeof KINDS[number];
type Box = { x0: number; y0: number; x1: number; y1: number };
export type SbiPiiWord = { text: string; confidence: number; bbox: Box };
export type SbiPiiMaskPlan = {
  status: 'ready' | 'review_required';
  detectedKinds: PiiKind[];
  missingKinds: PiiKind[];
  masks: Box[];
};
function validBox(box: Box, width: number, height: number) {
  return [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)
    && box.x0 >= 0 && box.y0 >= 0 && box.x1 > box.x0 && box.y1 > box.y0
    && box.x1 <= width && box.y1 <= height;
}
function compact(value: string) { return value.normalize('NFKC').replace(/\s+/g, ''); }
export function createSbiLocalPiiMaskPlan(
  page: { width: number; height: number }, words: SbiPiiWord[],
): SbiPiiMaskPlan {
  if (!Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0) {
    return { status: 'review_required', detectedKinds: [], missingKinds: [...KINDS], masks: [] };
  }
  const matches = new Map<PiiKind, Box[]>(KINDS.map((kind) => [kind, []]));
  const trusted = words.filter((word) => Number.isFinite(word.confidence) && word.confidence >= MIN_CONFIDENCE
    && validBox(word.bbox, page.width, page.height));
  const headerWords = trusted.filter((word) => word.bbox.y0 / page.height < HEADER_LIMIT);
  const spans = headerWords.flatMap((word, index) => {
    const next = headerWords[index + 1];
    if (!next) return [{ text: compact(word.text), bbox: word.bbox }];
    const height = word.bbox.y1 - word.bbox.y0;
    const sameLine = Math.abs(word.bbox.y0 - next.bbox.y0) <= Math.max(2, height * 0.4);
    const nearby = next.bbox.x0 >= word.bbox.x1 && next.bbox.x0 - word.bbox.x1 <= Math.max(20, height * 2.5);
    return [{ text: compact(word.text), bbox: word.bbox }, ...(sameLine && nearby ? [{
      text: compact(word.text + next.text),
      bbox: { x0: word.bbox.x0, y0: Math.min(word.bbox.y0, next.bbox.y0),
        x1: next.bbox.x1, y1: Math.max(word.bbox.y1, next.bbox.y1) },
    }] : [])];
  });
  for (const span of spans) {
    const kind = KINDS.find((candidate) => LABELS[candidate].test(span.text));
    if (kind) {
      const existing = matches.get(kind)!;
      const contained = existing.findIndex((box) => Math.abs(box.y0 - span.bbox.y0) <= 2
        && ((box.x0 <= span.bbox.x0 && box.x1 >= span.bbox.x1) || (span.bbox.x0 <= box.x0 && span.bbox.x1 >= box.x1))
        && (box.x0 !== span.bbox.x0 || box.x1 !== span.bbox.x1));
      if (contained >= 0) {
        existing[contained] = { x0: Math.min(existing[contained].x0, span.bbox.x0), y0: Math.min(existing[contained].y0, span.bbox.y0),
          x1: Math.max(existing[contained].x1, span.bbox.x1), y1: Math.max(existing[contained].y1, span.bbox.y1) };
      } else existing.push(span.bbox);
    }
  }
  const detectedKinds = KINDS.filter((kind) => matches.get(kind)!.length > 0);
  const missingKinds = KINDS.filter((kind) => matches.get(kind)!.length === 0);
  if (missingKinds.length > 0 || KINDS.some((kind) => matches.get(kind)!.length !== 1)) {
    return { status: 'review_required', detectedKinds, missingKinds, masks: [] };
  }

  const identityBoxes = KINDS.map((kind) => matches.get(kind)![0]);
  const ordered = identityBoxes.every((box, index) => index === 0 || box.y0 > identityBoxes[index - 1].y1);
  const identityEnd = Math.max(...identityBoxes.map((box) => box.y1));
  const sectionPatterns = [
    { section: /^国内株式$/, headers: [/銘柄/, /数量/, /(?:取得価格|取得単価)/, /(?:買付金額|取得金額)/] },
    { section: /^投資信託$/, headers: [/銘柄/, /(?:数量|口数)/, /(?:参考価格|基準価額)/, /評価額/] },
    { section: /^(?:信用取引の?建玉残高|信用建玉残高)$/, headers: [/銘柄/, /数量/, /区分/, /約定年月日/, /約定単価/, /評価損益/] },
  ];
  const section = trusted.filter((word) => word.bbox.y0 > identityEnd).sort((a, b) => a.bbox.y0 - b.bbox.y0)
    .find((candidate) => {
      const proof = sectionPatterns.find(({ section }) => section.test(compact(candidate.text)));
      if (!proof) return false;
      const possible = trusted.filter((word) => word.bbox.y0 > candidate.bbox.y1
        && word.bbox.y0 - candidate.bbox.y1 <= page.height * 0.08);
      return possible.some((first) => {
        const line = possible.filter((word) => Math.abs(word.bbox.y0 - first.bbox.y0) <= Math.max(2, (first.bbox.y1 - first.bbox.y0) * 0.4))
          .sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const matched = proof.headers.map((pattern) => line.find((word) => pattern.test(compact(word.text))
          && (word.bbox.x1 - word.bbox.x0) / page.width <= 0.2));
        return matched.every((word) => word !== undefined)
          && matched.every((word, index) => index === 0 || word!.bbox.x0 >= matched[index - 1]!.bbox.x1);
      });
    });
  if (!ordered || !section) return { status: 'review_required', detectedKinds, missingKinds, masks: [] };
  const padding = Math.max(3, (section.bbox.y1 - section.bbox.y0) * 0.3);
  const boundary = Math.max(1, section.bbox.y0 - padding);
  return { status: 'ready', detectedKinds, missingKinds, masks: [{ x0: 0, y0: 0, x1: page.width, y1: boundary }] };
}

export function pointIsMasked(plan: SbiPiiMaskPlan, x: number, y: number) {
  return Number.isFinite(x) && Number.isFinite(y)
    && plan.masks.some((mask) => x >= mask.x0 && x <= mask.x1 && y >= mask.y0 && y <= mask.y1);
}

export function applySbiPiiMaskPlan(context: CanvasRenderingContext2D, plan: SbiPiiMaskPlan) {
  if (plan.status !== 'ready' || plan.masks.length !== 1) return false;
  context.fillStyle = '#000000';
  for (const mask of plan.masks) context.fillRect(mask.x0, mask.y0, mask.x1 - mask.x0, mask.y1 - mask.y0);
  return true;
}
