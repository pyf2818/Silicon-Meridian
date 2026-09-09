/**
 * OfficeGame - 像素养成模拟游戏（v26 #17 大屏覆盖层）
 *
 * 玩法：
 * - 点击小人 = 抚摸（心情+，爱心粒子）；冷却中再点 = 逗趣（小心情-微精力）
 * - 按住拖动 = 挪位置（落点按场景持久化）
 * - 食物栏选中 → 点小人投喂（扣经费）；「发工资」模式 → 点小人发钱
 * - 属性：饱食/精力/心情随时间衰减（离线补账），产出交付 +经费、发工资/投喂消耗
 * - 场景：办公室 / 休息区；团队协作开始时全员自动汇聚办公室
 * - 彩蛋：午休时间（11:30–13:30）全员聚集水吧干饭；交付时像素烟花庆祝
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getGroupState, getActiveChat, subscribeGroup, resolveMemberPreset, hueOfMemberId } from './groupChatStore.js';
import { deriveOfficeActivity } from '../../domain/agent/officeScene.js';
import { isLunchTime } from '../../domain/agent/officeGame.js';
import {
  getGameState, subscribeGame, feedActor, paySalary, petActor, playWithActor,
  setActorPos, grantWorkReward, grantGoalBonus, ensureActors,
} from './officeGameStore.js';
import { PixelPerson, PixelDesk } from './pixelArt.jsx';
import { showToast } from '../../utils/toast.js';

const SCENES = [
  { id: 'office', label: '办公室' },
  { id: 'lounge', label: '休息区' },
];

const FOOD_MENU = [
  { id: 'riceball', label: '饭团', cost: 10 },
  { id: 'coffee', label: '咖啡', cost: 15 },
  { id: 'cake', label: '蛋糕', cost: 20 },
];

const MODES = [
  { id: 'pet', label: '互动' },
  { id: 'feed', label: '投喂' },
  { id: 'salary', label: '发工资' },
];

const PET_LINES = ['好开心～', '摸摸头', '嘿嘿，被发现了', '精神多了！'];
const PLAY_LINES = ['逗我玩呢？', '哈哈哈', '再来一次！'];

/** 办公室工位（2×3，与监控面板一致但更宽） */
function deskSlot(i) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return { x: 22 + col * 28, y: row === 0 ? 44 : 78 };
}
/** 办公室水吧聚集位（午休彩蛋用） */
function lunchSlot(i) {
  return { x: 10 + (i % 3) * 12, y: 52 + Math.floor(i / 3) * 22 };
}
/** 休息区散点 */
function loungeSlot(i) {
  return { x: 14 + (i % 3) * 26, y: 52 + Math.floor(i / 3) * 28 };
}

let particleSeq = 0;

export default function OfficeGame({ onClose }) {
  const [snap, setSnap] = useState(() => ({
    roster: [...(getActiveChat()?.roster || [])],
    messages: [...(getActiveChat()?.messages || [])],
    running: Boolean(getGroupState().running),
    goalStatus: getActiveChat()?.goal?.status || 'idle',
  }));
  const [game, setGame] = useState(() => getGameState());
  const [scene, setScene] = useState('office');
  const [mode, setMode] = useState('pet');
  const [selectedFood, setSelectedFood] = useState('riceball');
  const [drag, setDrag] = useState(null);   // { id, x, y } 拖拽中的临时位置（百分比）
  const [particles, setParticles] = useState([]);
  const [bubbles, setBubbles] = useState({}); // agentId → text
  const [lunchOnce, setLunchOnce] = useState(false); // 本次午休是否已提示

  const dragRef = useRef(null);       // { id, startX, startY, moved, origX, origY, clientX, clientY }
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const workDoneRef = useRef({});     // agentId → 已结算奖励的最新 done 消息 id
  const goalRef = useRef(null);       // 上一次 goal status
  const warnRef = useRef(new Set());  // 已提示过的警告 key
  const lunchRef = useRef(false);

  /* ---------- 数据订阅 ---------- */
  useEffect(() => subscribeGroup(() => {
    const chat = getActiveChat();
    setSnap({
      roster: [...(chat?.roster || [])],
      messages: [...(chat?.messages || [])],
      running: Boolean(getGroupState().running),
      goalStatus: chat?.goal?.status || 'idle',
    });
  }), []);
  useEffect(() => subscribeGame(() => setGame(getGameState())), []);
  // 属性衰减的可视化节拍（store 是惰性补账，靠重渲染驱动读取）
  useEffect(() => {
    const t = setInterval(() => setGame(getGameState()), 5000);
    return () => clearInterval(t);
  }, []);
  // 新成员入群 → 初始化养成档案（否则属性条显示 0）
  useEffect(() => { ensureActors(snap.roster); }, [snap.roster]);

  /* ---------- 活动状态（谁在干活） ---------- */
  const activity = useMemo(
    () => deriveOfficeActivity(snap.messages, snap.roster, Date.now()),
    [snap.messages, snap.roster],
  );
  const activityMap = useMemo(() => {
    const m = {};
    for (const a of activity) m[a.agentId] = a;
    return m;
  }, [activity]);
  const presets = useMemo(() => snap.roster.map(id => resolveMemberPreset(id)), [snap.roster]);
  const anyWorking = activity.some(a => a.status === 'working' || a.status === 'claiming');

  // 5s 一个时间片：驱动属性衰减可视化与午休窗口检测（不额外加 state 依赖）
  const [now5, setNow5] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow5(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  /* ---------- 彩蛋结算：交付烟花 + 经费；Goal 达成大烟花 + 奖金 ---------- */
  useEffect(() => {
    for (const a of activity) {
      if (a.status !== 'done') continue;
      const latestDone = snap.messages
        .filter(m => m.role === 'agent' && m.agentId === a.agentId && m.meta?.phase === 'work' && m.status === 'done')
        .at(-1);
      if (!latestDone) continue;
      if (workDoneRef.current[a.agentId] === latestDone.id) continue;
      workDoneRef.current[a.agentId] = latestDone.id;
      grantWorkReward();
      spawnParticles('firework', a.agentId);
      showBubble(a.agentId, '交付啦！');
    }
    // Goal 达成 → 全员奖金 + 中央烟花
    if (snap.goalStatus === 'done' && goalRef.current !== 'done') {
      grantGoalBonus(snap.roster);
      spawnParticles('firework', '_center');
    }
    goalRef.current = snap.goalStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, snap.messages, snap.goalStatus]);

  useEffect(() => {
    const lunch = isLunchTime();
    if (lunch && !lunchRef.current) {
      lunchRef.current = true;
      setLunchOnce(true);
      for (const id of snap.roster) showBubble(id, '干饭时间！');
      setTimeout(() => setLunchOnce(false), 8000);
    }
    if (!lunch) lunchRef.current = false;
  }, [snap.roster, now5]);

  /* ---------- 状态警告气泡 ---------- */
  useEffect(() => {
    const workMap = {};
    for (const a of activity) workMap[a.agentId] = a.status === 'working' || a.status === 'claiming';
    const { warnings } = getGameState(workMap);
    for (const w of warnings) {
      const key = `${w.agentId}:${w.kind}`;
      if (warnRef.current.has(key)) continue;
      warnRef.current.add(key);
      showBubble(w.agentId, w.kind === 'hungry' ? '肚子饿了…' : w.kind === 'tired' ? '好累，想休息…' : '心情有点低落…');
    }
  }, [game, activity]);

  /* ---------- 粒子与气泡 ---------- */
  const spawnParticles = useCallback((kind, agentId) => {
    // 以成员（或屏幕中心）为原点撒 10 粒
    const el = agentId === '_center'
      ? document.querySelector('.ogame-scene')
      : document.querySelector(`[data-ogame-id="${agentId}"]`);
    const host = document.querySelector('.ogame-scene');
    if (!el || !host) return;
    const hr = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cx = ((r.left + r.width / 2) - hr.left) / hr.width;
    const cy = ((r.top + r.height / 2) - hr.top) / hr.height;
    const batch = Array.from({ length: 10 }, (_, k) => ({
      id: `pt_${particleSeq++}`,
      kind,
      x: cx * 100,
      y: cy * 100,
      dx: (Math.random() - 0.5) * 26,
      dy: -(6 + Math.random() * 18),
      delay: k * 40,
    }));
    setParticles(prev => [...prev, ...batch]);
    setTimeout(() => {
      const ids = new Set(batch.map(b => b.id));
      setParticles(prev => prev.filter(p => !ids.has(p.id)));
    }, 1500);
  }, []);

  const showBubble = useCallback((agentId, text) => {
    setBubbles(prev => ({ ...prev, [agentId]: text }));
    setTimeout(() => setBubbles(prev => {
      const next = { ...prev };
      if (next[agentId] === text) delete next[agentId];
      return next;
    }), 3200);
  }, []);

  /* ---------- 位置解析 ---------- */
  const resolvePos = useCallback((agentId, i) => {
    const act = activityMap[agentId];
    const actorState = game.actors[agentId] || {};
    const working = act && (act.status === 'working' || act.status === 'claiming');
    // 午休彩蛋：办公室全员去水吧
    if (scene === 'office' && isLunchTime(now5) && !working) return lunchSlot(i);
    // 工作时间：强制汇聚办公室工位（需求 3）
    if (anyWorking) {
      if (scene !== 'office') return null; // 干活时休息区不显示人（都在办公室）
      if (working) return deskSlot(i);
      return actorState.pos?.office || lunchSlot(i);
    }
    // 非工作：按员工所在场景渲染
    const actorScene = actorState.scene || 'office';
    if (actorScene !== scene) return null;
    const custom = actorState.pos?.[scene];
    if (custom) return custom;
    return scene === 'office' ? deskSlot(i) : loungeSlot(i);
  }, [scene, activityMap, game.actors, anyWorking, now5]);

  /* ---------- 交互：拖拽 + 点击 ---------- */
  const onUnitPointerDown = (agentId, i, e) => {
    if (e.button !== 0) return;
    const actorState = game.actors[agentId] || {};
    const base = resolvePos(agentId, i) || { x: 50, y: 50 };
    dragRef.current = {
      id: agentId, i,
      startClientX: e.clientX, startClientY: e.clientY,
      origX: base.x, origY: base.y, moved: false,
      posKey: actorState.scene || scene,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onUnitPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const host = document.querySelector('.ogame-scene');
    if (!host) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    if (!d.moved && Math.hypot(dx, dy) < 7) return; // 位移阈值：区分点击与拖拽
    if (!d.moved) d.moved = true;
    const hr = host.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, d.origX + (dx / hr.width) * 100));
    const y = Math.max(12, Math.min(92, d.origY + (dy / hr.height) * 100));
    setDrag({ id: d.id, x, y });
  };

  const onUnitPointerUp = (agentId) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved && drag && drag.id === agentId) {
      setActorPos(agentId, sceneRef.current, { x: drag.x, y: drag.y });
      setDrag(null);
      return;
    }
    setDrag(null);
    // 点击互动：按当前模式分发
    const working = activityMap[agentId] && (activityMap[agentId].status === 'working' || activityMap[agentId].status === 'claiming');
    const workMap = { [agentId]: working };
    if (mode === 'feed') {
      const res = feedActor(agentId, selectedFood, workMap);
      if (!res.ok && res.reason === 'no-coins') { showToast('经费不足——让成员多干点活吧'); return; }
      if (!res.ok && res.reason === 'full') { showBubble(agentId, '吃饱啦，吃不下'); return; }
      if (res.ok) {
        spawnParticles('food', agentId);
        showBubble(agentId, `谢谢投喂！${res.food.label}真香`);
      }
    } else if (mode === 'salary') {
      const res = paySalary(agentId, workMap);
      if (!res.ok && res.reason === 'no-coins') { showToast('经费不足，发不出工资了'); return; }
      if (res.ok) {
        spawnParticles('coin', agentId);
        showBubble(agentId, '发工资啦！干活更有劲了');
      }
    } else {
      // 互动：先抚摸，冷却中转逗趣（宠物游戏手感）
      const res = petActor(agentId, workMap);
      if (res.ok) {
        spawnParticles('heart', agentId);
        showBubble(agentId, PET_LINES[Math.floor(Math.random() * PET_LINES.length)]);
      } else {
        playWithActor(agentId, workMap);
        spawnParticles('heart', agentId);
        showBubble(agentId, PLAY_LINES[Math.floor(Math.random() * PLAY_LINES.length)]);
      }
    }
  };

  /* ---------- 渲染成员 ---------- */
  const visible = snap.roster
    .map((id, i) => ({ id, i, pos: resolvePos(id, i) }))
    .filter(u => u.pos);

  return (
    <div className="ogame-overlay" role="dialog" aria-label="像素养成模拟游戏">
      <div className="ogame">
        {/* 顶栏 */}
        <div className="ogame-topbar">
          <span className="ogame-title">像素工作室</span>
          <span className="ogame-coins" title="团队经费：产出交付获得，用于发工资与投喂">
            <i />{game.coins}
          </span>
          <div className="ogame-scene-tabs">
            {SCENES.map(s => (
              <button
                key={s.id}
                type="button"
                className={scene === s.id ? 'active' : ''}
                onClick={() => setScene(s.id)}
                disabled={anyWorking && s.id !== 'office'}
                title={anyWorking && s.id !== 'office' ? '团队协作中，全员都在办公室' : undefined}
              >{s.label}</button>
            ))}
          </div>
          <button type="button" className="ogame-close" onClick={onClose} title="关闭">✕</button>
        </div>

        {/* 互动模式栏 */}
        <div className="ogame-toolbar">
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              className={`ogame-mode ${mode === m.id ? 'active' : ''} ${m.id === 'salary' ? 'is-salary' : ''}`}
              onClick={() => setMode(m.id)}
            >{m.label}{m.id === 'salary' ? `（${80}）` : ''}</button>
          ))}
          {mode === 'feed' && (
            <span className="ogame-foods">
              {FOOD_MENU.map(f => (
                <button
                  key={f.id}
                  type="button"
                  className={`ogame-food ${selectedFood === f.id ? 'active' : ''}`}
                  onClick={() => setSelectedFood(f.id)}
                >{f.label} <em>{f.cost}</em></button>
              ))}
            </span>
          )}
          <span className="ogame-hint">
            {anyWorking ? '团队协作中：全员已汇聚办公室' : isLunchTime() ? '午休时间：大家在水吧干饭' : '点击=抚摸 · 按住拖动=挪位置'}
          </span>
        </div>

        {/* 场景 */}
        <div className="ogame-scene">
          {/* 共用墙 */}
          <div className="ofc-wall ofc-wall-big">
            <span className="ofc-window"><i className="ofc-cloud" /><i className="ofc-cloud ofc-cloud2" /></span>
            <span className="ofc-clock"><i /></span>
            {scene === 'office' ? (
              <>
                <span className="ofc-door" />
                <span className="ofc-board"><b>{snap.goalStatus === 'running' ? 'GOAL!' : 'TEAM'}</b>
                  {snap.goalStatus === 'running' && <i className="ofc-board-goal" />}
                </span>
                <span className="ofc-poster" />
              </>
            ) : (
              <span className="ogame-lounge-sign">REST</span>
            )}
          </div>
          {/* 地板与场景物件 */}
          <div className="ofc-floor ofc-floor-big">
            {scene === 'office' ? (
              <>
                <span className="ofc-rug" />
                <span className="ofc-cooler"><i className="ofc-cooler-jug" /><i className="ofc-cooler-tap" /></span>
                <span className="ofc-plant ofc-plant-l"><i /><i /><i /></span>
                <span className="ofc-plant ofc-plant-r"><i /><i /><i /></span>
                {/* 工位牌：全员散布的桌位（先画桌再画人，层级由 y 决定） */}
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <span key={`desk_${i}`} className="ogame-desk-only" style={{ left: `${deskSlot(i).x}%`, top: `${deskSlot(i).y}%`, zIndex: Math.round(deskSlot(i).y) - 1 }}>
                    <PixelDesk working={false} hue={190} />
                  </span>
                ))}
              </>
            ) : (
              <>
                <span className="ogame-sofa ogame-sofa-a"><i /><b /></span>
                <span className="ogame-sofa ogame-sofa-b"><i /><b /></span>
                <span className="ogame-tv"><i className="ofc-screen-flicker" /></span>
                <span className="ofc-cooler ogame-cooler-l"><i className="ofc-cooler-jug" /><i className="ofc-cooler-tap" /></span>
                <span className="ofc-plant ofc-plant-l"><i /><i /><i /></span>
                <span className="ofc-plant ofc-plant-r"><i /><i /><i /></span>
              </>
            )}

            {/* 成员 */}
            {visible.length === 0 && (
              <div className="ofc-empty">{scene === 'office' ? '办公室空荡荡——邀请成员进群吧' : '休息区没人，大家都上班去了'}</div>
            )}
            {visible.map(({ id, i, pos }) => {
              const preset = presets[i] || { name: id };
              const hue = hueOfMemberId(id);
              const st = game.actors[id] || {};
              const act = activityMap[id];
              const status = act?.status || 'idle';
              const p = (drag && drag.id === id) ? drag : pos;
              const lunch = scene === 'office' && isLunchTime(now5) && !status.startsWith('work') && status !== 'claiming';
              return (
                <div
                  key={id}
                  data-ogame-id={id}
                  className={`ogame-unit is-${status} ${drag && drag.id === id ? 'is-dragging' : ''} ${lunch ? 'is-lunch' : ''}`}
                  style={{ left: `${p.x}%`, top: `${p.y}%`, zIndex: Math.round(p.y) + 2 }}
                  onPointerDown={(e) => onUnitPointerDown(id, i, e)}
                  onPointerMove={onUnitPointerMove}
                  onPointerUp={() => onUnitPointerUp(id)}
                >
                  {bubbles[id] && <span className="ofc-bubble">{bubbles[id]}</span>}
                  <div className="ofc-person">
                    <PixelPerson hue={hue} status={status} variant={i} width={38} />
                  </div>
                  <span className="ogame-name">{preset.name}</span>
                  {/* 三维属性条 */}
                  <div className="ogame-stats" title={`饱食 ${Math.round(st.hunger ?? 0)} · 精力 ${Math.round(st.energy ?? 0)} · 心情 ${Math.round(st.mood ?? 0)}`}>
                    <span className={`ogame-bar is-hunger ${((st.hunger ?? 0) < 25) ? 'is-low' : ''}`}><i style={{ width: `${st.hunger ?? 0}%` }} /></span>
                    <span className={`ogame-bar is-energy ${((st.energy ?? 0) < 25) ? 'is-low' : ''}`}><i style={{ width: `${st.energy ?? 0}%` }} /></span>
                    <span className={`ogame-bar is-mood ${((st.mood ?? 0) < 25) ? 'is-low' : ''}`}><i style={{ width: `${st.mood ?? 0}%` }} /></span>
                  </div>
                  <span className={`ogame-chip ${status !== 'idle' ? 'is-busy' : ''}`}>{status === 'working' ? '执行中' : status === 'claiming' ? '思考中' : status === 'done' ? '刚交付' : status === 'claimed' ? '已认领' : '休息中'}</span>
                </div>
              );
            })}

            {/* 粒子（爱心/金币/食物/烟花） */}
            {particles.map(pt => (
              <span
                key={pt.id}
                className={`ogame-pt is-${pt.kind}`}
                style={{ left: `${pt.x}%`, top: `${pt.y}%`, '--pt-dx': `${pt.dx}px`, '--pt-dy': `${pt.dy}px`, animationDelay: `${pt.delay}ms` }}
              />
            ))}
          </div>

          {/* 底部说明 */}
          <div className="ogame-foot">
            饱食/精力会随时间下降（离线也照算）· 交付产出赚经费 · 抚摸和投喂提升心情 · 午休时间全员去水吧
          </div>
        </div>
      </div>
    </div>
  );
}
