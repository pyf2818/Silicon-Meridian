/**
 * editorService 单测（2026-09-22 LLM 编辑层）：
 * - prompt 构建 / 响应解析（代码块容忍、截断 JSON 抢救、幻觉 id 白名单、note 截断）
 * - 配置容错（未配置 = disabled；坏 JSON 报一次不刷屏）
 * - 惰性触发判定（当日已算 / running / 退避 / 条目过少不触发）+ 全链路成功写入缓存
 * LLM 传输 mock 掉（requestChatCompletion），纯逻辑全部真跑。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/llmClient.js', () => ({ requestChatCompletion: vi.fn() }));
vi.mock('../../profile/profileRepository.js', () => ({ createProfileRepository: vi.fn() }));

import { requestChatCompletion } from '../../agent/llmClient.js';
import { createProfileRepository } from '../../profile/profileRepository.js';
import {
  buildEditorPrompt, parseEditorResponse, getEditorLlmConfig, getEditorState,
  ensureDailyEditorRun, applyEditorVerdicts, resetEditorStateForTests,
} from '../editorService.js';

const IDS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const mkItems = () => IDS.map(id => ({ id, title: `标题${id}`, source: '源', summary: '摘要' }));

describe('buildEditorPrompt', () => {
  it('条目按 id|来源|标题|摘要 拼行，system 含 JSON 输出契约', () => {
    const prompt = buildEditorPrompt(mkItems());
    expect(prompt.system).toContain('严格 JSON');
    expect(prompt.user).toContain('a1 | 源 | 标题a1 | 摘要');
    expect((prompt.user.match(/\n/g) || []).length).toBeGreaterThanOrEqual(6);
  });
});

describe('parseEditorResponse', () => {
  it('正常 JSON：解析 picks/noise/notes', () => {
    const r = parseEditorResponse('{"picks":["a1","a2"],"noise":["a6"],"notes":[{"id":"a1","note":"重大政策落地"}]}', IDS);
    expect([...r.picks]).toEqual(['a1', 'a2']);
    expect([...r.noise]).toEqual(['a6']);
    expect(r.notes.get('a1')).toBe('重大政策落地');
  });

  it('容忍 ```json 代码块包裹', () => {
    const r = parseEditorResponse('```json\n{"picks":["a1"],"noise":[],"notes":[]}\n```', IDS);
    expect(r.picks.has('a1')).toBe(true);
  });

  it('截断 JSON 从首 { 到末 } 抢救（垃圾文本包裹完整 JSON 的场景）', () => {
    const r = parseEditorResponse('好的，编辑结果如下：{"picks":["a1"],"noise":[],"notes":[]} 以上。', IDS);
    expect(r.picks.has('a1')).toBe(true);
    const r2 = parseEditorResponse('{"picks":["a1","a2"],"noise":[],"notes":[{"id":"a1","note":"ok"}]}', IDS);
    expect(r2.notes.get('a1')).toBe('ok');
  });

  it('幻觉 id 白名单过滤 + picks 上限 8 + note 截断 80 字', () => {
    const validIds = [...IDS, 'b1', 'b2', 'b3', 'b4', 'b5', 'b6'];   // 12 个合法 id
    const ghost = [...validIds, 'x1', 'x2'];                          // 14 个请求 id（2 个幻觉）
    const longNote = '长'.repeat(200);
    const r = parseEditorResponse(
      JSON.stringify({ picks: ghost, noise: ['ghost'], notes: [{ id: 'a1', note: longNote }] }),
      validIds,
    );
    expect(r.picks.size).toBe(8);                          // MAX_PICKS（先白名单过滤再截断）
    expect([...r.picks].every(id => validIds.includes(id))).toBe(true);
    expect(r.noise.size).toBe(0);                          // 幻觉 id 全滤
    expect(r.notes.get('a1')).toHaveLength(80);
  });

  it('空串 / 纯垃圾文本返回 null（调用方走退避）', () => {
    expect(parseEditorResponse('', IDS)).toBeNull();
    expect(parseEditorResponse('抱歉我无法完成', IDS)).toBeNull();
  });
});

describe('配置容错', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('未配置 EDITOR_LLM_CONFIG → disabled', () => {
    vi.stubEnv('EDITOR_LLM_CONFIG', '');
    expect(getEditorLlmConfig()).toBeNull();
    expect(getEditorState().enabled).toBe(false);
  });

  it('坏 JSON 报一次后静默（configErrorLogged 防刷屏）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('EDITOR_LLM_CONFIG', '{bad json');
    expect(getEditorLlmConfig()).toBeNull();
    expect(getEditorLlmConfig()).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('合法配置放行', () => {
    vi.stubEnv('EDITOR_LLM_CONFIG', JSON.stringify({ baseUrl: 'https://api.x.com/v1', apiKey: 'k', selectedModel: 'm' }));
    expect(getEditorLlmConfig().selectedModel).toBe('m');
  });
});

describe('ensureDailyEditorRun 惰性触发', () => {
  const okConfig = { baseUrl: 'https://api.x.com/v1', apiKey: 'k', selectedModel: 'm' };

  beforeEach(() => {
    resetEditorStateForTests();
    vi.stubEnv('EDITOR_LLM_CONFIG', JSON.stringify(okConfig));
    requestChatCompletion.mockReset();
    createProfileRepository.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('条目 <5 不触发', () => {
    expect(ensureDailyEditorRun(mkItems().slice(0, 3)).reason).toBe('too-few-items');
  });

  it('全链路：触发 → LLM 输出 → 缓存写入 → applyEditorVerdicts 注入条目', async () => {
    requestChatCompletion.mockResolvedValue({
      choices: [{ message: { content: '{"picks":["a1"],"noise":["a6"],"notes":[{"id":"a1","note":"今日最重要"}]}' } }],
    });
    const items = mkItems();
    const r = ensureDailyEditorRun(items);
    expect(r.triggered).toBe(true);
    // fire-and-forget：等微任务队列清空
    await vi.waitFor(() => expect(getEditorState().computedAt).toBeTruthy());

    const paged = mkItems();
    applyEditorVerdicts(paged);
    expect(paged[0].editorPick).toBe(true);
    expect(paged[0].editorNote).toBe('今日最重要');
    expect(paged[5].editorNoise).toBe(true);
    expect(paged[1].editorPick).toBeUndefined();
  });

  it('失败进入退避（30 分钟内 reason=backoff，不重复打 LLM）', async () => {
    requestChatCompletion.mockRejectedValue(new Error('upstream 502'));
    ensureDailyEditorRun(mkItems());
    await vi.waitFor(() => expect(getEditorState().lastError).toContain('502'));
    expect(ensureDailyEditorRun(mkItems()).reason).toBe('backoff');
    expect(requestChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('当日已算过后不再触发（每日 ≤1 次成功的成本上界）', async () => {
    requestChatCompletion.mockResolvedValue({
      choices: [{ message: { content: '{"picks":["a2"],"noise":[],"notes":[]}' } }],
    });
    ensureDailyEditorRun(mkItems());
    await vi.waitFor(() => expect(getEditorState().computedAt).toBeTruthy());
    expect(ensureDailyEditorRun(mkItems()).reason).toBe('already-computed');
    expect(requestChatCompletion).toHaveBeenCalledTimes(1);
  });
});

describe('配置来源解析（env 优先 → 用户配置兜底）', () => {
  const okConfig = { baseUrl: 'https://api.x.com/v1', apiKey: 'k', selectedModel: 'm' };

  beforeEach(() => {
    resetEditorStateForTests();
    requestChatCompletion.mockReset();
    createProfileRepository.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('无 env 无用户配置：触发后静默停用（LLM 零调用 + 60s 探测退避生效）', async () => {
    vi.stubEnv('EDITOR_LLM_CONFIG', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = ensureDailyEditorRun(mkItems());
    expect(r.triggered).toBe(true);
    // running 复位后，disabledUntil 已置位 → 同步挡板返回 disabled
    await vi.waitFor(() => expect(ensureDailyEditorRun(mkItems()).reason).toBe('disabled'));
    expect(requestChatCompletion).not.toHaveBeenCalled();
    expect(getEditorState().lastError).toBe(''); // disabled ≠ 失败，不进 30min 错误退避
    warnSpy.mockRestore();
  });

  it('无 env + 用户配置：用用户的模型跑，无关密钥（tavilyKey）不透传', async () => {
    vi.stubEnv('EDITOR_LLM_CONFIG', '');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createProfileRepository.mockReturnValue({
      getLlmConfig: vi.fn().mockResolvedValue({
        baseUrl: 'https://user-api.com/v1', apiKey: 'uk', selectedModel: 'user-model', tavilyKey: 'tk-secret',
      }),
    });
    requestChatCompletion.mockResolvedValue({
      choices: [{ message: { content: '{"picks":["a1"],"noise":[],"notes":[]}' } }],
    });
    ensureDailyEditorRun(mkItems(), { userId: 'u-123' });
    await vi.waitFor(() => expect(getEditorState().computedAt).toBeTruthy());
    expect(requestChatCompletion).toHaveBeenCalledTimes(1);
    const [configArg] = requestChatCompletion.mock.calls[0];
    expect(configArg.baseUrl).toBe('https://user-api.com/v1');
    expect(configArg.selectedModel).toBe('user-model');
    expect(configArg.tavilyKey).toBeUndefined();
    expect(getEditorState().configSource).toBe('user:u-123');
    logSpy.mockRestore();
  });

  it('env 与用户配置并存 → env 优先（用户配置根本不读）', async () => {
    vi.stubEnv('EDITOR_LLM_CONFIG', JSON.stringify(okConfig));
    const profileGetLlmConfig = vi.fn().mockResolvedValue({ baseUrl: 'https://user-api.com/v1', selectedModel: 'user-model' });
    createProfileRepository.mockReturnValue({ getLlmConfig: profileGetLlmConfig });
    requestChatCompletion.mockResolvedValue({
      choices: [{ message: { content: '{"picks":[],"noise":[],"notes":[]}' } }],
    });
    ensureDailyEditorRun(mkItems(), { userId: 'u-1' });
    await vi.waitFor(() => expect(getEditorState().computedAt).toBeTruthy());
    expect(profileGetLlmConfig).not.toHaveBeenCalled();
    expect(requestChatCompletion.mock.calls[0][0].selectedModel).toBe('m');
    expect(getEditorState().configSource).toBe('env');
  });

  it('用户配置缺 baseUrl → 静默停用（LLM 零调用，不进错误退避）', async () => {
    vi.stubEnv('EDITOR_LLM_CONFIG', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createProfileRepository.mockReturnValue({
      getLlmConfig: vi.fn().mockResolvedValue({ selectedModel: 'm' }),
    });
    ensureDailyEditorRun(mkItems(), { userId: 'u-1' });
    await vi.waitFor(() => expect(ensureDailyEditorRun(mkItems(), { userId: 'u-1' }).reason).toBe('disabled'));
    expect(requestChatCompletion).not.toHaveBeenCalled();
    expect(getEditorState().lastError).toBe('');
    warnSpy.mockRestore();
  });

  it('profile 仓储抛错 → 静默停用，不炸触发链', async () => {
    vi.stubEnv('EDITOR_LLM_CONFIG', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createProfileRepository.mockReturnValue({
      getLlmConfig: vi.fn().mockRejectedValue(new Error('DATABASE_UNAVAILABLE')),
    });
    expect(() => ensureDailyEditorRun(mkItems(), { userId: 'u-1' })).not.toThrow();
    await vi.waitFor(() => expect(ensureDailyEditorRun(mkItems(), { userId: 'u-1' }).reason).toBe('disabled'));
    expect(requestChatCompletion).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
