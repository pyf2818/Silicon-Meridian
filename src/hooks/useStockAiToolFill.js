/**
 * useStockAiToolFill — 研究工具的「AI 生成」能力
 *
 * 痛点：情景推演/研究清单/假设账本原先全靠手动填写，效率低。
 * 方案：把当前股票的算法诊断（评级/风险/指标/多空证据/支撑压力）作为确定性证据包，
 *      交给 LLM 生成结构化初稿填入工具，用户复核修改后保存——AI 起草、人拍板。
 * 合规：只基于诊断数据推演，不给买卖建议，输出明确标注仅供参考。
 */
import { useState, useCallback } from 'react';

const COMPLIANCE = '（AI 基于算法诊断生成，仅供参考，请复核后使用，不构成投资建议）';

/** 从 LLM 返回中提取 JSON（容忍 ```json 包裹与前后杂文本） */
function extractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

async function callLlm(llmConfig, systemPrompt, userPrompt) {
  const res = await fetch('/api/ai-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, model: llmConfig.selectedModel,
      action: 'chat', messages: [{ role: 'user', content: userPrompt }], systemPrompt,
    }),
  });
  const data = await res.json();
  if (!data.content) throw new Error(data.message || 'AI 返回为空');
  return data.content;
}

function evidenceContext({ name, code, realtime, diagnosis }) {
  const m = diagnosis?.metrics || {};
  return `股票：${name || diagnosis?.stock?.name || ''}（${code || diagnosis?.stock?.code || ''}）
现价：${realtime?.price ?? m.price ?? '--'}；评级：${diagnosis?.rating || '--'}；风险：${diagnosis?.risk || '--'}
MA5/10/20：${m.ma5 ?? '--'}/${m.ma10 ?? '--'}/${m.ma20 ?? '--'}
支撑/压力：${m.support ?? '--'}/${m.resistance ?? '--'}；波动率：${m.volatility ?? '--'}%
20期涨跌：${m.assetReturn20 ?? '--'}%；基准同期：${m.benchmarkReturn20 ?? '--'}%
多方证据：${(diagnosis?.bullCase || []).join('；') || '无'}
反向证据：${(diagnosis?.bearCase || []).join('；') || '无'}
失效条件：${(diagnosis?.invalidation || []).join('；') || '无'}`;
}

const TOOLS = {
  scenario: {
    system: `你是审慎的股票研究助手。基于给定的算法诊断数据做情景推演初稿。
只能以现价、支撑位、压力位、波动率为锚设定目标价（悲观≈支撑附近，基准≈现价±小幅漂移，乐观≈压力附近），
概率要合理且三档合计恰好 100。禁止给买卖建议。只输出 JSON，格式：
{"bearTarget":数字,"baseTarget":数字,"bullTarget":数字,"bearProbability":数字,"baseProbability":数字,"bullProbability":数字,"rationale":"三句话以内说明设定依据"}`,
    user: ctx => `${ctx}\n\n请生成情景推演初稿（只输出 JSON）。`,
    apply: (parsed, setters) => {
      if (!parsed) return false;
      const num = v => (Number.isFinite(Number(v)) ? String(Number(v)) : '');
      setters.setPlan?.(prev => ({
        ...prev,
        bearTarget: num(parsed.bearTarget) || prev.bearTarget,
        baseTarget: num(parsed.baseTarget) || prev.baseTarget,
        bullTarget: num(parsed.bullTarget) || prev.bullTarget,
        bearProbability: num(parsed.bearProbability) || prev.bearProbability,
        baseProbability: num(parsed.baseProbability) || prev.baseProbability,
        bullProbability: num(parsed.bullProbability) || prev.bullProbability,
      }));
      setters.setRationale?.(parsed.rationale ? `${parsed.rationale}${COMPLIANCE}` : '');
      return true;
    },
  },
  journal: {
    system: `你是审慎的股票研究助手。基于给定的算法诊断数据起草「研究假设账本」初稿。
核心假设 = 当前判断成立所依赖的最关键事实（2-3 条）；反向证据 = 对判断最有力的反驳；失效条件 = 可观测的价格/数据触发点（引用具体支撑/压力位）。
禁止买卖建议。只输出 JSON：{"thesis":"多行文本","counterEvidence":"多行文本","invalidation":"多行文本"}`,
    user: ctx => `${ctx}\n\n请生成假设账本初稿（只输出 JSON）。`,
    apply: (parsed, setters) => {
      if (!parsed) return false;
      setters.setDraft?.(prev => ({
        ...prev,
        thesis: parsed.thesis ? `${parsed.thesis}` : prev.thesis,
        counterEvidence: parsed.counterEvidence || prev.counterEvidence,
        invalidation: parsed.invalidation || prev.invalidation,
      }));
      return true;
    },
  },
  checklist: {
    system: `你是审慎的股票研究助手。基于给定股票与诊断数据，为研究清单写一份「证据来源与待办」笔记。
按业务/财务/估值/催化/反证/治理六个维度，各给出：最该优先核验的具体问题 + 建议的数据来源（如财报、交易所公告、官网）。
只做研究指引，不下结论，禁止买卖建议。输出 200 字内的纯文本（可用短横列表）。`,
    user: ctx => `${ctx}\n\n请生成清单核验笔记（纯文本）。`,
    apply: (parsed, setters, rawText) => {
      setters.setRecord?.(prev => ({ ...prev, note: (rawText || '').trim() ? `${String(rawText).trim()}\n\n${COMPLIANCE}` : prev.note }));
      return Boolean(rawText);
    },
  },
};

export function useStockAiToolFill(llmConfig) {
  const [generating, setGenerating] = useState(''); // '' | toolId
  const [error, setError] = useState('');
  const [errorTool, setErrorTool] = useState(''); // 错误归属的工具，避免跨工具误显示

  const llmReady = Boolean(llmConfig?.baseUrl && llmConfig?.apiKey && llmConfig?.selectedModel);

  const generate = useCallback(async ({ tool, name, code, realtime, diagnosis, setters }) => {
    const spec = TOOLS[tool];
    if (!spec || !llmReady) return false;
    setGenerating(tool);
    setError('');
    setErrorTool('');
    try {
      const ctx = evidenceContext({ name, code, realtime, diagnosis });
      const raw = await callLlm(llmConfig, spec.system, spec.user(ctx));
      const parsed = tool === 'checklist' ? null : extractJson(raw);
      const ok = spec.apply(parsed, setters || {}, raw);
      if (!ok) throw new Error('AI 返回格式无法解析，请重试');
      return true;
    } catch (e) {
      setError(e?.message || 'AI 生成失败');
      setErrorTool(tool);
      return false;
    } finally {
      setGenerating('');
    }
  }, [llmReady, llmConfig]);

  return { generate, generating, error, errorTool, llmReady, clearError: () => { setError(''); setErrorTool(''); } };
}
