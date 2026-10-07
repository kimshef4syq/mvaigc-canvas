import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Loader2, Plug } from 'lucide-react';

import { useSettingsStore } from '@/stores/settingsStore';
import { useCustomProvidersStore } from '@/stores/customProvidersStore';
import { applyMvaigcProviders } from '@/features/canvas/application/mvaigcProviderAutoConfig';
import {
  DEFAULT_MVAIGC_PORT,
  isMvaigcCredentialsComplete,
  normalizeMvaigcPort,
} from '@/features/settings/mvaigcSettings';

/**
 * Settings panel for the built-in mvaigc reverse proxy. The user only fills
 * account + password (port optional); on save OSC stores the credentials,
 * starts/reloads the proxy, and auto-registers the image/video providers.
 */
export function MvaigcSection() {
  const { t } = useTranslation();
  const account = useSettingsStore((s) => s.mvaigcAccount);
  const password = useSettingsStore((s) => s.mvaigcPassword);
  const port = useSettingsStore((s) => s.mvaigcPort);
  const setMvaigcCredentials = useSettingsStore((s) => s.setMvaigcCredentials);
  const providers = useCustomProvidersStore((s) => s.providers);
  const addProvider = useCustomProvidersStore((s) => s.addProvider);
  const updateProvider = useCustomProvidersStore((s) => s.updateProvider);

  const [accountDraft, setAccountDraft] = useState(account);
  const [passwordDraft, setPasswordDraft] = useState(password);
  const [portDraft, setPortDraft] = useState(String(port || DEFAULT_MVAIGC_PORT));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSave = useCallback(async () => {
    setError('');
    setSaved(false);
    if (!isMvaigcCredentialsComplete(accountDraft, passwordDraft)) {
      setError('请填写账号和密码');
      return;
    }
    const normalizedPort = normalizeMvaigcPort(portDraft);
    setSaving(true);
    try {
      const credentials = `${accountDraft.trim()}:${passwordDraft.trim()}`;
      setMvaigcCredentials(accountDraft.trim(), passwordDraft.trim(), normalizedPort);
      await invoke('mvaigc_set_credentials', {
        account: accountDraft.trim(),
        password: passwordDraft.trim(),
        port: normalizedPort,
      });
      applyMvaigcProviders(normalizedPort, credentials, {
        addProvider,
        updateProvider,
        hasProvider: (id) => providers.some((p) => p.id === id),
      });
      setPortDraft(String(normalizedPort));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [accountDraft, passwordDraft, portDraft, setMvaigcCredentials, addProvider, updateProvider, providers]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-text-dark">
          {t('settings.mvaigc.title')}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          填写 mvaigc 账号密码即可使用其图片与视频生成。地址、路径、轮询规则由 OSC 自动配置。
        </p>
      </div>

      <div className="rounded-lg border border-border-dark bg-bg-dark p-4 space-y-3">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-text-muted">账号</span>
          <input
            aria-label="账号"
            value={accountDraft}
            onChange={(e) => setAccountDraft(e.target.value)}
            placeholder="mvaigc 账号"
            className="rounded-md border border-border-dark bg-surface-dark px-2 py-1 text-text-dark outline-none focus:border-accent/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-text-muted">密码</span>
          <input
            aria-label="密码"
            type="password"
            value={passwordDraft}
            onChange={(e) => setPasswordDraft(e.target.value)}
            placeholder="mvaigc 密码"
            className="rounded-md border border-border-dark bg-surface-dark px-2 py-1 text-text-dark outline-none focus:border-accent/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-text-muted">
            本地端口 <span className="text-text-muted/60">（可选，默认 {DEFAULT_MVAIGC_PORT}）</span>
          </span>
          <input
            aria-label="端口"
            value={portDraft}
            onChange={(e) => setPortDraft(e.target.value)}
            placeholder={String(DEFAULT_MVAIGC_PORT)}
            className="w-32 rounded-md border border-border-dark bg-surface-dark px-2 py-1 font-mono text-text-dark outline-none focus:border-accent/50"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs text-black hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
            {saving ? '保存中' : '保存'}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> 已保存，图片/视频供应商已配置
            </span>
          )}
        </div>
        {error && <div className="text-[11px] text-red-400">{error}</div>}
      </div>
    </div>
  );
}
