// Firestore security-rules tests. Run inside the emulator:
//   npx firebase emulators:exec --only firestore --project demo-miyee "node --test tests/rules.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, query, where, arrayUnion } from 'firebase/firestore';

let env;
const WS = 'acme_owner123';
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-miyee',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, `workspaces/${WS}`), { orgName: 'Acme', createdBy: 'owner', wsId: WS });
    await setDoc(doc(db, `workspaces/${WS}/members/owner`), { uid: 'owner', isAdmin: true, name: 'O' });
    await setDoc(doc(db, `workspaces/${WS}/members/mem`),   { uid: 'mem',   isAdmin: false, name: 'M' });
    await setDoc(doc(db, `workspaces/${WS}/tasks/1`), { id: 1, title: 'T' });
    await setDoc(doc(db, 'invites/GOODCODE'), { wsId: WS, wsName: 'Acme', createdBy: 'owner', active: true, usedBy: [] });
    await setDoc(doc(db, 'invites/USEDCODE'), { wsId: WS, wsName: 'Acme', createdBy: 'owner', active: false, usedBy: ['x'] });
    await setDoc(doc(db, 'users/alice/tasks/1'), { id: 1, title: 'mine' });
  });
});
const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

test('personal data is private to its owner', async () => {
  await assertSucceeds(getDoc(doc(db('alice'), 'users/alice/tasks/1')));
  await assertSucceeds(setDoc(doc(db('alice'), 'users/alice/tasks/2'), { id: 2 }));
  await assertFails(getDoc(doc(db('bob'), 'users/alice/tasks/1')));
  await assertFails(setDoc(doc(db('bob'), 'users/alice/tasks/3'), { id: 3 }));
  await assertFails(getDoc(doc(db(null), 'users/alice/tasks/1')));
});

test('workspace tasks: members read/write, outsiders cannot', async () => {
  await assertSucceeds(getDoc(doc(db('mem'), `workspaces/${WS}/tasks/1`)));
  await assertSucceeds(setDoc(doc(db('mem'), `workspaces/${WS}/tasks/2`), { id: 2 }));
  await assertSucceeds(setDoc(doc(db('mem'), `workspaces/${WS}/meta/workspace`), { orgName: 'Acme' }));
  await assertFails(getDoc(doc(db('stranger'), `workspaces/${WS}/tasks/1`)));
  await assertFails(setDoc(doc(db('stranger'), `workspaces/${WS}/tasks/9`), { id: 9 }));
  await assertFails(setDoc(doc(db('mem'), `workspaces/${WS}/secrets/x`), { a: 1 }));
});

test('creating a workspace makes the creator its admin (app batch)', async () => {
  const d = db('carol'); const b = writeBatch(d);
  b.set(doc(d, 'workspaces/new_carol'), { orgName: 'New', createdBy: 'carol', wsId: 'new_carol' });
  b.set(doc(d, 'workspaces/new_carol/members/carol'), { uid: 'carol', isAdmin: true });
  b.set(doc(d, 'users/carol/profile/main'), { uid: 'carol', wsMode: 'company', wsId: 'new_carol' });
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(doc(d, 'workspaces/new_carol/positions/p1'), { name: 'CEO' }));
});

test('nobody can make themself admin of an existing workspace', async () => {
  await assertFails(setDoc(doc(db('eve'), `workspaces/${WS}/members/eve`), { uid: 'eve', isAdmin: true }));
  await assertFails(updateDoc(doc(db('mem'), `workspaces/${WS}/members/mem`), { isAdmin: true }));
  await assertSucceeds(updateDoc(doc(db('mem'), `workspaces/${WS}/members/mem`), { name: 'Renamed' }));
});

test('joining requires an active invite redeemed in the same batch (app batch)', async () => {
  const d = db('dan'); const b = writeBatch(d);
  b.set(doc(d, `workspaces/${WS}/members/dan`), { uid: 'dan', isAdmin: false, inviteCode: 'GOODCODE' });
  b.set(doc(d, 'users/dan/profile/main'), { uid: 'dan', wsMode: 'company', wsId: WS });
  b.update(doc(d, 'invites/GOODCODE'), { usedBy: arrayUnion('dan'), active: false, usedAt: 1, usedByName: 'Dan' });
  await assertSucceeds(b.commit());
});

test('joining without, or with a used, invite is rejected', async () => {
  await assertFails(setDoc(doc(db('eve'), `workspaces/${WS}/members/eve`), { uid: 'eve', isAdmin: false }));
  const d = db('eve'); const b = writeBatch(d);
  b.set(doc(d, `workspaces/${WS}/members/eve`), { uid: 'eve', isAdmin: false, inviteCode: 'USEDCODE' });
  b.update(doc(d, 'invites/USEDCODE'), { usedBy: arrayUnion('eve'), active: false });
  await assertFails(b.commit());
});

test('invites: anyone signed in can check a code; only admins create, list, revoke', async () => {
  await assertSucceeds(getDoc(doc(db('eve'), 'invites/GOODCODE')));
  await assertFails(getDoc(doc(db(null), 'invites/GOODCODE')));
  await assertSucceeds(setDoc(doc(db('owner'), 'invites/NEWCODE1'), { wsId: WS, createdBy: 'owner', active: true, usedBy: [] }));
  await assertFails(setDoc(doc(db('mem'), 'invites/NEWCODE2'), { wsId: WS, createdBy: 'mem', active: true, usedBy: [] }));
  await assertSucceeds(getDocs(query(collection(db('owner'), 'invites'), where('wsId', '==', WS))));
  await assertFails(getDocs(query(collection(db('mem'), 'invites'), where('wsId', '==', WS))));
  await assertSucceeds(updateDoc(doc(db('owner'), 'invites/GOODCODE'), { active: false }));
  await assertFails(updateDoc(doc(db('mem'), 'invites/GOODCODE'), { wsId: 'other' }));
});

test('admins manage positions and members; members cannot', async () => {
  await assertSucceeds(setDoc(doc(db('owner'), `workspaces/${WS}/positions/p`), { name: 'Dev' }));
  await assertFails(setDoc(doc(db('mem'), `workspaces/${WS}/positions/q`), { name: 'Boss' }));
  await assertSucceeds(getDocs(collection(db('newbie'), `workspaces/${WS}/positions`)));
  await assertFails(deleteDoc(doc(db('mem'), `workspaces/${WS}/members/owner`)));
  await assertSucceeds(deleteDoc(doc(db('owner'), `workspaces/${WS}/members/mem`)));
});
