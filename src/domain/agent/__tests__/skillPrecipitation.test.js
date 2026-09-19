import { describe, it, expect } from 'vitest';
import {
  MAX_SKILLS_PER_SESSION,
  MIN_SKILL_BODY_CHARS,
  shouldAttemptPrecipitation,
  buildPrecipitationPrompt,
  parsePrecipitationDecision,
  normalizeSkillDraft,
} from '../skillPrecipitation.js';

// 技能自主沉淀：把「每次对话结束固定弹审批卡」改为「Agent 自判 + 静默落盘」后，
// 这里锁死三个确定性边界：预筛（省 LLM 调用）、解析（容错）、校验（宁缺毋滥）。

describe('shouldAttemptPrecipitation（启发式预筛）', () => {
  it('无工具调用 → 不复盘（纯问答没有方法论含量）', () => {
    expect(shouldAttemptPrecipitation({ hadToolCalls: false, contentLength: 3000, sessionSkillCount: 0 })).toBe(false);
  });

  it('回答过短 → 不复盘', () => {
    expect(shouldAttemptPrecipitation({ hadToolCalls: true, contentLength: 80, sessionSkillCount: 0 })).toBe(false);
  });

  it('本会话已沉淀足量 → 不再复盘（防刷屏）', () => {
    expect(shouldAttemptPrecipitation({
      hadToolCalls: true, contentLength: 3000, sessionSkillCount: MAX_SKILLS_PER_SESSION,
    })).toBe(false);
  });

  it('有工具调用且回答够长且未超量 → 复盘', () => {
    expect(shouldAttemptPrecipitation({ hadToolCalls: true, contentLength: 600, sessionSkillCount: 0 })).toBe(true);
  });

  it('自定义上限生效', () => {
    expect(shouldAttemptPrecipitation({
      hadToolCalls: true, contentLength: 600, sessionSkillCount: 1, maxPerSession: 1,
    })).toBe(false);
  });
});

describe('buildPrecipitationPrompt / 系统语', () => {
  it('提示词要求只输出 JSON 且含 valuable 字段', () => {
    const p = buildPrecipitationPrompt();
    expect(p).toContain('只输出一个 JSON 对象');
    expect(p).toContain('"valuable"');
    expect(p).toContain('"skill"');
  });
});

describe('parsePrecipitationDecision（容错解析）', () => {
  it('裸 JSON 直接解析', () => {
    const d = parsePrecipitationDecision('{"valuable": true, "reason": "形成了流程", "skill": {"title": "做X"}}');
    expect(d.valuable).toBe(true);
    expect(d.reason).toBe('形成了流程');
    expect(d.skill.title).toBe('做X');
  });

  it('剥掉 ```json 围栏', () => {
    const raw = '```json\n{"valuable": true, "reason": "ok", "skill": {"title": "T"}}\n```';
    expect(parsePrecipitationDecision(raw).valuable).toBe(true);
  });

  it('JSON 前后夹带解释文字也能解析', () => {
    const raw = '我的判断如下：\n{"valuable": false, "reason": "一次性查询"}\n希望有帮助。';
    const d = parsePrecipitationDecision(raw);
    expect(d.valuable).toBe(false);
    expect(d.reason).toBe('一次性查询');
  });

  it('valuable 非 true 时一律视为不沉淀（防模型输出字符串 "true" 之类）', () => {
    expect(parsePrecipitationDecision('{"valuable": "true"}').valuable).toBe(false);
    expect(parsePrecipitationDecision('{"valuable": 1}').valuable).toBe(false);
  });

  it('非法输出 → 安全降级为不沉淀', () => {
    expect(parsePrecipitationDecision('').valuable).toBe(false);
    expect(parsePrecipitationDecision('完全没有 JSON').valuable).toBe(false);
    expect(parsePrecipitationDecision('{ 坏掉的 json').valuable).toBe(false);
  });

  it('skill 非对象时置 null', () => {
    expect(parsePrecipitationDecision('{"valuable": true, "skill": "文案"}').skill).toBe(null);
  });
});

describe('normalizeSkillDraft（宁缺毋滥的校验）', () => {
  const goodBody = 'x'.repeat(MIN_SKILL_BODY_CHARS + 20);

  it('标题缺失 → 拒绝', () => {
    expect(normalizeSkillDraft({ body: goodBody }).ok).toBe(false);
    expect(normalizeSkillDraft(null).ok).toBe(false);
  });

  it('正文过短 → 拒绝（凑数套话不落盘）', () => {
    const r = normalizeSkillDraft({ title: '检索流程', body: '很短' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('正文过短');
  });

  it('合法草稿 → 归一化并裁剪长度/数量', () => {
    const r = normalizeSkillDraft({
      title: 'x'.repeat(100),
      description: 'd'.repeat(500),
      triggers: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      tools: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'],
      body: goodBody,
    });
    expect(r.ok).toBe(true);
    expect(r.skill.title.length).toBe(60);
    expect(r.skill.description.length).toBe(200);
    expect(r.skill.triggers.length).toBe(6);
    expect(r.skill.tools.length).toBe(8);
    expect(r.skill.category).toBe('work');
  });

  it('triggers/tools 支持逗号字符串写法', () => {
    const r = normalizeSkillDraft({ title: '检索流程', body: goodBody, triggers: '甲, 乙，丙', tools: 'search_news, web_search' });
    expect(r.ok).toBe(true);
    expect(r.skill.triggers).toEqual(['甲', '乙', '丙']);
    expect(r.skill.tools).toEqual(['search_news', 'web_search']);
  });

  it('缺 description 时兜底生成', () => {
    const r = normalizeSkillDraft({ title: '检索流程', body: goodBody });
    expect(r.skill.description).toContain('工作技能');
  });
});

describe('端到端：模型输出 → 决策 → 草稿', () => {
  it('有价值的输出可完整走完链路', () => {
    const raw = JSON.stringify({
      valuable: true,
      reason: '形成了站内优先的检索顺序',
      skill: {
        title: '站内优先检索',
        description: '先站内后联网',
        triggers: ['查资讯'],
        tools: ['search_news'],
        body: 'y'.repeat(MIN_SKILL_BODY_CHARS + 1),
      },
    });
    const decision = parsePrecipitationDecision(raw);
    expect(decision.valuable).toBe(true);
    const draft = normalizeSkillDraft(decision.skill);
    expect(draft.ok).toBe(true);
    expect(draft.skill.title).toBe('站内优先检索');
  });

  it('valuable=true 但正文过短 → 最终被拒（双重保险）', () => {
    const decision = parsePrecipitationDecision('{"valuable": true, "skill": {"title": "T", "body": "太短"}}');
    expect(decision.valuable).toBe(true);
    expect(normalizeSkillDraft(decision.skill).ok).toBe(false);
  });
});
