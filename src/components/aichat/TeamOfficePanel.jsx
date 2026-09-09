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
import { PixelPerson, PixelDesk } from './pixelArt.jsx';
import OfficeGame from './OfficeGame.jsx';

const COLLAPSE_KEY = 'teamOfficePanelCollapsed';
const WALK_MS = 1600;        // 换位后保留走路帧动画的时长
const BUBBLE_MS = 4600;      // 气泡停留时长
const TICK_MS = 5000;        // 状态时间窗衰减的刷新节拍
const ENTER_POS = { x: 88, y: 26 }; // 新成员进门位（墙门下方）

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
  const [showGame, setShowGame] = useState(false); // v26 #17：养成游戏大屏
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
          className="team-office-game"
          onClick={() => setShowGame(true)}
          title="进入像素工作室（养成模拟游戏）"
        >养成</button>
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
      {/* v26 #17 养成模拟游戏大屏（覆盖层） */}
      {showGame && <OfficeGame onClose={() => setShowGame(false)} />}
    </div>
  );
}
