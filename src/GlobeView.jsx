/**
 * GlobeView — 全球科技资讯态势大屏（v26：MapLibre 卫星地球）
 *
 * 架构：
 * - 真实卫星地球（MapLibre GL globe 投影 + ESRI World Imagery 流式瓦片）：
 *   拖拽旋转 + 滚轮缩放最高 z18（卫星/街区级）+ 闲置自动巡航（贴地暂停防晕）
 * - 资讯点位：MapLibre 官方 DOM Marker（发光核心 + 双层扩散波纹 + 计数徽标 + 城市名），
 *   按真实经纬度标注，命中测试原生可靠，地球背面由引擎自动遮挡
 * - 点位点击 → 锚定式小弹窗（rAF 跟随 marker DOM 位置、背面自动隐藏、上下翻转）
 *   → 点击资讯 → 内联内容预览窗（正文直读，访问不了才查看原文）
 * - 氛围：星空粒子 canvas（闪烁、隐藏页暂停）、大气辉光（setSky）、旋转雷达光环、扫描线、
 *   暗角、发光角框
 * - 布局：全屏指挥中心（顶部命令条/左右数据面板/底部时间轴/点击点位滑出详情）；
 *   嵌入模式为深色太空舱窗，与宿主页面主题解耦
 *
 * 数据：items（资讯）按来源→城市坐标聚合；纯展示层，业务提交走回调。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Map as MapLibreMap, Marker as MapLibreMarker, NavigationControl, LngLat } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/* ============ 地理数据：来源 → 城市（真实经纬度） ============ */

const SOURCE_CITY_MAP = {
  '36kr': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '极客公园': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '虎嗅': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '钛媒体': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '爱范儿': { city: '广州', lat: 23.1291, lng: 113.2644 },
  '量子位': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '机器之心': { city: '北京', lat: 39.9042, lng: 116.4074 },
  'InfoQ': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '雷锋网': { city: '深圳', lat: 22.5431, lng: 114.0579 },
  '深圳特区报': { city: '深圳', lat: 22.5431, lng: 114.0579 },
  '浙江在线': { city: '杭州', lat: 30.2741, lng: 120.1551 },
  '上海科技报': { city: '上海', lat: 31.2304, lng: 121.4737 },
  '澎湃新闻': { city: '上海', lat: 31.2304, lng: 121.4737 },
  '财联社': { city: '上海', lat: 31.2304, lng: 121.4737 },
  '新浪科技': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '网易科技': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '搜狐科技': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '腾讯科技': { city: '深圳', lat: 22.5431, lng: 114.0579 },
  '阿里巴巴': { city: '杭州', lat: 30.2741, lng: 120.1551 },
  '华为': { city: '深圳', lat: 22.5431, lng: 114.0579 },
  '小米': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '字节跳动': { city: '北京', lat: 39.9042, lng: 116.4074 },
  '百度': { city: '北京', lat: 39.9042, lng: 116.4074 },
  'TechCrunch': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'The Verge': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'Wired': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'Ars Technica': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'Engadget': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'CNET': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'Reuters': { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  'BBC': { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  'Bloomberg': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'MIT Technology Review': { city: '波士顿', lat: 42.3601, lng: -71.0589 },
  'Nature': { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  'IEEE Spectrum': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'VentureBeat': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'ZDNet': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'Forbes': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'Hacker News': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'GitHub Blog': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'OpenAI Blog': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'Anthropic': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'Google AI Blog': { city: '山景城', lat: 37.3861, lng: -122.0839 },
  'DeepMind': { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  'Meta AI': { city: '门洛帕克', lat: 37.4530, lng: -122.1817 },
  'Hugging Face': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'Apple Newsroom': { city: '库比蒂诺', lat: 37.3230, lng: -122.0322 },
  'Microsoft Blog': { city: '西雅图', lat: 47.6062, lng: -122.3321 },
  'Amazon Web Services': { city: '西雅图', lat: 47.6062, lng: -122.3321 },
  'NVIDIA Blog': { city: '圣克拉拉', lat: 37.3541, lng: -121.9552 },
  'The Information': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'CNBC': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'Financial Times': { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  'The Economist': { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  'Slashdot': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'ArXiv': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'TechRadar': { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  'Android Police': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  '9to5Mac': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'MacRumors': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'Android Central': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'XDA Developers': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'Phoronix': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'LWN': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'DistroWatch': { city: '纽约', lat: 40.7128, lng: -74.0060 },
  'SCMP': { city: '中国香港', lat: 22.3193, lng: 114.1694 },
  'Nikkei Asia': { city: '东京', lat: 35.6895, lng: 139.6917 },
  'TechCrunch Japan': { city: '东京', lat: 35.6895, lng: 139.6917 },
  'The Korea Herald': { city: '首尔', lat: 37.5665, lng: 126.9780 },
  'default-domestic': { city: '北京', lat: 39.9042, lng: 116.4074 },
  'default-overseas': { city: '旧金山', lat: 37.7749, lng: -122.4194 },
  'default-global': { city: '新加坡', lat: 1.3521, lng: 103.8198 },
};

/* ============ v26.1 内容级地理提取：资讯正文里的城市场景 → 真实经纬度 ============
 * 判定链：标题命中（最高优先）→ 正文前 400 字命中 → 来源→城市映射兜底（getCityFromSource）。
 * 这样「36kr 报道成都的融资事件」会落在成都，而不是所有条目都堆在来源注册地。 */
const CITY_COORDS = (() => {
  const map = {};
  Object.values(SOURCE_CITY_MAP).forEach(({ city, lat, lng }) => { if (city && !map[city]) map[city] = { lat, lng }; });
  Object.assign(map, {
    杭州: { lat: 30.2741, lng: 120.1551 }, 武汉: { lat: 30.5928, lng: 114.3055 },
    成都: { lat: 30.5728, lng: 104.0668 }, 西安: { lat: 34.3416, lng: 108.9398 },
    南京: { lat: 32.0603, lng: 118.7969 }, 合肥: { lat: 31.8206, lng: 117.2272 },
    重庆: { lat: 29.5630, lng: 106.5516 }, 天津: { lat: 39.3434, lng: 117.3616 },
    长沙: { lat: 28.2282, lng: 112.9388 }, 苏州: { lat: 31.2989, lng: 120.5853 },
    香港: { lat: 22.3193, lng: 114.1694 }, 台北: { lat: 25.0330, lng: 121.5654 },
    西雅图: { lat: 47.6062, lng: -122.3321 }, 奥斯汀: { lat: 30.2672, lng: -97.7431 },
    巴黎: { lat: 48.8566, lng: 2.3522 }, 柏林: { lat: 52.5200, lng: 13.4050 },
    慕尼黑: { lat: 48.1351, lng: 11.5820 }, 苏黎世: { lat: 47.3769, lng: 8.5417 },
    阿姆斯特丹: { lat: 52.3676, lng: 4.9041 }, 斯德哥尔摩: { lat: 59.3293, lng: 18.0686 },
    都柏林: { lat: 53.3498, lng: -6.2603 }, 特拉维夫: { lat: 32.0853, lng: 34.7818 },
    班加罗尔: { lat: 12.9716, lng: 77.5946 }, 迪拜: { lat: 25.2048, lng: 55.2708 },
    多伦多: { lat: 43.6532, lng: -79.3832 }, 悉尼: { lat: -33.8688, lng: 151.2093 },
  });
  return map;
})();

// 城市匹配关键词（中文/英文/别名/地标），数组顺序即标题扫描优先级
const GEO_KEYWORDS = [
  ['北京', ['北京', 'Beijing', '中关村', '亦庄']],
  ['上海', ['上海', 'Shanghai', '陆家嘴', '张江']],
  ['深圳', ['深圳', 'Shenzhen']],
  ['杭州', ['杭州', 'Hangzhou', '云栖', '西溪园区']],
  ['旧金山', ['旧金山', '三藩', 'San Francisco', '硅谷', 'Silicon Valley', '湾区', 'Bay Area', '帕罗奥图', 'Mountain View', '山景城']],
  ['纽约', ['纽约', 'New York', '曼哈顿', '华尔街', 'Wall Street']],
  ['伦敦', ['伦敦', 'London']],
  ['东京', ['东京', 'Tokyo']],
  ['首尔', ['首尔', 'Seoul']],
  ['新加坡', ['新加坡', 'Singapore']],
  ['香港', ['香港', 'Hong Kong']],
  ['西雅图', ['西雅图', 'Seattle', '雷德蒙德', 'Redmond']],
  ['奥斯汀', ['奥斯汀', 'Austin']],
  ['成都', ['成都', 'Chengdu']], ['武汉', ['武汉', 'Wuhan', '光谷']],
  ['西安', ['西安', "Xi'an"]], ['南京', ['南京', 'Nanjing']],
  ['合肥', ['合肥', 'Hefei']], ['广州', ['广州', 'Guangzhou']],
  ['重庆', ['重庆', 'Chongqing']], ['天津', ['天津', 'Tianjin']],
  ['长沙', ['长沙', 'Changsha']], ['苏州', ['苏州', 'Suzhou']],
  ['台北', ['台北', 'Taipei', '新竹']],
  ['巴黎', ['巴黎', 'Paris']], ['柏林', ['柏林', 'Berlin']], ['慕尼黑', ['慕尼黑', 'Munich']],
  ['苏黎世', ['苏黎世', 'Zurich']], ['阿姆斯特丹', ['阿姆斯特丹', 'Amsterdam']],
  ['斯德哥尔摩', ['斯德哥尔摩', 'Stockholm']], ['都柏林', ['都柏林', 'Dublin']],
  ['特拉维夫', ['特拉维夫', 'Tel Aviv']], ['班加罗尔', ['班加罗尔', 'Bangalore']],
  ['迪拜', ['迪拜', 'Dubai']], ['多伦多', ['多伦多', 'Toronto']],
  ['悉尼', ['悉尼', 'Sydney']], ['莫斯科', ['莫斯科', 'Moscow']],
];

/** 内容级定位：标题优先 → 正文前 400 字兜底；未命中返回 null（调用方回退来源映射） */
function locateItemByContent(item) {
  if (!item) return null;
  const title = item.title || '';
  if (title) {
    for (const [city, kws] of GEO_KEYWORDS) {
      if (kws.some((k) => title.includes(k))) return { city, ...CITY_COORDS[city] };
    }
  }
  const body = `${item.summary || ''} ${item.content || item.fullContent || item.body || ''}`.slice(0, 400);
  if (body) {
    for (const [city, kws] of GEO_KEYWORDS) {
      if (kws.some((k) => body.includes(k))) return { city, ...CITY_COORDS[city] };
    }
  }
  return null;
}

/** 统一入口：内容级定位优先，未命中回退来源→城市映射 */
function resolveItemCity(item) {
  return locateItemByContent(item) || getCityFromSource(item.source, item.region);
}

function getCityFromSource(source, region) {
  if (!source) {
    const key = `default-${region || 'overseas'}`;
    return SOURCE_CITY_MAP[key] || SOURCE_CITY_MAP['default-overseas'];
  }
  if (SOURCE_CITY_MAP[source]) return SOURCE_CITY_MAP[source];
  for (const key of Object.keys(SOURCE_CITY_MAP)) {
    if (source.includes(key) || key.includes(source)) return SOURCE_CITY_MAP[key];
  }
  const key = `default-${region || 'overseas'}`;
  return SOURCE_CITY_MAP[key] || SOURCE_CITY_MAP['default-overseas'];
}

function getRegionFromSource(source) {
  if (!source) return 'overseas';
  const domesticSources = ['36kr', '极客公园', '虎嗅', '钛媒体', '爱范儿', '量子位', '机器之心', 'InfoQ', '雷锋网', '深圳特区报', '浙江在线', '上海科技报', '澎湃新闻', '财联社', '新浪科技', '网易科技', '搜狐科技', '腾讯科技', '阿里巴巴', '华为', '小米', '字节跳动', '百度', 'SCMP'];
  if (domesticSources.some(s => source.includes(s) || s.includes(source))) return 'domestic';
  return 'overseas';
}

function formatTime(publishedAt) {
  if (!publishedAt) return '未知时间';
  const date = new Date(publishedAt);
  const diff = Date.now() - date.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

/* ============ 分类数据 ============ */

const CATEGORY_LABELS = {
  'ai-models': 'AI 大模型', 'research': '科研前沿', 'open-source': '开源生态', 'data-science': '数据科学',
  'quantum': '量子计算', 'cybersecurity': '网络安全', 'chips-compute': '芯片半导体', 'devices': '硬件数码',
  'robotics': '机器人', 'iot-5g': '物联网5G', 'silicon-valley': '硅谷欧美', 'china-tech': '国内大厂',
  'policy-finance': '政策财经', 'fintech': '金融科技', 'space': '太空探索', 'new-energy': '新能源',
  'climate-esg': '气候ESG', 'gaming': '游戏电竞', 'metaverse-xr': '元宇宙XR', 'healthcare': '医疗健康',
  'education-tech': '教育科技', 'agriculture-tech': '农业科技', 'cloud': '云计算', 'automotive': '智能汽车',
};

const CATEGORY_GROUPS = [
  { id: 'tech-frontier', label: '科技前沿', categories: ['ai-models', 'research', 'open-source', 'data-science', 'quantum', 'cybersecurity'] },
  { id: 'hardware-compute', label: '计算硬件', categories: ['chips-compute', 'devices', 'robotics', 'iot-5g'] },
  { id: 'industry-economy', label: '产业经济', categories: ['silicon-valley', 'china-tech', 'policy-finance', 'fintech'] },
  { id: 'emerging-fields', label: '新兴领域', categories: ['space', 'new-energy', 'climate-esg', 'gaming', 'metaverse-xr'] },
  { id: 'industry-apps', label: '行业应用', categories: ['healthcare', 'education-tech', 'agriculture-tech', 'cloud', 'automotive'] },
];

/** 无数据时的待机点位（保证大屏永不空转；badge 仅在 count>0 时显示） */
const STANDBY_POINTS = [
  { city: '北京', lat: 39.9042, lng: 116.4074 }, { city: '深圳', lat: 22.5431, lng: 114.0579 },
  { city: '杭州', lat: 30.2741, lng: 120.1551 }, { city: '上海', lat: 31.2304, lng: 121.4737 },
  { city: '旧金山', lat: 37.7749, lng: -122.4194 }, { city: '西雅图', lat: 47.6062, lng: -122.3321 },
  { city: '纽约', lat: 40.7128, lng: -74.0060 }, { city: '伦敦', lat: 51.5074, lng: -0.1276 },
  { city: '东京', lat: 35.6895, lng: 139.6917 }, { city: '首尔', lat: 37.5665, lng: 126.9780 },
  { city: '新加坡', lat: 1.3521, lng: 103.8198 }, { city: '班加罗尔', lat: 12.9716, lng: 77.5946 },
];

/** 点位热度分级：计数占比 → 颜色（冷青 → 热金） */
const MARKER_LEVELS = [
  { id: 'hot', min: 0.66, color: '#fbbf24', glow: 'rgba(251,191,36,0.55)' },
  { id: 'warm', min: 0.33, color: '#22d3ee', glow: 'rgba(34,211,238,0.55)' },
  { id: 'cool', min: 0, color: '#5eead4', glow: 'rgba(94,234,212,0.45)' },
];
const levelOf = ratio => MARKER_LEVELS.find(l => ratio >= l.min) || MARKER_LEVELS[MARKER_LEVELS.length - 1];

/* ============ 基础 hooks ============ */

/** 视口尺寸（修复旧实现 window.innerWidth 只在 render 时读取的非响应式问题） */
function useViewportSize() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/** 实时时钟（指挥中心氛围） */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="gs-clock">{now.toTimeString().slice(0, 8)}</span>;
}

/** 星空粒子：闪烁星星，页面隐藏时暂停 rAF 省电 */
function StarField() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { canvas.width = canvas.offsetWidth * DPR; canvas.height = canvas.offsetHeight * DPR; };
    resize();
    const stars = Array.from({ length: 220 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.3 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.9 + 0.25,
      tint: Math.random() > 0.86 ? '103,232,249' : '226,232,240',
    }));
    let raf = 0;
    let running = !document.hidden;
    const draw = (t) => {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        const alpha = 0.22 + 0.6 * Math.abs(Math.sin(s.phase + t * 0.0006 * s.speed));
        ctx.beginPath();
        ctx.fillStyle = `rgba(${s.tint},${alpha.toFixed(3)})`;
        ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r * DPR, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const onVisibility = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(draw);
      else cancelAnimationFrame(raf);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', resize);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={canvasRef} className="gs-stars" aria-hidden="true" />;
}

/* ============ 数据聚合 ============ */

function useGlobeData(items) {
  // 按日期与筛选得到的当前数据，聚合为城市点位
  const cityPoints = useMemo(() => {
    const groups = {};
    items.forEach(item => {
      const cityInfo = resolveItemCity(item);
      const key = `${cityInfo.lat}-${cityInfo.lng}`;
      if (!groups[key]) groups[key] = { ...cityInfo, lat: cityInfo.lat, lng: cityInfo.lng, items: [], count: 0 };
      groups[key].items.push(item);
      groups[key].count += 1;
    });
    return Object.values(groups).sort((a, b) => b.count - a.count);
  }, [items]);

  const maxCount = cityPoints[0]?.count || 0;

  /** 大屏点位：最多 20 个城市，避免 DOM 过载；无数据时退待机点位 */
  const markerData = useMemo(() => {
    if (cityPoints.length === 0) {
      return STANDBY_POINTS.map(p => ({ ...p, count: 0, items: [], color: '#5eead4', glow: 'rgba(94,234,212,0.45)', level: 'cool standby' }));
    }
    return cityPoints.slice(0, 20).map(g => {
      const level = levelOf(maxCount ? g.count / maxCount : 0);
      return { lat: g.lat, lng: g.lng, city: g.city, count: g.count, items: g.items, color: level.color, glow: level.glow, level: level.id };
    });
  }, [cityPoints, maxCount]);

  /** 表层扩散波纹环 */
  const ringsData = useMemo(() => (
    markerData.map(p => ({
      lat: p.lat, lng: p.lng,
      maxR: 4 + Math.min(p.count, 12) * 0.6,
      propagationSpeed: 2.2,
      repeatPeriod: 1800 + Math.min(p.count, 12) * 120,
      color: p.color,
    }))
  ), [markerData]);

  /** 传播弧线：最热城市 → 其余热点，渐变流光 */
  const arcsData = useMemo(() => {
    const active = markerData.filter(p => p.count > 0);
    if (active.length < 2) return [];
    const origin = active[0];
    return active.slice(1, 9).map(p => ({
      startLat: origin.lat, startLng: origin.lng, endLat: p.lat, endLng: p.lng,
      color: ['rgba(34,211,238,0.05)', 'rgba(103,232,249,0.9)'],
      dashLength: 0.45, dashGap: 0.12, dashAnimateTime: 2200 + Math.random() * 1200,
    }));
  }, [markerData]);

  return { cityPoints, markerData, ringsData, arcsData };
}

/* ============ 面板子组件 ============ */

function PanelSection({ icon, title, extra, children }) {
  return (
    <section className="gs-panel-section">
      <header className="gs-panel-head">
        <h4 className="gs-panel-title">
          <span className="gs-panel-icon" aria-hidden="true">{icon}</span>
          {title}
        </h4>
        {extra}
      </header>
      <div className="gs-panel-body">{children}</div>
    </section>
  );
}

const ICONS = {
  grid: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>,
  globe: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.8 2.6 4 5.8 4 9s-1.2 6.4-4 9c-2.8-2.6-4-5.8-4-9s1.2-6.4 4-9z" /></svg>,
  trend: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-6" /></svg>,
  news: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  bolt: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
  pulse: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
};

/** 左侧面板：赛道分布 + 来源排行 + 7日趋势 */
function LeftPanel({ allItems, currentItems, onCategoryChange, activeCategory }) {
  const categoryStats = useMemo(() => {
    const counts = {};
    currentItems.forEach(item => { if (item.category) counts[item.category] = (counts[item.category] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id, count]) => ({ id, label: CATEGORY_LABELS[id] || id, count }));
  }, [currentItems]);

  const sourceStats = useMemo(() => {
    const counts = {};
    currentItems.forEach(item => { if (item.source) counts[item.source] = (counts[item.source] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [currentItems]);

  const trendData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days.map(day => ({ date: day.slice(5), count: allItems.filter(i => i.publishedAt?.slice(0, 10) === day).length }));
  }, [allItems]);
  const maxTrend = Math.max(...trendData.map(d => d.count), 1);

  return (
    <>
      <PanelSection icon={ICONS.grid} title="赛道分布">
        {categoryStats.length === 0 ? <div className="gs-panel-empty">暂无数据</div> : categoryStats.map(stat => (
          <button
            key={stat.id}
            type="button"
            className={`gs-bar-row ${activeCategory === stat.id ? 'active' : ''}`}
            onClick={() => onCategoryChange(activeCategory === stat.id ? 'all' : stat.id)}
          >
            <span className="gs-bar-label">{stat.label}</span>
            <span className="gs-bar-track"><span className="gs-bar-fill" style={{ width: `${(stat.count / categoryStats[0].count) * 100}%` }} /></span>
            <span className="gs-bar-value">{stat.count}</span>
          </button>
        ))}
      </PanelSection>
      <PanelSection icon={ICONS.globe} title="来源排行">
        {sourceStats.length === 0 ? <div className="gs-panel-empty">暂无数据</div> : sourceStats.map(([name, count]) => (
          <div key={name} className="gs-bar-row static">
            <span className="gs-bar-label" title={name}>{name}</span>
            <span className="gs-bar-track"><span className="gs-bar-fill source" style={{ width: `${(count / sourceStats[0][1]) * 100}%` }} /></span>
            <span className="gs-bar-value">{count}</span>
          </div>
        ))}
      </PanelSection>
      <PanelSection icon={ICONS.trend} title="7日收录趋势">
        <div className="gs-trend">
          {trendData.map((d, i) => (
            <div key={i} className="gs-trend-col">
              <span className="gs-trend-count">{d.count || ''}</span>
              <span className="gs-trend-bar" style={{ height: `${Math.max((d.count / maxTrend) * 100, 4)}%` }} />
              <span className="gs-trend-date">{d.date}</span>
            </div>
          ))}
        </div>
      </PanelSection>
    </>
  );
}

/** 右侧面板：实时资讯流 + 热门话题 + 系统状态 */
function RightPanel({ currentItems, onSelectItem }) {
  const latestNews = useMemo(() => (
    [...currentItems].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 10)
  ), [currentItems]);

  const hotTopics = useMemo(() => {
    const wordCounts = {};
    currentItems.forEach(item => {
      if (!item.title) return;
      item.title.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 2).forEach(w => {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      });
    });
    return Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));
  }, [currentItems]);

  return (
    <>
      <PanelSection icon={ICONS.news} title="实时资讯流">
        {latestNews.length === 0 ? <div className="gs-panel-empty">暂无数据</div> : (
          <div className="gs-news-stream">
            {latestNews.map((item, idx) => (
              <button key={`${item.id || idx}`} type="button" className="gs-news-item" onClick={() => onSelectItem(item)}>
                <span className="gs-news-rank">{String(idx + 1).padStart(2, '0')}</span>
                <span className="gs-news-main">
                  <span className="gs-news-title">{item.title}</span>
                  <span className="gs-news-meta">{item.source} · {formatTime(item.publishedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </PanelSection>
      <PanelSection icon={ICONS.bolt} title="热门话题">
        {hotTopics.length === 0 ? <div className="gs-panel-empty">暂无数据</div> : (
          <div className="gs-topic-cloud">
            {hotTopics.map((topic, idx) => (
              <span key={idx} className="gs-topic-tag" style={{ opacity: 1 - idx * 0.055 }}>{topic.word}</span>
            ))}
          </div>
        )}
      </PanelSection>
      <PanelSection icon={ICONS.pulse} title="系统状态">
        <div className="gs-status-list">
          <div className="gs-status-item"><span className="gs-status-dot cyan" /><span>今日收录 {currentItems.length} 条资讯</span></div>
          <div className="gs-status-item"><span className="gs-status-dot green" /><span>覆盖 {new Set(currentItems.map(i => i.source).filter(Boolean)).size} 个来源</span></div>
          <div className="gs-status-item"><span className="gs-status-dot blue" /><span>涉及 {new Set(currentItems.map(i => i.category).filter(Boolean)).size} 个赛道</span></div>
        </div>
      </PanelSection>
    </>
  );
}

/* ============ 点位小弹窗（锚定 marker 位置，随视图实时追踪） ============ */

function GlobePopup({ point, onClose, onSelectItem }) {
  useEffect(() => {
    if (!point) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [point, onClose]);

  if (!point) return null;
  return (
    <div className={`gs-popup ${point.level}`} data-city={point.city}>
        <header className="gs-popup-head">
          <span className="gs-detail-dot" style={{ background: point.color, boxShadow: `0 0 10px ${point.glow}` }} />
          <strong className="gs-popup-city">{point.city}</strong>
          <span className="gs-popup-count">{point.count} 条</span>
          <button type="button" className="gs-detail-close" onClick={onClose} aria-label="关闭弹窗">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </header>
        <div className="gs-popup-list">
          {point.items.length === 0 && <div className="gs-panel-empty">该点位暂无资讯</div>}
          {point.items.slice(0, 30).map((item, idx) => (
            <button key={`${item.id || idx}`} type="button" className="gs-popup-item" onClick={() => onSelectItem(item)}>
              <span className="gs-popup-item-title">{item.title}</span>
              <span className="gs-popup-item-meta">{item.source} · {formatTime(item.publishedAt)}</span>
            </button>
          ))}
        </div>
        <footer className="gs-popup-foot">点击资讯查看内容预览</footer>
    </div>
  );
}

/* ============ 资讯内容预览窗（内联阅读，看不了才去原文） ============ */

function NewsPreview({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;
  const body = item.fullContent || item.content || item.body || item.summary || '';
  const paragraphs = String(body).split(/\n+/).map(s => s.trim()).filter(Boolean);
  const dateLabel = item.publishedAt ? new Date(item.publishedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间';

  return (
    <div className="gs-preview-mask" onClick={onClose} role="dialog" aria-label="资讯内容预览">
      <article className="gs-preview" onClick={e => e.stopPropagation()}>
        <header className="gs-preview-head">
          <div className="gs-preview-meta">
            <span className="gs-preview-source">{item.source || '未知来源'}</span>
            <span className="gs-preview-time">{dateLabel}</span>
            {item.category && <span className="gs-detail-tag">{CATEGORY_LABELS[item.category] || item.category}</span>}
          </div>
          <button type="button" className="gs-detail-close" onClick={onClose} aria-label="关闭预览">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </header>
        <h2 className="gs-preview-title">{item.title || '（无标题）'}</h2>
        <div className="gs-preview-body custom-scrollbar">
          {paragraphs.length === 0 && <p className="gs-preview-empty">暂无正文内容，可点击下方「查看原文」访问来源页面。</p>}
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        {item.url && (
          <footer className="gs-preview-foot">
            <a className="gs-preview-link" href={item.url} target="_blank" rel="noreferrer">在浏览器查看原文 →</a>
          </footer>
        )}
      </article>
    </div>
  );
}

/* ============ 时间轴 ============ */

function Timeline({ dateRange, selectedDate, setSelectedDate, isPlaying, setIsPlaying, compact }) {
  return (
    <div className={`gs-timeline ${compact ? 'compact' : ''}`}>
      <button type="button" className="gs-tl-btn" onClick={() => { const idx = dateRange.indexOf(selectedDate); if (idx > 0) setSelectedDate(dateRange[idx - 1]); }} disabled={dateRange.indexOf(selectedDate) <= 0} aria-label="前一天">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button type="button" className={`gs-tl-btn play ${isPlaying ? 'active' : ''}`} onClick={() => setIsPlaying(p => !p)} aria-label={isPlaying ? '暂停' : '播放'}>
        {isPlaying
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="15" x2="10" y2="9" /><line x1="14" y1="15" x2="14" y2="9" /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>}
      </button>
      <div className="gs-tl-dates">
        {dateRange.slice(-7).map(date => (
          <button key={date} type="button" className={`gs-tl-date ${date === selectedDate ? 'active' : ''}`} onClick={() => { setSelectedDate(date); setIsPlaying(false); }}>{date.slice(5)}</button>
        ))}
      </div>
      <button type="button" className="gs-tl-btn" onClick={() => { const idx = dateRange.indexOf(selectedDate); if (idx >= 0 && idx < dateRange.length - 1) setSelectedDate(dateRange[idx + 1]); }} disabled={dateRange.indexOf(selectedDate) >= dateRange.length - 1} aria-label="后一天">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
    </div>
  );
}

/* ============ 地球主体 ============ */

/* ============ 地球主体（v26：MapLibre globe 投影 + ESRI 卫星瓦片，可放大到卫星级） ============ */

// ESRI World Imagery：免费无 key 卫星瓦片，最高 z19（城市街区级）
const ESRI_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

function GlobeStage({ markerData, width, height, onPreviewItem, interactive }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // city -> maplibregl.Marker
  const spinningRef = useRef(false);    // 自动巡航开关（交互中暂停）
  const idleTimerRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [popupPoint, setPopupPoint] = useState(null);
  const popupWrapRef = useRef(null);

  // 初始化 MapLibre（globe 投影 + 卫星瓦片；无 background 层 → 画布透明，星空氛围透出）
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return undefined;
    const map = new MapLibreMap({
      container: host,
      style: {
        version: 8,
        sources: {
          esri: {
            type: 'raster',
            tiles: [ESRI_IMAGERY_URL],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Imagery © Esri',
          },
        },
        layers: [{ id: 'satellite', type: 'raster', source: 'esri' }],
      },
      center: [106, 26],
      zoom: 1.35,
      minZoom: 0.4,
      maxZoom: 18, // 卫星级贴地
      attributionControl: false,
      renderWorldCopies: false,
      dragRotate: true,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;

    if (!interactive) {
      map.dragPan.disable();
      map.dragRotate.disable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
      map.keyboard.disable();
    } else {
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    }

    map.on('style.load', () => {
      try {
        if (map.setProjection) map.setProjection({ type: 'globe' });
        if (map.setSky) {
          map.setSky({
            'sky-color': '#04070f',
            'horizon-color': '#0e2f4e',
            'fog-color': '#02040a',
            'sky-horizon-blend': 0.6,
            'horizon-fog-blend': 0.7,
            'fog-ground-blend': 0.2,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 5, 0.35, 10, 0],
          });
        }
      } catch { /* 投影/天空降级：平面瓦片图仍可用 */ }
      setMapReady(true);
    });

    // 闲置自动巡航：交互即停，闲置 6s 且低倍率（<4）才恢复，防贴地自转眩晕
    const spinGlobe = () => {
      const m = mapRef.current;
      if (!m || spinningRef.current || m.getZoom() >= 4) return;
      const c = m.getCenter();
      c.lng -= 0.055;
      m.easeTo({ center: c, duration: 66, easing: (t) => t });
    };
    const pauseSpin = () => { spinningRef.current = true; clearTimeout(idleTimerRef.current); };
    map.on('mousedown', pauseSpin);
    map.on('dragstart', pauseSpin);
    map.on('wheel', pauseSpin);
    map.on('touchstart', pauseSpin);
    map.on('mouseup', () => {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => { spinningRef.current = false; spinGlobe(); }, 6000);
    });
    map.on('moveend', () => { if (!spinningRef.current) spinGlobe(); });
    map.once('load', spinGlobe);

    return () => {
      clearTimeout(idleTimerRef.current);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(idleTimerRef.current), []);

  // 点位 DOM：发光核心 + 双层扩散波纹 + 计数徽标 + 城市名（待机点位无 badge）
  // MapLibre 官方 DOM Marker：真实鼠标命中测试可靠，且 globe 投影下背面点位由引擎自动隐藏
  const buildMarkerElement = useCallback((d) => {
    const el = document.createElement('div');
    el.className = `gs-marker ${d.level}`;
    el.innerHTML = `
      <span class="gs-marker-anchor">
        <span class="gs-marker-hit"></span>
        <span class="gs-marker-ripple"></span>
        <span class="gs-marker-ripple delay"></span>
        <span class="gs-marker-core"></span>
        ${d.count > 0 ? `<span class="gs-marker-badge">${d.count}</span>` : ''}
        <span class="gs-marker-name">${d.city}</span>
      </span>`;
    el.title = `${d.city} · ${d.count} 条资讯`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setPopupPoint(d);
    });
    return el;
  }, []);

  // markerData → MapLibre Marker（按 city 增量同步）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const store = markersRef.current;
    const keys = new Set(markerData.map((d) => d.city));
    store.forEach((marker, key) => {
      if (!keys.has(key)) { marker.remove(); store.delete(key); }
    });
    markerData.forEach((d) => {
      if (store.has(d.city)) return;
      const marker = new MapLibreMarker({ element: buildMarkerElement(d), anchor: 'center' })
        .setLngLat([d.lng, d.lat])
        .addTo(map);
      store.set(d.city, marker);
    });
  }, [markerData, mapReady, buildMarkerElement]);

  // rAF 追踪：弹窗钉在对应 marker 的实际 DOM 位置（投影与背面遮挡交给 MapLibre，本地双保险）
  useEffect(() => {
    if (!popupPoint) return undefined;
    let raf = 0;
    const update = () => {
      const el = popupWrapRef.current;
      const marker = mapRef.current && markersRef.current.get(popupPoint.city);
      const markerEl = marker?.getElement();
      const host = hostRef.current;
      if (el && markerEl && host) {
        // marker 根元素是 0×0 原点锚，命中热区（.gs-marker-hit，48×48）才是定位参照
        const padEl = markerEl.querySelector('.gs-marker-hit') || markerEl;
        const mr = padEl.getBoundingClientRect();
        const hr = host.getBoundingClientRect();
        let occluded = false;
        try {
          const tr = mapRef.current?.transform;
          if (tr?.isLocationOccluded) occluded = tr.isLocationOccluded(new LngLat(popupPoint.lng, popupPoint.lat));
        } catch { /* 内部 API 缺失时靠 DOM 隐藏判据兜底 */ }
        const hidden = occluded || markerEl.style.display === 'none' || mr.width === 0
          || mr.right < hr.left || mr.left > hr.right || mr.bottom < hr.top || mr.top > hr.bottom;
        if (hidden) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        } else {
          const cx = mr.left - hr.left + mr.width / 2;
          const cy = mr.top - hr.top + mr.height / 2;
          const x = Math.max(170, Math.min(width - 170, cx));
          const flipBelow = cy < 260;
          const y = Math.max(120, Math.min(height - 110, cy));
          el.style.opacity = '1';
          el.style.pointerEvents = 'none';
          el.dataset.flip = flipBelow ? 'below' : 'above';
          el.style.transform = `translate(${x}px, ${y}px)`;
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [popupPoint, width, height]);

  return (
    <div className="gs-stage" style={{ width, height }}>
      <div ref={hostRef} className="gs-map-host" />
      <div className="gs-halo" aria-hidden="true" />
      <div className="gs-halo inner" aria-hidden="true" />

      {/* 点位小弹窗：锚定 marker 实时位置，转到背面自动隐藏 */}
      {popupPoint && (
        <div className="gs-popup-wrap" ref={popupWrapRef}>
          <GlobePopup point={popupPoint} onClose={() => setPopupPoint(null)} onSelectItem={onPreviewItem} />
        </div>
      )}
    </div>
  );
}

/* ============ 全屏大屏 ============ */

function GlobeDashboard({ items, onClose }) {
  const { w, h } = useViewportSize();
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterRegion, setFilterRegion] = useState('all');
  const [previewItem, setPreviewItem] = useState(null);
  const tickerTrackRef = useRef(null);

  const followedKeywords = useMemo(() => {
    try {
      const saved = localStorage.getItem('selectedInterests');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch { return []; }
  }, []);

  // 日期回放
  const dateRange = useMemo(() => (
    [...new Set(items.map(i => i.publishedAt?.slice(0, 10)).filter(Boolean))].sort()
  ), [items]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = setInterval(() => {
      setSelectedDate(prev => {
        const [y, m, d] = prev.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        date.setDate(date.getDate() + 1);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (date > today) { setIsPlaying(false); return prev; }
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      });
    }, 1600);
    return () => clearInterval(timer);
  }, [isPlaying]);

  const dateItems = useMemo(() => (
    items.filter(i => i.publishedAt?.slice(0, 10) === selectedDate)
  ), [items, selectedDate]);

  const matchesFilters = useCallback(item => {
    if (filterCategory !== 'all' && item.category !== filterCategory) return false;
    if (filterRegion !== 'all') {
      const itemRegion = item.region || getRegionFromSource(item.source);
      if (itemRegion !== filterRegion) return false;
    }
    return true;
  }, [filterCategory, filterRegion]);

  const filteredItems = useMemo(() => dateItems.filter(matchesFilters), [dateItems, matchesFilters]);
  // 当日无数据时回退全量（保证大屏不空转）
  const dashboardItems = useMemo(() => (
    filteredItems.length > 0 ? filteredItems : items.filter(matchesFilters)
  ), [filteredItems, items, matchesFilters]);

  const { markerData, ringsData, arcsData } = useGlobeData(dashboardItems);

  // 顶部统计
  const stats = useMemo(() => {
    const cityCounts = {};
    dashboardItems.forEach(item => {
      const cityInfo = resolveItemCity(item);
      cityCounts[cityInfo.city] = (cityCounts[cityInfo.city] || 0) + 1;
    });
    const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    const categoryCounts = {};
    dashboardItems.forEach(item => { if (item.category) categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1; });
    const topCategoryEntry = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
    const topCategory = topCategoryEntry ? (CATEGORY_LABELS[topCategoryEntry[0]] || topCategoryEntry[0]) : '-';
    return { total: dashboardItems.length, topCity, topCategory };
  }, [dashboardItems]);

  // 热点滚动条（关注关键词优先）
  const tickerItems = useMemo(() => {
    const base = dashboardItems.length ? dashboardItems : items;
    const followed = followedKeywords.length
      ? base.filter(item => {
        const text = `${item.title || ''} ${item.summary || ''} ${item.category || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
        return followedKeywords.some(keyword => text.includes(String(keyword).toLowerCase()));
      })
      : [];
    return (followed.length ? followed : base).slice(0, 8).map(item => ({
      title: item.title || 'Global technology signal',
      source: item.source || '万般硅川',
      category: CATEGORY_LABELS[item.category] || item.category || '热门资讯',
      url: item.url || '',
    }));
  }, [dashboardItems, items, followedKeywords]);

  // 滚动条自动步进
  useEffect(() => {
    const el = tickerTrackRef.current;
    if (!el) return undefined;
    const timer = setInterval(() => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;
      if (el.scrollLeft >= maxScroll - 8) el.scrollTo({ left: 0, behavior: 'smooth' });
      else el.scrollBy({ left: Math.min(320, el.clientWidth * 0.55), behavior: 'smooth' });
    }, 3800);
    return () => clearInterval(timer);
  }, [tickerItems.length]);

  const onSelectItem = useCallback(item => { if (item?.url) window.open(item.url, '_blank'); }, []);

  // 地球尺寸：视口响应式，为两侧面板留位
  const sideWidth = w >= 1500 ? 300 : w >= 1200 ? 258 : 0;
  const topHeight = 72;
  const bottomHeight = 62;
  const globeWidth = sideWidth > 0 ? Math.max(360, w - sideWidth * 2 - 60) : Math.max(340, w - 60);
  const globeHeight = Math.max(320, h - topHeight - bottomHeight - 40);

  const showSidePanels = sideWidth > 0;

  return (
    <div className="gs-dashboard" role="application" aria-label="全球科技资讯态势大屏">
      {/* 氛围层：星空 / 网格 / 扫描 / 暗角 */}
      <StarField />
      <div className="gs-grid-overlay" aria-hidden="true" />
      <div className="gs-scanline" aria-hidden="true" />
      <div className="gs-vignette" aria-hidden="true" />
      <div className="gs-corner tl" aria-hidden="true" />
      <div className="gs-corner tr" aria-hidden="true" />
      <div className="gs-corner bl" aria-hidden="true" />
      <div className="gs-corner br" aria-hidden="true" />

      {/* 顶部命令条 */}
      <header className="gs-topbar">
        <div className="gs-brand">
          <span className="gs-brand-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="10" ry="4" /><path d="M2 12h20" /><path d="M12 2c-3 3-5 7-5 12s2 9 5 12c3-3 5-7 5-12s-2-9-5-12z" /></svg>
          </span>
          <div className="gs-brand-text">
            <h2 className="gs-brand-title">全球科技资讯态势大屏</h2>
            <span className="gs-brand-sub">SILICON MERIDIAN · GLOBAL COMMAND</span>
          </div>
        </div>

        <div className="gs-ticker">
          <span className="gs-ticker-label">实时热点</span>
          <button type="button" className="gs-ticker-nav" onClick={() => tickerTrackRef.current?.scrollBy({ left: -300, behavior: 'smooth' })} aria-label="向前滚动">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="gs-ticker-track" ref={tickerTrackRef}>
            {tickerItems.map((item, idx) => (
              <button type="button" key={`${item.title}-${idx}`} className="gs-ticker-chip" onClick={() => item.url && window.open(item.url, '_blank')} title={item.title}>
                <i>{String(idx + 1).padStart(2, '0')}</i>
                <strong>{item.category}</strong>
                <span>{item.title}</span>
              </button>
            ))}
          </div>
          <button type="button" className="gs-ticker-nav" onClick={() => tickerTrackRef.current?.scrollBy({ left: 300, behavior: 'smooth' })} aria-label="向后滚动">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>

        <div className="gs-top-stats">
          <div className="gs-top-stat"><span className="gs-top-stat-num">{stats.total}</span><span className="gs-top-stat-label">今日收录</span></div>
          <div className="gs-top-stat"><span className="gs-top-stat-num">{stats.topCity}</span><span className="gs-top-stat-label">最热城市</span></div>
          <div className="gs-top-stat"><span className="gs-top-stat-num">{stats.topCategory}</span><span className="gs-top-stat-label">最热赛道</span></div>
          <LiveClock />
        </div>

        <button type="button" className="gs-close" onClick={onClose} aria-label="退出大屏">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </header>

      {/* 地球主体（居中舞台） */}
      <div className="gs-center" style={{ top: topHeight, bottom: bottomHeight }}>
        <GlobeStage
          markerData={markerData}
          ringsData={ringsData}
          arcsData={arcsData}
          width={globeWidth}
          height={globeHeight}
          onPreviewItem={setPreviewItem}
          interactive
        />
        <div className="gs-stage-caption">
          <span className="gs-stage-caption-dot" />
          拖拽旋转 · 滚轮缩放 · 点击光标查看详情
        </div>
      </div>

      {/* 左侧数据面板 */}
      {showSidePanels && (
        <aside className="gs-side left" style={{ top: topHeight + 10, bottom: bottomHeight + 10, width: sideWidth }}>
          <div className="gs-panel custom-scrollbar">
            <LeftPanel
              allItems={items}
              currentItems={dashboardItems}
              onCategoryChange={setFilterCategory}
              activeCategory={filterCategory}
            />
          </div>
        </aside>
      )}

      {/* 右侧数据面板 */}
      {showSidePanels && (
        <aside className="gs-side right" style={{ top: topHeight + 10, bottom: bottomHeight + 10, width: sideWidth }}>
          <div className="gs-panel custom-scrollbar">
            <RightPanel currentItems={dashboardItems} onSelectItem={onSelectItem} />
          </div>
        </aside>
      )}

      {/* 底部时间轴 + 筛选 */}
      <footer className="gs-bottombar" style={{ height: bottomHeight }}>
        <Timeline dateRange={dateRange} selectedDate={selectedDate} setSelectedDate={setSelectedDate} isPlaying={isPlaying} setIsPlaying={setIsPlaying} />
        <div className="gs-filters">
          <select className="gs-filter" value={filterCategory} onChange={e => setFilterCategory(e.target.value)} aria-label="赛道筛选">
            <option value="all">全部赛道</option>
            {CATEGORY_GROUPS.map(group => (
              <optgroup key={group.id} label={group.label}>
                {group.categories.map(catId => <option key={catId} value={catId}>{CATEGORY_LABELS[catId] || catId}</option>)}
              </optgroup>
            ))}
          </select>
          <select className="gs-filter" value={filterRegion} onChange={e => setFilterRegion(e.target.value)} aria-label="区域筛选">
            <option value="all">全部区域</option>
            <option value="domestic">国内</option>
            <option value="overseas">海外</option>
          </select>
        </div>
      </footer>

      {/* 点击资讯 → 内容预览窗 */}
      <NewsPreview item={previewItem} onClose={() => setPreviewItem(null)} />
    </div>
  );
}

/* ============ 嵌入模式（深色太空舱窗，主题解耦） ============ */

function GlobeEmbed({ items, onExpand }) {
  const { w } = useViewportSize();
  const [previewItem, setPreviewItem] = useState(null);
  const { markerData, ringsData, arcsData } = useGlobeData(items);
  const width = Math.max(320, Math.min(w - 60, 920));
  const height = 400;
  const stats = useMemo(() => {
    const cityCounts = {};
    items.forEach(item => {
      const cityInfo = resolveItemCity(item);
      cityCounts[cityInfo.city] = (cityCounts[cityInfo.city] || 0) + 1;
    });
    return {
      total: items.length,
      cities: Object.keys(cityCounts).length,
      topCity: Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-',
    };
  }, [items]);

  return (
    <div className="gs-embed">
      <header className="gs-embed-head">
        <div className="gs-embed-title">
          <span className="gs-embed-pulse" aria-hidden="true" />
          <h3>全球热点</h3>
          <span className="gs-embed-sub">GLOBAL SIGNAL MAP</span>
        </div>
        <div className="gs-embed-stats">
          <span>{stats.total} 条资讯</span>
          <span>{stats.cities} 个城市</span>
          <span>最热 {stats.topCity}</span>
        </div>
      </header>
      <div className="gs-embed-stage">
        <StarField />
        <div className="gs-scanline" aria-hidden="true" />
        <GlobeStage
          markerData={markerData}
          ringsData={ringsData}
          arcsData={arcsData}
          width={width}
          height={height}
          onPreviewItem={setPreviewItem}
          interactive
        />
        {previewItem && <NewsPreview item={previewItem} onClose={() => setPreviewItem(null)} />}
      </div>
      <button type="button" className="gs-expand" onClick={onExpand} title="进入全屏指挥大屏">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
      </button>
    </div>
  );
}

/* ============ 主组件（对外接口不变） ============ */

export default function GlobeView({ items = [], externalFullscreen, onFullscreenChange }) {
  const [internalFullscreen, setInternalFullscreen] = useState(false);
  const isControlled = externalFullscreen !== undefined;
  const isFullscreen = isControlled ? externalFullscreen : internalFullscreen;

  const openFullscreen = useCallback(() => {
    if (isControlled) onFullscreenChange?.(true);
    else setInternalFullscreen(true);
  }, [isControlled, onFullscreenChange]);

  const closeFullscreen = useCallback(() => {
    if (isControlled) onFullscreenChange?.(false);
    else setInternalFullscreen(false);
  }, [isControlled, onFullscreenChange]);

  // 全屏时锁定背景滚动
  useEffect(() => {
    if (!isFullscreen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isFullscreen]);

  return (
    <>
      {/* 嵌入模式：仅在未处于全屏时挂载，避免受控全屏场景下重复创建两个 Globe 实例 */}
      {!isFullscreen && <GlobeEmbed items={items} onExpand={openFullscreen} />}
      {isFullscreen && createPortal(
        <div className="gs-overlay">
          <GlobeDashboard items={items} onClose={closeFullscreen} />
        </div>,
        document.body,
      )}
    </>
  );
}
