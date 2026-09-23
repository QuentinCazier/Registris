// Paramètres clé/valeur : le routage des notifications par catégorie.

import { ouvrirDb } from './db.js';
import { tracer } from './audit.js';

export function getParametre(cle, defaut = '') {
  const r = ouvrirDb().prepare('SELECT valeur FROM parametres WHERE cle = ?').get(cle);
  return r ? r.valeur : defaut;
}

export function setParametre(acteur, cle, valeur) {
  ouvrirDb()
    .prepare(
      `INSERT INTO parametres (cle, valeur) VALUES (?, ?)
         ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
    )
    .run(cle, String(valeur ?? '').trim());
  tracer(acteur, 'parametre:maj', { details: { cle } });
}

const cleRoutage = (categorieId) => `routage:${Number(categorieId)}`;

export function getRoutage(categorieId) {
  if (!categorieId) return '';
  return getParametre(cleRoutage(categorieId), '');
}

export function setRoutage(acteur, categorieId, email) {
  setParametre(acteur, cleRoutage(categorieId), email);
}
