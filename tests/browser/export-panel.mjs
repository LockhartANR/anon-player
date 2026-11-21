import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.ANON_PLAYER_CHROMIUM });
const url = process.env.ANON_PLAYER_URL || 'http://127.0.0.1:4190/';
after(() => browser.close());

async function openMusic(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(url);
  await page.locator('.transport [aria-label="静音"]:not(:disabled)').waitFor();
  // Control decoding to exercise cancellation independently of audio codecs.
  await page.evaluate(() => {
    window.musicDecodes = [];
    OfflineAudioContext.prototype.decodeAudioData = function () {
      if (!window.deferMusicDecode) return Promise.resolve(this.createBuffer(1, 441, 44100));
      return new Promise((resolve) => window.musicDecodes.push(() => resolve(this.createBuffer(1, 441, 44100))));
    };
  });
  const select = page.getByLabel('背景音乐', { exact: true });
  const load = (name) => page.locator('.export-panel input[type="file"]').setInputFiles({ name, mimeType: 'audio/wav', buffer: Buffer.from([0]) });
  const selected = (name) => select.getByRole('option', { name, exact: true }).waitFor({ state: 'attached' });
  const cancel = page.getByRole('button', { name: '取消读取音乐', exact: true });
  await load('previous.wav');
  await selected('previous.wav');
  return { page, select, load, selected, cancel };
}

test('a stalled music download can be cancelled while preserving the previous selection', async (t) => {
  const { page, select, cancel } = await openMusic(t);
  await page.route('**/audio/music/**', () => {});
  const preset = await select.locator('option[value^="preset:"]').first().getAttribute('value');
  const request = page.waitForRequest('**/audio/music/**');
  await select.selectOption(preset);
  const download = await request;
  const aborted = page.waitForEvent('requestfailed', (request) => request === download);
  await cancel.click();
  assert.equal((await aborted).failure().errorText, 'net::ERR_ABORTED');
  assert.equal(await select.isEnabled(), true);
  assert.equal(await select.locator('option:checked').textContent(), 'previous.wav');
  await select.selectOption('none');
  assert.equal(await select.inputValue(), 'none');
});

test('cancelled decoding cannot commit music or unlock a newer loading task', async (t) => {
  const { page, select, load, selected, cancel } = await openMusic(t);
  await page.evaluate(() => { window.deferMusicDecode = true; });
  await load('cancelled.wav');
  await page.waitForFunction(() => window.musicDecodes.length === 1);
  await cancel.click();
  assert.equal(await select.isEnabled(), true);
  await load('new.wav');
  await page.waitForFunction(() => window.musicDecodes.length === 2);
  await page.evaluate(async () => {
    window.musicDecodes[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(await select.isDisabled(), true);
  assert.equal(await cancel.isVisible(), true);
  assert.equal(await select.locator('option:checked').textContent(), 'previous.wav');
  await page.evaluate(() => window.musicDecodes[1]());
  await selected('new.wav');
  assert.equal(await select.isEnabled(), true);
});
