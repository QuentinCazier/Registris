/**
 * Anti-force-brute sur la connexion, persistant en base : N échecs dans une
 * fenêtre glissante, par adresse IP et identifiant. En base plutôt qu'en
 * mémoire pour survivre à un redémarrage et rester juste si plusieurs
 * processus servent l'application.
 */

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

/** Connexion réussie : on oublie les échecs de cette clé. */
export function reinitialiser(cle) {
  ouvrirDb().prepare('DELETE FROM tentatives_connexion WHERE cle = ?').run(cle);
}

/** Ménage des entrées expirées (appelé de temps en temps, sans conséquence si oublié). */
export function purger(maintenant = Date.now()) {
  return ouvrirDb()
    .prepare('DELETE FROM tentatives_connexion WHERE depuis < ?')
    .run(new Date(maintenant - FENETRE_MS).toISOString()).changes;
}
