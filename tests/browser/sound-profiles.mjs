import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.ANON_PLAYER_CHROMIUM });
const url = process.env.ANON_PLAYER_URL || 'http://127.0.0.1:4190/';
const presetRequests = '**/sounds/profiles/default/**';
after(() => browser.close());

const button = (page, name) => page.getByRole('button', { name, exact: true });
const selector = (page) => page.getByLabel('选择配置', { exact: true });
const volume = (page) => page.getByLabel('总音量', { exact: true });
const ready = (page) => page.waitForFunction(() => !document.querySelector('#sound-profile').disabled);
async function open(page) {
  await page.goto(url);
  await button(page, '音效').click();
  await ready(page);
}
async function reload(page) {
  await page.reload();
  await button(page, '音效').click();
  await ready(page);
}
async function stored(page, includeProfiles = false) {
  return page.evaluate((includeProfiles) => new Promise((resolve, reject) => {
    const request = indexedDB.open('anon-player', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(includeProfiles ? ['settings', 'soundProfiles'] : 'settings');
      const sounds = tx.objectStore('settings').get('sounds');
      const selection = tx.objectStore('settings').get('sound-profile-selection');
      const profiles = includeProfiles ? tx.objectStore('soundProfiles').getAll() : undefined;
      tx.oncomplete = () => {
        db.close();
        resolve({
          volume: sounds.result?.volume, selection: selection.result,
          ...(profiles && { profiles: profiles.result.map(({ settings, ...profile }) => ({
            ...profile, settings: { ...settings, assets: settings.assets.map(({ id, name, file }) => ({
              id, name, size: file.size, type: file.type,
            })) },
          })) }),
        });
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), includeProfiles);
}

async function saveFirstProfile(page) {
  await open(page);
  await volume(page).fill('0.21');
  await button(page, '保存当前配置').click();
  await page.getByLabel('配置名称').fill('QA A');
  await button(page, '保存').click();
  await button(page, '保存当前配置').waitFor();
  return selector(page).inputValue();
}

async function openProfileSave(page, action) {
  await button(page, '保存当前配置').click();
  await page.getByLabel('配置名称').fill(action === 'create' ? 'QA new' : 'QA A');
  if (action === 'overwrite conflicting name') {
    await button(page, '保存').click();
    await button(page, '更新原配置').waitFor();
    return '更新原配置';
  }
  return action === 'create' ? '保存' : '更新当前配置';
}

async function prepare(page) {
  const a = await saveFirstProfile(page);
  // Seed a second snapshot with actual decodable PCM audio to exercise async apply.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('anon-player', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['settings', 'soundProfiles'], 'readwrite');
      const read = tx.objectStore('settings').get('sounds');
      read.onsuccess = () => {
        const settings = read.result;
        settings.volume = .72;
        const wav = new ArrayBuffer(44 + 8820);
        const bytes = new Uint8Array(wav);
        const view = new DataView(wav);
        for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']]) {
          bytes.set(new TextEncoder().encode(text), offset);
        }
        for (const [offset, value] of [[4, wav.byteLength - 8], [16, 16], [24, 44100], [28, 88200], [40, 8820]]) view.setUint32(offset, value, true);
        for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
        settings.assets = [{ id: 'qa-clip', name: 'QA B.wav', file: new Blob([wav], { type: 'audio/wav' }) }];
        settings.groups.left.ids = ['qa-clip'];
        settings.groups.left.fixedId = 'qa-clip';
        tx.objectStore('soundProfiles').put({ id: 'qa-b', name: 'QA B', updatedAt: Date.now(), settings });
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await reload(page);
  return a;
}

async function openPresetPicker(page) {
  await button(page, '从预设选取').click();
  return page.getByRole('dialog', { name: '选择预设音效' });
}

async function removeSighFromRightClick(page) {
  await button(page, '右键').click();
  const sigh = page.locator('.sound-list li').filter({ has: button(page, '试听 叹气') });
  await button(sigh, '移除音效').click();
  await sigh.waitFor({ state: 'detached' });
  await button(page, '左键').click();
}

async function importPresets(page, group, ...names) {
  const picker = await openPresetPicker(page);
  for (const name of names) await picker.getByRole('checkbox', { name, exact: true }).check();
  await button(picker, `添加到${group}`).click();
}

function failNextPresetRequest(page) {
  return page.route(presetRequests, (route) => route.fulfill({ status: 503 }), { times: 1 });
}

test('a pending preset import blocks named saves and can be cancelled and retried', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await open(page);
  await removeSighFromRightClick(page);
  await button(page, '保存当前配置').click();
  const name = page.getByLabel('配置名称');
  await name.fill('After import');
  await page.route(presetRequests, () => {}, { times: 1 });
  const request = page.waitForRequest(presetRequests);
  await importPresets(page, '左键音效', '叹气');
  await request;
  assert.ok(await button(page, '保存').isDisabled());
  await name.press('Enter');
  assert.equal(await selector(page).getByRole('option', { name: 'After import', exact: true }).count(), 0);

  await button(page, '取消导入').click();
  assert.ok(await button(page, '从预设选取').isEnabled());
  assert.ok(await page.getByLabel('选择本地文件').isEnabled());
  assert.ok(await button(page, '保存').isEnabled());
  assert.equal(await button(page, '试听 叹气').count(), 0);

  await button(page, '重试预设导入').click();
  const retry = page.getByRole('dialog', { name: '选择预设音效' });
  assert.ok(await retry.getByRole('checkbox', { name: '叹气', exact: true }).isChecked());
  await button(retry, '添加到左键音效').click();
  await button(page, '试听 叹气').waitFor();
  assert.equal(await button(page, '重试预设导入').count(), 0);
  await button(page, '保存').click();
  await button(page, '保存当前配置').waitFor();
  const { profiles } = await stored(page, true);
  const profile = profiles.find(({ name }) => name === 'After import');
  assert.ok(profile.settings.groups.left.ids.includes('sigh'));
});

test('partial failures retry only missing presets and stay attached to their original group', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await open(page);
  await removeSighFromRightClick(page);
  const retry = (group) => button(page.getByRole('group', { name: group, exact: true }), '重试预设导入');

  await failNextPresetRequest(page);
  await importPresets(page, '左键音效', '叹气', '奶龙1');
  await button(page, '试听 奶龙1').waitFor();
  await retry('左键音效').waitFor();
  await importPresets(page, '左键音效', '奶龙2');
  await button(page, '试听 奶龙2').waitFor();
  assert.ok(await retry('左键音效').isVisible());

  await button(page, '结束').click();
  await importPresets(page, '结束音效', '奶龙1');
  await button(page, '试听 奶龙1').waitFor();
  assert.ok(await retry('左键音效').isVisible());

  const wow = page.locator('.sound-list li').filter({ has: button(page, '试听 wow') });
  await button(wow, '移除音效').click();
  await wow.waitFor({ state: 'detached' });
  await failNextPresetRequest(page);
  await importPresets(page, '结束音效', 'wow');
  await retry('结束音效').click();
  const picker = page.getByRole('dialog', { name: '选择预设音效' });
  assert.ok(await picker.getByRole('checkbox', { name: 'wow', exact: true }).isChecked());
  await button(picker, '添加到结束音效').click();
  await button(page, '试听 wow').waitFor();
  assert.equal(await retry('结束音效').count(), 0);

  await retry('左键音效').click();
  assert.ok(await picker.getByRole('checkbox', { name: '叹气', exact: true }).isChecked());
  const added = picker.getByRole('checkbox', { name: '奶龙1 已添加', exact: true });
  assert.ok(await added.isDisabled());
  assert.equal(await added.isChecked(), false);
  await button(picker, '添加到左键音效').click();
  await retry('左键音效').waitFor({ state: 'detached' });
  assert.equal(await button(page, '试听 叹气').count(), 0);
  await button(page, '左键').click();
  await button(page, '试听 叹气').waitFor();
  assert.equal(await button(page, '试听 奶龙1').count(), 1);
  assert.equal(await retry('左键音效').count(), 0);
});

test('keyboard audition keeps focus and ignores repeat activation while fetching a preset', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await open(page);
  await removeSighFromRightClick(page);
  let requests = 0;
  await page.route(presetRequests, () => { requests++; });
  const picker = await openPresetPicker(page);
  const preview = button(picker, '试听预设 叹气');
  await preview.focus();
  const request = page.waitForRequest(presetRequests);
  await page.keyboard.press('Enter');
  await request;
  await page.getByText('正在加载试听…', { exact: true }).waitFor();
  assert.ok(await preview.evaluate((element) => element === document.activeElement));
  assert.equal(await preview.getAttribute('aria-disabled'), 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden' });
  assert.equal(requests, 1);
});

test('presets can be reused across groups and survive reload without changing the fixed sound', async (t) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  t.after(() => page.close());
  await open(page);
  let fetched = 0;
  await page.route(presetRequests, (route) => { fetched++; return route.continue(); });
  const picker = await openPresetPicker(page);
  assert.ok(await picker.getByRole('checkbox', { name: '冰 已添加', exact: true }).isDisabled());
  await picker.getByRole('checkbox', { name: '叹气', exact: true }).check();
  await picker.getByRole('checkbox', { name: '奶龙1', exact: true }).check();
  await button(picker, '添加到左键音效').click();
  await button(page, '试听 叹气').waitFor();
  await button(page, '试听 奶龙1').waitFor();
  assert.equal(fetched, 0);
  assert.equal(await page.getByLabel('固定使用', { exact: true }).inputValue(), 'bing');
  const addedPicker = await openPresetPicker(page);
  assert.ok(await addedPicker.getByRole('checkbox', { name: '叹气 已添加', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  await page.unroute(presetRequests);
  await reload(page);
  await button(page, '试听 叹气').waitFor();
  await button(page, '试听 奶龙1').waitFor();
  await button(page, '右键').click();
  await button(page, '试听 叹气').waitFor();
});

test('switching profiles aborts a preset download without adding it to either group', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await prepare(page);
  await removeSighFromRightClick(page);
  await page.route(presetRequests, () => {});
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = (url, options) => {
      if (String(url).includes('/sounds/profiles/default/')) {
        options.signal.addEventListener('abort', () => { window.presetAborted = true; });
      }
      return fetch(url, options);
    };
  });
  const request = page.waitForRequest(presetRequests);
  await importPresets(page, '左键音效', '叹气');
  await request;
  await button(page, '右键').click();
  await selector(page).selectOption('qa-b');
  await page.waitForFunction(() => window.presetAborted);
  await ready(page);
  assert.equal(await selector(page).inputValue(), 'qa-b');
  assert.equal(await button(page, '试听 叹气').count(), 0);
  await button(page, '左键').click();
  assert.equal(await button(page, '试听 叹气').count(), 0);
  await button(page, '试听 QA B.wav').waitFor();
  assert.equal(await page.getByText('正在导入音效…', { exact: true }).count(), 0);
  assert.equal(await button(page, '重试预设导入').count(), 0);
});

test('only a successful profile replacement clears a preset retry', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const initialId = await prepare(page);
  await removeSighFromRightClick(page);
  const retry = button(page, '重试预设导入');

  await failNextPresetRequest(page);
  await importPresets(page, '左键音效', '叹气');
  await retry.waitFor();

  await failNextPresetRequest(page);
  page.once('dialog', (dialog) => dialog.accept());
  await button(page, '恢复默认音效').click();
  await page.getByText(/无法读取预设音效/).waitFor();
  await ready(page);
  assert.equal(await selector(page).inputValue(), initialId);
  assert.ok(await retry.isEnabled());

  await selector(page).selectOption('current');
  await ready(page);
  assert.equal(await selector(page).inputValue(), 'current');
  await retry.click();
  const picker = page.getByRole('dialog', { name: '选择预设音效' });
  assert.ok(await picker.getByRole('checkbox', { name: '叹气', exact: true }).isChecked());
  await button(picker, '取消').click();

  await selector(page).selectOption('qa-b');
  await button(page, '试听 QA B.wav').waitFor();
  assert.equal(await button(page, '试听 叹气').count(), 0);
  assert.equal(await retry.count(), 0);
});

test('reload during profile decoding keeps the old pair; successful apply commits the new pair', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const a = await prepare(page);
    await page.evaluate(() => {
      OfflineAudioContext.prototype.decodeAudioData = function () {
        window.decodeStarted = true;
        return new Promise(() => {});
      };
    });
    await selector(page).selectOption('qa-b');
    await page.waitForFunction(() => window.decodeStarted);
    assert.deepEqual(await stored(page), { volume: .21, selection: a });
    assert.equal(await selector(page).inputValue(), a);
    await reload(page);
    assert.equal(await selector(page).inputValue(), a);
    assert.equal(await volume(page).inputValue(), '0.21');

    await selector(page).selectOption('qa-b');
    await ready(page);
    assert.deepEqual(await stored(page), { volume: .72, selection: 'qa-b' });
    await reload(page);
    assert.equal(await selector(page).inputValue(), 'qa-b');
    assert.equal(await volume(page).inputValue(), '0.72');
    await page.getByText('QA B.wav', { exact: true }).waitFor();

    // A working edit remains independent from the saved profile after reload.
    await volume(page).fill('0.43');
    await selector(page).selectOption('current');
    await ready(page);
    assert.deepEqual(await stored(page), { volume: .43, selection: 'current' });
    await reload(page);
    assert.equal(await selector(page).inputValue(), 'current');
    assert.equal(await volume(page).inputValue(), '0.43');
    await selector(page).selectOption('qa-b');
    await ready(page);
    assert.equal(await volume(page).inputValue(), '0.72');
  } finally { await context.close(); }
});

test('aborting the settings/selection commit preserves both stored and applied settings', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const a = await prepare(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (args[1] === 'sound-profile-selection') this.transaction.abort();
        return request;
      };
    });
    await selector(page).selectOption('qa-b');
    await ready(page);
    await page.getByText('无法应用并保存所选音效配置。', { exact: true }).waitFor();
    assert.deepEqual(await stored(page), { volume: .21, selection: a });
    assert.equal(await selector(page).inputValue(), a);
    assert.equal(await volume(page).inputValue(), '0.21');
    await reload(page);
    assert.equal(await selector(page).inputValue(), a);
    assert.equal(await volume(page).inputValue(), '0.21');
  } finally { await context.close(); }
});

test('built-in option names are reserved, including surrounding whitespace', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await open(page);
    await button(page, '保存当前配置').click();
    for (const name of ['当前工作设置', '  当前工作设置  ', '默认配置', '  默认配置  ']) {
      await page.getByLabel('配置名称').fill(name);
      await button(page, '保存').click();
      await page.getByText(/该名称已留给/).waitFor();
      assert.equal(await selector(page).getByRole('option').count(), 2);
    }
    await page.getByLabel('配置名称').fill('QA valid');
    await button(page, '保存').click();
    await button(page, '保存当前配置').waitFor();
    await reload(page);
    assert.equal(await selector(page).getByRole('option').count(), 3);
    assert.equal(await selector(page).getByRole('option', { name: '当前工作设置', exact: true }).count(), 1);
  } finally { await context.close(); }
});

for (const action of ['update selected', 'create', 'overwrite conflicting name']) {
  test('failed named profile save rolls back all records: ' + action, async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const a = await saveFirstProfile(page);
      if (action !== 'update selected') {
        await selector(page).selectOption('current');
        await ready(page);
        // Keep a live slider edit uncommitted, so rollback must preserve the
        // previous working record as well as the named snapshot and selection.
        await volume(page).evaluate((input) => {
          input.value = '0.49';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      } else {
        await volume(page).fill('0.49');
      }
      const before = await stored(page, true);
      assert.equal(before.volume, action === 'update selected' ? .49 : .21);
      assert.equal(before.profiles.find(({ id }) => id === a).settings.volume, .21);
      const saveLabel = await openProfileSave(page, action);
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        window.abortNextSelectionSave = true;
        IDBObjectStore.prototype.put = function (...args) {
          const request = put.apply(this, args);
          if (args[1] === 'sound-profile-selection' && window.abortNextSelectionSave) {
            window.abortNextSelectionSave = false;
            this.transaction.abort();
          }
          return request;
        };
      });
      await button(page, saveLabel).click();
      await page.getByText('无法保存此音效配置。', { exact: true }).waitFor();
      assert.deepEqual(await stored(page, true), before);
      assert.equal(await selector(page).inputValue(), before.selection);
      assert.equal(await volume(page).inputValue(), '0.49');

      await reload(page);
      assert.equal(await selector(page).inputValue(), before.selection);
      assert.equal(await volume(page).inputValue(), String(before.volume));

      // A successful retry must persist all three records and survive reload.
      await volume(page).fill('0.49');
      const retryLabel = await openProfileSave(page, action);
      await button(page, retryLabel).click();
      await button(page, '保存当前配置').waitFor();
      const saved = await selector(page).inputValue();
      const { profiles, ...working } = await stored(page, true);
      assert.equal(profiles.find(({ id }) => id === saved).settings.volume, .49);
      assert.deepEqual(working, { volume: .49, selection: saved });
      await reload(page);
      assert.equal(await selector(page).inputValue(), saved);
      assert.equal(await volume(page).inputValue(), '0.49');
    } finally { await context.close(); }
  });
}
