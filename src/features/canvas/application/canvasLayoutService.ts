import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type CanvasNode,
  type CanvasEdge,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';

export interface NodeLayoutPosition {
  nodeId: string;
  position: { x: number; y: number };
}

export interface LayoutOptions {
  gapX?: number;
  gapY?: number;
  origin?: { x: number; y: number };
  activeNodeIds?: string[];
}

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 240;

function getNodeDimensions(node: CanvasNode): { width: number; height: number } {
  const style = node.style as { width?: unknown; height?: unknown } | undefined;
  // exportImage（生成图片结果）无 defaultSize，未测量时按它真实渲染尺寸回退，避免排布重叠。
  const fallbackWidth = node.type === CANVAS_NODE_TYPES.exportImage
    ? EXPORT_RESULT_NODE_DEFAULT_WIDTH
    : DEFAULT_NODE_WIDTH;
  const fallbackHeight = node.type === CANVAS_NODE_TYPES.exportImage
    ? EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    : DEFAULT_NODE_HEIGHT;
  return {
    width: node.measured?.width ?? node.width ?? (typeof style?.width === 'number' ? style.width : fallbackWidth),
    height: node.measured?.height ?? node.height ?? (typeof style?.height === 'number' ? style.height : fallbackHeight),
  };
}

function resolveTargetNodes(nodes: CanvasNode[], activeNodeIds?: string[]): CanvasNode[] {
  // 分组子节点的坐标是相对父组的，扁平排布会把它写成绝对坐标 → 组内挤成一坨。
  // 因此整理只排布顶层节点（无 parentId），子节点随组整体移动、保持组内布局。
  const topLevel = nodes.filter((n) => !n.parentId);
  if (activeNodeIds && activeNodeIds.length >= 2) {
    const activeSet = new Set(activeNodeIds);
    const filtered = topLevel.filter((n) => activeSet.has(n.id));
    if (filtered.length >= 2) return filtered;
  }
  return topLevel;
}

function computeBoundingOrigin(nodes: CanvasNode[], fallback = { x: 80, y: 80 }): { x: number; y: number } {
  if (nodes.length === 0) return fallback;
  return nodes.reduce(
    (acc, node) => ({
      x: Math.min(acc.x, node.position.x),
      y: Math.min(acc.y, node.position.y),
    }),
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
  );
}

/**
 * 1. 按连线关系整理 (Organize by Connections / Directed Topology)
 * 根据节点间的有向输入输出连接拓扑结构，自左向右分层排布；
 * 多个独立的工作流分支垂直错开摆放，无连线独立节点置于底部分区。
 */
export function organizeByConnection(
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
  options: LayoutOptions = {},
): NodeLayoutPosition[] {
  const targetNodes = resolveTargetNodes(allNodes, options.activeNodeIds);
  if (targetNodes.length <= 1) {
    return targetNodes.map((n) => ({ nodeId: n.id, position: { ...n.position } }));
  }

  const targetIdSet = new Set(targetNodes.map((n) => n.id));
  const relevantEdges = allEdges.filter((e) => targetIdSet.has(e.source) && targetIdSet.has(e.target));
  const origin = options.origin ?? computeBoundingOrigin(targetNodes);
  const gapX = options.gapX ?? 100;
  const gapY = options.gapY ?? 56;

  // 1. 构建无向邻接表用于连通分量划分 (Connected Components)
  const undirectedAdj = new Map<string, Set<string>>();
  targetNodes.forEach((n) => undirectedAdj.set(n.id, new Set()));
  relevantEdges.forEach((e) => {
    undirectedAdj.get(e.source)?.add(e.target);
    undirectedAdj.get(e.target)?.add(e.source);
  });

  const visitedComponents = new Set<string>();
  const components: CanvasNode[][] = [];
  const isolatedNodes: CanvasNode[] = [];

  targetNodes.forEach((node) => {
    if (visitedComponents.has(node.id)) return;
    const neighbors = undirectedAdj.get(node.id);
    if (!neighbors || neighbors.size === 0) {
      visitedComponents.add(node.id);
      isolatedNodes.push(node);
      return;
    }

    const component: CanvasNode[] = [];
    const queue = [node.id];
    visitedComponents.add(node.id);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentObj = targetNodes.find((n) => n.id === currentId);
      if (currentObj) component.push(currentObj);

      const nexts = undirectedAdj.get(currentId) || new Set();
      nexts.forEach((adjId) => {
        if (!visitedComponents.has(adjId)) {
          visitedComponents.add(adjId);
          queue.push(adjId);
        }
      });
    }
    components.push(component);
  });

  const results: NodeLayoutPosition[] = [];
  let currentTopY = origin.y;

  // 2. 对每个连通分量执行有向拓扑分层 (Sugiyama-style Layering)
  components.forEach((componentNodes) => {
    const compIdSet = new Set(componentNodes.map((n) => n.id));
    const compEdges = relevantEdges.filter((e) => compIdSet.has(e.source) && compIdSet.has(e.target));

    const inDegree = new Map<string, number>();
    const outEdges = new Map<string, string[]>();
    const inEdges = new Map<string, string[]>();

    componentNodes.forEach((n) => {
      inDegree.set(n.id, 0);
      outEdges.set(n.id, []);
      inEdges.set(n.id, []);
    });

    compEdges.forEach((e) => {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
      outEdges.get(e.source)?.push(e.target);
      inEdges.get(e.target)?.push(e.source);
    });

    // 拓扑层级计算 (Longest path layering)
    const layers = new Map<string, number>();
    const roots = componentNodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
    const startRoots = roots.length > 0 ? roots : [componentNodes[0]];

    const rankQueue: string[] = startRoots.map((n) => n.id);
    startRoots.forEach((n) => layers.set(n.id, 0));

    const visitedRanks = new Set<string>();
    while (rankQueue.length > 0) {
      const u = rankQueue.shift()!;
      visitedRanks.add(u);
      const currentLayer = layers.get(u) ?? 0;
      const targets = outEdges.get(u) || [];

      targets.forEach((v) => {
        const nextLayer = Math.max(layers.get(v) ?? 0, currentLayer + 1);
        layers.set(v, nextLayer);
        if (!visitedRanks.has(v) && !rankQueue.includes(v)) {
          rankQueue.push(v);
        }
      });
    }

    // 处理遗漏节点（如成环等边界情况）
    componentNodes.forEach((n) => {
      if (!layers.has(n.id)) {
        layers.set(n.id, 0);
      }
    });

    // 按层归组
    const layerBuckets = new Map<number, CanvasNode[]>();
    componentNodes.forEach((node) => {
      const layer = layers.get(node.id) ?? 0;
      if (!layerBuckets.has(layer)) layerBuckets.set(layer, []);
      layerBuckets.get(layer)!.push(node);
    });

    const maxLayer = Math.max(...Array.from(layerBuckets.keys()));

    // 重心启发式排序，减少连线交叉
    for (let l = 1; l <= maxLayer; l++) {
      const bucket = layerBuckets.get(l) ?? [];
      bucket.sort((a, b) => {
        const parentsA = inEdges.get(a.id) ?? [];
        const parentsB = inEdges.get(b.id) ?? [];
        const avgYA = parentsA.length > 0
          ? parentsA.reduce((sum, pid) => sum + (targetNodes.find((n) => n.id === pid)?.position.y ?? 0), 0) / parentsA.length
          : a.position.y;
        const avgYB = parentsB.length > 0
          ? parentsB.reduce((sum, pid) => sum + (targetNodes.find((n) => n.id === pid)?.position.y ?? 0), 0) / parentsB.length
          : b.position.y;
        return avgYA - avgYB;
      });
    }

    // 计算各列的宽度与全局 X 位置
    const colWidths: number[] = [];
    for (let l = 0; l <= maxLayer; l++) {
      const bucket = layerBuckets.get(l) ?? [];
      const maxWidth = bucket.reduce((max, n) => Math.max(max, getNodeDimensions(n).width), DEFAULT_NODE_WIDTH);
      colWidths[l] = maxWidth;
    }

    // 纵向定位：按父节点重心（barycenter）对齐，而不是各列独立居中。
    // 这样生成结果会贴着它的生成节点排开，而不是飘到列的中间。
    const nodeYById = new Map<string, number>();
    for (let l = 0; l <= maxLayer; l++) {
      const bucket = layerBuckets.get(l) ?? [];
      const targetY = (node: CanvasNode): number => {
        const parents = inEdges.get(node.id) ?? [];
        let sum = 0;
        let count = 0;
        for (const parentId of parents) {
          const parentY = nodeYById.get(parentId);
          if (parentY !== undefined) {
            sum += parentY;
            count += 1;
          }
        }
        return count > 0 ? sum / count : currentTopY;
      };
      // 同层内按目标 Y 排序（避免连线交叉），再顺序放置并保证不重叠。
      const ordered = [...bucket].sort((a, b) => targetY(a) - targetY(b));
      let cursor = -Infinity;
      for (const node of ordered) {
        const y = Math.max(targetY(node), cursor);
        nodeYById.set(node.id, y);
        cursor = y + getNodeDimensions(node).height + gapY;
      }
    }

    // 归一化：让本分量的最高节点落在 currentTopY，并据此推进下一个分量的起点。
    const componentYs = componentNodes.map((node) => nodeYById.get(node.id) ?? currentTopY);
    const componentMinY = Math.min(...componentYs);
    const shift = currentTopY - componentMinY;
    const componentBottom = Math.max(
      ...componentNodes.map((node) => (nodeYById.get(node.id) ?? currentTopY) + getNodeDimensions(node).height),
    );

    let currentX = origin.x;
    for (let l = 0; l <= maxLayer; l++) {
      const bucket = layerBuckets.get(l) ?? [];
      bucket.forEach((node) => {
        results.push({
          nodeId: node.id,
          position: { x: currentX, y: Math.round((nodeYById.get(node.id) ?? currentTopY) + shift) },
        });
      });
      currentX += (colWidths[l] ?? DEFAULT_NODE_WIDTH) + gapX;
    }

    currentTopY = componentBottom + shift + gapY * 2;
  });

  // 3. 处理无连线独立节点（按 3 列网格平铺在下方）
  if (isolatedNodes.length > 0) {
    isolatedNodes.sort((a, b) => a.position.x - b.position.x);
    const cols = Math.min(3, isolatedNodes.length);
    let curX = origin.x;
    let curY = currentTopY + 20;
    let maxRowH = 0;

    isolatedNodes.forEach((node, idx) => {
      const dim = getNodeDimensions(node);
      results.push({
        nodeId: node.id,
        position: { x: curX, y: Math.round(curY) },
      });
      maxRowH = Math.max(maxRowH, dim.height);

      if ((idx + 1) % cols === 0) {
        curX = origin.x;
        curY += maxRowH + gapY;
        maxRowH = 0;
      } else {
        curX += dim.width + gapX;
      }
    });
  }

  return results;
}

/**
 * 2. 按素材类型分类整理 (Organize by Material / Functional Type)
 * 按照：文本提示词 -> 图像素材 -> 视频素材 -> 3D导演台 -> 其它类型分列归类
 */
export function organizeByMaterial(
  allNodes: CanvasNode[],
  options: LayoutOptions = {},
): NodeLayoutPosition[] {
  const targetNodes = resolveTargetNodes(allNodes, options.activeNodeIds);
  if (targetNodes.length <= 1) {
    return targetNodes.map((n) => ({ nodeId: n.id, position: { ...n.position } }));
  }

  const origin = options.origin ?? computeBoundingOrigin(targetNodes);
  const gapX = options.gapX ?? 80;
  const gapY = options.gapY ?? 40;

  // 类别映射
  const CATEGORY_ORDER: Array<{ key: string; types: CanvasNodeType[] }> = [
    {
      key: 'text',
      types: [
        CANVAS_NODE_TYPES.aiText,
        CANVAS_NODE_TYPES.tagGroup,
        CANVAS_NODE_TYPES.tag,
        CANVAS_NODE_TYPES.textAnnotation,
        CANVAS_NODE_TYPES.jsonCard,
      ],
    },
    {
      key: 'image',
      types: [
        CANVAS_NODE_TYPES.imageEdit,
        CANVAS_NODE_TYPES.exportImage,
        CANVAS_NODE_TYPES.upload,
      ],
    },
    {
      key: 'video',
      types: [
        CANVAS_NODE_TYPES.aiVideo,
        CANVAS_NODE_TYPES.video,
      ],
    },
    {
      key: 'audio',
      types: [
        CANVAS_NODE_TYPES.aiAudio,
        CANVAS_NODE_TYPES.audio,
      ],
    },
    {
      key: 'director',
      types: [
        CANVAS_NODE_TYPES.blueprint,
        CANVAS_NODE_TYPES.panorama,
      ],
    },
    {
      key: 'storyboard',
      types: [
        CANVAS_NODE_TYPES.storyboardSplit,
        CANVAS_NODE_TYPES.storyboardGen,
      ],
    },
  ];

  const buckets: CanvasNode[][] = [];
  const assigned = new Set<string>();

  CATEGORY_ORDER.forEach(({ types }) => {
    const typeSet = new Set<string>(types);
    const matched = targetNodes.filter((n) => typeSet.has(n.type));
    if (matched.length > 0) {
      matched.forEach((n) => assigned.add(n.id));
      buckets.push(matched);
    }
  });

  const others = targetNodes.filter((n) => !assigned.has(n.id));
  if (others.length > 0) {
    buckets.push(others);
  }

  const results: NodeLayoutPosition[] = [];
  let currentX = origin.x;

  buckets.forEach((bucketNodes) => {
    // 组内根据原始 Y 排序
    bucketNodes.sort((a, b) => a.position.y - b.position.y);
    const maxWidth = bucketNodes.reduce((max, n) => Math.max(max, getNodeDimensions(n).width), DEFAULT_NODE_WIDTH);

    // 如果一个分类内节点过多 (>= 5 个)，排成 2 列
    const cols = bucketNodes.length >= 6 ? 2 : 1;
    let nodeY = origin.y;
    let colRowH = 0;

    bucketNodes.forEach((node, index) => {
      const colIndex = index % cols;
      const dim = getNodeDimensions(node);
      const posX = currentX + colIndex * (DEFAULT_NODE_WIDTH + 40);

      results.push({
        nodeId: node.id,
        position: { x: posX, y: Math.round(nodeY) },
      });

      colRowH = Math.max(colRowH, dim.height);

      if (cols === 1 || colIndex === cols - 1 || index === bucketNodes.length - 1) {
        nodeY += colRowH + gapY;
        colRowH = 0;
      }
    });

    currentX += (cols > 1 ? (DEFAULT_NODE_WIDTH + 40) * cols : maxWidth) + gapX;
  });

  return results;
}

/**
 * 3. 布局整理 (Layout Direction: horizontal | vertical | grid)
 */
export function organizeByDirection(
  allNodes: CanvasNode[],
  direction: 'horizontal' | 'vertical' | 'grid',
  options: LayoutOptions = {},
): NodeLayoutPosition[] {
  const targetNodes = resolveTargetNodes(allNodes, options.activeNodeIds);
  if (targetNodes.length <= 1) {
    return targetNodes.map((n) => ({ nodeId: n.id, position: { ...n.position } }));
  }

  const origin = options.origin ?? computeBoundingOrigin(targetNodes);
  const gapX = options.gapX ?? 48;
  const gapY = options.gapY ?? 48;
  const results: NodeLayoutPosition[] = [];

  if (direction === 'horizontal') {
    const sorted = [...targetNodes].sort((a, b) => a.position.x - b.position.x);
    let curX = origin.x;
    sorted.forEach((node) => {
      results.push({
        nodeId: node.id,
        position: { x: curX, y: origin.y },
      });
      curX += getNodeDimensions(node).width + gapX;
    });
  } else if (direction === 'vertical') {
    const sorted = [...targetNodes].sort((a, b) => a.position.y - b.position.y);
    let curY = origin.y;
    sorted.forEach((node) => {
      results.push({
        nodeId: node.id,
        position: { x: origin.x, y: curY },
      });
      curY += getNodeDimensions(node).height + gapY;
    });
  } else {
    // grid 布局
    const sorted = [...targetNodes].sort((a, b) => {
      if (Math.abs(a.position.y - b.position.y) > 60) return a.position.y - b.position.y;
      return a.position.x - b.position.x;
    });
    const cols = Math.max(2, Math.ceil(Math.sqrt(sorted.length)));
    const rowCount = Math.ceil(sorted.length / cols);
    // 用每列的“该列最大节点宽”预先定列宽，而不是逐个用当前节点宽度推进。
    // 否则未测量的节点（回退到默认 320 宽）会让实际更宽的卡片互相重叠。
    const colWidths: number[] = [];
    const rowHeights: number[] = [];
    sorted.forEach((node, index) => {
      const dim = getNodeDimensions(node);
      const col = index % cols;
      const row = Math.floor(index / cols);
      colWidths[col] = Math.max(colWidths[col] ?? 0, dim.width);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, dim.height);
    });
    const colX: number[] = [];
    let accX = origin.x;
    for (let c = 0; c < cols; c += 1) {
      colX[c] = accX;
      accX += (colWidths[c] ?? DEFAULT_NODE_WIDTH) + gapX;
    }
    const rowY: number[] = [];
    let accY = origin.y;
    for (let r = 0; r < rowCount; r += 1) {
      rowY[r] = accY;
      accY += (rowHeights[r] ?? DEFAULT_NODE_HEIGHT) + gapY;
    }

    sorted.forEach((node, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      results.push({
        nodeId: node.id,
        position: { x: colX[col], y: rowY[row] },
      });
    });
  }

  return results;
}
