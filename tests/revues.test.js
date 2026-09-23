/**
 * Revue périodique : une campagne fige les accès actifs, chaque décision est
 * tracée, un retrait révoque réellement, et ce qui n'a pas été revu reste
 * visible comme tel. C'est ce dernier point qu'un auditeur vient chercher.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const R = await import('../src/revues.js');
const { journal } = await import('../src/audit.js');

initialiserSchema();
const catId = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'Gestion administrative', categorieId: catId });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'Dossier patient', categorieId: catId });

const accesActif = (matricule, applicationId, role) => {
  const h = H.creerHabilitation('referent', {
    agent: { matricule, nom: 'Durand', prenom: 'Claire' }, applicationId, role,
  });
  H.changerStatut('admin', h.id, 'valider');
  H.changerStatut('admin', h.id, 'executer');
  return h;
};

const repartirAZero = () => {
  const ouverte = R.enCours();
  if (ouverte) R.cloturer('admin', ouverte.id);
};

const actif1 = accesActif('E10001', gam, 'Gestionnaire admissions');
const actif2 = accesActif('E10002', dpi, 'Soignant');
// Une demande non exécutée ne doit pas entrer dans la campagne.
H.creerHabilitation('referent', { agent: { matricule: 'E10003', nom: 'Petit', prenom: 'Luc' }, applicationId: gam, role: 'Consultation' });

test('ouverture : la campagne fige les accès actifs, et eux seuls', () => {
  const c = R.ouvrirCampagne('admin', { libelle: 'Revue 2026', echeance: '2026-12-31' });
  assert.equal(c.accesEntres, 2, 'seuls les accès exécutés entrent dans la campagne');
  assert.equal(R.synthese(c.id).total, 2);
  assert.equal(R.synthese(c.id).sansDecision, 2);

  // Un accès ouvert après coup relève de la campagne suivante.
  accesActif('E10004', gam, 'Guichet');
  assert.equal(R.synthese(c.id).total, 2);

  assert.throws(() => R.ouvrirCampagne('admin', { libelle: 'Doublon' }), /déjà ouverte/);
  assert.throws(() => R.ouvrirCampagne('admin', { libelle: '' }), /libellé/);
  R.cloturer('admin', c.id);
});

test('échéance : une date mal formée est refusée', () => {
  assert.throws(() => R.ouvrirCampagne('admin', { libelle: 'Revue', echeance: '31/12/2026' }), /AAAA-MM-JJ/);
});

test('décisions : maintenir trace, retirer révoque, la clôture fige le constat', () => {
  repartirAZero();
  const c = R.ouvrirCampagne('admin', { libelle: 'Revue applicative' });
  const lignes = R.lignesCampagne(c.id, {});
  assert.ok(lignes.length >= 2);

  R.decider('referent', c.id, actif1.id, 'maintenue', { motif: 'Poste inchangé' });
  const maintenue = R.lignesCampagne(c.id, {}).find((l) => l.habilitation_id === actif1.id);
  assert.equal(maintenue.decision, 'maintenue');
  assert.equal(maintenue.decide_par, 'referent');
  assert.equal(H.habilitationParId(actif1.id).statut, 'executee', 'maintenir ne change pas le statut');

  R.decider('admin', c.id, actif2.id, 'retiree', { motif: 'Départ du service' });
  const revoquee = H.habilitationParId(actif2.id);
  assert.equal(revoquee.statut, 'revoquee', 'retirer révoque réellement, sinon la revue ne prouve rien');
  assert.match(revoquee.date_revocation ?? '', /^\d{4}-\d{2}-\d{2}$/);

  const actions = journal({ limite: 50 }).map((j) => j.action);
  assert.ok(actions.includes('revue:ouvrir'));
  assert.ok(actions.includes('revue:maintenir'));
  assert.ok(actions.includes('revue:retirer'));
  assert.ok(actions.includes('habilitation:revoquer'), 'le retrait passe par le cycle de vie normal');

  const bilan = R.synthese(c.id);
  assert.equal(bilan.maintenues, 1);
  assert.equal(bilan.retirees, 1);
  assert.equal(bilan.sansDecision, bilan.total - 2, 'le reste attend toujours une décision');

  R.cloturer('admin', c.id);
  assert.ok(R.campagneParId(c.id).cloturee_le, 'campagne clôturée');
  assert.throws(() => R.decider('admin', c.id, actif1.id, 'maintenue'), /clôturée/);
  assert.throws(() => R.cloturer('admin', c.id), /déjà clôturée/);
});

test('périmètre : un référent ne voit que ses applications', () => {
  repartirAZero();
  // Le test précédent a révoqué l'accès au dossier patient : il en faut un actif
  // pour que le périmètre ait deux applications à distinguer.
  accesActif('E10005', dpi, 'Lecture');
  const c = R.ouvrirCampagne('admin', { libelle: 'Revue par périmètre' });
  const toutes = R.lignesCampagne(c.id, {});
  const seulementGam = R.lignesCampagne(c.id, { applicationIds: [gam] });
  assert.ok(seulementGam.length < toutes.length);
  assert.ok(seulementGam.every((l) => l.application_id === gam));
  assert.equal(R.lignesCampagne(c.id, { applicationIds: [] }).length, 0, 'aucune application confiée, rien à revoir');
  assert.equal(R.resteAStatuer(c.id, [gam]), seulementGam.length);

  const parApp = R.avancementParApplication(c.id);
  assert.ok(parApp.every((a) => a.total >= a.decidees));
  R.cloturer('admin', c.id);
});

test('périmètre d’une campagne : une seule application', () => {
  repartirAZero();
  const c = R.ouvrirCampagne('admin', { libelle: 'Revue du dossier patient', applicationId: dpi });
  const lignes = R.lignesCampagne(c.id, {});
  assert.ok(lignes.every((l) => l.application_id === dpi));
  assert.equal(R.campagneParId(c.id).perimetre_application_id, dpi);
  R.cloturer('admin', c.id);
});

test('décision inconnue et habilitation hors campagne sont refusées', () => {
  repartirAZero();
  const c = R.ouvrirCampagne('admin', { libelle: 'Revue de contrôle' });
  assert.throws(() => R.decider('admin', c.id, actif1.id, 'peut-être'), /Décision inconnue/);
  const horsCampagne = ouvrirDb().prepare('SELECT MAX(id) n FROM habilitations').get().n + 999;
  assert.throws(() => R.decider('admin', c.id, horsCampagne, 'maintenue'), /ne fait pas partie/);
  R.cloturer('admin', c.id);
});
