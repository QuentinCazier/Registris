// SQLite via node:sqlite (Node >= 22). Le fichier doit rester sur un disque local, jamais sur un partage réseau.

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

export function fermerDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

let profondeur = 0;

// Réentrante : un appel imbriqué rejoint la transaction en cours.
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

export function ajouterColonneSiAbsente(table, colonne, definition) {
  const base = ouvrirDb();
  const existe = base
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === colonne);
  if (!existe) base.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
}

// SQLite ne modifie pas une contrainte CHECK : la table est reconstruite pour accepter « refusée ».
function elargirStatuts(base) {
  const t = base
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'habilitations'")
    .get();
  if (!t || t.sql.includes("'refusee'")) return;

  const anciennes = base.prepare('PRAGMA table_info(habilitations)').all().map((c) => c.name);
  base.exec('PRAGMA foreign_keys = OFF');
  base.exec('PRAGMA legacy_alter_table = ON');
  try {
    transaction(() => {
      base.exec(`
        CREATE TABLE habilitations_nouvelle (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id         INTEGER NOT NULL REFERENCES agents(id),
          application_id   INTEGER NOT NULL REFERENCES applications(id),
          role             TEXT NOT NULL,
          statut           TEXT NOT NULL DEFAULT 'demandee'
                             CHECK (statut IN ('demandee','validee','executee','revoquee','refusee')),
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
          date_refus       TEXT,
          assigne_a        TEXT,
          assigne_le       TEXT,
          retrait_demande_le  TEXT,
          retrait_demande_par TEXT,
          retrait_motif       TEXT,
          relance_le       TEXT,
          relances         INTEGER NOT NULL DEFAULT 0,
          cree_le          TEXT NOT NULL DEFAULT (datetime('now')),
          maj_le           TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
      const cibles = base.prepare('PRAGMA table_info(habilitations_nouvelle)').all().map((c) => c.name);
      const communes = anciennes.filter((c) => cibles.includes(c)).join(', ');
      base.exec(`INSERT INTO habilitations_nouvelle (${communes}) SELECT ${communes} FROM habilitations`);
      base.exec('DROP TABLE habilitations');
      base.exec('ALTER TABLE habilitations_nouvelle RENAME TO habilitations');
    });
  } finally {
    base.exec('PRAGMA legacy_alter_table = OFF');
    base.exec('PRAGMA foreign_keys = ON');
  }
}

// Idempotent, appelé à chaque démarrage. Les évolutions passent par ajouterColonneSiAbsente.
export function initialiserSchema() {
  const base = ouvrirDb();
  elargirStatuts(base);
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
                         CHECK (statut IN ('demandee','validee','executee','revoquee','refusee')),
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
      date_refus       TEXT,
      -- Qui tient la demande. Une file partagée sans nom dessus n'est traitée par personne.
      assigne_a        TEXT,
      assigne_le       TEXT,
      -- Demande de fermeture : l'accès reste ouvert tant que le référent n'a pas exécuté.
      retrait_demande_le  TEXT,
      retrait_demande_par TEXT,
      retrait_motif       TEXT,
      relance_le       TEXT,
      relances         INTEGER NOT NULL DEFAULT 0,
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

    -- Sessions web, pour survivre à un redémarrage.
    CREATE TABLE IF NOT EXISTS sessions (
      sid      TEXT PRIMARY KEY,
      expire   INTEGER NOT NULL,
      donnees  TEXT NOT NULL
    );

    -- Comptes de l'annuaire vus à la connexion : identifiant canonique, nom, courriel, rôle.
    CREATE TABLE IF NOT EXISTS comptes_annuaire (
      login      TEXT PRIMARY KEY,
      nom        TEXT NOT NULL,
      email      TEXT,
      matricule  TEXT,
      role       TEXT NOT NULL,
      vu_le      TEXT NOT NULL
    );

    -- Extraction des comptes d'une application, conservée telle quelle avec son empreinte.
    CREATE TABLE IF NOT EXISTS rapprochements (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id  INTEGER NOT NULL REFERENCES applications(id),
      fichier         TEXT NOT NULL,
      empreinte       TEXT NOT NULL,
      contenu         BLOB NOT NULL,
      colonnes        TEXT,
      statut          TEXT NOT NULL DEFAULT 'a_configurer' CHECK (statut IN ('a_configurer','termine')),
      comptes         INTEGER,
      cree_le         TEXT NOT NULL DEFAULT (datetime('now')),
      cree_par        TEXT NOT NULL,
      analyse_le      TEXT
    );

    CREATE TABLE IF NOT EXISTS rapprochement_lignes (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      rapprochement_id   INTEGER NOT NULL REFERENCES rapprochements(id) ON DELETE CASCADE,
      categorie          TEXT NOT NULL CHECK (categorie IN
                           ('revoque_present','non_declare','introuvable','en_cours_present','concordant')),
      matricule          TEXT NOT NULL,
      nom                TEXT,
      profil_application TEXT,
      habilitation_id    INTEGER REFERENCES habilitations(id),
      suite              TEXT CHECK (suite IN ('regularise','revoque','execute','ferme_dans_app')),
      suite_par          TEXT,
      suite_le           TEXT
    );

    -- Contrôles complets de la chaîne ; le dernier sert de point de reprise aux pages.
    CREATE TABLE IF NOT EXISTS controles_chaine (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      verifie_le  TEXT NOT NULL DEFAULT (datetime('now')),
      verifie_par TEXT NOT NULL,
      dernier_id  INTEGER NOT NULL,
      hash_tete   TEXT NOT NULL,
      entrees     INTEGER NOT NULL,
      valide      INTEGER NOT NULL DEFAULT 1
    );

    -- Tête de chaîne déposée hors de la base, pour détecter une base remplacée.
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

    -- Revue périodique : une campagne fige les accès actifs à son ouverture.
    CREATE TABLE IF NOT EXISTS campagnes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle      TEXT NOT NULL,
      echeance     TEXT,
      perimetre_application_id INTEGER REFERENCES applications(id),
      ouverte_le   TEXT NOT NULL DEFAULT (datetime('now')),
      ouverte_par  TEXT NOT NULL,
      cloturee_le  TEXT,
      cloturee_par TEXT
    );

    -- Une ligne par habilitation de la campagne ; décision NULL tant que rien n'est statué.
    CREATE TABLE IF NOT EXISTS revues (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      campagne_id      INTEGER NOT NULL REFERENCES campagnes(id) ON DELETE CASCADE,
      habilitation_id  INTEGER NOT NULL REFERENCES habilitations(id),
      application_id   INTEGER NOT NULL REFERENCES applications(id),
      decision         TEXT CHECK (decision IN ('maintenue','retiree')),
      decide_par       TEXT,
      decide_le        TEXT,
      motif            TEXT,
      UNIQUE (campagne_id, habilitation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agents_matricule ON agents(matricule);
    CREATE INDEX IF NOT EXISTS idx_hab_agent ON habilitations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_hab_statut ON habilitations(statut);
    CREATE INDEX IF NOT EXISTS idx_hab_assigne ON habilitations(assigne_a);
    CREATE INDEX IF NOT EXISTS idx_hab_retrait ON habilitations(retrait_demande_le);
    CREATE INDEX IF NOT EXISTS idx_preuves_hab ON preuves(habilitation_id);
    CREATE INDEX IF NOT EXISTS idx_journal_entite ON journal_audit(entite, entite_id);
    CREATE INDEX IF NOT EXISTS idx_journal_action ON journal_audit(action);
    CREATE INDEX IF NOT EXISTS idx_rapp_lignes ON rapprochement_lignes(rapprochement_id, categorie);
    CREATE INDEX IF NOT EXISTS idx_rapp_application ON rapprochements(application_id);
    CREATE INDEX IF NOT EXISTS idx_revues_campagne ON revues(campagne_id, decision);
    CREATE INDEX IF NOT EXISTS idx_revues_application ON revues(campagne_id, application_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
  `);
  ajouterColonneSiAbsente('habilitations', 'relance_le', 'TEXT');
  ajouterColonneSiAbsente('habilitations', 'relances', 'INTEGER NOT NULL DEFAULT 0');
  ajouterColonneSiAbsente('applications', 'profils', 'TEXT');
  return base;
}
