import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const R = await import('../src/roles.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const { authentifier } = await import('../src/auth.js');

initialiserSchema();

test('matrice des permissions', () => {
  assert.equal(R.peut('admin', 'admin:gerer'), true);
  assert.equal(R.peut('controleur', 'export:audit'), true);
  assert.equal(R.peut('controleur', 'habilitation:valider'), false);
  assert.equal(R.peut('utilisateur', 'audit:lire'), false);
  assert.equal(R.peut('utilisateur', 'habilitation:creer'), true);
  assert.equal(R.peut('admin', 'constructor'), false);
  assert.equal(R.peut('admin', 'toString'), false);
  assert.equal(R.peut(undefined, 'habilitation:lire'), false);
});

test('périmètre du référent', () => {
  assert.equal(R.referentGereApplication({ role: 'admin' }, 42), true);
  assert.equal(R.referentGereApplication({ role: 'referent', referentApps: 'ALL' }, 42), true);
  assert.equal(R.referentGereApplication({ role: 'referent', referentApps: [1, 2] }, 2), true);
  assert.equal(R.referentGereApplication({ role: 'referent', referentApps: [1, 2] }, '2'), true);
  assert.equal(R.referentGereApplication({ role: 'referent', referentApps: [1, 2] }, 3), false);
  assert.equal(R.referentGereApplication({ role: 'controleur' }, 1), false);
  assert.equal(R.referentGereApplication(null, 1), false);
});

test('rôle déduit des groupes de l\'annuaire, par priorité', () => {
  const mapping = { admin: 'GG_OH_Admin', controleur: 'GG_OH_Controleur', referent: 'GG_OH_Referent', utilisateur: 'GG_OH_Utilisateur' };
  assert.equal(R.roleDepuisGroupes(['CN=GG_OH_Utilisateur,OU=x'], mapping), 'utilisateur');
  assert.equal(R.roleDepuisGroupes(['gg_oh_referent', 'GG_OH_Utilisateur'], mapping), 'referent');
  assert.equal(R.roleDepuisGroupes(['GG_OH_Admin', 'GG_OH_Referent'], mapping), 'admin');
  assert.equal(R.roleDepuisGroupes(['Autre'], mapping), null);
  assert.equal(R.roleDepuisGroupes(['GG_OH_Admin'], { ...mapping, admin: '' }), null);
});

test('comptes locaux : création, mot de passe, authentification, périmètre référent', async () => {
  const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM' });
  const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'DPI' });
  assert.throws(() => A.creerUtilisateur('test', { login: 'court', nom: 'X', role: 'admin', motDePasse: 'court' }), /trop court/);
  assert.throws(() => A.creerUtilisateur('test', { login: 'x', nom: 'X', role: 'inconnu', motDePasse: 'un-mot-de-passe-long' }), /Rôle inconnu/);
  A.creerUtilisateur('test', { login: 'admin', nom: 'Admin', role: 'admin', motDePasse: 'un-mot-de-passe-long' });
  A.creerUtilisateur('test', { login: 'ref', nom: 'Réf', role: 'referent', motDePasse: 'un-mot-de-passe-long', applicationIds: [gam] });
  assert.throws(() => A.creerUtilisateur('test', { login: 'admin', nom: 'Bis', role: 'admin', motDePasse: 'un-mot-de-passe-long' }), /existe déjà/);

  const u = await authentifier('ref', 'un-mot-de-passe-long');
  assert.equal(u.role, 'referent');
  assert.deepEqual(u.referentApps, [gam]);
  assert.equal(await authentifier('ref', 'mauvais'), null);
  assert.equal(await authentifier('inconnu', 'x'), null);
  assert.equal(await authentifier('', ''), null);

  A.definirPerimetreReferent('test', 'ref', [gam, dpi]);
  assert.deepEqual((await authentifier('ref', 'un-mot-de-passe-long')).referentApps.sort(), [gam, dpi].sort());
  A.definirPerimetreReferent('test', 'jdupont', [dpi]); // identifiant annuaire, sans compte local
  assert.deepEqual(A.perimetresReferents().get('jdupont').map((a) => a.id), [dpi]);
});

test('le dernier administrateur actif ne peut être ni rétrogradé, ni désactivé, ni supprimé', () => {
  assert.throws(() => A.modifierUtilisateur('test', 'admin', { role: 'utilisateur' }), /dernier administrateur/);
  assert.throws(() => A.modifierUtilisateur('test', 'admin', { role: 'admin', actif: false }), /dernier administrateur/);
  assert.throws(() => A.supprimerUtilisateur('test', 'admin'), /dernier administrateur/);
  A.creerUtilisateur('test', { login: 'admin2', nom: 'Admin 2', role: 'admin', motDePasse: 'un-mot-de-passe-long' });
  A.modifierUtilisateur('test', 'admin', { role: 'controleur' });
  assert.equal(A.utilisateurParLogin('admin').role, 'controleur');
});

test('catalogue : code contrôlé, suppression refusée si des habilitations existent, catégorie non vide', () => {
  assert.throws(() => A.creerApplication('test', { code: 'mauvais code', libelle: 'X' }), /Code invalide/);
  const cat = A.creerCategorie('test', { libelle: 'Cat' });
  const app = A.creerApplication('test', { code: 'PACS', libelle: 'PACS', categorieId: cat });
  assert.throws(() => A.supprimerCategorie('test', cat), /non vide/);
  H.creerHabilitation('x', { agent: { matricule: 'E1', nom: 'A' }, applicationId: app, role: 'R' });
  assert.throws(() => A.supprimerApplication('test', app), /référencent/);
  A.modifierApplication('test', app, { actif: false });
  assert.equal(H.applicationParId(app).actif, 0);
  assert.equal(H.listerApplications({ actives: true }).some((a) => a.id === app), false);
});

test('référentiels : UF et sites protégés s\'ils sont utilisés', () => {
  A.creerUf('test', { code: '1101', libelle: 'Médecine' });
  assert.throws(() => A.creerUf('test', { code: '1101', libelle: 'Doublon' }), /existe déjà/);
  const uf = H.listerUfs()[0];
  const app = A.creerApplication('test', { code: 'LABO', libelle: 'Labo' });
  H.creerHabilitation('x', { agent: { matricule: 'E2', nom: 'B' }, applicationId: app, role: 'R', ufIds: [uf.id] });
  assert.throws(() => A.supprimerUf('test', uf.id), /référencent/);
  A.creerSite('test', 'Nord');
  assert.throws(() => A.creerSite('test', 'Nord'), /existe déjà/);
});
