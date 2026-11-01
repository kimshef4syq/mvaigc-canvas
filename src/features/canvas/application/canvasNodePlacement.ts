import {
  CANVAS_NODE_TYPES,
  DEFAULT_NODE_WIDTH,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type CanvasNode,
} from '../domain/canvasNodes';
import { canvasNodeDefinitions } from '../domain/nodeRegistry';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Rect = Point & Size;

export interface CanvasPlacementViewport {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface RelatedCanvasPlacementInput {
  nodes: readonly CanvasNode[];
  desired: Point;
  size: Size;
  count?: number;
  relatedNodeId?: string;
  viewport?: CanvasPlacementViewport | null;
}

const DEFAULT_NODE_HEIGHT = 200;
const COLLISION_MARGIN = 18;
const RELATION_GAP = 32;

/** Match card sizes before React Flow has measured a newly created node. */
export function getCanvasNodeSize(node: Pick<CanvasNode, 'type' | 'measured' | 'width' | 'height' | 'style'>): Size {
  const style = node.style as { width?: unknown; height?: unknown } | undefined;
  const fallback = canvasNodeDefinitions[node.type]?.defaultSize
    ?? (node.type === CANVAS_NODE_TYPES.imageEdit ? { width: 680, height: 380 }
        : node.type === CANVAS_NODE_TYPES.exportImage || node.type === CANVAS_NODE_TYPES.aiVideo
          ? { width: EXPORT_RESULT_NODE_DEFAULT_WIDTH, height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT }
          : { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const first = (values: unknown[], defaultValue: number) => (values.find(valid) as number | undefined) ?? defaultValue;
  const minWidth = node.type === CANVAS_NODE_TYPES.imageEdit ? 520 : 0;
  const minHeight = minWidth ? 260 : 0;
  return {
    width: valid(node.measured?.width) ? node.measured.width : Math.max(minWidth, first([node.width, style?.width], fallback.width)),
    height: valid(node.measured?.height) ? node.measured.height : Math.max(minHeight, first([node.height, style?.height], fallback.height)),
  };
}

function nodeRect(node: CanvasNode, nodes: readonly CanvasNode[]): Rect {
  let { x, y } = node.position;
  let parentId = node.parentId;
  const visited = new Set([node.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y, ...getCanvasNodeSize(node) };
}

function overlaps(left: Rect, right: Rect, margin = COLLISION_MARGIN): boolean {
  return left.x < right.x + right.width + margin
    && left.x + left.width + margin > right.x
    && left.y < right.y + right.height + margin
    && left.y + left.height + margin > right.y;
}

function rectDistance(left: Rect, right: Rect): number {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return Math.hypot(dx, dy);
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function viewportOverflow(rect: Rect, viewport?: CanvasPlacementViewport | null): number {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return 0;
  const zoom = Math.max(0.01, viewport.zoom || 1);
  const bounds = {
    left: -viewport.x / zoom,
    top: -viewport.y / zoom,
    right: -viewport.x / zoom + viewport.width / zoom,
    bottom: -viewport.y / zoom + viewport.height / zoom,
  };
  return Math.max(0, bounds.left - rect.x)
    + Math.max(0, bounds.top - rect.y)
    + Math.max(0, rect.x + rect.width - bounds.right)
    + Math.max(0, rect.y + rect.height - bounds.bottom);
}

function candidateKey(point: Point): string {
  return `${Math.round(point.x * 10)}:${Math.round(point.y * 10)}`;
}

function buildCandidates(anchor: Point, size: Size, relatedRect?: Rect): Point[] {
  const candidates: Point[] = [anchor];
  if (relatedRect) {
    candidates.push(
      { x: relatedRect.x + relatedRect.width + RELATION_GAP, y: relatedRect.y },
      { x: relatedRect.x, y: relatedRect.y + relatedRect.height + RELATION_GAP },
      { x: relatedRect.x - size.width - RELATION_GAP, y: relatedRect.y },
      { x: relatedRect.x, y: relatedRect.y - size.height - RELATION_GAP },
    );
  }

  const stepX = Math.max(104, Math.round(size.width * 0.48));
  const stepY = Math.max(88, Math.round(size.height * 0.48));
  for (let ring = 1; ring <= 7; ring += 1) {
    for (let x = -ring; x <= ring; x += 1) {
      candidates.push(
        { x: anchor.x + x * stepX, y: anchor.y - ring * stepY },
        { x: anchor.x + x * stepX, y: anchor.y + ring * stepY },
      );
    }
    for (let y = -ring + 1; y < ring; y += 1) {
      candidates.push(
        { x: anchor.x - ring * stepX, y: anchor.y + y * stepY },
        { x: anchor.x + ring * stepX, y: anchor.y + y * stepY },
      );
    }
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Finds nearby positions with enough surrounding room for a readable result
 * cluster. Clearance improves the score, but a bounded relationship-distance
 * penalty prevents a generated result from jumping to a remote empty corner.
 */
export function findRelatedCanvasNodePositions(input: RelatedCanvasPlacementInput): Point[] {
  const total = Math.max(1, Math.floor(input.count ?? 1));
  const obstacles = input.nodes.map((node) => nodeRect(node, input.nodes));
  const relatedNode = input.relatedNodeId
    ? input.nodes.find((node) => node.id === input.relatedNodeId)
    : undefined;
  const relatedRect = relatedNode ? nodeRect(relatedNode, input.nodes) : undefined;
  const anchor = relatedRect
    ? { x: relatedRect.x + relatedRect.width + RELATION_GAP, y: relatedRect.y }
    : input.desired;
  const anchorRect: Rect = { ...anchor, ...input.size };
  const anchorCenter = center(anchorRect);
  const reserved: Rect[] = [];
  const positions: Point[] = [];

  for (let index = 0; index < total; index += 1) {
    const candidates = buildCandidates(
      index === 0 ? anchor : { x: anchor.x, y: anchor.y + index * (input.size.height + RELATION_GAP) },
      input.size,
      relatedRect,
    );
    // Obstacle edges cover narrow gaps and extend beyond a dense canvas. In
    // particular, the outermost edge always supplies a collision-free fallback.
    for (const obstacle of [...obstacles, ...reserved]) {
      candidates.push(
        { x: obstacle.x + obstacle.width + RELATION_GAP, y: anchor.y },
        { x: obstacle.x - input.size.width - RELATION_GAP, y: anchor.y },
        { x: anchor.x, y: obstacle.y + obstacle.height + RELATION_GAP },
        { x: anchor.x, y: obstacle.y - input.size.height - RELATION_GAP },
      );
    }
    let best: { point: Point; score: number } | null = null;
    for (const point of candidates) {
      const rect: Rect = { ...point, ...input.size };
      if (obstacles.some((obstacle) => overlaps(rect, obstacle)) || reserved.some((item) => overlaps(rect, item))) {
        continue;
      }
      const clearance = [...obstacles, ...reserved].reduce(
        (nearest, obstacle) => Math.min(nearest, rectDistance(rect, obstacle)),
        560,
      );
      const rectCenter = center(rect);
      const relationshipDistance = Math.hypot(rectCenter.x - anchorCenter.x, rectCenter.y - anchorCenter.y);
      const overflow = viewportOverflow(rect, input.viewport);
      const upwardPenalty = point.y < anchor.y ? Math.abs(point.y - anchor.y) * 0.12 : 0;
      const score = relationshipDistance * 0.72
        + Math.min(overflow, input.size.width + input.size.height) * 0.2
        + upwardPenalty
        - Math.min(clearance, RELATION_GAP) * 0.1;
      if (!best || score < best.score) best = { point, score };
    }

    if (!best) throw new Error('No collision-free canvas placement found.');
    const point = best.point;
    positions.push({ ...point });
    reserved.push({ ...point, ...input.size });
  }

  return positions;
}
