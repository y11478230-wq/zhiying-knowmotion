import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startServer(t) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DEEPSEEK_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/api/status`)).ok) return base; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('测试服务未能启动');
}

test('创意发现页面和四阶段导航已进入静态入口', async () => {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="view-creative"/);
  assert.match(html, /01<\/b>创意发现/);
  assert.match(html, /04<\/b>导出分享/);
});

test('导演方案包含镜头操作和确认式 AI 修改入口', async () => {
  const [html, app] = await Promise.all([
    fs.readFile(path.join(root, 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'app.js'), 'utf8')
  ]);
  assert.match(html, /id="scene-ai-dialog"/);
  assert.match(app, /data-scene-action="lock"/);
  assert.match(app, /data-scene-action="copy"/);
  assert.match(app, /pendingSceneRevision/);
  assert.match(app, /scene-ai-apply/);
});

test('原有本地存储键保持兼容', async () => {
  const app = await fs.readFile(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /zhiying-projects-v2/);
  assert.match(app, /zhiying-history-v2/);
  assert.match(app, /zhiying-project-v1/);
});

test('第三阶段视频工作台包含 Canvas、镜头时间轴与版本恢复', async () => {
  const [html, app, css] = await Promise.all([
    fs.readFile(path.join(root, 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'light.css'), 'utf8')
  ]);
  assert.match(html, /id="view-video-workspace"/);
  assert.match(html, /id="video-stage"/);
  assert.match(html, /id="shot-timeline"/);
  assert.match(html, /id="refresh-shot-preview"/);
  assert.match(app, /recordSceneVersion/);
  assert.match(app, /scene\._history\.slice\(0,12\)/);
  assert.match(app, /openSceneAi\(activeIndex\)/);
  assert.match(css, /max-width:700px/);
});

test('服务输出创意页面并对无效请求返回真实错误', async t => {
  const base = await startServer(t);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /view-creative/);

  const invalid = await fetch(`${base}/api/creative`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(invalid.status, 400);

  const unconfigured = await fetch(`${base}/api/creative`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '解释概率论', audience: '初中生', style: '清晰讲解', targetDurationSec: 60 })
  });
  assert.equal(unconfigured.status, 503);
  assert.match((await unconfigured.json()).error, /API Key/);

  const sceneRevision = await fetch(`${base}/api/scene/revise`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: 'C 语言', instruction: '解释得更简单', scene: { title: '入口', narration: 'main 是入口。', layout: 'code', duration: 8 } })
  });
  assert.equal(sceneRevision.status, 503);
  assert.match((await sceneRevision.json()).error, /API Key/);
});
