/**
 * ChuanChuanGuide - 川川官方引导员（v39）
 *
 * 「联系人」列表中的常驻系统联系人：点开即聊，向用户介绍产品基础操作。
 * 设计约束（对抗性审查后收口）：
 * - 纯本地：不走服务端私聊（community contacts 是真实用户关系，川川是官方系统账号，
 *   混进服务端会造成好友关系污染）；不依赖 LLM 配置（新用户开箱即用）。
 * - 知识库 = 关键词匹配 + 默认兜底 + 快捷问题 chips；消息存 localStorage（封顶 60 条）。
 * - 形象用升级后的 ChuanChuanV2（guide 模式：光环 + 芯片天线）。
 */
import { useEffect, useRef, useState } from 'react';
import { ChuanChuanV2 } from './ChuanChuanV2.jsx';
import { ICONS } from '../../constants/appConstants.jsx';

export const CHUANCHUAN_CONTACT = {
  id: 'chuanchuan-official',
  displayName: '川川',
  username: 'chuanchuan',
  isSystem: true,
  tagline: '官方引导员 · 有问必答',
};

const MSG_KEY = 'chuanchuanGuideMessages';
const MAX_MESSAGES = 60;

/** 基础操作知识库：关键词 → 回答（命中关键词最多的条目胜出） */
const KB = [
  {
    keywords: ['导航', '页面', '功能', '都能干', '有什么用', '这是啥', '介绍'],
    answer: '万般硅川是一个「AI 工作站 + 情报站 + 社区」三合一的平台：\n\n1. **AI 工作站**——和常驻智能体 SiliconStream 对话，它能查资讯、写文件、跑多步任务；\n2. **资讯**——每日 AI 情报聚合与简报，可回看历史快照；\n3. **社区**——发布帖子、关注作者、私聊和群聊；\n4. **工作流**——把常用分析链路拖拽成自动化流水线；\n5. **行情**——股票行情、K 线与 AI 诊断。\n\n想深入了解哪一块？点下方的快捷问题就行。',
  },
  {
    keywords: ['工作站', '智能体', 'agent', '对话', '指令', '角色'],
    answer: '**AI 工作站**在左侧导航第一项。打开后：\n\n- 顶部可切换专家角色（情报总控 / 资讯分析师 / 技术顾问…），每个角色有专属工具；\n- 直接说需求即可，需要查资料/写文件时我会调用工具并请求你批准；\n- 复杂任务先发「帮我制定计划」，我会拆解成步骤逐步执行；\n- 右上角可调权限档：协助（每步确认）/ 自主 / 计划模式。\n\n小技巧：把资讯卡片拖进输入框，我可以直接分析这条资讯。',
  },
  {
    keywords: ['技能', 'skill', '导入', '沉淀'],
    answer: '**技能库**是智能体的成长资产（右侧边栏「技能」标签）：\n\n- 工作站完成任务后会自动把方法论沉淀成技能；\n- 你也可以点「导入」从 GitHub 或 zip 包安装社区技能（兼容 Agent Skills 开放标准，支持带脚本/参考文档的完整技能包）；\n- 导入的脚本不会自动执行——我使用前会先读源码并请求你批准，放心装。\n\n想试试？粘一个 GitHub 技能目录链接就能装。',
  },
  {
    keywords: ['进化', '等级', '成长', '经验', '档案'],
    answer: '**进化档案**记录智能体的成长（角色设定抽屉里查看）：\n\n- 每完成一次真实任务就累积成长值（任务数、工具调用、token、技能、经验都算权重）；\n- 等级从种子 → 萌芽 → 成长 → 熟练 → 专家 → 大师，只升不降；\n- 成长趋势图会画出你的成长曲线和等级阈值线；\n- 沉淀的工作经验会注入每次对话，让我越用越懂你。',
  },
  {
    keywords: ['资讯', '简报', '新闻', '订阅', '来源'],
    answer: '**资讯页**是每日 AI 情报站：\n\n- 顶部是当日简报与重点事件，卡片点开看详情；\n- 想回看前几天？点左侧日期轨道切换历史快照；\n- 「我的订阅」里可以按来源等级（S/A/B/C/D）管理信息源；\n- 看到重要内容可以存素材库，或直接拖进 AI 工作站让我分析。',
  },
  {
    keywords: ['社区', '发布', '帖子', '点赞', '评论'],
    answer: '**社区**是创作者聚集地：\n\n- 广场浏览帖子，右上角「发布」写文章（支持配图与附件）；\n- 关注喜欢的作者后，他们出现在你的联系人里，可以私聊；\n- 发布优质内容可获得认证徽章（博主 / 企业 / 个人）；\n- 群聊支持多人协作，用邀请码即可加入。',
  },
  {
    keywords: ['股票', '行情', 'k线', 'K 线', '诊断', '自选'],
    answer: '**行情**模块提供 A 股 / 港股行情：\n\n- 搜索代码看实时行情与五档盘口；\n- K 线页支持日 / 周 / 月切换和 AI 诊断；\n- 可以把股票加入监控，触发条件时给你提醒。\n\n（数据仅供参考，不构成投资建议。）',
  },
  {
    keywords: ['登录', '注册', '账号', '认证'],
    answer: '**账号**：右上角头像进入登录 / 注册。注册后可以发布帖子、关注作者、私聊和使用云端同步能力。本地功能（资讯浏览、AI 对话）无需登录也能用。',
  },
  {
    keywords: ['你好', '在吗', 'hello', 'hi', '你是谁', '你是干什么的'],
    answer: '嗨，我是**川川**——万般硅川的官方引导员💧\n\n我的职责就是带你快速上手：平台有什么功能、怎么用、去哪儿找。下面这些快捷问题都是新朋友最常问的，点一个我就展开讲；也可以直接打字问我。',
  },
];

const QUICK_QUESTIONS = ['平台都有什么功能？', 'AI 工作站怎么用？', '怎么导入社区技能？', '进化档案是什么？', '社区怎么发布？'];

const WELCOME = '嗨，我是**川川**——万般硅川的官方引导员💧\n\n第一次来？点下方的快捷问题，我带你把平台逛一遍；有任何操作问题直接问我，随时在。';

/** 知识库匹配：按命中关键词数取最高分条目 */
function matchKB(text) {
  const q = String(text || '').toLowerCase();
  if (!q) return null;
  let best = null;
  let bestHits = 0;
  for (const entry of KB) {
    const hits = entry.keywords.filter(k => q.includes(String(k).toLowerCase())).length;
    if (hits > bestHits) {
      best = entry;
      bestHits = hits;
    }
  }
  return best ? best.answer : null;
}

function loadMessages() {
  try {
    const raw = localStorage.getItem(MSG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch { return []; }
}

export default function ChuanChuanGuide({ open, onClose }) {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ id: 'w', role: 'chuanchuan', content: WELCOME, at: Date.now() }]);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(MSG_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES))); } catch { /* ignore */ }
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, typing]);

  if (!open) return null;

  const ask = (text) => {
    const content = String(text || '').trim();
    if (!content || typing) return;
    const userMsg = { id: `u_${Date.now()}`, role: 'user', content, at: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);
    // 本地匹配：短延迟模拟思考（无网络依赖）
    timerRef.current = setTimeout(() => {
      const answer = matchKB(content)
        || '这个问题我还没准备标准答案——不过我可以带你认识这些主题：\n\n- 平台功能总览\n- AI 工作站怎么用\n- 技能导入\n- 进化档案\n- 社区发布\n\n点上面的快捷问题，或换个说法再问我一次。';
      setMessages(prev => [...prev, { id: `c_${Date.now()}`, role: 'chuanchuan', content: answer, at: Date.now() }]);
      setTyping(false);
    }, 420);
  };

  const renderContent = (content) => content.split('\n').map((line, i) => (
    <p key={i} className="cc-guide-line" dangerouslySetInnerHTML={{
      __html: line
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'),
    }} />
  ));

  return (
    <div className="cc-guide-overlay" onClick={onClose}>
      <div className="cc-guide-dialog" onClick={e => e.stopPropagation()}>
        <header className="cc-guide-header">
          <div className="cc-guide-avatar"><ChuanChuanV2 size={52} guide /></div>
          <div className="cc-guide-id">
            <strong>川川</strong>
            <small>官方引导员 · 基础操作有问必答</small>
          </div>
          <button type="button" className="cc-guide-close" onClick={onClose} title="关闭">{ICONS.x || '×'}</button>
        </header>

        <div className="cc-guide-messages custom-scrollbar" ref={listRef}>
          {messages.map(msg => (
            <div key={msg.id} className={`cc-guide-msg is-${msg.role}`}>
              {msg.role === 'chuanchuan' && (
                <div className="cc-guide-msg-avatar"><ChuanChuanV2 size={30} /></div>
              )}
              <div className="cc-guide-bubble">{renderContent(msg.content)}</div>
            </div>
          ))}
          {typing && (
            <div className="cc-guide-msg is-chuanchuan">
              <div className="cc-guide-msg-avatar"><ChuanChuanV2 size={30} /></div>
              <div className="cc-guide-bubble cc-guide-typing"><span /><span /><span /></div>
            </div>
          )}
        </div>

        <div className="cc-guide-chips">
          {QUICK_QUESTIONS.map(q => (
            <button key={q} type="button" className="cc-guide-chip" onClick={() => ask(q)} disabled={typing}>{q}</button>
          ))}
        </div>

        <footer className="cc-guide-inputrow">
          <input
            className="cc-guide-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ask(input); }}
            placeholder="问川川一个操作问题…"
            disabled={typing}
          />
          <button type="button" className="cc-guide-send" onClick={() => ask(input)} disabled={typing || !input.trim()}>发送</button>
        </footer>
      </div>
    </div>
  );
}
