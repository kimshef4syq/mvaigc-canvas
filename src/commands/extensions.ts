import { invoke, isTauri } from '@tauri-apps/api/core';

export interface InstalledSkillPackage {
  id: string;
  markdown: string;
  enabled: boolean;
  revision: string;
  resources: string[];
  error?: string | null;
}

export const listInstalledSkills = (): Promise<InstalledSkillPackage[]> => isTauri()
  ? invoke('list_installed_skills') : Promise.resolve([]);
export const installLocalSkill = (id: string, source: string) => invoke<InstalledSkillPackage>('install_local_skill', { id, source });
export const installSkillZip = (id: string, url: string, expectedSha256: string) => invoke<InstalledSkillPackage>('install_skill_zip', { id, url, expectedSha256 });
export const setSkillEnabled = (id: string, enabled: boolean) => invoke<void>('set_skill_enabled', { id, enabled });
export const removeSkill = (id: string) => invoke<void>('remove_skill', { id });
export const rollbackSkill = (id: string) => invoke<void>('rollback_skill', { id });
export const readSkillResource = (id: string, resource: string, revision: string) => invoke<string>('read_skill_resource', { id, resource, revision });
