/**
 * semanticCluster.js - 基于 embeddings 的语义聚类（G1 复刻 Meridian 的聚类阶段）
 *
 * 设计原则（与项目约定一致）：
 * - 纯逻辑、无 React、无 fetch，可在 Node/vitest 直接 import。
 * - Embedding 来源"可注入"：生产走托管 API（OpenAI 兼容，复用已有 Key 体系），
 *   离线/测试走本地 TF-IDF stand-in。模块本身不绑定任何 embedding 供应商。
 * - 聚类算法：余弦相似度 + 贪心单连通簇（dependency-free）。
 *   这是 Meridian 用 "embeddings + UMAP + HDBSCAN" 做"相关文章成簇"的实用近似；
 *   HDBSCAN 的噪声/离群处理更强，留作后续增强（见下方注释）。
 *
 * 与现有 lexical 聚类的关系：
 * - `recommendationEngine.clusterEvents` 是标题 token 的 Jaccard 词法聚类（无 embeddings）。
 * - 本模块是"语义"升级版，返回**同形状**的簇对象（id/primaryItem/items/itemIds/
 *   independentSources/independentSourceCount），可平滑替换或并排对比。
 */

/** 余弦相似度（dense 向量）。空向量返回 0。 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 贪心单连通簇（union-find）。
 * 两两相似度 >= threshold 即连通，连通分量即一个簇。
 * 单连通（transitive）会把"A~B、B~C"合并为 {A,B,C}——适合"同一事件的多篇报道"成簇。
 *
 * @param {Array} items        参与聚类的项
 * @param {Function} similarity (i,j)=>number，取值 [0,1]
 * @param {number} [threshold=0.5]
 * @returns {Array<Array<number>>} 每个元素是被合并项的原始下标数组
 */
export function greedyCluster(items, similarity, { threshold = 0.5 } = {}) {
  const n = items.length;
  if (n === 0) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => { parent[find(a)] = find(b); };

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (similarity(i, j) >= threshold) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return [...groups.values()];
}

function pickPrimary(clusterItems) {
  return [...clusterItems].sort(
    (a, b) =>
      (b.mustReadScore || 0) - (a.mustReadScore || 0) ||
      (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0),
  )[0];
}

/**
 * 用预计算 embeddings 做语义聚类。
 * @param {Array} items        新闻项（需含 id/title/source/publishedAt/mustReadScore 等）
 * @param {number[][]} embeddings 与 items 对齐的向量
 * @param {Object} [opts]
 * @param {number} [opts.threshold=0.5] 余弦相似度阈值
 * @param {number} [opts.maxItems=500] 最多纳入多少条
 * @returns {Array} 簇对象（与 clusterEvents 同形状）
 */
export function clusterByEmbeddings(items, embeddings, { threshold = 0.5, maxItems = 500 } = {}) {
  const slice = items.slice(0, maxItems);
  const sliceEmb = embeddings.slice(0, maxItems);
  const sim = (i, j) => cosineSimilarity(sliceEmb[i], sliceEmb[j]);
  const groups = greedyCluster(slice, sim, { threshold });

  return groups
    .map((groupIdx, clusterIndex) => {
      const clusterItems = groupIdx.map((k) => slice[k]);
      const independentSources = [...new Set(clusterItems.map((it) => it.source).filter(Boolean))];
      const primary = pickPrimary(clusterItems);
      return {
        id: primary?.canonicalId || `sem-event-${clusterIndex}-${primary?.id}`,
        primaryItem: primary,
        items: clusterItems,
        itemIds: clusterItems.map((it) => it.id),
        independentSources,
        independentSourceCount: independentSources.length || 1,
        method: 'semantic',
      };
    });
}

/**
 * 异步入口：注入 embedFn（titles[] => number[][]）算向量后再聚类。
 * 生产环境把 embedFn 指向托管 embedding API；离线/测试传本地 stand-in。
 *
 * @param {Array} items
 * @param {Function} embedFn async (texts: string[]) => number[][]
 * @param {Object} [opts] 透传给 clusterByEmbeddings
 * @returns {Promise<Array>}
 */
export async function buildSemanticClusters(items, embedFn, opts = {}) {
  const slice = items.slice(0, opts.maxItems || 500);
  const texts = slice.map((it) => `${it.title || ''} ${it.summary || ''}`.trim());
  const embeddings = await embedFn(texts);
  return clusterByEmbeddings(slice, embeddings, opts);
}
