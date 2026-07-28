// src/components/profile/KpiStrip.jsx
// Phase 6: KPI 细条，4 项均分，项间竖向分隔
export default function KpiStrip({
  focusCount = 0,
  readingCount = 0,
  bookmarkCount = 0,
  specialFollowCount = 0,
}) {
  const items = [
    { value: focusCount, label: '关注领域' },
    { value: readingCount, label: '阅读点击' },
    { value: bookmarkCount, label: '收藏资讯' },
    { value: specialFollowCount, label: '特别关注' },
  ];
  return (
    <div className="kpi-strip">
      {items.map((item, i) => (
        <div key={i} className="kpi-item">
          <span className="kpi-value">{item.value}</span>
          <span className="kpi-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
