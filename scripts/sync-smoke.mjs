import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

class TFile {
  constructor(path) { this.path = path; this.extension = 'md'; this.basename = path.split('/').at(-1).slice(0, -3); this.stat = { size: 10 }; }
}
class TFolder { constructor(path) { this.path = path; } }
const element = () => ({ empty() {}, addClass() {}, setText() {}, setAttribute() {}, createEl() {} });
function control() {
  const c = { inputEl: {}, setValue() { return c; }, setDisabled() { return c; }, setPlaceholder() { return c; },
    onChange() { return c; }, setButtonText() { return c; }, onClick() { return c; }, setCta() { return c; }, addOption() { return c; } };
  return c;
}
class Setting {
  setName() { return this; } setDesc() { return this; } setHeading() { return this; } setClass() { return this; }
  addText(fn) { fn(control()); return this; } addButton(fn) { fn(control()); return this; }
  addToggle(fn) { fn(control()); return this; } addDropdown(fn) { fn(control()); return this; }
}
class Plugin {
  constructor(app) { this.app = app; this.manifest = { id: 'threads-sync' }; this.events = []; }
  async loadData() { return this.app.persisted ? structuredClone(this.app.persisted) : null; }
  async saveData(value) { this.app.persisted = structuredClone(value); }
  addStatusBarItem() { return element(); } addSettingTab() {} addCommand() {}
  registerEvent(event) { this.events.push(event); }
}
class PluginSettingTab { containerEl = element(); }
function app(name, content = {}) {
  const files = new Map(); const text = new Map(); const secrets = new Map(); const handlers = new Map();
  const put = (path, body) => {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) files.set(parts.slice(0, i).join('/'), new TFolder(parts.slice(0, i).join('/')));
    files.set(path, new TFile(path)); text.set(path, body);
  };
  for (const [path, body] of Object.entries(content)) put(path, body);
  return {
    text, secrets,
    edit(path, body) { put(path, body); for (const callback of handlers.get('modify') ?? []) callback(files.get(path)); },
    workspace: { getActiveFile: () => [...files.values()].find(f => f instanceof TFile) ?? null, onLayoutReady: callback => callback() },
    secretStorage: { getSecret: key => secrets.get(key) ?? null, setSecret: (key, value) => secrets.set(key, value) },
    vault: {
      configDir: '.obsidian', getName: () => name,
      on(event, callback) { handlers.set(event, [...handlers.get(event) ?? [], callback]); return {}; },
      getMarkdownFiles: () => [...files.values()].filter(f => f instanceof TFile),
      getAllLoadedFiles: () => [...files.values()],
      getAbstractFileByPath: path => files.get(path) ?? null,
      read: async file => text.get(file.path),
      createFolder: async path => { assert(!files.has(path)); files.set(path, new TFolder(path)); },
      create: async (path, body) => { assert(!files.has(path), 'Create never overwrites'); put(path, body); },
      process: async (file, callback) => { const body = callback(text.get(file.path)); text.set(file.path, body); return body; },
      adapter: { write: async () => {} },
    },
  };
}

const cloud = new Map();
let sequence = 0; let requests = 0; let offline = false; let accountId = 'account-one';
async function requestUrl(req) {
  requests++;
  if (offline) throw new Error('offline');
  const url = new URL(req.url);
  let data;
  if (url.hostname === 'oauth2.googleapis.com') data = { access_token: 'fake-access', token_type: 'Bearer', expires_in: 3600 };
  else if (url.pathname.endsWith('/about')) data = { user: { emailAddress: 'test@example.invalid', permissionId: accountId } };
  else if (url.pathname.endsWith('/generateIds')) data = { ids: [`revision-${++sequence}`] };
  else if (url.pathname.includes('/upload/')) {
    const boundary = req.headers['Content-Type'].split('boundary=')[1];
    const parts = req.body.split(`--${boundary}`);
    const metadata = JSON.parse(parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4).trim());
    const body = parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4, -2);
    if (cloud.has(metadata.id)) return { status: 409, text: '{}' };
    cloud.set(metadata.id, { ...metadata, size: String(Buffer.byteLength(body)), body });
    data = { id: metadata.id };
  } else if (req.method === 'POST') {
    const metadata = JSON.parse(req.body); const id = `folder-${++sequence}`;
    cloud.set(id, { ...metadata, id }); data = { id };
  } else if (url.searchParams.has('q')) {
    const q = url.searchParams.get('q');
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    const name = q.match(/name = '([^']+)'/)?.[1];
    const props = [...q.matchAll(/key = '([^']+)' and value = '([^']+)'/g)];
    data = { files: [...cloud.values()].filter(file => (!parent || file.parents?.includes(parent)) &&
      (!name || file.name === name) && props.every(([, key, value]) => file.appProperties?.[key] === value)) };
  } else {
    const file = cloud.get(url.pathname.split('/').at(-1));
    if (!file) return { status: 404, text: '{}' };
    if (url.searchParams.get('alt') === 'media') return { status: 200, text: file.body };
    data = file;
  }
  return { status: 200, text: JSON.stringify(data) };
}
const originalLoad = Module._load;
Module._load = function(id, ...args) {
  if (id === 'obsidian') return { Plugin, PluginSettingTab, Setting, TFile, TFolder, Modal: class {}, Notice: class {}, requestUrl };
  return originalLoad.call(this, id, ...args);
};
const live = [];
const waitIdle = async plugin => {
  for (let i = 0; i < 100 && (!plugin.status.startsWith('Synced:') || plugin.busy); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(plugin.status, /^Synced:/);
};
try {
  const Threads = createRequire(import.meta.url)('../main.js').default;
  const first = app('Windows', { 'School/Note.md': 'initial', '.obsidian/private.md': 'never-upload' });
  const a = new Threads(first); live.push(a); await a.onload();
  assert.equal(requests, 0);
  first.secrets.set(a.settings.credentialKey, JSON.stringify({ clientId: 'example.apps.googleusercontent.com', clientSecret: 'fake-client', refreshToken: 'fake-refresh' }));
  await a.startSync(); await waitIdle(a);
  assert.equal([...cloud.values()].filter(f => f.appProperties?.threadsRole === 'revision-v1').length, 1);
  assert(!JSON.stringify([...cloud.values()]).includes('never-upload'));
  const second = app('Mac'); const b = new Threads(second); live.push(b); await b.onload();
  second.secrets.set(b.settings.credentialKey, JSON.stringify({ clientId: 'example.apps.googleusercontent.com', clientSecret: 'fake-client', refreshToken: 'fake-refresh' }));
  await b.loadCloudVaults(); assert.equal(b.cloudVaults.length, 1);
  await b.startSync(a.settings.sync.vaultId); await waitIdle(b);
  assert.equal(second.text.get('School/Note.md'), 'initial');
  first.edit('School/Note.md', 'changed'); a.scheduleSync(0); await new Promise(resolve => setTimeout(resolve, 30));
  await b.syncNow(); assert.equal(second.text.get('School/Note.md'), 'changed');
  offline = true; first.edit('School/Note.md', 'offline edit'); await a.syncNow();
  assert.match(a.status, /could not be reached/); assert.equal(first.text.get('School/Note.md'), 'offline edit');
  offline = false; await a.syncNow(); await b.syncNow(); assert.equal(second.text.get('School/Note.md'), 'offline edit');
  first.edit('School/Note.md', 'A edit'); second.edit('School/Note.md', 'B edit');
  await a.syncNow(); await b.syncNow();
  assert.deepEqual(b.conflicts, ['School/Note.md']);
  assert.equal(second.text.get('School/Note.md'), 'B edit');
  assert([...second.text.keys()].some(path => path.startsWith('_Threads conflicts/')));
  await b.syncNow(true, 'School/Note.md'); await a.syncNow(); assert.equal(first.text.get('School/Note.md'), 'B edit');
  first.edit('School/Note.md', 'cloud race'); await a.syncNow();
  const processFile = second.vault.process;
  second.vault.process = async (file, callback) => {
    second.text.set(file.path, 'typed during download');
    return processFile(file, callback);
  };
  await b.syncNow(); assert.equal(second.text.get('School/Note.md'), 'typed during download');
  second.vault.process = processFile;
  await b.syncNow(); assert.deepEqual(b.conflicts, ['School/Note.md']);
  await b.syncNow(true, 'School/Note.md'); await a.syncNow();
  const size = cloud.size; accountId = 'other-account'; await a.syncNow();
  assert.match(a.status, /another Google account/); assert.equal(cloud.size, size); accountId = 'account-one';
  await a.setAutoSync(false); assert.equal(first.persisted.autoSync, false);
  a.onunload();
  const restarted = new Threads(first); live.push(restarted); await restarted.onload(); await restarted.syncNow();
  assert.match(restarted.status, /^Synced:/);
  assert(!JSON.stringify(first.persisted).includes('fake-refresh'));
  await restarted.clearCredentials(); assert.equal(restarted.settings.autoSync, false);
  restarted.onunload(); b.onunload();
  const before = requests; await restarted.syncNow(); assert.equal(requests, before);
  console.log('Automatic sync smoke passed: two devices, nested folders, event scheduling, offline retry, conflicts, account isolation, pause, restart, disconnect, and unload.');
} finally {
  for (const plugin of live) plugin.onunload();
  Module._load = originalLoad;
}
