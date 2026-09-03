/**
 * AgentRoleCard - 成员角色卡片（portal 弹层）
 *
 * 三种用途（v8）：
 * - 查看/编辑：点击群聊中的成员 → 展示角色详情（职责/性格/工具/轮次），可编辑保存。
 *   内置成员保存为当前群聊的 memberProfiles 覆盖；自定义角色直接更新角色本体。
 * - 创建：邀请菜单的「创建自定义角色」入口 → 空表单，保存即入群（自动 inviteMember）。
 * - 删除：仅自定义角色显示「删除角色」（从角色库移除并清退所有群聊引用）。
 *
 * 字段：名称 / 职责描述 / 性格与说话风格。风格会注入成员 systemPrompt，
 * 让认领与产出的每条群聊回复都带独特口吻（灵魂设定）。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  saveCustomRole, deleteCustomRole, setMemberProfile,
} from './groupChatStore.js';
import { showToast } from '../../utils/toast.js';

export default function AgentRoleCard({
  role,          // 预览中的成员 preset（含 profile 覆盖后的生效值）；create 模式传 null
  isCustom,      // 是否自定义角色
  isBuiltIn,     // 是否内置 preset
  onCreateInvite, // create 模式保存成功后的入群回调 (savedRole) => void
  onClose,
}) {
  const isCreate = !role;
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [style, setStyle] = useState(role?.styleOverride || role?.style || '');
  const [confirmDel, setConfirmDel] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    if (isCreate && nameRef.current) nameRef.current.focus();
  }, [isCreate]);

  // Esc 关闭（编辑中先放弃编辑）
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = isCreate
    || name !== (role?.name || '')
    || description !== (role?.description || '')
    || style !== (role?.styleOverride || role?.style || '');

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) { showToast('角色名称不能为空'); return; }
    if (isCreate) {
      const saved = saveCustomRole({ name: trimmedName, description, style });
      if (!saved) { showToast('创建失败（角色数已达上限）'); return; }
      showToast(`已创建角色「${saved.name}」并邀请入群`);
      onCreateInvite?.(saved);
      onClose?.();
      return;
    }
    if (isCustom) {
      const saved = saveCustomRole({ id: role.id, name: trimmedName, description, style });
      if (saved) showToast(`已保存「${saved.name}」的角色设定`);
      onClose?.();
      return;
    }
    // 内置成员：保存为当前群聊的性格档案覆盖
    setMemberProfile(role.id, { name: trimmedName, description, style });
    showToast(`已保存「${trimmedName}」在本群的性格设定`);
    onClose?.();
  };

  const handleDelete = () => {
    if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); return; }
    if (deleteCustomRole(role.id)) showToast(`已删除角色「${role.name}」`);
    onClose?.();
  };

  return createPortal(
    <>
      <div className="gtc-card-backdrop" onClick={onClose} />
      <aside className="gtc-role-card" role="dialog" aria-modal="true" aria-label="成员角色卡">
        <header className="gtc-role-card-head">
          <span className={`gtc-role-card-avatar ${isCustom ? 'is-custom' : ''}`}>
            {(name || '?').slice(0, 1)}
          </span>
          <div className="gtc-role-card-title">
            <h3>{isCreate ? '创建自定义角色' : '成员角色卡'}</h3>
            <small>
              {isCreate
                ? '保存后自动邀请进当前群聊'
                : (isCustom ? '自定义角色 · 全部群聊生效' : '内置成员 · 本群个性化覆盖')}
            </small>
          </div>
          <button type="button" className="gtc-role-card-close" onClick={onClose} title="关闭 (Esc)">✕</button>
        </header>

        <div className="gtc-role-card-body custom-scrollbar">
          <label className="gtc-role-field">
            <span>名称</span>
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={16}
              placeholder="例如：情报官、段子手、魔鬼代言人"
            />
          </label>
          <label className="gtc-role-field">
            <span>职责描述</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="这个成员擅长什么、负责什么（例如：负责检索与核实信息，只在有把握时发言）"
            />
          </label>
          <label className="gtc-role-field">
            <span>性格与说话风格</span>
            <textarea
              value={style}
              onChange={e => setStyle(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="灵魂所在。例如：毒舌但心软，喜欢用反问句，发言简短犀利，偶尔吐槽创始人的品味"
            />
          </label>
          {!isCreate && (
            <div className="gtc-role-meta">
              <div><code>{role.id}</code></div>
              {(role.tools?.length > 0) && <div>工具白名单 {role.tools.length} 项 · 最多 {role.maxTurns || 6} 轮</div>}
            </div>
          )}
        </div>

        <footer className="gtc-role-card-foot">
          {isCustom && !isCreate && (
            <button
              type="button"
              className={`gtc-role-card-btn danger ${confirmDel ? 'confirm' : ''}`}
              onClick={handleDelete}
            >
              {confirmDel ? '确认删除？' : '删除角色'}
            </button>
          )}
          <span className="gtc-role-card-foot-space" />
          <button type="button" className="gtc-role-card-btn" onClick={onClose}>取消</button>
          <button
            type="button"
            className="gtc-role-card-btn primary"
            onClick={handleSave}
            disabled={!dirty && !isCreate}
          >
            {isCreate ? '保存并邀请' : '保存'}
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}
