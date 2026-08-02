// src/components/profile/HudTelemetryBar.jsx
// 系统遥测栏 —— 战机 HUD 顶栏：状态灯 + 实时遥测数据 + 系统时钟
// 第一性原理：操作者扫一眼就能确认"系统在线、数据在刷新、认知在累积"
import { useEffect, useState } from 'react';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const pad = n => String(n).padStart(2, '0');

export default function HudTelemetryBar({ stats = [], variant = 'default', actions = null }) {
  const now = useClock();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  return (
    <div className={`hud-telemetry hud-telemetry-${variant}`} role="status" aria-label="系统遥测状态">
      <div className="hud-tele-left">
        <span className="hud-tele-status"><i aria-hidden="true" />SYS.ONLINE</span>
        <span className="hud-tele-sep" aria-hidden="true" />
        {stats.map(s => (
          <span className="hud-tele-stat" key={s.label}>
            <em>{s.label}</em>
            <b>{s.value}</b>
          </span>
        ))}
      </div>
      <div className="hud-tele-right">
        {actions && <div className="hud-tele-actions">{actions}</div>}
        <span className="hud-tele-date">{date}</span>
        <span className="hud-tele-time">{time}</span>
      </div>
    </div>
  );
}
