import { useMemo, useState } from 'react';
import { useProfileStore } from '../../store';
import { showToast } from '../../utils/toast.js';

const TYPE_LABELS = { track: '追踪', boost: '强化', mute: '静默' };

function initFormByType(suggestion) {
  if (suggestion.type === 'track') {
    return { target: suggestion.target || '', note: suggestion.reason || '' };
  }
  if (suggestion.type === 'boost') {
    return { tier: 'focus' };
  }
  if (suggestion.type === 'mute') {
    return { tier: 'explore' };
  }
  return {};
}

/**
 * Phase 2 Task 2: applySuggestionByType 纯函数
 *
 * 根据 suggestion.type 写入对应的 store：
 *   track → specialFollows 添加 keyword 项（含大小写不敏感幂等检查）
 *   boost → domainTiers[target] = formState.tier || 'focus'
 *   mute  → sourceTiers[target] = formState.tier || 'explore'
 *
 * @returns {boolean} true 表示写入成功，false 表示幂等检查失败或类型未知
 */
export function applySuggestionByType(suggestion, formState, stores) {
  const { type, target: origTarget } = suggestion;
  const { setSpecialFollows, setDomainTiers, setSourceTiers, specialFollows } = stores;

  if (type === 'track') {
    const target = (formState.target || '').trim();
    if (!target) {
      showToast('请输入关键词');
      return false;
    }
    const duplicate = (specialFollows || []).some(item =>
      item.type === 'keyword' && item.target.toLocaleLowerCase() === target.toLocaleLowerCase());
    if (duplicate) {
      showToast('该关键词已存在');
      return false;
    }
    setSpecialFollows(prev => [...prev, {
      id: globalThis.crypto?.randomUUID?.() || `follow-${Date.now()}`,
      type: 'keyword',
      target,
      note: formState.note || suggestion.reason || '',
    }]);
    return true;
  }

  if (type === 'boost') {
    setDomainTiers(prev => ({ ...prev, [origTarget]: formState.tier || 'focus' }));
    return true;
  }

  if (type === 'mute') {
    setSourceTiers(prev => ({ ...prev, [origTarget]: formState.tier || 'explore' }));
    return true;
  }

  return false;
}

function SuggestionAcceptEditor({ suggestion, onCancel, onDone }) {
  const updateSuggestionStatus = useProfileStore(s => s.updateSuggestionStatus);
  const setSpecialFollows = useProfileStore(s => s.setSpecialFollows);
  const setDomainTiers = useProfileStore(s => s.setDomainTiers);
  const setSourceTiers = useProfileStore(s => s.setSourceTiers);
  const specialFollows = useProfileStore(s => s.specialFollows);

  const [formState, setFormState] = useState(() => initFormByType(suggestion));

  const handleSubmit = () => {
    const ok = applySuggestionByType(suggestion, formState, {
      setSpecialFollows, setDomainTiers, setSourceTiers, specialFollows,
    });
    if (!ok) return;
    updateSuggestionStatus(suggestion.id, 'accepted');
    showToast('已接受建议，写入偏好');
    onDone();
  };

  const updateField = (key, value) => setFormState(prev => ({ ...prev, [key]: value }));

  return (
    <div className="suggestion-accept-editor">
      <div className="editor-title">确认写入偏好</div>
      {suggestion.type === 'track' && (
        <>
          <label className="editor-field">
            <span>关键词</span>
            <input
              type="text"
              value={formState.target || ''}
              onChange={e => updateField('target', e.target.value)}
              placeholder="输入追踪关键词"
            />
          </label>
          <label className="editor-field">
            <span>备注</span>
            <input
              type="text"
              value={formState.note || ''}
              onChange={e => updateField('note', e.target.value)}
              placeholder="可选备注"
            />
          </label>
        </>
      )}
      {suggestion.type === 'boost' && (
        <div className="editor-field">
          <span>领域</span>
          <span className="editor-readonly">{suggestion.target}</span>
          <div className="editor-radio-group">
            <label>
              <input
                type="radio"
                name={`tier-boost-${suggestion.id}`}
                checked={formState.tier === 'focus'}
                onChange={() => updateField('tier', 'focus')}
              />
              <span>重点（focus）</span>
            </label>
            <label>
              <input
                type="radio"
                name={`tier-boost-${suggestion.id}`}
                checked={formState.tier === 'normal'}
                onChange={() => updateField('tier', 'normal')}
              />
              <span>常规（normal）</span>
            </label>
          </div>
        </div>
      )}
      {suggestion.type === 'mute' && (
        <div className="editor-field">
          <span>来源</span>
          <span className="editor-readonly">{suggestion.target}</span>
          <div className="editor-radio-group">
            <label>
              <input
                type="radio"
                name={`tier-mute-${suggestion.id}`}
                checked={formState.tier === 'explore'}
                onChange={() => updateField('tier', 'explore')}
              />
              <span>探索（explore）</span>
            </label>
            <label>
              <input
                type="radio"
                name={`tier-mute-${suggestion.id}`}
                checked={formState.tier === 'normal'}
                onChange={() => updateField('tier', 'normal')}
              />
              <span>常规（normal）</span>
            </label>
          </div>
        </div>
      )}
      <div className="editor-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSubmit}>确认写入</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

export default function PendingSuggestionCard({ suggestion }) {
  const [editing, setEditing] = useState(false);
  const updateSuggestionStatus = useProfileStore(s => s.updateSuggestionStatus);

  const handleReject = () => updateSuggestionStatus(suggestion.id, 'rejected');
  const handleAccept = () => setEditing(true);

  const confidencePct = Math.round((suggestion.metadata?.confidence || 0) * 100);
  const typeLabel = TYPE_LABELS[suggestion.type] || suggestion.type;

  if (editing) {
    return (
      <SuggestionAcceptEditor
        suggestion={suggestion}
        onCancel={() => setEditing(false)}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="pending-suggestion-card">
      <div className="suggestion-header">
        <span className={`suggestion-type type-${suggestion.type}`}>{typeLabel}</span>
        <span className="suggestion-target">{suggestion.target}</span>
      </div>
      <p className="suggestion-reason">{suggestion.reason}</p>
      <div className="suggestion-confidence">
        <span className="confidence-label">置信度</span>
        <div className="confidence-bar">
          <div className="confidence-fill" style={{ width: `${confidencePct}%` }} />
        </div>
        <span className="confidence-value">{confidencePct}%</span>
      </div>
      <div className="suggestion-actions">
        <button className="btn btn-primary btn-sm" onClick={handleAccept}>接受</button>
        <button className="btn btn-ghost btn-sm" onClick={handleReject}>拒绝</button>
        <button className="btn btn-ghost btn-sm" onClick={handleReject}>稍后</button>
      </div>
    </div>
  );
}
