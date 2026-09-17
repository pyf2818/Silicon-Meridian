import { expect, test } from '@playwright/test';
import { dismissOnboarding, installExternalFixtures, openNav } from './fixtures.js';

/**
 * 素材链路 E2E（原 creative.spec.js 重写）。
 *
 * 为什么重写：旧用例断言的是 CreativeWorkspace（"Creative asset workspace" / "Export local" /
 * .creative-asset-list）——该组件在 App.jsx 只有 import、没有渲染点，创作能力由 AI 工作站承接，
 * studio 入口现在渲染素材仓库（MaterialsPage）。断言已删除的界面只会永远红灯。
 *
 * 本文件验证「资讯 → 素材 → 创作资产」的真实链路，以及云同步的 UUID 契约：
 * 素材转资产的 id 必须是纯 UUID，否则 syncNow 会静默丢弃（见 assetModel.js 的历史 BUG 注释）。
 */

const CREATIVE_KEYS = [
  'materials',
  'creativeAssets:v1',
  'creativeDocuments:v1',
  'creativeVersions:v1',
  'creativeWorkspaceMigration:v1',
  'creativeWorkspaceUuidMigration:v1',
];

async function openApp(page, seed = null) {
  await installExternalFixtures(page);
  // addInitScript 的函数会被序列化到浏览器执行——只能通过单个 arg 传参，不能引用闭包变量
  await page.addInitScript(({ keys, seedJson }) => {
    for (const key of keys) localStorage.removeItem(key);
    if (seedJson) {
      const seed = JSON.parse(seedJson);
      localStorage.setItem('creativeAssets:v1', JSON.stringify(seed.assets || []));
      localStorage.setItem('creativeDocuments:v1', JSON.stringify(seed.documents || []));
      localStorage.setItem('creativeVersions:v1', JSON.stringify(seed.versions || {}));
      localStorage.setItem('creativeWorkspaceMigration:v1', JSON.stringify({ done: true }));
    }
  }, { keys: CREATIVE_KEYS, seedJson: seed ? JSON.stringify(seed) : null });
  await page.goto('/');
  await dismissOnboarding(page);
}

test('turns a news card into a material and shows it in the repository', async ({ page }) => {
  await openApp(page);
  await openNav(page, 'all');

  const allPage = page.locator('main[data-nav="all"]');
  await expect(allPage.locator('.feed-list')).toContainText('OpenAI releases new Agent platform');
  await allPage.locator('.feed-list .add-material-btn').first().click();

  await openNav(page, 'studio');
  await expect(page.locator('main[data-nav="studio"] .repo-stats')).toContainText(/1 条素材/);
});

test('material-derived creative assets carry syncable UUID ids', async ({ page }) => {
  await openApp(page);
  await openNav(page, 'all');
  const allPage = page.locator('main[data-nav="all"]');
  await allPage.locator('.feed-list .add-material-btn').first().click();
  await openNav(page, 'studio');

  const assets = JSON.parse(await page.evaluate(() => localStorage.getItem('creativeAssets:v1') || '[]'));
  expect(assets).toHaveLength(1);
  // 云同步契约：id 必须是纯 UUID（syncNow 过滤非 UUID 资产——历史 BUG 是素材 id 冒充资产 id）
  expect(assets[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  // 来源链路保留：素材删除/恢复按 originalItemId 双匹配
  expect(assets[0].originalItemId).toBeTruthy();
});
