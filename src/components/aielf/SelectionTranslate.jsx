import { useState, useRef, useEffect, useCallback } from 'react';
import { useElfStore } from '../../store/elfStore.js';
import { useAiStore } from '../../store/aiStore.js';
import { ICONS } from '../../constants/appConstants.jsx';
import { showToast } from '../../utils/toast.js';

/**
 * SelectionTranslate - 划词翻译与解释（v23 #1）
 *
 * 全局监听鼠标选区：选中文字后自动弹出气泡，调用当前配置的大模型
 * （走 /api/ai-generate，与 AI 精灵普通模式同链路）返回「翻译 + 解释」，
 * 可一键复制或转交 AI 精灵继续追问。
 *
 * 边界处理：
 * - 输入框/textarea/contenteditable 内的选区不触发（避免干扰编辑）
 * - 气泡自身内的选区不触发；点气泡外/Esc/滚动/缩放关闭
 * - 请求带序号防竞态：连续划词只有最后一次生效；关闭即 abort
 * - 未配置 baseUrl/model 时只提示不请求
 */

const MIN_LEN = 2;
const MAX_LEN = 2000;

const TRANSLATE_SYSTEM_PROMPT = [
  '你是划词助手。用户会给你一段选中的文字，请输出两部分：',
  '1. 【翻译】把原文翻译成中文；若原文已是中文，则翻译成英文。',
  '2. 【解释】用不超过 120 字解释这段文字的含义、背景或用法；若是术语/缩写/代码，说明它是什么。',
  '',
  '输出格式（严格遵守）：',
  '**翻译**',
  '<译文>',
  '',
  '**解释**',
  '<解释>',
  '',
  '禁止输出其他开场白或结尾语。',
].join('\n');

export default function SelectionTranslate({ llmConfig }) {
  const enabled = useElfStore(s => s.selectionTranslateEnabled);
  const setElfQuotedContext = useAiStore(s => s.setElfQuotedContext);
  const [bubble, setBubble] = useState(null); // { x, y, text }
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bubbleRef = useRef(null);
  const seqRef = useRef(0);          // 请求序号：只应用最新一次
  const abortRef = useRef(null);

  const close = useCallback(() => {
    seqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBubble(null);
    setResult('');
    setError('');
    setLoading(false);
  }, []);

  const requestTranslate = useCallback(async (text) => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setResult('');
    try {
      if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
        setError('未配置大模型 API，请先到设置中配置。');
        setLoading(false);
        return;
      }
      const response = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.selectedModel,
          action: 'chat',
          content: text,
          systemPrompt: TRANSLATE_SYSTEM_PROMPT,
          messages: [],
        }),
      });
      const data = await response.json();
      if (seq !== seqRef.current) return; // 已有更新请求，丢弃过期结果
      if (data.error) setError(`翻译失败: ${data.error}`);
      else setResult(data.content || '暂无结果');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      if (seq === seqRef.current) setError(`翻译失败: ${e?.message || e}`);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [llmConfig]);

  // 全局 mouseup：检测新选区
  useEffect(() => {
    if (!enabled) return undefined;
    const onMouseUp = (e) => {
      // 点在气泡内：不处理（让复制/按钮正常工作）
      if (bubbleRef.current && e.composedPath().includes(bubbleRef.current)) return;
      // 有气泡时点击外部 → 关闭
      if (bubble) { close(); }
      // 延迟一帧读取选区（mouseup 时 selection 已就绪，但稳妥起见）
      requestAnimationFrame(() => {
        const sel = window.getSelection?.();
        if (!sel || sel.isCollapsed) return;
        const text = String(sel.toString() || '').trim();
        if (text.length < MIN_LEN || text.length > MAX_LEN) return;
        const anchor = sel.anchorNode;
        const el = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
        if (!el) return;
        // 编辑场景不触发
        if (el.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
        const rect = sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
        if (!rect || (!rect.width && !rect.height)) return;
        const bw = 360;
        let x = rect.left + rect.width / 2 - bw / 2;
        x = Math.max(8, Math.min(window.innerWidth - bw - 8, x));
        let y = rect.bottom + 8;
        if (y + 220 > window.innerHeight) y = Math.max(8, rect.top - 228);
        setBubble({ x, y, text });
      });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [enabled, bubble, close]);

  // 选中后自动发起翻译
  useEffect(() => {
    if (bubble?.text) requestTranslate(bubble.text);
  }, [bubble?.text, requestTranslate]);

  // Esc / 滚动 / 缩放关闭
  useEffect(() => {
    if (!bubble) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onScroll = (e) => {
      // 气泡内部滚动不关闭
      if (bubbleRef.current && e.target && bubbleRef.current.contains(e.target)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [bubble, close]);

  // 卸载时兜底 abort
  useEffect(() => () => abortRef.current?.abort(), []);

  const copyResult = () => {
    const text = result || bubble?.text || '';
    if (!text) return;
    navigator.clipboard?.writeText(text)
      .then(() => showToast('已复制'))
      .catch(() => showToast('复制失败'));
  };

  const askElf = () => {
    if (!bubble?.text) return;
    setElfQuotedContext({
      title: `划词：${bubble.text.slice(0, 40)}`,
      content: bubble.text,
      fullContent: bubble.text,
      suggestedPrompt: '请结合上下文深入解释这段内容的含义、背景和值得注意的点。',
    });
    close();
  };

  if (!enabled || !bubble) return null;

  return (
    <div
      ref={bubbleRef}
      className="sel-translate-bubble"
      style={{ left: bubble.x, top: bubble.y, width: 360 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="sel-translate-head">
        <span className="sel-translate-title">划词翻译</span>
        <span className="sel-translate-text" title={bubble.text}>{bubble.text}</span>
        <button type="button" className="sel-translate-close" onClick={close} title="关闭 (Esc)">{ICONS.x || '×'}</button>
      </div>
      <div className="sel-translate-body custom-scrollbar">
        {loading && <div className="sel-translate-loading"><span className="sel-translate-spinner" />正在翻译与解释…</div>}
        {!loading && error && <div className="sel-translate-error">{error}</div>}
        {!loading && !error && result && <div className="sel-translate-result">{result}</div>}
      </div>
      <div className="sel-translate-actions">
        <button type="button" onClick={copyResult} disabled={!result && !bubble.text}>复制</button>
        <button type="button" onClick={askElf}>问精灵</button>
      </div>
    </div>
  );
}
