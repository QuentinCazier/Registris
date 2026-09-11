/**
 * Cœur métier : agents, applications, habilitations, recherche et cycle de vie.
 * Toute modification du registre est tracée dans le journal d'audit chaîné.
 */

import { ouvrirDb, transaction } from './db.js';
import { tracer } from './audit.js';

export const STATUTS = ['demandee', 'validee', 'executee', 'revoquee'];
export const LIB_STATUT = {
  demandee: 'Demandée',
  validee: 'Validée',
  executee: 'Exécutée',
  revoquee: 'Révoquée',
};

const aujourdhui = () => new Date().toISOString().slice(0, 10);

// --- Catalogue ---------------------------------------------------------------

/** Applications avec leur catégorie. `actives` : seulement les actives. */
export function listerApplications({ actives = false } = {}) {
  return ouvrirDb()
    .prepare(
      `SELECT a.*, c.libelle AS cat_libelle, c.ordre AS cat_ordre
         FROM applications a LEFT JOIN categories c ON c.id = a.categorie_id
        ${actives ? 'WHERE a.actif = 1' : ''}
        ORDER BY c.ordre, c.libelle, a.libelle`,
    )
    .all();
}

export function applicationParId(id) {
  return ouvrirDb()
    .prepare(
      `SELECT a.*, c.libelle AS cat_libelle
         FROM applications a LEFT JOIN categories c ON c.id = a.categorie_id
        WHERE a.id = ?`,
    )
    .get(Number(id));
}

export function listerUfs() {
  return ouvrirDb().prepare('SELECT * FROM ufs ORDER BY code').all();
}

export function listerSites({ tous = false } = {}) {
  return ouvrirDb()
    .prepare(`SELECT * FROM sites ${tous ? '' : 'WHERE actif = 1'} ORDER BY nom`)
    .all();
}

// --- Agents ------------------------------------------------------------------

export function agentParMatricule(matricule) {
  return ouvrirDb().prepare('SELECT * FROM agents WHERE matricule = ?').get(String(matricule ?? '').trim());
}

/** Retrouve un agent par matricule ou le crée. Complète nom/prénom/email s'ils manquaient. */
export function trouverOuCreerAgent({ matricule, nom, prenom, email }) {
  const m = String(matricule ?? '').trim();
  if (!m) throw new Error('Le matricule du bénéficiaire est requis.');
  const db = ouvrirDb();
  const existant = db.prepare('SELECT * FROM agents WHERE matricule = ?').get(m);
  if (existant) {
    if ((!existant.prenom && prenom) || (!existant.email && email)) {
      db.prepare('UPDATE agents SET prenom = COALESCE(NULLIF(prenom, \'\'), ?), email = COALESCE(email, ?) WHERE id = ?').run(
        String(prenom ?? '').trim(),
        email ? String(email).trim() : null,
        existant.id,
      );
      return db.prepare('SELECT * FROM agents WHERE id = ?').get(existant.id);
    }
    return existant;
  }
  const n = String(nom ?? '').trim();
  if (!n) throw new Error('Le nom du bénéficiaire est requis pour un agent inconnu du registre.');
  const info = db
    .prepare('INSERT INTO agents (matricule, nom, prenom, email) VALUES (?, ?, ?, ?)')
    .run(m, n, String(prenom ?? '').trim(), email ? String(email).trim() : null);
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(info.lastInsertRowid));
}

// --- Recherche -----------------------------------------------------------------

/**
 * Agents correspondant à un terme (matricule, nom ou prénom), chacun avec ses
 * habilitations enrichies : la vue « qui a quoi, où, depuis quand, prouvé par quoi ».
 */
export function rechercherAgents(terme, { limite = 50 } = {}) {
  const q = `%${String(terme ?? '').trim()}%`;
  const agents = ouvrirDb()
    .prepare(
      `SELECT * FROM agents WHERE matricule LIKE ? OR nom LIKE ? OR prenom LIKE ?
        ORDER BY nom, prenom LIMIT ?`,
    )
    .all(q, q, q, limite);
  return agents.map((agent) => ({ ...agent, habilitations: habilitationsDeAgent(agent.id) }));
}

export function habilitationsDeAgent(agentId) {
  const db = ouvrirDb();
  const habs = db
    .prepare(
      `SELECT h.*, a.code AS app_code, a.libelle AS app_libelle,
              (SELECT COUNT(*) FROM preuves p WHERE p.habilitation_id = h.id) AS nb_preuves
         FROM habilitations h JOIN applications a ON a.id = h.application_id
        WHERE h.agent_id = ? ORDER BY h.cree_le DESC`,
    )
    .all(Number(agentId));
  const ufStmt = db.prepare(
    `SELECT u.code, u.libelle FROM habilitation_ufs hu JOIN ufs u ON u.id = hu.uf_id
      WHERE hu.habilitation_id = ? ORDER BY u.code`,
  );
  return habs.map((h) => ({ ...h, ufs: ufStmt.all(h.id) }));
}

export function habilitationParId(id) {
  const db = ouvrirDb();
  const h = db
    .prepare(
      `SELECT h.*, a.code AS app_code, a.libelle AS app_libelle, a.categorie_id AS app_cat_id,
              c.libelle AS app_cat_libelle,
              ag.matricule, ag.nom, ag.prenom, ag.email, s.nom AS site_nom
         FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         LEFT JOIN categories c ON c.id = a.categorie_id
         JOIN agents ag ON ag.id = h.agent_id
         LEFT JOIN sites s ON s.id = h.site_id
        WHERE h.id = ?`,
    )
    .get(Number(id));
  if (!h) return null;
  h.ufs = db
    .prepare(
      `SELECT u.id, u.code, u.libelle FROM habilitation_ufs hu JOIN ufs u ON u.id = hu.uf_id
        WHERE hu.habilitation_id = ? ORDER BY u.code`,
    )
    .all(h.id);
  h.preuves = db.prepare('SELECT * FROM preuves WHERE habilitation_id = ? ORDER BY cree_le').all(h.id);
  return h;
}

/** Libellé lisible des UF d'une habilitation (référentiel puis saisie libre). */
export function libelleUfs(h) {
  const codes = (h.ufs ?? []).map((u) => u.code);
  if (h.uf_libre) codes.push(h.uf_libre);
  return codes.join(', ');
}

/**
 * Toutes les habilitations pour le suivi, filtrables par statut, application et
 * texte libre (agent, profil). Triées des plus récentes aux plus anciennes.
 */
export function listerHabilitations({ statut = '', applicationId = 0, q = '', limite = 500 } = {}) {
  const cond = [];
  const args = [];
  if (statut && STATUTS.includes(statut)) {
    cond.push('h.statut = ?');
    args.push(statut);
  }
  if (Number(applicationId)) {
    cond.push('h.application_id = ?');
    args.push(Number(applicationId));
  }
  const terme = String(q ?? '').trim();
  if (terme) {
    const like = `%${terme}%`;
    cond.push('(ag.matricule LIKE ? OR ag.nom LIKE ? OR ag.prenom LIKE ? OR h.role LIKE ? OR a.libelle LIKE ?)');
    args.push(like, like, like, like, like);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return ouvrirDb()
    .prepare(
      `SELECT h.*, a.code AS app_code, a.libelle AS app_libelle,
              ag.matricule, ag.nom, ag.prenom,
              (SELECT COUNT(*) FROM preuves p WHERE p.habilitation_id = h.id) AS nb_preuves
         FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         JOIN agents ag ON ag.id = h.agent_id
        ${where}
        ORDER BY h.cree_le DESC, h.id DESC LIMIT ?`,
    )
    .all(...args, limite);
}

/** Demandes déposées par un utilisateur (son historique personnel). */
export function listerDemandesDe(login) {
  return ouvrirDb()
    .prepare(
      `SELECT h.*, a.libelle AS app_libelle, ag.matricule, ag.nom, ag.prenom
         FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         JOIN agents ag ON ag.id = h.agent_id
        WHERE h.cree_par = ? ORDER BY h.cree_le DESC`,
    )
    .all(login);
}

// --- Création et cycle de vie ---------------------------------------------------

/**
 * Crée une demande d'habilitation (statut « demandée »). `donnees` :
 *   agent { matricule, nom, prenom, email }, applicationId, role, ufIds[], ufLibre,
 *   siteId, demandeur, pourAutrui, commentaire, dateDemande.
 */
export function creerHabilitation(acteur, donnees) {
  const db = ouvrirDb();
  const application = applicationParId(donnees.applicationId);
  if (!application) throw new Error('Application inconnue.');
  if (application.actif === 0) throw new Error('Cette application est désactivée au catalogue.');
  const role = String(donnees.role ?? '').trim();
  if (!role) throw new Error('Le profil / droit demandé est requis.');

  const id = transaction(() => {
    const agent = trouverOuCreerAgent(donnees.agent);
    const info = db
      .prepare(
        `INSERT INTO habilitations
           (agent_id, application_id, role, statut, demandeur, cree_par, pour_autrui,
            site_id, uf_libre, commentaire, date_demande)
         VALUES (?, ?, ?, 'demandee', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.id,
        application.id,
        role,
        String(donnees.demandeur ?? acteur).trim(),
        acteur,
        donnees.pourAutrui ? 1 : 0,
        donnees.siteId ? Number(donnees.siteId) : null,
        donnees.ufLibre ? String(donnees.ufLibre).trim() : null,
        donnees.commentaire ? String(donnees.commentaire).trim() : null,
        donnees.dateDemande ?? aujourdhui(),
      );
    const nouvelId = Number(info.lastInsertRowid);
    const lien = db.prepare('INSERT OR IGNORE INTO habilitation_ufs (habilitation_id, uf_id) VALUES (?, ?)');
    for (const ufId of donnees.ufIds ?? []) if (Number(ufId)) lien.run(nouvelId, Number(ufId));
    return nouvelId;
  });

  tracer(acteur, 'habilitation:creer', {
    entite: 'habilitation',
    entiteId: id,
    details: {
      matricule: String(donnees.agent?.matricule ?? '').trim(),
      application: application.code,
      role,
      demandeur: donnees.demandeur ?? acteur,
    },
  });
  return habilitationParId(id);
}

/** Applique un pack « nouvel arrivant » : une demande par élément, pour un même agent. */
export function appliquerPack(acteur, pack, donnees) {
  if (!pack?.elements?.length) throw new Error('Ce pack ne contient aucun accès.');
  const creees = transaction(() =>
    pack.elements.map((el) =>
      creerHabilitation(acteur, {
        agent: donnees.agent,
        applicationId: el.application_id,
        role: el.role || pack.nom,
        siteId: donnees.siteId,
        ufLibre: donnees.ufLibre,
        ufIds: donnees.ufIds,
        demandeur: donnees.demandeur,
        pourAutrui: true,
        commentaire: `Ouverture via le pack « ${pack.nom} »`,
      }),
    ),
  );
  tracer(acteur, 'pack:appliquer', {
    entite: 'pack',
    entiteId: pack.id,
    details: { pack: pack.nom, matricule: donnees.agent.matricule, nb: creees.length },
  });
  return creees;
}

const TRANSITIONS = {
  valider: { de: ['demandee'], vers: 'validee', champDate: 'date_validation' },
  executer: { de: ['demandee', 'validee'], vers: 'executee', champDate: 'date_realisation' },
  revoquer: { de: ['demandee', 'validee', 'executee'], vers: 'revoquee', champDate: 'date_revocation' },
};

export const ACTIONS_STATUT = Object.freeze(Object.keys(TRANSITIONS));

/**
 * Change le statut d'une habilitation selon la machine à états. La mise à jour est
 * conditionnée au statut de départ (`WHERE statut IN …`) : deux référents qui
 * agissent en même temps ne peuvent pas s'écraser mutuellement.
 */
export function changerStatut(acteur, id, action, { motif = '' } = {}) {
  if (!Object.hasOwn(TRANSITIONS, action)) throw new Error(`Action inconnue : ${action}`);
  const t = TRANSITIONS[action];
  const db = ouvrirDb();
  const h = db.prepare('SELECT * FROM habilitations WHERE id = ?').get(Number(id));
  if (!h) throw new Error('Habilitation introuvable.');
  if (!t.de.includes(h.statut)) {
    throw new Error(`Impossible de « ${action} » une habilitation au statut « ${LIB_STATUT[h.statut]} ».`);
  }
  const marqueurs = t.de.map(() => '?').join(', ');
  const r = db
    .prepare(
      `UPDATE habilitations SET statut = ?, ${t.champDate} = ?, maj_le = datetime('now')
        WHERE id = ? AND statut IN (${marqueurs})`,
    )
    .run(t.vers, aujourdhui(), Number(id), ...t.de);
  if (r.changes === 0) throw new Error('Le statut a été modifié entre-temps par un autre utilisateur.');
  const m = String(motif ?? '').trim();
  tracer(acteur, `habilitation:${action}`, {
    entite: 'habilitation',
    entiteId: Number(id),
    details: { de: h.statut, vers: t.vers, ...(m ? { motif: m } : {}) },
  });
  return habilitationParId(id);
}

export function statistiques() {
  const db = ouvrirDb();
  return {
    agents: db.prepare('SELECT COUNT(*) n FROM agents').get().n,
    habilitations: db.prepare('SELECT COUNT(*) n FROM habilitations').get().n,
    preuves: db.prepare('SELECT COUNT(*) n FROM preuves').get().n,
    sansPreuve: db
      .prepare(
        `SELECT COUNT(*) n FROM habilitations h
          WHERE h.statut IN ('validee','executee')
            AND NOT EXISTS (SELECT 1 FROM preuves p WHERE p.habilitation_id = h.id)`,
      )
      .get().n,
    parStatut: Object.fromEntries(
      db.prepare('SELECT statut, COUNT(*) n FROM habilitations GROUP BY statut').all().map((r) => [r.statut, r.n]),
    ),
    parApplication: db
      .prepare(
        `SELECT a.libelle, COUNT(*) n FROM habilitations h
           JOIN applications a ON a.id = h.application_id
          WHERE h.statut <> 'revoquee' GROUP BY a.id ORDER BY n DESC, a.libelle`,
      )
      .all(),
  };
}
