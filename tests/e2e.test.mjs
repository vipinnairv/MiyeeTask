// End-to-end tests: real app in headless Chromium against tests/fake-firebase.js.
//   npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_ = 'file://' + ROOT + 'index.html';
const FAKE = readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
let browser, page;
const errors = [];

before(async () => {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if(u.startsWith('file:')) return r.continue();
    if(u.includes('firebase-app-compat')) return r.fulfill({ body: FAKE, contentType: 'application/javascript' });
    return r.fulfill({ body: '', contentType: u.endsWith('.css') ? 'text/css' : 'application/javascript' }); // no CDNs in tests
  });
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL_);
});
after(() => browser && browser.close());

const wait = ms => page.waitForTimeout(ms);
const shown = () => page.evaluate(() => [
  getComputedStyle(document.getElementById('login-gate')).display,
  getComputedStyle(document.getElementById('boot-splash')).display]);
const cloudTitles = () => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('__fs') || '{}');
  return Object.keys(s).filter(k => /\/(tasks|visions|projects)\//.test(k)).map(k => s[k].title);
});
const reload = async (ms = 1500) => { await page.reload(); await wait(ms); };
const editTask = (match, title) => page.evaluate(([m, t]) => {
  const task = D.tasks.find(x => x.title === m); openTaskModal(task.id);
  document.getElementById('t-title').value = t; return saveTask();
}, [match, title]);

test('start-up shows a splash, not the login form, while auth resolves', async () => {
  assert.deepEqual(await shown(), ['none', 'flex']);
  await wait(600);
  assert.deepEqual(await shown(), ['flex', 'none']);
});

test('sign in, set up profile, create goal and tasks', async () => {
  await page.fill('#gate-email', 'a@b.com'); await page.fill('#gate-pass', 'x'); await page.click('#gate-btn');
  await wait(500);
  await page.evaluate(async () => { document.getElementById('pw-name').value = 'Vipin'; await pwFinishPersonal(); });
  await page.evaluate(async () => {
    document.getElementById('vTitle').value = 'G1'; addVision();
    for(const n of ['T1', 'T2']){ openTaskModal(); document.getElementById('t-title').value = n; await saveTask(); }
  });
  await wait(1500);
  assert.deepEqual((await cloudTitles()).sort(), ['G1', 'T1', 'T2']);
});

test('refresh while signed in never shows the login form', async () => {
  await page.reload();
  const seen = new Set();
  for(let i = 0; i < 15; i++){ seen.add((await shown())[0]); await wait(100); }
  assert.ok(!seen.has('flex'));
  assert.deepEqual(await shown(), ['none', 'none']);
});

test('edits made just before a refresh survive and reach the cloud', async () => {
  await editTask('T1', 'T1-quick');
  await page.evaluate(() => { openVisionModal(D.visions[0].id); document.getElementById('ev-title').value = 'G1-quick'; saveVisionEdit(); });
  await reload(1800);
  const titles = await page.evaluate(() => [...D.tasks.map(t => t.title), ...D.visions.map(v => v.title)]);
  assert.ok(titles.includes('T1-quick') && titles.includes('G1-quick'), titles.join());
  assert.ok((await cloudTitles()).includes('T1-quick'));
});

test('project edits persist', async () => {
  await page.evaluate(() => {
    document.getElementById('pTitle').value = 'P1'; document.getElementById('pVision').value = String(D.visions[0].id); addProject();
    openProjectModal(D.projects[0].id); document.getElementById('ep-title').value = 'P1-ed'; saveProjectEdit();
  });
  await reload();
  assert.equal(await page.evaluate(() => D.projects[0]?.title), 'P1-ed');
});

test('a delete just before a refresh sticks', async () => {
  await page.evaluate(() => { deleteTask(D.tasks.find(x => x.title === 'T2').id); document.getElementById('confirm-ok').click(); });
  await reload(1800);
  assert.ok(!(await page.evaluate(() => D.tasks.some(t => t.title === 'T2'))));
  assert.ok(!(await cloudTitles()).includes('T2'));
});

test('changes from another device appear live, without a reload', async () => {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('__fs')); const k = Object.keys(s).find(k => k.includes('/tasks/'));
    __remoteWrite(k, { ...s[k], title: 'T1-remote' });
    __remoteWrite(k.replace(/\/[^/]+$/, '/999'), { id: 999, title: 'From phone', status: 'todo', priority: 'low' });
  });
  await wait(400);
  const titles = await page.evaluate(() => D.tasks.map(t => t.title));
  assert.ok(titles.includes('T1-remote') && titles.includes('From phone'), titles.join());
  assert.ok(await page.evaluate(() => document.body.innerText.includes('From phone')));
});

test('saving on one device does not overwrite records changed elsewhere', async () => {
  await page.evaluate(() => { fbStopLive(); });   // simulate a device that missed the update
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('__fs')); const k = Object.keys(s).find(k => k.endsWith('/tasks/999'));
    s[k].title = 'From phone v2'; localStorage.setItem('__fs', JSON.stringify(s)); });
  await page.evaluate(() => { document.getElementById('vTitle').value = 'G2'; addVision(); });
  await wait(1500);
  assert.ok((await cloudTitles()).includes('From phone v2'));
  await reload();
});

test('an edit that fails to sync survives a reload and uploads later', async () => {
  await page.evaluate(() => { window.__failCommit = true; });
  await editTask('T1-remote', 'T1-offline');
  await wait(1500);
  assert.match(await page.evaluate(() => document.getElementById('fb-sync-badge').textContent), /Not synced/);
  await reload(1800);
  assert.equal(await page.evaluate(() => D.tasks.find(t => t.title.startsWith('T1'))?.title), 'T1-offline');
  assert.ok((await cloudTitles()).includes('T1-offline'));
});

test('recurring task with a due time creates the next occurrence', async () => {
  const r = await page.evaluate(async () => {
    openTaskModal(); document.getElementById('t-title').value = 'R';
    document.getElementById('t-deadline').value = '2026-10-07T09:30'; document.getElementById('t-recurrence').value = 'daily';
    await saveTask(); toggleComplete(D.tasks.find(x => x.title === 'R').id);
    return D.tasks.filter(x => x.title === 'R').map(x => x.deadline + '/' + x.status);
  });
  assert.ok(r.includes('2026-10-08T09:30/todo'), r.join());
});

test('notes are sanitised before rendering', async () => {
  const out = await page.evaluate(() => sanitizeHTML('<p>Hi<img src=x onerror="alert(1)"><a href="javascript:alert(1)">l</a><script>alert(2)</script></p>'));
  assert.equal(out, '<p>Hi<img src="x"><a>l</a></p>');
});

test('large pasted images are shrunk; oversized tasks are refused', async () => {
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const ctx = c.getContext('2d');
    for(let i = 0; i < 4000; i++){ ctx.fillStyle = `hsl(${i % 360},80%,50%)`; ctx.fillRect(Math.random()*3000, Math.random()*2000, 40, 40); }
    const big = c.toDataURL('image/png');
    const small = await shrinkNoteImages(`<p><img src="${big}"></p>`);
    const huge = '<p>' + 'x'.repeat(1000 * 1024) + '</p>';
    openTaskModal(); document.getElementById('t-title').value = 'Huge';
    quillNotes = huge; if(quillFallback) document.getElementById('t-editor-fallback').value = huge;
    await saveTask();
    const im = new Image(); im.src = small.match(/src="([^"]+)"/)[1]; await im.decode();
    return { before: big.length, after: small.length, width: im.width, saved: D.tasks.some(t => t.title === 'Huge'),
             err: document.getElementById('modal-err').textContent };
  });
  assert.ok(r.after < r.before && r.width <= 1280, JSON.stringify({ b: r.before, a: r.after, w: r.width }));
  assert.equal(r.saved, false);
  assert.match(r.err, /too large/);
  await page.evaluate(() => closeTaskModal());
});

test('sign-out clears local data; the next account starts clean', async () => {
  await page.evaluate(() => fbSignOut()); await wait(800);
  assert.deepEqual(await shown(), ['flex', 'none']);
  assert.equal(await page.evaluate(() => localStorage.getItem('taskMasterPro_v8')), null);
  await page.fill('#gate-email', 'c@d.com'); await page.fill('#gate-pass', 'x'); await page.click('#gate-btn'); await wait(500);
  await page.evaluate(async () => { document.getElementById('pw-name').value = 'Other'; await pwFinishPersonal(); });
  await wait(1500);
  assert.equal(await page.evaluate(() => D.tasks.length), 0);
});

test('no uncaught page errors', () => { assert.deepEqual(errors, []); });
