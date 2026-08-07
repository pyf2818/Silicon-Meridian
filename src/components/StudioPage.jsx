import { useMemo, useState, useEffect } from 'react';
import CreativeWorkspace from './CreativeWorkspace.jsx';
import { ICONS } from '../constants/index.jsx';
import { renderMarkdown } from '../utils/markdown.jsx';

export default function StudioPage({
  goNav,
  creativeWorkspace,
  materials,
  articles,
  agents,
  createArticle,
  setCurrentArticleId,
  setEditorTab,
  setEditingAgent,
  setNewAgent,
  setShowAgentForm,
}) {
  // 创作流水线三段：原料 → 熔炉 → 作品
  const pipelineStages = useMemo(() => [
    {
      id: 'materials',
      index: '01',
      stage: '原料入库',
      title: '素材库',
      desc: '收集资讯卡片、每日汇报、本地上传与创作片段，按空间和标签形成可复用资产。',
      metric: materials.length,
      unit: '条素材',
      action: '进入素材库',
      nav: 'materials',
      icon: 'layers'
    },
    {
      id: 'agents',
      index: '02',
      stage: '熔炉炼金',
      title: '智能体工作流',
      desc: '用输入、大模型 Prompt、工具 Skills、条件分支、分类判断和输出节点编排协作流程。',
      metric: agents.length,
      unit: '个智能体',
      action: '搭建工作流',
      nav: 'agents',
      icon: 'bot',
      core: true
    },
    {
      id: 'editor',
      index: '03',
      stage: '终成作品',
      title: '内容创作',
      desc: '联动素材库和智能体，把情报、观点和资料沉淀成文章、报告与私有知识库资产。',
      metric: articles.length,
      unit: '篇文章',
      action: '开始写作',
      nav: 'editor',
      icon: 'edit'
    }
  ], [materials.length, agents.length, articles.length]);

  const workflowNodeTypes = useMemo(() => [
    { type: '输入', desc: '接收资讯、素材、文件或人工指令' },
    { type: '大模型 Prompt', desc: '调用已配置模型执行分析与生成' },
    { type: '工具 Skills', desc: '接入搜索、整理、导出、格式化等能力' },
    { type: '条件语句', desc: '按质量、领域、置信度分流任务' },
    { type: '分类语句', desc: '识别主题、应用场景、风险等级' },
    { type: '指定回复', desc: '沉淀可复用的固定输出结构' },
    { type: '输出', desc: '导出到素材库、文章或本地知识库' }
  ], []);

  // 工作空间文件预览侧边 panel（双击触发）
  const [previewAsset, setPreviewAsset] = useState(null);
  useEffect(() => {
    if (!previewAsset) return;
    const onKey = e => { if (e.key === 'Escape') setPreviewAsset(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewAsset]);
  const previewContent = previewAsset ? (previewAsset.fullContent || previewAsset.content || previewAsset.summary || '') : '';

  return (
    <div className="product-page studio-page">
      {/* ============ HERO：使命宣言 + 资产遥测 ============ */}
      <section className="st-hero">
        <div className="st-hero-grid-bg" aria-hidden="true" />
        <div className="st-hero-main">
          <div className="st-kicker"><span className="st-kicker-dot" />CREATION INTELLIGENCE</div>
          <h1 className="st-title">智创中心</h1>
          <p className="st-subtitle">把每日汇报、资讯卡片、本地资料和智能体工作流汇入同一个创作空间，形成可持续积累的个人知识资产。</p>
          <div className="st-quickstart">
            <span className="st-quickstart-label">{ICONS.sparkles} 快速开始</span>
            <button type="button" className="st-quick-btn" onClick={() => { const a = createArticle('blank'); setCurrentArticleId(a.id); setEditorTab('edit'); goNav('editor'); }}>
              {ICONS.edit}<strong>新建文章</strong><em>空白模板起步</em>
            </button>
            <button type="button" className="st-quick-btn" onClick={() => { setEditingAgent(null); setNewAgent({ name: '', description: '', systemPrompt: '', category: '分析', avatar: '' }); setShowAgentForm(true); goNav('agents'); }}>
              {ICONS.bot}<strong>新建智能体</strong><em>自定义 Prompt 与技能</em>
            </button>
            <button type="button" className="st-quick-btn" onClick={() => goNav('materials')}>
              {ICONS.layers}<strong>添加素材</strong><em>从资讯或本地上传</em>
            </button>
          </div>
        </div>
        <div className="st-hero-stats">
          {pipelineStages.map(s => (
            <button type="button" key={s.id} className={`st-stat${s.core ? ' st-stat-core' : ''}`} onClick={() => goNav(s.nav)}>
              <span className="st-stat-value">{s.metric}</span>
              <span className="st-stat-label">{s.unit}</span>
              <span className="st-stat-bar" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      {/* ============ 创作流水线：原料 → 熔炉 → 作品 ============ */}
      <section className="st-pipeline">
        <div className="st-section-head">
          <h2 className="st-section-title"><span className="st-section-index">§1</span>创作流水线</h2>
          <p className="st-section-desc">原料入库，熔炉炼金，终成作品 —— 点击任意一段进入对应工作区。</p>
        </div>
        <div className="st-pipe-track">
          {pipelineStages.map((s, i) => (
            <div className="st-pipe-segment" key={s.id}>
              <button type="button" className={`st-pipe-node${s.core ? ' st-pipe-core' : ''}`} onClick={() => goNav(s.nav)}>
                <span className="st-pipe-top">
                  <span className="st-pipe-index">{s.index}</span>
                  <span className="st-pipe-stage">{s.stage}</span>
                </span>
                <span className="st-pipe-icon">{ICONS[s.icon]}</span>
                <span className="st-pipe-title">{s.title}</span>
                <span className="st-pipe-metric"><strong>{s.metric}</strong> {s.unit}</span>
                <span className="st-pipe-desc">{s.desc}</span>
                <span className="st-pipe-cta">{s.action} {ICONS.arrowRight}</span>
              </button>
              {i < pipelineStages.length - 1 && (
                <span className="st-pipe-link" aria-hidden="true">
                  <span className="st-pipe-particle" />
                  <span className="st-pipe-particle st-pipe-particle-b" />
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ============ 创意工作台（保留全部业务能力） ============ */}
      <CreativeWorkspace
        workspace={creativeWorkspace}
        onOpenEditor={() => goNav('editor')}
        onOpenMaterials={() => goNav('materials')}
      />

      {/* ============ 节点图鉴：工作流的七种积木 ============ */}
      <section className="st-nodes">
        <div className="st-section-head">
          <h2 className="st-section-title"><span className="st-section-index">§2</span>工作流节点图鉴</h2>
          <p className="st-section-desc">七种积木拼出任意智能体流程，点击节点前往编排。</p>
        </div>
        <div className="st-node-strip">
          {workflowNodeTypes.map((node, index) => (
            <button key={node.type} type="button" className="st-node-card" onClick={() => goNav('agents')}>
              <span className="st-node-num">{String(index + 1).padStart(2, '0')}</span>
              <strong>{node.type}</strong>
              <p>{node.desc}</p>
              {index < workflowNodeTypes.length - 1 && <span className="st-node-arrow" aria-hidden="true">{ICONS.arrowRight}</span>}
            </button>
          ))}
        </div>
      </section>

      {/* ============ 资产速览 ============ */}
      <section className="st-assets">
        <div className="st-asset-panel">
          <div className="st-asset-panel-head">
            <h3>{ICONS.layers} 最近素材</h3>
            <button type="button" onClick={() => goNav('materials')}>管理素材库（{materials.length}）</button>
          </div>
          {materials.length > 0 ? (
            <ul className="studio-asset-list studio-asset-list-clickable">
              {materials.slice(0, 3).map(m => (
                <li key={m.id} className="has-dblclick" onDoubleClick={() => setPreviewAsset(m)} title="双击在侧边预览">
                  <strong>{m.title}</strong>
                  <p>{m.summary || (m.content ? String(m.content).slice(0, 120) : '') || '—'}</p>
                  <span className="studio-asset-open">{ICONS.arrowRight}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="st-asset-empty">
              <span className="st-asset-empty-icon">{ICONS.layers}</span>
              <strong>还没有沉淀素材</strong>
              <p>从资讯卡片、每日汇报或本地上传开始收集。</p>
              <button type="button" onClick={() => goNav('materials')}>去收集素材</button>
            </div>
          )}
        </div>
        <div className="st-asset-panel">
          <div className="st-asset-panel-head">
            <h3>{ICONS.edit} 创作资产</h3>
            <button type="button" onClick={() => goNav('editor')}>打开编辑器（{articles.length}）</button>
          </div>
          {articles.length > 0 ? (
            <ul className="studio-asset-list">
              {articles.slice(0, 3).map(a => (
                <li key={a.id}><strong>{a.title}</strong><p>{a.template === 'briefing' ? '简报模板' : a.template === 'weekly' ? '周报模板' : '空白文章'} · {new Date(a.updatedAt).toLocaleDateString('zh-CN')}</p></li>
              ))}
            </ul>
          ) : (
            <div className="st-asset-empty">
              <span className="st-asset-empty-icon">{ICONS.edit}</span>
              <strong>准备你的第一篇内容</strong>
              <p>内容创作区联动素材库与智能体输出。</p>
              <button type="button" onClick={() => goNav('editor')}>开始写作</button>
            </div>
          )}
        </div>
      </section>

      {previewAsset && (
        <>
          <div className="workspace-side-panel-backdrop" onClick={() => setPreviewAsset(null)} />
          <aside className="workspace-side-panel" role="dialog" aria-modal="false" aria-label="素材预览">
            <div className="workspace-side-panel-head">
              <div className="workspace-side-panel-meta">
                <span className="workspace-side-panel-type">{previewAsset.type || 'material'}</span>
                <h3>{previewAsset.title || '未命名素材'}</h3>
                {previewAsset.source && <span className="workspace-side-panel-path">来源：{previewAsset.source}</span>}
              </div>
              <button className="workspace-side-panel-close" onClick={() => setPreviewAsset(null)} title="关闭 (Esc)">{ICONS.x}</button>
            </div>
            <div className="workspace-side-panel-body">
              {previewContent ? renderMarkdown(previewContent) : <p className="workspace-side-panel-empty">该素材暂无可显示内容</p>}
            </div>
            <div className="workspace-side-panel-foot">
              {previewAsset.url && (
                <a href={previewAsset.url} target="_blank" rel="noreferrer" className="workspace-side-panel-link">查看原文</a>
              )}
              <button className="workspace-side-panel-action" onClick={() => { setPreviewAsset(null); goNav('materials'); }}>在素材库中管理</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
