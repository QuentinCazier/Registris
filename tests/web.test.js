/**
 * Tests d'intégration HTTP : le serveur tourne sur un port éphémère, on parle en
 * HTTP réel (cookies, CSRF, multipart), sans dépendance de test externe.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PNG } from './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const A = await import('../src/administration.js');
const { creerApp } = await import('../src/serveur.js');

initialiserSchema();
A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: 1 });
A.creerApplication('test', { code: 'DPI', libelle: 'DPI', categorieId: 1 });
const MDP = 'mot-de-passe-de-test';
A.creerUtilisateur('test', { login: 'admin', nom: 'Admin', role: 'admin', motDePasse: MDP, email: 'admin@exemple.fr' });
A.creerUtilisateur('test', { login: 'agent', nom: 'Claire Petit', role: 'utilisateur', motDePasse: MDP, matricule: 'E45678', email: 'claire@exemple.fr' });
A.creerUtilisateur('test', { login: 'ref', nom: 'Réf', role: 'referent', motDePasse: MDP, applicationIds: [gam] });
A.creerUtilisateur('test', { login: 'ctrl', nom: 'Contrôleur', role: 'controleur', motDePasse: MDP });

const serveur = creerApp().listen(0, '127.0.0.1');
await new Promise((r) => serveur.once('listening', r));
const BASE = `http://127.0.0.1:${serveur.address().port}`;
test.after(() => serveur.close());

/** Client HTTP minimal avec bocal à cookies, sans suivre les redirections. */
function client() {
  let cookie = '';
  const go = async (chemin, options = {}) => {
    const r = await fetch(BASE + chemin, { ...options, redirect: 'manual', headers: { ...(options.headers ?? {}), cookie } });
    const sc = r.headers.getSetCookie?.() ?? [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return r;
  };
  const csrf = (html) => html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
  const post = async (chemin, champs, { jeton = true } = {}) => {
    const page = await (await go(chemin.startsWith('/habilitations/') ? '/' : chemin.replace(/\/[^/]*$/, '') || '/')).text();
    const corps = new URLSearchParams(champs);
    if (jeton) corps.set('_csrf', csrf(page) ?? '');
    return go(chemin, { method: 'POST', body: corps, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  };
  const connecter = async (login, motDePasse = MDP) => {
    const page = await (await go('/connexion')).text();
    return go('/connexion', {
      method: 'POST',
      body: new URLSearchParams({ login, motDePasse, _csrf: csrf(page) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  };
  return { go, post, connecter, csrf };
}

test('santé publique, pages protégées redirigées vers la connexion', async () => {
  const c = client();
  const sante = await (await c.go('/sante')).json();
  assert.equal(sante.statut, 'ok');
  assert.equal(sante.application, 'registris');
  for (const p of ['/', '/recherche', '/suivi', '/admin/applications', '/export', '/page-inexistante']) {
    const r = await c.go(p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), '/connexion');
  }
});

test('en-têtes de sécurité présents', async () => {
  const r = await client().go('/connexion');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('connexion : CSRF obligatoire, identifiants faux refusés, succès redirige', async () => {
  const c = client();
  const sansJeton = await c.go('/connexion', {
    method: 'POST', body: new URLSearchParams({ login: 'admin', motDePasse: MDP }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(sansJeton.status, 403);
  assert.equal((await c.connecter('admin', 'faux')).status, 401);
  const ok = await c.connecter('admin');
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/');
  const accueil = await c.go('/');
  assert.equal(accueil.status, 200);
  assert.match(await accueil.text(), /Tableau de bord/);
});

test('force brute : blocage après cinq échecs', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c.connecter('cible', 'faux')).status, 401);
  assert.equal((await c.connecter('cible', 'faux')).status, 429);
});

test('droits : un utilisateur ne voit pas l\'administration ni l\'export ; le contrôleur exporte mais ne valide pas', async () => {
  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go('/admin/applications')).status, 403);
  assert.equal((await agent.go('/export')).status, 403);
  assert.equal((await agent.go('/suivi')).status, 403);
  assert.equal((await agent.go('/mes-demandes')).status, 200);
  const nav = await (await agent.go('/')).text();
  assert.doesNotMatch(nav, /href="\/admin\/applications"/);

  const ctrl = client();
  await ctrl.connecter('ctrl');
  assert.equal((await ctrl.go('/export')).status, 200);
  assert.equal((await ctrl.go('/audit')).status, 200);
  assert.equal((await ctrl.go('/habilitations/nouvelle')).status, 403);
});

let habId;
test('dépôt d\'une demande par un agent, puis validation par le référent de l\'application', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  const r = await agent.go('/habilitations', {
    method: 'POST',
    body: new URLSearchParams({ _csrf: agent.csrf(form), applicationId: String(gam), pour_autrui: '0', matricule: 'E45678', role: 'Gestionnaire admissions', uf_libre: '9001', commentaire: 'Prise de poste' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(r.status, 302);
  habId = Number(r.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);
  const fiche = await (await agent.go(`/habilitations/${habId}`)).text();
  assert.match(fiche, /Gestionnaire admissions/);
  assert.match(fiche, /Demandée/);
  assert.doesNotMatch(fiche, /action="\/habilitations\/\d+\/valider"/, 'un agent ne doit pas voir le bouton Valider');

  // Le référent GAM valide ; un jeton CSRF est requis.
  const ref = client();
  await ref.connecter('ref');
  const sansJeton = await ref.go(`/habilitations/${habId}/valider`, { method: 'POST', body: new URLSearchParams({}), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(sansJeton.status, 403);
  const page = await (await ref.go(`/habilitations/${habId}`)).text();
  const ok = await ref.go(`/habilitations/${habId}/valider`, { method: 'POST', body: new URLSearchParams({ _csrf: ref.csrf(page) }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(ok.status, 302);
  assert.match(await (await ref.go(`/habilitations/${habId}`)).text(), /Validée/);
});

test('le référent ne peut pas agir hors de son périmètre', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go('/habilitations/nouvelle/2')).text();
  const r = await agent.go('/habilitations', {
    method: 'POST',
    body: new URLSearchParams({ _csrf: agent.csrf(form), applicationId: '2', pour_autrui: '0', matricule: 'E45678', role: 'Lecture' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const id = Number(r.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);
  const ref = client();
  await ref.connecter('ref');
  const page = await (await ref.go(`/habilitations/${id}`)).text();
  assert.doesNotMatch(page, /action="\/habilitations\/\d+\/valider"/);
  const refus = await ref.go(`/habilitations/${id}/valider`, { method: 'POST', body: new URLSearchParams({ _csrf: ref.csrf(page) }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(refus.status, 403);
});

test('preuve : téléversement multipart accepté (PNG), refusé (exécutable déguisé), téléchargement tracé', async () => {
  const agent = client();
  await agent.connecter('agent');
  const page = await (await agent.go(`/habilitations/${habId}`)).text();
  const jeton = agent.csrf(page);
  const envoyer = (tampon, nom) => {
    const fd = new FormData();
    fd.set('_csrf', jeton);
    fd.set('preuve', new Blob([tampon]), nom);
    return agent.go(`/habilitations/${habId}/preuves`, { method: 'POST', body: fd });
  };
  assert.equal((await envoyer(PNG, 'capture.png')).status, 302);
  const refus = await envoyer(Buffer.from('MZ\x90\x00 pas un pdf'), 'piege.pdf');
  assert.equal(refus.status, 400);
  assert.match(await refus.text(), /ne correspond pas/);
  const fiche = await (await agent.go(`/habilitations/${habId}`)).text();
  assert.match(fiche, /capture\.png/);
  assert.match(fiche, /intègre/);
  const lien = fiche.match(/href="\/preuves\/(\d+)"/)[1];
  const dl = await agent.go(`/preuves/${lien}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /capture\.png/);
});

test('export : le contrôleur télécharge un ZIP ; saisie vide refusée', async () => {
  const ctrl = client();
  await ctrl.connecter('ctrl');
  const page = await (await ctrl.go('/export')).text();
  const zip = await ctrl.go('/export', { method: 'POST', body: new URLSearchParams({ _csrf: ctrl.csrf(page), matricules: 'E45678\nE99999' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const octets = Buffer.from(await zip.arrayBuffer());
  assert.equal(octets.subarray(0, 2).toString(), 'PK');
  assert.ok(octets.toString('latin1').includes('synthese.html'));
  const vide = await ctrl.go('/export', { method: 'POST', body: new URLSearchParams({ _csrf: ctrl.csrf(page), matricules: '  ' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(vide.status, 400);
});

test('administration : création d\'une application via le formulaire multipart, journal visible', async () => {
  const admin = client();
  await admin.connecter('admin');
  const page = await (await admin.go('/admin/applications')).text();
  const fd = new FormData();
  fd.set('_csrf', admin.csrf(page));
  fd.set('code', 'labo');
  fd.set('libelle', 'Laboratoire');
  fd.set('categorieId', '1');
  const r = await admin.go('/admin/applications', { method: 'POST', body: fd });
  assert.equal(r.status, 302);
  assert.match(await (await admin.go('/admin/applications')).text(), /LABO/);
  const journal = await (await admin.go('/audit?q=LABO')).text();
  assert.match(journal, /application:creer/);
  assert.match(journal, /intègre/);
  const recherche = await (await admin.go('/recherche?q=E45678')).text();
  assert.match(recherche, /Claire Petit|Petit/);
  assert.equal((await admin.go('/coffre')).status, 200);
  assert.equal((await admin.go('/page-inexistante')).status, 404);
});

test('politique de sécurité : un nonce par réponse, aucun script en ligne sans nonce', async () => {
  const c = client();
  await c.connecter('admin');
  const r = await c.go('/admin/categories');
  const csp = r.headers.get('content-security-policy');
  const nonce = csp.match(/script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(nonce, 'nonce présent dans la CSP');
  assert.equal(/script-src[^;]*unsafe-inline/.test(csp), false);
  const html = await r.text();
  assert.ok(html.includes(`<script nonce="${nonce}">`), 'le script du gabarit porte le nonce');
  assert.ok(html.includes('data-confirmer='), 'les confirmations passent par un attribut, pas un gestionnaire en ligne');
  assert.equal(html.includes('onsubmit='), false);
  const r2 = await c.go('/admin/categories');
  assert.notEqual(r2.headers.get('content-security-policy'), csp, 'le nonce change à chaque réponse');
});

test('journal d’audit : la page mentionne l’état des ancrages', async () => {
  const c = client();
  await c.connecter('admin');
  const html = await (await c.go('/audit')).text();
  assert.ok(/ancrage/i.test(html));
});
