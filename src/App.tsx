import { lazy, Suspense, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { TitleBar } from './components/TitleBar';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { UpdateAvailableDialog, type UpdateIgnoreMode } from './components/UpdateAvailableDialog';
import { GlobalErrorDialog } from './components/GlobalErrorDialog';
import { ProjectHome } from './features/project/ProjectHome';
import { LaunchIntro } from './features/app/LaunchIntro';
import { useThemeStore } from './stores/themeStore';
import { useProjectStore } from './stores/projectStore';
import { useSettingsStore } from './stores/settingsStore';
import { useCustomProvidersStore } from './stores/customProvidersStore';
import { syncMvaigcProvidersFromSettings } from './features/canvas/application/mvaigcProviderAutoConfig';
import {
  checkForUpdate,
  isUpdateVersionSuppressed,
  suppressUpdateVersion,
} from './features/update/application/checkForUpdate';
import {
  subscribeOpenGlobalErrorDialog,
  type GlobalErrorDialogDetail,
} from './features/app/errorDialogEvents';
import {
  subscribeOpenSettingsDialog,
  type SettingsCategory,
} from './features/settings/settingsEvents';
import { subscribeWebProjectStorageStatus } from './commands/projectState';

const CanvasWorkspace = lazy(() =>
  import('./features/canvas/CanvasWorkspace').then((module) => ({
    default: module.CanvasWorkspace,
  })),
);
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((module) => ({
    default: module.SettingsDialog,
  })),
);

function toRgbCssValue(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return '59 130 246';
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function App() {
  const { t } = useTranslation();
  const { theme, skin } = useThemeStore();
  const uiRadiusPreset = useSettingsStore((state) => state.uiRadiusPreset);
  const themeTonePreset = useSettingsStore((state) => state.themeTonePreset);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const autoCheckAppUpdateOnLaunch = useSettingsStore((state) => state.autoCheckAppUpdateOnLaunch);
  const enableUpdateDialog = useSettingsStore((state) => state.enableUpdateDialog);
  const setEnableUpdateDialog = useSettingsStore((state) => state.setEnableUpdateDialog);
  const [showLaunchIntro, setShowLaunchIntro] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<SettingsCategory>('general');
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [globalError, setGlobalError] = useState<GlobalErrorDialogDetail | null>(null);
  const [showWebStorageFallback, setShowWebStorageFallback] = useState(false);

  const isHydrated = useProjectStore((state) => state.isHydrated);
  const hydrate = useProjectStore((state) => state.hydrate);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const closeProject = useProjectStore((state) => state.closeProject);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.skin = skin || 'warm-amber';
  }, [skin]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.uiRadius = uiRadiusPreset;
  }, [uiRadiusPreset]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.themeTone = themeTonePreset;
  }, [themeTonePreset]);

  useEffect(() => {
    const root = document.documentElement;
    const isMac =
      typeof navigator !== 'undefined'
      && /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`);
    root.dataset.platform = isMac ? 'macos' : 'default';
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const normalized = accentColor.startsWith('#') ? accentColor : `#${accentColor}`;
    root.style.setProperty('--accent', normalized);
    root.style.setProperty('--accent-rgb', toRgbCssValue(normalized));
  }, [accentColor]);

  useEffect(() => {
    return subscribeWebProjectStorageStatus((status) => {
      if (status.mode === 'memory') {
        setShowWebStorageFallback(true);
      }
    });
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Refresh the mvaigc providers from the stored credentials on launch, so a
  // catalogue update reaches users who configured mvaigc once and never reopen
  // the settings panel.
  useEffect(() => {
    const settings = useSettingsStore.getState();
    const providers = useCustomProvidersStore.getState();
    syncMvaigcProvidersFromSettings(
      {
        account: settings.mvaigcAccount,
        password: settings.mvaigcPassword,
        port: settings.mvaigcPort,
        tenantId: settings.mvaigcTenantId,
        tenantName: settings.mvaigcTenantName,
      },
      {
        addProvider: providers.addProvider,
        updateProvider: providers.updateProvider,
        hasProvider: (id) => useCustomProvidersStore.getState().providers.some((p) => p.id === id),
      },
    );
    if (settings.mvaigcAccount && settings.mvaigcPassword) {
      void invoke('mvaigc_set_credentials', {
        account: settings.mvaigcAccount,
        password: settings.mvaigcPassword,
        port: settings.mvaigcPort,
        tenantId: settings.mvaigcTenantId ?? null,
        tenantName: settings.mvaigcTenantName ?? null,
      }).catch((err) => {
        console.warn('Failed to sync mvaigc credentials on app launch:', err);
      });
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenGlobalErrorDialog((detail) => {
      setGlobalError(detail);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenSettingsDialog(({ category }) => {
      setSettingsInitialCategory(category ?? 'general');
      setHasOpenedSettings(true);
      setShowSettings(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;

    const notifyFrontendReady = async (attempt = 1) => {
      if (cancelled) {
        return;
      }

      try {
        await invoke('frontend_ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (attempt === 1 || attempt % 10 === 0) {
          console.warn('failed to notify frontend readiness', error);
        }

        const retryDelayMs = Math.min(500, 80 * attempt);
        retryTimer = window.setTimeout(() => {
          void notifyFrontendReady(attempt + 1);
        }, retryDelayMs);
      }
    };

    requestAnimationFrame(() => {
      void notifyFrontendReady();
    });

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || showLaunchIntro || !autoCheckAppUpdateOnLaunch || !isTauri()) {
      return;
    }

    let cancelled = false;
    let checking = false;
    const runUpdateCheck = async () => {
      if (checking) return;
      checking = true;
      const result = await checkForUpdate();
      checking = false;
      if (!cancelled && result.hasUpdate && result.latestVersion && enableUpdateDialog) {
        if (isUpdateVersionSuppressed(result.latestVersion)) {
          return;
        }
        setLatestVersion(result.latestVersion ?? '');
        setCurrentVersion(result.currentVersion ?? '');
        setShowUpdateDialog(true);
      }
    };

    void runUpdateCheck();
    const timer = window.setInterval(() => void runUpdateCheck(), 24 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isHydrated, showLaunchIntro, autoCheckAppUpdateOnLaunch, enableUpdateDialog]);

  const handleManualCheckUpdate = async (): Promise<'has-update' | 'up-to-date' | 'failed'> => {
    const result = await checkForUpdate();
    if (!result.hasUpdate) {
      return result.error ? 'failed' : 'up-to-date';
    }

    setLatestVersion(result.latestVersion ?? '');
    setCurrentVersion(result.currentVersion ?? '');

    setShowUpdateDialog(true);

    return 'has-update';
  };

  const handleApplyIgnore = (mode: UpdateIgnoreMode) => {
    if (mode === 'forever-all') {
      setEnableUpdateDialog(false);
      return;
    }

    if (!latestVersion) {
      return;
    }

    suppressUpdateVersion(latestVersion, mode === 'today-version' ? 'today' : 'forever');
  };


  return (
    <AppErrorBoundary>
      {showLaunchIntro && <LaunchIntro onComplete={() => setShowLaunchIntro(false)} />}
      {!isHydrated ? <div className="h-full w-full bg-bg-dark" /> : (
        <div className="w-full h-full flex flex-col bg-bg-dark" aria-hidden={showLaunchIntro || undefined} style={showLaunchIntro ? { visibility: 'hidden' } : undefined}>
          <TitleBar
            onSettingsClick={() => {
              setSettingsInitialCategory('general');
              setHasOpenedSettings(true);
              setShowSettings(true);
            }}
            showBackButton={!!currentProjectId}
            onBackClick={closeProject}
          />

          {showWebStorageFallback ? (
            <div
              role="status"
              className="flex shrink-0 items-center justify-between gap-4 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-text-dark"
            >
              <span>{t('project.webStorageFallback')}</span>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-text-muted transition-colors hover:bg-amber-400/10 hover:text-text-dark"
                onClick={() => setShowWebStorageFallback(false)}
              >
                {t('common.close')}
              </button>
            </div>
          ) : null}

          <main className="relative min-h-0 flex-1 overflow-hidden">
            {currentProjectId ? (
              <div
                key={`canvas-${currentProjectId}`}
                className="ui-workspace-enter relative h-full min-h-0 min-w-0 overflow-hidden"
              >
                <Suspense
                  fallback={(
                    <div
                      role="status"
                      className="flex h-full items-center justify-center gap-2 bg-bg-dark text-sm text-text-muted"
                    >
                      <span className="h-2 w-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
                      {t('common.loading')}
                    </div>
                  )}
                >
                  <CanvasWorkspace projectId={currentProjectId} />
                </Suspense>
              </div>
            ) : (
              <div key="project-home" className="ui-workspace-enter h-full min-h-0">
                <ProjectHome />
              </div>
            )}
          </main>

          {hasOpenedSettings ? (
            <Suspense
              fallback={showSettings ? (
                <div
                  role="status"
                  className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/45 text-sm text-white backdrop-blur-sm"
                >
                  {t('common.loading')}
                </div>
              ) : null}
            >
              <SettingsDialog
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                initialCategory={settingsInitialCategory}
                onCheckUpdate={handleManualCheckUpdate}
              />
            </Suspense>
          ) : null}
          <UpdateAvailableDialog
            isOpen={showUpdateDialog}
            onClose={() => setShowUpdateDialog(false)}
            latestVersion={latestVersion}
            currentVersion={currentVersion}
            onApplyIgnore={handleApplyIgnore}
          />
          <GlobalErrorDialog
            isOpen={Boolean(globalError)}
            title={globalError?.title ?? ''}
            message={globalError?.message ?? ''}
            details={globalError?.details}
            copyText={globalError?.copyText}
            onClose={() => setGlobalError(null)}
          />
        </div>
      )}
      </AppErrorBoundary>
  );
}

export default App;
