import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');

initialiserSchema();
const catId = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'Gestion administrative', categorieId: catId });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'Dossier patient', categorieId: catId });
A.creerUf('test', { code: '9001', libelle: 'Bureau des entrées' });
const uf = ouvrirDb().prepare("SELECT id FROM ufs WHERE code = '9001'").get().id;

const agentTest = (m) => ({ matricule: m, nom: 'Durand', prenom: 'Claire', email: 'c.durand@exemple.fr' });

test('création : statut « demandée », UF liées, agent créé une seule fois', () => {
  const h = H.creerHabilitation('referente', { agent: agentTest('E12345'), applicationId: gam, role: 'Gestionnaire', ufIds: [uf] });
  assert.equal(h.statut, 'demandee');
  assert.equal(h.date_demande, new Date().toISOString().slice(0, 10));
  assert.deepEqual(h.ufs.map((u) => u.code), ['9001']);

  H.creerHabilitation('referente', { agent: agentTest('E12345'), applicationId: dpi, role: 'Lecture' });
  const agents = H.rechercherAgents('E12345');
  assert.equal(agents.length, 1);
  assert.equal(agents[0].habilitations.length, 2);
  assert.equal(agents[0].habilitations.find((x) => x.app_code === 'GAM').role, 'Gestionnaire');
});

test('création refusée sans matricule, sans profil, ou sur une application désactivée', () => {
  assert.throws(() => H.creerHabilitation('x', { agent: { matricule: '', nom: 'A' }, applicationId: gam, role: 'R' }), /matricule/);
  assert.throws(() => H.creerHabilitation('x', { agent: agentTest('E1'), applicationId: gam, role: '  ' }), /profil/);
  assert.throws(() => H.creerHabilitation('x', { agent: agentTest('E1'), applicationId: 9999, role: 'R' }), /inconnue/);
  const off = A.creerApplication('test', { code: 'OFF', libelle: 'Désactivée', categorieId: catId });
  A.modifierApplication('test', off, { actif: false });
  assert.throws(() => H.creerHabilitation('x', { agent: agentTest('E1'), applicationId: off, role: 'R' }), /désactivée/);
});

test('cycle de vie : valider puis exécuter, dates renseignées', () => {
  const h = H.creerHabilitation('referente', { agent: agentTest('E22222'), applicationId: gam, role: 'Lecture seule' });
  const v = H.changerStatut('referente', h.id, 'valider');
  assert.equal(v.statut, 'validee');
  assert.ok(v.date_validation);
  const e = H.changerStatut('dsi', h.id, 'executer');
  assert.equal(e.statut, 'executee');
  assert.ok(e.date_realisation);
  const r = H.changerStatut('dsi', h.id, 'revoquer', { motif: 'départ' });
  assert.equal(r.statut, 'revoquee');
  assert.ok(r.date_revocation);
});

test('transitions illégales rejetées, action inconnue rejetée', () => {
  const h = H.creerHabilitation('referente', { agent: agentTest('E33333'), applicationId: gam, role: 'Admin' });
  H.changerStatut('referente', h.id, 'revoquer');
  assert.throws(() => H.changerStatut('referente', h.id, 'valider'), /Impossible/);
  assert.throws(() => H.changerStatut('referente', h.id, 'executer'), /Impossible/);
  assert.throws(() => H.changerStatut('referente', h.id, 'constructor'), /inconnue/);
  assert.throws(() => H.changerStatut('referente', 999999, 'valider'), /introuvable/);
});

test('exécution directe depuis « demandée » autorisée (petite structure sans validation séparée)', () => {
  const h = H.creerHabilitation('referente', { agent: agentTest('E44444'), applicationId: gam, role: 'X' });
  assert.equal(H.changerStatut('referente', h.id, 'executer').statut, 'executee');
});

test('pack : une demande par élément, pour le même agent, en une transaction', () => {
  const pid = A.creerPack('test', { nom: 'Secrétaire', description: '' });
  A.ajouterElementPack('test', pid, gam, 'Consultation');
  A.ajouterElementPack('test', pid, dpi, 'Secrétariat');
  const pack = A.packParId(pid);
  const creees = H.appliquerPack('rh', pack, { agent: agentTest('E55555'), demandeur: 'RH' });
  assert.equal(creees.length, 2);
  assert.deepEqual(creees.map((h) => h.role).sort(), ['Consultation', 'Secrétariat']);
  assert.ok(creees.every((h) => h.pour_autrui === 1));
  assert.throws(() => H.appliquerPack('rh', { nom: 'vide', elements: [] }, { agent: agentTest('E5') }), /aucun accès/);
});

test('listing filtré et statistiques cohérentes', () => {
  const tout = H.listerHabilitations();
  const demandees = H.listerHabilitations({ statut: 'demandee' });
  assert.ok(demandees.every((h) => h.statut === 'demandee'));
  const parQ = H.listerHabilitations({ q: 'E55555' });
  assert.equal(parQ.length, 2);
  const s = H.statistiques();
  assert.equal(s.habilitations, tout.length);
  assert.equal(Object.values(s.parStatut).reduce((a, b) => a + b, 0), tout.length);
  assert.ok(s.sansPreuve >= 1);
});

test('mes demandes : filtrées par créateur', () => {
  assert.ok(H.listerDemandesDe('rh').length >= 2);
  assert.equal(H.listerDemandesDe('personne').length, 0);
});
