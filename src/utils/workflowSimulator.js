/**
 * 工作流模拟执行规划器（纯函数，可单测）
 *
 * 目的：让画布上的「模拟运行」不是单纯的点亮动画，而是按节点类型推演一次
 * 真实的数据流转——每个节点都产出可解释的中间结果，条件节点会真实判定并
 * 短路后续链路。画布的连线流动动画、节点状态徽标、运行报告都由这份计划驱动。
 *
 * 不调用任何 LLM，也不产生副作用；耗时按节点类型差异化，体现真实执行节奏。
 */
import {
  WORKFLOW_SIM_DURATION,
  WORKFLOW_CONDITION_METRICS,
  WORKFLOW_CONDITION_OPERATORS,
  getWorkflowSkillMeta,
} from '../constants/workflowConstants.js';

export const SIM_DEFAULT_ITEM_COUNT = 12;

/** 比较运算：非法算子退化为 true（模拟中不做失败，避免误伤用户链路） */
export function compareValues(left, operator, right) {
  const a = Number(left);
  const b = Number(right);
  const safeA = Number.isFinite(a) ? a : 0;
  const safeB = Number.isFinite(b) ? b : 0;
  switch (operator) {
    case '>': return safeA > safeB;
    case '<=': return safeA <= safeB;
    case '<': return safeA < safeB;
    case '==': return safeA === safeB;
    case '!=': return safeA !== safeB;
    case '>=':
    default: return safeA >= safeB;
  }
}

const operatorLabel = (id) => WORKFLOW_CONDITION_OPERATORS.find(o => o.id === id)?.label || id || '>=';
const metricLabel = (id) => WORKFLOW_CONDITION_METRICS.find(m => m.id === id)?.label || id || '指标';

/** 指标解析：模拟环境下每个指标都有确定取值，保证判定可解释 */
function resolveMetric(metricId, ctx) {
  switch (metricId) {
    case 'mediaCount': return ctx.media;
    case 'materialCount': return ctx.materials;
    case 'savedCount': return ctx.saved;
    case 'focusCount': return ctx.focus;
    case 'githubCount': return ctx.github;
    case 'itemCount':
    default: return ctx.items;
  }
}

/** 单节点推演：返回 { output, note, branch } ，branch=false 表示条件未通过 */
function runNode(node, ctx) {
  switch (node.type) {
    case 'input':
      return { output: `上下文包 · ${ctx.items} 条资讯 / ${ctx.focus} 个关注领域`, note: '注入输入变量' };
    case 'llm':
      return { output: `模型产出 · 约 ${Math.max(180, Math.round(ctx.items * 26))} 字`, note: `依据 ${ctx.items} 条上下文推理` };
    case 'skill': {
      const label = getWorkflowSkillMeta(node.skillId)?.label || '证据包整理';
      return { output: `${label} · ${Math.max(3, Math.round(ctx.items / 2))} 条结构化结果`, note: '内置 Skill 执行' };
    }
    case 'classifier': {
      const buckets = String(node.classifierLabels || '').split(',').map(s => s.trim()).filter(Boolean);
      const hit = Math.max(1, Math.min(buckets.length || 5, Math.ceil(ctx.items / 4)));
      return { output: `分流至 ${hit}/${buckets.length || 5} 个分类桶`, note: buckets.slice(0, 3).join(' / ') || '默认分类' };
    }
    case 'condition': {
      const left = resolveMetric(node.conditionMetric || 'itemCount', ctx);
      const right = Number(node.conditionValue ?? 1);
      const op = node.conditionOperator || '>=';
      const pass = compareValues(left, op, right);
      return {
        output: `${metricLabel(node.conditionMetric)}(${left}) ${operatorLabel(op)} ${right} → ${pass ? '真' : '假'}`,
        note: pass ? '条件通过，链路继续' : '条件未通过，后续节点短路',
        branch: pass,
      };
    }
    case 'reply':
      return { output: '固定回复 · 1 条', note: '按模板直出，不调用模型' };
    case 'output':
      return { output: `最终产物 · 交付 1 份`, note: `汇总 ${ctx.items} 条输入` };
    case 'subworkflow':
      return { output: '子工作流返回 · 1 份结果', note: node.workflowId ? '已绑定子工作流' : '未绑定子工作流（模拟执行）' };
    case 'parallel': {
      const branches = Number(node.parallelBranches) || 3;
      return { output: `${branches} 条分支并行完成`, note: `合并策略：${node.parallelMerge || 'concat'}` };
    }
    case 'router': {
      const rules = Array.isArray(node.routerRules) ? node.routerRules : [];
      const target = rules[0]?.label || '默认分支';
      return { output: `路由 → ${target}`, note: rules.length ? `匹配 ${rules.length} 条规则` : '未配置规则，走默认分支' };
    }
    default:
      return { output: '透传上游结果', note: '未知节点类型' };
  }
}

/**
 * 规划一次模拟运行
 * @param {Array} nodes 工作流节点（按数组顺序执行）
 * @param {Object} options { itemCount }
 * @returns {{ steps:Array, totalDuration:number, shortCircuitAt:number|null, ok:boolean }}
 */
export function planSimulation(nodes, options = {}) {
  const itemCount = Number.isFinite(options.itemCount) ? options.itemCount : SIM_DEFAULT_ITEM_COUNT;
  const enabled = (Array.isArray(nodes) ? nodes : []).filter(node => node.enabled !== false);
  const ctx = {
    items: itemCount,
    media: Math.max(1, Math.round(itemCount / 4)),
    materials: Math.max(1, Math.round(itemCount / 6)),
    saved: Math.max(1, Math.round(itemCount / 5)),
    focus: 3,
    github: 2,
  };

  const steps = [];
  let shortCircuitAt = null;
  let totalDuration = 0;

  enabled.forEach((node, index) => {
    if (shortCircuitAt !== null) {
      steps.push({
        id: node.id,
        index,
        type: node.type,
        title: node.title || '未命名节点',
        status: 'skipped',
        duration: 0,
        output: '—',
        note: '上游条件未通过，已短路',
      });
      return;
    }
    const result = runNode(node, ctx);
    const duration = WORKFLOW_SIM_DURATION[node.type] ?? 400;
    totalDuration += duration;
    steps.push({
      id: node.id,
      index,
      type: node.type,
      title: node.title || '未命名节点',
      status: 'done',
      duration,
      output: result.output,
      note: result.note || '',
      branch: result.branch,
    });
    // 条件节点判定为假 → 记录短路位置，后续节点整体跳过
    if (node.type === 'condition' && result.branch === false) shortCircuitAt = index;
  });

  return {
    steps,
    totalDuration,
    shortCircuitAt,
    ok: shortCircuitAt === null,
    itemCount,
  };
}

/** 模拟运行总览文案（用于运行报告标题） */
export function summarizeSimulation(plan) {
  if (!plan?.steps?.length) return '无可运行节点';
  const skipped = plan.steps.filter(s => s.status === 'skipped').length;
  if (plan.shortCircuitAt !== null) {
    return `第 ${plan.shortCircuitAt + 1} 步条件未通过，后续 ${skipped} 个节点被短路`;
  }
  return `${plan.steps.length} 个节点全部执行完成`;
}

/**
 * 生成「最终成果」全文（模拟）：把各节点产物串成一份可阅读、可复制的交付物。
 * 供画布运行报告里的成果预览使用——模拟也要能像真实运行一样查看产出。
 */
export function buildDeliverableText(plan, workflowName = '未命名工作流') {
  if (!plan?.steps?.length) return '';
  const executed = plan.steps.filter(s => s.status === 'done');
  const shortCircuited = plan.shortCircuitAt !== null;
  const lines = [];
  lines.push(`# ${workflowName} · 模拟成果`);
  lines.push('');
  lines.push(`> ${summarizeSimulation(plan)} ｜ 输入 ${plan.itemCount} 条 · 计划耗时 ${plan.totalDuration}ms（模拟，未调用大模型）`);
  lines.push('');
  lines.push('## 执行过程');
  executed.forEach(step => {
    lines.push(`- **${step.index + 1}. ${step.title}**（${step.type}）：${step.output}`);
    if (step.note) lines.push(`  - ${step.note}`);
  });
  lines.push('');
  if (shortCircuited) {
    lines.push('## 最终结论');
    lines.push(`链路在第 ${plan.shortCircuitAt + 1} 步（条件判断）被短路，未产出最终交付物。`);
    lines.push('建议：降低条件阈值，或在条件不满足的分支上补充兜底节点（如 reply / output）。');
  } else {
    const last = executed[executed.length - 1];
    lines.push('## 最终交付物');
    lines.push(last.output);
    lines.push('');
    lines.push('### 组成');
    executed.slice(-4).forEach(step => lines.push(`- ${step.title}：${step.output}`));
  }
  return lines.join('\n');
}
