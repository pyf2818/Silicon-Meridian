/**
 * CanvasPage - 无限画布（v18 · 纯画布形态）
 *
 * 页面就是画布本身，独占全部空间，画布内浮动元素：
 * - 左上：工作流切换器（多工作流管理）+ 名称重命名
 * - 右上：有效性校验 / 模拟运行 / AI 搭建 / 保存 / 另存为 / 整理布局 / 恢复默认
 * - 右侧：AI 搭建对话抽屉（一句话生成或修改节点）
 * - 选中节点：配置卡（含该节点的待完善提示）
 *
 * 节点来源：左侧 palette 拖入或点击、双击空白、AI 对话生成。
 * 连线即执行顺序，与 workflowEngine 的顺序执行语义一致。
 * 搭好的工作流在 AI 工作站输入框「工作流」按钮里选择调用。
 */
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import WorkflowCanvas from './WorkflowCanvas.jsx';
import {
  WORKFLOW_SKILL_CATALOG,
  WORKFLOW_CONDITION_METRICS,
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_ROUTER_OPERATORS,
  WORKFLOW_PARALLEL_MERGE_STRATEGIES,
} from '../../constants/workflowConstants.js';
import { validateWorkflowDraft } from '../../utils/workflowValidation.js';
import { planSimulation, summarizeSimulation, buildDeliverableText } from '../../utils/workflowSimulator.js';
import {
  buildWorkflowSystemPrompt,
  parseWorkflowJson,
  normalizeAiNodes,
  buildLocalWorkflow,
} from '../../utils/workflowAiBuilder.js';
import { getCanvasPrefs, setCanvasPrefs, subscribeCanvasPrefs } from '../../utils/canvasPrefs.js';
import { showToast } from '../../utils/toast.js';

/** 与画布无关的环境项（当前范围资讯数、画像信号），画布页不做判定 */
const ENV_CHECK_IDS = new Set(['context-items', 'profile-signal']);
/** 校验项 id 形如 node-<kind>-<节点id>，节点 id 自身含连字符，必须按已知前缀剥离 */
const NODE_CHECK_PREFIX = /^(node-(?:required|io|skill|condition|classifier|unique-output)-)/;

const stripCheckPrefix = (id) => id.replace(NODE_CHECK_PREFIX, '');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function CanvasPage({
  draft,
  updateDraft,
  selectedNodeId,
  setSelectedNodeId,
  selectedNode,
  nodeTypeMeta,
  updateNode,
  removeNode,
  addNode,
  moveNode,
  templates = [],
  saveAsTemplate,
  resetDraft,
  deleteTemplate,
  renameWorkflow,
  duplicateWorkflow,
  createWorkflow,
  switchTemplate,
  activeWorkflowId,
  llmConfig,
  onExportDeliverable,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [showValidate, setShowValidate] = useState(false);
  const [showFlows, setShowFlows] = useState(false);
  const [prefs, setPrefs] = useState(getCanvasPrefs);
  // 模拟运行（v18）：按 planSimulation 推演真实数据流，节点/连线逐步点亮
  const [sim, setSim] = useState({ running: false, flowEdge: -1, flowLabel: '', nodeStates: {}, outputs: {}, report: null, step: -1 });
  const cancelRef = useRef(false);
  // AI 搭建（v18）：对话生成/修改节点
  const [aiOpen, setAiOpen] = useState(false);
  // 右侧节点面板开合（持久化，默认展开）
  const [paletteOpen, setPaletteOpen] = useState(() => localStorage.getItem('wfPaletteOpen') !== 'false');
  useEffect(() => { localStorage.setItem('wfPaletteOpen', String(paletteOpen)); }, [paletteOpen]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState([]); // {role, content, parsed?, note?}
  const undoRef = useRef(null);                     // 上一次 AI 变更前的画布快照
  // 撤销/重做：监听 draft.nodes 变化记录历史（输入连击 600ms 内合并为一条）
  const historyRef = useRef({ stack: [], index: -1, lastPush: 0 });
  const suppressHistoryRef = useRef(false);
  const lastNodesRef = useRef(draft.nodes);
  const [showDeliverable, setShowDeliverable] = useState(false);
  // canUndo/canRedo 必须是 React 态：入栈发生在 render 后的 effect 里，
  // 若直接读 ref，变化当次渲染算出的仍是旧值，之后无人触发重渲染 → 按钮永不解禁。
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false });
  const syncHistState = useCallback(() => {
    const hist = historyRef.current;
    setHistState({ canUndo: hist.index > 0, canRedo: hist.index >= 0 && hist.index < hist.stack.length - 1 });
  }, []);

  // 播种初始快照：栈里必须有「未修改前」的状态，首次操作才能撤销回去
  useEffect(() => {
    const hist = historyRef.current;
    if (hist.index === -1) {
      hist.stack = [draft.nodes];
      hist.index = 0;
      syncHistState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draft.nodes === lastNodesRef.current) return;
    const hist = historyRef.current;
    if (suppressHistoryRef.current) {
      // 该次变化来自 undo/redo 本身：只同步游标，不入栈
      suppressHistoryRef.current = false;
      lastNodesRef.current = draft.nodes;
      return;
    }
    const now = Date.now();
    if (now - hist.lastPush < 600 && hist.stack.length) {
      hist.stack[hist.index] = draft.nodes; // 连续小编辑合并
    } else {
      hist.stack = hist.stack.slice(0, hist.index + 1);
      hist.stack.push(draft.nodes);
      if (hist.stack.length > 60) hist.stack.shift();
      hist.index = hist.stack.length - 1;
    }
    hist.lastPush = now;
    lastNodesRef.current = draft.nodes;
    syncHistState();
  }, [draft.nodes, syncHistState]);

  const canUndo = histState.canUndo;
  const canRedo = histState.canRedo;

  const undoNodes = useCallback(() => {
    const hist = historyRef.current;
    if (hist.index <= 0) return;
    hist.index -= 1;
    suppressHistoryRef.current = true;
    hist.lastPush = 0; // 撤销后的小编辑必须走「截断 redo + 新栈」而非合并进已恢复的栈位
    syncHistState();
    updateDraft({ nodes: hist.stack[hist.index] });
  }, [updateDraft, syncHistState]);

  const redoNodes = useCallback(() => {
    const hist = historyRef.current;
    if (hist.index >= hist.stack.length - 1) return;
    hist.index += 1;
    suppressHistoryRef.current = true;
    syncHistState();
    updateDraft({ nodes: hist.stack[hist.index] });
  }, [updateDraft, syncHistState]);

  useEffect(() => subscribeCanvasPrefs(setPrefs), []);

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== draft.name) updateDraft({ name: next.slice(0, 32) });
    setEditingName(false);
  };

  /* ---- 节点真实有效性校验（复用全局工作流校验器，剔除环境项） ---- */
  const validation = useMemo(() => {
    const result = validateWorkflowDraft({
      draft,
      llmConfig,
      scopedAgentItems: [],
      selectedInterests: [],
      readingHistory: [],
      bookmarks: [],
      materials: [],
    });
    const checks = result.checks.filter(c => !ENV_CHECK_IDS.has(c.id));
    const blockingIssues = checks.filter(c => c.blocking && !c.ok);
    const warnings = checks.filter(c => !c.blocking && !c.ok);
    return {
      checks,
      blockingIssues,
      warnings,
      ready: blockingIssues.length === 0,
      score: Math.round((checks.filter(c => c.ok).length / Math.max(checks.length, 1)) * 100),
    };
  }, [draft, llmConfig]);

  /** 存在阻塞问题的节点 id（画布上打橙色角标） */
  const invalidIds = useMemo(() => {
    const ids = new Set();
    validation.checks.forEach((c) => {
      if (c.ok || !c.blocking || ENV_CHECK_IDS.has(c.id)) return;
      const nodeId = stripCheckPrefix(c.id);
      if (nodeId && nodeId !== c.id) ids.add(nodeId);
    });
    return [...ids];
  }, [validation]);

  /** 选中节点自己的待完善项 */
  const selectedIssues = useMemo(() => {
    if (!selectedNode) return [];
    return validation.checks.filter(c => c.id.endsWith(`-${selectedNode.id}`) && !c.ok);
  }, [validation, selectedNode]);

  /* ---- 模拟运行：按链路推演，边线流动 + 粒子 + 数据标签 ---- */
  const stopSim = useCallback(() => {
    cancelRef.current = true;
    setSim({ running: false, flowEdge: -1, flowLabel: '', nodeStates: {}, outputs: {}, report: null, step: -1 });
  }, []);

  const runSimulation = useCallback(() => {
    if (sim.running) { stopSim(); return; }
    const plan = planSimulation(draft.nodes);
    if (!plan.steps.length) return;
    cancelRef.current = false;
    setShowDeliverable(false);
    setSim({ running: true, flowEdge: -1, flowLabel: '', nodeStates: {}, outputs: {}, report: null, step: 0 });
    (async () => {
      const startedAt = performance.now();
      for (let i = 0; i < plan.steps.length; i += 1) {
        if (cancelRef.current) return;
        const step = plan.steps[i];
        if (step.status === 'skipped') {
          setSim(s => ({ ...s, step: i, nodeStates: { ...s.nodeStates, [step.id]: 'skipped' } }));
          await sleep(180);
          continue;
        }
        setSim(s => ({
          ...s,
          step: i,
          flowEdge: i > 0 ? i - 1 : -1,
          flowLabel: i > 0 ? plan.steps[i - 1].output : '',
          nodeStates: { ...s.nodeStates, [step.id]: 'running' },
        }));
        await sleep(Math.max(140, step.duration / (prefs.speed || 1)));
        if (cancelRef.current) return;
        setSim(s => ({
          ...s,
          nodeStates: { ...s.nodeStates, [step.id]: 'done' },
          outputs: { ...s.outputs, [step.id]: step.output },
          flowEdge: -1,
          flowLabel: '',
        }));
      }
      setSim(s => ({
        ...s,
        running: false,
        flowEdge: -1,
        flowLabel: '',
        report: {
          ...plan,
          elapsed: Math.round(performance.now() - startedAt),
          deliverable: buildDeliverableText(plan, draft.name),
        },
      }));
    })();
  }, [sim.running, draft.nodes, prefs.speed, stopSim]);

  /* ---- 一键整理布局：按 3 列网格重排 ---- */
  const autoLayout = useCallback(() => {
    const nodes = (draft.nodes || []).map((node, i) => ({
      ...node,
      position: { x: 80 + (i % 3) * 300, y: 90 + Math.floor(i / 3) * 200 },
    }));
    updateDraft({ nodes });
  }, [draft.nodes, updateDraft]);

  /* ---- 双击空白建节点 / Delete 删除选中 / Esc 收起 ---- */
  const handleDblClick = useCallback((x, y) => { addNode({ x, y }, 'llm'); }, [addNode]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoNodes(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) { e.preventDefault(); redoNodes(); return; }
      if (e.key === 'Escape') { setSelectedNodeId(null); setShowValidate(false); setShowFlows(false); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        removeNode(selectedNodeId);
        setSelectedNodeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, removeNode, setSelectedNodeId, undoNodes, redoNodes]);

  /** 复制节点：含全部配置，落在原节点右下方 */
  const duplicateNode = useCallback((nodeId) => {
    const source = (draft.nodes || []).find(n => n.id === nodeId);
    if (!source) return;
    const copy = {
      ...source,
      id: `${source.type}-${Date.now().toString(36)}-copy`,
      title: `${source.title} 副本`,
      outputKey: `${source.outputKey}_copy`,
      position: { x: source.position.x + 60, y: source.position.y + 80 },
    };
    updateDraft({ nodes: [...draft.nodes, copy] });
    setSelectedNodeId(copy.id);
  }, [draft.nodes, updateDraft, setSelectedNodeId]);

  /* ---- AI 搭建：对话生成/修改节点 ---- */
  const applyAiPlan = useCallback((plan, mode) => {
    if (!plan?.nodes?.length) return;
    undoRef.current = { name: draft.name, nodes: draft.nodes };
    if (mode === 'replace') {
      updateDraft({
        name: String(plan.name || draft.name).slice(0, 24),
        description: String(plan.description || draft.description || ''),
        nodes: plan.nodes,
      });
      setSelectedNodeId(null);
    } else {
      const base = (draft.nodes || []).length;
      updateDraft({
        nodes: [
          ...(draft.nodes || []),
          ...plan.nodes.map((n, i) => ({
            ...n,
            inputKey: n.inputKey || `step_${base + i}`,
            outputKey: n.outputKey || `step_${base + i + 1}`,
            position: { x: 120 + ((base + i) % 3) * 300, y: 90 + Math.floor((base + i) / 3) * 200 },
          })),
        ],
      });
    }
  }, [draft.name, draft.nodes, draft.description, updateDraft, setSelectedNodeId]);

  const undoAi = useCallback(() => {
    const snap = undoRef.current;
    if (!snap) return;
    updateDraft({ name: snap.name, nodes: snap.nodes });
    undoRef.current = null;
  }, [updateDraft]);

  const sendAi = useCallback(async () => {
    const text = aiInput.trim();
    if (!text || aiBusy) return;
    setAiMessages(prev => [...prev, { role: 'user', content: text }]);
    setAiInput('');
    setAiBusy(true);
    const hasLlm = Boolean(llmConfig?.baseUrl && llmConfig?.selectedModel);
    try {
      let plan = null;
      let note = '';
      if (!hasLlm) {
        // 未配置大模型：本地预置链路兜底，保证「对话搭建」永远可用
        plan = buildLocalWorkflow(text, nodeTypeMeta);
        note = '未配置大模型，已按本地预置链路生成。在「设置 → 大模型」配置后可获得按描述定制的方案。';
      } else {
        const response = await fetch('/api/ai-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            model: llmConfig.selectedModel,
            action: 'chat',
            systemPrompt: buildWorkflowSystemPrompt(nodeTypeMeta, draft),
            messages: [
              ...aiMessages.filter(m => !m.parsed).map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: text },
            ],
          }),
        });
        const data = await response.json().catch(() => ({}));
        const parsed = parseWorkflowJson(data?.content);
        if (parsed?.nodes?.length) {
          plan = { name: parsed.name, description: parsed.description, nodes: normalizeAiNodes(parsed, nodeTypeMeta) };
        } else {
          plan = buildLocalWorkflow(text, nodeTypeMeta);
          note = data?.error
            ? `大模型调用失败（${data.error}），已用本地预置链路兜底。`
            : '大模型未返回合法 JSON，已用本地预置链路兜底。';
        }
      }
      setAiMessages(prev => [...prev, {
        role: 'assistant',
        content: `已生成「${plan.name || '工作流'}」：${plan.nodes.length} 个节点。`,
        detail: plan.nodes.map((n, i) => `${i + 1}. ${nodeTypeMeta[n.type]?.label || n.type}｜${n.title}`).join('　'),
        note,
        parsed: plan,
      }]);
    } catch (e) {
      const plan = buildLocalWorkflow(text, nodeTypeMeta);
      setAiMessages(prev => [...prev, {
        role: 'assistant',
        content: `网络异常（${e.message}），已用本地预置链路兜底。`,
        note: '检查大模型服务地址与网络后重试可获得定制方案。',
        parsed: plan,
      }]);
    } finally {
      setAiBusy(false);
    }
  }, [aiInput, aiBusy, llmConfig, aiMessages, nodeTypeMeta, draft]);

  const savedCurrent = Boolean(activeWorkflowId) && templates.some(t => t.id === activeWorkflowId);
  const issueCount = validation.blockingIssues.length + validation.warnings.length;

  return (
    <div className={`canvas-page${aiOpen ? ' ai-open' : ''}`}>
      <WorkflowCanvas
        nodes={draft.nodes}
        selectedId={selectedNodeId}
        onSelect={setSelectedNodeId}
        onMoveNode={(id, x, y) => updateNode(id, { position: { x, y } })}
        onCreateNodeAt={(type, x, y) => addNode({ x, y }, type)}
        nodeTypeMeta={nodeTypeMeta}
        nodeStates={sim.nodeStates}
        flowEdge={sim.flowEdge}
        flowLabel={sim.flowLabel}
        simOutputs={sim.outputs}
        invalidIds={invalidIds}
        onDblClick={handleDblClick}
        gridMode={prefs.grid}
        animateEdges={prefs.animateEdges}
        snap={prefs.snap}
        onDuplicateNode={duplicateNode}
        onRemoveNode={(id) => { removeNode(id); setSelectedNodeId(null); }}
        paletteOpen={paletteOpen}
        onSetPaletteOpen={setPaletteOpen}
      >
        {/* 画布内浮动：工作流切换器 + 名称（左上） */}
        <div className="canvas-float canvas-float-name" onMouseDown={e => e.stopPropagation()}>
          <div className="canvas-flow-switch">
            <button
              type="button"
              className="canvas-flow-caret"
              onClick={() => setShowFlows(v => !v)}
              title="切换 / 管理已保存的工作流"
            >▾</button>
            {editingName ? (
              <input
                className="canvas-name-input"
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitName(); }
                  else if (e.key === 'Escape') setEditingName(false);
                }}
                onBlur={commitName}
                maxLength={32}
              />
            ) : (
              <button
                type="button"
                className="canvas-name-chip"
                onClick={() => { setNameDraft(draft.name || ''); setEditingName(true); }}
                title="点击重命名（名称会出现在工作站的工作流选择器里）"
              >
                {draft.name || '未命名工作流'}
                <small>{(draft.nodes || []).length} 节点{savedCurrent ? '' : ' · 未保存'}</small>
              </button>
            )}
          </div>

          {showFlows && (
            <div className="canvas-flows-pop custom-scrollbar">
              <div className="canvas-flows-head">
                <span>我的工作流（{templates.length}）</span>
                <button type="button" onClick={() => { createWorkflow('未命名工作流'); setShowFlows(false); }}>＋ 新建</button>
              </div>
              {templates.map(tpl => (
                <div key={tpl.id} className={`canvas-flows-item${tpl.id === activeWorkflowId ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="canvas-flows-item-main"
                    onClick={() => { switchTemplate(tpl.id); setShowFlows(false); setSelectedNodeId(null); }}
                    title="切换到该工作流"
                  >
                    <span>{tpl.name}</span>
                    <small>{(tpl.nodes || []).length} 节点</small>
                  </button>
                  <button
                    type="button"
                    className="canvas-flows-act"
                    title="复制一份"
                    onClick={() => { duplicateWorkflow(tpl.id); setShowFlows(false); }}
                  >⧉</button>
                  <button
                    type="button"
                    className="canvas-flows-act"
                    title="重命名"
                    onClick={() => {
                      const next = window.prompt('重命名工作流', tpl.name || '');
                      if (next) renameWorkflow(tpl.id, next);
                    }}
                  >✎</button>
                  <button
                    type="button"
                    className="canvas-flows-act danger"
                    title="删除"
                    onClick={() => { if (window.confirm(`删除工作流「${tpl.name || ''}」？`)) deleteTemplate(tpl.id); }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 画布内浮动：动作（右上） */}
        <div className="canvas-float canvas-float-actions" onMouseDown={e => e.stopPropagation()}>
          <button
            type="button"
            className={`canvas-validate-chip ${validation.ready ? 'ok' : 'warn'}`}
            onClick={() => setShowValidate(v => !v)}
            title={validation.ready ? '全部节点真实有效' : '存在待完善项，点击查看'}
          >
            {validation.ready ? '✓ 就绪' : `⚠ ${issueCount} 待完善`}
          </button>
          <button
            type="button"
            className="canvas-sim-btn"
            onClick={runSimulation}
            disabled={!(draft.nodes || []).some(n => n.enabled !== false)}
            title="模拟运行：按链路推演数据流（不调用大模型）"
          >
            {sim.running ? '■ 停止' : '▶ 模拟运行'}
          </button>
          <button type="button" className="canvas-act-btn" onClick={undoNodes} disabled={!canUndo} title="撤销 (Ctrl+Z)">↶ 撤销</button>
          <button type="button" className="canvas-act-btn" onClick={redoNodes} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">↷ 重做</button>
          <button type="button" className="canvas-act-btn" onClick={autoLayout} disabled={!draft.nodes?.length} title="按网格重排节点">整理</button>
          <button
            type="button"
            className="canvas-act-btn"
            onClick={() => saveAsTemplate({ mode: savedCurrent ? 'update' : 'copy', name: draft.name })}
            disabled={!draft.nodes?.length}
            title={savedCurrent ? '保存当前工作流的修改' : '把当前画布保存为新的工作流'}
          >保存</button>
          <button
            type="button"
            className="canvas-act-btn"
            onClick={() => {
              const name = window.prompt('另存为工作流名称', `${draft.name || '工作流'} 副本`);
              if (name) saveAsTemplate({ mode: 'copy', name });
            }}
            disabled={!draft.nodes?.length}
            title="另存为一个新的工作流"
          >另存为</button>
          <button
            type="button"
            className={`canvas-ai-btn ${aiOpen ? 'open' : ''}`}
            onClick={() => setAiOpen(v => !v)}
            title="与 AI 对话，直接在画布上搭建节点"
          >✦ AI 搭建</button>
          <button
            type="button"
            className="canvas-act-btn"
            onClick={() => {
              if (window.confirm('恢复默认工作流模板？当前画布内容将被覆盖。')) { resetDraft(); setSelectedNodeId(null); }
            }}
            title="恢复默认模板"
          >恢复默认</button>

          {showValidate && (
            <div className="canvas-validate-pop" onMouseDown={e => e.stopPropagation()}>
              <div className="canvas-validate-pop-label">
                有效性校验 · {validation.ready ? '可执行' : `${validation.blockingIssues.length} 项阻塞`}
                <b>{validation.score} 分</b>
              </div>
              {validation.checks.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={'canvas-validate-item ' + (c.ok ? 'ok' : c.blocking ? 'blocking' : 'warn')}
                  onClick={() => {
                    const mid = stripCheckPrefix(c.id);
                    if (mid && mid !== c.id) { setSelectedNodeId(mid); setShowValidate(false); }
                  }}
                  title={c.ok ? '' : '点击定位节点'}
                >
                  <i>{c.ok ? '✓' : c.blocking ? '✕' : '⚠'}</i>
                  <span>{c.label}</span>
                  <small>{c.detail}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 模拟运行报告 */}
        {sim.report && !sim.running && (
          <div className="canvas-float canvas-sim-report" onMouseDown={e => e.stopPropagation()}>
            <div className="canvas-sim-report-head">
              <span>模拟运行报告</span>
              <b className={sim.report.ok ? 'ok' : 'warn'}>{summarizeSimulation(sim.report)}</b>
              <button type="button" onClick={() => setSim(s => ({ ...s, report: null }))} title="关闭">×</button>
            </div>
            <div className="canvas-sim-report-body custom-scrollbar">
              {sim.report.steps.map(step => (
                <div key={step.id} className={`canvas-sim-step ${step.status}`}>
                  <i>{step.status === 'skipped' ? '−' : '✓'}</i>
                  <span className="canvas-sim-step-title">{step.index + 1}. {step.title}</span>
                  <span className="canvas-sim-step-out">{step.output}</span>
                  <small>{step.note}{step.duration ? ` · ${step.duration}ms` : ''}</small>
                </div>
              ))}
            </div>
            <div className="canvas-sim-report-foot">
              <button
                type="button"
                className={`canvas-sim-deliverable-btn${showDeliverable ? ' open' : ''}`}
                onClick={() => setShowDeliverable(v => !v)}
                disabled={sim.report.shortCircuitAt !== null}
                title={sim.report.shortCircuitAt !== null ? '链路被短路，无最终成果' : '查看最终成果全文'}
              >
                {showDeliverable ? '收起成果' : '📄 查看最终成果'}
              </button>
              <span>输入 {sim.report.itemCount} 条 · 计划 {sim.report.totalDuration}ms · 实际 {(sim.report.elapsed / 1000).toFixed(1)}s（模拟，未调用大模型）</span>
            </div>
            {showDeliverable && sim.report.deliverable && (
              <div className="canvas-sim-deliverable">
                <pre className="custom-scrollbar">{sim.report.deliverable}</pre>
                <div className="canvas-sim-deliverable-actions">
                  <button type="button" onClick={() => { navigator.clipboard?.writeText(sim.report.deliverable); showToast('成果已复制到剪贴板'); }}>复制全文</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onExportDeliverable) { onExportDeliverable(`${draft.name || '工作流'} · 模拟成果`, sim.report.deliverable); }
                      else showToast('暂无法保存素材');
                    }}
                  >存入素材库</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 画布内浮动：选中节点的配置卡 */}
        {selectedNode && (
          <div className="canvas-float canvas-node-editor" onMouseDown={e => e.stopPropagation()}>
            <div className="workflow-node-tools">
              <b>{nodeTypeMeta[selectedNode.type]?.label || selectedNode.type}</b>
              <span className="canvas-node-editor-space" />
              <button type="button" onClick={() => moveNode(selectedNode.id, 'up')} title="上移（提前执行）">上移</button>
              <button type="button" onClick={() => moveNode(selectedNode.id, 'down')} title="下移（延后执行）">下移</button>
              <label className="workflow-toggle">
                <input
                  type="checkbox"
                  checked={selectedNode.enabled !== false}
                  onChange={e => updateNode(selectedNode.id, { enabled: e.target.checked })}
                />
                启用
              </label>
              <button
                type="button"
                className="is-danger"
                onClick={() => { removeNode(selectedNode.id); setSelectedNodeId(null); }}
                title="删除节点"
              >删除</button>
            </div>

            {selectedIssues.length > 0 && (
              <div className="canvas-node-issues">
                {selectedIssues.map(issue => (
                  <span key={issue.id} className={issue.blocking ? 'blocking' : 'warn'}>
                    {issue.blocking ? '✕' : '⚠'} {issue.label}：{issue.detail}
                  </span>
                ))}
              </div>
            )}

            <div className="workflow-node-editor-grid">
              <label>
                <span>节点标题</span>
                <input value={selectedNode.title} onChange={e => updateNode(selectedNode.id, { title: e.target.value })} />
              </label>
              <label>
                <span>节点类型</span>
                <select value={selectedNode.type} onChange={e => updateNode(selectedNode.id, { type: e.target.value })}>
                  {Object.entries(nodeTypeMeta).map(([type, meta]) => (
                    <option key={type} value={type}>{meta.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>职责说明</span>
              <textarea value={selectedNode.role} onChange={e => updateNode(selectedNode.id, { role: e.target.value })} rows={2} />
            </label>
            <label>
              <span>执行指令 / Prompt</span>
              <textarea value={selectedNode.prompt} onChange={e => updateNode(selectedNode.id, { prompt: e.target.value })} rows={4} />
            </label>
            <div className="workflow-node-editor-grid">
              <label>
                <span>输入变量 inputKey</span>
                <input value={selectedNode.inputKey || ''} onChange={e => updateNode(selectedNode.id, { inputKey: e.target.value })} />
              </label>
              <label>
                <span>输出变量 outputKey</span>
                <input value={selectedNode.outputKey || ''} onChange={e => updateNode(selectedNode.id, { outputKey: e.target.value })} />
              </label>
            </div>

            {selectedNode.type === 'skill' && (
              <label>
                <span>内置 Skill 能力</span>
                <select value={selectedNode.skillId || 'evidence-pack'} onChange={e => updateNode(selectedNode.id, { skillId: e.target.value })}>
                  {WORKFLOW_SKILL_CATALOG.map(skill => (
                    <option key={skill.id} value={skill.id}>{skill.label}</option>
                  ))}
                </select>
              </label>
            )}

            {selectedNode.type === 'condition' && (
              <div className="workflow-node-editor-grid condition-grid">
                <label>
                  <span>判断指标</span>
                  <select value={selectedNode.conditionMetric || 'itemCount'} onChange={e => updateNode(selectedNode.id, { conditionMetric: e.target.value })}>
                    {WORKFLOW_CONDITION_METRICS.map(metric => (
                      <option key={metric.id} value={metric.id}>{metric.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>条件</span>
                  <select value={selectedNode.conditionOperator || '>='} onChange={e => updateNode(selectedNode.id, { conditionOperator: e.target.value })}>
                    {WORKFLOW_CONDITION_OPERATORS.map(operator => (
                      <option key={operator.id} value={operator.id}>{operator.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>阈值</span>
                  <input
                    type="number"
                    value={selectedNode.conditionValue ?? 1}
                    onChange={e => updateNode(selectedNode.id, { conditionValue: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}

            {selectedNode.type === 'classifier' && (
              <label>
                <span>分类桶</span>
                <input
                  value={selectedNode.classifierLabels || '必读,追踪,素材,创作,降噪'}
                  onChange={e => updateNode(selectedNode.id, { classifierLabels: e.target.value })}
                  placeholder="例如 必读,追踪,素材,创作,降噪"
                />
              </label>
            )}

            {selectedNode.type === 'router' && (
              <label>
                <span>路由规则（每行：分支名 | 匹配值）</span>
                <textarea
                  rows={3}
                  defaultValue={(selectedNode.routerRules || []).map(r => `${r.label} | ${r.value}`).join('\n')}
                  onBlur={e => updateNode(selectedNode.id, {
                    routerRules: String(e.target.value || '').split('\n').map(line => {
                      const [label, value] = line.split('|').map(s => (s || '').trim());
                      return { label: label || '默认分支', operator: 'contains', value: value || '' };
                    }).filter(Boolean),
                  })}
                  placeholder={'高优 | 融资\n常规 | 产品'}
                />
                <small className="canvas-node-hint">支持算子：{WORKFLOW_ROUTER_OPERATORS.map(o => o.label).join(' / ')}（当前按「包含」匹配）</small>
              </label>
            )}

            {selectedNode.type === 'parallel' && (
              <div className="workflow-node-editor-grid condition-grid">
                <label>
                  <span>并行分支数</span>
                  <input
                    type="number"
                    min={2}
                    max={8}
                    value={selectedNode.parallelBranches ?? 3}
                    onChange={e => updateNode(selectedNode.id, { parallelBranches: Math.max(2, Math.min(8, Number(e.target.value) || 3)) })}
                  />
                </label>
                <label>
                  <span>合并策略</span>
                  <select value={selectedNode.parallelMerge || 'concat'} onChange={e => updateNode(selectedNode.id, { parallelMerge: e.target.value })}>
                    {WORKFLOW_PARALLEL_MERGE_STRATEGIES.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {selectedNode.type === 'subworkflow' && (
              <label>
                <span>子工作流</span>
                <select value={selectedNode.workflowId || ''} onChange={e => updateNode(selectedNode.id, { workflowId: e.target.value })}>
                  <option value="">— 请选择 —</option>
                  {templates.filter(t => t.id !== activeWorkflowId).map(tpl => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </WorkflowCanvas>

      {/* AI 搭建面板：对话生成 / 修改节点 */}
      {aiOpen && (
        <aside className="canvas-ai-panel" onMouseDown={e => e.stopPropagation()}>
          <header className="canvas-ai-head">
            <span className="canvas-ai-title">✦ AI 搭建工作流</span>
            <span className="canvas-ai-sub">{llmConfig?.selectedModel ? llmConfig.selectedModel : '本地兜底模式'}</span>
            <button type="button" className="canvas-ai-close" onClick={() => setAiOpen(false)} title="收起">×</button>
          </header>

          <div className="canvas-ai-messages custom-scrollbar">
            {aiMessages.length === 0 && (
              <div className="canvas-ai-hint">
                <p>描述你想要的工作流，我直接在画布上搭好节点；也可以接着说「再加一个分类节点」继续改。</p>
                <button type="button" onClick={() => setAiInput('做一个每日资讯摘要工作流：抓取今日资讯，分层整理，生成三句话摘要，输出简报')}>示例：每日资讯摘要</button>
                <button type="button" onClick={() => setAiInput('帮我搭一个 GitHub 仓库评估工作流：读取仓库信息，评估价值与风险，输出是否接入的结论')}>示例：仓库评估</button>
                <button type="button" onClick={() => setAiInput('搭一个把素材库内容转成文章的工作流')}>示例：素材成稿</button>
              </div>
            )}
            {aiMessages.map((m, i) => (
              <div key={i} className={'canvas-ai-msg ' + m.role}>
                <span className="canvas-ai-msg-text">{m.content}</span>
                {m.detail && <span className="canvas-ai-msg-detail">{m.detail}</span>}
                {m.note && <span className="canvas-ai-msg-note">{m.note}</span>}
                {m.parsed && m.parsed.nodes?.length > 0 && (
                  <span className="canvas-ai-apply">
                    <button type="button" className="is-primary" onClick={() => applyAiPlan(m.parsed, 'replace')}>应用到画布（替换）</button>
                    <button type="button" onClick={() => applyAiPlan(m.parsed, 'append')}>追加节点</button>
                  </span>
                )}
              </div>
            ))}
            {aiBusy && <div className="canvas-ai-msg assistant"><span className="canvas-ai-msg-text typing">正在生成节点方案…</span></div>}
          </div>

          {undoRef.current && aiMessages.length > 0 && (
            <button type="button" className="canvas-ai-undo" onClick={undoAi}>↩ 撤销上一次 AI 变更</button>
          )}

          <div className="canvas-ai-input">
            <textarea
              rows={2}
              value={aiInput}
              placeholder="例：在最后加一个输出节点，把结论写成三条要点"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAi(); } }}
              disabled={aiBusy}
            />
            <button type="button" className="canvas-ai-send" onClick={sendAi} disabled={aiBusy || !aiInput.trim()}>
              {aiBusy ? '生成中' : '发送'}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
