/**
 * Écriture CSV : séparateurs échappés, et surtout formules désamorcées.
 * Le fichier produit est ouvert sur le poste d'un auditeur : une cellule
 * commençant par « = » ne doit jamais y devenir une formule exécutable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { champCsv, ligneCsv, fichierCsv } from '../src/csv.js';

test('échappement : point-virgule, guillemets, retours à la ligne', () => {
  assert.equal(champCsv('Gestion administrative'), 'Gestion administrative');
  assert.equal(champCsv('Admissions; facturation'), '"Admissions; facturation"');
  assert.equal(champCsv('Profil "lecture seule"'), '"Profil ""lecture seule"""');
  assert.equal(champCsv('deux\nlignes'), '"deux\nlignes"');
  assert.equal(champCsv(null), '');
  assert.equal(champCsv(0), '0');
});

test('injection de formule : toute cellule qui commence par un signe de calcul est neutralisée', () => {
  const dangers = [
    '=HYPERLINK("http://exemple/vol","Cliquez")',
    '+1+1',
    '-2+3',
    '@SUM(A1:A9)',
    '\tvaleur',
    '\rvaleur',
  ];
  for (const valeur of dangers) {
    const cellule = champCsv(valeur);
    const contenu = cellule.startsWith('"') ? cellule.slice(1, -1) : cellule;
    assert.ok(contenu.startsWith("'"), `formule non désamorcée : ${JSON.stringify(cellule)}`);
  }
});

test('un texte ordinaire n’est pas abîmé par la protection', () => {
  for (const valeur of ['Soignant', 'E45678', '2026-09-22', 'Accès distant (VPN)', 'Poste inchangé']) {
    assert.equal(champCsv(valeur), valeur);
  }
});

test('ligne et fichier : séparateur, BOM et fins de ligne attendues des tableurs', () => {
  assert.equal(ligneCsv(['a', 'b;c', 'd']), 'a;"b;c";d');
  const f = fichierCsv([['col1', 'col2'], ['x', '=1+1']]);
  assert.ok(f.startsWith('﻿'), 'BOM UTF-8');
  assert.match(f, /col1;col2\r\n/);
  assert.match(f, /x;'=1\+1\r\n$/);
});
