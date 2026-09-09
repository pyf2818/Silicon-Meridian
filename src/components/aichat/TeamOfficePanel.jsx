/**
 * TeamOfficePanel - 像素办公室实时协作监测面板 v2（v26 #15/#16）
 *
 * 像素小游戏级场景：墙面（窗户/时钟/门/白板/海报）+ 地板（工位/水吧/地毯/绿植），
 * 每个成员一个精美像素小人（描边 + 发型变体 + 领子/腰带 + 两帧走路动画）。
 * 运动与交流：状态变化触发走位（平滑缓动 + 朝向翻转），事件驱动对话气泡。
 * 状态机逻辑在 domain/agent/officeScene.js（纯函数，单测覆盖），本组件只做渲染。
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
const WALK_MS = 1600;        // 换位后保留走路帧动画的时长
const BUBBLE_MS = 4600;      // 气泡停留时长
const TICK_MS = 5000;        // 状态时间窗衰减的刷新节拍
const ENTER_POS = { x: 88, y: 26 }; // 新成员进门位（墙门下方）

/** 像素小人 v2（SVG crispEdges）：描边剪影 + 发型变体 + 领子/腰带 + 两帧腿。
 *  pose：idle/claiming 垂手；working 双臂前伸打字；walking 两帧腿交替。 */
function PixelPerson({ hue, status, variant }) {
  const suit = `hsl(${hue} 60% 52%)`;
  const suitDark = `hsl(${hue} 55% 38%)`;
  const hair = `hsl(${hue} 42% 26%)`;
  const skin = '#e8b88d';
  const skinDark = '#d3a077';
  const ink = '#20242e';
  const pants = '#39415a';
  const shoe = '#232833';
  const working = status === 'working';
  const claiming = status === 'claiming';
  const v = variant % 3;
  return (
    <svg
      className="ofc-person-svg"
      viewBox="0 0 14 18"
      width="28"
      height="36"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* —— 描边剪影（比填充大一圈的深色底）—— */}
      <rect x="3" y="1" width="8" height="7" fill={ink} />
      <rect x="2" y="7" width="10" height="7" fill={ink} />
      <rect x="4" y="13" width="6" height="5" fill={ink} />
      {/* —— 头发（三种发型随 hue 变体）—— */}
      {v === 0 && <><rect x="3" y="1" width="8" height="2" fill={hair} /><rect x="3" y="3" width="1" height="2" fill={hair} /></>}
      {v === 1 && <rect x="3" y="1" width="8" height="3" fill={hair} />}
      {v === 2 && <><rect x="4" y="0" width="6" height="1" fill={hair} /><rect x="3" y="1" width="8" height="2" fill={hair} /></>}
      {/* —— 脸 —— */}
      <rect x="4" y="3" width="6" height="4" fill={skin} />
      <rect x="4" y="3" width="6" height="1" fill={skinDark} opacity="0.35" />
      {/* 眼睛（执行中专注眯眼，其余圆眼） */}
      {working
        ? <><rect x="5" y="4" width="2" height="1" fill={ink} /><rect x="8" y="4" width="1" height="1" fill={ink} /></>
        : <><rect x="5" y="4" width="1" height="1" fill={ink} /><rect x="8" y="4" width="1" height="1" fill={ink} /></>}
      {/* —— 身体：衬衫 + 领子 + 腰带 —— */}
      <rect x="3" y="8" width="8" height="4" fill={suit} />
      <rect x="6" y="7" width="2" height="2" fill={`hsl(${hue} 60% 68%)`} />
      <rect x="3" y="11" width="8" height="1" fill={ink} />
      {/* —— 手臂 —— */}
      {working || claiming ? (
        <>
          {/* 前伸打字 / 举手提问 */}
          {claiming
            ? <><rect x="1" y="5" width="1" height="3" fill={suitDark} /><rect x="1" y="4" width="1" height="1" fill={skin} /><rect x="12" y="8" width="1" height="4" fill={suitDark} /></>
            : <><rect x="1" y="9" width="2" height="1" fill={suitDark} /><rect x="0" y="9" width="1" height="1" fill={skin} /><rect x="11" y="9" width="2" height="1" fill={suitDark} /><rect x="13" y="9" width="1" height="1" fill={skin} /></>}
        </>
      ) : (
        <>
          {/* 垂手（走路时两帧微摆） */}
          <g className="ofc-arm-a"><rect x="2" y="8" width="1" height="4" fill={suitDark} /><rect x="2" y="12" width="1" height="1" fill={skin} /></g>
          <g className="ofc-arm-b"><rect x="1" y="8" width="1" height="4" fill={suitDark} /><rect x="1" y="12" width="1" height="1" fill={skin} /><rect x="12" y="8" width="1" height="4" fill={suitDark} /><rect x="12" y="12" width="1" height="1" fill={skin} /></g>
        </>
      )}
      {/* —— 腿（两帧交替：站立 / 迈步）—— */}
      <g className="ofc-legs-a">
        <rect x="5" y="12" width="2" height="4" fill={pants} />
        <rect x="8" y="12" width="2" height="4" fill={pants} />
        <rect x="5" y="16" width="2" height="1" fill={shoe} />
        <rect x="8" y="16" width="2" height="1" fill={shoe} />
      </g>
      <g className="ofc-legs-b">
        <rect x="4" y="12" width="2" height="4" fill={pants} />
        <rect x="9" y="12" width="2" height="4" fill={pants} />
        <rect x="4" y="16" width="2" height="1" fill={shoe} />
        <rect x="9" y="16" width="2" height="1" fill={shoe} />
      </g>
    </svg>
  );
}

/** 像素工位 v2：显示器（执行中代码滚动）+ 键盘 + 马克杯 */
function PixelDesk({ working, hue }) {
  return (
    <svg className="ofc-desk-svg" viewBox="0 0 20 12" width="40" height="24" shapeRendering="crispEdges" aria-hidden="true">
      {/* 显示器 */}
      <rect x="6" y="0" width="9" height="7" fill="#1c2230" />
      <rect x="7" y="1" width="7" height="5" fill={working ? '#57d0ff' : '#2b3a4d'} />
      {working && <><rect x="8" y="2" width="4" height="1" fill="#b7ecff" className="ofc-screen-flicker" /><rect x="8" y="4" width="5" height="1" fill="#8fd8ff" className="ofc-screen-flicker2" /></>}
      <rect x="9" y="7" width="3" height="1" fill="#1c2230" />
      <rect x="8" y="8" width="5" height="1" fill="#1c2230" />
      {/* 键盘 */}
      <rect x="12" y="9" width="5" height="1" fill="#39415a" />
      {/* 马克杯（成员色） */}
      <rect x="2" y="8" width="2" height="2" fill={`hsl(${hue} 50% 55%)`} />
      <rect x="4" y="8" width="1" height="1" fill={`hsl(${hue} 50% 55%)`} />
      {/* 桌面 */}
      <rect x="0" y="10" width="20" height="2" fill="#6b4a2b" />
      <rect x="0" y="11" width="20" height="1" fill="#54391f" />
    </svg>
  );
}

/* ---------- 场景位置（百分比坐标，拉开间距防挤） ---------- */
function homePos(i) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return { x: 21 + col * 29, y: row === 0 ? 46 : 80 };
}
/** 空闲水吧区（左下地毯，两列×三行散点，保持间距） */
function loungePos(i) {
  return { x: 8 + (i % 2) * 14, y: 50 + Math.floor(i / 2) * 16 };
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
  const walkUntilRef = useRef({});   // agentId → 走路帧动画截止时间
  const activityRef = useRef([]);    // 上一帧活动快照（换位检测 → 走路动画）
  const posRef = useRef({});         // agentId → 上一帧位置（朝向判断）
  const enteredRef = useRef(null);   // Set(已见过成员)；null=首帧未初始化
  const [justEntered, setJustEntered] = useState({}); // agentId → 进场动画中

  useEffect(() => subscribeGroup(() => {
    const chat = getActiveChat();
    const messages = [...(chat?.messages || [])];
    const roster = [...(chat?.roster || [])];

    // 新成员进门动画：roster 增员时新 unit 先落在门口，下一拍走向工位
    if (enteredRef.current) {
      const fresh = roster.filter(id => !enteredRef.current.has(id));
      if (fresh.length) {
        setJustEntered(prev => {
          const next = { ...prev };
          for (const id of fresh) next[id] = true;
          return next;
        });
        setTimeout(() => setJustEntered({}), 1700);
      }
    }
    enteredRef.current = new Set(roster);

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
    // 状态换位（idle↔其他）→ 走路帧动画窗口
    const prevActivity = activityRef.current;
    const nextActivity = deriveOfficeActivity(messages, roster, Date.now());
    for (const a of nextActivity) {
      const before = prevActivity.find(x => x.agentId === a.agentId);
      if (before && before.status !== a.status) {
        walkUntilRef.current[a.agentId] = Date.now() + WALK_MS;
      }
    }
    activityRef.current = nextActivity;
    setSnap({
      roster,
      messages,
      running: Boolean(getGroupState().running),
      chatName: chat?.name || '',
      goalStatus: chat?.goal?.status || 'idle',
    });
  }), []);

  // 初始化游标期的活动快照与已见成员（避免首次 notify 时误判走路/误触发进门）
  useEffect(() => {
    const chat = getActiveChat();
    activityRef.current = deriveOfficeActivity(chat?.messages || [], chat?.roster || [], Date.now());
    enteredRef.current = new Set(chat?.roster || []);
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
          {/* ===== 墙面：窗（飘云）+ 时钟 + 门 + 白板 + 海报 ===== */}
          <div className="ofc-wall">
            <span className="ofc-window">
              <i className="ofc-cloud" />
              <i className="ofc-cloud ofc-cloud2" />
            </span>
            <span className="ofc-clock"><i /></span>
            <span className="ofc-door" />
            <span className="ofc-board">
              {snap.goalStatus === 'running' && <i className="ofc-board-goal" title="Goal 推进中" />}
              <b>TEAM</b>
            </span>
            <span className="ofc-poster" />
          </div>
          {/* ===== 地板：地毯/水吧/绿植 + 工位 + 小人 ===== */}
          <div className="ofc-floor">
            <span className="ofc-rug" />
            <span className="ofc-cooler" title="水吧">
              <i className="ofc-cooler-jug" />
              <i className="ofc-cooler-tap" />
            </span>
            <span className="ofc-plant ofc-plant-l"><i /><i /><i /></span>
            <span className="ofc-plant ofc-plant-r"><i /><i /><i /></span>
            {snap.roster.length === 0 && (
              <div className="ofc-empty">邀请成员进群后，这里会亮起来</div>
            )}
            {snap.roster.map((id, i) => {
              const preset = presets[i] || { name: id };
              const act = activity[i] || { status: 'idle' };
              const entered = justEntered[id];
              const pos = entered ? ENTER_POS
                : act.status === 'idle' ? loungePos(i) : homePos(i);
              const hue = hueOfMemberId(id);
              const bubble = bubbles[id];
              // 朝向：比较上一帧 x，向左移动则翻转
              const prevX = posRef.current[id];
              const faceLeft = prevX != null && pos.x < prevX - 0.5;
              posRef.current[id] = pos.x;
              const walking = walkUntilRef.current[id] > now || entered;
              return (
                <div
                  key={id}
                  className={`ofc-unit is-${act.status} ${walking ? 'is-walking' : ''} ${faceLeft ? 'is-face-left' : ''}`}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: Math.round(pos.y) }}
                  title={`${preset.name} · ${OFFICE_STATUS_LABEL[act.status]}${act.lastContent ? `\n最近：${act.lastContent}` : ''}`}
                >
                  {bubble && <span className="ofc-bubble">{bubble}</span>}
                  <div className="ofc-person">
                    <PixelPerson hue={hue} status={act.status} variant={i} />
                  </div>
                  <div className="ofc-desk">
                    <PixelDesk working={act.status === 'working'} hue={hue} />
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
