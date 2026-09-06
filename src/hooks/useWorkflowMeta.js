import { useMemo } from 'react';
import { WORKFLOW_NODE_META } from '../constants/workflowConstants.js';

/**
 * Workflow type/status metadata and selected node derivations.
 * All pure computations with no side effects.
 */
export function useWorkflowMeta(agentWorkflowDraft, selectedWorkflowNodeId) {
  // 类型元信息：tone 走画布调色，color 走 workspace 常量（节点面板圆点色）
  const workflowTypeMeta = useMemo(() => ({
    input:      { label: '输入',          tone: 'blue',   color: WORKFLOW_NODE_META.input.color },
    llm:        { label: '大模型 Prompt', tone: 'cyan',   color: WORKFLOW_NODE_META.llm.color },
    skill:      { label: '工具 Skills',   tone: 'green',  color: WORKFLOW_NODE_META.skill.color },
    condition:  { label: '条件语句',      tone: 'amber',  color: WORKFLOW_NODE_META.condition.color },
    classifier: { label: '分类语句',      tone: 'violet', color: WORKFLOW_NODE_META.classifier.color },
    reply:      { label: '指定回复',      tone: 'rose',   color: WORKFLOW_NODE_META.reply.color },
    output:     { label: '输出',          tone: 'slate',  color: WORKFLOW_NODE_META.output.color },
    // 方案 C Phase 5：多 agent 编排节点
    subworkflow: { label: '子工作流',     tone: 'pink',   color: WORKFLOW_NODE_META.subworkflow.color },
    parallel:    { label: '并行扇出',     tone: 'orange', color: WORKFLOW_NODE_META.parallel.color },
    router:      { label: '路由分发',     tone: 'purple', color: WORKFLOW_NODE_META.router.color },
  }), []);

  const workflowRunStatusMeta = useMemo(() => ({
    idle:      { label: '待运行', tone: 'neutral' },
    running:   { label: '运行中', tone: 'running' },
    completed: { label: '已完成', tone: 'success' },
    blocked:   { label: '待配置', tone: 'blocked' },
    failed:    { label: '失败',   tone: 'failed'  },
  }), []);

  // 严格匹配：未选中时返回 null（配置卡不再默认抢占第一个节点）
  const selectedWorkflowNode = useMemo(() => {
    if (!selectedWorkflowNodeId) return null;
    const nodes = agentWorkflowDraft?.nodes ?? [];
    return nodes.find(node => node.id === selectedWorkflowNodeId) || null;
  }, [agentWorkflowDraft?.nodes, selectedWorkflowNodeId]);

  const selectedWorkflowConnections = useMemo(() => {
    const nodes = agentWorkflowDraft?.nodes ?? [];
    const index = nodes.findIndex(node => node.id === selectedWorkflowNodeId);
    return {
      previous: index > 0 ? nodes[index - 1] : null,
      next: index >= 0 && index < nodes.length - 1 ? nodes[index + 1] : null,
    };
  }, [agentWorkflowDraft?.nodes, selectedWorkflowNodeId]);

  const enabledWorkflowNodes = useMemo(() => {
    return (agentWorkflowDraft?.nodes ?? []).filter(node => node.enabled !== false);
  }, [agentWorkflowDraft?.nodes]);

  return {
    workflowTypeMeta,
    workflowRunStatusMeta,
    selectedWorkflowNode,
    selectedWorkflowConnections,
    enabledWorkflowNodes,
  };
}
