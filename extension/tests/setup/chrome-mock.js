// In-memory mock of the chrome.* extension APIs used by the modules under test.
// Import this module FIRST in every test file so `globalThis.chrome` exists
// before any production module runs.

function createStorageArea() {
  let data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result = {};
      for (const k of keyList) {
        if (k in data) result[k] = structuredClone(data[k]);
        else if (!Array.isArray(keys) && typeof keys === 'object' && keys[k] !== undefined) result[k] = keys[k];
      }
      return result;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
    async remove(keys) {
      for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k];
    },
    async clear() {
      data = {};
    },
    /** Test helper: inspect the raw store. */
    _dump() {
      return structuredClone(data);
    },
  };
}

export function installChromeMock() {
  const mock = {
    storage: {
      sync: createStorageArea(),
      local: createStorageArea(),
    },
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      // Supports both promise style (bg scripts) and callback style (pages).
      // Tests can set _messageHandler to script responses per action.
      _messageHandler: null,
      sendMessage(message, callback) {
        const handler = this._messageHandler;
        const result = Promise.resolve(handler ? handler(message) : {});
        if (typeof callback === 'function') {
          result.then((r) => callback(r)).catch(() => callback({ error: 'mock error' }));
          return undefined;
        }
        return result;
      },
      getManifest: () => ({ version: '0.0.0-test', oauth2: { client_id: 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com' } }),
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      openOptionsPage: () => {},
    },
    contextMenus: {
      create: () => {},
      removeAll: (cb) => cb && cb(),
      onClicked: { addListener() {} },
    },
    scripting: {
      executeScript: async () => [{ result: null }],
    },
    identity: {
      getAuthToken: async () => ({ token: 'mock-token' }),
    },
    i18n: {
      getMessage: () => '',
      getUILanguage: () => 'en',
    },
    bookmarks: {
      _tree: [{ id: '0', children: [{ id: '1', title: 'Bookmarks bar', children: [] }, { id: '2', title: 'Other bookmarks', children: [] }] }],
      _nextId: 100,
      _nodes: {},
      _moves: [],
      async getTree() {
        return structuredClone(this._tree);
      },
      async getChildren(parentId) {
        return Object.values(this._nodes).filter((n) => n.parentId === parentId);
      },
      async create({ parentId, title, url }) {
        const node = { id: String(this._nextId++), parentId: parentId || '2', title, url };
        this._nodes[node.id] = node;
        return structuredClone(node);
      },
      async move(id, { parentId }) {
        this._moves.push({ id, parentId });
        if (this._nodes[id]) this._nodes[id].parentId = parentId;
        return this._nodes[id] ? structuredClone(this._nodes[id]) : { id, parentId };
      },
      onCreated: { addListener() {} },
      onRemoved: { addListener() {} },
      onChanged: { addListener() {} },
    },
    tabs: {
      async query() {
        return [];
      },
      create: () => {},
      onUpdated: { addListener() {} },
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener() {} },
    },
  };

  globalThis.chrome = mock;
  return mock;
}

export function resetChromeMock() {
  return installChromeMock();
}

// Install immediately on import
installChromeMock();
