import { parseDocument } from 'yaml';
import { listInstalledSkills, type InstalledSkillPackage } from '@/commands/extensions';
import type { SkillDefinitionV1 } from './agentSkills';

const NAMESPACES = new Set(['canvas.read', 'canvas.write', 'canvas.navigate', 'generation', 'diagnostics', 'config', 'prompting', 'director']);
export interface InstalledAgentSkill extends SkillDefinitionV1 {
  source: 'installed';
  packageId: string;
  revision: string;
  resources: string[];
  missingTools: string[];
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  return typeof value === 'string' ? value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) : [];
}

export function parseInstalledSkill(pkg: InstalledSkillPackage): InstalledAgentSkill {
  if (pkg.error) throw new Error(pkg.error);
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(pkg.id)) throw new Error('无效的技能 ID');
  const match = pkg.markdown.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md 必须包含 YAML 头信息');
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error(`技能头信息无效：${document.errors[0].message}`);
  const meta: unknown = document.toJS({ maxAliasCount: 30 });
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('技能头信息必须是对象');
  const data = meta as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : pkg.id;
  const summary = typeof data.description === 'string' ? data.description.trim() : '';
  const instructions = match[2].trim();
  if (!name || name.length > 120 || !summary || summary.length > 2000 || !instructions || instructions.length > 100_000) throw new Error('技能需要有效的名称、描述和正文（正文上限 100,000 字符）');
  const requested = strings(data.allowedTools ?? data['allowed-tools'] ?? data.toolNamespaces);
  // A package may request capabilities, but it cannot register or grant tools.
  const toolNamespaces = requested.filter((item) => NAMESPACES.has(item));
  const activation = [...new Set([name, pkg.id, ...strings(data.triggerWords ?? data['trigger-words'] ?? data.activation)])];
  return {
    id: `installed:${pkg.id}`, version: 1, summary,
    activation, instructions, toolNamespaces,
    examples: [], evalCaseIds: [], estimatedTokens: Math.ceil(instructions.length / 3.7),
    source: 'installed', packageId: pkg.id, revision: pkg.revision, resources: pkg.resources,
    missingTools: requested.filter((item) => !NAMESPACES.has(item)),
  };
}

let installed: InstalledAgentSkill[] = [];
let loaded = false;
let catalogErrors: string[] = [];
export function getInstalledAgentSkills(): readonly InstalledAgentSkill[] { return installed; }

export async function refreshInstalledAgentSkills(force = false): Promise<{ skills: InstalledAgentSkill[]; errors: string[] }> {
  if (loaded && !force) return { skills: installed, errors: catalogErrors };
  const packages = await listInstalledSkills();
  const skills: InstalledAgentSkill[] = [];
  const errors: string[] = [];
  for (const pkg of packages) {
    if (!pkg.enabled) continue;
    try { skills.push(parseInstalledSkill(pkg)); } catch (error) { errors.push(`${pkg.id}: ${String(error)}`); }
  }
  installed = skills;
  loaded = true;
  catalogErrors = errors;
  return { skills, errors };
}
