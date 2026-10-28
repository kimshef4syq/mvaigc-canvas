import { describe, expect, it } from 'vitest';
import { parseInstalledSkill } from './installedSkills';
import { buildSkillContext, routeAgentSkills } from './agentSkills';
import type { InstalledSkillPackage } from '@/commands/extensions';

const pkg: InstalledSkillPackage = { id: 'film-director', enabled: true, revision: 'abc', resources: ['references/shots.md'], markdown: `---
name: film-director
description: >
  从剧本制作电影镜头
trigger-words: [导演制作, film production]
allowed-tools: [canvas.read, generation, shell, mcp.davinci.render]
---
先分析故事，再设计镜头。` };

describe('installed skills', () => {
  it('reads YAML metadata and preserves resources without granting unsupported tools', () => {
    const skill = parseInstalledSkill(pkg);
    expect(skill.summary).toContain('从剧本');
    expect(skill.toolNamespaces).toEqual(['canvas.read', 'generation']);
    expect(skill.missingTools).toEqual(['shell', 'mcp.davinci.render']);
    expect(skill.resources).toEqual(['references/shots.md']);
  });
  it('prioritizes explicit selection and combines it with built-in capabilities', () => {
    const skill = parseInstalledSkill(pkg);
    const context = { text: '$film-director 帮我生成图片并检查供应商配置', installedSkills: [skill] };
    expect(routeAgentSkills(context)[0].skill.id).toBe('installed:film-director');
    expect(buildSkillContext(context).instructions).toContain('不可覆盖宿主规则');
    expect(buildSkillContext(context).index).toContain('installed:film-director');
  });
  it('supports prompt invocation and trigger matching', () => {
    const skill = parseInstalledSkill(pkg);
    for (const text of ['使用 film-director 技能', '导演制作这个故事', '/film-director 帮我拆镜头', '请用 /film-director 拆镜头']) {
      expect(routeAgentSkills({ text, installedSkills: [skill] }).map((x) => x.skill.id)).toContain(skill.id);
    }
  });
  it('does not treat URLs or longer IDs as explicit slash invocation', () => {
    const skill = parseInstalledSkill(pkg);
    for (const text of ['https://example.com/film-director', '/film-director-extra']) {
      const selection = routeAgentSkills({ text, installedSkills: [skill] }).find((item) => item.skill.id === skill.id);
      expect(selection?.reason).not.toBe('用户明确指定技能。');
    }
  });
  it('rejects malformed YAML, duplicate metadata, and unsafe IDs', () => {
    for (const markdown of ['no metadata', '---\nname: a\nname: b\n---\nbody', '---\nname: a\n---\nbody']) {
      expect(() => parseInstalledSkill({ ...pkg, markdown })).toThrow();
    }
    expect(() => parseInstalledSkill({ ...pkg, id: '../outside' })).toThrow();
  });
  it('bounds instruction injection while retaining the on-demand skill reader path', () => {
    const skill = parseInstalledSkill({ ...pkg, markdown: pkg.markdown + '正文'.repeat(20_000) });
    const context = buildSkillContext({ text: '$film-director', installedSkills: [skill] });
    expect(context.instructions.length).toBeLessThan(13_000);
    expect(context.instructions).toContain('skill_read');
  });
});
