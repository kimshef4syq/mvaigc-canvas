import { ChevronRight, Check } from 'lucide-react';

import type { ModelBrandGroup } from '@/features/canvas/application/modelGroups';

/** Vendor badge copy, mirroring mvaigc.cn's own labels. */
const BRAND_TAG_LABELS: Record<string, string> = {
  Recommend: '荐',
  New: 'New',
  Sale: '限免',
};

interface BrandMenuModel {
  id: string;
  modelLabel: string;
  usable: boolean;
  notReadyReason?: string;
}

interface ModelBrandMenuProps<T extends BrandMenuModel> {
  groups: ModelBrandGroup<T>[];
  activeId: string | null;
  /** Vendor whose flyout is open; `null` shows only the vendor column. */
  openBrand: string | null;
  onOpenBrandChange: (brand: string | null) => void;
  onPick: (model: T) => void;
  /** Models the caller rules out in the current mode (e.g. a model that
   *  cannot run all-reference generation). Disabled but still listed. */
  isDisabled?: (model: T) => boolean;
  disabledReason?: (model: T) => string | undefined;
}

const rowCls =
  'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[13px] text-text-dark transition-colors hover:bg-[var(--canvas-node-menu-hover)]';
const brandChipCls =
  'rounded px-1 py-px text-[11px] leading-none';
const brandChipStyle = {
  Recommend: 'bg-violet-500/25 text-violet-300',
  New: 'bg-sky-500/25 text-sky-300',
  Sale: 'bg-emerald-500/25 text-emerald-300',
} as const;

function brandSlug(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function BrandTag({ tag }: { tag?: string }) {
  const label = tag ? BRAND_TAG_LABELS[tag] : undefined;
  if (!tag || !label) return null;
  const style = brandChipStyle[tag as keyof typeof brandChipStyle] ?? 'bg-white/10 text-text-muted';
  return <span className={`${brandChipCls} ${style}`}>{label}</span>;
}

/**
 * Two-level model menu: one row per vendor, with the vendor's models in a
 * flyout to the right. Shared by the image picker and the video node so both
 * read the same way mvaigc.cn's own picker does.
 */
export function ModelBrandMenu<T extends BrandMenuModel>({
  groups,
  activeId,
  openBrand,
  onOpenBrandChange,
  onPick,
  isDisabled,
  disabledReason,
}: ModelBrandMenuProps<T>) {
  return (
    <div className="relative">
      <div className="min-w-[140px]">
        {groups.map((group) => {
          const activeInGroup = group.models.some((model) => model.id === activeId);
          const open = openBrand === group.brand;
          return (
            // Each vendor row anchors its own flyout, so the submenu lines up
            // with the row the user is hovering rather than the list's bottom.
            <div key={group.brand} className="relative">
              <button
                type="button"
                data-testid={`model-brand-${brandSlug(group.brand)}`}
                className={`${rowCls} ${open ? 'bg-[var(--canvas-node-menu-hover)]' : ''}`}
                title={group.brand}
                onMouseEnter={() => onOpenBrandChange(group.brand)}
                onFocus={() => onOpenBrandChange(group.brand)}
                onClick={() => onOpenBrandChange(group.brand)}
              >
                <BrandTag tag={group.tag} />
                <span className="min-w-0 flex-1 truncate">{group.brand}</span>
                {activeInGroup && <Check className="h-3 w-3 shrink-0 text-accent" />}
                <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
              </button>

              {open && (
                <div
                  data-testid="model-brand-flyout"
                  className="ui-scrollbar nowheel absolute left-full top-0 ml-1 max-h-[240px] min-w-[180px] max-w-[240px] overflow-y-auto rounded-md border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-menu-bg)] p-1 shadow-2xl"
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseEnter={() => onOpenBrandChange(group.brand)}
                >
                  {group.models.map((model) => {
                    const disabled = isDisabled?.(model) ?? false;
                    const reason = disabled ? disabledReason?.(model) : undefined;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        data-active={model.id === activeId ? 'true' : undefined}
                        disabled={disabled || !model.usable}
                        title={reason ?? model.notReadyReason ?? model.modelLabel}
                        className={`${rowCls} disabled:cursor-not-allowed disabled:opacity-55 ${
                          model.id === activeId ? 'bg-[var(--canvas-node-menu-active)]' : ''
                        }`}
                        onClick={() => onPick(model)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{model.modelLabel}</span>
                          {reason && (
                            <span className="mt-0.5 block truncate text-[11px] text-amber-300/85">
                              {reason}
                            </span>
                          )}
                          {!reason && !model.usable && model.notReadyReason && (
                            <span className="mt-0.5 block truncate text-[11px] text-amber-300/85">
                              {model.notReadyReason}
                            </span>
                          )}
                        </span>
                        {model.id === activeId && <Check className="h-3 w-3 shrink-0 text-accent" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
