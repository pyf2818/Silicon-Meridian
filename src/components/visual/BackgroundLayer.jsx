/**
 * BackgroundLayer - 水墨氛围背景层
 *
 * 纯 CSS 多层 radial-gradient 模拟墨色晕染 + 极慢呼吸动画。
 * 挂在根节点最底层（z-index: -3），pointer-events: none。
 * 深浅主题通过 CSS 变量自动切换。
 */
export default function BackgroundLayer() {
  return (
    <div className="visual-bg-layer" aria-hidden="true">
      <div className="visual-bg-glow visual-bg-glow-1" />
      <div className="visual-bg-glow visual-bg-glow-2" />
      <div className="visual-bg-glow visual-bg-glow-3" />
    </div>
  );
}
