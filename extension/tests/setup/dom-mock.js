// Minimal DOM stub so page controllers (options.js / popup.js) can be imported
// and EXECUTED under Node. Elements are persistent per id, so a test can set an
// input's value and the controller reads the same object. This catches
// undefined-function and undefined-element bugs that syntax checks miss.

class StubClassList {
  constructor() { this._set = new Set(); }
  add(...c) { c.forEach((x) => this._set.add(x)); }
  remove(...c) { c.forEach((x) => this._set.delete(x)); }
  toggle(c, force) {
    const has = force !== undefined ? !force : this._set.has(c);
    if (has) this._set.delete(c); else this._set.add(c);
    return this._set.has(c);
  }
  contains(c) { return this._set.has(c); }
}

function createElement(id = '') {
  const listeners = {};
  const el = {
    id,
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    placeholder: '',
    files: [],
    dataset: {},
    style: {},
    classList: new StubClassList(),
    attributes: {},
    children: [],
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    async dispatch(type, event = {}) {
      for (const fn of listeners[type] || []) await fn({ target: el, ...event });
    },
    _listeners: listeners,
    setAttribute(k, v) { el.attributes[k] = v; },
    getAttribute(k) { return el.attributes[k] ?? null; },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return el; },
    click() { return el.dispatch('click'); },
    focus() {},
    select() {},
    remove() {},
  };
  return el;
}

export function installDomMock() {
  const elements = new Map();
  const docListeners = {};

  const documentStub = {
    documentElement: createElement('__root__'),
    body: Object.assign(createElement('__body__'), {}),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement: (tag) => createElement(`__${tag}__`),
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    async dispatch(type, event = {}) {
      for (const fn of docListeners[type] || []) await fn(event);
    },
    _elements: elements,
  };

  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };

  globalThis.document = documentStub;
  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    close() {},
    open() {},
  };
  globalThis.alert = () => {};
  globalThis.confirm = () => true;
  globalThis.prompt = () => null;

  return documentStub;
}
