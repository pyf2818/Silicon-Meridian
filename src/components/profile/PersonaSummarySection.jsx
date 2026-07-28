// src/components/profile/PersonaSummarySection.jsx
// Phase 3 Task B13: AI 性格画像展示
// 读取 profileStore.personaSummary（{ habits: [], traits: [], needs: [], updatedAt }）
// 字段为字符串数组，由 memoryEvolver 从 agent_memories 派生合并而来
import React from 'react';
import { useProfileStore } from '../../store';
import { formatRelative } from '../../utils/format.js';

function PersonaColumn({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="persona-column">
      <h3>{title}</h3>
      <ul>
        {items.map((text, idx) => (
          <li key={idx} className="persona-item">
            <span className="persona-content">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PersonaSummarySection() {
  const personaSummary = useProfileStore(s => s.personaSummary);
  const { habits = [], traits = [], needs = [], updatedAt } = personaSummary || {};

  if (habits.length === 0 && traits.length === 0 && needs.length === 0) {
    return (
      <section className="profile-persona-summary">
        <div className="section-header">
          <h2 className="section-title">AI 性格画像</h2>
          <p className="section-desc">与 AI 对话累积 3 轮后，系统会自动总结你的性格画像，影响推荐与回复风格</p>
        </div>
        <div className="profile-empty-state">暂无 AI 画像，开始与 AI 对话吧</div>
      </section>
    );
  }

  return (
    <section className="profile-persona-summary">
      <div className="section-header">
        <h2 className="section-title">AI 性格画像</h2>
        <p className="section-desc">基于历史对话的总结，会影响推荐排序与 AI 回复风格（最近更新：{updatedAt ? formatRelative(updatedAt) : '未知'}）</p>
      </div>
      <div className="persona-summary-grid">
        <PersonaColumn title="用户习惯" items={habits} />
        <PersonaColumn title="用户性格" items={traits} />
        <PersonaColumn title="用户需求" items={needs} />
      </div>
    </section>
  );
}
