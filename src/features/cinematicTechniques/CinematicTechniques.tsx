import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clapperboard, Copy, Search } from 'lucide-react';
import { UiButton, UiChipButton, UiInput } from '@/components/ui';
import {
  CINEMATIC_CATEGORIES,
  CINEMATIC_TECHNIQUE_COUNT,
  filterCinematicCategories,
  type CinematicCategory,
  type CinematicTechnique,
} from './cinematicTechniquesData';

const INITIAL_VISIBLE_TECHNIQUE_COUNT = 80;
const VISIBLE_TECHNIQUE_BATCH_SIZE = 48;

function TechniqueCard({ technique }: { technique: CinematicTechnique }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [copied, setCopied] = useState(false);

  const canPreviewVideo = Boolean(technique.video);

  useEffect(() => {
    if (!previewing) {
      return;
    }
    void videoRef.current?.play().catch(() => undefined);
  }, [previewing]);

  const handleCopy = useCallback(async () => {
    if (!technique.prompt) {
      return;
    }
    try {
      await navigator.clipboard.writeText(technique.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默失败
    }
  }, [technique.prompt]);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border border-border-dark bg-surface-dark/92"
      onMouseEnter={() => {
        if (canPreviewVideo) {
          setPreviewing(true);
        }
      }}
      onMouseLeave={() => setPreviewing(false)}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black/40">
        {previewing && technique.video ? (
          <video
            ref={videoRef}
            src={technique.video}
            poster={technique.poster}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
            className="h-full w-full object-cover"
          />
        ) : (
          <img
            src={technique.poster}
            alt={technique.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="text-sm font-semibold text-text-dark">{technique.name}</div>
        {technique.prompt ? (
          <>
            <p className="line-clamp-6 text-xs leading-5 text-text-muted" title={technique.prompt}>
              {technique.prompt}
            </p>
            <UiButton
              type="button"
              variant="muted"
              size="sm"
              onClick={handleCopy}
              className="mt-auto gap-2"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('cinematicTechniques.copied') : t('cinematicTechniques.copyPrompt')}
            </UiButton>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface VisibleGroup {
  category: CinematicCategory;
  items: CinematicTechnique[];
}

export function CinematicTechniques() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TECHNIQUE_COUNT);

  const categoryTotals = useMemo(
    () => new Map(CINEMATIC_CATEGORIES.map((category) => [category.id, category.items.length])),
    []
  );

  const filteredCategories = useMemo(
    () => filterCinematicCategories(CINEMATIC_CATEGORIES, query, activeCategoryId),
    [query, activeCategoryId]
  );

  // 按分类原顺序拍平，再按 visibleCount 截断、重新分组——保留分类小标题，同时分批渲染。
  const flatEntries = useMemo(
    () => filteredCategories.flatMap((category) => category.items.map((technique) => ({ category, technique }))),
    [filteredCategories]
  );

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_TECHNIQUE_COUNT);
  }, [query, activeCategoryId]);

  const groups = useMemo<VisibleGroup[]>(() => {
    const byCategory = new Map<string, VisibleGroup>();
    for (const { category, technique } of flatEntries.slice(0, visibleCount)) {
      let group = byCategory.get(category.id);
      if (!group) {
        group = { category, items: [] };
        byCategory.set(category.id, group);
      }
      group.items.push(technique);
    }
    return [...byCategory.values()];
  }, [flatEntries, visibleCount]);

  const hasMore = visibleCount < flatEntries.length;

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMore) {
        return;
      }
      const target = event.currentTarget;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 420) {
        setVisibleCount((current) => Math.min(current + VISIBLE_TECHNIQUE_BATCH_SIZE, flatEntries.length));
      }
    },
    [hasMore, flatEntries.length]
  );

  return (
    <div className="ui-scrollbar h-full overflow-y-auto" onScroll={handleScroll}>
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <div className="mb-6 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-border-dark bg-surface-dark/90 px-3 py-1.5 text-xs font-medium text-text-muted">
            <Clapperboard className="h-4 w-4 text-accent" />
            {t('cinematicTechniques.badge', { count: CINEMATIC_TECHNIQUE_COUNT })}
          </div>
          <h1 className="text-3xl font-bold text-text-dark">{t('cinematicTechniques.title')}</h1>
          <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-text-muted">
            {t('cinematicTechniques.description')}
          </p>
        </div>

        <div className="mb-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <UiInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('cinematicTechniques.searchPlaceholder')}
              className="h-11 pl-9"
            />
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <UiChipButton
            type="button"
            active={activeCategoryId === null}
            onClick={() => setActiveCategoryId(null)}
            className="h-8 text-xs"
          >
            {t('cinematicTechniques.allCategories')}
          </UiChipButton>
          {CINEMATIC_CATEGORIES.map((category) => (
            <UiChipButton
              key={category.id}
              type="button"
              active={activeCategoryId === category.id}
              onClick={() => setActiveCategoryId(category.id)}
              className="h-8 text-xs"
            >
              {category.name}
            </UiChipButton>
          ))}
        </div>

        {groups.length === 0 ? (
          <div className="rounded-lg border border-border-dark bg-surface-dark/92 py-16 text-center text-sm text-text-muted">
            {t('cinematicTechniques.noResults')}
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {groups.map(({ category, items }) => (
              <section key={category.id}>
                <div className="mb-3 flex items-baseline gap-2">
                  <h2 className="text-lg font-semibold text-text-dark">{category.name}</h2>
                  <span className="text-xs text-text-muted">{categoryTotals.get(category.id) ?? items.length}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {items.map((technique) => (
                    <TechniqueCard key={technique.id} technique={technique} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
