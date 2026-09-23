/**
 * Bibliothèque de logiciels. Son intérêt se juge sur une base vide : une DSI
 * doit obtenir un catalogue rangé en un geste, sans avoir créé de catégorie.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const { BIBLIOTHEQUE, produits, produitParCode } = await import('../src/logiciels.js');
const { journal } = await import('../src/audit.js');

initialiserSchema();

test('la liste elle-même est exploitable : codes uniques, valides, et rattachés', () => {
  const tous = produits();
  const codes = tous.map((p) => p.code);
  assert.equal(new Set(codes).size, codes.length, 'aucun code en double');
  for (const p of tous) {
    assert.match(p.code, /^[A-Z0-9_.-]{2,40}$/, `code utilisable comme code d’application : ${p.code}`);
    assert.ok(p.nom.trim(), 'chaque produit porte un nom');
    assert.ok(BIBLIOTHEQUE.some((f) => f.code === p.fonction), 'chaque produit relève d’une fonction connue');
  }
  for (const f of BIBLIOTHEQUE) {
    assert.ok(f.libelle.trim() && f.description.trim());
    assert.ok(f.produits.length, `la fonction ${f.code} propose au moins un produit`);
  }
});

test('depuis une base vide : les catégories se créent avec les applications', () => {
  assert.equal(A.listerCategories({ tous: true }).length, 0, 'on part bien de rien');

  const bilan = A.ajouterDepuisBibliotheque('admin', ['SILLAGE', 'GLIMS', 'XPLORE']);
  assert.equal(bilan.ajoutees.length, 3);
  assert.equal(bilan.categorieCreees.length, 3, 'une catégorie par fonction touchée');

  const apps = H.listerApplications();
  assert.equal(apps.length, 3);
  const sillage = apps.find((a) => a.code === 'SILLAGE');
  assert.equal(sillage.libelle, 'Sillage');
  assert.equal(sillage.cat_libelle, 'Identité, mouvements et facturation');
  assert.ok(apps.every((a) => a.categorie_id), 'aucune application orpheline de catégorie');
});

test('deux produits d’une même fonction ne créent qu’une catégorie', () => {
  const avant = A.listerCategories({ tous: true }).length;
  const bilan = A.ajouterDepuisBibliotheque('admin', ['MOLIS', 'TDNEXLABS']);
  assert.equal(bilan.ajoutees.length, 2);
  assert.equal(bilan.categorieCreees.length, 0, 'la catégorie Laboratoire existait déjà');
  assert.equal(A.listerCategories({ tous: true }).length, avant);
});

test('un logiciel déjà au catalogue est signalé, pas dupliqué', () => {
  const bilan = A.ajouterDepuisBibliotheque('admin', ['SILLAGE', 'DXCARE']);
  assert.deepEqual(bilan.existantes, ['Sillage']);
  assert.deepEqual(bilan.ajoutees, ['DxCare']);
  assert.equal(H.listerApplications().filter((a) => a.code === 'SILLAGE').length, 1);

  const etat = A.etatBibliotheque();
  const ligne = etat.flatMap((f) => f.produits).find((p) => p.code === 'SILLAGE');
  assert.equal(ligne.present, true, 'l’écran peut le présenter comme déjà là');
});

test('une sélection vide ou inconnue ne crée rien', () => {
  const avant = H.listerApplications().length;
  assert.throws(() => A.ajouterDepuisBibliotheque('admin', []), /au moins un logiciel/);
  assert.throws(() => A.ajouterDepuisBibliotheque('admin', ['CE-CODE-N-EXISTE-PAS']), /au moins un logiciel/);
  assert.equal(H.listerApplications().length, avant);
});

test('l’ajout est tracé, avec la version de la liste', () => {
  A.ajouterDepuisBibliotheque('admin', ['OCTIME']);
  const ecriture = journal({ limite: 50 }).find((j) => j.action === 'bibliotheque:ajouter');
  assert.ok(ecriture);
  const details = JSON.parse(ecriture.details);
  assert.ok(details.version, 'la version de la bibliothèque est conservée');
  assert.ok(details.logiciels.includes('Octime'));
});

test('un produit ajouté est une application ordinaire : on peut demander un accès dessus', () => {
  const app = H.listerApplications().find((a) => a.code === 'GLIMS');
  const h = H.creerHabilitation('agent', {
    agent: { matricule: 'B001', nom: 'Test', prenom: 'Bibliothèque' },
    applicationId: app.id,
    role: 'Validation biologique',
    demandeur: 'agent',
  });
  assert.equal(h.app_libelle, 'GLIMS');
  assert.equal(h.statut, 'demandee');
});
