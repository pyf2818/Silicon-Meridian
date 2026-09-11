// constants/index.jsx — 历史兼容 shim
// 真实定义已迁移到 appConstants.jsx，此文件仅做 re-export 以兼容旧 import 路径
// 新代码请直接 import from './constants/appConstants.jsx'

export {
  MOTIVATIONAL_QUOTES,
  NAV_ITEMS,
  CATEGORY_GROUPS,
  VERTICAL_CHANNELS,
  LLM_PRESETS,
  SCROLLING_NEWS_ITEMS,
  AGENT_CATEGORIES,
  AGENT_categories,
  MODES,
  VIEW_MODES,
  TRENDING_TYPES,
  GITHUB_LANGS,
  GITHUB_PERIODS,
  REGION_MAP,
  MODE_MAP,
  MATERIAL_TYPES,
  ARTICLE_STATUS,
  ARTICLE_TEMPLATES,
  ARTICLE_TEMPLATE_CONTENT,
  WEEKDAYS,
  MONTHS,
  ICONS,
  SOURCE_TYPES,
  SOURCE_TYPE_META,
  AI_SUBDOMAINS,
  GRADE_PRESET_TIERS,
  REGION_PRESETS,
} from './appConstants.jsx';

// index.jsx 历史独有的死代码（无任何文件引用），仅为兼容性保留
// 新代码不应使用这些 export
// （原 NAV_GROUPS 已删：零引用，且它曾引用的 briefing/tracker/trends/reading-stats
//   四个 nav 值已随「洞察分析 v1」InsightDashboardPage 一起下线——2026-09-11）

// 分类列表（旧版 CATEGORIES，内容与 appConstants.jsx 的 FALLBACK_CATEGORIES 完全一致）
import { FALLBACK_CATEGORIES } from './appConstants.jsx';
export const CATEGORIES = FALLBACK_CATEGORIES;

// 旧版默认智能体（已被 src/hooks/useAgents.js 中的 8 智能体版本取代）
export const DEFAULT_AGENTS = [
  {
    id: 'analyst',
    name: '资讯分析师',
    description: '对资讯进行结构化分析，提炼核心要点',
    icon: 'chart',
    avatar: '',
    tags: ['资讯分析', '结构化思维'],
    systemPrompt: '你是一位资深资讯分析师。你的任务是对用户提供的信息进行结构化分析，输出格式清晰、内容精炼的分析报告。概述部分控制在100字以内，影响分析适当展开。',
    category: '分析',
    isDefault: true
  },
  {
    id: 'tech-advisor',
    name: '技术顾问',
    description: '深入解读技术趋势，评估技术价值',
    icon: 'cpu',
    avatar: '',
    tags: ['技术趋势', '技术评估'],
    systemPrompt: '你是一位技术领域资深顾问。擅长解读最新技术动态，评估技术价值和落地可行性。输出简洁有力，技术判断精准，避免空话套话。请用技术人的视角，快速提炼核心技术点、技术原理、优劣势对比。',
    category: '技术',
    isDefault: true
  },
  {
    id: 'business-analyst',
    name: '商业分析师',
    description: '分析商业模式、市场机会和竞争格局',
    icon: 'trend',
    avatar: '',
    tags: ['商业模式', '市场分析'],
    systemPrompt: '你是一位资深商业分析师。擅长从商业视角分析资讯，评估市场机会、竞争格局和商业模式。输出数据驱动，观点明确，直接给出actionable insights。',
    category: '商业',
    isDefault: true
  },
  {
    id: 'writer',
    name: '写作助手',
    description: '帮助润色、改写、创作各类文案',
    icon: 'document',
    avatar: '',
    tags: ['写作辅助', '文案创作'],
    systemPrompt: '你是一位专业写作助手。擅长润色、改写、创作各类文案。保持专业、简洁的风格，突出核心信息。',
    category: '写作',
    isDefault: true
  }
];
