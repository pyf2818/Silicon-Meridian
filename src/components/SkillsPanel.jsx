/**
 * SkillsPanel - Skills 生态管理面板（嵌入 AgentPanel 的 skills tab）
 *
 * 三种视图：
 *   1. list  - 按来源分组展示所有 skills（builtin / work / user），点击进入 detail
 *   2. detail- 展示完整 SKILL.md 内容，可编辑/删除（builtin 只读）
 *   3. edit  - 编辑表单（修改后保存），支持「表单模式」和「源码模式」切换
 *   4. new   - 新建 skill 表单（仅 work / user 来源）
 *
 * 受控：通过 props 接收 useSkills hook 的实例（与外层菜单共用同一份缓存）
 */
import { useMemo, useState } from 'react';
import { ICONS } from '../constants/appConstants.jsx';

const SOURCE_META = {
  builtin: { label: '内置',     desc: '随项目分发的官方技能，只读',     color: 'cyan'   },
  work:    { label: '工作沉淀', desc: 'Agent 工作中自动沉淀的技能',     color: 'green'  },
  user:    { label: '用户创建', desc: '你手动创建的技能',               color: 'purple' },
};

const SOURCE_ORDER = ['builtin', 'work', 'user'];

const EMPTY_FORM = {
  id: '',
  title: '',
  description: '',
  category: 'general',
  triggers: '',
  tools: '',
  tags: '',
  version: '0.1.0',
  author: '',
  body: '',
  source: 'user',
};

function sourceTagClass(source) {
  return `chat-skill-source-${source}`;
}

/** 把 skill 对象转成可编辑表单字段（数组 → 逗号分隔字符串） */
function skillToForm(skill) {
  return {
    id: skill.id || '',
    title: skill.title || '',
    description: skill.description || '',
    category: skill.category || 'general',
    triggers: Array.isArray(skill.triggers) ? skill.triggers.join(', ') : (skill.triggers || ''),
    tools: Array.isArray(skill.tools) ? skill.tools.join(', ') : (skill.tools || ''),
    tags: Array.isArray(skill.tags) ? skill.tags.join(', ') : (skill.tags || ''),
    version: skill.version || '0.1.0',
    author: skill.author || '',
    body: skill.body || '',
    source: skill.source || 'user',
  };
}

/** 把表单字段转回 skill 对象（字符串 → 数组） */
function formToSkill(form) {
  const toArray = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  return {
    id: form.id.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    category: form.category.trim() || 'general',
    triggers: toArray(form.triggers),
    tools: toArray(form.tools),
    tags: toArray(form.tags),
    version: form.version.trim() || '0.1.0',
    author: form.author.trim(),
    body: form.body,
    source: form.source,
  };
}

/** 把 skill 对象序列化为 SKILL.md 原始文本（与后端 serializeSkill 同逻辑） */
function skillToRawText(skill) {
  const meta = [];
  const pushMeta = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      meta.push(`${key}: ${value.join(', ')}`);
    } else {
      meta.push(`${key}: ${value}`);
    }
  };
  pushMeta('name', skill.id);
  pushMeta('title', skill.title);
  pushMeta('description', skill.description);
  pushMeta('category', skill.category || 'general');
  pushMeta('triggers', skill.triggers);
  pushMeta('tools', skill.tools);
  pushMeta('tags', skill.tags);
  pushMeta('version', skill.version || '0.1.0');
  pushMeta('author', skill.author);
  const body = (skill.body || '').trim();
  return `---\n${meta.join('\n')}\n---\n\n${body}\n`;
}

/** 从 SKILL.md 原始文本解析出字段（与后端 parseFrontmatter 同逻辑） */
function parseRawText(text) {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!match) return { body: (text || '').trim() };
  const metaBlock = match[1];
  const body = match[2].trim();
  const meta = {};
  for (const line of metaBlock.split('\n')) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (['triggers', 'tools', 'tags'].includes(key)) {
      value = value.split(',').map(s => s.trim()).filter(Boolean);
    }
    meta[key] = value;
  }
  return { ...meta, body };
}

export default function SkillsPanel({ skillsHook }) {
  const { bySource, loading, error, refresh, saveSkill, saveSkillRaw, createSkill, deleteSkill, importFromGitHub, importFromZip } = skillsHook;
  const [view, setView] = useState('list');        // list | detail | edit | new
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [filter, setFilter] = useState('all');     // all | builtin | work | user
  const [search, setSearch] = useState('');
  // 源码模式：切换后直接编辑 SKILL.md 原始文本（含 frontmatter）
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');

  const allSkills = useMemo(() => [
    ...(bySource.builtin || []),
    ...(bySource.work || []),
    ...(bySource.user || []),
  ], [bySource]);

  const selected = useMemo(() => allSkills.find(s => s.id === selectedId) || null, [allSkills, selectedId]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = { builtin: [], work: [], user: [] };
    for (const src of SOURCE_ORDER) {
      const list = bySource[src] || [];
      groups[src] = list.filter(s => {
        if (filter !== 'all' && s.source !== filter) return false;
        if (!q) return true;
        return (s.title || '').toLowerCase().includes(q)
          || (s.description || '').toLowerCase().includes(q)
          || (s.triggers || []).some(t => String(t).toLowerCase().includes(q))
          || (s.body || '').toLowerCase().includes(q);
      });
    }
    return groups;
  }, [bySource, filter, search]);

  // 进入 detail 视图
  const openDetail = (skill) => {
    setSelectedId(skill.id);
    setFormError(null);
    setView('detail');
  };

  // 进入 edit 视图（builtin 拒绝）
  const openEdit = (skill) => {
    if (skill.source === 'builtin') return;
    setSelectedId(skill.id);
    setForm(skillToForm(skill));
    setRawText(skillToRawText(skill));
    setRawMode(false);
    setFormError(null);
    setView('edit');
  };

  // 进入 new 视图
  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setRawText(skillToRawText({ ...EMPTY_FORM }));
    setRawMode(false);
    setFormError(null);
    setView('new');
  };

  // ===== v38 社区技能导入（Agent Skills 开放标准：SKILL.md + scripts/references/assets）=====
  const [importTab, setImportTab] = useState('github');   // github | zip
  const [githubInput, setGithubInput] = useState('');      // URL 或 owner/repo
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);        // { ok, text }

  const openImport = () => {
    setImportMsg(null);
    setView('import');
  };

  // 解析 github.com/owner/repo/tree/branch/sub/path 或裸 owner/repo
  const handleImportGitHub = async () => {
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await importFromGitHub(githubInput.trim());
      setImportMsg({ ok: true, text: `导入成功：${result.id}（${result.files} 个文件），已进入「用户创建」技能列表` });
      setGithubInput('');
    } catch (err) {
      setImportMsg({ ok: false, text: err?.message || '导入失败' });
    } finally {
      setImporting(false);
    }
  };

  const handleImportZip = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await importFromZip(file);
      setImportMsg({ ok: true, text: `导入成功：${result.id}（${result.files} 个文件），已进入「用户创建」技能列表` });
    } catch (err) {
      setImportMsg({ ok: false, text: err?.message || '导入失败' });
    } finally {
      setImporting(false);
      event.target.value = ''; // 允许重复选择同一文件
    }
  };

  // 返回列表
  const backToList = () => {
    setView('list');
    setSelectedId(null);
    setFormError(null);
    setRawMode(false);
  };

  // 切换表单/源码模式时同步内容
  const toggleRawMode = () => {
    if (rawMode) {
      // 源码 → 表单：从 rawText 反解析回 form（用后端同款 frontmatter 解析逻辑）
      const parsed = parseRawText(rawText);
      setForm(prev => ({
        ...prev,
        id: parsed.name || form.id,
        title: parsed.title || '',
        description: parsed.description || '',
        category: parsed.category || 'general',
        triggers: Array.isArray(parsed.triggers) ? parsed.triggers.join(', ') : '',
        tools: Array.isArray(parsed.tools) ? parsed.tools.join(', ') : '',
        tags: Array.isArray(parsed.tags) ? parsed.tags.join(', ') : '',
        version: parsed.version || '0.1.0',
        author: parsed.author || '',
        body: parsed.body || '',
      }));
    } else {
      // 表单 → 源码：从 form 序列化成 rawText
      setRawText(skillToRawText(formToSkill(form)));
    }
    setRawMode(!rawMode);
  };

  // 保存编辑
  const handleSave = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (rawMode) {
        // 源码模式：直接保存原始文本
        const parsed = parseRawText(rawText);
        const id = parsed.name || form.id;
        const source = form.source;
        await saveSkillRaw(source, id, rawText);
        setSelectedId(id);
      } else {
        // 表单模式：字段级保存
        const skill = formToSkill(form);
        await saveSkill(skill);
        setSelectedId(skill.id);
      }
      setView('detail');
    } catch (err) {
      setFormError(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 创建新 skill
  const handleCreate = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (rawMode) {
        // 源码模式：从 rawText 解析 id/source，直接写盘
        const parsed = parseRawText(rawText);
        const id = parsed.name || form.id;
        const source = form.source;
        if (!id) throw new Error('源码中未找到 name 字段（用于 skill id）');
        await saveSkillRaw(source, id, rawText);
        setSelectedId(id);
      } else {
        const skill = formToSkill(form);
        await createSkill(skill);
        setSelectedId(skill.id);
      }
      setView('detail');
    } catch (err) {
      setFormError(err?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  // 删除 skill
  const handleDelete = async (skill) => {
    if (skill.source === 'builtin') return;
    if (!window.confirm(`确定删除技能「${skill.title}」吗？此操作不可恢复。`)) return;
    setSaving(true);
    setFormError(null);
    try {
      await deleteSkill(skill.id);
      backToList();
    } catch (err) {
      setFormError(err?.message || '删除失败');
    } finally {
      setSaving(false);
    }
  };

  // 修改表单字段
  const updateField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  /* ===================== 视图：detail ===================== */
  if (view === 'detail' && selected) {
    const meta = SOURCE_META[selected.source] || SOURCE_META.user;
    const readonly = selected.source === 'builtin';
    return (
      <div className="skills-panel-detail">
        <div className="skills-panel-back">
          <button type="button" className="skills-back-btn" onClick={backToList} title="返回列表">
            <span className="icon-sm">{ICONS.chevronLeft}</span>
            返回
          </button>
          <div className="skills-detail-actions">
            {!readonly && (
              <button type="button" className="skills-action-btn edit" onClick={() => openEdit(selected)} title="编辑">
                <span className="icon-sm">{ICONS.edit}</span>
                编辑
              </button>
            )}
            {!readonly && (
              <button type="button" className="skills-action-btn delete" onClick={() => handleDelete(selected)} title="删除" disabled={saving}>
                <span className="icon-sm">{ICONS.trash}</span>
                删除
              </button>
            )}
          </div>
        </div>

        <div className="skills-detail-head">
          <div className="skills-detail-title-row">
            <h3 className="skills-detail-title">{selected.title}</h3>
            <span className={`chat-skill-group-tag ${sourceTagClass(selected.source)}`}>{meta.label}</span>
          </div>
          {selected.description && <p className="skills-detail-desc">{selected.description}</p>}
          <div className="skills-detail-meta">
            <div className="skills-meta-row"><span className="skills-meta-label">ID</span><code className="skills-meta-value">{selected.id}</code></div>
            <div className="skills-meta-row"><span className="skills-meta-label">分类</span><span className="skills-meta-value">{selected.category}</span></div>
            <div className="skills-meta-row"><span className="skills-meta-label">版本</span><span className="skills-meta-value">{selected.version}</span></div>
            {selected.author && <div className="skills-meta-row"><span className="skills-meta-label">作者</span><span className="skills-meta-value">{selected.author}</span></div>}
            {selected.triggers?.length > 0 && (
              <div className="skills-meta-row">
                <span className="skills-meta-label">触发词</span>
                <div className="skills-meta-tags">
                  {selected.triggers.map(t => <span key={t} className="skills-meta-tag">{t}</span>)}
                </div>
              </div>
            )}
            {selected.tools?.length > 0 && (
              <div className="skills-meta-row">
                <span className="skills-meta-label">工具</span>
                <div className="skills-meta-tags">
                  {selected.tools.map(t => <span key={t} className="skills-meta-tag tool">{t}</span>)}
                </div>
              </div>
            )}
            {selected.tags?.length > 0 && (
              <div className="skills-meta-row">
                <span className="skills-meta-label">标签</span>
                <div className="skills-meta-tags">
                  {selected.tags.map(t => <span key={t} className="skills-meta-tag">{t}</span>)}
                </div>
              </div>
            )}
          </div>
          {readonly && <div className="skills-readonly-hint">内置技能只读，可基于此创建用户技能进行修改</div>}
        </div>

        <div className="skills-detail-body custom-scrollbar">
          <pre className="skills-md-pre">{selected.body || '（无内容）'}</pre>
        </div>

        {formError && <div className="skills-form-error">{formError}</div>}
      </div>
    );
  }

  /* ===================== 视图：edit / new ===================== */
  if (view === 'edit' || view === 'new') {
    const isNew = view === 'new';
    const isIdLocked = !isNew; // 编辑时 id 不可改
    return (
      <div className="skills-panel-form">
        <div className="skills-panel-back">
          <button type="button" className="skills-back-btn" onClick={backToList} title="返回列表">
            <span className="icon-sm">{ICONS.chevronLeft}</span>
            返回
          </button>
          <span className="skills-form-title">{isNew ? '新建技能' : '编辑技能'}</span>
          <button
            type="button"
            className={`skills-mode-toggle ${rawMode ? 'is-raw' : ''}`}
            onClick={toggleRawMode}
            title={rawMode ? '切换到表单模式' : '切换到源码模式（编辑原始 Markdown）'}
          >
            {rawMode ? '源码模式' : '表单模式'}
          </button>
        </div>

        {rawMode ? (
          /* ---------- 源码模式：直接编辑 SKILL.md 原始文本 ---------- */
          <div className="skills-form-body custom-scrollbar skills-raw-editor-wrap">
            <div className="skills-form-row">
              <label className="skills-form-label">来源</label>
              <select
                className="skills-form-select"
                value={form.source}
                onChange={e => updateField('source', e.target.value)}
                disabled={isIdLocked}
              >
                <option value="user">用户创建</option>
                <option value="work">工作沉淀</option>
                <option value="builtin" disabled>内置（只读）</option>
              </select>
            </div>
            <div className="skills-form-row">
              <label className="skills-form-label">SKILL.md 原始内容</label>
              <textarea
                className="skills-raw-textarea"
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                spellCheck={false}
                rows={24}
                placeholder={'---\nname: my-skill\ntitle: 我的技能\ndescription: 一句话描述\ntriggers: 关键词1, 关键词2\ntools: search_news, fetch_page\nversion: 0.1.0\n---\n\n# 技能说明\n\nPrompt 模板正文…'}
              />
              <span className="skills-form-hint">
                直接编辑 frontmatter + body，保存后后端原样写盘（不做字段级序列化）
              </span>
            </div>
          </div>
        ) : (
          /* ---------- 表单模式：字段级编辑 ---------- */
          <div className="skills-form-body custom-scrollbar">
            <div className="skills-form-row">
              <label className="skills-form-label">来源</label>
              <select
                className="skills-form-select"
                value={form.source}
                onChange={e => updateField('source', e.target.value)}
                disabled={isIdLocked}
              >
                <option value="user">用户创建</option>
                <option value="work">工作沉淀</option>
                <option value="builtin" disabled>内置（只读）</option>
              </select>
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">ID <span className="skills-form-required">*</span></label>
              <input
                type="text"
                className="skills-form-input"
                value={form.id}
                onChange={e => updateField('id', e.target.value)}
                placeholder="kebab-case，如 my-skill"
                disabled={isIdLocked}
                spellCheck={false}
              />
              <span className="skills-form-hint">唯一标识，仅小写字母/数字/连字符</span>
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">标题 <span className="skills-form-required">*</span></label>
              <input
                type="text"
                className="skills-form-input"
                value={form.title}
                onChange={e => updateField('title', e.target.value)}
                placeholder="技能展示名"
                spellCheck={false}
              />
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">描述</label>
              <input
                type="text"
                className="skills-form-input"
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                placeholder="一句话说明技能用途"
                spellCheck={false}
              />
            </div>

            <div className="skills-form-row two-col">
              <div>
                <label className="skills-form-label">分类</label>
                <input
                  type="text"
                  className="skills-form-input"
                  value={form.category}
                  onChange={e => updateField('category', e.target.value)}
                  placeholder="research / writing / analysis"
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="skills-form-label">版本</label>
                <input
                  type="text"
                  className="skills-form-input"
                  value={form.version}
                  onChange={e => updateField('version', e.target.value)}
                  placeholder="0.1.0"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">触发词</label>
              <input
                type="text"
                className="skills-form-input"
                value={form.triggers}
                onChange={e => updateField('triggers', e.target.value)}
                placeholder="逗号分隔，如 简报, 早报, briefing"
                spellCheck={false}
              />
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">依赖工具</label>
              <input
                type="text"
                className="skills-form-input"
                value={form.tools}
                onChange={e => updateField('tools', e.target.value)}
                placeholder="逗号分隔，如 search_news, fetch_page"
                spellCheck={false}
              />
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">标签</label>
              <input
                type="text"
                className="skills-form-input"
                value={form.tags}
                onChange={e => updateField('tags', e.target.value)}
                placeholder="逗号分隔"
                spellCheck={false}
              />
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">作者</label>
              <input
                type="text"
                className="skills-form-input"
                value={form.author}
                onChange={e => updateField('author', e.target.value)}
                placeholder="留空则不显示"
                spellCheck={false}
              />
            </div>

            <div className="skills-form-row">
              <label className="skills-form-label">Prompt 模板 / 说明（Markdown）</label>
              <textarea
                className="skills-form-textarea"
                value={form.body}
                onChange={e => updateField('body', e.target.value)}
                rows={12}
                spellCheck={false}
                placeholder={'# 技能说明\n\n在此编写 Prompt 模板、使用示例、注意事项等 Markdown 内容'}
              />
            </div>
          </div>
        )}

        {formError && <div className="skills-form-error">{formError}</div>}

        <div className="skills-form-actions">
          <button type="button" className="skills-form-cancel" onClick={backToList} disabled={saving}>取消</button>
          <button
            type="button"
            className="skills-form-submit"
            onClick={isNew ? handleCreate : handleSave}
            disabled={saving || (!rawMode && (!form.id.trim() || !form.title.trim()))}
          >
            {saving ? '保存中…' : (isNew ? '创建' : '保存')}
          </button>
        </div>
      </div>
    );
  }

  /* ===================== 视图：import（v38 社区导入） ===================== */
  if (view === 'import') {
    return (
      <div className="skills-panel-form">
        <div className="skills-panel-back">
          <button type="button" className="skills-back-btn" onClick={backToList} title="返回列表">
            <span className="icon-sm">{ICONS.chevronLeft}</span>
            返回
          </button>
          <span className="skills-form-title">导入社区技能</span>
        </div>

        <div className="skills-form-body custom-scrollbar">
          <p className="skills-import-note">
            兼容 Agent Skills 开放标准（SKILL.md + scripts/references/assets），从 GitHub 仓库子目录或 zip 包导入，
            安装为「用户创建」技能。导入的脚本不会自动执行——agent 使用前会先读取源码并请求你的审批。
          </p>

          <div className="skills-filter-row" role="tablist">
            <button
              type="button"
              className={`skills-filter-tag${importTab === 'github' ? ' is-active' : ''}`}
              onClick={() => setImportTab('github')}
            >从 GitHub 导入</button>
            <button
              type="button"
              className={`skills-filter-tag${importTab === 'zip' ? ' is-active' : ''}`}
              onClick={() => setImportTab('zip')}
            >从 zip 导入</button>
          </div>

          {importTab === 'github' ? (
            <div className="skills-form-row">
              <label className="skills-form-label">仓库地址或技能子目录</label>
              <input
                type="text"
                className="skills-form-input"
                value={githubInput}
                onChange={e => setGithubInput(e.target.value)}
                placeholder="anthropics/skills 或 https://github.com/anthropics/skills/tree/main/skills/pdf"
                spellCheck={false}
                disabled={importing}
              />
              <span className="skills-import-hint">
                指向某个技能目录（其下须有 SKILL.md）。免认证 GitHub API 限 60 次/小时，批量导入建议用 zip。
              </span>
              <button
                type="button"
                className="skills-form-submit"
                onClick={handleImportGitHub}
                disabled={importing || !githubInput.trim()}
              >
                {importing ? '导入中…' : '开始导入'}
              </button>
            </div>
          ) : (
            <div className="skills-form-row">
              <label className="skills-form-label">选择技能 zip 包</label>
              <input
                type="file"
                accept=".zip"
                className="skills-form-input"
                onChange={handleImportZip}
                disabled={importing}
              />
              <span className="skills-import-hint">
                zip ≤10MB，单技能包（内含一个 SKILL.md；技能集合包请拆分后逐个导入）。
              </span>
            </div>
          )}

          {importMsg && (
            <div className={importMsg.ok ? 'skills-import-ok' : 'skills-form-error'}>{importMsg.text}</div>
          )}
        </div>
      </div>
    );
  }

  /* ===================== 视图：list（默认） ===================== */
  return (
    <div className="skills-panel-list">
      {/* 顶部工具条：搜索 + 新建 + 刷新 */}
      <div className="skills-toolbar">
        <div className="skills-search">
          <span className="icon-sm skills-search-icon">{ICONS.search}</span>
          <input
            type="text"
            className="skills-search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索技能…"
            spellCheck={false}
          />
          {search && (
            <button type="button" className="skills-search-clear" onClick={() => setSearch('')} title="清除">
              <span className="icon-sm">{ICONS.x}</span>
            </button>
          )}
        </div>
        <button type="button" className="skills-new-btn" onClick={openImport} title="从 GitHub / zip 导入社区技能">
          <span className="icon-sm">{ICONS.download}</span>
          导入
        </button>
        <button type="button" className="skills-new-btn" onClick={openNew} title="新建技能">
          <span className="icon-sm">{ICONS.plus}</span>
          新建
        </button>
        <button type="button" className="skills-refresh-btn" onClick={() => refresh()} title="重新扫描" disabled={loading}>
          <span className="icon-sm">{ICONS.refresh}</span>
        </button>
      </div>

      {/* 过滤标签 */}
      <div className="skills-filter-row">
        {['all', ...SOURCE_ORDER].map(key => {
          const isActive = filter === key;
          const label = key === 'all' ? '全部' : SOURCE_META[key].label;
          const count = key === 'all' ? allSkills.length : (bySource[key] || []).length;
          return (
            <button
              key={key}
              type="button"
              className={`skills-filter-pill ${isActive ? 'active' : ''} ${key !== 'all' ? sourceTagClass(key) : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
              <span className="skills-filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* 列表区 */}
      <div className="skills-list custom-scrollbar">
        {loading && allSkills.length === 0 && (
          <div className="skills-list-empty">加载中…</div>
        )}
        {error && (
          <div className="skills-list-error">加载失败：{error}</div>
        )}
        {!loading && !error && allSkills.length === 0 && (
          <div className="skills-list-empty">
            暂无技能。点击右上角「新建」创建第一个，或在项目根 <code>skills/</code> 目录下添加 SKILL.md。
          </div>
        )}

        {!error && SOURCE_ORDER.map(source => {
          const list = filteredGroups[source] || [];
          if (list.length === 0) return null;
          const meta = SOURCE_META[source];
          return (
            <div key={source} className="skills-group">
              <div className="skills-group-label">
                <span className={`chat-skill-group-tag ${sourceTagClass(source)}`}>{meta.label}</span>
                <span className="skills-group-count">{list.length}</span>
                <span className="skills-group-desc">{meta.desc}</span>
              </div>
              <ul className="skills-group-list">
                {list.map(skill => (
                  <li key={skill.id}>
                    <button
                      type="button"
                      className="skills-card"
                      onClick={() => openDetail(skill)}
                      title={skill.description || skill.title}
                    >
                      <div className="skills-card-head">
                        <span className="skills-card-title">{skill.title}</span>
                        <span className="icon-sm skills-card-arrow">{ICONS.chevronRight}</span>
                      </div>
                      {skill.description && <p className="skills-card-desc">{skill.description}</p>}
                      <div className="skills-card-meta">
                        {skill.triggers?.length > 0 && (
                          <span className="skills-card-triggers">
                            {skill.triggers.slice(0, 3).map(t => `#${t}`).join(' ')}
                          </span>
                        )}
                        {skill.tools?.length > 0 && (
                          <span className="skills-card-tools">{skill.tools.length} 工具</span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {!loading && !error && filter !== 'all' && filteredGroups[filter]?.length === 0 && (
          <div className="skills-list-empty">该来源下暂无技能。</div>
        )}
      </div>

      {formError && <div className="skills-form-error">{formError}</div>}
    </div>
  );
}
