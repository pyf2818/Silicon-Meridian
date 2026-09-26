import { useEffect, useMemo, useState } from 'react';
import { useChat } from '../hooks/useChat.js';
import CommunityAvatar from './community/CommunityAvatar.jsx';
import MascotState from './community/MascotState.jsx';
import PostCover from './community/PostCover.jsx';
import ChuanChuanGuide, { CHUANCHUAN_CONTACT } from './community/ChuanChuanGuide.jsx';
import { ChuanChuanV2 } from './community/ChuanChuanV2.jsx';

const label = item => item?.displayName || item?.username || item?.title || '未命名会话';
const DAY = 86400000;
const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const STREAK_KEY = 'meridian_chat_streaks_v1';

function readStreaks() { try { return JSON.parse(localStorage.getItem(STREAK_KEY) || '{}') || {}; } catch { return {}; } }

/** v24 #5 续火花：从消息窗口推算连续聊天天数（今天/昨天起算），与本地缓存取较大值 */
function computeStreakDays(messages, now = dayStart(Date.now())) {
  const days = [...new Set((messages || []).map(m => dayStart(m.createdAt)))].sort((a, b) => b - a);
  if (!days.length || now - days[0] > DAY) return { count: 0, lastDay: days[0] || 0 };
  let count = 1;
  for (let i = 1; i < days.length && days[i - 1] - days[i] === DAY; i++) count++;
  return { count, lastDay: days[0] };
}
function updateStreak(convId, messages) {
  const now = dayStart(Date.now());
  const computed = computeStreakDays(messages, now);
  const streaks = readStreaks();
  const prev = streaks[convId];
  const prevAlive = prev && prev.count >= 1 && now - prev.lastDay <= DAY ? prev.count : 0;
  const entry = { count: Math.max(computed.count, prevAlive), lastDay: Math.max(computed.lastDay, prevAlive ? prev.lastDay : 0) };
  streaks[convId] = entry;
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(streaks)); } catch { /* 隐私模式忽略 */ }
  return entry.count;
}

export default function ChatPage({ user, pendingShare, onConsumeShare, onRequireAuth, onOpenPost }) {
  const chat = useChat({ enabled: Boolean(user) });
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [inviteCode, setInviteCode] = useState('');
  const [discover, setDiscover] = useState([]);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [manualId, setManualId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [streakTick, setStreakTick] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const active = useMemo(() => chat.conversations.find(item => item.id === chat.activeId), [chat.conversations, chat.activeId]);
  const streaks = useMemo(() => readStreaks(), [streakTick]);
  const now = dayStart(Date.now());
  const streakOf = convId => { const entry = streaks[convId]; return entry && entry.count >= 2 && now - entry.lastDay <= DAY ? entry.count : 0; };

  useEffect(() => { if (!user) return; if (!chat.activeId && chat.conversations[0]) openConversation(chat.conversations[0].id); /* eslint-disable-next-line */ }, [user, chat.activeId, chat.conversations]);
  useEffect(() => { if (pendingShare && chat.activeId) { setDraft(pendingShare.title ? `分享：${pendingShare.title}` : '分享一条资讯'); } }, [pendingShare, chat.activeId]);

  const openConversation = async id => {
    const items = await chat.loadMessages(id);
    if (items) { updateStreak(id, items); setStreakTick(t => t + 1); }
  };
  if (!user) return <section className="chat-page chat-empty"><MascotState testId="chat-login-state" title="川川帮你传话" hint="登录后与联系人私聊或组建群组，把资讯与创作直接分享进会话。" actionLabel="登录开始聊天" onAction={onRequireAuth} /></section>;

  const send = async () => { const text = draft.trim(); if ((!text && !pendingShare) || !chat.activeId) return; const message = await chat.sendMessage({ body: text || '分享内容', kind: pendingShare ? 'share' : 'text', sharePayload: pendingShare || null }); setDraft(''); onConsumeShare?.(); updateStreak(chat.activeId, [...chat.messages, message]); setStreakTick(t => t + 1); };
  const startDirect = async contact => { const conversation = await chat.createConversation({ kind: 'direct', memberIds: [contact.id], title: label(contact) }); await openConversation(conversation.id); };
  const createGroup = async () => { if (!selectedContacts.length) return; const conversation = await chat.createConversation({ kind: 'group', title: groupName || '新群聊', memberIds: selectedContacts }); setGroupName(''); setSelectedContacts([]); await openConversation(conversation.id); };
  const deleteContact = async contactId => { setConfirmDeleteId(''); await chat.removeContact(contactId); };
  const addById = async () => { const id = manualId.trim(); if (!id) return; try { await chat.addContact(id); setManualId(''); } catch (e) { chat.setError(e.message); } };
  const loadDiscover = async () => {
    setDiscoverOpen(value => !value);
    if (discover.length || discoverOpen) return;
    try {
      const response = await fetch('/api/community/posts?limit=20', { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      const items = payload?.data?.items || [];
      const known = new Set([user.id, ...chat.contacts.map(item => item.id)]);
      const unique = [];
      for (const post of items) {
        if (!post.authorId || known.has(post.authorId) || unique.some(item => item.id === post.authorId)) continue;
        unique.push({ id: post.authorId, displayName: post.displayName || post.username, username: post.username });
      }
      setDiscover(unique.slice(0, 10));
    } catch { chat.setError('无法加载社区用户'); }
  };
  const discoverLeft = discover.filter(item => !chat.contacts.some(contact => contact.id === item.id));

  return <section className="chat-page chat-page-full">
    <header className="chat-header chat-header-compact"><h1>联系人</h1><div className="chat-header-actions"><input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="输入群邀请码" /><button onClick={() => chat.joinByCode(inviteCode).catch(e => chat.setError(e.message))}>加入群聊</button></div></header>
    {chat.error && <div className="chat-error" onClick={() => chat.setError('')}>{chat.error}</div>}
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <div className="chat-panel-title"><strong>会话</strong><button onClick={() => chat.load()}>刷新</button></div>
        {chat.loading && <div className="chat-muted">正在同步…</div>}
        {chat.conversations.map(item => { const fire = streakOf(item.id); return <button key={item.id} className={`chat-conversation ${item.id === chat.activeId ? 'active' : ''}`} onClick={() => openConversation(item.id)}><CommunityAvatar name={label(item)} src={item.avatar || item.avatarUrl || ''} size={34} /><span><strong>{label(item)}{fire > 0 && <em className="chat-streak" title={`已连续聊天 ${fire} 天`}>🔥{fire}</em>}</strong><small>{item.lastMessage?.body || (item.kind === 'group' ? `${item.memberCount} 位成员` : '开始聊天')}</small></span></button>; })}
        {!chat.conversations.length && <MascotState size={72} title="还没有会话" hint="从右侧联系人发起第一场聊天，或用邀请码加入群组。" />}
      </aside>
      <main className="chat-main">
        {active ? <>
          <div className="chat-main-head"><div><strong>{label(active)}{streakOf(active.id) > 0 && <em className="chat-streak">🔥{streakOf(active.id)} 天火花</em>}</strong><span>{active.kind === 'group' ? `${active.memberCount} 位成员` : '私聊'}</span></div><code>{active.inviteCode || ''}</code></div>
          <div className="chat-messages">
            {chat.messages.map(message => <article key={message.id} className={`chat-message ${message.senderId === user.id ? 'mine' : ''}`}><div className="chat-message-meta">{message.senderName || (message.senderId === user.id ? '我' : '成员')} · {new Date(message.createdAt).toLocaleString()}</div>{message.kind === 'share' && message.sharePayload?.type === 'community-post' && <div className="chat-share-card chat-post-card" data-testid="chat-post-card"><PostCover post={{ id: message.sharePayload.id || 'share', title: message.sharePayload.title || '', channel: 'discussion', cover: { kind: 'auto' } }} height={92} /><div className="chat-post-card-body"><strong>{message.sharePayload.title || message.body}</strong><small>@{message.sharePayload.author || '社区作者'} · 来自用户广场</small>{onOpenPost && <button type="button" onClick={() => onOpenPost(message.sharePayload.id)}>在广场查看 →</button>}</div></div>}{message.kind === 'share' && message.sharePayload?.type !== 'community-post' && <div className="chat-share-card"><span>分享内容</span><strong>{message.sharePayload?.title || message.body}</strong><small>{message.sharePayload?.type || '资讯'}</small></div>}<p>{message.body}</p></article>)}
            {!chat.messages.length && <MascotState size={72} title="发送第一条消息" hint="开始协作，也可以把广场内容分享进来。" />}
          </div>
          <div className="chat-composer">
            {pendingShare && <div className="chat-share-pending">待分享：{pendingShare.title || '一条内容'} <button onClick={onConsumeShare}>取消</button></div>}
            <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send().catch(err => chat.setError(err.message)); } }} placeholder="输入消息，Enter 发送" />
            <button className="ai-primary-action" onClick={() => send().catch(err => chat.setError(err.message))}>发送</button>
          </div>
        </> : <MascotState size={80} title="选择一个会话" hint="从右侧联系人发起聊天，或从广场发现有趣的作者。" />}
      </main>
      <aside className="chat-contacts">
        <div className="chat-panel-title"><strong>联系人</strong><button className={discoverOpen ? 'active' : ''} onClick={loadDiscover}>从社区发现</button></div>
        <input className="chat-contact-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索联系人" />
        {discoverOpen && <div className="chat-discover">
          <div className="chat-discover-title">社区活跃作者</div>
          {discoverLeft.map(item => <div key={item.id} className="chat-discover-item"><CommunityAvatar name={label(item)} src={item.avatar || ''} size={30} /><span><strong>{label(item)}</strong><small>@{item.username}</small></span><button onClick={() => chat.addContact(item.id).catch(e => chat.setError(e.message))}>添加</button></div>)}
          {!discoverLeft.length && <div className="chat-muted">暂无可添加的社区作者，去广场发布或互动后再来。</div>}
          <div className="chat-discover-title">按用户 ID 添加</div>
          <div className="chat-discover-manual"><input value={manualId} onChange={e => setManualId(e.target.value)} placeholder="粘贴用户 ID" /><button onClick={() => addById()}>添加</button></div>
        </div>}
        {(!search || `${CHUANCHUAN_CONTACT.displayName}${CHUANCHUAN_CONTACT.username}`.includes(search)) && <div
          className="chat-contact chat-contact-system"
          role="button" tabIndex={0}
          onClick={() => setGuideOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGuideOpen(true); } }}
        >
          <div className="cc-guide-entry-avatar"><ChuanChuanV2 size={34} guide /></div>
          <span><strong>{CHUANCHUAN_CONTACT.displayName}</strong><small>{CHUANCHUAN_CONTACT.tagline}</small></span>
          <button onClick={e => { e.stopPropagation(); setGuideOpen(true); }}>咨询</button>
        </div>}
        {chat.contacts.filter(item => !search || `${item.displayName}${item.username}`.includes(search)).map(contact => <div key={contact.id} className={`chat-contact ${confirmDeleteId === contact.id ? 'confirming' : ''}`}>
          <CommunityAvatar name={label(contact)} src={contact.avatar || contact.avatarUrl || ''} size={34} online />
          <span><strong>{label(contact)}</strong><small>@{contact.username}</small></span>
          {confirmDeleteId === contact.id ? <><button className="chat-danger-btn" onClick={() => deleteContact(contact.id).catch(e => { chat.setError(e.message); setConfirmDeleteId(''); })}>确认删除</button><button onClick={() => setConfirmDeleteId('')}>取消</button></> : <><button onClick={() => startDirect(contact).catch(e => chat.setError(e.message))}>聊天</button><button className="chat-icon-btn" title="删除好友" onClick={() => setConfirmDeleteId(contact.id)}>✕</button></>}
        </div>)}
        {!chat.contacts.length && !search && !discoverOpen && <MascotState size={72} title="还没有联系人" hint="试试「从社区发现」，川川把活跃作者带给你。" />}
        <div className="chat-group-create">
          <strong>创建群聊</strong>
          <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="群名称" />
          {chat.contacts.map(contact => <label key={contact.id}><input type="checkbox" checked={selectedContacts.includes(contact.id)} onChange={e => setSelectedContacts(prev => e.target.checked ? [...prev, contact.id] : prev.filter(id => id !== contact.id))} />{label(contact)}</label>)}
          <button onClick={() => createGroup().catch(e => chat.setError(e.message))}>创建群聊</button>
        </div>
      </aside>
    </div>
    <ChuanChuanGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
  </section>;
}
