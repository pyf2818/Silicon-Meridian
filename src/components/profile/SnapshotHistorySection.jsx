// src/components/profile/SnapshotHistorySection.jsx
// Phase 3 Task B14: 推荐历史快照展示
// 调用 GET /api/profile/snapshots（列表）+ GET /api/profile/snapshots?date=YYYY-MM-DD（详情）
// 每日 06:00 cron 预热写入 recommendation_snapshots + briefing_snapshots + recommendation_items（三表事务）
import React, { useState, useEffect, useCallback } from 'react';
import { formatRelative } from '../../utils/format.js';
import { normalizeError } from '../../utils/dashboardBuilders.js';

export default function SnapshotHistorySection() {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSnap, setSelectedSnap] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/profile/snapshots');
      const data = await resp.json();
      if (data.ok) setSnapshots(data.snapshots || []);
      else setError(normalizeError(data.error) || '加载失败');
    } catch (err) {
      setError(normalizeError(err) || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const viewDetail = useCallback(async (date) => {
    setDetailLoading(true);
    try {
      const resp = await fetch(`/api/profile/snapshots?date=${encodeURIComponent(date)}`);
      const data = await resp.json();
      if (data.ok) setSelectedSnap(data.snapshot);
    } catch {
      /* silent */
    } finally {
      setDetailLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <section className="profile-snapshot-history">
        <div className="section-header">
          <h2 className="section-title">推荐历史快照</h2>
          <p className="section-desc">每日 06:00 系统自动预热，记录 AI 增强推荐结果</p>
        </div>
        <div className="profile-empty-state">加载中...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="profile-snapshot-history">
        <div className="section-header">
          <h2 className="section-title">推荐历史快照</h2>
          <p className="section-desc">每日 06:00 系统自动预热，记录 AI 增强推荐结果</p>
        </div>
        <div className="profile-empty-state">加载失败：{error}</div>
      </section>
    );
  }

  return (
    <section className="profile-snapshot-history">
      <div className="section-header">
        <h2 className="section-title">推荐历史快照</h2>
        <p className="section-desc">每日 06:00 系统自动预热，记录 AI 增强推荐结果</p>
      </div>
      {snapshots.length === 0 ? (
        <div className="profile-empty-state">暂无历史快照</div>
      ) : (
        <div className="snapshot-list">
          {snapshots.map(snap => (
            <div
              key={snap.id || snap.snapshot_date}
              className="snapshot-item"
              onClick={() => viewDetail(snap.snapshot_date)}
              role="button"
              tabIndex={0}
            >
              <span className="snapshot-date">{snap.snapshot_date}</span>
              <span className={`snapshot-status status-${snap.ai_status || 'unknown'}`}>
                {snap.ai_status || '未知'}
              </span>
              <span className="snapshot-oneliner">{snap.one_line || snap.oneLine || '（无简报）'}</span>
              {snap.updated_at && (
                <span className="snapshot-updated">{formatRelative(snap.updated_at)}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {selectedSnap && (
        <div className="snapshot-detail">
          <div className="snapshot-detail-header">
            <h3>{selectedSnap.snapshot_date} 详情</h3>
            <button className="snapshot-detail-close" onClick={() => setSelectedSnap(null)}>关闭</button>
          </div>
          {detailLoading ? (
            <p>加载中...</p>
          ) : (
            <>
              {selectedSnap.one_line && (
                <p className="snapshot-detail-oneliner">{selectedSnap.one_line}</p>
              )}
              {Array.isArray(selectedSnap.items) && selectedSnap.items.length > 0 && (
                <ul className="snapshot-detail-items">
                  {selectedSnap.items.map((it, i) => (
                    <li key={it.id || i}>
                      <span className="snapshot-detail-title">{it.title || it.id}</span>
                      {it.ai_score != null && (
                        <span className="snapshot-detail-score">AI 评分 {it.ai_score}</span>
                      )}
                      {it.ai_label && (
                        <span className="snapshot-detail-label">{it.ai_label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <details className="snapshot-raw">
                <summary>原始 JSON</summary>
                <pre>{JSON.stringify(selectedSnap, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
