// Suppléance : pendant l'absence d'un référent, un autre référent reçoit son périmètre.

import { ouvrirDb } from './db.js';
import { tracer } from './audit.js';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const estDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) && !Number.isNaN(Date.parse(String(v)));

// Comptes qui peuvent suppléer : référents et administrateurs, locaux ou vus dans l'annuaire.
export function suppleantsPossibles(saufLogin = '') {
  return ouvrirDb()
    .prepare(
      `SELECT login, nom FROM (
         SELECT login, nom FROM utilisateurs WHERE actif = 1 AND role IN ('referent', 'admin')
         UNION
         SELECT c.login, c.nom FROM comptes_annuaire c WHERE c.role IN ('referent', 'admin')
           AND NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.login = c.login COLLATE NOCASE)
       ) WHERE login <> ? COLLATE NOCASE ORDER BY nom`,
    )
    .all(String(saufLogin));
}

export function creerSuppleance(acteur, { titulaire, suppleant, du, au }) {
  const t = String(titulaire ?? '').trim().toLowerCase();
  const s = String(suppleant ?? '').trim().toLowerCase();
  if (!t || !s) throw new Error('Titulaire et suppléant requis.');
  if (t === s) throw new Error('Le suppléant doit être une autre personne.');
  if (!suppleantsPossibles(t).some((p) => p.login.toLowerCase() === s)) throw new Error('Le suppléant doit être un référent ou un administrateur.');
  if (!estDate(du) || !estDate(au)) throw new Error('Dates attendues au format AAAA-MM-JJ.');
  if (au < du) throw new Error('La fin précède le début.');
  if (au < aujourdhui()) throw new Error('Cette période est déjà passée.');
  const info = ouvrirDb()
    .prepare('INSERT INTO suppleances (titulaire, suppleant, du, au, cree_par) VALUES (?, ?, ?, ?, ?)')
    .run(t, s, du, au, acteur);
  const id = Number(info.lastInsertRowid);
  tracer(acteur, 'suppleance:creer', { entite: 'suppleance', entiteId: id, details: { titulaire: t, suppleant: s, du, au } });
  return id;
}

export function supprimerSuppleance(acteur, id, { parQui = null } = {}) {
  const db = ouvrirDb();
  const s = db.prepare('SELECT * FROM suppleances WHERE id = ?').get(Number(id));
  if (!s) throw new Error('Suppléance introuvable.');
  if (parQui && s.titulaire !== parQui.toLowerCase() && s.cree_par !== parQui) throw new Error("Seul le titulaire ou l'administrateur peut l'annuler.");
  db.prepare('DELETE FROM suppleances WHERE id = ?').run(s.id);
  tracer(acteur, 'suppleance:supprimer', { entite: 'suppleance', entiteId: s.id, details: { titulaire: s.titulaire, suppleant: s.suppleant } });
}

export function suppleancesEnCours({ jour = aujourdhui() } = {}) {
  return ouvrirDb().prepare('SELECT * FROM suppleances WHERE du <= ? AND au >= ? ORDER BY au').all(jour, jour);
}

export function listerSuppleances({ login = '', jour = aujourdhui() } = {}) {
  const args = [jour];
  let filtre = '';
  if (login) {
    filtre = 'AND (titulaire = ? OR suppleant = ?)';
    args.push(login.toLowerCase(), login.toLowerCase());
  }
  return ouvrirDb().prepare(`SELECT * FROM suppleances WHERE au >= ? ${filtre} ORDER BY du, id`).all(...args);
}

// Titulaires que `login` remplace aujourd'hui.
export function titulairesSupplees(login, { jour = aujourdhui() } = {}) {
  return ouvrirDb()
    .prepare('SELECT titulaire, au FROM suppleances WHERE suppleant = ? COLLATE NOCASE AND du <= ? AND au >= ?')
    .all(String(login ?? ''), jour, jour);
}

// Périmètre du jour : le sien, plus celui des titulaires suppléés. « ALL » reste « ALL ».
export function perimetreEffectif(login, perimetrePropre) {
  if (perimetrePropre === 'ALL') return 'ALL';
  const titulaires = titulairesSupplees(login);
  if (!titulaires.length) return perimetrePropre;
  const db = ouvrirDb();
  const ids = new Set((perimetrePropre ?? []).map(Number));
  for (const { titulaire } of titulaires) {
    const siens = db.prepare('SELECT application_id FROM referent_applications WHERE login = ? COLLATE NOCASE').all(titulaire).map((r) => r.application_id);
    if (!siens.length) return 'ALL';
    for (const id of siens) ids.add(id);
  }
  return [...ids];
}

// Qui traite à la place d'un titulaire absent aujourd'hui.
export function suppleantDe(login, { jour = aujourdhui() } = {}) {
  return ouvrirDb()
    .prepare('SELECT suppleant FROM suppleances WHERE titulaire = ? COLLATE NOCASE AND du <= ? AND au >= ? ORDER BY au DESC LIMIT 1')
    .get(String(login ?? ''), jour, jour)?.suppleant ?? null;
}
