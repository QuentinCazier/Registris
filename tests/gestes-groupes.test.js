/**
 * Un geste, plusieurs accès : la demande multi-applications et le départ.
 * Le point sensible du départ : il doit marcher pour un cadre, qui n'a pas le
 * droit de lire le registre et ne voit donc aucune des fiches concernées.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const { historique } = await import('../src/audit.js');

initialiserSchema();
const cat = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: cat });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'DPI', categorieId: cat });
const pacs = A.creerApplication('test', { code: 'PACS', libelle: 'PACS', categorieId: cat });

const AGENT = { matricule: 'D001', nom: 'Morel', prenom: 'Sophie' };
const ouvrir = (applicationId, matricule = AGENT.matricule) => {
  const h = H.creerHabilitation('cadre', {
    agent: { ...AGENT, matricule },
    applicationId,
    role: 'Consultation',
    demandeur: 'cadre',
  });
  H.changerStatut('admin', h.id, 'executer');
  return h;
};

test('demande multiple : une par application, chacune avec son profil', () => {
  const creees = H.creerDemandeMultiple('cadre', {
    lignes: [{ applicationId: gam, role: 'Gestionnaire' }, { applicationId: dpi, role: 'Soignant' }],
    agent: { matricule: 'M100', nom: 'Bernard', prenom: 'Luc' },
    demandeur: 'cadre',
    pourAutrui: true,
  });

  assert.equal(creees.length, 2);
  assert.deepEqual(creees.map((h) => h.role).sort(), ['Gestionnaire', 'Soignant']);
  assert.equal(new Set(creees.map((h) => h.id)).size, 2, 'deux habilitations distinctes');
  assert.ok(creees.every((h) => h.statut === 'demandee'));
  // Chacune suit son chemin : valider l'une ne touche pas l'autre.
  H.changerStatut('admin', creees[0].id, 'valider');
  assert.equal(H.habilitationParId(creees[1].id).statut, 'demandee');
});

test('demande multiple : sans application ou sans profil, rien n’est créé', () => {
  assert.throws(() => H.creerDemandeMultiple('cadre', { lignes: [], agent: AGENT, demandeur: 'c' }), /au moins une application/);

  const avant = H.compterHabilitations({});
  assert.throws(
    () => H.creerDemandeMultiple('cadre', {
      lignes: [{ applicationId: gam, role: 'Gestionnaire' }, { applicationId: dpi, role: '  ' }],
      agent: { matricule: 'M200', nom: 'Test', prenom: 'Partiel' },
      demandeur: 'cadre',
    }),
    /profil/i,
  );
  assert.equal(H.compterHabilitations({}), avant, 'aucune ligne créée, pas même la première');
});

test('départ : une demande de fermeture sur chaque accès ouvert', () => {
  const a1 = ouvrir(gam);
  const a2 = ouvrir(dpi);
  const enCours = H.creerHabilitation('cadre', {
    agent: AGENT, applicationId: pacs, role: 'Lecture', demandeur: 'cadre',
  });

  const bilan = H.signalerDepart('cadre', {
    matricule: AGENT.matricule,
    motif: 'Départ en retraite',
    demandeur: 'E900 Cadre',
  });

  assert.equal(bilan.fermeturesDemandees, 2, 'les deux accès ouverts, et eux seuls');
  assert.equal(bilan.agent.matricule, AGENT.matricule);
  for (const h of [a1, a2]) {
    const maj = H.habilitationParId(h.id);
    assert.equal(maj.statut, 'executee', 'rien ne se ferme tout seul');
    assert.match(maj.retrait_motif, /retraite/);
    assert.equal(maj.retrait_demande_par, 'E900 Cadre');
  }
  assert.equal(H.habilitationParId(enCours.id).retrait_demande_le, null, 'une demande non exécutée n’est pas concernée');

  const ecriture = historique('agent', bilan.agent.id).find((j) => j.action === 'depart:signaler');
  assert.ok(ecriture, 'le signalement est tracé sur l’agent');
  assert.equal(JSON.parse(ecriture.details).acces, 2);
});

test('départ : le second signalement ne redemande pas ce qui l’est déjà', () => {
  const bilan = H.signalerDepart('cadre', { matricule: AGENT.matricule, motif: 'Relance du départ' });
  assert.equal(bilan.fermeturesDemandees, 0);
  assert.equal(bilan.dejaDemandes, 2, 'les fermetures déjà demandées sont comptées, pas doublées');
});

test('départ : matricule inconnu et motif vide sont refusés', () => {
  assert.throws(() => H.signalerDepart('cadre', { matricule: 'INEXISTANT', motif: 'x' }), /Aucun agent/);
  ouvrir(gam, 'D002');
  assert.throws(() => H.signalerDepart('cadre', { matricule: 'D002', motif: '   ' }), /motif/i);
  const agent = H.agentParMatricule('D002');
  const reste = ouvrirDb()
    .prepare("SELECT COUNT(*) n FROM habilitations WHERE agent_id = ? AND retrait_demande_le IS NOT NULL")
    .get(agent.id).n;
  assert.equal(reste, 0, 'un motif vide ne laisse aucune trace');
});

test('départ : les accès touchés remontent, pour prévenir les référents', () => {
  ouvrir(gam, 'D003');
  ouvrir(dpi, 'D003');
  const bilan = H.signalerDepart('cadre', { matricule: 'D003', motif: 'Mutation' });
  assert.equal(bilan.habilitations.length, 2);
  assert.deepEqual(bilan.habilitations.map((h) => h.app_libelle).sort(), ['DPI', 'GAM']);
});
