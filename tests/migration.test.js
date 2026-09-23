/**
 * Reprise d'une base antérieure. SQLite ne sait pas modifier une contrainte
 * CHECK : le schéma reconstruit la table pour accepter le statut « refusée ».
 * Une installation existante doit y survivre sans perdre une ligne.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');

initialiserSchema();
A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: 1 });

// On remet la table dans son état d'avant, contrainte comprise.
function revenirAuSchemaPrecedent() {
  const db = ouvrirDb();
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA legacy_alter_table = ON');
  db.exec(`
    CREATE TABLE habilitations_v1 (
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
    INSERT INTO habilitations_v1 (id, agent_id, application_id, role, statut, demandeur, date_demande)
      SELECT id, agent_id, application_id, role, statut, demandeur, date_demande FROM habilitations;
    DROP TABLE habilitations;
    ALTER TABLE habilitations_v1 RENAME TO habilitations;
  `);
  db.exec('PRAGMA legacy_alter_table = OFF');
  db.exec('PRAGMA foreign_keys = ON');
}

test('une base au schéma précédent est reprise sans perte', () => {
  const h = H.creerHabilitation('ref', {
    agent: { matricule: 'M001', nom: 'Durand', prenom: 'Marie' },
    applicationId: gam,
    role: 'Consultation',
    demandeur: 'ref',
  });
  H.changerStatut('ref', h.id, 'executer');

  revenirAuSchemaPrecedent();
  const db = ouvrirDb();
  assert.match(
    db.prepare("SELECT sql FROM sqlite_master WHERE name = 'habilitations'").get().sql,
    /'revoquee'\)\)/,
    'la base est bien revenue à l’ancienne contrainte',
  );
  assert.throws(
    () => db.prepare("UPDATE habilitations SET statut = 'refusee' WHERE id = ?").run(h.id),
    /CHECK/i,
    'l’ancienne contrainte refuse le nouveau statut',
  );

  initialiserSchema();

  const repris = H.habilitationParId(h.id);
  assert.equal(repris.statut, 'executee', 'la ligne est conservée telle quelle');
  assert.equal(repris.role, 'Consultation');
  assert.doesNotThrow(() => H.changerStatut('ref', h.id, 'revoquer'), 'le cycle de vie fonctionne toujours');

  const nouvelle = H.creerHabilitation('ref', {
    agent: { matricule: 'M002', nom: 'Bernard', prenom: 'Luc' },
    applicationId: gam,
    role: 'Saisie',
    demandeur: 'ref',
  });
  assert.equal(H.changerStatut('ref', nouvelle.id, 'refuser', { motif: 'hors périmètre' }).statut, 'refusee');

  const colonnes = db.prepare('PRAGMA table_info(habilitations)').all().map((c) => c.name);
  for (const attendue of ['assigne_a', 'retrait_demande_le', 'retrait_motif', 'date_refus']) {
    assert.ok(colonnes.includes(attendue), `colonne ${attendue} ajoutée`);
  }
  const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'habilitations'").all();
  assert.ok(index.some((i) => i.name === 'idx_hab_statut'), 'les index sont recréés');
});
