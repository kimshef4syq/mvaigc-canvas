import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Building2, CheckCircle2, Coins, Loader2, Plug, RefreshCw, Users } from 'lucide-react';

import { useSettingsStore } from '@/stores/settingsStore';
import { useCustomProvidersStore } from '@/stores/customProvidersStore';
import { applyMvaigcProviders } from '@/features/canvas/application/mvaigcProviderAutoConfig';
import {
  DEFAULT_MVAIGC_PORT,
  isMvaigcCredentialsComplete,
  normalizeMvaigcPort,
  type MvaigcFetchTeamsResult,
  type MvaigcTeam,
} from '@/features/settings/mvaigcSettings';

/**
 * Settings panel for the built-in mvaigc reverse proxy. The user fills
 * account + password (port optional), and selects which team space to use.
 * On save, the credentials and team context are stored, the proxy is reloaded,
 * and the image/video providers are auto-registered.
 */
export function MvaigcSection() {
  const { t } = useTranslation();
  const account = useSettingsStore((s) => s.mvaigcAccount);
  const password = useSettingsStore((s) => s.mvaigcPassword);
  const port = useSettingsStore((s) => s.mvaigcPort);
  const savedTenantId = useSettingsStore((s) => s.mvaigcTenantId);
  const savedTenantName = useSettingsStore((s) => s.mvaigcTenantName);
  const setMvaigcCredentials = useSettingsStore((s) => s.setMvaigcCredentials);
  const providers = useCustomProvidersStore((s) => s.providers);
  const addProvider = useCustomProvidersStore((s) => s.addProvider);
  const updateProvider = useCustomProvidersStore((s) => s.updateProvider);

  const [accountDraft, setAccountDraft] = useState(account);
  const [passwordDraft, setPasswordDraft] = useState(password);
  const [portDraft, setPortDraft] = useState(String(port || DEFAULT_MVAIGC_PORT));
  const [teams, setTeams] = useState<MvaigcTeam[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(savedTenantId ?? null);
  const [selectedTenantName, setSelectedTenantName] = useState<string>(savedTenantName ?? '');
  const [points, setPoints] = useState<number | null>(null);
  const [fetchingTeams, setFetchingTeams] = useState(false);
  const [teamFetchError, setTeamFetchError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleFetchTeams = useCallback(
    async (isSilent = false) => {
      if (!isMvaigcCredentialsComplete(accountDraft, passwordDraft)) {
        if (!isSilent) setTeamFetchError('请先填写账号和密码');
        return;
      }
      setFetchingTeams(true);
      setTeamFetchError('');
      try {
        const res = await invoke<MvaigcFetchTeamsResult>('mvaigc_fetch_teams', {
          account: accountDraft.trim(),
          password: passwordDraft.trim(),
        });
        if (res && res.teams) {
          setTeams(res.teams);
          if (res.points !== undefined && res.points !== null) {
            setPoints(res.points);
          }
          if (res.teams.length > 0) {
            const match =
              res.teams.find((item) => item.id === selectedTenantId) ||
              (res.currentTenantId ? res.teams.find((item) => item.id === res.currentTenantId) : null) ||
              res.teams[0];
            if (match) {
              setSelectedTenantId(match.id);
              setSelectedTenantName(match.name);
            }
          }
        }
      } catch (err) {
        if (!isSilent) {
          setTeamFetchError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setFetchingTeams(false);
      }
    },
    [accountDraft, passwordDraft, selectedTenantId],
  );

  useEffect(() => {
    if (isMvaigcCredentialsComplete(account, password)) {
      void handleFetchTeams(true);
    }
  }, []);

  const handleTeamChange = async (newTenantId: number) => {
    setSelectedTenantId(newTenantId);
    const team = teams.find((t) => t.id === newTenantId);
    if (team) {
      setSelectedTenantName(team.name);
    }
    if (isMvaigcCredentialsComplete(accountDraft, passwordDraft)) {
      try {
        const switchRes = await invoke<MvaigcFetchTeamsResult>('mvaigc_switch_team', {
          account: accountDraft.trim(),
          password: passwordDraft.trim(),
          tenantId: newTenantId,
          tenantName: team ? team.name : null,
        });
        if (switchRes && switchRes.points !== undefined && switchRes.points !== null) {
          setPoints(switchRes.points);
        }
      } catch (err) {
        console.warn('Switch team on change error:', err);
      }
    }
  };

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
      const credentials = selectedTenantId
        ? `${accountDraft.trim()}:${passwordDraft.trim()}:${selectedTenantId}`
        : `${accountDraft.trim()}:${passwordDraft.trim()}`;

      setMvaigcCredentials(
        accountDraft.trim(),
        passwordDraft.trim(),
        normalizedPort,
        selectedTenantId,
        selectedTenantName,
      );

      await invoke('mvaigc_set_credentials', {
        account: accountDraft.trim(),
        password: passwordDraft.trim(),
        port: normalizedPort,
        tenantId: selectedTenantId,
        tenantName: selectedTenantName || null,
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
  }, [
    accountDraft,
    passwordDraft,
    portDraft,
    selectedTenantId,
    selectedTenantName,
    setMvaigcCredentials,
    addProvider,
    updateProvider,
    providers,
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-text-dark">
          {t('settings.mvaigc.title')}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          填写 mvaigc 账号密码并选择团队即可使用其图片与视频生成。反代服务会自动根据所选团队扣除相应积分。
        </p>
      </div>

      <div className="rounded-lg border border-border-dark bg-bg-dark p-4 space-y-3.5">
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

        {/* 团队空间选择 */}
        <div className="pt-2 border-t border-border-dark/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-muted flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-accent" />
              团队空间选择
            </span>
            <button
              type="button"
              onClick={() => handleFetchTeams(false)}
              disabled={fetchingTeams || !accountDraft.trim() || !passwordDraft.trim()}
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${fetchingTeams ? 'animate-spin' : ''}`} />
              {fetchingTeams ? '查询中...' : '查询/刷新所属团队'}
            </button>
          </div>

          {teams.length > 0 ? (
            <div className="space-y-2">
              <div className="relative">
                <select
                  aria-label="选择团队"
                  value={selectedTenantId ?? ''}
                  onChange={(e) => handleTeamChange(Number(e.target.value))}
                  className="w-full rounded-md border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark outline-none focus:border-accent/50 appearance-none pr-8 cursor-pointer"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.roleLabel})
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-text-muted">
                  <Building2 className="h-3.5 w-3.5" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-surface-dark/70 px-2.5 py-1.5 text-[11px] text-text-muted border border-border-dark/50">
                <div className="flex items-center gap-2">
                  <span className="text-text-dark font-medium">
                    {teams.find((t) => t.id === selectedTenantId)?.name || selectedTenantName || '未选择团队'}
                  </span>
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent font-medium">
                    {teams.find((t) => t.id === selectedTenantId)?.roleLabel || '团队成员'}
                  </span>
                </div>
                {points !== null && (
                  <div className="flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                    <Coins className="h-3 w-3" />
                    <span>可用算力: {points.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded border border-dashed border-border-dark p-2.5 text-center text-[11px] text-text-muted">
              {fetchingTeams ? (
                <div className="flex items-center justify-center gap-1.5 text-accent">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在通过反代获取账号所属团队...
                </div>
              ) : (
                <span>
                  输入账号密码后点击上方“查询/刷新所属团队”，即可按团队划分管理生成与积分。
                </span>
              )}
            </div>
          )}
          {teamFetchError && (
            <div className="text-[11px] text-red-400">{teamFetchError}</div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
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
              <CheckCircle2 className="h-3 w-3" />
              已保存并连接到团队: {selectedTenantName || '默认空间'}
            </span>
          )}
        </div>
        {error && <div className="text-[11px] text-red-400">{error}</div>}
      </div>
    </div>
  );
}
