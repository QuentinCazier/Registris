// Parcours simplifiés : catalogue, profils, services, suivi en clair, départ, mise en route, import, aide.

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const I = await import('../src/import.js');
const { journal } = await import('../src/audit.js');
const { creerApp } = await import('../src/serveur.js');
const { dateFr, etapeLisible, STYLE } = await import('../src/ui.js');
const { profilSaisi } = await import('../src/routes/demandes.js');

initialiserSchema();
const soins = A.creerCategorie('test', { libelle: 'Soins' });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'Dossier patient', categorieId: soins, profils: 'Soignant\nMédecin' });
const paie = A.creerApplication('test', { code: 'PAIE', libelle: 'Paie', categorieId: soins });
A.creerUf('test', { code: '1101', libelle: 'Médecine polyvalente' });
A.creerUf('test', { code: '2401', libelle: 'Urgences' });
const [uf1101, uf2401] = H.listerUfs().map((u) => u.id);
const MDP = 'mot-de-passe-de-test';
A.creerUtilisateur('test', { login: 'admin', nom: 'Sophie Martin', role: 'admin', motDePasse: MDP });
A.creerUtilisateur('test', { login: 'agent', nom: 'Claire Petit', role: 'utilisateur', motDePasse: MDP, matricule: 'E45678', email: 'claire@exemple.fr' });
A.creerUtilisateur('test', { login: 'ref', nom: 'Pierre Durand', role: 'referent', motDePasse: MDP, applicationIds: [dpi, paie] });

const serveur = creerApp().listen(0, '127.0.0.1');
await new Promise((r) => serveur.once('listening', r));
const BASE = `http://127.0.0.1:${serveur.address().port}`;
test.after(() => serveur.close());

function client() {
  let cookie = '';
  const go = async (chemin, options = {}) => {
    const r = await fetch(BASE + chemin, { ...options, redirect: 'manual', headers: { ...(options.headers ?? {}), cookie } });
    const sc = r.headers.getSetCookie?.() ?? [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return r;
  };
  const csrf = (html) => html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
  const connecter = async (login) => {
    const page = await (await go('/connexion')).text();
    return go('/connexion', {
      method: 'POST',
      body: new URLSearchParams({ login, motDePasse: MDP, _csrf: csrf(page) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  };
  const poster = async (chemin, champs, depuis = '/') => {
    const corps = new URLSearchParams(champs);
    corps.set('_csrf', csrf(await (await go(depuis)).text()) ?? '');
    return go(chemin, { method: 'POST', body: corps, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  };
  const deposer = async (champs, depuis) => {
    const fd = new FormData();
    fd.set('_csrf', csrf(await (await go(depuis)).text()) ?? '');
    for (const [k, v] of Object.entries(champs)) [].concat(v).forEach((x) => fd.append(k, x));
    return go(depuis.startsWith('/habilitations/nouvelle/multiple') ? '/habilitations/multiple' : '/habilitations', { method: 'POST', body: fd });
  };
  return { go, csrf, connecter, poster, deposer };
}
const sansStyle = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');

test('dates et étapes en clair', () => {
  assert.equal(dateFr('2026-09-25'), '25/09/2026');
  assert.equal(dateFr('2026-09-25T14:03:00Z'), '25/09/2026');
  assert.equal(dateFr(null), '');
  assert.equal(etapeLisible({ statut: 'demandee', app_libelle: 'Paie' }), 'En attente de validation par le référent Paie');
  assert.equal(etapeLisible({ statut: 'demandee', assigne_a: 'ref' }, { nomDe: () => 'Pierre Durand' }), "En cours d'examen par Pierre Durand");
  assert.equal(etapeLisible({ statut: 'refusee' }, { motifRefus: 'hors fonction' }), 'Refusée : hors fonction');
  assert.equal(etapeLisible({ statut: 'executee', retrait_demande_le: '2026-09-25' }), 'Accès ouvert, fermeture demandée');
});

test('profil saisi : liste, « je ne sais pas », autre, ancien champ direct', () => {
  assert.equal(profilSaisi({ role_choix: 'Soignant' }), 'Soignant');
  assert.equal(profilSaisi({ role_choix: '__inconnu' }), H.PROFIL_A_PRECISER);
  assert.equal(profilSaisi({ role_choix: '__autre', role_autre: ' Lecture seule ' }), 'Lecture seule');
  assert.equal(profilSaisi({ role_choix: '', role_autre: 'Saisie' }), 'Saisie', 'sans JavaScript, le champ libre suffit');
  assert.equal(profilSaisi({ role_3: 'Direct' }, '_3'), 'Direct');
});

test('catalogue : la carte entière se coche, une recherche, un seul bouton pour continuer', async () => {
  const c = client();
  await c.connecter('agent');
  const html = sansStyle(await (await c.go('/habilitations/nouvelle')).text());
  assert.match(html, /<label class="srv srv-choix"[^>]*>\s*<input type="checkbox" name="apps" value="\d+"/);
  assert.doesNotMatch(html, />Seule</, 'plus de bouton « Seule »');
  assert.match(html, /id="cherche-app"/);
  assert.match(html, /id="continuer"[^>]*>Continuer</);
});

test('formulaire : profils proposés, services à cocher, pièce jointe repliée', async () => {
  const c = client();
  await c.connecter('agent');
  const html = sansStyle(await (await c.go(`/habilitations/nouvelle/${dpi}`)).text());
  assert.match(html, /<select id="role-choix" name="role_choix" data-profil required>/);
  assert.match(html, /<option value="Soignant">Soignant<\/option>\s*<option value="Médecin">/, 'profils déclarés, dans l’ordre');
  assert.match(html, /value="__inconnu">Je ne sais pas, le référent choisira/);
  assert.match(html, /<input type="checkbox" name="ufIds" value="\d+">/, 'les UF se cochent');
  assert.doesNotMatch(html, /<select[^>]*multiple/, 'plus de liste à Ctrl+clic');
  assert.match(html, /<details class="facultatif">\s*<summary>Joindre une pièce justificative/);
});

test('« je ne sais pas » : le référent précise le profil avant de valider, et c’est tracé', async () => {
  const agent = client();
  await agent.connecter('agent');
  const r = await agent.deposer({ applicationId: String(dpi), pour_autrui: '0', matricule: 'E45678', role_choix: '__inconnu', ufIds: String(uf2401) }, `/habilitations/nouvelle/${dpi}`);
  assert.equal(r.status, 302);
  const id = Number(r.headers.get('location').match(/(\d+)$/)[1]);
  assert.equal(H.habilitationParId(id).role, H.PROFIL_A_PRECISER);

  const ref = client();
  await ref.connecter('ref');
  const fiche = sansStyle(await (await ref.go(`/habilitations/${id}`)).text());
  assert.match(fiche, /Profil à préciser/);
  assert.match(fiche, /action="\/habilitations\/\d+\/profil"/);
  const tot = await ref.poster(`/habilitations/${id}/valider`, {}, `/habilitations/${id}`);
  assert.equal(tot.status, 400, 'pas de validation tant que le profil est à préciser');

  const p = await ref.poster(`/habilitations/${id}/profil`, { role: 'Soignant', retour: `/habilitations/${id}` }, `/habilitations/${id}`);
  assert.equal(p.status, 302);
  assert.equal(H.habilitationParId(id).role, 'Soignant');
  assert.ok(journal({ limite: 20 }).some((j) => j.action === 'habilitation:profil' && j.entite_id === id));
  assert.equal((await ref.poster(`/habilitations/${id}/valider`, {}, `/habilitations/${id}`)).status, 302);

  // La demande suivante de l'agent reprend son service.
  const suivante = sansStyle(await (await agent.go(`/habilitations/nouvelle/${paie}`)).text());
  assert.match(suivante, new RegExp(`name="ufIds" value="${uf2401}" checked`));
  assert.doesNotMatch(suivante, new RegExp(`name="ufIds" value="${uf1101}" checked`));

  // L'historique nomme les personnes.
  const histo = sansStyle(await (await ref.go(`/habilitations/${id}`)).text());
  assert.match(histo, /<b>Pierre Durand<\/b> <span[^>]*>a précisé le profil demandé/);
  assert.match(histo, /<b>Claire Petit<\/b> <span[^>]*>a déposé une demande/);
  assert.doesNotMatch(histo, /Écritures scellées/);
});

test('mes demandes et accueil de l’agent : l’étape en clair, le motif du refus', async () => {
  const h = H.creerHabilitation('agent', { agent: { matricule: 'E45678', nom: 'Petit' }, applicationId: paie, role: 'Gestionnaire', demandeur: 'Claire Petit' });
  H.changerStatut('ref', h.id, 'refuser', { motif: 'Profil hors de votre fonction' });
  const c = client();
  await c.connecter('agent');
  const miennes = sansStyle(await (await c.go('/mes-demandes?depose=2')).text());
  assert.match(miennes, /2 demandes envoyées/);
  assert.match(miennes, /Refusée : Profil hors de votre fonction/);
  assert.match(miennes, /Où en est la demande/);
  const accueil = sansStyle(await (await c.go('/')).text());
  assert.match(accueil, /Mes dernières demandes/);
  assert.match(accueil, /Signaler un départ/);
  assert.match(accueil, /Refusée : Profil hors de votre fonction/);
});

test('à traiter : une fermeture demandée propose « Fermer l’accès », pas « Exécuter »', async () => {
  const h = H.creerHabilitation('ref', { agent: { matricule: 'E90001', nom: 'Martin', prenom: 'Paul' }, applicationId: paie, role: 'Saisie' });
  H.changerStatut('ref', h.id, 'executer');
  H.demanderRetrait('agent', h.id, { motif: 'Mutation', demandeur: 'Claire Petit' });
  const ref = client();
  await ref.connecter('ref');
  const html = sansStyle(await (await ref.go('/')).text());
  const ligne = html.slice(html.indexOf(`href="/habilitations/${h.id}"`), html.indexOf('</tr>', html.indexOf(`href="/habilitations/${h.id}"`)));
  assert.match(ligne, /fermeture demandée/);
  assert.match(ligne, new RegExp(`action="/habilitations/${h.id}/revoquer"[\\s\\S]*Fermer l'accès`));
  assert.doesNotMatch(ligne, />Exécuter</);
  assert.doesNotMatch(html, /Journal d'audit vérifié/, 'le référent ne voit pas le vocabulaire d’audit');
  assert.match(html, /Activité récente/);
  assert.equal((await ref.poster(`/habilitations/${h.id}/revoquer`, { retour: '/' })).status, 302);
  assert.equal(H.habilitationParId(h.id).statut, 'revoquee');
});

test('départ : un collègue se retrouve par son nom, sans ses accès', async () => {
  const c = client();
  await c.connecter('agent');
  const r = await (await c.go('/api/agents?q=Mart')).json();
  assert.deepEqual(r.agents.map((a) => a.matricule), ['E90001']);
  assert.deepEqual(Object.keys(r.agents[0]).sort(), ['matricule', 'nom', 'prenom']);
  assert.deepEqual((await (await c.go('/api/agents?q=M')).json()).agents, [], 'deux caractères au moins');
  const page = sansStyle(await (await c.go('/depart')).text());
  assert.match(page, /Agent qui part/);
  assert.match(page, /list="agents-trouves"/);
});

test('administration : mise en route guidée, suppression rangée dans la fiche', async () => {
  const c = client();
  await c.connecter('admin');
  const accueil = sansStyle(await (await c.go('/')).text());
  assert.match(accueil, /Mise en route/);
  assert.match(accueil, /Indiquer les adresses de notification/);
  assert.match(accueil, /Journal d'audit vérifié/);
  const liste = sansStyle(await (await c.go('/admin/applications')).text());
  assert.doesNotMatch(liste, /\/supprimer"/, 'plus de bouton Supprimer sur chaque ligne');
  assert.match(liste, /importer un tableur/);
  const fiche = sansStyle(await (await c.go(`/admin/applications/${paie}/modifier`)).text());
  assert.match(fiche, /action="\/admin\/applications\/\d+\/supprimer"/);
  assert.match(fiche, /name="profils"/);
});

test('import : applications, catégories, référents et profils depuis un tableur', () => {
  const csv = Buffer.from('﻿Code;Libellé;Catégorie;Référents;Profils\r\n'
    + 'GEF;Gestion économique;Gestion;jdupont, MMartin;Engagement, Liquidation\r\n'
    + 'PAIE;Paie et rémunérations;;;\r\n'
    + ';Sans code;;;\r\n'
    + 'LAB;;;;\r\n', 'utf8');
  const bilan = I.importerApplications('admin', csv);
  assert.equal(bilan.creees, 1);
  assert.equal(bilan.modifiees, 1);
  assert.equal(bilan.referents, 2);
  assert.deepEqual(bilan.erreurs.map((e) => e.ligne), [4, 5]);
  const gef = H.listerApplications().find((a) => a.code === 'GEF');
  assert.equal(gef.cat_libelle, 'Gestion', 'catégorie créée à la volée');
  assert.deepEqual(H.profilsProposes(gef.id), ['Engagement', 'Liquidation']);
  assert.ok(A.perimetresReferents().get('mmartin').some((a) => a.id === gef.id), 'identifiant rangé en minuscules');
  assert.equal(H.applicationParId(paie).libelle, 'Paie et rémunérations');
  assert.ok(journal({ limite: 5 }).some((j) => j.action === 'import:applications'));

  const ufs = I.importerUfs('admin', Buffer.from('Code UF;Libellé\n1101;Médecine interne\n3105;Réanimation\n;Sans code\n', 'utf8'));
  assert.deepEqual([ufs.creees, ufs.modifiees, ufs.erreurs.length], [1, 1, 1]);
  assert.throws(() => I.importerApplications('admin', Buffer.from('')), /vide/);
});

test('import par l’écran, modèles téléchargeables', async () => {
  const c = client();
  await c.connecter('admin');
  const modele = await c.go('/admin/import/modele-applications.csv');
  assert.equal(modele.status, 200);
  assert.match(await modele.text(), /Code;Libellé;Catégorie;Référents;Profils/);
  const page = await (await c.go('/admin/import')).text();
  const fd = new FormData();
  fd.set('_csrf', c.csrf(page));
  fd.set('fichier', new Blob([Buffer.from('Code;Libellé\n9001;Bureau des entrées\n', 'utf8')]), 'ufs.csv');
  const r = await c.go('/admin/import/ufs', { method: 'POST', body: fd });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /1 unité fonctionnelle ajoutée/);
});

test('aide : une fiche par rôle, la sienne en premier', async () => {
  const c = client();
  await c.connecter('ref');
  const html = sansStyle(await (await c.go('/aide')).text());
  const titres = [...html.matchAll(/<h2 id="aide-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titres, ['referent', 'utilisateur', 'controleur', 'admin']);
  assert.match(html, /href="\/aide"/, 'lien dans la barre haute');
});

test('affichage : menu lisible sur téléphone, chiffres des phrases en police normale', () => {
  assert.match(STYLE, /\.haut \.r2\{display:flex;gap:2px;padding:0 22px;overflow-x:auto;overflow-y:hidden\}/);
  assert.match(STYLE, /@media \(max-width:640px\)\{[^}]*\}?[\s\S]*?\.haut \.r2\{flex-wrap:wrap/);
  assert.doesNotMatch(STYLE, /\.page-tete \.sous b\{font-family:var\(--mono\)/);
});
