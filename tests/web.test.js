// Tests HTTP de bout en bout : serveur sur un port éphémère, cookies, CSRF, multipart.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PNG, EML } from './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const P = await import('../src/preuves.js');
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

// Bocal à cookies, sans suivre les redirections.
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

test('page de connexion : son cadre n\'hérite pas de la grille à deux colonnes de « À traiter »', async () => {
  // La classe globale .boite dispose la file de traitement en deux colonnes : la réutiliser ici
  // écrasait le formulaire dans une colonne de quelques pixels sur les écrans larges.
  const html = await (await client().go('/connexion')).text();
  assert.match(html, /<div class="boite-connexion">/);
  assert.doesNotMatch(html, /<div class="boite">/);
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
  assert.match(fiche, /vérifiée/);
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

// --- Rendu des écrans : ce qui doit rester vrai après une refonte -------------------------
// On assertionne sur le corps des tableaux : la feuille de style, inlinée dans
// chaque réponse, cite tous les noms de classe et fausserait une recherche globale.
const corpsTableau = (html) => html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';

test('tableau de bord : une file de travail et l’état de la chaîne, pas des tuiles de chiffres', async () => {
  const c = client();
  await c.connecter('admin');
  const html = await (await c.go('/')).text();
  assert.match(html, /À traiter/);
  assert.match(html, /Journal d'audit vérifié/);
  assert.match(html, /Points de vigilance/);
  assert.match(html, /class="bandeau b-ok"/);
  assert.equal(html.includes('<a class="tuile'), false, 'les tuiles de chiffres ont disparu');
});

test('boîte de traitement : la file à gauche, le dossier de la demande à droite', async () => {
  const c = client();
  await c.connecter('admin');

  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  const creee = await agent.go('/habilitations', {
    method: 'POST',
    body: new URLSearchParams({
      _csrf: agent.csrf(form), applicationId: String(gam), pour_autrui: '0',
      matricule: 'E45678', role: 'Accueil des urgences', uf_libre: '4200',
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(creee.status, 302, 'la demande est bien déposée');
  const id = Number(creee.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);

  const html = await (await c.go('/traiter')).text();
  assert.match(html, /class="boite"/);
  assert.match(html, /class="file-item sel"/, 'la première demande de la file est sélectionnée');
  assert.match(html, /Accueil des urgences/, 'la demande déposée entre dans la file');

  // Sur le dossier de cette demande précise, le manque de preuve est signalé avant les actions.
  const dossier = await (await c.go(`/traiter/${id}`)).text();
  assert.match(dossier, /class="file-item sel"[\s\S]*Accueil des urgences/, 'la demande ouverte est celle qui est surlignée');
  assert.match(dossier, /Aucune pièce/);
  assert.match(dossier, /opposable à un auditeur/);
  assert.match(dossier, /action="\/habilitations\/\d+\/executer"/, 'les actions sont sous la main');

  // Une fois l'accès ouvert, la demande quitte la file : son adresse renvoie vers la fiche.
  const fiche = await (await c.go(`/habilitations/${id}`)).text();
  const fait = await c.go(`/habilitations/${id}/executer`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: c.csrf(fiche) }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(fait.status, 302);
  const sortie = await c.go(`/traiter/${id}`);
  assert.equal(sortie.status, 302);
  assert.equal(sortie.headers.get('location'), `/habilitations/${id}`);
});

test('registre : en-têtes triables, filtre par statut, export accessible', async () => {
  const c = client();
  await c.connecter('admin');
  const html = await (await c.go('/suivi')).text();
  assert.match(html, /href="\/suivi\?tri=agent&sens=asc"/, 'un clic sur la colonne trie');
  assert.match(html, /Exporter en CSV/);

  const trie = await (await c.go('/suivi?tri=agent&sens=asc')).text();
  assert.match(trie, /aria-sort="ascending"/);

  const corps = corpsTableau(await (await c.go('/suivi?statut=demandee')).text());
  assert.ok(corps.includes('Demandée'), 'au moins une demande en attente');
  for (const autre of ['Validée', 'Exécutée', 'Révoquée']) {
    assert.equal(corps.includes(autre), false, `aucune ligne « ${autre} » sous le filtre « demandée »`);
  }
});

test('export CSV : point-virgule, BOM, filtres respectés, export tracé', async () => {
  const c = client();
  await c.connecter('admin');
  const r = await c.go('/suivi.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /registre-habilitations-\d{4}-\d{2}-\d{2}\.csv/);

  // fetch().text() retire le BOM à la lecture : on regarde donc les octets bruts.
  const octets = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...octets.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM, pour qu’Excel ouvre le fichier sans étape d’import');
  assert.notDeepEqual([...octets.slice(3, 6)], [0xef, 0xbb, 0xbf], 'un seul BOM, sinon la première cellule le contient');
  const csv = new TextDecoder().decode(octets).replace(/^﻿/, '');
  assert.ok(csv.endsWith('\r\n') && !csv.endsWith('\r\n\r\n'), 'une seule fin de ligne finale');
  const lignes = csv.trim().split('\r\n');
  assert.match(lignes[0], /^id;matricule;nom;prenom;application_code;application;profil;ufs;site;statut;/);
  assert.ok(lignes.length >= 2, 'au moins une habilitation exportée');

  const filtre = (await (await c.go('/suivi.csv?statut=demandee')).text()).trim().split('\r\n').slice(1);
  assert.ok(filtre.length >= 1, 'le filtre de l’écran s’applique au fichier');
  for (const ligne of filtre) assert.equal(ligne.split(';')[9], 'Demandée');

  const journal = await (await c.go('/audit')).text();
  assert.match(journal, /registre:exporter/, 'l’export figure au journal d’audit');
});

test('un agent sans droit de suivi n’atteint ni la boîte de traitement ni l’export', async () => {
  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go('/traiter')).status, 403);
  assert.equal((await agent.go('/suivi.csv')).status, 403);
  assert.equal((await agent.go('/revues')).status, 403);
});

test('revue périodique : ouverture par l’administration, décision par le référent, rapport exportable', async () => {
  const c = client();
  await c.connecter('admin');

  // Ouverture de la campagne : elle fige les accès actifs du moment.
  const formulaire = await (await c.go('/revues')).text();
  const ouverture = await c.go('/revues', {
    method: 'POST',
    body: new URLSearchParams({ _csrf: c.csrf(formulaire), libelle: 'Revue de recette', echeance: '2026-12-31' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(ouverture.status, 302);
  const campagneId = Number(ouverture.headers.get('location').match(/\/revues\/(\d+)/)[1]);

  const page = await (await c.go(`/revues/${campagneId}`)).text();
  assert.match(page, /Avancement par application/);
  assert.match(page, /à revoir/);

  // Le référent ne statue que sur son périmètre : GAM lui est confiée, pas DPI.
  const ref = client();
  await ref.connecter('ref');
  const sien = await (await ref.go(`/revues/${campagneId}`)).text();
  const corps = sien.match(/<tbody>([\s\S]*?)<\/tbody>/g)?.pop() ?? '';
  const habId = corps.match(/name="habilitationId" value="(\d+)"/)?.[1];
  assert.ok(habId, 'le référent a au moins un accès à revoir');

  const decision = await ref.go(`/revues/${campagneId}/decision`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: ref.csrf(sien), habilitationId: habId, decision: 'maintenue', motif: 'Poste inchangé' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(decision.status, 302);
  const apres = await (await ref.go(`/revues/${campagneId}`)).text();
  assert.match(apres, /Maintenu/);

  // Le rapport de campagne est la pièce remise à l'auditeur.
  const rapport = await c.go(`/revues/${campagneId}/export.csv`);
  assert.equal(rapport.status, 200);
  const brut = new Uint8Array(await rapport.clone().arrayBuffer());
  assert.deepEqual([...brut.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.notDeepEqual([...brut.slice(3, 6)], [0xef, 0xbb, 0xbf], 'un seul BOM');
  assert.equal(rapport.status, 200);
  const lignes = (await rapport.text()).replace(/^﻿/, '').trim().split('\r\n');
  assert.match(lignes[0], /^campagne;habilitation;matricule;/);
  assert.ok(lignes.some((l) => l.includes('maintenu')), 'la décision figure au rapport');
  // Chaque ligne porte un état explicite : le « non revu » est un constat, pas un vide.
  const etats = lignes.slice(1).map((l) => l.split(';')[10]);
  assert.ok(etats.length >= 1);
  assert.ok(etats.every((e) => ['maintenu', 'retiré', 'non revu'].includes(e)), `états inattendus : ${etats.join(', ')}`);

  // Un agent ordinaire n'a rien à faire ici.
  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go(`/revues/${campagneId}`)).status, 403);

  // Clôture réservée à l'administration, puis plus aucune décision n'est possible.
  const pageClo = await (await c.go(`/revues/${campagneId}`)).text();
  const refus = await ref.go(`/revues/${campagneId}/cloturer`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: ref.csrf(apres) }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(refus.status, 403, 'un référent ne clôture pas la campagne');
  const cloture = await c.go(`/revues/${campagneId}/cloturer`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: c.csrf(pageClo) }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(cloture.status, 302);
  assert.match(await (await c.go(`/revues/${campagneId}`)).text(), /Campagne clôturée/);
});

test('un agent ne lit que ce qui le concerne', async () => {
  const c = client();
  await c.connecter('admin');
  const form = await (await c.go(`/habilitations/nouvelle/${gam}`)).text();
  const autre = await c.go('/habilitations', {
    method: 'POST',
    body: new URLSearchParams({
      _csrf: c.csrf(form), applicationId: String(gam), pour_autrui: '1',
      matricule: 'E99999', nom: 'Autre', prenom: 'Personne', role: 'Consultation',
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(autre.status, 302);
  const idAutre = Number(autre.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);

  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go(`/habilitations/${idAutre}`)).status, 403, 'la fiche d’un collègue reste fermée');
  assert.equal((await agent.go('/recherche')).status, 403, 'le registre des agents ne lui est pas ouvert');

  // Sa propre demande, en revanche, lui reste accessible.
  const sienForm = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  const sienne = await agent.go('/habilitations', {
    method: 'POST',
    body: new URLSearchParams({
      _csrf: agent.csrf(sienForm), applicationId: String(gam), pour_autrui: '0',
      matricule: 'E45678', role: 'Guichet',
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const idSien = Number(sienne.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);
  assert.equal((await agent.go(`/habilitations/${idSien}`)).status, 200);
});

test('redirection : « retour » ne peut pas sortir de l’application', async () => {
  const c = client();
  await c.connecter('admin');
  const suivi = await (await c.go('/suivi?statut=demandee')).text();
  const id = (suivi.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '').match(/href="\/habilitations\/(\d+)"/)?.[1];
  assert.ok(id, 'une demande à valider existe');

  for (const hostile of ['//exemple.invalide', '///exemple.invalide', 'https://exemple.invalide']) {
    const page = await (await c.go(`/habilitations/${id}`)).text();
    const r = await c.go(`/habilitations/${id}/valider`, {
      method: 'POST',
      body: new URLSearchParams({ _csrf: c.csrf(page), retour: hostile }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    if (r.status === 302) {
      const cible = r.headers.get('location');
      assert.ok(cible.startsWith('/') && !cible.startsWith('//'), `redirection hors site : ${cible}`);
    }
  }
});

test('export CSV : un libellé piégé ne devient pas une formule chez l’auditeur', async () => {
  const c = client();
  await c.connecter('admin');

  // Un libellé d'application est du texte libre : il peut donc être hostile.
  const piege = '=HYPERLINK("http://exemple.invalide/vol","Cliquez")';
  const form = await (await c.go('/admin/applications')).text();
  const limite = '----------------------------registris';
  const corps = [
    `--${limite}`, 'Content-Disposition: form-data; name="_csrf"', '', c.csrf(form),
    `--${limite}`, 'Content-Disposition: form-data; name="code"', '', 'PIEGE',
    `--${limite}`, 'Content-Disposition: form-data; name="libelle"', '', piege,
    `--${limite}--`, '',
  ].join('\r\n');
  const creation = await c.go('/admin/applications', {
    method: 'POST',
    body: corps,
    headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
  });
  assert.equal(creation.status, 302, 'application créée avec un libellé piégé');

  const appId = Number((await (await c.go('/admin/applications')).text())
    .match(/href="\/admin\/applications\/(\d+)\/modifier"[^]*?PIEGE/)?.[1]
    ?? (await (await c.go('/admin/applications')).text()).match(/\/admin\/applications\/(\d+)\/modifier/)?.[1]);
  const agent = client();
  await agent.connecter('agent');
  const formDemande = await (await agent.go(`/habilitations/nouvelle/${appId}`)).text();
  await agent.go('/habilitations', {
    method: 'POST',
    body: new URLSearchParams({
      _csrf: agent.csrf(formDemande), applicationId: String(appId), pour_autrui: '0',
      matricule: 'E45678', role: '=1+1',
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  const csv = (await (await c.go('/suivi.csv')).text()).replace(/^﻿/, '');
  // Les guillemets du libellé sont doublés par l'échappement : on cherche donc
  // sa partie stable, et la présence du profil piégé.
  assert.match(csv, /HYPERLINK/, 'la valeur hostile est bien exportée, désamorcée');
  assert.match(csv, /'=1\+1/, 'le profil piégé est neutralisé par une apostrophe');
  for (const cellule of csv.split(/\r\n|;/)) {
    const nu = cellule.startsWith('"') ? cellule.slice(1, -1).replace(/""/g, '"') : cellule;
    assert.equal(/^[=+\-@]/.test(nu), false, `cellule exécutable dans l'export : ${cellule.slice(0, 60)}`);
  }
});

test('impression : la fiche porte son en-tête et l’empreinte complète', async () => {
  const c = client();
  await c.connecter('admin');
  // habId porte une pièce déposée par le test de téléversement : c'est le cas qui
  // compte, puisque l'empreinte complète est ce que l'auditeur vient vérifier.
  assert.ok(habId, 'une habilitation avec pièce existe dans le jeu de test');
  const fiche = await (await c.go(`/habilitations/${habId}`)).text();
  assert.match(fiche, /class="impr"/, 'en-tête réservé à l’impression');
  assert.match(fiche, /Dossier de preuve imprimé le \d{4}-\d{2}-\d{2}/);
  assert.match(fiche, /class="empreinte-complete"> · SHA-256 [0-9a-f]{64}/, 'empreinte entière sur le papier');
});

// --- Boîte d'entrée : la demande arrive par mail, la fermeture est demandée -----------------

const urlencode = (champs, jeton) => ({
  method: 'POST',
  body: new URLSearchParams({ ...champs, _csrf: jeton }),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});

test('le mail de demande est déposé avec la demande, en une seule étape', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  assert.match(form, /enctype="multipart\/form-data"/, 'le formulaire accepte un fichier');
  assert.match(form, /Le mail de demande ou une capture/);

  const fd = new FormData();
  fd.set('_csrf', agent.csrf(form));
  fd.set('applicationId', String(gam));
  fd.set('pour_autrui', '0');
  fd.set('matricule', 'E45678');
  fd.set('role', 'Facturation');
  fd.set('preuve', new Blob([EML]), 'demande-du-cadre.eml');
  const r = await agent.go('/habilitations', { method: 'POST', body: fd });
  assert.equal(r.status, 302);
  const id = Number(r.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);

  const fiche = await (await agent.go(`/habilitations/${id}`)).text();
  assert.match(fiche, /demande-du-cadre\.eml/, 'le mail est au coffre des le depot');
  assert.match(fiche, /vérifiée/);

  // Une pièce refusée n'enregistre pas la demande à moitié.
  const piege = new FormData();
  piege.set('_csrf', agent.csrf(form));
  piege.set('applicationId', String(gam));
  piege.set('pour_autrui', '0');
  piege.set('matricule', 'E45678');
  piege.set('role', 'Profil piege');
  piege.set('preuve', new Blob([Buffer.from('MZ\x90\x00 pas un pdf')]), 'piege.pdf');
  const refus = await agent.go('/habilitations', { method: 'POST', body: piege });
  assert.equal(refus.status, 400);
  assert.doesNotMatch(await (await agent.go('/mes-demandes')).text(), /Profil piege/, 'rien n a ete cree');
});

test('un cadre demande la fermeture, seul le référent l exécute', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  const r = await agent.go('/habilitations', urlencode({
    applicationId: String(gam), pour_autrui: '0', matricule: 'E45678', role: 'Recouvrement',
  }, agent.csrf(form)));
  const id = Number(r.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);

  const ref = client();
  await ref.connecter('ref');
  let page = await (await ref.go(`/habilitations/${id}`)).text();
  await ref.go(`/habilitations/${id}/executer`, urlencode({}, ref.csrf(page)));

  // Le cadre constate le départ : il demande, il ne ferme pas.
  page = await (await agent.go(`/habilitations/${id}`)).text();
  assert.match(page, /action="\/habilitations\/\d+\/retrait"/, 'le formulaire de demande de fermeture est offert');
  assert.doesNotMatch(page, /action="\/habilitations\/\d+\/revoquer"/, 'un agent ne revoque pas');
  const sansMotif = await agent.go(`/habilitations/${id}/retrait`, urlencode({ motif: '  ' }, agent.csrf(page)));
  assert.equal(sansMotif.status, 400);
  const demande = await agent.go(`/habilitations/${id}/retrait`, urlencode({ motif: 'départ le 31/12' }, agent.csrf(page)));
  assert.equal(demande.status, 302);

  const interdit = await agent.go(`/habilitations/${id}/revoquer`, urlencode({}, agent.csrf(page)));
  assert.equal(interdit.status, 403, 'un agent ne peut pas fermer l acces lui-meme');
  assert.doesNotMatch(await (await agent.go(`/habilitations/${id}`)).text(), /Révoquée/);

  // Le référent la voit dans sa file, avec le motif, et l'exécute.
  const boite = await (await ref.go('/traiter')).text();
  assert.match(boite, /fermeture demandée/);
  const dossier = await (await ref.go(`/traiter/${id}`)).text();
  assert.match(dossier, /Fermeture demandée/);
  assert.match(dossier, /départ le 31\/12/);
  const ferme = await ref.go(`/habilitations/${id}/revoquer`, urlencode({}, ref.csrf(dossier)));
  assert.equal(ferme.status, 302);
  const apres = await (await ref.go(`/habilitations/${id}`)).text();
  assert.match(apres, /Révoquée/);
  assert.doesNotMatch(apres, /Fermeture demandée/, 'la demande est soldee');
});

test('refus motivé : la demande quitte la file sans créer d accès', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  const r = await agent.go('/habilitations', urlencode({
    applicationId: String(gam), pour_autrui: '0', matricule: 'E45678', role: 'Profil trop large',
  }, agent.csrf(form)));
  const id = Number(r.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);

  const ref = client();
  await ref.connecter('ref');
  const page = await (await ref.go(`/habilitations/${id}`)).text();
  assert.match(page, /action="\/habilitations\/\d+\/refuser"/);
  const sansMotif = await ref.go(`/habilitations/${id}/refuser`, urlencode({ motif: '' }, ref.csrf(page)));
  assert.equal(sansMotif.status, 400);
  assert.match(await sansMotif.text(), /motivé/);

  const refuse = await ref.go(`/habilitations/${id}/refuser`, urlencode({ motif: 'profil non justifié par la fonction' }, ref.csrf(page)));
  assert.equal(refuse.status, 302);
  assert.match(await (await ref.go(`/habilitations/${id}`)).text(), /Refusée/);
  assert.doesNotMatch(await (await ref.go('/traiter')).text(), new RegExp(`/traiter/${id}"`), 'elle a quitte la file');
});

test('prise en charge : le référent s attribue une demande et la retrouve dans A moi', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  const r = await agent.go('/habilitations', urlencode({
    applicationId: String(gam), pour_autrui: '0', matricule: 'E45678', role: 'Encaissement',
  }, agent.csrf(form)));
  const id = Number(r.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);

  const ref = client();
  await ref.connecter('ref');
  const dossier = await (await ref.go(`/traiter/${id}`)).text();
  assert.match(dossier, /Prendre en charge/);
  const pris = await ref.go(`/habilitations/${id}/assigner`, urlencode({ login: 'moi', retour: `/traiter/${id}` }, ref.csrf(dossier)));
  assert.equal(pris.status, 302);

  const mienne = await (await ref.go('/traiter?f=moi')).text();
  assert.match(mienne, new RegExp(`/traiter/${id}"`));
  assert.match(mienne, /à moi/);
  assert.doesNotMatch(await (await ref.go('/traiter?f=libres')).text(), new RegExp(`/traiter/${id}"`));

  // Un agent ne distribue pas le travail des référents.
  const refuse = await agent.go(`/habilitations/${id}/assigner`, urlencode({ login: 'ref' }, agent.csrf(dossier)));
  assert.equal(refuse.status, 403);
});

test('page d audit : contrôle complet à la demande, et reprise ensuite', async () => {
  const ctrl = client();
  await ctrl.connecter('ctrl');
  let page = await (await ctrl.go('/audit')).text();
  assert.match(page, /action="\/audit\/controle"/, 'le contrôle complet est offert');
  assert.match(page, /Chaîne d&#39;audit intègre|Chaîne d'audit intègre/);

  const r = await ctrl.go('/audit/controle', urlencode({}, ctrl.csrf(page)));
  assert.equal(r.status, 302);

  page = await (await ctrl.go('/audit')).text();
  assert.match(page, /Reprise du contrôle complet du \d{4}-\d{2}-\d{2}/, 'la page repart du contrôle enregistré');
  assert.match(page, /a lancé un contrôle complet de la chaîne/, 'le contrôle est tracé au journal');

  // Un agent ordinaire ne déclenche pas un recalcul complet.
  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go('/audit/controle', urlencode({}, ctrl.csrf(page)))).status, 403);
});

test('file de traitement : ce qui dort est signalé en retard', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  const r = await agent.go('/habilitations', urlencode({
    applicationId: String(gam), pour_autrui: '0', matricule: 'E45678', role: 'Demande qui dort',
  }, agent.csrf(form)));
  const id = Number(r.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);

  const ref = client();
  await ref.connecter('ref');
  assert.doesNotMatch(await (await ref.go(`/traiter/${id}`)).text(), new RegExp(`/traiter/${id}"[^]{0,400}en retard`));

  // On vieillit la demande en base, le temps ne passant pas pendant un test.
  const { ouvrirDb } = await import('../src/db.js');
  ouvrirDb().prepare("UPDATE habilitations SET date_demande = date('now', '-30 days') WHERE id = ?").run(id);

  const boite = await (await ref.go('/traiter')).text();
  assert.match(boite, new RegExp(`/traiter/${id}"[^]{0,400}en retard`), 'la file marque le retard');
  assert.match(await (await ref.go('/')).text(), /en attente depuis plus de 7 jours/, 'le tableau de bord le compte');
});

test('un cadre signale un départ sans jamais lire le registre', async () => {
  // L'accès est ouvert par le référent, pas par le cadre : ce dernier n'a donc
  // aucun droit de le voir. C'est le cas qui rendait la fermeture inatteignable.
  const admin = client();
  await admin.connecter('admin');
  const form = await (await admin.go(`/habilitations/nouvelle/${gam}`)).text();
  const cree = await admin.go('/habilitations', urlencode({
    applicationId: String(gam), pour_autrui: '1',
    matricule: 'E77777', nom: 'Partant', prenom: 'Paul', role: 'Guichet',
  }, admin.csrf(form)));
  const id = Number(cree.headers.get('location').match(/\/habilitations\/(\d+)/)[1]);
  const fiche = await (await admin.go(`/habilitations/${id}`)).text();
  await admin.go(`/habilitations/${id}/executer`, urlencode({}, admin.csrf(fiche)));

  const cadre = client();
  await cadre.connecter('agent');
  assert.equal((await cadre.go(`/habilitations/${id}`)).status, 403, 'le cadre ne voit pas la fiche');

  const page = await (await cadre.go('/depart')).text();
  assert.match(page, /Signaler un départ/);
  const sansMotif = await cadre.go('/depart', urlencode({ matricule: 'E77777', motif: '' }, cadre.csrf(page)));
  assert.equal(sansMotif.status, 400);
  const inconnu = await cadre.go('/depart', urlencode({ matricule: 'ZZZZZ', motif: 'Départ' }, cadre.csrf(page)));
  assert.equal(inconnu.status, 400);
  assert.match(await inconnu.text(), /Aucun agent/);

  const r = await cadre.go('/depart', urlencode({
    matricule: 'E77777', motif: 'Fin de contrat', date_depart: '2026-12-31',
  }, cadre.csrf(page)));
  assert.equal(r.status, 200);
  const bilan = await r.text();
  assert.match(bilan, /1 demande de fermeture ouverte/);
  assert.doesNotMatch(bilan, /Guichet/, 'le cadre obtient un décompte, pas la liste des accès');

  // Le référent, lui, la retrouve dans sa file avec le motif et la date.
  const ref = client();
  await ref.connecter('ref');
  assert.match(await (await ref.go('/traiter')).text(), /fermeture demandée/);
  const dossier = await (await ref.go(`/traiter/${id}`)).text();
  assert.match(dossier, /Fin de contrat/);
  assert.match(dossier, /2026-12-31/);
});

test('demande multiple : une seule saisie, autant de demandes que d applications', async () => {
  const agent = client();
  await agent.connecter('agent');
  const catalogue = await (await agent.go('/habilitations/nouvelle')).text();
  assert.match(catalogue, /name="apps"/, 'le catalogue permet de sélectionner plusieurs applications');

  const form = await (await agent.go(`/habilitations/nouvelle/multiple?apps=${gam}&apps=2`)).text();
  assert.match(form, /2 applications sélectionnées/);
  assert.match(form, /name="role_choix_2"/);

  const fd = new FormData();
  fd.set('_csrf', agent.csrf(form));
  fd.append('apps', String(gam));
  fd.append('apps', '2');
  fd.set('pour_autrui', '0');
  fd.set('matricule', 'E45678');
  fd.set(`role_${gam}`, 'Facturation groupée');
  fd.set('role_2', 'Lecture groupée');
  fd.set('preuve', new Blob([EML]), 'demande-groupee.eml');
  const r = await agent.go('/habilitations/multiple', { method: 'POST', body: fd });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/mes-demandes/);

  const miennes = await (await agent.go('/mes-demandes')).text();
  assert.match(miennes, /Facturation groupée/);
  assert.match(miennes, /Lecture groupée/);

  // La pièce justifie chacun des accès : à l'audit, aucune fiche ne renvoie à une voisine.
  const ids = [...miennes.matchAll(/href="\/habilitations\/(\d+)"/g)].map((m) => Number(m[1]));
  let avecPiece = 0;
  for (const id of ids) {
    const f = await (await agent.go(`/habilitations/${id}`)).text();
    if (/groupée/.test(f) && /demande-groupee\.eml/.test(f)) avecPiece += 1;
  }
  assert.equal(avecPiece, 2, 'les deux demandes portent la pièce');

  // Une seule application sélectionnée : on retombe sur le formulaire simple.
  const seule = await agent.go(`/habilitations/nouvelle/multiple?apps=${gam}`);
  assert.equal(seule.status, 302);
  assert.equal(seule.headers.get('location'), `/habilitations/nouvelle/${gam}`);
});

test('bibliothèque : l administrateur coche, le catalogue se remplit', async () => {
  const c = client();
  await c.connecter('admin');
  const page = await (await c.go('/admin/bibliotheque')).text();
  assert.match(page, /Bibliothèque de logiciels/);
  assert.match(page, /value="SILLAGE"/, 'les logiciels sont proposés à la sélection');
  assert.match(page, /Laboratoire/, 'rangés par fonction');
  assert.doesNotMatch(page, /<img[^>]+logos\/SILLAGE/, 'aucun logo d’éditeur n’est embarqué');

  const r = await c.go('/admin/bibliotheque', urlencode({ codes: 'PHARMA' }, c.csrf(page)));
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /ajoutees=1/);

  const apres = await (await c.go(r.headers.get('location'))).text();
  assert.match(apres, /1 application ajoutée au catalogue/);
  assert.match(apres, /au catalogue<\/span>/, 'le logiciel ajouté est marqué comme présent');

  const applications = await (await c.go('/admin/applications')).text();
  assert.match(applications, /Pharma/);
  assert.match(applications, /Prescription et pharmacie/, 'la catégorie a été créée au passage');

  // Il devient demandable comme n'importe quelle application. Le catalogue
  // n'affiche qu'un onglet de catégorie a la fois : on ouvre le bon.
  const catalogue = await (await c.go('/habilitations/nouvelle')).text();
  const onglet = [...catalogue.matchAll(/href="\/habilitations\/nouvelle\?cat=(\d+)"[^>]*>([^<]+)</g)]
    .find((m) => m[2].includes('pharmacie'));
  assert.ok(onglet, 'la nouvelle catégorie a son onglet au catalogue');
  assert.match(await (await c.go(`/habilitations/nouvelle?cat=${onglet[1]}`)).text(), /Pharma/);

  // Une sélection vide est refusée proprement.
  const vide = await c.go('/admin/bibliotheque', urlencode({}, c.csrf(page)));
  assert.equal(vide.status, 400);

  // Et elle reste réservée à l'administration.
  const ref = client();
  await ref.connecter('ref');
  assert.equal((await ref.go('/admin/bibliotheque')).status, 403);
});

test('indicateurs : lisibles par le contrôle, exportables, fermés aux agents', async () => {
  const ctrl = client();
  await ctrl.connecter('ctrl');
  const page = await (await ctrl.go('/indicateurs')).text();
  assert.match(page, /En ce moment/);
  assert.match(page, /Du signalement d&#39;un départ à la fermeture réelle|Du signalement d'un départ à la fermeture réelle/);
  assert.match(page, /Volumes des douze derniers mois/);
  assert.match(page, /6 derniers mois/, 'six mois par défaut');
  assert.match(await (await ctrl.go('/indicateurs?periode=12')).text(), /depuis le \d{4}-\d{2}-\d{2}/);
  assert.match(await (await ctrl.go('/indicateurs?periode=999')).text(), /6 derniers mois/, 'une période inconnue retombe sur six mois');

  const csv = await ctrl.go('/indicateurs.csv?periode=12');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const texte = Buffer.from(await csv.arrayBuffer()).toString('utf8');
  assert.match(texte, /indicateur;application;acces;mediane_jours/);
  assert.doesNotMatch(texte, /;\d+\.\d/, 'pas de point décimal : Excel en français le lirait comme du texte');

  const audit = await (await ctrl.go('/audit')).text();
  assert.match(audit, /a exporté les indicateurs/, 'l’export est tracé');

  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go('/indicateurs')).status, 403);
  assert.equal((await agent.go('/indicateurs.csv')).status, 403);
});

test('rapprochement : le contrôle constate, le référent corrige, l’agent n’entre pas', async () => {
  const ctrl = client();
  await ctrl.connecter('ctrl');
  const liste = await (await ctrl.go('/rapprochements')).text();
  assert.match(liste, /Déposer l&#39;extraction|Déposer l'extraction/);

  // Le contrôleur dépose l'extraction de la GAM, qui contient un compte inconnu du registre.
  const fd = new FormData();
  fd.set('_csrf', ctrl.csrf(liste));
  fd.set('applicationId', String(gam));
  fd.set('extraction', new Blob([Buffer.from('Matricule;Nom;Profil\nZ9001;FANTOME Jean;Admin\n', 'utf8')]), 'gam-comptes.csv');
  const depot = await ctrl.go('/rapprochements', { method: 'POST', body: fd });
  assert.equal(depot.status, 302);
  const url = depot.headers.get('location');
  const id = Number(url.match(/\/rapprochements\/(\d+)/)[1]);

  const config = await (await ctrl.go(url)).text();
  assert.match(config, /Quelle colonne contient quoi/);
  assert.match(config, /FANTOME Jean/, 'l’aperçu montre l’extraction');
  const analyse = await ctrl.go(`/rapprochements/${id}/analyser`, urlencode({ matricule: '0', nom: '1', profil: '2' }, ctrl.csrf(config)));
  assert.equal(analyse.status, 302);

  const resultat = await (await ctrl.go(url)).text();
  assert.match(resultat, /Compte non déclaré/);
  assert.match(resultat, /Z9001/);
  assert.doesNotMatch(resultat, /name="suite"/, 'le contrôleur constate, il ne corrige pas le registre');
  assert.match(resultat, /à traiter par le référent/);

  // Le référent de la GAM, lui, régularise.
  const ref = client();
  await ref.connecter('ref');
  const vu = await (await ref.go(url)).text();
  const ligne = vu.match(/action="\/rapprochements\/\d+\/lignes\/(\d+)"/)[1];
  const suite = await ref.go(`/rapprochements/${id}/lignes/${ligne}`, urlencode(
    { suite: 'regularise', role: 'Admin', nom: 'Fantome', prenom: 'Jean' }, ref.csrf(vu)));
  assert.equal(suite.status, 302);
  const apres = await (await ref.go(url)).text();
  assert.match(apres, /régularisé au registre/);
  // Les autres accès GAM du registre ne sont pas dans ce fichier d'un seul compte :
  // ils ressortent comme introuvables, et c'est juste.
  assert.match(apres, /id="non_declare"[\s\S]*?tout est traité/, 'le compte non déclaré est soldé');
  assert.match(apres, /Déclaré, introuvable dans l’application/);

  // L'extraction d'origine se télécharge telle quelle, et l'export CSV existe.
  const brut = await ctrl.go(`/rapprochements/${id}/extraction`);
  assert.equal(brut.status, 200);
  assert.match(Buffer.from(await brut.arrayBuffer()).toString('utf8'), /Z9001;FANTOME Jean/);
  const export_ = await ctrl.go(`/rapprochements/${id}/export.csv`);
  assert.equal(export_.status, 200);
  assert.match(Buffer.from(await export_.arrayBuffer()).toString('utf8'), /Compte non déclaré;Z9001/);

  // Un agent n'a rien à faire ici.
  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go('/rapprochements')).status, 403);
  assert.equal((await agent.go(url)).status, 403);
});

test('rapprochement : un référent ne voit pas celui d’une application hors de son périmètre', async () => {
  const ctrl = client();
  await ctrl.connecter('ctrl');
  const liste = await (await ctrl.go('/rapprochements')).text();
  const fd = new FormData();
  fd.set('_csrf', ctrl.csrf(liste));
  fd.set('applicationId', '2');
  fd.set('extraction', new Blob([Buffer.from('Matricule\nD1\n', 'utf8')]), 'dpi.csv');
  const url = (await ctrl.go('/rapprochements', { method: 'POST', body: fd })).headers.get('location');

  const ref = client();
  await ref.connecter('ref');
  assert.equal((await ref.go(url)).status, 403, 'le référent de la GAM n’ouvre pas le rapprochement du DPI');
  assert.doesNotMatch(await (await ref.go('/rapprochements')).text(), /dpi\.csv/, 'ni ne le voit dans la liste');
});

test('CSRF : un corps multipart adressé à une route sans téléversement est refusé', async () => {
  const h = H.creerHabilitation('agent', { agent: { matricule: 'E45678', nom: 'Petit' }, applicationId: gam, role: 'Contrôle CSRF' });
  const ref = client();
  await ref.connecter('ref');
  const limite = '----registris-csrf';
  const corps = [`--${limite}`, 'Content-Disposition: form-data; name="motif"', '', 'x', `--${limite}--`, ''].join('\r\n');
  const r = await ref.go(`/habilitations/${h.id}/valider`, {
    method: 'POST', body: corps, headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
  });
  assert.equal(r.status, 403);
  assert.equal(H.habilitationParId(h.id).statut, 'demandee', 'rien n’a été validé');
});

test('pièces : un agent ne télécharge que celles de ses propres accès', async () => {
  const autre = H.creerHabilitation('admin', {
    agent: { matricule: 'E99001', nom: 'Autre', prenom: 'Agent' }, applicationId: gam, role: 'Lecture', pourAutrui: true,
  });
  const piece = P.ajouterPreuve('admin', autre.id, { tampon: PNG, nom: 'validation.png' });
  const agent = client();
  await agent.connecter('agent');
  assert.equal((await agent.go(`/preuves/${piece.id}`)).status, 403);
  assert.equal((await agent.go(`/habilitations/${autre.id}`)).status, 403);
  const ctrl = client();
  await ctrl.connecter('ctrl');
  assert.equal((await ctrl.go(`/preuves/${piece.id}`)).status, 200);
});

test('sessions : la santé ne pose pas de cookie, la session de connexion est en base', async () => {
  assert.equal((await client().go('/sante')).headers.get('set-cookie'), null);
  const c = client();
  await c.connecter('admin');
  const n = ouvrirDb().prepare("SELECT COUNT(*) n FROM sessions WHERE donnees LIKE '%\"login\":\"admin\"%'").get().n;
  assert.ok(n >= 1, 'la session connectée est écrite en base');
  await c.go('/deconnexion');
});

test('nouvelle demande : les catégories sont des panneaux du même formulaire, la sélection survit au changement d\'onglet', async () => {
  // Deuxième catégorie : GAM (Gestion) et une application « Soins » doivent pouvoir être cochées ensemble.
  const soins = A.creerCategorie('test', { libelle: 'Soins (test des onglets)' });
  const dpiSoins = A.creerApplication('test', { code: 'DPI-SOINS', libelle: 'DPI soins', categorieId: soins });
  const agent = client();
  await agent.connecter('agent');
  const html = await (await agent.go('/habilitations/nouvelle')).text();
  // Un seul formulaire contient les cases des deux catégories ; seul l'onglet courant est affiché.
  const form = html.slice(html.indexOf('id="choix-apps"'), html.indexOf('</form>'));
  assert.match(form, new RegExp(`name="apps" value="${gam}"`));
  assert.match(form, new RegExp(`name="apps" value="${dpiSoins}"`));
  const panneaux = (form.match(/data-panneau="/g) ?? []).length;
  assert.ok(panneaux >= 2, 'un panneau par catégorie');
  assert.equal((form.match(/data-panneau="\d+" hidden/g) ?? []).length, panneaux - 1, 'seul l\'onglet courant est affiché');
  // L'attribut hidden l'emporte sur les display:grid / flex de la feuille de style.
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  // Les deux sélections aboutissent à une seule demande groupée.
  const multiple = await agent.go(`/habilitations/nouvelle/multiple?apps=${gam}&apps=${dpiSoins}`);
  assert.equal(multiple.status, 200);
  const page = await multiple.text();
  assert.match(page, /2 applications sélectionnées/);
});
