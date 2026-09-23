import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const { MagasinSessions } = await import('../src/sessions.js');

initialiserSchema();
const magasin = new MagasinSessions({ purgeMs: 0 });
const attendre = (fn) => new Promise((resoudre, rejeter) => fn((e, v) => (e ? rejeter(e) : resoudre(v))));
const expiree = () => ({ cookie: { expires: new Date(Date.now() - 1000).toISOString() } });

test('sessions : écriture, relecture, expiration à la lecture, purge, destruction', async () => {
  await attendre((cb) => magasin.set('s1', { cookie: { maxAge: 60000 }, utilisateur: { login: 'a' } }, cb));
  assert.equal((await attendre((cb) => magasin.get('s1', cb))).utilisateur.login, 'a');

  await attendre((cb) => magasin.set('s2', expiree(), cb));
  assert.equal(await attendre((cb) => magasin.get('s2', cb)), null);
  assert.equal(ouvrirDb().prepare('SELECT COUNT(*) n FROM sessions WHERE sid = ?').get('s2').n, 0, 'supprimée à la lecture');

  await attendre((cb) => magasin.set('s3', expiree(), cb));
  assert.equal(magasin.purger(), 1);

  await attendre((cb) => magasin.destroy('s1', cb));
  assert.equal(await attendre((cb) => magasin.get('s1', cb)), null);
  assert.equal(await attendre((cb) => magasin.length(cb)), 0);
});

test('sessions : touch prolonge, et une autre instance relit la même base', async () => {
  await attendre((cb) => magasin.set('s4', { cookie: { maxAge: 1000 }, utilisateur: { login: 'b' } }, cb));
  const avant = ouvrirDb().prepare('SELECT expire FROM sessions WHERE sid = ?').get('s4').expire;
  await attendre((cb) => magasin.touch('s4', { cookie: { maxAge: 3600000 } }, cb));
  const apres = ouvrirDb().prepare('SELECT expire FROM sessions WHERE sid = ?').get('s4').expire;
  assert.ok(apres > avant);

  const autre = new MagasinSessions({ purgeMs: 0 });
  assert.equal((await attendre((cb) => autre.get('s4', cb))).utilisateur.login, 'b');
});
