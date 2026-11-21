import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.ANON_PLAYER_CHROMIUM });
const url = process.env.ANON_PLAYER_URL || 'http://127.0.0.1:4190/';
const viewport = { width: 320, height: 420 };
after(() => browser.close());

async function openCounters(t, options) {
  const page = await browser.newPage(options);
  t.after(() => page.close());
  await page.goto(url);
  const rows = page.locator('.counter-table tr[data-counter-id]');
  await rows.first().waitFor();
  return { page, rows, order: () => rows.locator('.counter-name').allTextContents() };
}

async function openTouchCounters(t) {
  const fixture = await openCounters(t, { viewport, isMobile: true, hasTouch: true });
  const client = await fixture.page.context().newCDPSession(fixture.page);
  return { ...fixture, touch: (type, ...touchPoints) => client.send('Input.dispatchTouchEvent', { type, touchPoints }) };
}

function positionHandle(handle, y) {
  return handle.evaluate((element, y) => {
    const bounds = element.getBoundingClientRect();
    window.scrollBy(0, bounds.top + bounds.height / 2 - y);
    return { x: bounds.left + bounds.width / 2, y };
  }, y);
}

test('counter actions leave room for long values on a narrow touch viewport', async (t) => {
  const { rows } = await openCounters(t, { viewport, isMobile: true, hasTouch: true });
  const row = rows.first();
  const value = row.locator('.counter-result');
  const actions = row.locator('.counter-row-actions');
  await value.evaluate((element) => { element.textContent = '9'.repeat(72); });
  const valueBox = await value.boundingBox();
  const actionsBox = await actions.boundingBox();
  assert.ok(valueBox && actionsBox);
  assert.ok(valueBox.x + valueBox.width <= actionsBox.x, 'row actions overlap the counter value');
  assert.ok(await value.evaluate((element) => element.scrollWidth <= element.clientWidth), 'long counter value is clipped');
});

test('counter actions are visible when reached with the keyboard', async (t) => {
  const { page, rows } = await openCounters(t);
  const edit = rows.first().getByRole('button', { name: '编辑 time', exact: true });
  const focused = () => edit.evaluate((element) => element === document.activeElement);
  for (let i = 0; i < 24 && !await focused(); i++) await page.keyboard.press('Tab');
  assert.ok(await focused(), 'tab navigation skipped the first counter action');
  assert.equal(await edit.evaluate((element) => getComputedStyle(element.parentElement).opacity), '1');
});

test('only a drop inside the table persists the new order', async (t) => {
  const { page, rows, order } = await openCounters(t, { viewport: { width: 1100, height: 800 } });
  const initial = await order();
  const source = rows.first().locator('.counter-drag-handle');
  for (const releaseOutside of [true, false]) {
    await rows.first().hover();
    const handle = await source.boundingBox();
    const target = await rows.nth(1).boundingBox();
    assert.ok(handle && target);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height * .75);
    await rows.nth(1).and(page.locator('.is-drop-after')).waitFor({ state: 'attached' });
    if (releaseOutside) await page.mouse.move(8, 8);
    await page.mouse.up();
    assert.deepEqual(await order(), releaseOutside ? initial : [initial[1], initial[0], ...initial.slice(2)]);
  }
  await page.reload();
  await rows.first().waitFor();
  assert.deepEqual(await order(), [initial[1], initial[0], ...initial.slice(2)]);
});

test('a short touch near either viewport edge does not scroll or reorder counters', async (t) => {
  const { page, rows, order, touch } = await openTouchCounters(t);
  const handle = rows.nth(3).locator('.counter-drag-handle');
  const initial = await order();
  for (const y of [24, viewport.height - 24]) {
    const point = await positionHandle(handle, y);
    const before = await page.evaluate(() => window.scrollY);
    await touch('touchStart', point);
    await touch('touchMove', { ...point, y: y + 2 });
    assert.equal(await page.locator('.is-dragging, .is-drop-before, .is-drop-after').count(), 0);
    await touch('touchEnd');
    assert.equal(await page.evaluate(() => window.scrollY), before, 'a short touch scrolled the page');
    assert.deepEqual(await order(), initial);
  }
});

test('touch dragging scrolls at the edge and drops outside the list are ignored', async (t) => {
  const { page, rows, order, touch } = await openTouchCounters(t);
  const point = await positionHandle(rows.first().locator('.counter-drag-handle'), 176);
  const initial = await order();
  const y = viewport.height - 8;
  await touch('touchStart', point);
  await touch('touchMove', { ...point, y });
  await page.waitForFunction((y) => document.querySelector('.counter-table').getBoundingClientRect().bottom <= y, y);
  await touch('touchEnd');
  assert.deepEqual(await order(), initial);
});
