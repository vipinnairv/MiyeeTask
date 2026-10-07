/* In-browser stand-in for the Firebase compat SDK, used by tests/e2e.test.mjs.
   Auth and Firestore are backed by localStorage ('__user', '__fs') so state
   survives page reloads like the real thing. Test hooks:
     window.__failCommit = true      → every batch commit rejects (offline)
     window.__remoteWrite(path, obj) → simulate another device (obj null = delete) */
(function(){
  const load = () => { try { return JSON.parse(localStorage.getItem('__fs') || '{}'); } catch(e){ return {}; } };
  const put  = s => localStorage.setItem('__fs', JSON.stringify(s));
  const check = (o, p) => { for(const k in o){
    if(o[k] === undefined) throw new Error('Unsupported field value: undefined (' + p + k + ')');
    if(o[k] && typeof o[k] === 'object') check(o[k], p + k + '.'); } };
  const listeners = [];
  const childrenOf = (s, path) => Object.keys(s).filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1);
  function notify(){
    const s = load();
    listeners.forEach(l => {
      const changes = [];
      const now = new Map(childrenOf(s, l.path).map(k => [k.split('/').pop(), JSON.stringify(s[k])]));
      now.forEach((v, id) => { if(l.known.get(id) !== v) changes.push({ type: l.known.has(id) ? 'modified' : 'added', id, v }); });
      l.known.forEach((v, id) => { if(!now.has(id)) changes.push({ type: 'removed', id, v }); });
      l.known = now;
      if(changes.length) l.cb({ docChanges: () => changes.map(c => ({ type: c.type,
        doc: { id: c.id, data: () => JSON.parse(c.v), metadata: { hasPendingWrites: false } } })) });
    });
  }
  function doc(path){ return { path,
    get: async () => { const s = load(); return { exists: path in s, data: () => s[path], id: path.split('/').pop() }; },
    set: async d => { check(d, ''); const s = load(); s[path] = JSON.parse(JSON.stringify(d)); put(s); notify(); },
    update: async d => { const s = load(); s[path] = { ...s[path], ...d }; put(s); notify(); },
    delete: async () => { const s = load(); delete s[path]; put(s); notify(); } }; }
  function coll(path){ return {
    get: async () => { const s = load(); return { docs: childrenOf(s, path).map(k => ({ id: k.split('/').pop(), data: () => s[k] })) }; },
    where(){ return this; }, doc: id => doc(path + '/' + id),
    onSnapshot(cb){ const l = { path, cb, known: new Map() }; listeners.push(l); setTimeout(notify, 0);
      return () => listeners.splice(listeners.indexOf(l), 1); } }; }
  const fs = { enablePersistence: async () => {}, doc, collection: coll,
    batch(){ const ops = []; return {
      set(d, v){ check(v, ''); ops.push(s => { s[d.path] = JSON.parse(JSON.stringify(v)); }); },
      update(d, v){ ops.push(s => { s[d.path] = { ...s[d.path], ...v }; }); },
      delete(d){ ops.push(s => { delete s[d.path]; }); },
      async commit(){ if(window.__failCommit) throw new Error('network'); const s = load(); ops.forEach(o => o(s)); put(s); notify(); } }; } };
  window.__remoteWrite = (path, obj) => { const s = load(); if(obj) s[path] = obj; else delete s[path]; put(s); notify(); };
  let user = JSON.parse(localStorage.getItem('__user') || 'null');
  const authListeners = [];
  const auth = { get currentUser(){ return user; },
    onAuthStateChanged(cb){ authListeners.push(cb); setTimeout(() => cb(user), 300); return () => {}; },
    async signInWithEmailAndPassword(e){ user = { uid: 'uid_' + e.replace(/\W/g, ''), email: e };
      localStorage.setItem('__user', JSON.stringify(user)); authListeners.forEach(l => l(user)); },
    async createUserWithEmailAndPassword(e, p){ return this.signInWithEmailAndPassword(e, p); },
    async signOut(){ user = null; localStorage.removeItem('__user'); authListeners.forEach(l => l(null)); },
    async setPersistence(){}, async sendPasswordResetEmail(){} };
  window.firebase = { apps: [], initializeApp(){ this.apps.push({}); return {}; },
    auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: 'local' } } }),
    firestore: Object.assign(() => fs, { FieldValue: { arrayUnion: (...a) => a } }) };
})();
