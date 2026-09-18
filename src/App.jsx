import { useEffect, useMemo, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, useLightboxStore, useWorkflowStore, useMaterialsStore, useProfileStore, useNewsStore, useRecommendStore, useBehaviorStore, useAiStore, useStockStore, useElfStore, useSourceStore } from './store/index.js';
import SettingsModal from './components/SettingsModal.jsx';
import ArticleEditor from './components/ArticleEditor.jsx';
import ColorfulBubbles from './components/ColorfulBubbles.jsx';
import AiChatPanel from './components/AiChatPanel.jsx';
import { formatTime, formatRelative, getGradeColors, isEnglishText, isChineseText } from './utils/format.js';
import { validateWorkflowDraft } from './utils/workflowValidation.js';
import { loadLS, saveLS, clearStaleLS } from './utils/localStorage.js';
import { showToast } from './utils/toast.js';
import { renderMarkdown, renderBriefMarkdown } from './utils/markdown.jsx';
import SkeletonCard from './components/SkeletonCard.jsx';
import NewsItem from './components/NewsItem.jsx';
import HexRadarChart from './components/HexRadarChart.jsx';
import TrendLineChart from './components/TrendLineChart.jsx';
import { useAuth } from './hooks/useAuth.js';
import { useLlmConfig } from './hooks/useLlmConfig.js';
import { useTrending } from './hooks/useTrending.js';
import { useSourceManager } from './hooks/useSourceManager.js';
import { useCalendar } from './hooks/useCalendar.js';
import { useUI } from './hooks/useUI.js';
import { useCreativeWorkspace } from './hooks/useCreativeWorkspace.js';
import { useCalendarMemos } from './hooks/useCalendarMemos.js';
import { useRecommendationFeedback } from './hooks/useRecommendationFeedback.js';
import { useAgentWorkflowRunner } from './hooks/useAgentWorkflowRunner.js';
import { useWorkflowActions } from './hooks/useWorkflowActions.js';
import { useMaterialsMemos } from './hooks/useMaterialsMemos.js';
import { useReadingStatsMemos } from './hooks/useReadingStatsMemos.js';
import { useWorkflowMeta } from './hooks/useWorkflowMeta.js';
import { useWorkflowOps } from './hooks/useWorkflowOps.js';
import { useNewsFilter } from './hooks/useNewsFilter.js';
import { useAgents } from './hooks/useAgents.js';
import { useExternalIntelligence } from './hooks/useExternalIntelligence.js';
import { useIntelligenceMemos } from './hooks/useIntelligenceMemos.js';
import { useRecommendationMemos } from './hooks/useRecommendationMemos.js';
import { selectBriefingLanes } from './domain/intelligence/recommendationEngine.js';
import { buildDiscoverFeed } from './domain/intelligence/discoverFeed.js';
import { computeNewsTrends } from './domain/intelligence/trendAnalytics.js';
import { useIntelligenceBriefing } from './hooks/useIntelligenceBriefing.js';
import { useBookmarkMaterial } from './hooks/useBookmarkMaterial.js';
import { useArticleEditor } from './hooks/useArticleEditor.js';
import { useGithubInsight } from './hooks/useGithubInsight.js';
import { BlockGrid, BlockPanel, BlockStat, BlockToolbar } from './blocks/index.js';
import CommandPalette from './shell/CommandPalette.jsx';
import IntelligenceFeedPanel from './components/IntelligenceFeedPanel.jsx';
import LanguageSwitcher from './components/LanguageSwitcher.jsx';
import RecommendationFeed from './components/RecommendationFeed.jsx';
import RecommendationDateRail from './components/RecommendationDateRail.jsx';
import TodayNewspaper from './components/TodayNewspaper.jsx';
import ChatPage from './components/ChatPage.jsx';
import Topbar from './components/Topbar.jsx';
import NewsPage from './components/NewsPage.jsx';
import CustomUrlPage from './components/CustomUrlPage.jsx';
import CalendarPage from './components/CalendarPage.jsx';
import MaterialsPage from './components/MaterialsPage.jsx';
import Lightbox from './components/Lightbox.jsx';
import NewsPreviewPanel from './components/NewsPreviewPanel.jsx';
import AuthModal from './components/AuthModal.jsx';
import InterestModal from './components/InterestModal.jsx';
import RightPanel from './components/RightPanel.jsx';
import Sidebar from './components/Sidebar.jsx';
import ProfileModal from './components/ProfileModal.jsx';
import LlmQuickConfigModal from './components/LlmQuickConfigModal.jsx';
import OnboardingFlow from './components/OnboardingFlow.jsx';
import EntranceSplash from './components/visual/EntranceSplash.jsx'; // 进场动画「水墨开卷」
import ShortcutsModal from './components/ShortcutsModal.jsx';
import NewspaperOverlay from './components/NewspaperOverlay.jsx';
import EventFormModal from './components/EventFormModal.jsx';
import ArticleSpaceModal from './components/ArticleSpaceModal.jsx';
import AddMaterialModal from './components/AddMaterialModal.jsx';
import { useProfileSync } from './hooks/useProfileSync.js';
import { useWorkbenchMemos } from './hooks/useWorkbenchMemos.js';
import { useTranslationSummary } from './hooks/useTranslationSummary.js';
import {
  domainTierScore,
  sourceTierScore,
} from './domain/intelligence/profileTiers.js';
import { createSnapshotStore } from './domain/intelligence/snapshotStore.js';
import { isAiElfAsset, normalizeAsset } from './domain/creative/assetModel.js';
import { exportDocument } from './domain/creative/exportEngine.js';
import { saveDocumentVersion } from './domain/creative/versionStore.js';

// 代码分割：三个重组件按需加载，避免首屏全量打包 Three.js / klinecharts
import SafeBoundary from './components/SafeBoundary.jsx';
const GlobeView = lazy(() => import('./GlobeView.jsx'));
const AiElf = lazy(() => import('./AiElf.jsx'));
const SelectionTranslate = lazy(() => import('./components/aielf/SelectionTranslate.jsx'));
const StockPage = lazy(() => import('./components/StockPage.jsx'));
const CommunityPage = lazy(() => import('./components/CommunityPage.jsx'));
const ProfilePage = lazy(() => import('./components/ProfilePage.jsx'));
const GithubPage = lazy(() => import('./components/GithubPage.jsx'));
const RecommendationsPage = lazy(() => import('./components/RecommendationsPage.jsx'));
const TrendingPage = lazy(() => import('./components/TrendingPage.jsx'));
const CanvasPage = lazy(() => import('./components/workflow/CanvasPage.jsx'));
const KnowledgeExportPage = lazy(() => import('./components/KnowledgeExportPage.jsx'));
const MonitorPage = lazy(() => import('./components/MonitorPage.jsx'));
const ReadingListPage = lazy(() => import('./components/ReadingListPage.jsx'));

import {
  PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_DESCRIPTION,
  MOTIVATIONAL_QUOTES,
  NAV_ITEMS, PRIMARY_NAV_ITEMS, NAV_CONTEXT_SECTIONS,
  formatWorkflowNodeConfig,
  FALLBACK_CATEGORIES, CATEGORY_GROUPS, VERTICAL_CHANNELS,
  LLM_PRESETS, SCROLLING_NEWS_ITEMS, AGENT_categories,
  MODES, VIEW_MODES, TRENDING_TYPES,
  GITHUB_LANGS, GITHUB_PERIODS,
  REGION_MAP, MODE_MAP, MATERIAL_TYPES,
  ARTICLE_STATUS, ARTICLE_TEMPLATES, ARTICLE_TEMPLATE_CONTENT,
  WEEKDAYS, MONTHS,
  ICONS,
} from './constants/appConstants.jsx';


function App() {
  clearStaleLS();
  // i18n：t 翻译函数，i18n.language 当前语言（用于 useMemo 依赖触发重新翻译）
  const { t, i18n } = useTranslation();
  // 派生翻译后的导航数据（语言切换时自动重算）
  const navItems = useMemo(() => NAV_ITEMS.map(item => ({ ...item, label: t(item.labelKey) })), [t, i18n.language]);
  const primaryNavItems = useMemo(() => PRIMARY_NAV_ITEMS.map(item => ({
    ...item,
    label: t(item.labelKey),
    desc: t(item.descKey),
    short: t(item.shortKey),
  })), [t, i18n.language]);
  const navContextSections = useMemo(() => {
    const translated = {};
    for (const [key, section] of Object.entries(NAV_CONTEXT_SECTIONS)) {
      translated[key] = { ...section, label: t(section.labelKey) };
    }
    return translated;
  }, [t, i18n.language]);

  // ===== UI 状态从 useUiStore 获取（Zustand 全局 store）=====
  const themeMode = useUiStore(s => s.themeMode);
  const setThemeMode = useUiStore(s => s.setThemeMode);
  const editorFullscreen = useUiStore(s => s.editorFullscreen);
  const setEditorFullscreen = useUiStore(s => s.setEditorFullscreen);
  const nav = useUiStore(s => s.nav);
  const setNav = useUiStore(s => s.setNav);
  const showSettings = useUiStore(s => s.showSettings);
  const setShowSettings = useUiStore(s => s.setShowSettings);
  const settingsTab = useUiStore(s => s.settingsTab);
  const setSettingsTab = useUiStore(s => s.setSettingsTab);
  // 一次性的 URL ?view=xxx 参数支持（仅在首次挂载时覆盖 store 的 nav）
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    if (requested && NAV_ITEMS.some(item => item.id === requested)) {
      setNav(requested);
    }
  }, [setNav]);

  // ===== 主题与 UI 杂项状态（迁移自 useState -> Zustand uiStore）=====
  const palette = useUiStore(s => s.palette);
  const setPalette = useUiStore(s => s.setPalette);
  const globeFullscreenOpen = useUiStore(s => s.globeFullscreenOpen);
  const setGlobeFullscreenOpen = useUiStore(s => s.setGlobeFullscreenOpen);
  const panelCollapsed = useUiStore(s => s.panelCollapsed);
  const setPanelCollapsed = useUiStore(s => s.setPanelCollapsed);
  const profilePage = useUiStore(s => s.profilePage);
  const profileSection = useUiStore(s => s.profileSection);
  const setProfileSection = useUiStore(s => s.setProfileSection);
  const setProfilePage = useUiStore(s => s.setProfilePage);
  // ===== AI 助手人格状态（迁移自 useState -> Zustand elfStore）=====
  const elfAvatar = useElfStore(s => s.elfAvatar);
  const setElfAvatar = useElfStore(s => s.setElfAvatar);
  const elfAvatarHistory = useElfStore(s => s.elfAvatarHistory);
  const setElfAvatarHistory = useElfStore(s => s.setElfAvatarHistory);
  const elfName = useElfStore(s => s.elfName);
  const setElfName = useElfStore(s => s.setElfName);
  // ===== 新闻流与搜索状态（迁移自 useState -> Zustand newsStore）=====
  const category = useNewsStore(s => s.category);
  const setCategory = useNewsStore(s => s.setCategory);
  const categoryOpen = useNewsStore(s => s.categoryOpen);
  const setCategoryOpen = useNewsStore(s => s.setCategoryOpen);
  const verticalChannel = useNewsStore(s => s.verticalChannel);
  const setVerticalChannel = useNewsStore(s => s.setVerticalChannel);
  const mode = useNewsStore(s => s.mode);
  const setMode = useNewsStore(s => s.setMode);
  const sourceFilter = useNewsStore(s => s.sourceFilter);
  const setSourceFilter = useNewsStore(s => s.setSourceFilter);
  const selectedNewsDate = useNewsStore(s => s.selectedNewsDate);
  const setSelectedNewsDate = useNewsStore(s => s.setSelectedNewsDate);
  const viewMode = useNewsStore(s => s.viewMode);
  const setViewMode = useNewsStore(s => s.setViewMode);
  const query = useNewsStore(s => s.query);
  const setQuery = useNewsStore(s => s.setQuery);
  const items = useNewsStore(s => s.items);
  const setItems = useNewsStore(s => s.setItems);
  const { externalIntelligenceItems, setExternalIntelligenceItems, externalIntelligenceOpportunities, setExternalIntelligenceOpportunities, externalIntelligenceWeeklySectors, setExternalIntelligenceWeeklySectors, externalIntelligenceAlerts, setExternalIntelligenceAlerts, externalIntelligenceLoading, externalIntelligenceError, externalIntelligenceUpdatedAt, loadExternalIntelligence } = useExternalIntelligence();
  const loading = useNewsStore(s => s.loading);
  const setLoading = useNewsStore(s => s.setLoading);
  const loadingMore = useNewsStore(s => s.loadingMore);
  const setLoadingMore = useNewsStore(s => s.setLoadingMore);
  const newsPage = useNewsStore(s => s.newsPage);
  const setNewsPage = useNewsStore(s => s.setNewsPage);
  const newsHasMore = useNewsStore(s => s.newsHasMore);
  const setNewsHasMore = useNewsStore(s => s.setNewsHasMore);
  const renderLimit = useNewsStore(s => s.renderLimit);
  const setRenderLimit = useNewsStore(s => s.setRenderLimit);
  // 同步跟踪 filtered.length 给 IntersectionObserver 用（避免 observer 依赖 filtered 触发重建）
  const filteredLengthRef = useRef(0);
  // 无限加载保护：① 进入 all/recommendations 首帧 300ms 内不触发预加载（防止首帧 sentinel 初始 intersect 连环 setRenderLimit → 滚动条抖动 + 40→60→80 反复拉长
  //                ② 120ms 节流（避免 observer 重注册时密集回调重复触发）
  const navEnterAtRef = useRef(Date.now());
  const lastIntersectRunAtRef = useRef(0);
  const debouncedQuery = useNewsStore(s => s.debouncedQuery);
  const setDebouncedQuery = useNewsStore(s => s.setDebouncedQuery);
  const error = useNewsStore(s => s.error);
  const setError = useNewsStore(s => s.setError);
  const blocked = useNewsStore(s => s.blocked);
  const setBlocked = useNewsStore(s => s.setBlocked);
  // globeFullscreenOpen / elfAvatar / elfAvatarHistory / elfName 已迁移到 uiStore/elfStore
  const { agents, setAgents, updateAgent, currentAgent, setCurrentAgent, showAgentForm, setShowAgentForm, editingAgent, setEditingAgent, newAgent, setNewAgent, siliconstreamPersona, setSiliconstreamPersona } = useAgents();
  // Workflow 编辑器 UI 状态从 useUiStore 获取
  const agentFilter = useUiStore(s => s.agentFilter);
  const setAgentFilter = useUiStore(s => s.setAgentFilter);
  const agentPromptRefining = useUiStore(s => s.agentPromptRefining);
  const setAgentPromptRefining = useUiStore(s => s.setAgentPromptRefining);
  const agentWorkflowPrompt = useUiStore(s => s.agentWorkflowPrompt);
  const setAgentWorkflowPrompt = useUiStore(s => s.setAgentWorkflowPrompt);
  const agentWorkflowScope = useUiStore(s => s.agentWorkflowScope);
  const setAgentWorkflowScope = useUiStore(s => s.setAgentWorkflowScope);
  const newWorkflowNodeType = useUiStore(s => s.newWorkflowNodeType);
  const setNewWorkflowNodeType = useUiStore(s => s.setNewWorkflowNodeType);
  const draggingWorkflowNodeId = useUiStore(s => s.draggingWorkflowNodeId);
  const setDraggingWorkflowNodeId = useUiStore(s => s.setDraggingWorkflowNodeId);
  // ===== 工作流状态（迁移自 useState -> Zustand workflowStore）=====
  const agentWorkflowResult = useWorkflowStore(s => s.agentWorkflowResult);
  const setAgentWorkflowResult = useWorkflowStore(s => s.setAgentWorkflowResult);
  const agentWorkflowRun = useWorkflowStore(s => s.agentWorkflowRun);
  const setAgentWorkflowRun = useWorkflowStore(s => s.setAgentWorkflowRun);
  const agentWorkflowHistory = useWorkflowStore(s => s.agentWorkflowHistory);
  const setAgentWorkflowHistory = useWorkflowStore(s => s.setAgentWorkflowHistory);
  const agentWorkflowActions = useWorkflowStore(s => s.agentWorkflowActions);
  const setAgentWorkflowActions = useWorkflowStore(s => s.setAgentWorkflowActions);
  const agentWorkflowDraft = useWorkflowStore(s => s.agentWorkflowDraft);
  const setAgentWorkflowDraft = useWorkflowStore(s => s.setAgentWorkflowDraft);
  const workflowTemplates = useWorkflowStore(s => s.workflowTemplates);
  const setWorkflowTemplates = useWorkflowStore(s => s.setWorkflowTemplates);
  const activeWorkflowId = useWorkflowStore(s => s.activeWorkflowId);
  const setActiveWorkflowId = useWorkflowStore(s => s.setActiveWorkflowId);
  const selectedWorkflowNodeId = useWorkflowStore(s => s.selectedWorkflowNodeId);
  const setSelectedWorkflowNodeId = useWorkflowStore(s => s.setSelectedWorkflowNodeId);
  const [stats, setStats] = useState({ sourceCount: 40, failedSources: 0, updatedAt: '', blockedCount: 0 });
  const sidebarCollapsed = useUiStore(s => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore(s => s.setSidebarCollapsed);
  const motivationalQuote = useMemo(() => {
    const idx = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
    return MOTIVATIONAL_QUOTES[idx];
  }, []);
  // panelCollapsed 已迁移到 uiStore
  // 导航分组下拉展开：记录哪些主模块展开了细分项
  const expandedNavGroups = useUiStore(s => s.expandedNavGroups);
  const setExpandedNavGroups = useUiStore(s => s.setExpandedNavGroups);
  const toggleNavGroup = useUiStore(s => s.toggleNavGroup);
  // 细分模块下拉折叠状态（默认展开）
  const contextGroupOpen = useUiStore(s => s.contextGroupOpen);
  const setContextGroupOpen = useUiStore(s => s.setContextGroupOpen);
  // ===== 信息源管理状态（迁移自 useState -> Zustand sourceStore）=====
  const searchQuery = useSourceStore(s => s.searchQuery);
  const setSearchQuery = useSourceStore(s => s.setSearchQuery);
  const customSourceFilter = useSourceStore(s => s.customSourceFilter);
  const setCustomSourceFilter = useSourceStore(s => s.setCustomSourceFilter);
  const regionFilter = useSourceStore(s => s.regionFilter);
  const setRegionFilter = useSourceStore(s => s.setRegionFilter);
  const statusFilter = useSourceStore(s => s.statusFilter);
  const setStatusFilter = useSourceStore(s => s.setStatusFilter);
  
  
  // ===== 股市监控状态（迁移自 useState -> Zustand stockStore）=====
  // autoMonitorEnabled/monitorInterval/monitorAlerts 已迁移至 useSourceManager
  const showAlertPanel = useStockStore(s => s.showAlertPanel);
  const setShowAlertPanel = useStockStore(s => s.setShowAlertPanel);

  // ========== 用户系统 ==========
  // 认证与用户会话 — 从 App.jsx 提取为独立 hook（减少 ~140 行）
  // 注意：useLlmConfig 需要 user 参数做跨设备同步，必须在 useAuth 之后调用
  const [pendingChatShare, setPendingChatShare] = useState(null);
  const shareNewsToChat = (item) => {
    setPendingChatShare({ type: 'news-item', id: item.id, title: item.title, body: item.summary || '', url: item.url, source: item.source });
    setNav('chat');
  };
  const {
    user, token, showAuthModal, authMode, authForm, authLoading, authError, setAuthError,
    showInterestModal, selectedInterests, isLoggedIn,
    setUser, setToken, setShowAuthModal, setAuthMode, setAuthForm,
    setSelectedInterests, setShowInterestModal,
    handleRegister, handleLogin, handleLogout, handleGuestLogin, updateUserInterests, updateUserProfile,
  } = useAuth();

  const {
    llmConfig, setLlmConfig,
    llmModels,
    llmFetching, llmFetchError,
    llmTestResult, llmTesting,
    llmManualInput, setLlmManualInput,
    showLlmQuickConfig, setShowLlmQuickConfig,
    savePresetName, setSavePresetName,
    allLlmModels,
    llmPresets, deletePreset, applyUserPreset, activePresetId, setActivePresetId, currentPresetId,
    fetchLlmModels, addManualModel, removeManualModel, testLlmConnection,
    applyBuiltinTemplate, saveAsPreset,
  } = useLlmConfig({ LLM_PRESETS, user, onPresetAction: (_action, _payload) => { /* hook 已自动保存到 LS，此处不做任何事；保留参数位置以便未来埋点 */ } });

  // ========== 首跑引导（B2 首跑引导）==========
  // 用 localStorage 标记而非登录态：纯前端判定首次访问，dev（DEV_MEMORY_AUTH）与生产均可触发一次。
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem('meridian_onboarded') === '1'; } catch { return false; }
  });
  const finishOnboarding = () => setOnboarded(true);
  const [tourReplay, setTourReplay] = useState(false); // 重看新手引导/功能导览

  // 进场动画（水墨开卷）：控制 splash 显隐，及内容随帷幕升起的 .is-entered 标记
  const [showSplash, setShowSplash] = useState(true);
  const [entered, setEntered] = useState(false);

  // profilePage 已从 useUiStore 订阅（见上方 UI 状态区）
  // ===== AI 助手与简报状态（迁移自 useState -> Zustand aiStore）=====
  const copilotPendingMessage = useAiStore(s => s.copilotPendingMessage);
  const setCopilotPendingMessage = useAiStore(s => s.setCopilotPendingMessage);
  const showNewspaperOverlay = useUiStore(s => s.showNewspaperOverlay);
  const setShowNewspaperOverlay = useUiStore(s => s.setShowNewspaperOverlay);
  const showUserMenu = useUiStore(s => s.showUserMenu);
  const setShowUserMenu = useUiStore(s => s.setShowUserMenu);
  const showProfileModal = useUiStore(s => s.showProfileModal);
  const setShowProfileModal = useUiStore(s => s.setShowProfileModal);
  // ===== 用户画像与偏好状态（迁移自 useState -> Zustand profileStore）=====
  const profileForm = useProfileStore(s => s.profileForm);
  const setProfileForm = useProfileStore(s => s.setProfileForm);
  const domainTiers = useProfileStore(s => s.domainTiers);
  const setDomainTiers = useProfileStore(s => s.setDomainTiers);
  const sourceTiers = useProfileStore(s => s.sourceTiers);
  const setSourceTiers = useProfileStore(s => s.setSourceTiers);
  const dailyProfileSnapshots = useProfileStore(s => s.dailyProfileSnapshots);
  const setDailyProfileSnapshots = useProfileStore(s => s.setDailyProfileSnapshots);
  const specialFollows = useProfileStore(s => s.specialFollows);
  const setSpecialFollows = useProfileStore(s => s.setSpecialFollows);
  const profileCustomDomains = useProfileStore(s => s.customDomains);
  const addProfileCustomDomain = useProfileStore(s => s.addCustomDomain);
  const removeProfileCustomDomain = useProfileStore(s => s.removeCustomDomain);
  const profileCustomSources = useProfileStore(s => s.customSources);
  const addProfileCustomSource = useProfileStore(s => s.addCustomSource);
  const removeProfileCustomSource = useProfileStore(s => s.removeCustomSource);
  const briefingConfig = useProfileStore(s => s.briefingConfig);
  const setBriefingConfig = useProfileStore(s => s.setBriefingConfig);
  const specialFollowForm = useProfileStore(s => s.specialFollowForm);
  const setSpecialFollowForm = useProfileStore(s => s.setSpecialFollowForm);
  const editingSpecialFollowId = useProfileStore(s => s.editingSpecialFollowId);
  const setEditingSpecialFollowId = useProfileStore(s => s.setEditingSpecialFollowId);
  useProfileSync({
    user, domainTiers, sourceTiers, specialFollows,
    setDomainTiers, setSourceTiers, setSpecialFollows,
    dailyProfileSnapshots, briefingConfig,
    setDailyProfileSnapshots, setBriefingConfig,
  });

  // 打开资料弹窗时预填充表单
  useEffect(() => {
    if (showProfileModal && user) {
      setProfileForm({
        displayName: user.displayName || '',
        signature: user.signature || ''
      });
    }
  }, [showProfileModal, user]);

  // 画像状态持久化由 profileStore 的 persist 中间件自动处理（不再需要手写 saveLS effect）


  // 认证函数已抽取至 useAuth — 这里不再定义

  const allSources = useSourceStore(s => s.allSources);
  const setAllSources = useSourceStore(s => s.setAllSources);
  const sourceGrades = useSourceStore(s => s.sourceGrades);
  const setSourceGrades = useSourceStore(s => s.setSourceGrades);
  const serverCategories = useSourceStore(s => s.serverCategories);
  const setServerCategories = useSourceStore(s => s.setServerCategories);

  // 分类单一来源：服务端 /api/meta 下发，离线时用 fallback
  const categories = useMemo(
    () => (serverCategories.length > 0 ? serverCategories : FALLBACK_CATEGORIES),
    [serverCategories]
  );

  // 获取用户兴趣分类的详细信息
  const userInterestCategories = useMemo(() => {
    return categories.filter(c => c.id !== 'all' && selectedInterests.includes(c.id));
  }, [categories, selectedInterests]);

  const gradeFilter = useSourceStore(s => s.gradeFilter);
  const setGradeFilter = useSourceStore(s => s.setGradeFilter);
  const sourceTypeTab = useSourceStore(s => s.sourceTypeTab);
  const setSourceTypeTab = useSourceStore(s => s.setSourceTypeTab);
  const {
    trendingItems, setTrendingItems,
    trendingLoading, trendingPlatform, setTrendingPlatform,
    trendingType, setTrendingType,
    trendingPage, trendingHasMore, trendingLoadingMore,
    githubRepos, githubLoading,
    githubLang, setGithubLang,
    githubSince, setGithubSince,
    loadTrending, loadGithub,
  } = useTrending();

  useEffect(() => {
    fetch('/api/meta')
      .then(response => response.json())
      .then(data => {
        if (Array.isArray(data.sources)) setAllSources(data.sources);
        if (data.sourceGrades) setSourceGrades(data.sourceGrades);
        if (Array.isArray(data.categories)) setServerCategories(data.categories);
      })
      .catch(error => {
        console.warn('Failed to load source metadata:', error);
      });
  }, []);
  // UI switch states
  const { showFollowDropdown, setShowFollowDropdown, mobileMenuOpen, setMobileMenuOpen, showBackToTop, setShowBackToTop, moreNavOpen, setMoreNavOpen } = useUI();
  // calendar + customUrl hooks (independent domains)
  const {
    calendarDate, setCalendarDate,
    events, setEvents,
    eventForm, setEventForm,
    showEventForm, setShowEventForm,
    addEvent, removeEvent,
  } = useCalendar();
  // useCustomUrl hook moved into CustomUrlPage component
  // source management — uses allSources from /api/meta
  const {
    customSources, setCustomSources,
    disabledSources, setDisabledSources,
    newSource, setNewSource,
    sourceVerifyResult, sourceVerifying,
    sourceDiscoveryUrl, setSourceDiscoveryUrl,
    sourceDiscoveryState,
    verifyingAllSources, allSourcesVerifyResults, setAllSourcesVerifyResults,
    sourceHealth, setSourceHealth,
    editingSource, setEditingSource,
    showSourceForm, setShowSourceForm,
    verifySource, discoverSource, addDiscoveredSource, verifyAllSources,
    addCustomSource, removeCustomSource,
    truncateUrl, truncateText,
    getSourceHealthIndicator,
    verifySingleSource,
    exportSources, importSources,
    clearAlerts,
    autoMonitorEnabled, setAutoMonitorEnabled,
    monitorInterval, setMonitorInterval,
    monitorAlerts, setMonitorAlerts,
  } = useSourceManager({ allSources });  // githubLang/githubSince 已移入 useTrending
  // calendar states moved to useCalendar hook

  // articles/articlespaces moved to useArticleEditor hook
  const creativeWorkspace = useCreativeWorkspace({ syncEnabled: isLoggedIn });
  const {
    expandedSummary, setExpandedSummary,
    summaryCache, setSummaryCache,
    summaryLoading, setSummaryLoading,
    translations, setTranslations,
    translationOpen, setTranslationOpen,
    translatingItems, setTranslatingItems,
    getSummaryEntry, handleSummaryToggle, requestTranslation, getTranslation, toggleGithubTranslation,
  } = useTranslationSummary(llmConfig);
  // ===== 推荐反馈与追踪状态（5 路行为信号已迁移至 useBehaviorStore，其余保留 useRecommendStore）=====
  const followKeywords = useBehaviorStore(s => s.followKeywords);
  const setFollowKeywords = useBehaviorStore(s => s.setFollowKeywords);
  const pinnedKeywords = useRecommendStore(s => s.pinnedKeywords);
  const setPinnedKeywords = useRecommendStore(s => s.setPinnedKeywords);
  const recommendationFeedback = useBehaviorStore(s => s.recommendationFeedback);
  const setRecommendationFeedback = useBehaviorStore(s => s.setRecommendationFeedback);
  const recommendationFeedbackEvents = useBehaviorStore(s => s.recommendationFeedbackEvents);
  const setRecommendationFeedbackEvents = useBehaviorStore(s => s.setRecommendationFeedbackEvents);
  const snapshotStoreRef = useRef(null);
  if (!snapshotStoreRef.current) snapshotStoreRef.current = createSnapshotStore(localStorage);
  const recommendationSnapshots = useRecommendStore(s => s.recommendationSnapshots);
  const setRecommendationSnapshots = useRecommendStore(s => s.setRecommendationSnapshots);
  const [newKeyword, setNewKeyword] = useState('');
  const searchHistory = useRecommendStore(s => s.searchHistory);
  const setSearchHistory = useRecommendStore(s => s.setSearchHistory);
  const searchOpen = useRecommendStore(s => s.searchOpen);
  const setSearchOpen = useRecommendStore(s => s.setSearchOpen);
  const searchSort = useRecommendStore(s => s.searchSort);
  const setSearchSort = useRecommendStore(s => s.setSearchSort);
  const focusedIndex = useRecommendStore(s => s.focusedIndex);
  const setFocusedIndex = useRecommendStore(s => s.setFocusedIndex);
  const showShortcuts = useUiStore(s => s.showShortcuts);
  const setShowShortcuts = useUiStore(s => s.setShowShortcuts);
  const showCommandPalette = useUiStore(s => s.showCommandPalette);
  const setShowCommandPalette = useUiStore(s => s.setShowCommandPalette);
  // Lightbox 状态从 useLightboxStore 获取（跨页面共享的图片预览）
  const lightbox = useLightboxStore(s => s.lightbox);
  const setLightbox = useLightboxStore(s => s.setLightbox);
  const expandedEvents = useRecommendStore(s => s.expandedEvents);
  const setExpandedEvents = useRecommendStore(s => s.setExpandedEvents);
  const exportCategory = useRecommendStore(s => s.exportCategory);
  const setExportCategory = useRecommendStore(s => s.setExportCategory);
  const exportRange = useRecommendStore(s => s.exportRange);
  const setExportRange = useRecommendStore(s => s.setExportRange);

  // customUrl states moved to useCustomUrl hook
  // UI switch states (showFollowDropdown/mobileMenuOpen/showBackToTop) moved to useUI
  const readingHistory = useBehaviorStore(s => s.readingHistory);
  const setReadingHistory = useBehaviorStore(s => s.setReadingHistory);
  // recommendationFeedbackEvents 持久化由 useBehaviorStore 的 persist 中间件自动处理
  // ===== AI Insights / Elf 引用上下文（迁移自 useState -> Zustand aiStore）=====
  const aiInsights = useAiStore(s => s.aiInsights);
  const setAiInsights = useAiStore(s => s.setAiInsights);
  const elfQuotedContext = useAiStore(s => s.elfQuotedContext);
  const setElfQuotedContext = useAiStore(s => s.setElfQuotedContext);
  // moreNavOpen moved to useUI
  // ===== 素材库 UI 状态（迁移自 useState -> Zustand materialsStore）=====
  const materialFilter = useMaterialsStore(s => s.materialFilter);
  const setMaterialFilter = useMaterialsStore(s => s.setMaterialFilter);
  const materialSearch = useMaterialsStore(s => s.materialSearch);
  const setMaterialSearch = useMaterialsStore(s => s.setMaterialSearch);
  const materialTags = useMaterialsStore(s => s.materialTags);
  const setMaterialTags = useMaterialsStore(s => s.setMaterialTags);
  const materialTimeRange = useMaterialsStore(s => s.materialTimeRange);
  const setMaterialTimeRange = useMaterialsStore(s => s.setMaterialTimeRange);
  const materialSourceFilter = useMaterialsStore(s => s.materialSourceFilter);
  const setMaterialSourceFilter = useMaterialsStore(s => s.setMaterialSourceFilter);
  const materialSpaceFilter = useMaterialsStore(s => s.materialSpaceFilter);
  const setMaterialSpaceFilter = useMaterialsStore(s => s.setMaterialSpaceFilter);
  const showSpaceForm = useMaterialsStore(s => s.showSpaceForm);
  const setShowSpaceForm = useMaterialsStore(s => s.setShowSpaceForm);
  const showAddMaterial = useMaterialsStore(s => s.showAddMaterial);
  const setShowAddMaterial = useMaterialsStore(s => s.setShowAddMaterial);
  // ===== 素材仓库（智创中心）视图状态 =====
  const materialSection = useMaterialsStore(s => s.materialSection);
  const setMaterialSection = useMaterialsStore(s => s.setMaterialSection);
  const materialSort = useMaterialsStore(s => s.materialSort);
  const setMaterialSort = useMaterialsStore(s => s.setMaterialSort);
  const materialView = useMaterialsStore(s => s.materialView);
  const setMaterialView = useMaterialsStore(s => s.setMaterialView);
  const materialDetailId = useMaterialsStore(s => s.materialDetailId);
  const setMaterialDetailId = useMaterialsStore(s => s.setMaterialDetailId);
  const signalFilter = useStockStore(s => s.signalFilter);
  const setSignalFilter = useStockStore(s => s.setSignalFilter);
  // article editor state moved to useArticleEditor hook

  // 滚动资讯热点状态：从实时 items 派生热门资讯，保证数据准确实时
  const scrollingNewsPaused = useUiStore(s => s.scrollingNewsPaused);
  const setScrollingNewsPaused = useUiStore(s => s.setScrollingNewsPaused);
  const scrollingNewsRef = useRef(null);
  const { scrollingNews, sourceStats, availableNewsDates, sourceOptions } = useNewsFilter(items, category, mode);

  const editorTextareaRef = useRef(null);

  // ===== 工作站 → 用户广场：文章一键发布（微博式社区生态打通） =====
  const [publishingToSquare, setPublishingToSquare] = useState(false);
  const publishArticleToSquare = useCallback(async (article) => {
    if (!user) { setAuthMode('login'); setShowAuthModal(true); return; }
    if (!String(article?.content || '').trim()) { showToast('文章内容为空，无法发布'); return; }
    setPublishingToSquare(true);
    try {
      const response = await fetch('/api/community/posts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'article',
          title: article.title || '无题',
          body: article.content,
          visibility: 'public',
          status: 'published',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload?.error?.message || '发布失败');
      showToast('已发布到用户广场');
      setNav('square');
    } catch (error) {
      showToast(error.message || '发布失败');
    } finally {
      setPublishingToSquare(false);
    }
  }, [user, setAuthMode, setShowAuthModal, setNav]);
  const imageInputRef = useRef(null);
  const workflowImportInputRef = useRef(null);

  // bookmarks / materials state must precede useArticleEditor (which consumes materials)
  const {
    bookmarks, setBookmarks,
    materials, setMaterials,
    selectedMaterials, setSelectedMaterials,
    materialSpaces, setMaterialSpaces,
    newSpaceName, setNewSpaceName,
    toggleBookmark, isBookmarked, isInMaterials, toggleRead,
    detectMaterialType, toggleMaterial, addManualMaterial,
    continueMaterialInWorkbench, removeMaterial, batchRemoveMaterials,
    updateMaterialTags, toggleMaterialSelection,
    clearMaterialSelection, updateMaterialNote, assignMaterialsToSpace,
    createMaterialSpace, deleteMaterialSpace, renameMaterialSpace,
    recentlyDeleted, restoreMaterial, purgeMaterial, emptyTrash,
    toggleMaterialStar,
    exportMaterials, importMaterials,
  } = useBookmarkMaterial({
    creativeWorkspace,
    setNav,
    setCopilotPendingMessage,
    setShowAddMaterial,
    setShowSpaceForm,
    materialSpaceFilter,
    setMaterialSpaceFilter,
  });

  const {
    articles, setArticles,
    articleSpaces, setArticleSpaces,
    currentArticleId, setCurrentArticleId,
    editorTab, setEditorTab,
    editorCursorPos, setEditorCursorPos,
    showTemplateMenu, setShowTemplateMenu,
    showAiPanel, setShowAiPanel,
    showImagePanel, setShowImagePanel,
    aiResult, setAiResult,
    aiCustomPrompt, setAiCustomPrompt,
    autoSaveTimer, setAutoSaveTimer,
    lastSavedAt, setLastSavedAt,
    articleTagInput, setArticleTagInput,
    editingArticleTag, setEditingArticleTag,
    articleSpaceFilter, setArticleSpaceFilter,
    articleMaterialSpaceFilter, setArticleMaterialSpaceFilter,
    articleSpaceFormOpen, setArticleSpaceFormOpen,
    newArticleSpaceName, setNewArticleSpaceName,
    articleSpaceForNewArticle, setArticleSpaceForNewArticle,
    articleSearch, setArticleSearch,
    articleStatusFilter, setArticleStatusFilter,
    articleTemplateFilter, setArticleTemplateFilter,
    articleSort, setArticleSort,
    articleExportFilter, setArticleExportFilter,
    createArticle, updateArticle, deleteArticle, duplicateArticle,
    addArticleTag, removeArticleTag,
    triggerAutoSave,
    handleContentChange, handleTitleChange,
    insertAtCursor, insertMaterialAtCursor,
    removeLinkedMaterial,
    handleImageUpload, handlePaste,
    createArticleSpace, deleteArticleSpace,
    assignArticleToSpace, batchAssignArticlesToSpace,
    insertAiResult, clearAiResult, aiAction,
    exportArticleToFile, copyArticleAsRichText, exportArticle,
    articleCitations, saveArticleVersion,
  } = useArticleEditor({ llmConfig, materials, editorTextareaRef });

  const feedRef = useRef(null);
  const searchInputRef = useRef(null);

  // 跟随系统：把 'system' 解析为系统 prefers-color-scheme 的 dark/light
  const resolveThemeMode = (m) => {
    if (m !== 'system') return m;
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };
  useEffect(() => {
    document.documentElement.dataset.mode = resolveThemeMode(themeMode);
    localStorage.setItem('themeMode', themeMode);
  }, [themeMode]);
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    localStorage.setItem('palette', palette);
  }, [palette]);
  // 系统主题偏好变化时实时跟随
  useEffect(() => {
    if (themeMode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => { document.documentElement.dataset.mode = mq.matches ? 'light' : 'dark'; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themeMode]);
  useEffect(() => { localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem('panelCollapsed', String(panelCollapsed)); }, [panelCollapsed]);
  // ESC 退出创作中心全屏
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setEditorFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ===== 全局键盘效率（B2.1）：Ctrl/K 命令面板 + g 系页面导航 + ? 快捷键面板 + Esc 关闭 =====
  // 上提自 NewsPage，使命令面板/快捷键在所有页面（含首页）均可达；g 和弦用 ref 实现两键序列。
  const gotoArmedRef = useRef(false);
  const gotoTimerRef = useRef(null);
  // 用 ref 持有最新 API，避免每次渲染都重注册 window 监听
  // 注意：goNav 在下方定义，此处先建空 ref，渲染末（goNav 定义后）再填充，规避 TDZ
  const kbApiRef = useRef(null);
  useEffect(() => {
    const isTyping = (el) =>
      el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' || el.isContentEditable);
    // g 后接的页面键 → nav id（覆盖 9 个主导航，字符取自页面含义）
    const GOTO_MAP = {
      h: 'home', d: 'recommendations', a: 'all',
      g: 'github', s: 'stock', u: 'studio', w: 'canvas',
      c: 'square', p: 'profile-center', m: 'monitor',
    };
    function onKey(e) {
      const api = kbApiRef.current;
      // Ctrl/Cmd+K 全局唤出命令面板（任意上下文，含首页）
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        api.setShowCommandPalette(v => !v);
        return;
      }
      if (isTyping(e.target)) return;
      // g 和弦第二键：消费事件并 stopImmediatePropagation，避免与 feed 页 j/k/o/s 冲突
      if (gotoArmedRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const target = GOTO_MAP[e.key.toLowerCase()];
        if (target) api.goNav(target);
        gotoArmedRef.current = false;
        clearTimeout(gotoTimerRef.current);
        return;
      }
      if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        gotoArmedRef.current = true;
        clearTimeout(gotoTimerRef.current);
        gotoTimerRef.current = setTimeout(() => { gotoArmedRef.current = false; }, 1200);
        return;
      }
      if (e.key === '?') { e.preventDefault(); api.setShowShortcuts(s => !s); return; }
      if (e.key === 'Escape') {
        if (api.showShortcuts) { api.setShowShortcuts(false); return; }
        if (api.showCommandPalette) { api.setShowCommandPalette(false); return; }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gotoTimerRef.current); };
  }, []);
  useEffect(() => {
    if (!showTemplateMenu) return;
    const handler = (e) => { if (!e.target.closest('.editor-template-dropdown')) setShowTemplateMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplateMenu]);

  const recentVisits = useUiStore(s => s.recentVisits);
  const setRecentVisits = useUiStore(s => s.setRecentVisits);

  // 30+ 个 saveLS 合并为一个统一同步 effect — 任何 state 变化只触发一次写入
  // 注：nav/sidebarCollapsed/themeMode/expandedNavGroups/contextGroupOpen/recentVisits
  // 等已迁移到 useUiStore；followKeywords/pinnedKeywords/recommendationFeedback/
  // searchHistory/viewMode/briefingConfig/readingHistory/recommendationFeedbackEvents
  // 已迁移到对应 Zustand store，由 store 自行持久化，不再需要在这里同步
  useEffect(() => {
    const map = {
      customSources, sourceHealth, disabledSources, calendarEvents: events,
      bookmarks, materials, materialSpaces, articleSpaces, articles,
      summaryCache, translations, llmConfig,
    };
    for (const [key, val] of Object.entries(map)) saveLS(key, val);
    // localStorage 直写的字段
    localStorage.setItem('elfAvatar', elfAvatar || '');
    if (!elfAvatar) localStorage.removeItem('elfAvatar');
    localStorage.setItem('elfAvatarHistory', JSON.stringify(elfAvatarHistory));
    localStorage.setItem('elfName', elfName);
  }, [
    customSources, sourceHealth, disabledSources, events, bookmarks, materials,
    materialSpaces, articleSpaces, articles, summaryCache, translations, llmConfig,
    elfAvatar, elfAvatarHistory, elfName,
  ]);
  // 工作流状态持久化由 workflowStore 的 persist 中间件自动处理（不再需要手写 saveLS effect）

  const fetchAiInsights = async () => {
    if (!llmConfig.baseUrl || !llmConfig.selectedModel || items.length === 0) {
      return;
    }
    setAiInsights(p => ({ ...p, loading: true, error: '' }));
    try {
      const topItems = items.slice(0, 30).map(i => ({
        id: i.id,  // P2: 传入 id 以便回写 AI 评分
        title: i.title,
        category: i.category,
        source: i.source,
        summary: i.summary || '',
        tags: (i.tags || []).join(', ')
      }));
      const res = await fetch('/api/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.selectedModel,
          items: topItems
        })
      });
      const data = await res.json();
      if (data.error) {
        const msg = data.raw ? `AI 返回格式错误：${data.error}。原始输出：${data.raw.slice(0, 200)}` : data.error;
        throw new Error(msg);
      }
      setAiInsights({ loading: false, data, error: '' });

      // P2: 异步回写 AI 评分到 items，触发前端重排（不阻塞首屏，失败时静默降级）
      // 只有当返回包含 itemScores 字段时才回写，避免破坏无 AI 配置的降级路径
      if (Array.isArray(data.itemScores) && data.itemScores.length > 0) {
        const scoreMap = new Map();
        data.itemScores.forEach(s => {
          if (s && s.id != null) {
            scoreMap.set(String(s.id), {
              aiRelevanceScore: typeof s.score === 'number' ? s.score : 0,
              aiLabel: s.label || '',
              aiReason: s.reason || ''
            });
          }
        });
        if (scoreMap.size > 0) {
          setItems(prev => prev.map(item => {
            const ai = scoreMap.get(String(item.id));
            return ai ? { ...item, aiRelevanceScore: ai.aiRelevanceScore, aiLabel: ai.aiLabel, aiReason: ai.aiReason } : item;
          }));
        }
      }
    } catch (e) {
      setAiInsights({ loading: false, data: null, error: e.message });
    }
  };

  useEffect(() => {
    if (!llmConfig.baseUrl || !llmConfig.selectedModel) return;
    const timer = setTimeout(fetchAiInsights, 1000);
    return () => clearTimeout(timer);
  }, [items, llmConfig.baseUrl, llmConfig.apiKey, llmConfig.selectedModel]);

  // 滚动资讯自动滚动效果：rAF 连续平移 scrollLeft，无缝循环
  useEffect(() => {
    const el = scrollingNewsRef.current;
    if (!el || scrollingNewsPaused || scrollingNews.length === 0) return;
    let raf;
    const step = () => {
      // 滚到第一份末尾（总宽度一半）时跳回开头，实现无缝循环
      const half = el.scrollWidth / 2;
      if (el.scrollLeft >= half) el.scrollLeft -= half;
      el.scrollLeft += 0.4; // 滚动速度 px/帧
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scrollingNewsPaused, scrollingNews.length]);

  // 滚动资讯手动拖拽：按下并拖动直接控制 scrollLeft
  const scrollingNewsDragRef = useRef({ dragging: false, startX: 0, startScroll: 0, moved: false });
  const handleScrollingNewsMouseMove = useCallback((e) => {
    const ref = scrollingNewsDragRef.current;
    if (!ref.dragging) return;
    const el = scrollingNewsRef.current;
    if (!el) return;
    const dx = e.clientX - ref.startX;
    if (Math.abs(dx) > 3) ref.moved = true;
    el.scrollLeft = ref.startScroll - dx;
  }, []);
  const handleScrollingNewsMouseUp = useCallback(() => {
    const ref = scrollingNewsDragRef.current;
    ref.dragging = false;
    window.removeEventListener('mousemove', handleScrollingNewsMouseMove);
    window.removeEventListener('mouseup', handleScrollingNewsMouseUp);
    // 拖拽结束后短暂保持暂停状态，给用户一个自然的间隙
    if (ref.moved) {
      setScrollingNewsPaused(true);
      setTimeout(() => setScrollingNewsPaused(false), 1200);
    }
  }, [handleScrollingNewsMouseMove]);
  const handleScrollingNewsMouseDown = useCallback((e) => {
    const el = scrollingNewsRef.current;
    if (!el) return;
    e.preventDefault(); // 防止文字选中
    scrollingNewsDragRef.current = {
      dragging: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
    window.addEventListener('mousemove', handleScrollingNewsMouseMove);
    window.addEventListener('mouseup', handleScrollingNewsMouseUp);
  }, [handleScrollingNewsMouseMove, handleScrollingNewsMouseUp]);

  useEffect(() => {
    if (!lightbox.open) return;
    const handler = (e) => { if (e.key === 'Escape') setLightbox({ open: false, src: '', title: '', images: [], index: 0 }); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox.open]);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const handleScroll = () => setShowBackToTop(el.scrollTop > 300);
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // 导航从非 feed 页切回 feed 页：① 记录进入时间戳；② 重置焦点索引复位（防止历史会话脏状态残留时的非持久化，但再次切回不会触发）
  useEffect(() => {
    if (nav === 'all' || nav === 'recommendations') {
      navEnterAtRef.current = Date.now();
    }
    // 仅在进入 feed 导航（非 persistent）时清零焦点，避免回到顶栏高度改变引发 scrollIntoView 带动滚动条
    if (focusedIndex !== -1) setFocusedIndex(-1);
  }, [nav, focusedIndex, setFocusedIndex]);

  useEffect(() => {
    if (nav !== 'all' && nav !== 'recommendations') return;
    const el = feedRef.current;
    if (!el || loading) return;
    // 每次挂载立刻更新 enter 时间（observe 前先更新，避免 observer 首次回调立即触发 sentinel intersect
    navEnterAtRef.current = Date.now();
    lastIntersectRunAtRef.current = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        const now = Date.now();
        // 节流：首帧 300ms 内（还没开始手动/滚动过，不做预加载（observer 注册的首次回调会立刻触发，避免 feed.scrollHeight 的拉伸
        if (now - navEnterAtRef.current < 300 && (el.scrollTop ?? 0) < 8) return;
        if (now - lastIntersectRunAtRef.current < 120) return;
        lastIntersectRunAtRef.current = now;
        setRenderLimit(r => (filteredLengthRef.current > r ? r + 20 : r));
        if (newsHasMore && !loadingMore) {
          loadMoreNews();
        }
      },
      { root: el, rootMargin: '800px 0px', threshold: 0 }
    );
    const sentinel = document.getElementById('load-more-sentinel');
    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
  // renderLimit 绝不能放进 deps：setRenderLimit 已用函数式读取最新 r，放了 deps 会 observer 每 +20 重建再触发初始 intersect → 连环触发 → 滚动条拉长循环
  }, [nav, newsHasMore, loadingMore, loading]);

  const scrollToTop = () => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Dynamic page title and description based on current navigation
  useEffect(() => {
    let title = `${PRODUCT_NAME} - ${PRODUCT_TAGLINE}`;
    let description = PRODUCT_DESCRIPTION;
    
    if (nav === 'home') {
      title = `${PRODUCT_NAME} - AI 工作站`;
      description = '基于公共热点、用户画像和可验证来源生成每日情报总判断。';
    } else if (nav === 'trending') {
      title = `${PRODUCT_NAME} - ${TRENDING_TYPES.find(t => t.id === trendingType)?.label || '热门榜单'}`;
      description = '隐藏工具中的热点榜单，用于补充观察公共热度。';
    } else if (nav === 'github') {
      title = `${PRODUCT_NAME} - GitHub 热门项目`;
      description = '收集 GitHub 日榜、周榜、月榜明星项目，结合图片和应用场景帮助判断项目价值。';
    } else if (nav === 'studio') {
      title = `${PRODUCT_NAME} - 素材管理`;
      description = '素材、知识图谱与本地空间资产统一管理，构建可复用的个人知识资产。';
    } else if (nav === 'canvas') {
      title = `${PRODUCT_NAME} - 无限画布`;
      description = '节点连线搭建工作流：拖拽节点、编排顺序，一键交付 AI 工作站执行。';
    } else if (nav === 'materials') {
      title = `${PRODUCT_NAME} - 素材库`;
      description = '收集资讯卡片、每日汇报、本地上传和智能体输出，形成可复用知识资产。';
    } else if (nav === 'editor') {
      title = `${PRODUCT_NAME} - 内容创作`;
      description = '联动素材库和智能体工作流，创作文章、报告并导出本地知识库资产。';
    } else if (nav === 'square') {
      title = `${PRODUCT_NAME} - 用户广场`;
      description = '分享文章、智能体和每日汇报，提供点赞、收藏、关注和评论等交流能力。';
    } else if (nav === 'profile-center') {
      title = `${PRODUCT_NAME} - 用户画像`;
      description = '管理关注领域、阅读记录、收藏资讯、领域优先级和信号源优先级。';
    } else if (nav === 'recommendations') {
      title = `${PRODUCT_NAME} - 精准推荐`;
      description = '使用不可变日快照按日历和时间线回看精准推荐及其评分依据。';
    } else if (nav === 'all') {
      if (verticalChannel !== 'all') {
        const channel = VERTICAL_CHANNELS.find(ch => ch.id === verticalChannel);
        if (channel) {
          title = `${PRODUCT_NAME} - ${channel.label}`;
          description = `${channel.description} - 多领域高质量资讯平台。`;
        }
      }
    }
    
    document.title = title;
    
    // Update meta description
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', description);
    }
  }, [nav, trendingType, verticalChannel]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 搜索策略（类百度）：
  // - 输入框 onChange -> setQuery -> 本地 filtered 即时全文匹配（无延迟、无 API 调用）
  // - 按 Enter 或点击建议 -> executeSearch -> 调 API 获取更多搜索结果
  // - debouncedQuery 仅用于 60s 自动刷新轮询的条件判断，不再触发 loadNews
  useEffect(() => {
    if (nav !== 'all') return;
    // 仅在用户明确提交搜索（按 Enter / 点击建议）时才请求 API
    // 不再每次按键都触发 API 请求
  }, [debouncedQuery]);

  // 切换赛道时自动清空来源筛选：不同赛道下的来源不同，残留的 sourceFilter 会导致结果为空
  // 仅在 category 实际变化时触发（用 ref 记录上一次值），items 刷新不触发，避免误清用户选择
  const prevCategoryRef = useRef(category);
  useEffect(() => {
    if (prevCategoryRef.current !== category) {
      prevCategoryRef.current = category;
      if (sourceFilter !== 'all') setSourceFilter('all');
    }
  }, [category, sourceFilter, setSourceFilter]);

  // regionFilter 不自动清空：国内/国外是用户主动选择，切换赛道后保留选择
  // 若用户选择后无结果，由空状态提示引导，而非静默重置（之前依赖 regionFilter 自身导致切换不了）
  // 修复 v26.8：selectedInterests 变化也必须重拉——否则推荐页新增/移除兴趣领域后
  // items 仍是旧 interests 过滤的结果，新领域内容永远不会进入推荐候选池
  useEffect(() => {
    if (nav === 'recommendations') loadNews(blocked, false, debouncedQuery);
  }, [nav, selectedInterests, isLoggedIn]);
  // 后台预加载：进入首页即拉取热门/GitHub/资讯，避免切 tab 时白屏等待
  const backgroundLoadedRef = useRef(false);
  useEffect(() => {
    if (backgroundLoadedRef.current) return;
    backgroundLoadedRef.current = true;
    if (trendingItems.length === 0) loadTrending();
    if (githubRepos.length === 0) loadGithub();
    if (items.length === 0) loadNews(blocked, false, debouncedQuery);
    // 后台预取股票/3D 地球/AI 工作站等 lazy chunk，切到对应 tab 时无需再等下载
    import('./components/StockPage.jsx').catch(() => {});
    // 预取股票 dashboard 数据填充服务端缓存，切到 stock tab 时秒出
    fetch('/api/stock/dashboard').catch(() => {});
  }, []);

  // P5-r2（v26）：自动刷新降级 —— 不再自动替换列表（旧版每 60s loadNews 会把
  // 用户正在阅读的消息顶走）。改为每 5 分钟静默探测一次：只对比 ID、绝不触碰
  // items；发现新增时仅在刷新按钮上累加角标，由用户手动点击刷新获取。
  useEffect(() => {
    if (nav !== 'all') return;
    let cancelled = false;
    const checkNew = () => {
      if (cancelled || debouncedQuery || loading || loadingMore) return;
      const customParams = customSources.map(s => `custom=${encodeURIComponent(JSON.stringify(s))}`).join('&');
      const disabledParam = disabledSources.length > 0 ? `&disabledSources=${encodeURIComponent(disabledSources.join(','))}` : '';
      // 与 loadNews 同参但不带 forceRefresh：命中后端 SWR 缓存，开销极低
      const url = `/api/news?blocked=${encodeURIComponent(blocked)}&page=0&pageSize=200${disabledParam}${customParams ? '&' + customParams : ''}`;
      fetch(url)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          const known = new Set(useNewsStore.getState().items.map(i => i.id));
          const fresh = (d.items || []).filter(i => i?.id && !known.has(i.id)).length;
          if (fresh > 0) setNewSinceLastVisit(prev => Math.min(99, prev + fresh));
        })
        .catch(() => { /* 探测失败静默，不打扰用户 */ });
    };
    const timer = setInterval(checkNew, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [nav, blocked, debouncedQuery, loading, loadingMore, customSources, disabledSources]);

  // 趋势分析数据（纯计算已抽到 domain/intelligence/trendAnalytics.js，可就地单测）
  const trendData = useMemo(() => computeNewsTrends(items), [items]);

  const filtered = useMemo(() => {
    // 本地文本搜索：当有搜索词时，在前端做标题/摘要/标签全文匹配
    const q = (query || '').toLowerCase().trim();
    let result = items.filter(item => {
      const cat = category === 'all' || item.category === category;
      const md = mode === 'all' || item.mode === mode;
      const src = sourceFilter === 'all' || item.source === sourceFilter;
      let reg = regionFilter === 'all';
      if (!reg) {
        if (regionFilter === 'domestic') {
          reg = item.region === 'domestic';
        } else if (regionFilter === 'overseas') {
          reg = item.region === 'overseas' || item.region === 'global';
        }
      }
      // 本地搜索匹配：标题 + 摘要 + 来源名 + 标签
      let searchMatch = true;
      if (q) {
        const haystack = (
          (item.title || '') + ' ' +
          (item.summary || '') + ' ' +
          (item.source || '') + ' ' +
          (Array.isArray(item.tags) ? item.tags.join(' ') : '')
        ).toLowerCase();
        searchMatch = haystack.includes(q);
      }
      return cat && md && src && reg && searchMatch;
    });

    if (items.length > 0) {
      const sampleRegions = items.slice(0, 5).map(i => ({ title: i.title?.substring(0, 30), region: i.region }));
    }

    // 全部动态 = 纯资讯热度排序（不叠加用户画像偏好，避免与「精准推荐」功能重复）
    // 排序策略：按资讯热度降序（qualityScore + mustReadScore + AI 评分加权），同热度时按发布时间倒序
    result.sort((a, b) => {
      // 1. 热度分（后端 qualityScore + mustReadScore + AI 评分加权 0.3）
      const aAi = (a.aiRelevanceScore || 0) * 0.3;
      const bAi = (b.aiRelevanceScore || 0) * 0.3;
      const aQ = (a.qualityScore || 0) + (a.mustReadScore || 0) + aAi;
      const bQ = (b.qualityScore || 0) + (b.mustReadScore || 0) + bAi;
      if (bQ !== aQ) return bQ - aQ;
      // 2. 同热度时按发布时间倒序（最新优先）
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

    return result;
  }, [items, category, mode, sourceFilter, regionFilter, query]);

  // 同步 filtered.length 到 ref（供 IntersectionObserver 闭包读取最新值）
  useEffect(() => { filteredLengthRef.current = filtered.length; }, [filtered.length]);

  // 「新资讯」感知：自上次访问以来新增的资讯条数
  // 用 localStorage 存上次访问时最新 item 的 publishedAt，本次进入时计算增量
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0);
  useEffect(() => {
    if (items.length === 0) return;
    const latestPublishedAt = items.reduce((max, item) => {
      const t = new Date(item.publishedAt).getTime();
      return t > max ? t : max;
    }, 0);
    try {
      const lastVisitStr = localStorage.getItem('lastVisitLatestNewsAt');
      const lastVisit = lastVisitStr ? parseInt(lastVisitStr, 10) : 0;
      if (lastVisit > 0 && latestPublishedAt > lastVisit) {
        const count = items.filter(item => new Date(item.publishedAt).getTime() > lastVisit).length;
        setNewSinceLastVisit(count);
      }
      // 更新上次访问时间为本次最新
      localStorage.setItem('lastVisitLatestNewsAt', String(latestPublishedAt));
    } catch { /* localStorage 异常时忽略 */ }
  }, [items]);

  // 「全部动态」当前活动筛选 —— 用于 chip 条展示与一键清除
  const allActiveFilters = useMemo(() => {
    const chips = [];
    if (query.trim()) chips.push({ key: 'query', label: `搜索: ${query.trim()}`, clear: () => setQuery('') });
    if (category !== 'all') {
      const cat = categories.find(c => c.id === category);
      chips.push({ key: 'category', label: cat?.label || category, clear: () => setCategory('all') });
    }
    if (mode !== 'all') {
      const m = MODES.find(x => x.id === mode);
      chips.push({ key: 'mode', label: m?.label || mode, clear: () => setMode('all') });
    }
    if (regionFilter !== 'all') {
      chips.push({ key: 'region', label: regionFilter === 'domestic' ? '国内' : '国外', clear: () => setRegionFilter('all') });
    }
    if (sourceFilter !== 'all') chips.push({ key: 'source', label: sourceFilter, clear: () => setSourceFilter('all') });
    return chips;
  }, [query, category, mode, regionFilter, sourceFilter, categories]);

  const clearAllFilters = () => {
    setQuery('');
    setCategory('all');
    setMode('all');
    setRegionFilter('all');
    setSourceFilter('all');
  };

  const addRecentVisit = useCallback((type, value, label) => {
    setRecentVisits(prev => {
      const filtered = prev.filter(v => !(v.type === type && v.value === value));
      const newVisit = { type, value, label, timestamp: Date.now() };
      return [newVisit, ...filtered].slice(0, 3);
    });
  }, []);

  const hotTags = useMemo(() => {
    const allMap = new Map();
    const last24hMap = new Map();
    const now = Date.now();
    filtered.forEach(item => {
      (item.tags || []).forEach(tag => {
        allMap.set(tag, (allMap.get(tag) || 0) + 1);
        if (now - new Date(item.publishedAt).getTime() <= 24 * 60 * 60 * 1000) {
          last24hMap.set(tag, (last24hMap.get(tag) || 0) + 1);
        }
      });
    });
    return [...allMap.entries()]
      .map(([tag, count]) => ({ tag, count, trend: last24hMap.get(tag) || 0, score: count + (last24hMap.get(tag) || 0) * 2 }))
      .slice(0, 8);
  }, [filtered]);

  useEffect(() => {
    if (!items.length || !availableNewsDates.length) return;
    if (!availableNewsDates.includes(selectedNewsDate)) {
      // 历史日期可能无实时资讯但有快照，用户主动选择时不覆盖
      const hasSnapshot = snapshotStoreRef.current.get(selectedNewsDate);
      if (!hasSnapshot) setSelectedNewsDate(availableNewsDates[0]);
    }
  }, [items.length, availableNewsDates, selectedNewsDate]);

  const selectedDateItems = useMemo(() => {
    // 每日汇报严格聚焦当天日期，不允许降级到全部数据
    const sameDay = filtered.filter(item => {
      const d = item.publishedAt?.slice(0, 10);
      return d === selectedNewsDate;
    });
    return sameDay;
  }, [filtered, selectedNewsDate]);

  const regionCategoryMatrix = useMemo(() => {
    const regions = ['domestic', 'overseas', 'global'];
    const matrix = {};
    let maxVal = 0;
    regions.forEach(r => {
      matrix[r] = {};
      categories.forEach(c => {
        const count = items.filter(i => i.region === r && i.category === c.id).length;
        matrix[r][c.id] = count;
        if (count > maxVal) maxVal = count;
      });
    });
    return { matrix, maxVal, regions };
  }, [items]);

  const { dailyBriefing, insightData, readingProfile } = useIntelligenceMemos({
    items,
    followKeywords,
    briefingConfig,
    categories,
    trendData,
    bookmarks,
  });

  const {
    followKeywordUpdates,
    todayMustRead,
    recommendationCandidates,
    recommendationLanes,
    algorithmBriefing,
    eventClusters: rawEventClusters,
  } = useRecommendationMemos({
    items,
    followKeywords,
    readingHistory,
    bookmarks,
    selectedInterests,
    domainTiers,
    sourceTiers,
    specialFollows,
    selectedNewsDate,
    recommendationFeedback,
    recommendationFeedbackEvents,
  });

  // 复刻 Meridian G1/G2/G3：语义聚类 + 多智能体分析 + 跨日演化（接入每日简报，最小侵入）
  const intelligenceBriefing = useIntelligenceBriefing({ items, date: selectedNewsDate, llmConfig });

  // Phase 3 Task B17: 删除内联 clusterEvents(filtered)，改用 useRecommendationMemos 暴露的 rawEventClusters
  // rawEventClusters = clusterEvents(items)（基于全量 items 聚类，与 todayMustRead 内部一致）
  // 这里仅做展示过滤：nav !== 'all' → 空；>=2 条目；primary item 必须在 filtered 内（避免展示被筛选掉的聚类）
  const filteredIds = useMemo(() => new Set(filtered.map(i => i.id)), [filtered]);
  const eventClusters = useMemo(() => {
    if (nav !== 'all') return [];
    return rawEventClusters
      .filter(cluster => cluster.items.length >= 2 && filteredIds.has(cluster.primaryItem?.id))
      .map(cluster => ({ ...cluster, keyword: cluster.primaryItem.title }));
  }, [rawEventClusters, filteredIds, nav]);

  // 全部动态 = 多领域大杂烩（buildDiscoverFeed）：多源发酵 + 互动信号(点赞/评论/浏览量)
  // + 今日热词 + 新鲜度综合排序，跨领域打散，与用户画像完全解耦（与「精准推荐」刻意区分）。
  // 实时更新递进：newsStore 轮询刷新后 items 流式进入，feed 纯派生即随之更新；
  // 决胜键含 id，刷新时既有条目次序稳定不抖动。
  const discoverFeed = useMemo(() => (
    nav === 'all'
      ? buildDiscoverFeed({ items: filtered, now: Date.now(), clusters: rawEventClusters })
      : null
  ), [nav, filtered, rawEventClusters]);

  const allFeedItems = useMemo(() => {
    if (nav !== 'all') return filtered;
    const feed = discoverFeed?.feed || filtered;
    if (eventClusters.length === 0) return feed;
    const secondaryIds = new Set(eventClusters.flatMap(cluster =>
      cluster.items.filter(item => item.id !== cluster.primaryItem.id).map(item => item.id)
    ));
    return feed.filter(item => !secondaryIds.has(item.id));
  }, [filtered, eventClusters, nav, discoverFeed]);

  const smartRecommendations = useMemo(() => {
    if (readingHistory.length === 0) return [];

    const categoryCounts = {};
    const sourceCounts = {};
    const keywordCounts = {};

    readingHistory.forEach(h => {
      if (h.category) categoryCounts[h.category] = (categoryCounts[h.category] || 0) + 1;
      if (h.source) sourceCounts[h.source] = (sourceCounts[h.source] || 0) + 1;
      if (h.tags) h.tags.forEach(t => keywordCounts[t] = (keywordCounts[t] || 0) + 1);
    });

    const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
    const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
    const topKeywords = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);

    const scored = items.map(item => {
      let score = 0;
      if (topCategories.includes(item.category)) score += 30;
      if (topSources.includes(item.source)) score += 20;
      item.tags?.forEach(t => { if (topKeywords.includes(t)) score += 10; });
      if (followKeywords.some(kw => `${item.title} ${item.summary}`.toLowerCase().includes(kw.toLowerCase()))) score += 25;
      const age = (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60);
      score += Math.max(0, 20 - age);
      return { ...item, recScore: score };
    });

    // v26.8：预览（depth='preview'）不算已读——预览行为只参与画像分析，不把条目从推荐里排除
    const readIds = new Set(readingHistory.filter(h => h?.depth !== 'preview').map(h => h.id));
    return scored.filter(i => !readIds.has(i.id) && i.recScore > 20).sort((a, b) => b.recScore - a.recScore).slice(0, 15);
  }, [items, readingHistory, followKeywords]);

  const selectedRecommendationSnapshot = useMemo(() => {
    if (!selectedNewsDate) return null;
    return snapshotStoreRef.current.get(selectedNewsDate);
  }, [selectedNewsDate, recommendationSnapshots]);

  const displayRecommendationLanes = useMemo(() => {
    const liveCount = (recommendationLanes.public?.length || 0) + (recommendationLanes.personal?.length || 0);
    if (liveCount > 0) return recommendationLanes;
    return selectedRecommendationSnapshot?.lanes || recommendationLanes;
  }, [recommendationLanes, selectedRecommendationSnapshot]);

  useEffect(() => {
    if (loading || recommendationCandidates.length === 0) return;
    snapshotStoreRef.current.create({
      date: selectedNewsDate,
      profileVersion: 1,
      algorithmVersion: '1.0',
      lanes: recommendationLanes,
      briefing: algorithmBriefing,
    });
    setRecommendationSnapshots(snapshotStoreRef.current.list());
  }, [loading, selectedNewsDate, recommendationCandidates.length, recommendationLanes, algorithmBriefing]);

  // 今日速报页：实时 lanes 为空时（历史日期无缓存资讯）降级到当日快照，保证历史日报可读
  const todayLanes = useMemo(() => {
    const hasLive = (recommendationLanes.public?.length || 0) + (recommendationLanes.personal?.length || 0) > 0;
    if (hasLive) return recommendationLanes;
    const snapLanes = selectedRecommendationSnapshot?.lanes;
    return snapLanes || recommendationLanes;
  }, [recommendationLanes, selectedRecommendationSnapshot]);

  // 今日速报版面：公共热点 / 个人必看各展示 10 条（按 publicScore / personalScore 降序，挑最高分、最有价值、最值得推荐）。
  // 独立计算，不影响「精准推荐」页（仍用 perLane:5 的 recommendationLanes）。
  const newspaperLanes = useMemo(() => {
    if (recommendationCandidates.length > 0) {
      return selectBriefingLanes(recommendationCandidates, {
        perLane: 10,
        maxPerSource: 2,
        maxCategoryRatio: 0.4,
      });
    }
    const snapLanes = selectedRecommendationSnapshot?.lanes;
    return snapLanes || { public: [], personal: [] };
  }, [recommendationCandidates, selectedRecommendationSnapshot]);
  const todayBriefing = useMemo(() => {
    const hasLive = algorithmBriefing && (algorithmBriefing.oneLine || algorithmBriefing.opportunities?.length || algorithmBriefing.risks?.length);
    if (hasLive) return algorithmBriefing;
    return selectedRecommendationSnapshot?.briefing || algorithmBriefing;
  }, [algorithmBriefing, selectedRecommendationSnapshot]);

  const {
    workbenchItems,
    workbenchStats,
    intelligenceProfile,
    profilePriorityItems,
    sourcePriorityItems,
    profileLearningEngine,
    todayProfileSnapshot,
    calibrationFlags,
  } = useWorkbenchMemos({
    todayMustRead,
    selectedDateItems,
    selectedInterests,
    followKeywords,
    recommendationFeedback,
    bookmarks,
    materials,
    categories,
    domainTiers,
    sourceTiers,
    customDomains: profileCustomDomains,
    customSources: profileCustomSources,
    readingProfile,
    insightData,
    isBookmarked,
    isInMaterials,
    readingHistory,
    selectedNewsDate,
    dailyProfileSnapshots,
  });

  const feedbackLearningCount = useMemo(() => {
    return (recommendationFeedback.hiddenIds || []).length
      + Object.values(recommendationFeedback.boostedCategories || {}).reduce((sum, value) => sum + value, 0)
      + Object.values(recommendationFeedback.mutedSources || {}).reduce((sum, value) => sum + value, 0)
      + Object.values(recommendationFeedback.trackedTerms || {}).reduce((sum, value) => sum + value, 0);
  }, [recommendationFeedback]);

  const getRecommendationLevel = useCallback((score = 0) => {
    if (score >= 90) return { label: '强推荐', tone: 'strong' };
    if (score >= 55) return { label: '值得看', tone: 'good' };
    if (score >= 15) return { label: '可略读', tone: 'light' };
    return { label: '入选', tone: 'neutral' };
  }, []);

  const buildAiJudgement = useCallback((item) => {
    const reasons = item.recommendationReasons || [];
    const title = item.title || '';
    if (reasons.some(reason => reason.includes('追踪'))) return '与你的长期追踪主题相关，适合继续观察后续变化。';
    if (reasons.some(reason => reason.includes('关注'))) return '命中你的核心关注领域，建议优先判断它是否会形成趋势。';
    if (item.sourceGradeLabel?.startsWith('S') || item.sourceGradeLabel?.startsWith('A')) return '来源质量较高，适合作为今天的可信参考材料。';
    if (/regulat|policy|安全|治理|risk|ban|law/i.test(`${title} ${item.summary || ''}`)) return '可能涉及监管、风险或安全变化，建议结合业务影响阅读。';
    if (/agent|model|芯片|算力|cloud|AI/i.test(`${title} ${item.summary || ''}`)) return '反映技术和产业落地方向，可沉淀为选题或观察点。';
    return '与今天的技术动态相关，可快速浏览后决定是否沉淀。';
  }, []);

  // TOP 5 hot items — memoized independently from workbenchItems so
  // clicking a hotspot (which calls recordReading → updates readingHistory)
  // does NOT reorder the list.
  const topMustRead = useMemo(() => {
    return workbenchItems.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedInterests, recommendationFeedback, followKeywords]);

  // Profile-based recommendations (excluding top 5, unlimited)
  const profileRecommendations = useMemo(() => {
    const topIds = new Set(topMustRead.map(i => i.id));
    return workbenchItems
      .filter(item => !topIds.has(item.id))
      .sort((a, b) => (b.mustReadScore || 0) - (a.mustReadScore || 0));
  }, [workbenchItems, topMustRead]);

  const workbenchAiInsight = useMemo(() => {
    const topItems = workbenchItems.slice(0, 3);
    const categoryCounts = workbenchItems.reduce((acc, item) => {
      const label = categories.find(cat => cat.id === item.category)?.label || item.category || '综合科技';
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
    const leadingCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([label]) => label);
    const highQualityCount = workbenchItems.filter(item => item.sourceGradeLabel?.startsWith('S') || item.sourceGradeLabel?.startsWith('A')).length;
    const trackedCount = workbenchStats.keywordMatches;
    const opportunity = leadingCategories.length
      ? `${leadingCategories.join('、')} 是今天最集中的信号，适合优先建立持续观察。`
      : '今天的资讯较分散，建议先从高质量来源快速扫读。';
    const risk = workbenchItems.some(item => /regulat|policy|治理|安全|risk|ban|case|law/i.test(`${item.title} ${item.summary || ''}`))
      ? '今日出现监管、治理或安全相关信号，建议标记为风险观察。'
      : highQualityCount >= 4
        ? '高质量来源占比较高，适合沉淀成可靠参考。'
        : '部分来源质量偏弱，建议优先看高等级来源。';
    const oneLine = leadingCategories.length
      ? `今天主要围绕 ${leadingCategories.join('、')} 展开，系统已按你的偏好收敛为 ${workbenchItems.length} 条。`
      : `系统已从当前日期资讯中收敛出 ${workbenchItems.length} 条，适合快速建立今日判断。`;

    return {
      oneLine,
      opportunity,
      risk,
      topItems,
      leadingCategories,
      highQualityCount,
      trackedCount
    };
  }, [workbenchItems, workbenchStats.keywordMatches]);

  const intelligenceAgents = useMemo(() => {
    const sourcePoolCount = selectedDateItems.length || items.length;
    const filteredOutCount = Math.max(sourcePoolCount - workbenchItems.length, 0);
    const creationReadyCount = workbenchItems.filter(item => isBookmarked(item.id) || isInMaterials(item.id) || item.imageUrl || (item.summary || '').length > 80).length;
    const memorySignals = feedbackLearningCount + followKeywords.length + selectedInterests.length;
    return [
      {
        name: '情报筛选 Agent',
        status: `${filteredOutCount} 条已过滤`,
        detail: `从 ${sourcePoolCount} 条候选中保留 ${workbenchItems.length} 条，优先看高匹配和高质量来源。`,
        tone: 'cyan'
      },
      {
        name: '解读分析 Agent',
        status: `${workbenchAiInsight.leadingCategories.length || 1} 个主信号`,
        detail: workbenchAiInsight.oneLine,
        tone: 'blue'
      },
      {
        name: '追踪记忆 Agent',
        status: `${memorySignals} 个用户信号`,
        detail: `已结合关注领域、追踪关键词和 ${feedbackLearningCount} 次反馈调整推荐。`,
        tone: 'amber'
      },
      {
        name: '创作转化 Agent',
        status: `${creationReadyCount} 条可转化`,
        detail: '可把今日资讯生成简报、选题、文章草稿或素材库条目。',
        tone: 'green'
      }
    ];
  }, [selectedDateItems, items, workbenchItems, feedbackLearningCount, followKeywords, selectedInterests, workbenchAiInsight, bookmarks, materials]);

  // profileLearningEngine and todayProfileSnapshot are now computed by
  // useWorkbenchMemos (delegating to profileModel.js pure functions).
  // Phase 1.2 Task 10: removed inline useMemo blocks that duplicated the
  // pure-function logic.

  // profileCalibrationCards: UI-only cards array (depends on
  // profilePriorityItems / sourcePriorityItems which are UI state).
  // Renamed from profileCalibrationSignals to avoid confusion with
  // calibrationFlags (3 booleans from useWorkbenchMemos for AI prompt layer).
  const profileCalibrationCards = useMemo(() => {
    const highDomainCount = profilePriorityItems.filter(item => item.tier === 'focus').length;
    const highSourceCount = sourcePriorityItems.filter(item => item.tier === 'focus').length;
    const clickedCategories = [...new Set(readingHistory.map(item => item.category).filter(Boolean))].length;
    return [
      { label: '高优先领域', value: highDomainCount, desc: '优先影响每日汇报排序' },
      { label: '高信任来源', value: highSourceCount, desc: '提高对应信号源权重' },
      { label: '阅读领域记忆', value: clickedCategories, desc: '从点击行为学习偏好' },
      { label: '收藏沉淀', value: bookmarks.length, desc: '强化可复用主题和来源' }
    ];
  }, [profilePriorityItems, sourcePriorityItems, readingHistory, bookmarks.length]);

  useEffect(() => {
    if (!todayProfileSnapshot.date) return;
    setDailyProfileSnapshots(prev => {
      const existing = prev.find(item => item.date === todayProfileSnapshot.date);
      if (existing && !existing.auto) return prev;
      const nextSnapshot = { ...todayProfileSnapshot, generatedAt: new Date().toISOString(), auto: true };
      if (existing) {
        const comparableExisting = { ...existing, generatedAt: undefined };
        const comparableNext = { ...nextSnapshot, generatedAt: undefined };
        if (JSON.stringify(comparableExisting) === JSON.stringify(comparableNext)) return prev;
      }
      const next = [
        nextSnapshot,
        ...prev.filter(item => item.date !== todayProfileSnapshot.date)
      ].slice(0, 30);
      return next;
    });
  }, [todayProfileSnapshot]);

  const intelligenceMissions = useMemo(() => [
    {
      id: 'briefing',
      agentId: 'orchestrator',
      label: '生成今日作战简报',
      prompt: '请作为情报总控，基于今日推荐生成一份个人作战简报：一句话总判断、三个最重要信号、优先阅读顺序、今天应该采取的下一步动作。'
    },
    {
      id: 'impact',
      agentId: 'analyst',
      label: '解释对我的影响',
      prompt: '请结合我的关注画像，解释今日资讯对我关注领域的影响：哪些是真机会，哪些只是噪声，哪些需要进一步验证。'
    },
    {
      id: 'memory',
      agentId: 'memory-agent',
      label: '更新追踪记忆',
      prompt: '请作为追踪记忆官，把今日资讯和我的历史偏好连接起来：应新增哪些追踪关键词、降低哪些来源权重、下次推荐应如何调整。'
    },
    {
      id: 'risk',
      agentId: 'risk-scout',
      label: '扫描潜在风险',
      prompt: '请作为风险雷达，找出今日资讯中的政策、市场、技术路线、安全和竞争风险，并区分确定事实、合理推断和仍需观察的信号。'
    },
    {
      id: 'creation',
      agentId: 'creation-agent',
      label: '转成创作选题',
      prompt: '请作为创作转化官，从今日资讯中提炼 5 个可写选题，每个选题给出标题、核心观点、素材来源和适合的文章结构。'
    }
  ], []);

  const aiActionPrompts = useMemo(() => intelligenceMissions.slice(0, 4), [intelligenceMissions]);

  const { workflowTypeMeta, workflowRunStatusMeta, selectedWorkflowNode, selectedWorkflowConnections, enabledWorkflowNodes } = useWorkflowMeta(agentWorkflowDraft, selectedWorkflowNodeId);

  const buildWorkflowBlueprint = useCallback((draft) => {
    if (!draft || !Array.isArray(draft.nodes) || draft.nodes.length === 0) return '';
    const lines = draft.nodes.map((node, index) => [
      `${index + 1}. [${workflowTypeMeta[node.type]?.label || node.type}] ${node.title}`,
      `角色：${node.role}`,
      `输入：${node.inputKey || 'context'}`,
      `输出：${node.outputKey || `step_${index + 1}`}`,
      `能力配置：${formatWorkflowNodeConfig(node) || '默认'}`,
      `指令：${node.prompt}`,
      `状态：${node.enabled === false ? '停用' : '启用'}`,
    ].join('\n'));
    return [`${draft.name || '未命名工作流'}`, draft.description || '', '', lines.join('\n\n')].join('\n');
  }, [workflowTypeMeta]);

  const workflowComposerOptions = useMemo(() => {
    const options = [];
    const draftText = buildWorkflowBlueprint(agentWorkflowDraft);
    if (draftText) options.push({ id: 'draft', name: agentWorkflowDraft.name || '当前画布', blueprint: draftText });
    (workflowTemplates || []).forEach(tpl => {
      const text = buildWorkflowBlueprint(tpl);
      if (text && !options.some(o => o.name === tpl.name)) {
        options.push({ id: tpl.id || tpl.name, name: tpl.name || '未命名模板', blueprint: text });
      }
    });
    return options;
  }, [agentWorkflowDraft, workflowTemplates, buildWorkflowBlueprint]);

  const workflowBlueprintText = useMemo(
    () => buildWorkflowBlueprint(agentWorkflowDraft),
    [agentWorkflowDraft, buildWorkflowBlueprint],
  );

  const {
    updateWorkflowDraft,
    switchWorkflowTemplate,
    saveWorkflowAsTemplate,
    renameWorkflow,
    duplicateWorkflow,
    createWorkflow,
    installWorkflowTemplate,
    importWorkflowJson,
    deleteWorkflowTemplate,
    updateWorkflowNode,
    reorderWorkflowNode,
    moveWorkflowNode,
    addWorkflowNode,
    removeWorkflowNode,
    resetWorkflowDraft,
    exportWorkflowToMaterials,
    downloadWorkflowJson,
    exportWorkflowResultToEditor,
  } = useWorkflowOps({
    agentWorkflowDraft,
    setAgentWorkflowDraft,
    workflowTemplates,
    setWorkflowTemplates,
    activeWorkflowId,
    setActiveWorkflowId,
    workflowTypeMeta,
    newWorkflowNodeType,
    selectedWorkflowNodeId,
    setSelectedWorkflowNodeId,
    addManualMaterial,
    agentWorkflowResult,
    agentWorkflowRun,
    workflowBlueprintText,
    setArticles,
    setCurrentArticleId,
    setNav,
    workflowImportInputRef,
  });

  useEffect(() => {
    if (!agentWorkflowDraft?.nodes?.length) return;
    setWorkflowTemplates(prev => {
      const draftId = activeWorkflowId || agentWorkflowDraft.id || 'default-workflow';
      const nextDraft = { ...agentWorkflowDraft, id: draftId, updatedAt: new Date().toISOString() };
      if (!prev.some(template => template.id === draftId)) return [...prev, nextDraft];
      return prev.map(template => template.id === draftId ? nextDraft : template);
    });
  }, [agentWorkflowDraft, activeWorkflowId]);

  const agentWorkflowScopes = useMemo(() => [
    { id: 'daily', label: '今日', desc: `${workbenchItems.length} 条推荐` },
    { id: 'focus', label: '关注', desc: `${workbenchStats.focusMatches} 条匹配` },
    { id: 'saved', label: '沉淀', desc: `${workbenchStats.savedCount} 条已存` }
  ], [workbenchItems.length, workbenchStats.focusMatches, workbenchStats.savedCount]);

  const scopedAgentItems = useMemo(() => {
    if (agentWorkflowScope === 'focus') {
      const focused = workbenchItems.filter(item => selectedInterests.includes(item.category));
      return focused.length ? focused : workbenchItems;
    }
    if (agentWorkflowScope === 'saved') {
      const saved = workbenchItems.filter(item => isBookmarked(item.id) || isInMaterials(item.id));
      return saved.length ? saved : workbenchItems;
    }
    return workbenchItems;
  }, [agentWorkflowScope, workbenchItems, selectedInterests, bookmarks, materials]);

  const workflowValidation = useMemo(() => validateWorkflowDraft({
    draft: agentWorkflowDraft,
    llmConfig,
    scopedAgentItems,
    selectedInterests,
    readingHistory,
    bookmarks,
    materials,
  }), [agentWorkflowDraft, llmConfig.baseUrl, llmConfig.selectedModel, scopedAgentItems.length, selectedInterests.length, readingHistory.length, bookmarks.length, materials.length]);

  const buildWorkbenchContext = useCallback((prompt) => {
    const topItems = scopedAgentItems.slice(0, 8);
    const lines = topItems.map((item, idx) => {
      const reasons = item.recommendationReasons?.length ? item.recommendationReasons.join('、') : item.recommendation || '综合推荐';
      return `${idx + 1}. ${item.title}
来源：${item.source || '未知'}｜分类：${item.category || '未分类'}｜质量：${item.sourceGradeLabel || '未评级'}｜推荐分：${Math.round(item.mustReadScore || 0)}
推荐理由：${reasons}
摘要：${item.summary || '暂无摘要'}
链接：${item.url || ''}`;
    }).join('\n\n');
    const normalizedMaterials = materials.flatMap(material => {
      try { return [normalizeAsset(material)]; } catch { return []; }
    });
    const prioritizedMaterials = normalizedMaterials.sort((a, b) => {
      const aElf = isAiElfAsset(a) ? 1 : 0;
      const bElf = isAiElfAsset(b) ? 1 : 0;
      if (aElf !== bElf) return bElf - aElf;
      return (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0);
    }).slice(0, 6);
    const materialLines = prioritizedMaterials.map((material, idx) => `${idx + 1}. ${material.title || '未命名素材'}
来源：${material.source || '未知'}｜类型：${material.type || 'material'}｜标签：${Array.isArray(material.tags) ? material.tags.join('、') : ''}
内容：${String(material.fullContent || material.content || '').replace(/\s+/g, ' ').slice(0, 900)}`).join('\n\n');

    return `${prompt}

日期：${selectedNewsDate || new Date().toISOString().slice(0, 10)}
关注领域：${selectedInterests.map(id => categories.find(c => c.id === id)?.label || id).join('、') || '未设置'}
追踪关键词：${followKeywords.join('、') || '未设置'}
用户画像：
- 当前深度：${intelligenceProfile.depth}
- 输出目标：${intelligenceProfile.outputGoal}
- 重点关注：${intelligenceProfile.focusLabels.join('、') || '未设置'}
- 最近强化：${intelligenceProfile.boosted.join('、') || '暂无'}
- 降权来源：${intelligenceProfile.muted.join('、') || '暂无'}
- 记忆关键词：${intelligenceProfile.tracked.join('、') || '暂无'}
推荐统计：当前范围 ${scopedAgentItems.length} 条，全部推荐 ${workbenchItems.length} 条，兴趣匹配 ${workbenchStats.focusMatches} 条，关键词命中 ${workbenchStats.keywordMatches} 条

今日推荐资讯：
${lines}

素材库上下文（优先包含 AI 精灵交接记录）：
${materialLines || '暂无素材'}`;
  }, [scopedAgentItems, workbenchItems.length, selectedNewsDate, selectedInterests, followKeywords, intelligenceProfile, workbenchStats.focusMatches, workbenchStats.keywordMatches, materials]);

  const sendWorkbenchToElf = useCallback((prompt, agentId = 'orchestrator') => {
    if (agentId) setCurrentAgent(agentId);
    setElfQuotedContext({
      id: Date.now(),
      title: '今日情报工作台',
      agentId,
      content: buildWorkbenchContext(prompt),
      suggestedPrompt: prompt
    });
    showToast('已把今日情报交给智能体');
  }, [buildWorkbenchContext]);

  const sendCopilotAbout = useCallback((item) => {
    const msg = `请分析这条资讯：「${item.title}」——来源：${item.sourceName || item.source || '未知'}，分类：${item.category || '未分类'}，推荐理由：${item.recommendation || '综合推荐'}。请给出要点分析和跟我关注领域的关联。`;
    setCopilotPendingMessage(msg);
  }, []);

  const generateDailyProfileSnapshot = useCallback(() => {
    setDailyProfileSnapshots(prev => {
      const next = [
        { ...todayProfileSnapshot, generatedAt: new Date().toISOString() },
        ...prev.filter(item => item.date !== todayProfileSnapshot.date)
      ].slice(0, 30);
      return next;
    });
    showToast('今日用户画像已记录');
  }, [todayProfileSnapshot]);

  const restoreAgentWorkflowHistory = useCallback((record) => {
    if (!record) return;
    setAgentWorkflowResult({
      loading: false,
      content: record.content || '',
      error: record.error || '',
      missionId: record.missionId || ''
    });
    setAgentWorkflowRun({
      id: record.id || '',
      status: record.status || 'completed',
      missionLabel: record.missionLabel || '历史运行',
      startedAt: record.startedAt || '',
      finishedAt: record.finishedAt || '',
      trace: record.trace || []
    });
    setAgentWorkflowActions(record.actions || []);
    setAgentWorkflowPrompt(record.prompt || '');
    showToast('已恢复工作流历史结果');
  }, []);

  const clearAgentWorkflowHistory = useCallback(() => {
    setAgentWorkflowHistory([]);
    showToast('已清空工作流运行历史');
  }, []);

  const { createWorkflowActions, updateWorkflowActionStatus, executeWorkflowAction } = useWorkflowActions({
    scopedAgentItems,
    items,
    materials,
    followKeywords,
    intelligenceProfile,
    setMaterials,
    setFollowKeywords,
    setRecommendationFeedback,
    setArticles,
    setCurrentArticleId,
    setAgentWorkflowActions,
    setAgentWorkflowHistory,
    setDailyProfileSnapshots,
    detectMaterialType,
    agentWorkflowPrompt,
    agentWorkflowResult,
    todayProfileSnapshot,
    agentWorkflowRun,
    addManualMaterial,
  });

  // (useBookmarkMaterial moved above useArticleEditor — provides materials which the latter consumes)

  const runAgentWorkflow = useAgentWorkflowRunner({
    agents,
    intelligenceMissions,
    enabledWorkflowNodes,
    agentWorkflowDraft,
    llmConfig,
    scopedAgentItems,
    selectedNewsDate,
    agentWorkflowScope,
    intelligenceProfile,
    bookmarks,
    materials,
    selectedInterests,
    categories,
    workflowValidation,
    buildWorkbenchContext,
    createWorkflowActions,
    setCurrentAgent,
    setAgentWorkflowPrompt,
    setAgentWorkflowResult,
    setAgentWorkflowRun,
    setAgentWorkflowActions,
    setAgentWorkflowHistory,
    setShowLlmQuickConfig,
  });

  const { getFeedbackTerm, handleRecommendationFeedback } = useRecommendationFeedback({
    recommendationFeedback, setRecommendationFeedback,
    recommendationFeedbackEvents, setRecommendationFeedbackEvents,
    selectedInterests, setSelectedInterests,
    followKeywords, setFollowKeywords,
  });

  const { calendarDays, calendarHeatMap, calendarInsights } = useCalendarMemos(calendarDate, items, events);

  const searchSuggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();
    return items
      .map(i => i.title)
      .filter(t => t.toLowerCase().includes(q))
      .slice(0, 5);
  }, [items, query]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const currentItems = nav === 'all' ? filtered : nav === 'trending' ? trendingItems : [];
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, currentItems.length - 1));
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (focusedIndex >= 0 && currentItems[focusedIndex]) window.open(currentItems[focusedIndex].url, '_blank');
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (focusedIndex >= 0 && currentItems[focusedIndex]) toggleBookmark(currentItems[focusedIndex]);
      } else if (e.key === '1') { e.preventDefault(); setViewMode('compact'); }
      else if (e.key === '2') { e.preventDefault(); setViewMode('standard'); }
      else if (e.key === '3') { e.preventDefault(); setViewMode('card'); }
      else if (e.key === 'Escape') { setSearchOpen(false); setCategoryOpen(false); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focusedIndex, nav, filtered, trendingItems]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const el = document.querySelector(`.news-item[data-index="${focusedIndex}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIndex]);

  function loadNews(b = blocked, append = false, searchQuery = '', options = {}) {
    if (!append) { setLoading(true); setError(''); setNewsPage(0); setNewsHasMore(true); setRenderLimit(40); }
    const page = append ? newsPage + 1 : 0;
    const customParams = customSources.map(s => `custom=${encodeURIComponent(JSON.stringify(s))}`).join('&');
    const disabledParam = disabledSources.length > 0 ? `&disabledSources=${encodeURIComponent(disabledSources.join(','))}` : '';
    const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
    // 兴趣过滤
    let interestsParam = '';
    if (nav === 'recommendations' && isLoggedIn && selectedInterests.length > 0) {
      interestsParam = `&interests=${encodeURIComponent(selectedInterests.join(','))}`;
    }
    // 用户主动点"刷新"按钮时强制刷新（绕过缓存）；后台预取走 SWR
    const forceRefreshParam = options.forceRefresh ? '&forceRefresh=1' : '';
    const baseUrl = `/api/news?blocked=${encodeURIComponent(b)}&page=${page}&pageSize=200${searchParam}${disabledParam}${interestsParam}${customParams ? '&' + customParams : ''}${forceRefreshParam}`;
    fetch(baseUrl)
      .then(r => r.json())
      .then(d => {
        if (d.items && d.items.length > 0) {
          const sampleRegions = d.items.slice(0, 3).map(i => ({ title: i.title?.substring(0, 30), region: i.region }));
        }

        // isChinaFocused 已由后端 /api/news 预计算（getNews 中 computeIsChinaFocused），直接消费
        const itemsWithChinaTag = d.items || [];

        if (append) {
          setItems(prev => [...prev, ...itemsWithChinaTag]);
        } else {
          setItems(itemsWithChinaTag);
        }
        setStats({ ...d, items: undefined });
        setNewsHasMore(d.hasMore ?? false);
        setNewsPage(page);

        // 后台逐批拉取剩余所有信号源资讯（仅首次进入全部动态 / 无搜索词时触发）
        // 不设置 loading，静默合并去重，用户无感、不卡顿、不白屏
        if (!append && !searchQuery && d.hasMore) {
          const seenIds = new Set(itemsWithChinaTag.map(i => i.id));
          const customParamsStr = customParams;
          const disabledParamStr = disabledParam;
          const interestsParamStr = interestsParam;
          fetchAllRemainingNews(b, seenIds, customParamsStr, disabledParamStr, interestsParamStr, page);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }

  // 后台逐批拉取全部信号源资讯：从 nextPage 起循环请求，直至 hasMore=false
  // 每批到达后静默合并到 items（去重、保留已有顺序），不打断用户当前浏览
  async function fetchAllRemainingNews(b, seenIds, customParamsStr, disabledParamStr, interestsParamStr, startPage) {
    let currentPage = startPage + 1;
    let hasMore = true;
    while (hasMore && currentPage < 10) {  // 上限 10 批（200*10=2000 条），防止失控
      const url = `/api/news?blocked=${encodeURIComponent(b)}&page=${currentPage}&pageSize=200${disabledParamStr}${interestsParamStr}${customParamsStr ? '&' + customParamsStr : ''}`;
      try {
        const resp = await fetch(url);
        const d = await resp.json();
        const fresh = (d.items || []).filter(item => item && item.id && !seenIds.has(item.id));
        if (fresh.length > 0) {
          fresh.forEach(item => seenIds.add(item.id));
          // 合并到 items：已有 ID 跳过，新条目追加到末尾
          setItems(prev => {
            const existing = new Set(prev.map(i => i.id));
            const additions = fresh.filter(i => !existing.has(i.id));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
          // 更新资讯总数统计
          setStats(prevStats => prevStats ? { ...prevStats, sourceCount: Math.max(prevStats.sourceCount || 0, 0), failedSources: prevStats.failedSources || 0 } : prevStats);
        }
        hasMore = d.hasMore ?? false;
        currentPage++;
      } catch {
        hasMore = false;  // 后台拉取失败静默停止，不影响用户
      }
    }
  }

  useEffect(() => {
    if (nav === 'recommendations') loadExternalIntelligence(selectedInterests, { sourceTiers, specialFollows });
  }, [nav, selectedInterests, sourceTiers, specialFollows]);
  function loadMoreNews() {
    if (!newsHasMore || loadingMore || loading) return;
    setLoadingMore(true);
    loadNews(blocked, true, debouncedQuery);
  }



  // loadTrending / loadGithub 已提取至 useTrending hook

  // 书签与素材操作已提取至 useBookmarkMaterial hook


  const {
    readingStatsData,
    exportFilteredBookmarks,
    sortedFollowKeywords,
    matchCountPerKeyword,
  } = useReadingStatsMemos({
    bookmarks, filtered, followKeywords, pinnedKeywords,
    exportCategory, exportRange,
  });

  const {
    filteredMaterials,
    allMaterialSources,
    allMaterialTags,
    materialRefCounts,
    filteredArticles,
    filteredExportArticles,
  } = useMaterialsMemos({
    materials, materialSpaceFilter, materialFilter, materialTimeRange,
    materialSourceFilter, materialSearch, materialTags,
    articles, articleSpaceFilter, articleSearch,
    articleStatusFilter, articleTemplateFilter, articleSort, articleExportFilter,
  });

  // selectAllMaterials depends on filteredMaterials (from useMaterialsMemos above),
  // so it must be defined here rather than inside useBookmarkMaterial.
  const selectAllMaterials = useCallback(() => {
    setSelectedMaterials(filteredMaterials.map(m => m.id));
  }, [filteredMaterials, setSelectedMaterials]);

  function addFollowKeyword(kw) {
    const keyword = kw || newKeyword;
    if (!keyword.trim() || followKeywords.includes(keyword.trim())) return;
    setFollowKeywords(prev => [...prev, keyword.trim()]);
    setNewKeyword('');
  }

  function removeFollowKeyword(kw) {
    setFollowKeywords(prev => prev.filter(k => k !== kw));
    setPinnedKeywords(prev => prev.filter(k => k !== kw));
  }

  function pinFollowKeyword(kw) {
    setPinnedKeywords(prev => prev.includes(kw) ? prev : [...prev, kw]);
  }

  function unpinFollowKeyword(kw) {
    setPinnedKeywords(prev => prev.filter(k => k !== kw));
  }


  function recordReading(item) {
    // 阅读行为单独进入行为校准，不得覆盖用户显式设置的领域/信源等级。
    setReadingHistory(prev => {
      const filtered = prev.filter(h => h.id !== item.id);
      return [{
        id: item.id,
        title: item.title,
        source: item.source,
        category: item.category,
        tags: item.tags || [],
        summary: item.summary || '',
        url: item.url || '',
        imageUrl: item.imageUrl || '',
        videoUrl: item.videoUrl || '',
        sourceGradeLabel: item.sourceGradeLabel || item.grade || '',
        depth: 'full',
        readAt: new Date().toISOString()
      }, ...filtered].slice(0, 100);
    });
  }


  // GitHub 项目 AI 情报：实时调 LLM 生成应用场景/适合谁/落地难度/价值判断
  const {
    githubInsights, setGithubInsights,
    githubInsightLoading, setGithubInsightLoading,
    requestGithubInsight,
  } = useGithubInsight({ llmConfig });

  // GitHub 一键 AI 情报：状态从 GithubPage 提升至此（按钮位于顶栏原中英文切换位置）
  const [githubExpandedAll, setGithubExpandedAll] = useState(false);
  const githubRunTokenRef = useRef(0);
  const handleToggleGithubInsights = useCallback(async () => {
    if (githubExpandedAll) {
      setGithubExpandedAll(false);
      githubRunTokenRef.current += 1; // 取消仍在排队的请求
      return;
    }
    setGithubExpandedAll(true);
    const token = ++githubRunTokenRef.current;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const repo of githubRepos) {
      if (token !== githubRunTokenRef.current) break; // 已收起 / 已重开，停止排队
      if (githubInsights[repo.id] || githubInsightLoading[repo.id]) continue; // 已有或生成中则跳过
      await requestGithubInsight(repo);
      if (token !== githubRunTokenRef.current) break;
      await sleep(400); // 卡间间隔，给上游限流留出余量
    }
  }, [githubExpandedAll, githubRepos, githubInsights, githubInsightLoading, requestGithubInsight]);

  function executeSearch(q) {
    setNav('all');
    setCategory('all');
    setMode('all');
    setSourceFilter('all');
    setRegionFilter('all');
    setQuery(q);
    if (q.trim()) {
      setSearchHistory(prev => {
        const filtered = prev.filter(h => h.query !== q.trim());
        return [{ query: q.trim(), searchedAt: new Date().toISOString() }, ...filtered].slice(0, 20);
      });
      // 调 API 获取更多搜索结果（补充本地已有数据）
      loadNews(blocked, false, q.trim());
    }
    setSearchOpen(false);
  }

  // addEvent/removeEvent moved to useCalendar

  const navToPrimary = {
    home: 'home',
    recommendations: 'recommendations',
    all: 'all',
    stock: 'stock',
    tracker: 'profile-center',
    trends: 'profile-center',
    calendar: 'profile-center',
    studio: 'studio',
    editor: 'studio',
    materials: 'studio',
    canvas: 'canvas',
    square: 'square',
    chat: 'chat', // v24 #5 修复：此前缺 chat 键导致点联系人时侧边栏错误聚焦到 AI 工作站
    'profile-center': 'profile-center',
    github: 'github',
    monitor: 'monitor',
  };
  const activePrimaryNav = navToPrimary[nav] || 'home';
  const activeContextSection = navContextSections[activePrimaryNav] || navContextSections.home;
  const activeContextItems = activeContextSection.items.map(id => navItems.find(item => item.id === id)).filter(Boolean);
  const goNav = (nextNav) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextNav);
    window.history.pushState({ view: nextNav }, '', url);
    setNav(nextNav);
    setFocusedIndex(-1);
    setMobileMenuOpen(false);
  };
  // 填充全局键盘 handler 的 API ref（goNav 已在本行之前初始化，规避 TDZ）
  kbApiRef.current = { goNav, setShowCommandPalette, setShowShortcuts, showShortcuts, showCommandPalette };

  // 路由 hover prefetch：鼠标悬停导航按钮时预取该路由的数据/lazy chunk
  // fire-and-forget，去重保证同一路由会话内只预取一次
  const prefetchedNavsRef = useRef(new Set());
  const prefetchNav = useCallback((nextNav) => {
    if (!nextNav || prefetchedNavsRef.current.has(nextNav)) return;
    prefetchedNavsRef.current.add(nextNav);
    try {
      switch (nextNav) {
        case 'all':
          // 资讯列表（如果首页 backgroundLoadedRef 已预取则服务端缓存命中）
          if (items.length === 0) loadNews(blocked, false, debouncedQuery);
          break;
        case 'stock':
          // 预取 StockPage lazy chunk + dashboard API 填充服务端缓存
          import('./components/StockPage.jsx').catch(() => {});
          fetch('/api/stock/dashboard').catch(() => {});
          break;
        case 'github':
          if (githubRepos.length === 0) loadGithub();
          break;
        case 'trending':
          if (trendingItems.length === 0) loadTrending();
          break;
        case 'studio':
          // 智创中心 = 素材仓库（静态引入的 MaterialsPage，无需预取 chunk）
          break;
        case 'square':
          // 社区页面当前与主壳共享状态，保持静态加载，避免无收益的重复动态导入。
          break;
        case 'recommendations':
          // 推荐页依赖 trending + briefing，已由 backgroundLoadedRef 预取
          break;
        case 'home':
          // AI 工作站 lazy chunk
          import('./AiElf.jsx').catch(() => {});
          break;
        default:
          break;
      }
    } catch { /* ignore prefetch errors */ }
  }, [items.length, githubRepos.length, trendingItems.length, blocked, debouncedQuery, loadNews, loadGithub, loadTrending]);
  const wideWorkspaceNavs = ['home', 'recommendations', 'studio', 'canvas', 'materials', 'square', 'chat', 'profile-center'];
  // 右侧面板：「全部动态」显示关注关键词；「AI 情报首页」显示情报时间线；「精准推荐」显示日期竖向时间线
  const showRightPanel = nav === 'recommendations';
  const showStatsBar = showRightPanel && nav !== 'home' && nav !== 'recommendations';

  // 智创中心 = 素材仓库（storage-only）。studio 与 materials 两个入口渲染同一仓库页：
  // 创作与智能体工作流已由 AI 工作站承接，本模块只负责素材的收集、整理、检索与复用。
  function renderMaterialsRepo() {
    return (
      <MaterialsPage
        materials={materials}
        materialSpaces={materialSpaces}
        materialSearch={materialSearch}
        setMaterialSearch={setMaterialSearch}
        materialFilter={materialFilter}
        setMaterialFilter={setMaterialFilter}
        materialSpaceFilter={materialSpaceFilter}
        setMaterialSpaceFilter={setMaterialSpaceFilter}
        materialTimeRange={materialTimeRange}
        setMaterialTimeRange={setMaterialTimeRange}
        materialSourceFilter={materialSourceFilter}
        setMaterialSourceFilter={setMaterialSourceFilter}
        allMaterialSources={allMaterialSources}
        materialTags={materialTags}
        setMaterialTags={setMaterialTags}
        allMaterialTags={allMaterialTags}
        filteredMaterials={filteredMaterials}
        selectedMaterials={selectedMaterials}
        exportMaterials={exportMaterials}
        importMaterials={importMaterials}
        toggleMaterialStar={toggleMaterialStar}
        removeMaterial={removeMaterial}
        batchRemoveMaterials={batchRemoveMaterials}
        assignMaterialsToSpace={assignMaterialsToSpace}
        clearMaterialSelection={clearMaterialSelection}
        selectAllMaterials={selectAllMaterials}
        toggleMaterialSelection={toggleMaterialSelection}
        continueMaterialInWorkbench={continueMaterialInWorkbench}
        materialRefCounts={materialRefCounts}
        showSpaceForm={showSpaceForm}
        setShowSpaceForm={setShowSpaceForm}
        newSpaceName={newSpaceName}
        setNewSpaceName={setNewSpaceName}
        createMaterialSpace={createMaterialSpace}
        showAddMaterial={showAddMaterial}
        setShowAddMaterial={setShowAddMaterial}
        addManualMaterial={addManualMaterial}
        setLightbox={setLightbox}
        materialSection={materialSection}
        setMaterialSection={setMaterialSection}
        materialSort={materialSort}
        setMaterialSort={setMaterialSort}
        materialView={materialView}
        setMaterialView={setMaterialView}
        materialDetailId={materialDetailId}
        setMaterialDetailId={setMaterialDetailId}
        recentlyDeleted={recentlyDeleted}
        restoreMaterial={restoreMaterial}
        purgeMaterial={purgeMaterial}
        emptyTrash={emptyTrash}
        renameMaterialSpace={renameMaterialSpace}
        deleteMaterialSpace={deleteMaterialSpace}
        updateMaterialNote={updateMaterialNote}
        updateMaterialTags={updateMaterialTags}
      />
    );
  }

  return (
    <div data-active-nav={nav} className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${panelCollapsed ? 'panel-collapsed' : ''} ${!showRightPanel ? 'no-right-panel' : ''} ${editorFullscreen ? 'editor-fullscreen' : ''} ${entered ? 'is-entered' : ''}`}>
      <div className="particle-layer" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => <span key={i} className="particle" style={{ '--i': i }} />)}
      </div>
      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />}

      {/* Sidebar */}
<Sidebar sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed} mobileMenuOpen={mobileMenuOpen} nav={nav} goNav={goNav} addRecentVisit={addRecentVisit} onPrefetchNav={prefetchNav} activePrimaryNav={activePrimaryNav} activeContextItems={activeContextItems} contextGroupOpen={contextGroupOpen} setContextGroupOpen={setContextGroupOpen} showFollowDropdown={showFollowDropdown} setShowFollowDropdown={setShowFollowDropdown} followKeywords={followKeywords} sortedFollowKeywords={sortedFollowKeywords} pinnedKeywords={pinnedKeywords} pinFollowKeyword={pinFollowKeyword} unpinFollowKeyword={unpinFollowKeyword} removeFollowKeyword={removeFollowKeyword} executeSearch={executeSearch} newKeyword={newKeyword} setNewKeyword={setNewKeyword} addFollowKeyword={addFollowKeyword} bookmarks={bookmarks} filtered={filtered} isLoggedIn={isLoggedIn} user={user} setShowProfileModal={setShowProfileModal} setAuthMode={setAuthMode} setShowAuthModal={setShowAuthModal} setShowSettings={setShowSettings} PRODUCT_NAME={PRODUCT_NAME} PRODUCT_TAGLINE={PRODUCT_TAGLINE} PRIMARY_NAV_ITEMS={primaryNavItems} />

      {/* Main */}
      <main data-nav={nav} className={`main ${(nav === 'home' || nav === 'recommendations') ? 'main-workbench' : ''}`}>
        <Topbar
          nav={nav}
          scrollingNews={scrollingNews}
          scrollingNewsRef={scrollingNewsRef}
          setScrollingNewsPaused={setScrollingNewsPaused}
          handleScrollingNewsMouseDown={handleScrollingNewsMouseDown}
          themeMode={themeMode}
          setMobileMenuOpen={setMobileMenuOpen}
          searchInputRef={searchInputRef}
          query={query}
          setQuery={setQuery}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchSuggestions={searchSuggestions}
          executeSearch={executeSearch}
          searchHistory={searchHistory}
          searchSort={searchSort}
          setSearchSort={setSearchSort}
          category={category}
          setCategory={setCategory}
          categoryOpen={categoryOpen}
          setCategoryOpen={setCategoryOpen}
          categories={categories}
          githubLang={githubLang}
          setGithubLang={setGithubLang}
          githubSince={githubSince}
          setGithubSince={setGithubSince}
          loadGithub={loadGithub}
          mode={mode}
          setMode={setMode}
          regionFilter={regionFilter}
          setRegionFilter={setRegionFilter}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          sourceOptions={sourceOptions}
          viewMode={viewMode}
          setViewMode={setViewMode}
          setGlobeFullscreenOpen={setGlobeFullscreenOpen}
          loadNews={loadNews}
          blocked={blocked}
          debouncedQuery={debouncedQuery}
          trendingType={trendingType}
          setTrendingType={setTrendingType}
          trendingPlatform={trendingPlatform}
          setTrendingPlatform={setTrendingPlatform}
          loadTrending={loadTrending}
          newSinceLastVisit={newSinceLastVisit}
          onRefreshAll={() => {
            // v26：手动刷新 = 用户主动获取，清掉角标并把「已读基线」推到当前时刻，
            // 防止 items 更新后 1175 行的徽标重算副作用把角标又加回来
            try { localStorage.setItem('lastVisitLatestNewsAt', String(Date.now())); } catch { /* ignore */ }
            setNewSinceLastVisit(0);
            loadNews(blocked, false, debouncedQuery, { forceRefresh: true });
          }}
          profileSection={profileSection}
          setProfileSection={setProfileSection}
          telemetryStats={nav === 'profile-center' ? [
            { label: 'PERSONA.CONF', value: `${intelligenceProfile?.confidence ?? 0}%` },
            { label: 'DOMAINS', value: selectedInterests?.length ?? 0 },
            { label: 'READS', value: readingHistory?.length ?? 0 },
            { label: 'MARKS', value: bookmarks?.length ?? 0 },
            { label: 'SNAPSHOTS', value: dailyProfileSnapshots?.length ?? 0 },
          ] : null}
          githubExpandedAll={githubExpandedAll}
          onToggleGithubInsights={handleToggleGithubInsights}
          githubAnyInsightLoading={githubRepos.some((r) => githubInsightLoading[r.id])}
        />

        {showStatsBar && <div className="stats-bar">
          {nav === 'all' && <><div className="stat-item"><span className="stat-value">{items.length}</span><span className="stat-label">资讯总数</span></div><div className="stat-item"><span className="stat-value highlight">{filtered.length}</span><span className="stat-label">筛选结果</span></div><div className="stat-item"><span className="stat-value live">{stats.sourceCount - stats.failedSources}</span><span className="stat-label">活跃源</span></div></>}
          {nav === 'trending' && <><div className="stat-item"><span className="stat-value highlight">{trendingItems.length}</span><span className="stat-label">热门榜单</span></div><div className="stat-item"><span className="stat-value live">热门</span><span className="stat-label">全网热搜</span></div></>}
          {nav === 'github' && <><div className="stat-item"><span className="stat-value highlight">{githubRepos.length}</span><span className="stat-label">热门项目</span></div><div className="stat-item"><span className="stat-value live">{GITHUB_PERIODS.find(p => p.id === githubSince)?.label || '周榜'}</span><span className="stat-label">当前榜单</span></div></>}
          {nav === 'reading-list' && <><div className="stat-item"><span className="stat-value highlight">{bookmarks.length}</span><span className="stat-label">收藏总数</span></div><div className="stat-item"><span className="stat-value live">{bookmarks.filter(b => !b.isRead).length}</span><span className="stat-label">未读</span></div></>}
          {nav === 'calendar' && <><div className="stat-item"><span className="stat-value highlight">{events.length}</span><span className="stat-label">日程事件</span></div></>}
          {nav === 'recommendations' && <><div className="stat-item"><span className="stat-value highlight">{filtered.length}</span><span className="stat-label">推荐内容</span></div><div className="stat-item"><span className="stat-value live">{selectedInterests.length}</span><span className="stat-label">兴趣领域</span></div></>}
          <div className="stat-item time">{ICONS.clock}<span>{stats.updatedAt ? formatTime(stats.updatedAt) : '--'}</span></div>
          <button className="panel-toggle" onClick={() => setPanelCollapsed(c => !c)}>{panelCollapsed ? ICONS.chevronLeft : ICONS.chevronRight}</button>
        </div>}

        <div className={`feed custom-scrollbar ${(nav === 'home' || nav === 'recommendations') ? 'feed-workbench' : ''} ${nav === 'stock' ? 'feed-stock' : ''} ${nav === 'canvas' ? 'feed-canvas' : ''}`} ref={feedRef}>
          {nav === 'home' && (
            <AiChatPanel
              variant="main"
              llmConfig={llmConfig}
              intelligenceProfile={intelligenceProfile}
              workflowOptions={workflowComposerOptions}
              workbenchItems={workbenchItems}
              selectedInterests={selectedInterests}
              categories={categories}
              allLlmModels={allLlmModels}
              onOpenLlmConfig={() => setShowLlmQuickConfig(true)}
              pendingMessage={copilotPendingMessage}
              onMessageSent={() => setCopilotPendingMessage('')}
              intelligenceContext={{
                date: selectedNewsDate,
                briefing: algorithmBriefing,
                items: [...externalIntelligenceItems, ...recommendationLanes.public, ...recommendationLanes.personal].slice(0, 16),
              }}
              onOpenNewspaper={() => setShowNewspaperOverlay(true)}
              todayBriefing={todayBriefing}
              todayLanes={todayLanes}
              materials={materials}
              toggleMaterial={toggleMaterial}
              addManualMaterial={addManualMaterial}
              agent={agents.find(a => a.id === currentAgent) || agents[0]}
              agents={agents}
              onUpdateAgent={updateAgent}
              siliconstreamPersona={siliconstreamPersona}
              onUpdateSiliconstreamPersona={setSiliconstreamPersona}
              setLlmConfig={setLlmConfig}
            />
          )}

          {nav === 'studio' && renderMaterialsRepo()}

          {nav === 'canvas' && (
            <Suspense fallback={<div className="empty-state"><p>加载工作流画布...</p></div>}>
            <CanvasPage
              draft={agentWorkflowDraft}
              updateDraft={updateWorkflowDraft}
              llmConfig={llmConfig}
              deleteTemplate={deleteWorkflowTemplate}
              selectedNodeId={selectedWorkflowNodeId}
              setSelectedNodeId={setSelectedWorkflowNodeId}
              selectedNode={selectedWorkflowNode}
              nodeTypeMeta={workflowTypeMeta}
              updateNode={updateWorkflowNode}
              removeNode={removeWorkflowNode}
              addNode={addWorkflowNode}
              moveNode={moveWorkflowNode}
              templates={workflowTemplates}
              saveAsTemplate={(payload) => saveWorkflowAsTemplate(payload)}
              resetDraft={resetWorkflowDraft}
              renameWorkflow={renameWorkflow}
              duplicateWorkflow={duplicateWorkflow}
              createWorkflow={createWorkflow}
              switchTemplate={switchWorkflowTemplate}
              activeWorkflowId={activeWorkflowId}
              onExportDeliverable={(title, content) => {
                addManualMaterial({
                  title: String(title || '画布模拟成果').slice(0, 80),
                  content,
                  fullContent: content,
                  type: 'analysis',
                  source: '无限画布',
                  url: '',
                  tags: '无限画布,模拟运行,工作流',
                  note: '来自无限画布模拟运行的最终成果。',
                  spaceId: null,
                });
                showToast('模拟成果已存入素材库');
              }}
            />
            </Suspense>
          )}

          {/* ALL NEWS */}
          {nav === 'all' && (
            <NewsPage
              key="all"
              eventClusters={eventClusters}
              discoverMeta={discoverFeed?.meta || null}
              category={category}
              mode={mode}
              query={query}
              expandedEvents={expandedEvents}
              setExpandedEvents={setExpandedEvents}
              viewMode={viewMode}
              focusedIndex={focusedIndex}
              filtered={filtered}
              loading={loading}
              error={error}
              allFeedItems={allFeedItems}
              allActiveFilters={allActiveFilters}
              items={items}
              renderLimit={renderLimit}
              expandedSummary={expandedSummary}
              summaryLoading={summaryLoading}
              followKeywords={followKeywords}
              translationOpen={translationOpen}
              translatingItems={translatingItems}
              newsHasMore={newsHasMore}
              loadingMore={loadingMore}
              getSummaryEntry={getSummaryEntry}
              isBookmarked={isBookmarked}
              isInMaterials={isInMaterials}
              toggleBookmark={toggleBookmark}
              toggleMaterial={toggleMaterial}
              handleSummaryToggle={handleSummaryToggle}
              clearAllFilters={clearAllFilters}
              loadNews={loadNews}
              recordReading={recordReading}
              requestTranslation={requestTranslation}
              getTranslation={getTranslation}
              setLightbox={setLightbox}
              setTranslationOpen={setTranslationOpen}
              onShareToChat={shareNewsToChat}
            />
          )}

          {/* TRENDING */}
          {nav === 'trending' && (
            <Suspense fallback={<div className="empty-state"><p>加载热点趋势...</p></div>}>
              <TrendingPage key="trending" viewMode={viewMode} trendingLoading={trendingLoading} trendingItems={trendingItems} isBookmarked={isBookmarked} isInMaterials={isInMaterials} toggleBookmark={toggleBookmark} toggleMaterial={toggleMaterial} setLightbox={setLightbox} translationOpen={translationOpen} setTranslationOpen={setTranslationOpen} requestTranslation={requestTranslation} translatingItems={translatingItems} getTranslation={getTranslation} trendingLoadingMore={trendingLoadingMore} trendingHasMore={trendingHasMore} loadTrending={loadTrending} trendingPlatform={trendingPlatform} trendingType={trendingType} onShareToChat={shareNewsToChat} />
            </Suspense>
          )}

          {/* SMART RECOMMENDATIONS - 当日满足用户关注/画像的资讯卡片流（右栏竖向时间线见 panel） */}
          {nav === 'recommendations' && (
            <Suspense fallback={<div className="empty-state"><p>加载精准推荐...</p></div>}>
            <RecommendationsPage
              externalIntelligenceItems={externalIntelligenceItems}
              externalIntelligenceOpportunities={externalIntelligenceOpportunities}
              externalIntelligenceWeeklySectors={externalIntelligenceWeeklySectors}
              externalIntelligenceAlerts={externalIntelligenceAlerts}
              externalIntelligenceLoading={externalIntelligenceLoading}
              externalIntelligenceError={externalIntelligenceError}
              externalIntelligenceUpdatedAt={externalIntelligenceUpdatedAt}
              loadExternalIntelligence={loadExternalIntelligence}
              displayRecommendationLanes={displayRecommendationLanes}
              loading={loading}
              error={error}
              isLoggedIn={isLoggedIn}
              selectedInterests={selectedInterests}
              categories={categories}
              renderLimit={renderLimit}
              viewMode={viewMode}
              recommendationCandidates={recommendationCandidates}
              selectedRecommendationSnapshot={selectedRecommendationSnapshot}
              loadMoreNews={loadMoreNews}
              loadingMore={loadingMore}
              newsHasMore={newsHasMore}
              loadNews={loadNews}
              setShowInterestModal={setShowInterestModal}
              setAuthMode={setAuthMode}
              setShowAuthModal={setShowAuthModal}
              focusedIndex={focusedIndex}
              expandedSummary={expandedSummary}
              summaryLoading={summaryLoading}
              translationOpen={translationOpen}
              translatingItems={translatingItems}
              followKeywords={followKeywords}
              getSummaryEntry={getSummaryEntry}
              isBookmarked={isBookmarked}
              isInMaterials={isInMaterials}
              toggleBookmark={toggleBookmark}
              toggleMaterial={toggleMaterial}
              handleSummaryToggle={handleSummaryToggle}
              recordReading={recordReading}
              getTranslation={getTranslation}
              requestTranslation={requestTranslation}
              setTranslationOpen={setTranslationOpen}
              setLightbox={setLightbox}
              onShareToChat={shareNewsToChat}
            />
            </Suspense>
          )}
          {/* recommendations-legacy 已删除（死代码，无导航入口） */}

          {/* GITHUB */}
          {nav === 'github' && (
            <Suspense fallback={<div className="empty-state"><p>加载 GitHub 情报...</p></div>}>
            <GithubPage
              githubSince={githubSince}
              githubLoading={githubLoading}
              githubRepos={githubRepos}
              isBookmarked={isBookmarked}
              isInMaterials={isInMaterials}
              toggleBookmark={toggleBookmark}
              toggleMaterial={toggleMaterial}
              githubInsights={githubInsights}
              requestGithubInsight={requestGithubInsight}
              githubInsightLoading={githubInsightLoading}
              setLightbox={setLightbox}
              expandedAll={githubExpandedAll}
            />
            </Suspense>
          )}

          {nav === 'stock' && (
            <SafeBoundary name="股市终端" icon={ICONS.cpu}>
              <Suspense fallback={<div className="empty-state"><p>加载股市终端...</p></div>}>
                <StockPage llmConfig={llmConfig} onOpenLlmConfig={() => setShowLlmQuickConfig(true)} onArchiveMaterial={addManualMaterial} />
              </Suspense>
            </SafeBoundary>
          )}

          {nav === 'square' && (
            <SafeBoundary name="社区广场" icon={ICONS.chat}>
              <Suspense fallback={<div className="empty-state"><p>加载社区广场...</p></div>}>
                <CommunityPage user={user} materials={materials} onRequireAuth={() => { setAuthMode('login'); setShowAuthModal(true); }} onShareToChat={share => { setPendingChatShare(share); setNav('chat'); }} />
              </Suspense>
            </SafeBoundary>
          )}

          {nav === 'chat' && <ChatPage user={user} pendingShare={pendingChatShare} onConsumeShare={() => setPendingChatShare(null)} onRequireAuth={() => { setAuthMode('login'); setShowAuthModal(true); }} onOpenPost={postId => { try { window.history.replaceState({}, '', `/?post=${encodeURIComponent(postId)}`); } catch { /* 忽略 */ } setNav('square'); }} />}

          {nav === 'profile-center' && (
            <Suspense fallback={<div className="empty-state"><p>加载画像中心...</p></div>}>
            <ProfilePage
              intelligenceProfile={intelligenceProfile}
              bookmarks={bookmarks}
              readingHistory={readingHistory}
              dailyProfileSnapshots={dailyProfileSnapshots}
              profileLearningEngine={profileLearningEngine}
              profilePriorityItems={profilePriorityItems}
              setDomainTiers={setDomainTiers}
              sourcePriorityItems={sourcePriorityItems}
              setSourceTiers={setSourceTiers}
              addCustomDomain={addProfileCustomDomain}
              removeCustomDomain={removeProfileCustomDomain}
              addCustomSource={addProfileCustomSource}
              removeCustomSource={removeProfileCustomSource}
              specialFollows={specialFollows}
              setSpecialFollows={setSpecialFollows}
              specialFollowForm={specialFollowForm}
              setSpecialFollowForm={setSpecialFollowForm}
              editingSpecialFollowId={editingSpecialFollowId}
              setEditingSpecialFollowId={setEditingSpecialFollowId}
              profileCalibrationCards={profileCalibrationCards}
              generateDailyProfileSnapshot={generateDailyProfileSnapshot}
              setShowInterestModal={setShowInterestModal}
              selectedInterests={selectedInterests}
              user={user}
              categories={categories}
              materials={materials}
            />
            </Suspense>
          )}

          {/* READING LIST - 阅读列表 */}
          {nav === 'reading-list' && (
            <Suspense fallback={<div className="empty-state"><p>加载阅读列表...</p></div>}><ReadingListPage
              bookmarks={bookmarks}
              categories={categories}
              toggleRead={toggleRead}
              setBookmarks={setBookmarks}
            /></Suspense>
          )}

          {/* CUSTOM URL - 自定义抓取 */}
          {nav === 'custom-url' && (
            <CustomUrlPage
              onSaveToArticle={(article) => {
                setArticles(prev => [article, ...prev]);
                setCurrentArticleId(article.id);
                setNav('editor');
              }}
              onSaveToMaterial={(material) => {
                setMaterials(prev => [material, ...prev]);
                setNav('materials');
              }}
            />
          )}

          {/* CALENDAR - 日历管理 */}
          {nav === 'calendar' && (
            <CalendarPage
              events={events}
              setEvents={setEvents}
              removeEvent={removeEvent}
              showEventForm={showEventForm}
              setShowEventForm={setShowEventForm}
            />
          )}

          {/* MONITOR - 竞争情报监测（M5） */}
          {nav === 'monitor' && (
            <Suspense fallback={<div className="empty-state"><p>加载监测面板...</p></div>}><MonitorPage items={items} /></Suspense>
          )}


          {nav === 'materials' && renderMaterialsRepo()}
          <AddMaterialModal showAddMaterial={showAddMaterial} setShowAddMaterial={setShowAddMaterial} addManualMaterial={addManualMaterial} materialSpaces={materialSpaces} />

{nav === 'editor' && <ArticleEditor editorFullscreen={editorFullscreen} setEditorFullscreen={setEditorFullscreen} editorTextareaRef={editorTextareaRef} imageInputRef={imageInputRef} articles={articles} setArticles={setArticles} currentArticleId={currentArticleId} setCurrentArticleId={setCurrentArticleId} editorTab={editorTab} setEditorTab={setEditorTab} editorCursorPos={editorCursorPos} setEditorCursorPos={setEditorCursorPos} showTemplateMenu={showTemplateMenu} setShowTemplateMenu={setShowTemplateMenu} showAiPanel={showAiPanel} setShowAiPanel={setShowAiPanel} showImagePanel={showImagePanel} setShowImagePanel={setShowImagePanel} aiResult={aiResult} setAiResult={setAiResult} aiCustomPrompt={aiCustomPrompt} setAiCustomPrompt={setAiCustomPrompt} autoSaveTimer={autoSaveTimer} setAutoSaveTimer={setAutoSaveTimer} lastSavedAt={lastSavedAt} setLastSavedAt={setLastSavedAt} articleTagInput={articleTagInput} setArticleTagInput={setArticleTagInput} editingArticleTag={editingArticleTag} setEditingArticleTag={setEditingArticleTag} articleSpaces={articleSpaces} setArticleSpaces={setArticleSpaces} materialSpaces={materialSpaces} setMaterialSpaces={setMaterialSpaces} articleSpaceFilter={articleSpaceFilter} setArticleSpaceFilter={setArticleSpaceFilter} articleMaterialSpaceFilter={articleMaterialSpaceFilter} setArticleMaterialSpaceFilter={setArticleMaterialSpaceFilter} articleSpaceFormOpen={articleSpaceFormOpen} setArticleSpaceFormOpen={setArticleSpaceFormOpen} newArticleSpaceName={newArticleSpaceName} setNewArticleSpaceName={setNewArticleSpaceName} articleSpaceForNewArticle={articleSpaceForNewArticle} setArticleSpaceForNewArticle={setArticleSpaceForNewArticle} articleSearch={articleSearch} setArticleSearch={setArticleSearch} articleStatusFilter={articleStatusFilter} setArticleStatusFilter={setArticleStatusFilter} articleTemplateFilter={articleTemplateFilter} setArticleTemplateFilter={setArticleTemplateFilter} articleSort={articleSort} setArticleSort={setArticleSort} filteredArticles={filteredArticles} articleExportFilter={articleExportFilter} setArticleExportFilter={setArticleExportFilter} createArticle={createArticle} updateArticle={updateArticle} deleteArticle={deleteArticle} duplicateArticle={duplicateArticle} addArticleTag={addArticleTag} removeArticleTag={removeArticleTag} triggerAutoSave={triggerAutoSave} handleContentChange={handleContentChange} handleTitleChange={handleTitleChange} insertAtCursor={insertAtCursor} insertMaterialAtCursor={insertMaterialAtCursor} removeLinkedMaterial={removeLinkedMaterial} handleImageUpload={handleImageUpload} handlePaste={handlePaste} createArticleSpace={createArticleSpace} deleteArticleSpace={deleteArticleSpace} assignArticleToSpace={assignArticleToSpace} batchAssignArticlesToSpace={batchAssignArticlesToSpace} insertAiResult={insertAiResult} clearAiResult={clearAiResult} exportArticleToFile={exportArticleToFile} copyArticleAsRichText={copyArticleAsRichText} onPublishToSquare={publishArticleToSquare} publishingToSquare={publishingToSquare} workspace={creativeWorkspace} materials={materials} llmConfig={llmConfig} />}

          <ArticleSpaceModal articleSpaceFormOpen={articleSpaceFormOpen} setArticleSpaceFormOpen={setArticleSpaceFormOpen} newArticleSpaceName={newArticleSpaceName} setNewArticleSpaceName={setNewArticleSpaceName} createArticleSpace={createArticleSpace} />

          {nav === 'knowledge-export' && (
            <Suspense fallback={<div className="empty-state"><p>加载知识导出...</p></div>}><KnowledgeExportPage
              articles={filteredExportArticles}
              bookmarks={exportFilteredBookmarks}
              articleExportFilter={articleExportFilter}
              setArticleExportFilter={setArticleExportFilter}
              exportCategory={exportCategory}
              setExportCategory={setExportCategory}
              exportRange={exportRange}
              setExportRange={setExportRange}
              categories={categories}
              exportArticle={exportArticle}
            /></Suspense>
          )}

          {/* Event Form Modal */}
          <EventFormModal showEventForm={showEventForm} setShowEventForm={setShowEventForm} setEvents={setEvents} />
        </div>

        {/* Copilot — AI 情报与每日速报共享同一段有界证据上下文 */}
      </main>

      {/* 今日速报抽屉：从右侧滑入，点遮罩或 ✕ 关闭 */}
      <NewspaperOverlay showNewspaperOverlay={showNewspaperOverlay} setShowNewspaperOverlay={setShowNewspaperOverlay} todayBriefing={todayBriefing} todayLanes={newspaperLanes} recommendationCandidates={recommendationCandidates} loading={loading} loadNews={loadNews} goNav={goNav} recordReading={recordReading} toggleMaterial={toggleMaterial} recommendationSnapshots={recommendationSnapshots} selectedNewsDate={selectedNewsDate} setSelectedNewsDate={setSelectedNewsDate} translations={translations} translationOpen={translationOpen} setTranslationOpen={setTranslationOpen} translatingItems={translatingItems} requestTranslation={requestTranslation} isEnglishText={isEnglishText} intelligenceBriefing={intelligenceBriefing} />

      {/* Right Panel */}
<RightPanel showRightPanel={showRightPanel} panelCollapsed={panelCollapsed} nav={nav} recommendationSnapshots={recommendationSnapshots} selectedNewsDate={selectedNewsDate} setSelectedNewsDate={setSelectedNewsDate} loading={loading} loadNews={loadNews} followKeywords={followKeywords} sortedFollowKeywords={sortedFollowKeywords} matchCountPerKeyword={matchCountPerKeyword} pinnedKeywords={pinnedKeywords} pinFollowKeyword={pinFollowKeyword} unpinFollowKeyword={unpinFollowKeyword} removeFollowKeyword={removeFollowKeyword} newKeyword={newKeyword} setNewKeyword={setNewKeyword} addFollowKeyword={addFollowKeyword} hotTags={hotTags} executeSearch={executeSearch} items={items} setGlobeFullscreenOpen={setGlobeFullscreenOpen} followKeywordUpdates={followKeywordUpdates} todayMustRead={todayMustRead} selectedInterests={selectedInterests} aiInsights={aiInsights} fetchAiInsights={fetchAiInsights} llmConfig={llmConfig} setShowLlmQuickConfig={setShowLlmQuickConfig} llmTesting={llmTesting} />

      {/* Settings Modal */}
      {/* Lightbox */}
      <Lightbox lightbox={lightbox} setLightbox={setLightbox} />
      <NewsPreviewPanel />

      {showSettings && (
        <SettingsModal
          settingsTab={settingsTab}
          setSettingsTab={setSettingsTab}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          stats={stats}
          blocked={blocked}
          setBlocked={setBlocked}
          allSources={allSources}
          customSources={customSources}
          setCustomSources={setCustomSources}
          disabledSources={disabledSources}
          setDisabledSources={setDisabledSources}
          sourceGrades={sourceGrades}
          sourceHealth={sourceHealth}
          setSourceHealth={setSourceHealth}
          newSource={newSource}
          setNewSource={setNewSource}
          editingSource={editingSource}
          setEditingSource={setEditingSource}
          showSourceForm={showSourceForm}
          setShowSourceForm={setShowSourceForm}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          customSourceFilter={customSourceFilter}
          setCustomSourceFilter={setCustomSourceFilter}
          regionFilter={regionFilter}
          setRegionFilter={setRegionFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          gradeFilter={gradeFilter}
          setGradeFilter={setGradeFilter}
          sourceTypeTab={sourceTypeTab}
          setSourceTypeTab={setSourceTypeTab}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          addCustomSource={addCustomSource}
          removeCustomSource={removeCustomSource}
          verifySource={verifySource}
          sourceVerifying={sourceVerifying}
          sourceVerifyResult={sourceVerifyResult}
          sourceDiscoveryUrl={sourceDiscoveryUrl}
          setSourceDiscoveryUrl={setSourceDiscoveryUrl}
          sourceDiscoveryState={sourceDiscoveryState}
          discoverSource={discoverSource}
          addDiscoveredSource={addDiscoveredSource}
          verifyAllSources={verifyAllSources}
          verifySingleSource={verifySingleSource}
          exportSources={exportSources}
          importSources={importSources}
          verifyingAllSources={verifyingAllSources}
          allSourcesVerifyResults={allSourcesVerifyResults}
          setAllSourcesVerifyResults={setAllSourcesVerifyResults}
          autoMonitorEnabled={autoMonitorEnabled}
          setAutoMonitorEnabled={setAutoMonitorEnabled}
          monitorInterval={monitorInterval}
          setMonitorInterval={setMonitorInterval}
          monitorAlerts={monitorAlerts}
          showAlertPanel={showAlertPanel}
          setShowAlertPanel={setShowAlertPanel}
          clearAlerts={clearAlerts}
          llmConfig={llmConfig}
          setLlmConfig={setLlmConfig}
          llmModels={llmModels}
          llmFetching={llmFetching}
          llmFetchError={llmFetchError}
          llmTestResult={llmTestResult}
          llmTesting={llmTesting}
          llmManualInput={llmManualInput}
          setLlmManualInput={setLlmManualInput}
          showLlmQuickConfig={showLlmQuickConfig}
          setShowLlmQuickConfig={setShowLlmQuickConfig}
          allLlmModels={allLlmModels}
          fetchLlmModels={fetchLlmModels}
          addManualModel={addManualModel}
          removeManualModel={removeManualModel}
          testLlmConnection={testLlmConnection}
          // 新版 LLM 预设 props（SettingsTab 顶部的模板区 + 我的预设区）
          LLM_PRESETS={LLM_PRESETS}
          llmPresets={llmPresets}
          activePresetId={activePresetId}
          currentPresetId={currentPresetId}
          applyBuiltinTemplate={applyBuiltinTemplate}
          applyUserPreset={applyUserPreset}
          saveAsPreset={saveAsPreset}
          deletePreset={deletePreset}
          savePresetName={savePresetName}
          setSavePresetName={setSavePresetName}
          agents={agents}
          setAgents={setAgents}
          currentAgent={currentAgent}
          setCurrentAgent={setCurrentAgent}
          showAgentForm={showAgentForm}
          setShowAgentForm={setShowAgentForm}
          editingAgent={editingAgent}
          setEditingAgent={setEditingAgent}
          newAgent={newAgent}
          setNewAgent={setNewAgent}
          agentFilter={agentFilter}
          setAgentFilter={setAgentFilter}
          agentPromptRefining={agentPromptRefining}
          setAgentPromptRefining={setAgentPromptRefining}
          elfAvatar={elfAvatar}
          setElfAvatar={setElfAvatar}
          elfAvatarHistory={elfAvatarHistory}
          setElfAvatarHistory={setElfAvatarHistory}
          elfName={elfName}
          setElfName={setElfName}
          formatRelative={formatRelative}
          loadNews={loadNews}
        />
      )}

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        navItems={primaryNavItems}
        onNavigate={(navId) => goNav(navId)}
        onSearch={(q) => executeSearch(q)}
        recentVisits={recentVisits}
        actions={[
          { id: 'refresh', label: '刷新资讯', icon: 'refresh', hint: '动作', run: () => loadNews(blocked, false, debouncedQuery, { forceRefresh: true }) },
          { id: 'theme', label: '切换主题', icon: 'palette', hint: '动作', run: () => { setSettingsTab('appearance'); setShowSettings(true); } },
          { id: 'settings', label: '打开设置', icon: 'settings', hint: '动作', run: () => setShowSettings(true) },
          { id: 'repreheat', label: '重新预热今日简报', icon: 'refresh', hint: '动作', run: () => {
            fetch('/api/profile/snapshots/preheat', { method: 'POST', credentials: 'same-origin' })
              .then(r => r.json())
              .then(d => showToast(d?.ok ? '已触发今日简报重新预热' : (d?.error?.message || d?.message || '预热失败')))
              .catch(() => showToast('预热请求失败'));
          } },
          { id: 'tour', label: '重看新手引导 · 功能导览', icon: 'sparkle', hint: '动作', run: () => setTourReplay(true) },
        ]}
      />

      {/* Shortcuts Modal */}
      <ShortcutsModal showShortcuts={showShortcuts} setShowShortcuts={setShowShortcuts} />

      {/* LLM Quick Config Modal */}
      <LlmQuickConfigModal
        showLlmQuickConfig={showLlmQuickConfig}
        setShowLlmQuickConfig={setShowLlmQuickConfig}
        llmConfig={llmConfig}
        setLlmConfig={setLlmConfig}
        allLlmModels={allLlmModels}
        fetchLlmModels={fetchLlmModels}
        llmFetching={llmFetching}
        llmFetchError={llmFetchError}
        llmTestResult={llmTestResult}
        llmTesting={llmTesting}
        testLlmConnection={testLlmConnection}
        llmManualInput={llmManualInput}
        setLlmManualInput={setLlmManualInput}
        addManualModel={addManualModel}
        removeManualModel={removeManualModel}
        llmPresets={llmPresets}
        activePresetId={activePresetId}
        currentPresetId={currentPresetId}
        applyBuiltinTemplate={applyBuiltinTemplate}
        applyUserPreset={applyUserPreset}
        saveAsPreset={saveAsPreset}
        deletePreset={deletePreset}
        savePresetName={savePresetName}
        setSavePresetName={setSavePresetName}
      />

      {/* 首跑引导（B2 首跑引导）：首次访问展示，完成后写入 localStorage 标记不再出现；tourReplay 支持从命令面板重看 */}
      <OnboardingFlow
        show={!onboarded || tourReplay}
        replay={tourReplay}
        onFinish={() => { if (tourReplay) setTourReplay(false); finishOnboarding(); }}
        categories={categories}
        CATEGORY_GROUPS={CATEGORY_GROUPS}
        selectedInterests={selectedInterests}
        setSelectedInterests={setSelectedInterests}
        llmConfig={llmConfig}
        setLlmConfig={setLlmConfig}
        applyBuiltinTemplate={applyBuiltinTemplate}
        LLM_PRESETS={LLM_PRESETS}
        fetchLlmModels={fetchLlmModels}
        allLlmModels={allLlmModels}
        llmFetching={llmFetching}
        llmFetchError={llmFetchError}
        llmTestResult={llmTestResult}
        llmTesting={llmTesting}
        testLlmConnection={testLlmConnection}
        goNav={goNav}
      />

      {/* 进场动画（水墨开卷）：每次加载播放一次，播完淡出卸载，与首跑引导互不冲突 */}
      {showSplash && (
        <EntranceSplash
          onReveal={() => setEntered(true)}
          onDone={() => setShowSplash(false)}
        />
      )}

      {/* Back to Top */}
      <button className={`back-to-top ${showBackToTop ? 'visible' : ''}`} onClick={scrollToTop} title="回到顶部">
        {ICONS.chevronLeft ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg> : ICONS.chevronUp}
      </button>

      {/* AI精灵助手（去 agent 化：全站轻量助理，只接收画像/上下文，不再接智能体生态）
          无限画布页隐藏：画布是全屏独占形态，浮动头像会遮挡 AI 搭建面板的操作区 */}
      <div className={`ai-elf-slot${nav === 'canvas' ? ' is-hidden' : ''}`}>
      <SafeBoundary name="AI 精灵" icon={ICONS.bot}>
      <Suspense fallback={null}>
      <AiElf
        llmConfig={llmConfig}
        avatarImage={elfAvatar}
        elfName={elfName}
        externalQuotedContext={elfQuotedContext}
        intelligenceProfile={intelligenceProfile}
        onContinueInWorkbench={(payload, savedMaterial) => {
          const material = savedMaterial || addManualMaterial({
            title: String(payload.title || 'AI 精灵研究记录').slice(0, 100),
            content: String(payload.content || '').slice(0, 5000),
            fullContent: payload.fullContent || payload.content || '',
            type: payload.type || 'viewpoint',
            source: payload.source || 'AI 精灵',
            url: payload.url || '',
            tags: payload.tags || ['AI精灵', 'AI工作站'],
            note: payload.note || '由 AI 精灵保存，可在 AI 工作站继续研究。',
            spaceId: payload.spaceId || null,
            imageUrl: payload.imageUrl || '',
            insight: payload.insight || null,
            metadata: payload.metadata || null
          });
          setMaterialSearch(material.title || payload.title || '');
          setMaterialFilter('all');
          setMaterialSourceFilter('all');
          setMaterialSpaceFilter('all');
          if (material.id) setSelectedMaterials([material.id]);
          setCopilotPendingMessage([
            `请基于刚从 AI 精灵保存的研究素材继续深化：${material.title || payload.title}`,
            '',
            '【素材内容】',
            String(material.fullContent || material.content || payload.fullContent || payload.content || '').slice(0, 3500),
            '',
            '请输出：1）核心判断 2）仍需验证的证据 3）下一步研究清单 4）可沉淀为文章的结构。'
          ].join('\n'));
          goNav('home');
          showToast('已转入 AI 工作站继续研究');
        }}
        onExportToMaterials={(data) => {
        return addManualMaterial({
          title: String(data.title || 'AI 精灵分析素材').slice(0, 100),
          content: String(data.content || '').slice(0, 5000),
          fullContent: data.fullContent || data.content || '',
          type: data.type || 'analysis',
          source: data.source || 'AI精灵',
          url: data.url || '',
          tags: data.tags || ['AI分析', 'AI精灵'],
          note: data.note || '',
          spaceId: data.spaceId || null,
          imageUrl: data.imageUrl || '',
          insight: data.insight || null,
          metadata: data.metadata || null
        });
      }} />
      </Suspense>
      </SafeBoundary>
      </div>

      {/* v23 #1：划词翻译（全局选区监听，气泡返回翻译+解释，可转交精灵） */}
      <SafeBoundary name="划词翻译" icon={ICONS.globe}>
        <Suspense fallback={null}>
          <SelectionTranslate llmConfig={llmConfig} />
        </Suspense>
      </SafeBoundary>

      {/* 登录/注册弹窗 */}
<AuthModal showAuthModal={showAuthModal} setShowAuthModal={setShowAuthModal} authMode={authMode} setAuthMode={setAuthMode} authForm={authForm} setAuthForm={setAuthForm} handleLogin={handleLogin} handleRegister={handleRegister} handleGuestLogin={handleGuestLogin} authLoading={authLoading} authError={authError} setAuthError={setAuthError} />

      {/* 个人资料弹窗 */}
      <ProfileModal showProfileModal={showProfileModal} setShowProfileModal={setShowProfileModal} user={user} setUser={setUser} profileForm={profileForm} setProfileForm={setProfileForm} selectedInterests={selectedInterests} categories={categories} updateUserProfile={updateUserProfile} setShowInterestModal={setShowInterestModal} setShowUserMenu={setShowUserMenu} handleLogout={handleLogout} showToast={showToast} />

      {/* 兴趣选择弹窗 */}
<InterestModal showInterestModal={showInterestModal} setShowInterestModal={setShowInterestModal} selectedInterests={selectedInterests} setSelectedInterests={setSelectedInterests} categories={categories} CATEGORY_GROUPS={CATEGORY_GROUPS} updateUserInterests={updateUserInterests} />

      {/* 全球科技大屏全屏 */}
      {globeFullscreenOpen && (
        <SafeBoundary name="全球科技大屏" icon={ICONS.globe}>
          <Suspense fallback={<div className="page-loading-skeleton" />}>
            <GlobeView items={items} externalFullscreen={globeFullscreenOpen} onFullscreenChange={setGlobeFullscreenOpen} />
          </Suspense>
        </SafeBoundary>
      )}
    </div>
  );

  // source 相关函数（addCustomSource/removeCustomSource/truncateUrl/truncateText/
  // getSourceHealthIndicator/verifySingleSource/exportSources/importSources/clearAlerts）
  // 及自动监控/健康检查 useEffect 已移至 useSourceManager

  // fetchCustomUrl moved to useCustomUrl

}

export default App;
