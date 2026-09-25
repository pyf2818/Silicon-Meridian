import { describe, it, expect } from 'vitest';

const { validateSkill, validateSkillSet, SKILL_CATEGORY_SUGGESTIONS } = await import('../skillValidator.js');

describe('skillValidator（SKILL.md 规范校验）', () => {
  it('规范技能：ok 且零 issues', () => {
    const r = validateSkill({
      id: 'news-digest',
      meta: { name: 'news-digest', description: '生成每日资讯摘要', category: 'analysis', triggers: ['日报', 'digest'], tools: [] },
      body: '# 步骤\n1. 拉取资讯\n2. 聚类',
    });
    expect(r.ok).toBe(true);
    expect(r.level).toBe('ok');
    expect(r.issues).toHaveLength(0);
  });

  it('缺失 description/triggers → warn（可用但检索质量受损）', () => {
    const r = validateSkill({ id: 'x', meta: { name: 'x' }, body: '内容' });
    expect(r.level).toBe('warn');
    expect(r.issues.map(i => i.field).sort()).toEqual(['description', 'triggers']);
  });

  it('空正文 → error（加载后无可用内容）', () => {
    const r = validateSkill({ id: 'x', meta: {}, body: '   ' });
    expect(r.ok).toBe(false);
    expect(r.level).toBe('error');
    const bodyIssue = r.issues.find(i => i.field === 'body');
    expect(bodyIssue.level).toBe('error');
  });

  it('name 非 kebab-case / 与目录 id 不一致 → warn', () => {
    const r1 = validateSkill({ id: 'x', meta: { name: 'My Skill' }, body: 'b' });
    expect(r1.issues.some(i => i.field === 'name' && i.message.includes('kebab-case'))).toBe(true);
    const r2 = validateSkill({ id: 'dir-name', meta: { name: 'other-name' }, body: 'b' });
    expect(r2.issues.some(i => i.field === 'name' && i.message.includes('不一致'))).toBe(true);
  });

  it('category 不在建议列表 → 仅 warn 不阻塞', () => {
    const r = validateSkill({ id: 'x', meta: { category: 'weird' }, body: 'b' });
    const c = r.issues.find(i => i.field === 'category');
    expect(c.level).toBe('warn');
    expect(SKILL_CATEGORY_SUGGESTIONS).toContain('general');
  });

  it('validateSkillSet：批量巡检汇总计数正确', () => {
    const report = validateSkillSet([
      { id: 'a', meta: { name: 'a', description: 'd', triggers: ['t'] }, body: 'b' },
      { id: 'b', meta: {}, body: 'b' },
      { id: 'c', meta: {}, body: '' },
    ]);
    expect(report.total).toBe(3);
    expect(report.cleanCount).toBe(1);
    expect(report.warnCount).toBe(1);
    expect(report.errorCount).toBe(1);
  });
});
