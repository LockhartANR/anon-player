import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.ANON_PLAYER_CHROMIUM, headless: true });
const url = process.env.ANON_PLAYER_URL || 'http://127.0.0.1:4190/';
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
async function stored(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('anon-player', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('settings');
      const sounds = tx.objectStore('settings').get('sounds');
      const selection = tx.objectStore('settings').get('sound-profile-selection');
      tx.oncomplete = () => { db.close(); resolve({ volume: sounds.result?.volume, selection: selection.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

async function storedProfiles(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('anon-player', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('soundProfiles');
      const profiles = tx.objectStore('soundProfiles').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve(profiles.result.map(({ settings, ...profile }) => ({
          ...profile, settings: { ...settings, assets: settings.assets.map(({ id, name, file }) => ({
            id, name, size: file.size, type: file.type,
          })) },
        })));
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
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

test('reload during profile decoding keeps the old pair; successful apply commits the new pair', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const a = await prepare(page);
    await page.evaluate(() => {
      const decode = OfflineAudioContext.prototype.decodeAudioData;
      OfflineAudioContext.prototype.decodeAudioData = function (data) {
        window.decodeStarted = true;
        return new Promise((resolve, reject) => {
          window.finishDecode = () => decode.call(this, data).then(resolve, reject);
        });
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
      const before = await stored(page);
      const profilesBefore = await storedProfiles(page);
      assert.equal(before.volume, action === 'update selected' ? .49 : .21);
      assert.equal(profilesBefore.find(({ id }) => id === a).settings.volume, .21);
      await button(page, '保存当前配置').click();
      await page.getByLabel('配置名称').fill(action === 'create' ? 'QA new' : 'QA A');
      if (action === 'overwrite conflicting name') {
        await button(page, '保存').click();
        await button(page, '更新原配置').waitFor();
      }
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
      const saveLabel = { 'update selected': '更新当前配置', create: '保存', 'overwrite conflicting name': '更新原配置' }[action];
      await button(page, saveLabel).click();
      await page.getByText('无法保存此音效配置。', { exact: true }).waitFor();
      assert.deepEqual(await stored(page), before);
      assert.deepEqual(await storedProfiles(page), profilesBefore);
      assert.equal(await selector(page).inputValue(), before.selection);
      assert.equal(await volume(page).inputValue(), '0.49');

      await reload(page);
      assert.equal(await selector(page).inputValue(), before.selection);
      assert.equal(await volume(page).inputValue(), String(before.volume));
      await selector(page).selectOption('current');
      await ready(page);
      await selector(page).selectOption(a);
      await ready(page);
      assert.equal(await volume(page).inputValue(), '0.21');

      // A successful retry must persist all three records and survive reload.
      await volume(page).fill('0.49');
      await button(page, '保存当前配置').click();
      if (action === 'create') await page.getByLabel('配置名称').fill('QA new');
      await button(page, action === 'create' ? '保存' : '更新当前配置').click();
      await button(page, '保存当前配置').waitFor();
      const saved = await selector(page).inputValue();
      assert.equal((await storedProfiles(page)).find(({ id }) => id === saved).settings.volume, .49);
      assert.deepEqual(await stored(page), { volume: .49, selection: saved });
      await reload(page);
      assert.equal(await selector(page).inputValue(), saved);
      assert.equal(await volume(page).inputValue(), '0.49');
    } finally { await context.close(); }
  });
}
