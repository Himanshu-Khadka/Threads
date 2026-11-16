import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

// Exercise the compiled bundle against a tiny host double, never a real account.
const notes = new Map();
const secrets = new Map();
let persisted;
let calls = [];
let remoteContent = '';
let folderCreates = 0;
const folders = [];
let settingsTab;
const activeNote = { basename: 'Original', path: 'School/Course/Original.md', extension: 'md', stat: { size: 12 } };
const originalContent = '# Original\n';
const app = {
  workspace: { getActiveFile: () => activeNote },
  secretStorage: {
    getSecret: key => secrets.get(key) ?? null,
    setSecret: (key, value) => secrets.set(key, value),
  },
  vault: {
    getName: () => 'Smoke Vault',
    configDir: '.obsidian',
    read: async () => originalContent,
    create: async (path, content) => {
      assert(!notes.has(path), 'Must not overwrite notes');
      notes.set(path, content);
    },
  },
};
const element = () => ({ empty() {}, addClass() {}, setText() {}, setAttribute() {} });
const controls = [];
function control() {
  const c = {
    inputEl: {},
    setValue() { return c; }, setDisabled() { return c; }, setPlaceholder() { return c; },
    onChange() { return c; }, setButtonText(text) { c.text = text; return c; },
    onClick(callback) { c.callback = callback; return c; }, setCta() { return c; },
  };
  controls.push(c);
  return c;
}
class Plugin {
  commands = [];
  constructor(app) { this.app = app; }
  async loadData() { return persisted ? structuredClone(persisted) : null; }
  async saveData(data) { persisted = structuredClone(data); }
  addStatusBarItem() { return element(); }
  addSettingTab(tab) { settingsTab = tab; }
  addCommand(command) { this.commands.push(command); }
}
class PluginSettingTab {
  containerEl = element();
}
class Setting {
  setName() { return this; } setDesc() { return this; } setHeading() { return this; }
  setClass() { return this; }
  addText(callback) { callback(control()); return this; }
  addButton(callback) { callback(control()); return this; }
}
async function requestUrl(req) {
  calls.push(req);
  let result;
  if (req.url === 'https://oauth2.googleapis.com/token') {
    result = { access_token: 'smoke-access', refresh_token: 'smoke-refresh', token_type: 'Bearer', expires_in: 3600 };
  } else if (req.url.includes('/about?')) result = { user: { emailAddress: 'test@example.invalid' } };
  else if (req.url.includes('/upload/drive/')) {
    const boundary = req.headers['Content-Type'].split('boundary=')[1];
    const contentPart = req.body.split(`--${boundary}`)[2];
    remoteContent = contentPart.slice(contentPart.indexOf('\r\n\r\n') + 4, -2);
    result = { id: 'sample-file' };
  } else if (req.url.includes('?alt=media')) return { status: 200, text: remoteContent };
  else if (req.method === 'GET' && new URL(req.url).searchParams.has('q')) {
    const query = new URL(req.url).searchParams.get('q');
    result = { files: folders.filter(folder => query.includes(`'${folder.parents?.[0]}' in parents`) &&
      query.includes(`name = '${folder.name}'`) && query.includes(`value = '${folder.appProperties.threadsRole}'`)) };
  }
  else if (req.method === 'POST') {
    folderCreates++;
    const metadata = JSON.parse(req.body);
    const role = metadata.appProperties.threadsRole;
    result = { id: role === 'note-copies' ? 'note-folder' : role === 'connection-test' ? 'test-folder' : `child-${folderCreates}` };
    folders.push({ ...metadata, ...result });
  }
  else result = { mimeType: 'application/vnd.google-apps.folder', trashed: false, appProperties: { threadsRole: req.url.includes('test-folder') ? 'connection-test' : 'note-copies' } };
  return { status: 200, text: JSON.stringify(result) };
}
const originalLoad = Module._load;
Module._load = function(id, ...args) {
  if (id === 'obsidian') return { Plugin, PluginSettingTab, Setting, Notice: class {}, requestUrl };
  if (id === 'electron') return { shell: { openExternal: async raw => {
    const url = new URL(raw);
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: url.searchParams.get('state'), code: 'smoke-code' }).toString();
    await fetch(callback);
  } } };
  return originalLoad.call(this, id, ...args);
};
try {
  const Threads = createRequire(import.meta.url)('../main.js').default;
  const plugin = new Threads(app);
  await plugin.onload();
  assert.equal(calls.length, 0, 'No startup network requests');
  assert.equal(plugin.commands.length, 4);
  settingsTab.display();
  assert(controls.some(c => c.text === 'Run sample test'));
  await plugin.saveCredentials('smoke.apps.googleusercontent.com', 'smoke-secret');
  await plugin.connect();
  assert.match(plugin.status, /^Connected:/);
  await Promise.all([plugin.test(), plugin.test()]);
  assert.equal(notes.size, 1, 'Concurrent button clicks must not overlap');
  assert.match(plugin.status, /test passed/);
  await plugin.test();
  assert.equal(notes.size, 2);
  assert.equal(folderCreates, 1);
  await plugin.saveFolderName('My Knowledge');
  await plugin.uploadCurrentNote();
  assert.match(plugin.status, /^Uploaded and verified:/);
  assert.equal(notes.size, 2, 'Manual uploads never change or create local notes');
  assert.equal(remoteContent, originalContent);
  assert.equal(folderCreates, 5);
  assert.match(plugin.settings.lastUpload, /My Knowledge\/Smoke Vault\/School\/Course\/Original/);
  const upload = calls.filter(req => req.url.includes('/upload/drive/')).at(-1);
  assert(upload.body.includes('"parents":["child-5"]'), 'Note must be uploaded under its deepest folder');
  await plugin.uploadCurrentNote();
  assert.match(plugin.status, /^Uploaded and verified:/);
  assert.equal(folderCreates, 5, 'Repeated note uploads reuse the entire folder hierarchy');
  await plugin.checkConnection();
  assert.match(plugin.status, /^Connected:/);
  assert(!JSON.stringify(persisted).includes('smoke-secret'));
  assert(!JSON.stringify(persisted).includes('smoke-refresh'));
  assert.match(secrets.get(persisted.credentialKey), /smoke-refresh/);
  plugin.onunload();
  const reloaded = new Threads(app);
  await reloaded.onload();
  const beforeRefresh = calls.filter(req => req.url.includes('/token')).length;
  await reloaded.checkConnection();
  assert.match(reloaded.status, /^Connected:/);
  assert.equal(calls.filter(req => req.url.includes('/token')).length, beforeRefresh + 1, 'Restart must use the stored refresh token');
  reloaded.onunload();
  const clearing = new Threads(app);
  await clearing.onload();
  await clearing.clearCredentials();
  assert.equal(secrets.get(persisted.credentialKey), '');
  clearing.onunload();
  const count = calls.length;
  await plugin.test();
  assert.equal(calls.length, count, 'No operations after unload');
  settingsTab.hide();
  persisted = { driveFolderName: 'Tutorial folder' };
  secrets.set('threads-google-desktop-client', JSON.stringify({ clientId: 'tutorial.apps.googleusercontent.com', clientSecret: 'tutorial-secret' }));
  secrets.set('threads-google-tokens', JSON.stringify({ refreshToken: 'tutorial-grant' }));
  const migrated = new Threads(app);
  await migrated.onload();
  assert.equal(migrated.settings.driveFolderName, 'Tutorial folder');
  assert.equal(migrated.credentials().clientId, 'tutorial.apps.googleusercontent.com');
  assert.equal(migrated.credentials().refreshToken, undefined, 'Migration requires fresh authorization');
  assert(!JSON.stringify(persisted).includes('tutorial-secret'));
  await migrated.clearCredentials();
  migrated.onunload();
  const afterClear = new Threads(app);
  await afterClear.onload();
  assert.equal(afterClear.credentials().clientId, '', 'Cleared tutorial credentials must not reappear');
  afterClear.onunload();
  console.log('Compiled plugin smoke test passed: lifecycle, UI controls, login, round trips, manual upload, restart refresh, migration, clear, and unload.');
} finally { Module._load = originalLoad; }
