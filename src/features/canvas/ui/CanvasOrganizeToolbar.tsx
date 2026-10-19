import { CanvasSettingsButton } from './CanvasSettingsButton';
import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  HelpCircle,
  Grid3X3,
  Magnet,
  Map,
  Spline,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyStart,
  LayoutGrid,
} from 'lucide-react';

import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_COMMAND_VERSION } from '@/features/canvas/domain/canvasCommands';
import { canvasCommandRegistry } from '@/features/canvas/application/canvasCommandService';
import {
  organizeByConnection,
  organizeByMaterial,
  organizeByDirection,
} from '@/features/canvas/application/canvasLayoutService';

interface CanvasOrganizeToolbarProps {
  showGrid: boolean;
  onToggleGrid: () => void;
  isSnapEnabled: boolean;
  onToggleSnap: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
  edgeRoutingType?: 'bezier' | 'smoothstep' | 'spline' | 'orthogonal';
  onToggleEdgeRouting?: () => void;
  selectedNodeIds?: string[];
}

/**
 * 整理图标 (顶两小格，底一长格，严格还原截图布局图标)
 */
function OrganizeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3.5" width="7.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="3.5" width="7.5" height="6.5" rx="1.5" />
      <rect x="3" y="14" width="18" height="6.5" rx="1.5" />
    </svg>
  );
}

/**
 * 分类图标 (三角、圆、方块构成的三元分类图元)
 */
function ShapesCategoryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 7 11 17 11 12 2" />
      <circle cx="6.5" cy="17.5" r="3.5" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

/**
 * 连线关系图标 (两相连节点)
 */
function ConnectionNodesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="14.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <path d="M9.5 7.25h2.5a3 3 0 0 1 3 3v3.25" />
    </svg>
  );
}

/**
 * 素材类型图标 (素材层叠列柱)
 */
function MaterialStackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4.5" y1="20" x2="4.5" y2="10" />
      <line x1="9.5" y1="20" x2="9.5" y2="4" />
      <line x1="14.5" y1="20" x2="14.5" y2="13" />
      <line x1="19.5" y1="20" x2="19.5" y2="7" />
    </svg>
  );
}

export const CanvasOrganizeToolbar = memo(({
  showGrid,
  onToggleGrid,
  isSnapEnabled,
  onToggleSnap,
  showMiniMap,
  onToggleMiniMap,
  edgeRoutingType = 'bezier',
  onToggleEdgeRouting,
  selectedNodeIds = [],
}: CanvasOrganizeToolbarProps) => {
  const { t } = useTranslation();
  const reactFlow = useReactFlow();
  const { zoom } = useViewport();
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'category' | 'layout' | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 点击外部自动关闭
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setActiveSubmenu(null);
      }
    };
    window.addEventListener('mousedown', handleClickOutside, true);
    return () => window.removeEventListener('mousedown', handleClickOutside, true);
  }, [isMenuOpen]);

  const applyPositions = useCallback(async (positions: Array<{ nodeId: string; position: { x: number; y: number } }>) => {
    if (positions.length === 0) return;
    setIsMenuOpen(false);
    setActiveSubmenu(null);

    await canvasCommandRegistry.execute({
      type: 'node.move',
      version: CANVAS_COMMAND_VERSION,
      input: { positions },
    }, 'ui');

    // 优雅平滑自适应视角
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.16, duration: 400 });
    }, 60);
  }, [reactFlow]);

  const handleOrganizeByConnection = useCallback(() => {
    const activeIds = selectedNodeIds.length >= 2 ? selectedNodeIds : undefined;
    const positions = organizeByConnection(nodes, edges, { activeNodeIds: activeIds });
    applyPositions(positions);
  }, [applyPositions, edges, nodes, selectedNodeIds]);

  const handleOrganizeByMaterial = useCallback(() => {
    const activeIds = selectedNodeIds.length >= 2 ? selectedNodeIds : undefined;
    const positions = organizeByMaterial(nodes, { activeNodeIds: activeIds });
    applyPositions(positions);
  }, [applyPositions, nodes, selectedNodeIds]);

  const handleOrganizeByDirection = useCallback((direction: 'horizontal' | 'vertical' | 'grid') => {
    const activeIds = selectedNodeIds.length >= 2 ? selectedNodeIds : undefined;
    const positions = organizeByDirection(nodes, direction, { activeNodeIds: activeIds });
    applyPositions(positions);
  }, [applyPositions, nodes, selectedNodeIds]);

  const handleZoomReset = useCallback(() => {
    reactFlow.zoomTo(1, { duration: 300 });
  }, [reactFlow]);

  const zoomPercent = `${Math.round(zoom * 100)}%`;
  const isSelectedMode = selectedNodeIds.length >= 2;

  return (
    <div
      ref={menuRef}
      data-canvas-no-marquee="true"
      className="absolute left-4 top-4 z-[12010] flex select-none items-center gap-1.5 rounded-xl border border-white/10 bg-[#1a1a1e]/90 px-2 py-1.5 text-xs text-text-muted shadow-2xl backdrop-blur-md transition-all"
    >
      {/* 缩放比例 */}
      <button
        type="button"
        onClick={handleZoomReset}
        title={t('canvasOrganize.zoomReset')}
        className="rounded-md px-1.5 py-1 font-mono text-[11px] font-medium text-text-dark/90 transition-colors hover:bg-white/10 hover:text-white"
      >
        {zoomPercent}
      </button>

      {/* 分隔线 */}
      <div className="h-4 w-px bg-white/15 mx-0.5" />

      <CanvasSettingsButton />

      {/* 整理主按钮 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setIsMenuOpen((prev) => !prev);
            setActiveSubmenu('category');
          }}
          title={isSelectedMode ? t('canvasOrganize.selectionCount', { count: selectedNodeIds.length }) : t('canvasOrganize.allCount', { count: nodes.length })}
          className={`relative flex items-center justify-center rounded-lg p-1.5 transition-colors ${
            isMenuOpen
              ? 'bg-white/20 text-white shadow-inner'
              : 'text-text-muted hover:bg-white/10 hover:text-white'
          }`}
        >
          <OrganizeIcon className="h-4 w-4" />
        </button>

        {/* 整理下拉二级级联菜单 */}
        {isMenuOpen && (
          <div
            className="absolute left-0 top-full mt-2 flex z-50 text-xs"
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            {/* 一级菜单：分类整理 / 布局整理 */}
            <div className="w-36 rounded-xl border border-white/10 bg-[#1e1e22]/98 p-1.5 shadow-2xl backdrop-blur-xl">
              <button
                type="button"
                onMouseEnter={() => setActiveSubmenu('category')}
                onClick={() => setActiveSubmenu('category')}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 transition-colors ${
                  activeSubmenu === 'category'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-text-dark/90 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShapesCategoryIcon className="h-4 w-4 text-accent" />
                  <span>{t('canvasOrganize.category')}</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </button>

              <button
                type="button"
                onMouseEnter={() => setActiveSubmenu('layout')}
                onClick={() => setActiveSubmenu('layout')}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 mt-0.5 transition-colors ${
                  activeSubmenu === 'layout'
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-text-dark/90 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-blue-400" />
                  <span>{t('canvasOrganize.layout')}</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </button>
            </div>

            {/* 二级子菜单：分类整理 */}
            {activeSubmenu === 'category' && (
              <div className="ml-1.5 w-44 rounded-xl border border-white/10 bg-[#1e1e22]/98 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={handleOrganizeByConnection}
                  className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-text-dark/90 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <ConnectionNodesIcon className="h-4 w-4 text-accent" />
                    <span>{t('canvasOrganize.byConnection')}</span>
                  </div>
                  <span
                    className="p-0.5 text-text-muted hover:text-white"
                    title={t('canvasOrganize.byConnectionTip')}
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleOrganizeByMaterial}
                  className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 mt-0.5 text-text-dark/90 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <MaterialStackIcon className="h-4 w-4 text-emerald-400" />
                    <span>{t('canvasOrganize.byMaterial')}</span>
                  </div>
                  <span
                    className="p-0.5 text-text-muted hover:text-white"
                    title={t('canvasOrganize.byMaterialTip')}
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </span>
                </button>
              </div>
            )}

            {/* 二级子菜单：布局整理 */}
            {activeSubmenu === 'layout' && (
              <div className="ml-1.5 w-40 rounded-xl border border-white/10 bg-[#1e1e22]/98 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={() => handleOrganizeByDirection('horizontal')}
                  className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-text-dark/90 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <AlignHorizontalJustifyStart className="h-4 w-4 text-sky-400" />
                    <span>{t('canvasOrganize.horizontal')}</span>
                  </div>
                  <span className="p-0.5 text-text-muted hover:text-white" title={t('canvasOrganize.horizontalTip')}>
                    <HelpCircle className="h-3.5 w-3.5" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOrganizeByDirection('vertical')}
                  className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 mt-0.5 text-text-dark/90 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <AlignVerticalJustifyStart className="h-4 w-4 text-indigo-400" />
                    <span>{t('canvasOrganize.vertical')}</span>
                  </div>
                  <span className="p-0.5 text-text-muted hover:text-white" title={t('canvasOrganize.verticalTip')}>
                    <HelpCircle className="h-3.5 w-3.5" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOrganizeByDirection('grid')}
                  className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 mt-0.5 text-text-dark/90 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-amber-400" />
                    <span>{t('canvasOrganize.grid')}</span>
                  </div>
                  <span className="p-0.5 text-text-muted hover:text-white" title={t('canvasOrganize.gridTip')}>
                    <HelpCircle className="h-3.5 w-3.5" />
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 网格切换 */}
      <button
        type="button"
        onClick={onToggleGrid}
        title={t('canvasOrganize.gridToggle')}
        className={`rounded-lg p-1.5 transition-colors ${
          showGrid
            ? 'bg-white/15 text-white'
            : 'text-text-muted hover:bg-white/10 hover:text-white'
        }`}
      >
        <Grid3X3 className="h-4 w-4" />
      </button>

      {/* 连线样式切换 */}
      {onToggleEdgeRouting && (
        <button
          type="button"
          onClick={onToggleEdgeRouting}
          title={t('canvasOrganize.edgeToggle')}
          className={`rounded-lg p-1.5 transition-colors ${
            edgeRoutingType === 'orthogonal' || edgeRoutingType === 'smoothstep'
              ? 'bg-white/15 text-white'
              : 'text-text-muted hover:bg-white/10 hover:text-white'
          }`}
        >
          <Spline className="h-4 w-4" />
        </button>
      )}

      {/* 磁吸对齐切换 */}
      <button
        type="button"
        onClick={onToggleSnap}
        title={t('canvasOrganize.snapToggle')}
        className={`rounded-lg p-1.5 transition-colors ${
          isSnapEnabled
            ? 'bg-accent/25 text-accent'
            : 'text-text-muted hover:bg-white/10 hover:text-white'
        }`}
      >
        <Magnet className="h-4 w-4" />
      </button>

      {/* 小地图切换 */}
      <button
        type="button"
        onClick={onToggleMiniMap}
        title={t('canvasOrganize.minimap')}
        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${
          showMiniMap
            ? 'bg-white/15 text-white font-medium'
            : 'text-text-muted hover:bg-white/10 hover:text-white'
        }`}
      >
        <Map className="h-3.5 w-3.5" />
        <span>{t('canvasOrganize.minimap')}</span>
      </button>
    </div>
  );
});

CanvasOrganizeToolbar.displayName = 'CanvasOrganizeToolbar';
