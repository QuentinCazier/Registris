/**
 * Boîte d'entrée : refus motivé, prise en charge, demande de fermeture.
 * Ce qui compte ici : un refus n'est pas une révocation, et une fermeture
 * demandée ne ferme rien tant qu'un référent n'a pas agi.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const { historique } = await import('../src/audit.js');

initialiserSchema();
A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: 1 });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'DPI', categorieId: 1 });
const MDP = 'mot-de-passe-de-test';
A.creerUtilisateur('test', { login: 'ref', nom: 'Réf GAM', role: 'referent', motDePasse: MDP, applicationIds: [gam] });
A.creerUtilisateur('test', { login: 'refdpi', nom: 'Réf DPI', role: 'referent', motDePasse: MDP, applicationIds: [dpi] });
A.creerUtilisateur('test', { login: 'admin', nom: 'Admin', role: 'admin', motDePasse: MDP });

let n = 0;
const nouvelle = () => H.creerHabilitation('ref', {
  agent: { matricule: `T${++n}`, nom: 'Agent', prenom: `N${n}` },
  applicationId: gam,
  role: 'Consultation',
  demandeur: 'ref',
});
const ouverte = () => {
  const h = nouvelle();
  H.changerStatut('ref', h.id, 'executer');
  return H.habilitationParId(h.id);
};

test('refuser : motif obligatoire, la demande quitte la file sans créer d’accès', () => {
  const h = nouvelle();
  assert.throws(() => H.changerStatut('ref', h.id, 'refuser'), /motivé/);
  assert.equal(H.habilitationParId(h.id).statut, 'demandee');

  const maj = H.changerStatut('ref', h.id, 'refuser', { motif: 'profil non justifié' });
  assert.equal(maj.statut, 'refusee');
  assert.ok(maj.date_refus, 'le refus porte sa date');
  assert.equal(maj.date_realisation, null, 'aucun accès n’a été ouvert');

  const file = H.listerHabilitations({ file: true }).map((x) => x.id);
  assert.ok(!file.includes(h.id), 'une demande refusée sort de la file');
  assert.match(JSON.stringify(historique('habilitation', h.id)), /profil non justifié/);
});

test('refusée et révoquée restent deux choses différentes au registre', () => {
  const avant = H.compterHabilitations({ statut: 'refusee' });
  const refusee = nouvelle();
  H.changerStatut('ref', refusee.id, 'refuser', { motif: 'doublon' });
  const revoquee = ouverte();
  H.changerStatut('ref', revoquee.id, 'revoquer', { motif: 'départ' });

  assert.equal(H.habilitationParId(refusee.id).statut, 'refusee');
  assert.equal(H.habilitationParId(revoquee.id).statut, 'revoquee');
  assert.equal(H.compterHabilitations({ statut: 'refusee' }), avant + 1);
  assert.equal(H.statistiques().parStatut.refusee, avant + 1);
});

test('demander la fermeture ne ferme rien : l’accès reste ouvert', () => {
  const h = ouverte();
  assert.throws(() => H.demanderRetrait('cadre', h.id, { motif: '' }), /motif/i);

  const maj = H.demanderRetrait('cadre', h.id, { motif: 'départ le 31/12', demandeur: 'E4567 Cadre' });
  assert.equal(maj.statut, 'executee', 'l’accès est toujours ouvert');
  assert.equal(maj.retrait_demande_par, 'E4567 Cadre');
  assert.match(maj.retrait_motif, /31\/12/);

  const file = H.listerHabilitations({ file: true }).map((x) => x.id);
  assert.ok(file.includes(h.id), 'la fermeture demandée entre dans la file de traitement');
  assert.throws(() => H.demanderRetrait('cadre', h.id, { motif: 'encore' }), /déjà demandée/);
});

test('une demande de fermeture ne vise qu’un accès ouvert', () => {
  const demandee = nouvelle();
  assert.throws(() => H.demanderRetrait('cadre', demandee.id, { motif: 'inutile' }), /accès ouvert/);
});

test('la fermeture exécutée solde la demande, et le journal garde le lien', () => {
  const h = ouverte();
  H.demanderRetrait('cadre', h.id, { motif: 'mutation', demandeur: 'Cadre' });
  const maj = H.changerStatut('ref', h.id, 'revoquer');

  assert.equal(maj.statut, 'revoquee');
  assert.equal(maj.retrait_demande_le, null, 'la demande est soldée');
  const ecrit = JSON.stringify(historique('habilitation', h.id));
  assert.match(ecrit, /demande de fermeture/);
  assert.match(ecrit, /mutation/, 'le motif du demandeur reste lisible au journal');
  assert.ok(!H.listerHabilitations({ file: true }).some((x) => x.id === h.id));
});

test('le référent peut refuser une fermeture, l’accès reste ouvert', () => {
  const h = ouverte();
  H.demanderRetrait('cadre', h.id, { motif: 'erreur de service' });
  assert.throws(() => H.refuserRetrait('ref', h.id, { motif: '' }), /motivé/);

  const maj = H.refuserRetrait('ref', h.id, { motif: 'agent toujours en poste' });
  assert.equal(maj.statut, 'executee');
  assert.equal(maj.retrait_demande_le, null);
  assert.match(JSON.stringify(historique('habilitation', h.id)), /toujours en poste/);
  assert.throws(() => H.refuserRetrait('ref', h.id, { motif: 'encore' }), /Aucune fermeture/);
});

test('prise en charge : assignation, retrait, et filtre de la file', () => {
  const h = nouvelle();
  H.assigner('admin', h.id, 'ref');
  const maj = H.habilitationParId(h.id);
  assert.equal(maj.assigne_a, 'ref');
  assert.ok(maj.assigne_le, 'la prise en charge est datée');

  assert.ok(H.listerHabilitations({ file: true, assigneA: 'ref' }).some((x) => x.id === h.id));
  assert.ok(!H.listerHabilitations({ file: true, nonAssignees: true }).some((x) => x.id === h.id));

  H.assigner('admin', h.id, '');
  assert.equal(H.habilitationParId(h.id).assigne_a, null);
  assert.ok(H.listerHabilitations({ file: true, nonAssignees: true }).some((x) => x.id === h.id));
});

test('on n’assigne pas une demande qui n’est plus dans la file', () => {
  const h = ouverte();
  assert.throws(() => H.assigner('admin', h.id, 'ref'), /file de traitement/);
  H.demanderRetrait('cadre', h.id, { motif: 'fin de mission' });
  assert.doesNotThrow(() => H.assigner('admin', h.id, 'ref'), 'une fermeture demandée est assignable');
});

test('traitants possibles : le référent de l’application, pas celui d’une autre', () => {
  const logins = A.traitantsPossibles(gam).map((t) => t.login);
  assert.ok(logins.includes('ref'));
  assert.ok(logins.includes('admin'), 'l’administrateur peut toujours reprendre une demande');
  assert.ok(!logins.includes('refdpi'), 'le référent du DPI n’a rien à faire dans la GAM');
});
