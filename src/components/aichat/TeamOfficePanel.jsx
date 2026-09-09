/**
 * TeamOfficePanel - 像素办公室实时协作监测面板（v26 #15）
 *
 * 挂在左侧栏底部空白区（所有 tab 可见），订阅 groupChatStore 实时推导：
 * - 每个成员一个像素小人：空闲在水吧闲逛 / 认领后走回工位 / 执行中打字 / 交付后起跳庆祝
 * - 对话气泡：新消息事件（认领/关注/旁观/交付/创始人发言）在对应小人头顶浮现后自动消散
 * - 状态徽章随实际协作过程自动更新（时间窗衰减由 5s tick 驱动）
 *
 * 像素风实现：SVG crispEdges 小人 + CSS steps() 动画 + 棋盘格地板；配色全部走
 * 主题令牌（地板/墙用 --bg 系与 --border-color，人物用成员色相 hsl），深浅模式自适应。
 * 折叠状态持久化 localStorage，不遮挡既有功能。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getGroupState, getActiveChat, subscribeGroup, resolveMemberPreset, hueOfMemberId,
} from './groupChatStore.js';
import {
  deriveOfficeActivity, deriveOfficeEvents, OFFICE_STATUS_LABEL,
} from '../../domain/agent/officeScene.js';

const COLLAPSE_KEY = 'teamOfficePanelCollapsed';
const WALK_MS = 1400;        // 换位后保留走路动画的时长
const BUBBLE_MS = 4600;      // 气泡停留时长
const TICK_MS = 5000;        // 状态时间窗衰减的刷新节拍

/** 像素小人（SVG，crispEdges）：hue 决定服色/发色，pose 决定手臂与朝向 */
function PixelPerson({ hue, status }) {
  const suit = `hsl(${hue} 62% 52%)`;
  const suitDark = `hsl(${hue} 55% 38%)`;
  const hair = `hsl(${hue} 45% 24%)`;
  const skin = '#e6b48c';
  const pants = '#3a4152';
  const working = status === 'working';
  const claiming = status === 'claiming';
  // 打字姿势：双臂前伸（桌前）；行走/站立：双臂垂放
  return (
    <svg
      className="ofc-person-svg"
      viewBox="0 0 12 16"
      width="24"
      height="32"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* 头发 */}
      <rect x="3" y="0" width="6" height="2" fill={hair} />
      {/* 头 */}
      <rect x="3" y="2" width="6" height="4" fill={skin} />
      {/* 眼睛（执行中眯眼专注，其余圆眼） */}
      {working
        ? <><rect x="4" y="3" width="2" height="1" fill="#2a2f3a" /><rect x="7" y="3" width="2" height="1" fill="#2a2f3a" /></>
        : <><rect x="4" y="3" width="1" height="1" fill="#2a2f3a" /><rect x="7" y="3" width="1" height="1" fill="#2a2f3a" /></>}
      {/* 身体 */}
      <rect x="2" y="6" width="8" height="5" fill={suit} />
      <rect x="5" y="6" width="2" height="5" fill={suitDark} />
      {/* 手臂 */}
      {working || claiming
        ? <><rect x="1" y="7" width="1" height="3" fill={suitDark} /><rect x="10" y="7" width="1" height="3" fill={suitDark} /><rect x="0" y="9" width="2" height="1" fill={skin} /><rect x="10" y="9" width="2" height="1" fill={skin} /></>
        : <><rect x="1" y="6" width="1" height="4" fill={suitDark} /><rect x="10" y="6" width="1" height="4" fill={suitDark} /></>}
      {/* 腿 */}
      <rect x="3" y="11" width="2" height="4" fill={pants} />
      <rect x="7" y="11" width="2" height="4" fill={pants} />
      {/* 鞋 */}
      <rect x="3" y="15" width="2" height="1" fill="#22262f" />
      <rect x="7" y="15" width="2" height="1" fill="#22262f" />
    </svg>
  );
}

/** 像素工位：桌 + 显示器（执行中屏幕闪烁） */
function PixelDesk({ working }) {
  return (
    <svg className="ofc-desk-svg" viewBox="0 0 16 10" width="32" height="20" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="4" y="0" width="8" height="6" fill="#1c2230" />
      <rect x="5" y="1" width="6" height="4" fill={working ? '#57d0ff' : '#2b3a4d'} />
      {working && <rect x="6" y="2" width="4" height="1" fill="#b7ecff" className="ofc-screen-flicker" />}
      <rect x="7" y="6" width="2" height="1" fill="#1c2230" />
      <rect x="6" y="7" width="4" height="1" fill="#1c2230" />
      <rect x="0" y="8" width="16" height="2" fill="#6b4a2b" />
      <rect x="1" y="9" width="14" height="1" fill="#54391f" />
    </svg>
  );
}

/** 成员在场景中的家位置（索引 → 百分比坐标），6 人上限与群聊一致 */
function homePos(i) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return { x: 22 + col * 28, y: row === 0 ? 46 : 76 };
}
/** 空闲时聚集的水吧位置 */
function loungePos(i) {
  return { x: 4 + (i % 2) * 7, y: 52 + (i % 3) * 12 };
}

export default function TeamOfficePanel() {
  const [snap, setSnap] = useState(() => ({
    roster: [...(getActiveChat()?.roster || [])],
    messages: [...(getActiveChat()?.messages || [])],
    running: Boolean(getGroupState().running),
    chatName: getActiveChat()?.name || '',
    goalStatus: getActiveChat()?.goal?.status || 'idle',
  }));
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [now, setNow] = useState(() => Date.now());
  const [bubbles, setBubbles] = useState({}); // agentId → text
  // 游标：只对「面板挂载后」的新消息弹气泡（首次挂载不回放历史）
  const lastSeenRef = useRef(Date.now());
  const walkUntilRef = useRef({}); // agentId → 走路动画截止时间
  const activityRef = useRef([]);  // 上一帧活动快照（换位检测 → 走路动画）

  useEffect(() => subscribeGroup(() => {
    const chat = getActiveChat();
    const messages = [...(chat?.messages || [])];
    // 新事件 → 气泡
    const events = deriveOfficeEvents(messages, lastSeenRef.current, Date.now());
    lastSeenRef.current = Date.now();
    if (events.length) {
      setBubbles(prev => {
        const next = { ...prev };
        for (const e of events) next[e.agentId] = e.text;
        return next;
      });
      setTimeout(() => {
        setBubbles(prev => {
          const next = { ...prev };
          for (const e of events) delete next[e.agentId];
          return next;
        });
      }, BUBBLE_MS);
    }
    // 状态换位（idle↔其他）→ 走路动画窗口
    const prevActivity = activityRef.current;
    const nextActivity = deriveOfficeActivity(messages, chat?.roster || [], Date.now());
    for (const a of nextActivity) {
      const before = prevActivity.find(x => x.agentId === a.agentId);
      if (before && before.status !== a.status) {
        walkUntilRef.current[a.agentId] = Date.now() + WALK_MS;
      }
    }
    activityRef.current = nextActivity;
    setSnap({
      roster: [...(chat?.roster || [])],
      messages,
      running: Boolean(getGroupState().running),
      chatName: chat?.name || '',
      goalStatus: chat?.goal?.status || 'idle',
    });
  }), []);

  // 初始化游标期的活动快照（避免首次 notify 时全员误判走路）
  useEffect(() => {
    const chat = getActiveChat();
    activityRef.current = deriveOfficeActivity(chat?.messages || [], chat?.roster || [], Date.now());
  }, []);

  // 状态时间窗衰减 + 走路动画结束的刷新节拍
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const activity = useMemo(
    () => deriveOfficeActivity(snap.messages, snap.roster, now),
    [snap.messages, snap.roster, now],
  );
  const presets = useMemo(() => snap.roster.map(id => resolveMemberPreset(id)), [snap.roster]);
  const activeCount = activity.filter(a => a.status === 'working' || a.status === 'claiming').length;

  const toggleCollapse = () => {
    setCollapsed(v => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  };

  return (
    <div className={`team-office ${collapsed ? 'is-collapsed' : ''}`} aria-label="实时协作监测面板">
      <div className="team-office-head">
        <span className="team-office-title">协作办公室</span>
        <span className={`team-office-live ${snap.running ? 'is-on' : ''}`}>
          <i />{snap.running ? `协作中 · ${activeCount} 人执行` : '待命'}
        </span>
        <button
          type="button"
          className="team-office-fold"
          onClick={toggleCollapse}
          title={collapsed ? '展开办公室' : '收起办公室'}
        >{collapsed ? '▾' : '▴'}</button>
      </div>
      {!collapsed && (
        <div className="team-office-scene">
          {/* 墙面：窗 + 白板（像素装饰，纯 CSS） */}
          <div className="ofc-wall">
            <span className="ofc-window" />
            <span className="ofc-board">
              {snap.goalStatus === 'running' && <i className="ofc-board-goal" title="Goal 推进中" />}
              <b>TEAM</b>
            </span>
            <span className="ofc-plant" />
          </div>
          {/* 地板 + 工位 + 小人 */}
          <div className="ofc-floor">
            {snap.roster.length === 0 && (
              <div className="ofc-empty">邀请成员进群后，这里会亮起来</div>
            )}
            {snap.roster.map((id, i) => {
              const preset = presets[i] || { name: id };
              const act = activity[i] || { status: 'idle' };
              const pos = act.status === 'idle' ? loungePos(i) : homePos(i);
              const hue = hueOfMemberId(id);
              const bubble = bubbles[id];
              return (
                <div
                  key={id}
                  className={`ofc-unit is-${act.status} ${walkUntilRef.current[id] > now ? 'is-walking' : ''}`}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  title={`${preset.name} · ${OFFICE_STATUS_LABEL[act.status]}${act.lastContent ? `\n最近：${act.lastContent}` : ''}`}
                >
                  {bubble && (
                    <span className="ofc-bubble">{bubble}</span>
                  )}
                  <div className="ofc-person">
                    <PixelPerson hue={hue} status={act.status} />
                  </div>
                  <div className="ofc-desk">
                    <PixelDesk working={act.status === 'working'} />
                  </div>
                  <span className="ofc-chip">{OFFICE_STATUS_LABEL[act.status]}</span>
                  <span className="ofc-name">{preset.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
