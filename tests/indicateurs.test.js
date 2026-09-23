/**
 * Indicateurs. On fabrique des délais connus d'avance et on vérifie les chiffres,
 * pas seulement qu'une page s'affiche : un indicateur faux est pire qu'absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const I = await import('../src/indicateurs.js');
const { jours } = await import('../src/routes/indicateurs.js');

initialiserSchema();
const cat = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: cat });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'DPI', categorieId: cat });

let n = 0;
const iso = (decalage) => new Date(Date.now() + decalage * 86400000).toISOString().slice(0, 10);

// Une habilitation ouverte après `attente` jours, déposée il y a `age` jours.
function ouverte(applicationId, { age = 30, attente = 0 } = {}) {
  const h = H.creerHabilitation('test', {
    agent: { matricule: `I${++n}`, nom: 'Agent', prenom: `N${n}` },
    applicationId,
    role: 'Consultation',
    demandeur: 'test',
    dateDemande: iso(-age),
  });
  H.changerStatut('test', h.id, 'executer');
  ouvrirDb().prepare('UPDATE habilitations SET date_realisation = ? WHERE id = ?').run(iso(-age + attente), h.id);
  return h;
}

test('synthèse : médiane et neuf sur dix, sur des valeurs connues', () => {
  assert.deepEqual(I.synthese([]), { n: 0, mediane: null, p90: null, max: null });
  assert.equal(I.synthese([5]).mediane, 5);
  assert.equal(I.synthese([1, 3]).mediane, 2, 'moyenne des deux valeurs centrales');
  const dix = I.synthese([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  assert.equal(dix.mediane, 5.5);
  assert.equal(dix.p90, 9, 'la demande oubliée cent jours ne fausse pas le « neuf sur dix »');
  assert.equal(dix.max, 100, 'mais elle reste visible comme le plus long');
});

test('délai d’ouverture : du dépôt à l’ouverture, par application', () => {
  ouverte(gam, { attente: 2 });
  ouverte(gam, { attente: 4 });
  ouverte(gam, { attente: 6 });
  ouverte(dpi, { attente: 10 });

  const d = I.delaisOuverture({ depuis: iso(-365) });
  const parApp = I.parApplication(d);
  const lgam = parApp.find((a) => a.libelle === 'GAM');
  const ldpi = parApp.find((a) => a.libelle === 'DPI');
  assert.equal(lgam.n, 3);
  assert.equal(lgam.mediane, 4);
  assert.equal(lgam.max, 6);
  assert.equal(ldpi.mediane, 10);
  assert.equal(parApp[0].libelle, 'DPI', 'la plus lente en tête : c’est elle qu’on vient chercher');
});

test('la période filtre sur la date d’ouverture', () => {
  ouverte(gam, { age: 400, attente: 1 });
  const recent = I.delaisOuverture({ depuis: iso(-90) });
  const tout = I.delaisOuverture({ depuis: iso(-800) });
  assert.ok(tout.length > recent.length, 'une ouverture d’il y a plus d’un an sort de la période courte');
});

test('délai de fermeture : lu dans le journal, du signalement à la fermeture', () => {
  const h = ouverte(gam, { age: 60, attente: 1 });
  H.demanderRetrait('cadre', h.id, { motif: 'départ' });
  H.changerStatut('ref', h.id, 'revoquer');

  // Les horodatages sont ceux du journal : on les recule pour fabriquer trois jours.
  const db = ouvrirDb();
  const demande = db.prepare("SELECT id FROM journal_audit WHERE entite_id = ? AND action = 'retrait:demander'").get(h.id);
  db.prepare('UPDATE journal_audit SET horodatage = ? WHERE id = ?')
    .run(new Date(Date.now() - 3 * 86400000).toISOString(), demande.id);

  const f = I.delaisFermeture({ depuis: iso(-30) }).find((x) => x.id === h.id);
  assert.ok(f, 'la fermeture après signalement est retenue');
  assert.ok(Math.abs(f.jours - 3) < 0.01, `trois jours, pas ${f.jours}`);
});

test('une révocation sans signalement préalable n’entre pas dans le délai de fermeture', () => {
  const h = ouverte(dpi, { age: 20, attente: 1 });
  H.changerStatut('ref', h.id, 'revoquer', { motif: 'décision du référent' });
  assert.ok(!I.delaisFermeture({ depuis: iso(-30) }).some((x) => x.id === h.id),
    'rien à mesurer : personne n’avait signalé de départ');
});

test('un signalement refusé puis refait compte à partir du second', () => {
  const h = ouverte(gam, { age: 40, attente: 1 });
  H.demanderRetrait('cadre', h.id, { motif: 'erreur' });
  H.refuserRetrait('ref', h.id, { motif: 'toujours en poste' });
  H.demanderRetrait('cadre', h.id, { motif: 'départ réel' });
  H.changerStatut('ref', h.id, 'revoquer');

  const db = ouvrirDb();
  const demandes = db.prepare(
    "SELECT id FROM journal_audit WHERE entite_id = ? AND action = 'retrait:demander' ORDER BY id",
  ).all(h.id);
  db.prepare('UPDATE journal_audit SET horodatage = ? WHERE id = ?')
    .run(new Date(Date.now() - 20 * 86400000).toISOString(), demandes[0].id);
  db.prepare('UPDATE journal_audit SET horodatage = ? WHERE id = ?')
    .run(new Date(Date.now() - 2 * 86400000).toISOString(), demandes[1].id);

  const f = I.delaisFermeture({ depuis: iso(-30) }).find((x) => x.id === h.id);
  assert.ok(Math.abs(f.jours - 2) < 0.01, `deux jours depuis le second signalement, pas ${f.jours}`);
});

test('en ce moment : l’âge de la plus ancienne compte autant que le nombre', () => {
  const vieille = H.creerHabilitation('test', {
    agent: { matricule: 'ATT1', nom: 'Attente', prenom: 'Longue' },
    applicationId: gam, role: 'Saisie', demandeur: 'test', dateDemande: iso(-15),
  });
  const h = ouverte(dpi, { age: 50, attente: 1 });
  H.demanderRetrait('cadre', h.id, { motif: 'départ' });
  ouvrirDb().prepare("UPDATE habilitations SET retrait_demande_le = datetime('now', '-9 days') WHERE id = ?").run(h.id);

  const e = I.enAttente();
  assert.ok(e.ouvertures.n >= 1);
  assert.ok(e.ouvertures.plusAncienne >= 15 - 0.01, 'la demande déposée il y a quinze jours est vue');
  assert.ok(e.fermetures.n >= 1);
  assert.ok(Math.abs(e.fermetures.plusAncienne - 9) < 0.01, `neuf jours, pas ${e.fermetures.plusAncienne}`);
  assert.ok(vieille.id);
});

test('les trois formats de date du projet se lisent pareil', () => {
  const attendu = Date.UTC(2026, 8, 22, 10, 30, 0);
  assert.equal(I.versInstant('2026-09-22 10:30:00'), attendu, 'horodatage SQLite, en UTC');
  assert.equal(I.versInstant('2026-09-22T10:30:00.000Z'), attendu, 'horodatage du journal');
  assert.equal(I.versInstant('2026-09-22'), Date.UTC(2026, 8, 22), 'date du registre');
});

test('volumes : douze mois, du plus ancien au plus récent, les mois vides à zéro', () => {
  const v = I.volumesParMois();
  assert.equal(v.length, 12);
  assert.ok(v[0].mois < v[11].mois);
  assert.equal(v[11].mois, new Date().toISOString().slice(0, 7), 'le mois courant ferme la liste');
  assert.ok(v.every((m) => Number.isInteger(m.deposees) && m.deposees >= 0));
  assert.ok(v[11].ouvertes >= 1 || v.some((m) => m.ouvertes >= 1));
});

test('un délai se lit en jours, avec une décimale tant qu’elle a un sens', () => {
  assert.equal(jours(null), '-');
  assert.equal(jours(0), "moins d'un jour");
  assert.equal(jours(2.46), '2,5 j');
  assert.equal(jours(14.4), '14 j');
});
