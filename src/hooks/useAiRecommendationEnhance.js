/**
 * useAiRecommendationEnhance - Phase 3 Task B9
 * 实时 AI 重新分析：调用 /api/profile/snapshots/analyze（不写入数据库）
 *
 * 用户点"重新分析"按钮时触发，对 top 30 items 做 LLM 分析，
 * 返回 { trends, correlations, signals, itemScores }
 * itemScores 包含 { id, score, label, reason } 用于增强展示
 *
 * 失败时返回 error，不修改原 items
 */
import { useState, useCallback } from 'react';

export function useAiRecommendationEnhance({ items, llmConfig } = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [enhancedItems, setEnhancedItems] = useState(null);
  const [insights, setInsights] = useState(null);

  const enhance = useCallback(async () => {
    if (!llmConfig?.baseUrl || !Array.isArray(items) || items.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const top30 = items.slice(0, 30);
      const resp = await fetch('/api/profile/snapshots/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: top30 }),
      });
      const data = await resp.json();
      if (data.ok) {
        const scoreMap = new Map(
          (data.itemScores || []).map(s => [s.id, s])
        );
        const enhanced = items.map(item => {
          const score = scoreMap.get(item.id);
          return score
            ? { ...item, aiScore: score.score, aiLabel: score.label, aiReason: score.reason }
            : item;
        });
        setEnhancedItems(enhanced);
        setInsights({
          trends: data.trends || [],
          correlations: data.correlations || [],
          signals: data.signals || [],
        });
      } else {
        setError(data.error || '分析失败');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [items, llmConfig?.baseUrl]);

  const reset = useCallback(() => {
    setEnhancedItems(null);
    setInsights(null);
    setError(null);
  }, []);

  return { enhance, loading, error, enhancedItems, insights, reset };
}
