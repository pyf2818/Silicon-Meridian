/**
 * CanvasPage - 无限画布（v14 独立模块 · 纯画布形态）
 *
 * 页面就是画布本身，独占全部空间：
 * - 画布内浮动元素只有三组：左上角工作流名（点按改名）、右上角两个动作
 *   （存为模板 / 恢复默认）、选中节点时的节点配置卡（画布编辑器的必要组成）
 * - 节点来源：左侧 palette 拖拽创建；连线即执行顺序（与 workflowEngine 语义一致）
 * - 搭好的工作流在 AI 工作站输入框「工作流」按钮里选择调用
 */
import { useState } from 'react';
import WorkflowCanvas from './WorkflowCanvas.jsx';
import {
  WORKFLOW_SKILL_CATALOG,
  WORKFLOW_CONDITION_METRICS,
  WORKFLOW_CONDITION_OPERATORS,
} from '../../constants/workflowConstants.js';

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
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== draft.name) updateDraft({ name: next.slice(0, 32) });
    setEditingName(false);
  };

  return (
    <div className="canvas-page">
      <WorkflowCanvas
        nodes={draft.nodes}
        selectedId={selectedNodeId}
        onSelect={setSelectedNodeId}
        onMoveNode={(id, x, y) => updateNode(id, { position: { x, y } })}
        onCreateNodeAt={(type, x, y) => addNode({ x, y }, type)}
        nodeTypeMeta={nodeTypeMeta}
        selectedNode={selectedNode}
      >
        {/* 画布内浮动：工作流名（左上） */}
        <div className="canvas-float canvas-float-name" onMouseDown={e => e.stopPropagation()}>
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
              title="点击重命名工作流（名称会出现在工作站的工作流选择器里）"
            >
              {draft.name || '未命名工作流'}
              <small>{(draft.nodes || []).length} 节点</small>
            </button>
          )}
        </div>

        {/* 画布内浮动：动作（右上） */}
        <div className="canvas-float canvas-float-actions" onMouseDown={e => e.stopPropagation()}>
          <button type="button" onClick={() => saveAsTemplate({ name: draft.name })} disabled={!draft.nodes?.length} title="把当前画布存为模板（工作站工作流选择器可见）">
            存为模板
          </button>
          <button type="button" onClick={() => { if (window.confirm('恢复默认工作流模板？当前画布将被覆盖。')) { resetDraft(); setSelectedNodeId(null); } }} title="恢复默认模板">
            恢复默认
          </button>
          {templates.length > 0 && (
            <span className="canvas-templates-wrap">
              <button type="button" onClick={() => setShowTemplates(v => !v)} title="载入已保存的模板">模板（{templates.length}）</button>
              {showTemplates && (
                <div className="canvas-templates-pop">
                  {templates.map(tpl => (
                    <button
                      key={tpl.id || tpl.name}
                      type="button"
                      onClick={() => {
                        const target = templates.find(x => (x.id || x.name) === (tpl.id || tpl.name));
                        if (target) updateDraft({ name: target.name, description: target.description || '', nodes: target.nodes });
                        setShowTemplates(false);
                        setSelectedNodeId(null);
                      }}
                    >
                      {tpl.name}
                      <small>{(tpl.nodes || []).length} 节点</small>
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>

        {/* 画布内浮动：选中节点的配置卡（右下） */}
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
            <div className="workflow-node-editor-grid">
              <label>
                <span>节点标题</span>
                <input
                  value={selectedNode.title}
                  onChange={e => updateNode(selectedNode.id, { title: e.target.value })}
                />
              </label>
              <label>
                <span>节点类型</span>
                <select
                  value={selectedNode.type}
                  onChange={e => updateNode(selectedNode.id, { type: e.target.value })}
                >
                  {Object.entries(nodeTypeMeta).map(([type, meta]) => (
                    <option key={type} value={type}>{meta.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>职责说明</span>
              <textarea
                value={selectedNode.role}
                onChange={e => updateNode(selectedNode.id, { role: e.target.value })}
                rows={2}
              />
            </label>
            <label>
              <span>执行指令 / Prompt</span>
              <textarea
                value={selectedNode.prompt}
                onChange={e => updateNode(selectedNode.id, { prompt: e.target.value })}
                rows={4}
              />
            </label>
            {selectedNode.type === 'skill' && (
              <label>
                <span>内置 Skill 能力</span>
                <select
                  value={selectedNode.skillId || 'evidence-pack'}
                  onChange={e => updateNode(selectedNode.id, { skillId: e.target.value })}
                >
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
                  <select
                    value={selectedNode.conditionMetric || 'itemCount'}
                    onChange={e => updateNode(selectedNode.id, { conditionMetric: e.target.value })}
                  >
                    {WORKFLOW_CONDITION_METRICS.map(metric => (
                      <option key={metric.id} value={metric.id}>{metric.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>条件</span>
                  <select
                    value={selectedNode.conditionOperator || '>='}
                    onChange={e => updateNode(selectedNode.id, { conditionOperator: e.target.value })}
                  >
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
            {selectedNode.type === 'subworkflow' && (
              <label>
                <span>子工作流</span>
                <select
                  value={selectedNode.workflowId || ''}
                  onChange={e => updateNode(selectedNode.id, { workflowId: e.target.value })}
                >
                  <option value="">— 请选择 —</option>
                  {templates.map(tpl => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </WorkflowCanvas>
    </div>
  );
}
