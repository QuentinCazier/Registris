/**
 * Base de données : SQLite via le module natif `node:sqlite` (Node ≥ 22).
 *
 * Choix déterminant pour un déploiement hospitalier : aucune dépendance native à
 * compiler, un seul fichier à sauvegarder. Le fichier .db doit rester sur un disque
 * local de la machine qui exécute l'application, jamais sur un partage réseau SMB
 * (risque de corruption en accès concurrent).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { config } from './config.js';

let db;

export function ouvrirDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Ferme la connexion (tests). */
export function fermerDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

let profondeur = 0;

/**
 * Exécute `fn` dans une transaction : COMMIT si elle réussit, ROLLBACK sinon.
 * Réentrante : un appel imbriqué rejoint la transaction en cours (une erreur
 * annule alors l'ensemble).
 */
export function transaction(fn) {
  const base = ouvrirDb();
  if (profondeur > 0) {
    profondeur += 1;
    try {
      return fn();
    } finally {
      profondeur -= 1;
    }
  }
  base.exec('BEGIN');
  profondeur = 1;
  try {
    const r = fn();
    base.exec('COMMIT');
    return r;
  } catch (e) {
    base.exec('ROLLBACK');
    throw e;
  } finally {
    profondeur = 0;
  }
}

/** Migration additive idempotente : ajoute une colonne si elle manque. */
export function ajouterColonneSiAbsente(table, colonne, definition) {
  const base = ouvrirDb();
  const existe = base
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === colonne);
  if (!existe) base.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
}

/**
 * Schéma complet. Idempotent : sûr à appeler à chaque démarrage. Les évolutions
 * futures passent par `ajouterColonneSiAbsente` pour préserver les données.
 */
export function initialiserSchema() {
  const base = ouvrirDb();
  base.exec(`
    -- Agents de l'établissement (bénéficiaires d'habilitations). Données RH internes.
    CREATE TABLE IF NOT EXISTS agents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      matricule  TEXT NOT NULL UNIQUE,
      nom        TEXT NOT NULL,
      prenom     TEXT NOT NULL DEFAULT '',
      email      TEXT,
      actif      INTEGER NOT NULL DEFAULT 1
    );

    -- Unités fonctionnelles.
    CREATE TABLE IF NOT EXISTS ufs (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      code     TEXT NOT NULL UNIQUE,
      libelle  TEXT NOT NULL
    );

    -- Sites géographiques.
    CREATE TABLE IF NOT EXISTS sites (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      nom    TEXT NOT NULL UNIQUE,
      actif  INTEGER NOT NULL DEFAULT 1
    );

    -- Comptes applicatifs (mode AUTH_MODE=local). En mode LDAP, l'annuaire fait foi.
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      login      TEXT NOT NULL UNIQUE,
      nom        TEXT NOT NULL,
      role       TEXT NOT NULL,
      sel        TEXT NOT NULL,
      hash_mdp   TEXT NOT NULL,
      matricule  TEXT,
      email      TEXT,
      actif      INTEGER NOT NULL DEFAULT 1
    );

    -- Catégories du catalogue d'applications (onglets de l'écran « nouvelle demande »).
    CREATE TABLE IF NOT EXISTS categories (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle  TEXT NOT NULL UNIQUE,
      ordre    INTEGER NOT NULL DEFAULT 0,
      actif    INTEGER NOT NULL DEFAULT 1
    );

    -- Applications / logiciels sur lesquels on ouvre des droits.
    CREATE TABLE IF NOT EXISTS applications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT NOT NULL UNIQUE,
      libelle       TEXT NOT NULL,
      categorie_id  INTEGER REFERENCES categories(id),
      logo          TEXT,
      actif         INTEGER NOT NULL DEFAULT 1
    );

    -- Une habilitation = un agent, une application, un profil, avec son cycle de vie
    -- (demandée -> validée -> exécutée -> révoquée) et ses dates.
    CREATE TABLE IF NOT EXISTS habilitations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id         INTEGER NOT NULL REFERENCES agents(id),
      application_id   INTEGER NOT NULL REFERENCES applications(id),
      role             TEXT NOT NULL,
      statut           TEXT NOT NULL DEFAULT 'demandee'
                         CHECK (statut IN ('demandee','validee','executee','revoquee')),
      demandeur        TEXT,
      cree_par         TEXT,
      pour_autrui      INTEGER NOT NULL DEFAULT 0,
      site_id          INTEGER REFERENCES sites(id),
      uf_libre         TEXT,
      commentaire      TEXT,
      date_demande     TEXT,
      date_validation  TEXT,
      date_realisation TEXT,
      date_revocation  TEXT,
      cree_le          TEXT NOT NULL DEFAULT (datetime('now')),
      maj_le           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Une habilitation peut couvrir plusieurs UF du référentiel.
    CREATE TABLE IF NOT EXISTS habilitation_ufs (
      habilitation_id  INTEGER NOT NULL REFERENCES habilitations(id) ON DELETE CASCADE,
      uf_id            INTEGER NOT NULL REFERENCES ufs(id),
      PRIMARY KEY (habilitation_id, uf_id)
    );

    -- Coffre à preuves : fichier sur disque + empreinte SHA-256 calculée au dépôt.
    CREATE TABLE IF NOT EXISTS preuves (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      habilitation_id  INTEGER NOT NULL REFERENCES habilitations(id) ON DELETE CASCADE,
      type             TEXT NOT NULL CHECK (type IN ('mail','capture','pdf','autre')),
      nom_origine      TEXT NOT NULL,
      fichier          TEXT NOT NULL,
      sha256           TEXT NOT NULL,
      taille           INTEGER NOT NULL,
      ajoutee_par      TEXT,
      cree_le          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Périmètre d'un référent : les applications qu'il valide / exécute.
    CREATE TABLE IF NOT EXISTS referent_applications (
      login           TEXT NOT NULL,
      application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      PRIMARY KEY (login, application_id)
    );

    -- Packs « nouvel arrivant » : bouquets d'habilitations ouverts en une fois.
    CREATE TABLE IF NOT EXISTS packs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nom           TEXT NOT NULL UNIQUE,
      description   TEXT,
      destinataire  TEXT,
      actif         INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS pack_elements (
      pack_id         INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
      application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      role            TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (pack_id, application_id)
    );

    -- Paramètres clé/valeur (routage des notifications par catégorie…).
    CREATE TABLE IF NOT EXISTS parametres (
      cle    TEXT PRIMARY KEY,
      valeur TEXT
    );

    -- Journal d'audit chaîné : chaque entrée porte le hash de la précédente. Toute
    -- altération a posteriori casse la chaîne, détectable par verifierChaine().
    CREATE TABLE IF NOT EXISTS journal_audit (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      horodatage     TEXT NOT NULL,
      acteur         TEXT NOT NULL,
      action         TEXT NOT NULL,
      entite         TEXT,
      entite_id      INTEGER,
      details        TEXT,
      hash_precedent TEXT,
      hash           TEXT NOT NULL
    );

    -- Échecs de connexion par IP et identifiant (anti-force-brute persistant).
    CREATE TABLE IF NOT EXISTS tentatives_connexion (
      cle     TEXT PRIMARY KEY,
      n       INTEGER NOT NULL,
      depuis  TEXT NOT NULL
    );

    -- Ancrages de la chaîne d'audit : photographie datée de la tête de chaîne,
    -- doublée d'un fichier (et d'un courriel si configuré) conservés hors de la
    -- base. Une base remplacée en bloc ne passe plus inaperçue.
    CREATE TABLE IF NOT EXISTS ancrages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      horodatage  TEXT NOT NULL,
      dernier_id  INTEGER NOT NULL,
      hash_tete   TEXT NOT NULL,
      entrees     INTEGER NOT NULL,
      empreinte   TEXT NOT NULL,
      fichier     TEXT,
      acteur      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agents_matricule ON agents(matricule);
    CREATE INDEX IF NOT EXISTS idx_hab_agent ON habilitations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_hab_statut ON habilitations(statut);
    CREATE INDEX IF NOT EXISTS idx_preuves_hab ON preuves(habilitation_id);
    CREATE INDEX IF NOT EXISTS idx_journal_entite ON journal_audit(entite, entite_id);
  `);
  return base;
}
