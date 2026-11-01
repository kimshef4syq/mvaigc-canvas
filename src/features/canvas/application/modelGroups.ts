/** The vendor fields a catalog entry may carry. */
export interface BrandedModel {
  brand?: string;
  brandOrder?: number;
  brandTag?: string;
}

export interface ModelBrandGroup<T> {
  brand: string;
  /** Badge of the group, taken from its first tagged model. */
  tag?: string;
  models: T[];
}

/**
 * Group catalog entries by the vendor they declare. Returns `null` when no
 * entry declares a vendor, so callers keep rendering their flat model list.
 * Groups are sorted by `brandOrder`; models keep the order they arrived in.
 */
export function groupModelsByBrand<T extends BrandedModel>(
  models: readonly T[],
): ModelBrandGroup<T>[] | null {
  if (!models.some((model) => model.brand)) {
    return null;
  }

  const groups: ModelBrandGroup<T>[] = [];
  const byBrand = new Map<string, ModelBrandGroup<T>>();
  models.forEach((model) => {
    const brand = model.brand?.trim();
    if (!brand) return;
    let group = byBrand.get(brand);
    if (!group) {
      group = { brand, models: [] };
      byBrand.set(brand, group);
      groups.push(group);
    }
    group.models.push(model);
    if (!group.tag && model.brandTag) {
      group.tag = model.brandTag;
    }
  });

  const orderOf = (group: ModelBrandGroup<T>): number => {
    const declared = group.models[0]?.brandOrder;
    return typeof declared === 'number' && Number.isFinite(declared) ? declared : 0;
  };
  return groups.sort((a, b) => orderOf(a) - orderOf(b));
}
