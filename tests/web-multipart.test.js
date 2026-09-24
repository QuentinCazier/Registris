import test from 'node:test';
import assert from 'node:assert/strict';

import { PNG } from './_env.js';

process.env.TAILLE_MAX_PREUVE = '4096';

const { initialiserSchema } = await import('../src/db.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const { creerApp } = await import('../src/serveur.js');

initialiserSchema();
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM' });
const MDP = 'mot-de-passe-de-test';
A.creerUtilisateur('test', { login: 'agent', nom: 'Agent', role: 'utilisateur', motDePasse: MDP, matricule: 'E1' });
const h = H.creerHabilitation('agent', { agent: { matricule: 'E1', nom: 'Agent' }, applicationId: gam, role: 'Lecture' });

const serveur = creerApp().listen(0, '127.0.0.1');
await new Promise((r) => serveur.once('listening', r));
const BASE = `http://127.0.0.1:${serveur.address().port}`;
test.after(() => serveur.close());

let cookie = '';
const go = async (chemin, options = {}) => {
  const r = await fetch(BASE + chemin, { ...options, redirect: 'manual', headers: { ...(options.headers ?? {}), cookie } });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return r;
};
const csrf = (html) => html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
const page = await (await go('/connexion')).text();
await go('/connexion', {
  method: 'POST', body: new URLSearchParams({ login: 'agent', motDePasse: MDP, _csrf: csrf(page) }),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const jeton = csrf(await (await go(`/habilitations/${h.id}`)).text());
const LIMITE = '----registris-multipart';
const brut = (corps) => go(`/habilitations/${h.id}/preuves`, {
  method: 'POST', body: corps, headers: { 'content-type': `multipart/form-data; boundary=${LIMITE}` },
});
const partie = (nom, valeur, fichier) => [
  `--${LIMITE}`,
  `Content-Disposition: form-data; name="${nom}"${fichier ? `; filename="${fichier}"` : ''}`,
  ...(fichier ? ['Content-Type: application/octet-stream'] : []),
  '', valeur,
].join('\r\n');
const nbPreuves = () => H.habilitationParId(h.id).preuves.length;

test('pièce trop volumineuse : refusée avec un message, rien n’est écrit', async () => {
  const fd = new FormData();
  fd.set('_csrf', jeton);
  fd.set('preuve', new Blob([Buffer.concat([PNG, Buffer.alloc(8192)])]), 'grosse.png');
  const r = await go(`/habilitations/${h.id}/preuves`, { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /trop volumineux/);
  assert.equal(nbPreuves(), 0);
});

test('deux fichiers pour un seul champ attendu : refusé', async () => {
  const corps = [partie('_csrf', jeton), partie('preuve', PNG.toString('latin1'), 'a.png'), partie('preuve', PNG.toString('latin1'), 'b.png'), `--${LIMITE}--`, ''].join('\r\n');
  const r = await brut(Buffer.from(corps, 'latin1'));
  assert.equal(r.status, 400);
  assert.equal(nbPreuves(), 0);
});

test('corps multipart tronqué ou sans frontière finale : 400, et le serveur répond toujours', async () => {
  const tronque = [partie('_csrf', jeton), partie('preuve', PNG.toString('latin1').slice(0, 20), 'x.png')].join('\r\n');
  const r1 = await brut(Buffer.from(tronque, 'latin1'));
  assert.equal(r1.status, 400);
  const r2 = await brut(Buffer.from('ceci n\'est pas du multipart', 'utf8'));
  assert.equal(r2.status, 400);
  assert.equal(nbPreuves(), 0);
  assert.equal((await go(`/habilitations/${h.id}`)).status, 200, 'le serveur est toujours là');
});

test('noms de champs hostiles (imbrication profonde, indice géant) : refusés sans faire tomber le serveur', async () => {
  const profond = `a${'[b]'.repeat(200)}`;
  const geant = 'a[4294967295]';
  for (const nom of [profond, geant]) {
    const corps = [partie('_csrf', jeton), partie(nom, 'x'), partie('preuve', PNG.toString('latin1'), 'ok.png'), `--${LIMITE}--`, ''].join('\r\n');
    const r = await brut(Buffer.from(corps, 'latin1'));
    assert.ok([302, 400].includes(r.status), `statut ${r.status} pour ${nom.slice(0, 20)}`);
  }
  assert.equal((await go(`/habilitations/${h.id}`)).status, 200);
});

test('pièce valide après tous ces essais : toujours acceptée', async () => {
  const avant = nbPreuves();
  const fd = new FormData();
  fd.set('_csrf', jeton);
  fd.set('preuve', new Blob([PNG]), 'capture.png');
  assert.equal((await go(`/habilitations/${h.id}/preuves`, { method: 'POST', body: fd })).status, 302);
  assert.equal(nbPreuves(), avant + 1);
});
