/**
 * ColorfulBubbles — Compact pill badges with enter animation
 * - Horizontal flex-wrap pill layout
 * - New bubble enter animation (scale bounce)
 * - Double-click to pop with burst
 * - Gentle float oscillation
 */
import React, { useRef, useEffect, useState } from 'react';

// 兴趣彩泡主题色：映射 accent 变量（随 12 套调色板实时暖化/冷化），
// 不再硬编码冷青/蓝，避免暖色调氛围下出现冷色块出戏。
const BUBBLE_VARS = [
  '--accent-cyan', '--accent-rose', '--accent-emerald', '--accent-blue',
  '--accent-violet', '--accent-amber', '--accent-cyan', '--accent-emerald',
];

export default function ColorfulBubbles({ interests, onBubbleClick, onEmptyClick, categories }) {
  const [popping, setPopping] = useState(new Set());
  const [entering, setEntering] = useState(new Set());
  const prevLenRef = useRef(interests.length);

  // Detect new interests → add entering animation
  useEffect(() => {
    if (interests.length > prevLenRef.current) {
      const newIds = new Set();
      for (let i = prevLenRef.current; i < interests.length; i++) {
        newIds.add(interests[i]);
      }
      setEntering(newIds);
      setTimeout(() => setEntering(new Set()), 400);
    }
    prevLenRef.current = interests.length;
  }, [interests.length]);

  const handleDoubleClick = (idx) => {
    setPopping(prev => new Set(prev).add(idx));
    setTimeout(() => {
      const catId = interests[idx];
      if (catId && onBubbleClick) onBubbleClick(catId);
    }, 300);
  };

  if (interests.length === 0) {
    return (
      <div className="interest-bubble-container">
        <button className="interest-bubble-empty" onClick={onEmptyClick}>设置关注领域</button>
      </div>
    );
  }

  return (
    <div className="interest-bubble-container">
      {interests.map((catId, i) => {
        const cat = categories.find(c => c.id === catId);
        const label = cat?.label || catId;
        const v = BUBBLE_VARS[i % BUBBLE_VARS.length];
        const isPopping = popping.has(i);
        const isEntering = entering.has(catId);

        return (
          <button
            key={catId}
            className={`interest-bubble${isPopping ? ' popping' : ''}${isEntering ? ' bubble-entering' : ''}`}
            style={{
              background: `color-mix(in srgb, var(${v}) 22%, transparent)`,
              border: `1.5px solid color-mix(in srgb, var(${v}) 50%, transparent)`,
              color: `var(${v})`,
              boxShadow: `0 2px 8px color-mix(in srgb, var(${v}) 35%, transparent)`,
            }}
            onClick={() => onBubbleClick && onBubbleClick(catId)}
            onDoubleClick={() => handleDoubleClick(i)}
          >
            {label}
          </button>
        );
      })}
      <button className="interest-bubble-empty" onClick={onEmptyClick} title="添加关注领域">+</button>
    </div>
  );
}
