import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chromium } from 'playwright';
import { flagFixture, leftFixture } from '../training-fixtures.mjs';

const browser = await chromium.launch({ executablePath: process.env.ANON_PLAYER_CHROMIUM });
const url = process.env.ANON_PLAYER_URL || 'http://127.0.0.1:4190/';
after(() => browser.close());

async function openPlayer(t, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.goto(url);
  await page.locator('.transport [aria-label="静音"]:not(:disabled)').waitFor();
  const load = (name, value) => page.getByLabel('录像文件', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
  const seek = (ms) => page.getByLabel('播放进度', { exact: true }).evaluate((input, ms) => {
    input.value = String(ms);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, ms);
  const remaining = (count) => page.locator('.training-readout').getByLabel(`剩余 ${count}`, { exact: true }).waitFor();
  return { page, load, seek, remaining };
}

test('JSON left training renders native layers, seeks and plays at the selected rate', async (t) => {
  const { page, load, seek, remaining } = await openPlayer(t);
  await load('left.json', leftFixture());
  await remaining(31);
  assert.match(await page.locator('.file-detail').textContent(), /左键训练.*初级/);
  assert.equal(await page.getByRole('heading', { name: '训练计数器', exact: true }).count(), 1);
  assert.equal(await page.locator('.replay-identifier').textContent(), '训练测试');
  await seek(15);
  await page.locator('.training-layers canvas').first().waitFor();
  assert.equal(await page.locator('.training-layers > :first-child').evaluate((element) => getComputedStyle(element).opacity), '0.5');
  await seek(620); await remaining(0);
  await seek(0); await remaining(31);
  await page.getByLabel('播放倍速', { exact: true }).selectOption('0.25');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await remaining(0);
  await page.getByRole('button', { name: '播放', exact: true }).waitFor();
});

test('flag training preserves first-release timing, back seeking and a raised flag in the native board', async (t) => {
  const { page, load, seek, remaining } = await openPlayer(t);
  await load('flag.json', flagFixture());
  await remaining(4);
  await seek(39); await remaining(4);
  await seek(40); await remaining(3);
  await seek(340); await remaining(0);
  await seek(0); await remaining(4);
  assert.match(await page.locator('.file-detail').textContent(), /标双训练/);
});

test('raw payload metadata can be cancelled and completed without disturbing the current replay or queue', async (t) => {
  const { page, load, remaining } = await openPlayer(t);
  await load('left.json', leftFixture()); await remaining(31);
  await page.getByRole('button', { name: '加入导出队列', exact: true }).click();
  await load('raw.json', flagFixture().replay);
  const dialog = page.getByRole('dialog', { name: '补全小游戏录像信息', exact: true });
  await dialog.waitFor();
  assert.equal(await page.getByLabel('游戏', { exact: true }).inputValue(), 'flag-chord');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await remaining(31);
  assert.equal(await page.locator('.load-error').count(), 0);
  await load('raw.json', flagFixture().replay);
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '打开录像', exact: true }).click();
  await remaining(4);
  await page.getByRole('button', { name: '加入导出队列', exact: true }).click();
  assert.deepEqual(await page.locator('.export-replay-text strong').allTextContents(), ['left.json', 'raw.json']);
});

test('malformed files and superseded metadata imports keep the last valid replay', async (t) => {
  const { page, load, remaining } = await openPlayer(t);
  await load('left.json', leftFixture()); await remaining(31);
  const invalid = flagFixture(); invalid.replay.specialEvents = [[20, 999, 0]];
  await load('broken.json', invalid);
  await page.locator('.load-error').waitFor();
  await remaining(31);
  await load('raw.json', flagFixture().replay);
  await page.getByRole('dialog', { name: '补全小游戏录像信息' }).waitFor();
  await load('flag.json', flagFixture());
  await remaining(4);
  assert.equal(await page.getByRole('dialog', { name: '补全小游戏录像信息' }).count(), 0);
  assert.equal(await page.locator('.load-error').count(), 0);
});

test('training counters persist separately, and the board fits a narrow viewport', async (t) => {
  const { page, load, remaining } = await openPlayer(t, { width: 360, height: 780 });
  await load('left.json', leftFixture()); await remaining(31);
  await page.getByLabel('开发者模式', { exact: true }).check();
  await page.getByLabel('计数器完整配置', { exact: true }).fill(JSON.stringify([['训练进度', 'solved || "/" || total']]));
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.deepEqual(await page.locator('.counter-name').allTextContents(), ['训练进度']);
  await page.getByRole('button', { name: '关闭录像', exact: true }).click();
  assert.equal(await page.locator('.counter-name').first().textContent(), 'time');
  await page.reload();
  await load('left.json', leftFixture()); await remaining(31);
  assert.deepEqual(await page.locator('.counter-name').allTextContents(), ['训练进度']);
  const bounds = await page.locator('.mine-board').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].flatMap((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1) ? [{ tag: element.tagName, class: element.className, right: rect.right }] : [];
  }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify(overflow.slice(0, 12)));
});

test('a mixed training queue exports a downloadable MP4 with audio', async (t) => {
  const { page, load, remaining } = await openPlayer(t);
  await load('left.json', leftFixture()); await remaining(31);
  await page.getByRole('button', { name: '加入导出队列', exact: true }).click();
  // Exercise the canonicalized raw payload when the exporter reopens its bytes.
  await load('flag.json', flagFixture(true).replay);
  await page.getByRole('dialog', { name: '补全小游戏录像信息' }).getByRole('button', { name: '打开录像', exact: true }).click();
  await remaining(15);
  await page.getByRole('button', { name: '加入导出队列', exact: true }).click();
  await page.getByLabel('第 1 局停留时间', { exact: true }).fill('0');
  await page.getByLabel('第 2 局停留时间', { exact: true }).fill('0');
  await page.getByLabel('视频预设', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: '生成 MP4', exact: true }).click();
  const download = page.getByRole('link', { name: '下载 MP4', exact: true });
  await download.waitFor({ timeout: 90000 });
  const videoInfo = await download.evaluate(async (link) => {
    const blob = await fetch(link.href).then((response) => response.blob());
    const video = document.createElement('video');
    video.muted = true;
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error(video.error?.message));
      video.src = link.href;
    });
    const contents = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    return { bytes: blob.size, width: video.videoWidth, height: video.videoHeight, duration: video.duration, audio: contents.includes('mp4a') };
  });
  assert.ok(videoInfo.bytes > 1000);
  assert.equal(videoInfo.width, 1280); assert.equal(videoInfo.height, 720);
  assert.equal(videoInfo.audio, true, 'export must contain an AAC audio track');
  assert.ok(videoInfo.duration >= 2.06 && videoInfo.duration < 30);
  const event = page.waitForEvent('download');
  await download.click();
  assert.equal(await (await event).failure(), null);
});
