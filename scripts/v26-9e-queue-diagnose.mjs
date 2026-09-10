/**
 * v26.9e 诊断探针：信息排队触发时机 + 排队弹层可打开性
 *
 * 手法：本地起一个「慢速 OpenAI 兼容 mock 上游」，把 llmConfig.baseUrl 指过去，
 * 让 /api/ai-generate 的流式回复变慢（约 4s），从而稳定观察到排队行为。
 *
 * 断言：
 *   1. 发出第一条消息后（生成中、队列为空）→ 不应出现排队按钮
 *   2. 生成中发第二条 → 排队按钮出现且计数为 1
 *   3. 点击排队按钮 → 弹层出现、可见、且完整落在视口内（不被 overflow 裁剪）
 *   4. 全程 pageerror 为空
 */
import { chromium } from 'playwright';
import http from 'node:http';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5175';
const UPSTREAM_PORT = 7799;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

// ---------- 慢速 mock 上游 ----------
const PIECES = ['这是', '一条', '慢速', '流式', '回复', '用于', '观察', '排队', '行为', '的', '测试', '。', '继续', '输出', '中'];
const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let i = 0;
    let finished = false;
    const timer = setInterval(() => {
      if (finished) return;
      if (i >= PIECES.length) {
        finished = true;
        clearInterval(timer);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: PIECES[i] } }] })}\n\n`);
      i += 1;
    }, 300);
    // ⚠️ 不能用 req 的 'close' 来清理定时器：请求体读完后它就会立刻触发，
    // 会把流式响应直接掐断，导致被测应用一直等（假阳性「卡死」）。
    res.on('close', () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
    });
  });
});
await new Promise((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));
console.log(`mock 上游已启动：http://127.0.0.1:${UPSTREAM_PORT}/v1/chat/completions`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.addInitScript((port) => {
  try {
    localStorage.setItem('meridian_onboarded', '1');
    localStorage.setItem('sidebarCollapsed', 'false');
    localStorage.setItem('llmConfig', JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'probe-key',
      selectedModel: 'probe-model',
      provider: 'openai',
      webSearchEnabled: false,
    }));
  } catch {}
}, UPSTREAM_PORT);

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

/** 记录排队按钮按时间出现的轨迹 */
const queueTimeline = [];

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.entrance').waitFor({ state: 'detached', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // 进入 AI 工作站
  const navBtn = page.locator('.nav-primary-item', { hasText: 'AI 工作站' }).first();
  if (await navBtn.count()) { await navBtn.click({ timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(2000);

  const input = page.locator('.chat-input').first();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  check('AI 工作站输入框可见', true);

  const snap = async (tag) => {
    const info = await page.evaluate(() => {
      const btn = document.querySelector('.chat-queue-btn');
      const pop = document.querySelector('.chat-queue-pop');
      const sendBtn = document.querySelector('.chat-send-btn');
      const stopBtn = document.querySelector('.chat-stop-btn');
      let popBox = null;
      let clippedBy = null;
      let hitTest = null;
      if (pop) {
        const r = pop.getBoundingClientRect();
        popBox = { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
        // 找裁剪祖先（弹层已 portal 到 body，正常应找不到任何裁剪祖先）
        let p = pop.parentElement;
        while (p && p !== document.body) {
          const cs = getComputedStyle(p);
          if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            const pr = p.getBoundingClientRect();
            const outside = r.bottom > pr.bottom + 1 || r.right > pr.right + 1;
            if (outside) clippedBy = { cls: p.className, overflow: `${cs.overflowX}/${cs.overflowY}`, parentBottom: pr.bottom };
            break;
          }
          p = p.parentElement;
        }
        // 命中测试：弹层中心点必须真的能点到弹层本身（被裁剪时命中的会是别的元素）
        const cx = r.x + r.width / 2;
        const cy = r.y + Math.min(r.height / 2, r.height - 6);
        const hit = document.elementFromPoint(cx, cy);
        hitTest = hit ? { tag: hit.tagName, inPop: pop.contains(hit) } : null;
      }
      return {
        btnText: btn ? btn.textContent.replace(/[▴▾\s]/g, '') : null,
        popExists: !!pop,
        popBox,
        clippedBy,
        hitTest,
        sendBtn: !!sendBtn,
        stopBtn: !!stopBtn,
        vh: window.innerHeight,
        // 弹层的 DOM 父节点（应为 body，证明已 portal 出裁剪容器）
        popParent: pop ? pop.parentElement.tagName : null,
      };
    });
    queueTimeline.push({ tag, ...info });
    return info;
  };

  // ---------- 1. 第一条消息：不应进入排队 ----------
  await input.click();
  await input.fill('第一条消息（探针）');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900); // 已开始流式
  const s1 = await snap('第一条发出后(生成中)');
  check('生成中：停止按钮出现（确认真的在跑）', s1.stopBtn === true, `stop=${s1.stopBtn} send=${s1.sendBtn}`);
  check('生成中：队列为空时「排队」按钮不显示', s1.btnText === null, `btnText=${s1.btnText}`);

  // ---------- 2. 第二条消息：应进入排队 ----------
  await input.click();
  await input.fill('第二条消息（应排队）');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const s2 = await snap('第二条发出后(应排队1)');
  check('生成中发第二条 → 排队按钮出现且计数 1', s2.btnText === '排队1', `btnText=${s2.btnText}`);

  // ---------- 3. 点击排队 → 弹层可打开且不被裁剪 ----------
  const queueBtn = page.locator('.chat-queue-btn').first();
  await queueBtn.click({ timeout: 5000 }).catch((e) => console.log('  点击排队按钮异常：', e.message));
  await page.waitForTimeout(500);
  const s3 = await snap('点击排队后');
  check('点击「排队」后弹层存在于 DOM', s3.popExists === true, `popExists=${s3.popExists}`);
  if (s3.popExists && s3.popBox) {
    check('弹层已 portal 到 body（脱离 overflow 裁剪容器）', s3.popParent === 'BODY', `parent=${s3.popParent}`);
    check('弹层可见（宽高 > 0）', s3.popBox.w > 0 && s3.popBox.h > 0, `box=${JSON.stringify(s3.popBox)}`);
    check('弹层完整落在视口内且无裁剪祖先',
      s3.popBox.bottom <= s3.vh + 1 && s3.popBox.y >= 0 && !s3.clippedBy,
      `bottom=${s3.popBox.bottom?.toFixed(0)} vh=${s3.vh} clippedBy=${s3.clippedBy ? JSON.stringify(s3.clippedBy) : '无'}`);
    check('弹层中心可被命中（真正可见可点）', s3.hitTest?.inPop === true, `hit=${s3.hitTest ? `${s3.hitTest.tag} inPop=${s3.hitTest.inPop}` : 'null'}`);
    // 弹层内容
    const items = await page.locator('.chat-queue-item').count();
    check('弹层内列出 1 条排队消息', items === 1, `items=${items}`);
  }

  // ---------- 4. 排空：等生成结束，第二条应自动发出，排队按钮消失 ----------
  // runAgentLoop 会自动追加「自检修复 / 技能沉淀」等收尾轮次，每轮都是一次 mock 往返，
  // 所以不能写死等待时长——直接等停止按钮消失。
  // 收起弹层，避免它挡住观察
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.chat-stop-btn'), null, { timeout: 90000 })
    .catch(() => console.log('  （等待生成结束超时，仍继续断言）'));
  await page.waitForTimeout(1500);
  const s4 = await snap('自动排空后');
  check('队列消费完后「排队」按钮消失', s4.btnText === null, `btnText=${s4.btnText}`);

  check('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  console.log('\n===== 排队按钮出现轨迹 =====');
  queueTimeline.forEach((t) => {
    console.log(`${t.tag.padEnd(22)} btn=${String(t.btnText).padEnd(10)} pop=${t.popExists} stop=${t.stopBtn} parent=${t.popParent}`);
  });
} catch (err) {
  check(`探针执行异常：${err.message}`, false);
} finally {
  await browser.close();
  upstream.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n===== v26.9e：${results.length - failed.length}/${results.length} PASS =====`);
if (failed.length) { console.log('失败项：'); failed.forEach((f) => console.log(` - ${f.name}`)); }
process.exit(failed.length ? 1 : 0);
