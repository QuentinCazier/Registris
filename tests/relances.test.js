/**
 * Relances. Ce qui compte : ne relancer que ce qui traîne vraiment, une seule
 * fois par période, et auprès de quelqu'un qui peut agir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const R = await import('../src/relances.js');
const { setRoutage } = await import('../src/parametres.js');
const { historique, journal } = await import('../src/audit.js');

initialiserSchema();
const cat = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: cat });
const catOrpheline = A.creerCategorie('test', { libelle: 'Sans routage' });
const vpn = A.creerApplication('test', { code: 'VPN', libelle: 'VPN', categorieId: catOrpheline });
A.creerUtilisateur('test', {
  login: 'ref', nom: 'Réf', role: 'referent', motDePasse: 'mot-de-passe-de-test',
  email: 'ref@exemple.fr', applicationIds: [gam],
});
setRoutage('test', cat, 'support.gam@exemple.fr');

let n = 0;
const demande = (applicationId = gam) => H.creerHabilitation('test', {
  agent: { matricule: `R${++n}`, nom: 'Agent', prenom: `N${n}` },
  applicationId,
  role: 'Consultation',
  demandeur: 'test',
});
// Le temps ne passe pas pendant un test : on vieillit la demande en base.
const vieillir = (id, jours) => ouvrirDb()
  .prepare("UPDATE habilitations SET date_demande = date('now', ?), cree_le = datetime('now', ?) WHERE id = ?")
  .run(`-${jours} days`, `-${jours} days`, id);

// Il n'y a pas de relais SMTP en test : on injecte l'envoi pour observer ce qui part.
const facteur = (accepte = true) => {
  const boite = [];
  const envoyer = async (m) => {
    boite.push(m);
    return accepte;
  };
  return { boite, envoyer };
};

test('seules les demandes vraiment en attente sont relancées', () => {
  const fraiche = demande();
  const vieille = demande();
  vieillir(vieille.id, config.relanceJours + 3);

  const retard = R.demandesEnRetard().map((h) => h.id);
  assert.ok(retard.includes(vieille.id));
  assert.ok(!retard.includes(fraiche.id), 'une demande du jour ne se relance pas');

  const ligne = R.demandesEnRetard().find((h) => h.id === vieille.id);
  assert.ok(ligne.jours_attente >= config.relanceJours);
});

test('une demande traitée sort des relances, une fermeture demandée y entre', () => {
  const traitee = demande();
  vieillir(traitee.id, 30);
  H.changerStatut('ref', traitee.id, 'executer');
  assert.ok(!R.demandesEnRetard().some((h) => h.id === traitee.id), 'exécutée : plus rien à relancer');

  H.demanderRetrait('cadre', traitee.id, { motif: 'départ' });
  ouvrirDb().prepare("UPDATE habilitations SET retrait_demande_le = datetime('now', '-20 days') WHERE id = ?").run(traitee.id);
  const ligne = R.demandesEnRetard().find((h) => h.id === traitee.id);
  assert.ok(ligne, 'une fermeture qui traîne se relance aussi');
  assert.ok(ligne.jours_attente >= 19);
});

test('la relance part au traitant, sinon à l’adresse de routage de la catégorie', async () => {
  const assignee = demande();
  const libre = demande();
  vieillir(assignee.id, 20);
  vieillir(libre.id, 20);
  H.assigner('test', assignee.id, 'ref');

  const r = await R.relancer({ simuler: true });
  const parDest = new Map(r.envois.map((e) => [e.destinataire, e.demandes]));
  assert.ok(parDest.get('ref@exemple.fr')?.includes(assignee.id), 'au traitant quand il y en a un');
  assert.ok(parDest.get('support.gam@exemple.fr')?.includes(libre.id), 'au routage sinon');
  assert.ok(!parDest.get('ref@exemple.fr')?.includes(libre.id));
});

test('une demande sans traitant ni routage est signalée, pas perdue', async () => {
  const orpheline = demande(vpn);
  vieillir(orpheline.id, 20);
  const r = await R.relancer({ simuler: true });
  assert.ok(r.orphelines.some((h) => h.id === orpheline.id));
  assert.ok(!r.envois.some((e) => e.demandes.includes(orpheline.id)));
});

test('la simulation n’écrit rien ; un envoi note la date et ne se répète pas', async () => {
  const h = demande();
  vieillir(h.id, 20);

  const { boite, envoyer } = facteur();
  await R.relancer({ simuler: true, envoyer });
  assert.equal(boite.length, 0, 'une simulation n’envoie aucun courriel');
  assert.equal(ouvrirDb().prepare('SELECT relance_le, relances FROM habilitations WHERE id = ?').get(h.id).relance_le, null);
  assert.ok(R.aRelancer().some((x) => x.id === h.id));

  const avant = journal({ limite: 500 }).length;
  await R.relancer({ envoyer });
  const apres = ouvrirDb().prepare('SELECT relance_le, relances FROM habilitations WHERE id = ?').get(h.id);
  assert.ok(apres.relance_le, 'la date de relance est notée');
  assert.equal(apres.relances, 1);

  assert.ok(R.demandesEnRetard().some((x) => x.id === h.id), 'elle attend toujours');
  assert.ok(!R.aRelancer().some((x) => x.id === h.id), 'mais on ne la relance pas deux fois dans la période');

  // Une écriture par exécution, pas une par demande.
  const nouvelles = journal({ limite: 500 }).length - avant;
  assert.equal(nouvelles, 1);
  assert.equal(journal({ limite: 5 })[0].action, 'relance:envoyer');
});

test('un envoi qui échoue ne marque rien : la demande sera relancée', async () => {
  const h = demande();
  vieillir(h.id, 25);
  const { boite, envoyer } = facteur(false);

  const r = await R.relancer({ envoyer });
  assert.ok(boite.length >= 1, 'la tentative a bien eu lieu');
  assert.ok(r.envois.every((e) => e.envoye === false));
  assert.equal(ouvrirDb().prepare('SELECT relance_le FROM habilitations WHERE id = ?').get(h.id).relance_le, null);
  assert.ok(R.aRelancer().some((x) => x.id === h.id), 'elle reste à relancer');
  assert.notEqual(journal({ limite: 5 })[0].action, 'relance:envoyer', 'aucune relance à tracer');
});

test('le courriel dit quoi traiter, et pour quel motif', async () => {
  const ouverture = demande();
  vieillir(ouverture.id, 15);
  const { boite, envoyer } = facteur();
  await R.relancer({ envoyer });

  const m = boite.find((x) => x.texte.includes(`n°${ouverture.id}`));
  assert.ok(m, 'la demande figure dans un courriel');
  assert.match(m.sujet, /demande.? d'habilitation en attente/);
  assert.match(m.texte, new RegExp(`n°${ouverture.id} .*GAM, Consultation`));
  assert.match(m.texte, /en attente depuis 1[0-9] jours/);
  assert.match(m.texte, /à valider/);
});

test('passé la période, la relance repart', async () => {
  const h = demande();
  vieillir(h.id, 40);
  await R.relancer({ envoyer: facteur().envoyer });
  assert.ok(!R.aRelancer().some((x) => x.id === h.id));

  ouvrirDb().prepare("UPDATE habilitations SET relance_le = date('now', ?) WHERE id = ?")
    .run(`-${config.relanceJours + 1} days`, h.id);
  assert.ok(R.aRelancer().some((x) => x.id === h.id), 'une demande qui traîne encore se relance à nouveau');
});
