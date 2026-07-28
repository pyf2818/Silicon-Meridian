import { useEffect, useMemo } from 'react';
import { useProfileStore } from '../../store';
import PendingSuggestionCard from './PendingSuggestionCard.jsx';

export default function PendingSuggestionsSection() {
  const pending = useProfileStore(s => s.pendingSuggestions);

  const pendingList = useMemo(
    () => (pending || [])
      .filter(s => s.status === 'pending')
      .sort((a, b) => (b.metadata?.confidence || 0) - (a.metadata?.confidence || 0)),
    [pending]
  );

  useEffect(() => {
    try { useProfileStore.getState().pruneExpiredSuggestions(); } catch { /* silent */ }
  }, []);

  return (
    <section className="profile-pending-suggestions">
      <div className="section-header">
        <h2 className="section-title">
          AI 建议待确认
          {pendingList.length > 0 && <span className="pending-count">{pendingList.length}</span>}
        </h2>
        <p className="section-desc">系统从近期阅读中提炼的追踪/强化建议，确认后写入偏好并影响后续对话</p>
      </div>
      {pendingList.length === 0 ? (
        <div className="profile-empty-state">暂无 AI 建议待确认</div>
      ) : (
        <div className="pending-suggestions-grid">
          {pendingList.map(s => <PendingSuggestionCard key={s.id} suggestion={s} />)}
        </div>
      )}
    </section>
  );
}
