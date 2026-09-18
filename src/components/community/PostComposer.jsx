import { useEffect, useMemo, useRef, useState } from 'react';
import CommunityAvatar from './CommunityAvatar.jsx';
import PostCover from './PostCover.jsx';
import { MascotFigure } from './MascotState.jsx';
import {
  clearComposerDraft, emptyDraft, isDraftMeaningful, loadComposerDraft, normalizeDraft, saveComposerDraft,
} from '../../domain/community/composerDraft.js';
import { CHANNEL_LABELS, stripMarkdown } from '../../domain/community/visualIdentity.js';
import { showToast } from '../../utils/toast.js';

const TYPE_OPTIONS = [
  { value: 'article', label: '文章', hint: '长文讨论与观点' },
  { value: 'work', label: '作品', hint: '创作成果展示' },
  { value: 'workflow', label: '工作流', hint: '智能体流程分享' },
  { value: 'briefing', label: '速报', hint: '短平快消息' },
];
const CHANNEL_OPTIONS = ['discussion', 'review', 'share', 'qa'];
const VISIBILITY_OPTIONS = [
  { value: 'public', label: '公开' },
  { value: 'followers', label: '仅关注者' },
  { value: 'private', label: '仅自己' },
];
const SCENE_TAGS = ['AI厂商', '模型评测', '开源项目', '创作分享', '行业观点'];
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 24;
const MAX_SUMMARY = 120;

/** 从正文提取第一张 Markdown 图片 URL（封面第二档来源） */
export function extractFirstImage(body) {
  const match = String(body || '').match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/);
  const url = match ? match[1].trim() : '';
  return /^https:\/\//i.test(url) ? url : '';
}

function SectionTitle({ index, title, hint }) {
  return (
    <div className="composer-section-title">
      <span className="composer-section-bar" />
      <b>{title}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * B3 发布器：分区式表单 + 封面三档 + 摘要自动提取 + 标签编辑 + 实时预览 + 草稿暂存。
 * 保留 v24 导入能力（素材库 / AI 工作站成果）。
 */
export default function PostComposer({ user, materials = [], workbenchDeliverable = null, onClose, onPublished }) {
  const [form, setForm] = useState(emptyDraft);
  const [draftBanner, setDraftBanner] = useState(null);
  const [tagInput, setTagInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(null); // null | 'materials' | 'workbench'
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const restoredRef = useRef(false);

  // 打开发布器：恢复草稿（类型自愈在 normalizeDraft 里兜底）
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const draft = loadComposerDraft();
    if (draft && isDraftMeaningful(draft)) {
      setForm(draft);
      const when = draft.savedAt ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(draft.savedAt)) : '';
      setDraftBanner(when ? `已恢复 ${when} 的未发布草稿` : '已恢复未发布草稿');
    }
  }, []);

  // 自动暂存：字段变化即写（脏数据在 saveComposerDraft 里 normalize 清洗）
  useEffect(() => { saveComposerDraft(form); }, [form]);

  // 有内容时拦误关
  useEffect(() => {
    if (!isDraftMeaningful(form)) return undefined;
    const handler = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [form]);

  const patch = updates => setForm(previous => ({ ...previous, ...updates }));

  const extractedImage = useMemo(() => extractFirstImage(form.body), [form.body]);
  const autoSummary = useMemo(() => stripMarkdown(form.body).slice(0, MAX_SUMMARY), [form.body]);

  const addTag = rawValue => {
    const value = String(rawValue || '').replace(/[,，#]/g, '').trim().slice(0, MAX_TAG_LENGTH);
    if (!value || form.tags.includes(value) || form.tags.length >= MAX_TAGS) return;
    patch({ tags: [...form.tags, value] });
  };
  const removeTag = tag => patch({ tags: form.tags.filter(item => item !== tag) });

  const coverPreview = form.cover.kind === 'auto' || !form.cover.url
    ? { kind: 'auto' }
    : { kind: form.cover.kind, url: form.cover.url };

  const publish = async () => {
    if (!form.title.trim() || !form.body.trim() || publishing) return;
    if (form.cover.kind !== 'auto' && form.cover.url && !/^https:\/\//i.test(form.cover.url)) {
      setPublishError('封面图片需为 https 链接');
      return;
    }
    setPublishing(true); setPublishError('');
    try {
      const post = await onPublished({
        type: form.type,
        channel: form.channel,
        title: form.title.trim(),
        body: form.body,
        summary: form.summary.trim(),
        tags: form.tags,
        cover: form.cover.kind === 'auto' || !form.cover.url ? { kind: 'auto' } : { kind: form.cover.kind, url: form.cover.url.trim() },
        visibility: form.visibility,
      });
      clearComposerDraft();
      showToast('发布成功，川川帮你顶上去～');
      return post;
    } catch (error) {
      setPublishError(error.message);
      return undefined;
    } finally { setPublishing(false); }
  };

  const importableMaterials = (materials || []).slice(0, 30);
  const importIntoForm = source => {
    if (!source) return;
    setForm(previous => ({
      ...previous,
      type: 'article',
      title: previous.title || String(source.title || '').slice(0, 180),
      body: source.body || source.content || '',
    }));
    setPickerOpen(null);
    showToast('已导入到发布器，可编辑后发布');
  };

  return (
    <section className="community-composer composer-v2" data-testid="community-composer">
      <div className="community-composer-head">
        <h2>发布到广场</h2>
        <button type="button" onClick={onClose} aria-label="关闭发布器">×</button>
      </div>

      {draftBanner && (
        <div className="composer-draft-banner" data-testid="composer-draft-banner">
          <span>📄 {draftBanner}</span>
          <button type="button" onClick={() => { clearComposerDraft(); setForm(emptyDraft()); setDraftBanner(null); }}>清空重来</button>
        </div>
      )}

      <div className="composer-columns">
        {/* 左列：四分区表单 */}
        <div className="composer-form">
          <SectionTitle index="1" title="这是什么" hint="决定内容以什么形态、进哪个频道" />
          <div className="composer-chip-row" role="radiogroup" aria-label="内容类型">
            {TYPE_OPTIONS.map(option => (
              <button key={option.value} type="button" title={option.hint}
                className={`composer-chip ${form.type === option.value ? 'active' : ''}`}
                onClick={() => patch({ type: option.value })}>{option.label}</button>
            ))}
          </div>
          <div className="composer-chip-row" role="radiogroup" aria-label="频道" data-testid="composer-channel-group">
            {CHANNEL_OPTIONS.map(channel => (
              <button key={channel} type="button"
                className={`composer-chip ${form.channel === channel ? 'active' : ''}`}
                onClick={() => patch({ channel })}>{CHANNEL_LABELS[channel]}</button>
            ))}
          </div>

          <SectionTitle index="2" title="封面与摘要" hint="这一段就是卡片与详情页的「脸」" />
          <div className="composer-cover-row">
            <div className="composer-cover-preview">
              <PostCover post={{ id: form.title ? `draft-${form.title}` : 'draft', title: form.title, channel: form.channel, cover: coverPreview }} height={104} />
            </div>
            <div className="composer-cover-options">
              <div className="composer-chip-row" role="radiogroup" aria-label="封面来源">
                <button type="button" className={`composer-chip ${form.cover.kind === 'auto' ? 'active' : ''}`} onClick={() => patch({ cover: { kind: 'auto', url: '' } })}>自动生成</button>
                <button type="button" className={`composer-chip ${form.cover.kind === 'extracted' ? 'active' : ''}`} disabled={!extractedImage} title={extractedImage ? '采用正文第一张图' : '正文里还没有 https 图片'}
                  onClick={() => extractedImage && patch({ cover: { kind: 'extracted', url: extractedImage } })}>正文首图</button>
                <button type="button" className={`composer-chip ${form.cover.kind === 'url' ? 'active' : ''}`} onClick={() => patch({ cover: { kind: 'url', url: form.cover.url } })}>图片 URL</button>
              </div>
              {form.cover.kind === 'url' && (
                <input className="composer-cover-url" value={form.cover.url} maxLength={2048}
                  onChange={event => patch({ cover: { kind: 'url', url: event.target.value } })}
                  placeholder="https:// 图片地址" />
              )}
              {form.cover.kind === 'extracted' && extractedImage && <p className="composer-cover-note">采用正文首图：{extractedImage.slice(0, 60)}</p>}
              <label className="composer-summary-label" htmlFor="composer-summary">简介（自动提取，可编辑）</label>
              <textarea id="composer-summary" data-testid="composer-summary-input" className="composer-summary" value={form.summary} maxLength={MAX_SUMMARY}
                onChange={event => patch({ summary: event.target.value })} placeholder="留空则自动从正文提取" />
              <div className="composer-summary-foot">
                <span>{form.summary.length} / {MAX_SUMMARY}</span>
                <button type="button" className="composer-link-btn" onClick={() => patch({ summary: autoSummary })}>↻ 重新提取</button>
              </div>
            </div>
          </div>

          <SectionTitle index="3" title="正文" hint="支持 Markdown（标题 / 列表 / 代码块 / 引用）" />
          <textarea data-testid="community-title-input" className="composer-title-input" value={form.title} maxLength={180}
            onChange={event => patch({ title: event.target.value })} placeholder="标题（一句话说清内容）" />
          <textarea data-testid="community-body-input" className="composer-body-input custom-scrollbar" value={form.body} maxLength={100000}
            onChange={event => patch({ body: event.target.value })} placeholder="正文。清楚说明事实、判断依据和结论。" />
          <div className="composer-import-row">
            <span>从已有积累导入：</span>
            <button type="button" className={pickerOpen === 'materials' ? 'active' : ''} onClick={() => setPickerOpen(pickerOpen === 'materials' ? null : 'materials')}>素材库（{importableMaterials.length}）</button>
            <button type="button" className={pickerOpen === 'workbench' ? 'active' : ''} disabled={!workbenchDeliverable}
              title={workbenchDeliverable ? '导入最近一次工作流成果' : '先在无限画布运行一次工作流'}
              onClick={() => setPickerOpen(pickerOpen === 'workbench' ? null : 'workbench')}>AI 工作站成果</button>
          </div>
          {pickerOpen === 'materials' && (
            <div className="community-compose-picker custom-scrollbar">
              {importableMaterials.length === 0 && <p className="community-empty-copy">素材库还是空的，先在「素材管理」里收藏或创建素材。</p>}
              {importableMaterials.map(item => (
                <button key={item.id} type="button" className="community-picker-item" onClick={() => importIntoForm({ title: item.title, body: item.fullContent || item.content || '' })}>
                  <b>{item.title || '（无标题）'}</b>
                  <small>{stripMarkdown(item.fullContent || item.content || '').slice(0, 60)}</small>
                </button>
              ))}
            </div>
          )}
          {pickerOpen === 'workbench' && workbenchDeliverable && (
            <div className="community-compose-picker custom-scrollbar">
              <button type="button" className="community-picker-item" onClick={() => importIntoForm(workbenchDeliverable)}>
                <b>{workbenchDeliverable.title}</b>
                <small>{stripMarkdown(workbenchDeliverable.content).slice(0, 80)}</small>
              </button>
            </div>
          )}

          <SectionTitle index="4" title="标签与可见性" hint="标签最多 5 个，帮助内容被对的人看到" />
          <div className="composer-tags">
            {SCENE_TAGS.map(tag => (
              <button key={tag} type="button" className={`composer-chip ${form.tags.includes(tag) ? 'active' : ''}`}
                onClick={() => (form.tags.includes(tag) ? removeTag(tag) : addTag(tag))}>{tag}</button>
            ))}
            {form.tags.filter(tag => !SCENE_TAGS.includes(tag)).map(tag => (
              <span key={tag} className="composer-tag-custom">{tag}
                <button type="button" aria-label={`移除标签 ${tag}`} onClick={() => removeTag(tag)}>×</button>
              </span>
            ))}
            {form.tags.length < MAX_TAGS && (
              <input className="composer-tag-input" value={tagInput} placeholder="＋ 自定义"
                onChange={event => setTagInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(tagInput); setTagInput(''); }
                }} />
            )}
          </div>
          <div className="composer-chip-row" role="radiogroup" aria-label="可见范围">
            {VISIBILITY_OPTIONS.map(option => (
              <button key={option.value} type="button"
                className={`composer-chip ${form.visibility === option.value ? 'active' : ''}`}
                onClick={() => patch({ visibility: option.value })}>{option.label}</button>
            ))}
          </div>
        </div>

        {/* 右列：实时预览 + 川川提示 */}
        <aside className="composer-preview-pane">
          <div className="composer-preview-card">
            <span className="composer-preview-label">发布预览（所见即所得）</span>
            <PostCover post={{ id: form.title ? `preview-${form.title}` : 'preview', title: form.title, channel: form.channel, cover: coverPreview }} height={116} />
            <div className="composer-preview-body">
              <h4>{form.title.trim() || '（标题会显示在这里）'}</h4>
              <p>{(form.summary.trim() || autoSummary || '（摘要会自动从正文提取）').slice(0, 60)}</p>
              <div className="community-card-author">
                <CommunityAvatar name={user?.displayName || user?.username || '你'} src={user?.avatar || ''} size={22} />
                <span>{user?.displayName || user?.username || '你'}</span>
                <em>· 刚刚 · {CHANNEL_LABELS[form.channel]}</em>
              </div>
            </div>
          </div>
          <div className="composer-mascot-tip" data-testid="composer-mascot-tip">
            <MascotFigure size={84} />
            <div>
              <b>川川发布小助手</b>
              <p>带封面和摘要的内容，在广场被点开的概率高得多。交给我自动生成，也随时可换～</p>
            </div>
          </div>
        </aside>
      </div>

      {publishError && <div className="composer-error" data-testid="composer-error">{publishError}</div>}

      <div className="community-compose-footer composer-footer-v2">
        <span>{form.body.length} / 100000 · 草稿自动保存</span>
        <div className="composer-footer-actions">
          <button type="button" data-testid="composer-save-draft" onClick={() => { saveComposerDraft(form); showToast(isDraftMeaningful(form) ? '草稿已保存，下次打开发布器自动恢复' : '表单还是空的，没什么可保存的'); }}>保存草稿</button>
          <button type="button" data-testid="community-submit-post" disabled={publishing || !form.title.trim() || !form.body.trim()} onClick={() => publish().catch(() => {})}>
            {publishing ? '发布中...' : '确认发布'}
          </button>
        </div>
      </div>
    </section>
  );
}
