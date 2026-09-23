// Anti-force-brute persistant en base : N échecs par fenêtre glissante, par adresse IP et identifiant.

import { ouvrirDb } from './db.js';

export const MAX_ECHECS = 5;
export const FENETRE_MS = 10 * 60 * 1000;

const expire = (depuis, maintenant) => maintenant - Date.parse(depuis) > FENETRE_MS;

export function estBloque(cle, maintenant = Date.now()) {
  const db = ouvrirDb();
  const e = db.prepare('SELECT n, depuis FROM tentatives_connexion WHERE cle = ?').get(cle);
  if (!e) return false;
  if (expire(e.depuis, maintenant)) {
    db.prepare('DELETE FROM tentatives_connexion WHERE cle = ?').run(cle);
    return false;
  }
  return e.n >= MAX_ECHECS;
}

export function enregistrerEchec(cle, maintenant = Date.now()) {
  const db = ouvrirDb();
  const e = db.prepare('SELECT n, depuis FROM tentatives_connexion WHERE cle = ?').get(cle);
  if (!e || expire(e.depuis, maintenant)) {
    db.prepare('INSERT OR REPLACE INTO tentatives_connexion (cle, n, depuis) VALUES (?, 1, ?)')
      .run(cle, new Date(maintenant).toISOString());
    return 1;
  }
  db.prepare('UPDATE tentatives_connexion SET n = n + 1 WHERE cle = ?').run(cle);
  return e.n + 1;
}

export function reinitialiser(cle) {
  ouvrirDb().prepare('DELETE FROM tentatives_connexion WHERE cle = ?').run(cle);
}

// Appelé de temps en temps, sans conséquence s'il ne l'est pas.
export function purger(maintenant = Date.now()) {
  return ouvrirDb()
    .prepare('DELETE FROM tentatives_connexion WHERE depuis < ?')
    .run(new Date(maintenant - FENETRE_MS).toISOString()).changes;
}
