/**
 * Tests unitaires de la couche de présentation : couleur de l'établissement,
 * accords, ancienneté, et garde-fou du tri du registre.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { couleursEtablissement, contraste, luminance, pluriel, depuis, libelleAction, LIB_ACTION } from '../src/ui.js';
import { TRIS } from '../src/habilitations.js';

test("couleur de l'établissement : nuances dérivées et texte lisible dessus", () => {
  const bleu = couleursEtablissement('#12558f');
  assert.equal(bleu.accent, '#12558f');
  assert.ok(luminance(bleu.accentSombre) < luminance(bleu.accent), 'la nuance de survol est plus sombre');
  assert.ok(luminance(bleu.accentClair) > luminance(bleu.accent), 'le fond clair est plus clair');
  assert.equal(bleu.surAccent, '#ffffff');
  assert.ok(contraste(bleu.accent, bleu.surAccent) >= 4.5, 'texte lisible sur la barre haute');

  // Une teinte claire choisie par un établissement ne doit pas produire du blanc sur jaune.
  const clair = couleursEtablissement('#ffd400');
  assert.equal(clair.surAccent, '#111418');
  assert.ok(contraste(clair.accent, clair.surAccent) >= 4.5);

  // Valeur absente ou farfelue : on retombe sur la couleur par défaut, sans planter.
  assert.equal(couleursEtablissement('rouge vif').accent, '#12558f');
  assert.equal(couleursEtablissement('#abc').accent, '#abc');
});

test('accords et ancienneté', () => {
  assert.equal(pluriel(0, 'habilitation'), '0 habilitation');
  assert.equal(pluriel(1, 'habilitation'), '1 habilitation');
  assert.equal(pluriel(7, 'habilitation'), '7 habilitations');
  assert.equal(pluriel(3, 'mois', ''), '3 mois');

  const le10 = new Date('2026-09-10T08:00:00Z');
  assert.equal(depuis('2026-09-10', le10), "aujourd'hui");
  assert.equal(depuis('2026-09-09', le10), 'hier');
  assert.equal(depuis('2026-09-01', le10), 'il y a 9 jours');
  assert.equal(depuis('2026-07-10', le10), 'il y a 2 mois');
  assert.equal(depuis('2024-09-10', le10), 'il y a 2 ans');
  assert.equal(depuis(''), '', 'une date absente ne produit pas de texte');
});

test("le journal se lit en clair, le code technique reste consultable", () => {
  const html = libelleAction('habilitation:valider');
  assert.match(html, /a validé la demande/);
  assert.match(html, /title="habilitation:valider"/);
  // Une action inconnue ne disparaît pas : elle s'affiche telle quelle.
  assert.match(libelleAction('chose:inconnue'), /chose:inconnue/);
  for (const code of Object.keys(LIB_ACTION)) assert.match(code, /^[a-z]+:[a-z]+(-[a-z]+)*$/);
});

test('tri du registre : seules les colonnes connues atteignent le SQL', () => {
  assert.ok(Object.keys(TRIS).includes('agent'));
  for (const expression of Object.values(TRIS)) {
    assert.match(expression, /^[a-z_]+\.[a-z_]+$|^nb_preuves$/, 'aucune expression libre dans la clause ORDER BY');
  }
});
