// Cœur métier : agents, applications, habilitations, cycle de vie. Tout est tracé au journal.

import { ouvrirDb, transaction } from './db.js';
import { tracer } from './audit.js';

export const STATUTS = ['demandee', 'validee', 'executee', 'revoquee', 'refusee'];
export const LIB_STATUT = {
  demandee: 'Demandée',
  validee: 'Validée',
  executee: 'Exécutée',
  revoquee: 'Révoquée',
  refusee: 'Refusée',
};

const aujourdhui = () => new Date().toISOString().slice(0, 10);

// --- Catalogue ---------------------------------------------------------------

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

// Complète nom, prénom et courriel s'ils manquaient.
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

// Terme cherché dans le matricule, le nom et le prénom.
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
        WHERE h.agent_id = ? ORDER BY h.cree_le DESC, h.id DESC`,
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

// Référentiel d'abord, saisie libre ensuite.
export function libelleUfs(h) {
  const codes = (h.ufs ?? []).map((u) => u.code);
  if (h.uf_libre) codes.push(h.uf_libre);
  return codes.join(', ');
}

// Liste blanche : la valeur reçue de l'URL n'entre jamais telle quelle en SQL.
export const TRIS = {
  id: 'h.id',
  agent: 'ag.nom',
  application: 'a.libelle',
  role: 'h.role',
  demande: 'h.date_demande',
  realisation: 'h.date_realisation',
  statut: 'h.statut',
  preuves: 'nb_preuves',
};

// La file : ouvertures en cours et accès ouverts dont la fermeture est demandée.
export const CONDITION_FILE = `(h.statut IN ('demandee','validee')
  OR (h.statut = 'executee' AND h.retrait_demande_le IS NOT NULL))`;

function filtres({
  statut = '', statuts = [], applicationId = 0, applicationIds = null, q = '', sansPreuve = false,
  file = false, assigneA = '', nonAssignees = false, retraitDemande = false,
}) {
  const cond = [];
  const args = [];
  if (file) cond.push(CONDITION_FILE);
  if (Array.isArray(applicationIds)) {
    if (!applicationIds.length) cond.push('0');
    else {
      cond.push(`h.application_id IN (${applicationIds.map(() => '?').join(',')})`);
      args.push(...applicationIds.map(Number));
    }
  }
  if (retraitDemande) cond.push('h.retrait_demande_le IS NOT NULL');
  if (assigneA) {
    cond.push('h.assigne_a = ?');
    args.push(assigneA);
  }
  if (nonAssignees) cond.push('h.assigne_a IS NULL');
  if (statut && STATUTS.includes(statut)) {
    cond.push('h.statut = ?');
    args.push(statut);
  }
  const plusieurs = statuts.filter((s) => STATUTS.includes(s));
  if (plusieurs.length) {
    cond.push(`h.statut IN (${plusieurs.map(() => '?').join(',')})`);
    args.push(...plusieurs);
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
  if (sansPreuve) {
    cond.push(`h.statut IN ('validee','executee')
      AND NOT EXISTS (SELECT 1 FROM preuves p WHERE p.habilitation_id = h.id)`);
  }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', args };
}

// Filtre, tri et pagination en base : un registre d'établissement est volumineux.
export function listerHabilitations({
  statut = '', statuts = [], applicationId = 0, applicationIds = null, q = '', sansPreuve = false,
  file = false, assigneA = '', nonAssignees = false, retraitDemande = false,
  tri = '', sens = 'desc', limite = 500, offset = 0,
} = {}) {
  const { where, args } = filtres({
    statut, statuts, applicationId, applicationIds, q, sansPreuve, file, assigneA, nonAssignees, retraitDemande,
  });
  const colonne = TRIS[tri] ?? 'h.cree_le';
  const ordre = String(sens).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return ouvrirDb()
    .prepare(
      `SELECT h.*, a.code AS app_code, a.libelle AS app_libelle,
              ag.matricule, ag.nom, ag.prenom,
              (SELECT COUNT(*) FROM preuves p WHERE p.habilitation_id = h.id) AS nb_preuves
         FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         JOIN agents ag ON ag.id = h.agent_id
        ${where}
        ORDER BY ${colonne} ${ordre}, h.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limite, offset);
}

// Mêmes lignes, enrichies des UF et du site : l'export doit valoir la fiche.
export function exporterHabilitations(criteres = {}) {
  const db = ouvrirDb();
  const lignes = listerHabilitations({ ...criteres, limite: 100000 });
  const ufs = db
    .prepare(
      `SELECT hu.habilitation_id, group_concat(u.code, ' ') codes
         FROM habilitation_ufs hu JOIN ufs u ON u.id = hu.uf_id GROUP BY hu.habilitation_id`,
    )
    .all();
  const parId = new Map(ufs.map((r) => [r.habilitation_id, r.codes]));
  const sites = new Map(db.prepare('SELECT id, nom FROM sites').all().map((s) => [s.id, s.nom]));
  return lignes.map((h) => ({
    ...h,
    ufs_codes: [parId.get(h.id), h.uf_libre].filter(Boolean).join(' '),
    site_nom: sites.get(h.site_id) ?? '',
  }));
}

export function compterHabilitations(criteres = {}) {
  const { where, args } = filtres(criteres);
  return ouvrirDb()
    .prepare(
      `SELECT COUNT(*) n FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         JOIN agents ag ON ag.id = h.agent_id
        ${where}`,
    )
    .get(...args).n;
}

export function listerDemandesDe(login) {
  return ouvrirDb()
    .prepare(
      `SELECT h.*, a.libelle AS app_libelle, ag.matricule, ag.nom, ag.prenom
         FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         JOIN agents ag ON ag.id = h.agent_id
        WHERE h.cree_par = ? ORDER BY h.cree_le DESC, h.id DESC`,
    )
    .all(login);
}

// --- Création et cycle de vie ---------------------------------------------------

// `donnees` : agent { matricule, nom, prenom, email }, applicationId, role,
// ufIds[], ufLibre, siteId, demandeur, pourAutrui, commentaire, dateDemande.
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

// Une demande par élément du pack, pour un même agent.
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

// Une demande pour plusieurs applications : N habilitations, un référent chacune. lignes = [{ applicationId, role }].
export function creerDemandeMultiple(acteur, { lignes = [], ...commun } = {}) {
  const retenues = lignes
    .map((l) => ({ applicationId: Number(l.applicationId), role: String(l.role ?? '').trim() }))
    .filter((l) => l.applicationId);
  if (!retenues.length) throw new Error('Sélectionnez au moins une application.');
  const sansProfil = retenues.find((l) => !l.role);
  if (sansProfil) {
    const app = applicationParId(sansProfil.applicationId);
    throw new Error(`Indiquez le profil demandé pour ${app?.libelle ?? 'chaque application'}.`);
  }
  return transaction(() => retenues.map((l) => creerHabilitation(acteur, { ...commun, ...l })));
}

// Départ d'un agent : une demande de fermeture sur chacun de ses accès ouverts.
export function signalerDepart(acteur, { matricule, motif = '', demandeur = '', applicationIds = null } = {}) {
  const agent = agentParMatricule(matricule);
  if (!agent) throw new Error('Aucun agent de ce matricule au registre.');
  const m = String(motif ?? '').trim().slice(0, 300);
  if (!m) throw new Error('Indiquez le motif : départ, mutation, fin de contrat.');

  const db = ouvrirDb();
  const limite = Array.isArray(applicationIds) && applicationIds.length
    ? `AND application_id IN (${applicationIds.map(() => '?').join(',')})`
    : '';
  const ouverts = db
    .prepare(
      `SELECT id FROM habilitations
        WHERE agent_id = ? AND statut = 'executee' AND retrait_demande_le IS NULL ${limite}
        ORDER BY id`,
    )
    .all(agent.id, ...(limite ? applicationIds.map(Number) : []));

  const dejaDemandes = db
    .prepare("SELECT COUNT(*) n FROM habilitations WHERE agent_id = ? AND statut = 'executee' AND retrait_demande_le IS NOT NULL")
    .get(agent.id).n;

  const traites = transaction(() => ouverts.map((h) => demanderRetrait(acteur, h.id, { motif: m, demandeur })));
  tracer(acteur, 'depart:signaler', {
    entite: 'agent',
    entiteId: agent.id,
    details: { matricule: agent.matricule, motif: m, acces: traites.length, dejaDemandes },
  });
  return { agent, fermeturesDemandees: traites.length, dejaDemandes, habilitations: traites };
}

const TRANSITIONS = {
  valider: { de: ['demandee'], vers: 'validee', champDate: 'date_validation' },
  executer: { de: ['demandee', 'validee'], vers: 'executee', champDate: 'date_realisation' },
  revoquer: { de: ['demandee', 'validee', 'executee'], vers: 'revoquee', champDate: 'date_revocation' },
  // Un refus doit rester distinct d'une révocation : l'accès n'a jamais existé.
  refuser: { de: ['demandee', 'validee'], vers: 'refusee', champDate: 'date_refus', motifRequis: true },
};

export const ACTIONS_STATUT = Object.freeze(Object.keys(TRANSITIONS));

// Conditionné au statut de départ : deux référents simultanés ne s'écrasent pas.
export function changerStatut(acteur, id, action, { motif = '' } = {}) {
  if (!Object.hasOwn(TRANSITIONS, action)) throw new Error(`Action inconnue : ${action}`);
  const t = TRANSITIONS[action];
  const db = ouvrirDb();
  const h = db.prepare('SELECT * FROM habilitations WHERE id = ?').get(Number(id));
  if (!h) throw new Error('Habilitation introuvable.');
  if (!t.de.includes(h.statut)) {
    throw new Error(`Impossible de « ${action} » une habilitation au statut « ${LIB_STATUT[h.statut]} ».`);
  }
  const m = String(motif ?? '').trim();
  if (t.motifRequis && !m) throw new Error('Un refus doit être motivé : le demandeur doit pouvoir le lire.');

  const marqueurs = t.de.map(() => '?').join(', ');
  const r = db
    .prepare(
      `UPDATE habilitations SET statut = ?, ${t.champDate} = ?, maj_le = datetime('now')
        WHERE id = ? AND statut IN (${marqueurs})`,
    )
    .run(t.vers, aujourdhui(), Number(id), ...t.de);
  if (r.changes === 0) throw new Error('Le statut a été modifié entre-temps par un autre utilisateur.');

  // La fermeture exécutée solde la demande qui l'a déclenchée.
  const suiteDe = action === 'revoquer' && h.retrait_demande_le
    ? { suiteA: 'demande de fermeture', demandeePar: h.retrait_demande_par, motifDemande: h.retrait_motif }
    : {};
  if (action === 'revoquer' || action === 'refuser') {
    db.prepare(
      `UPDATE habilitations SET retrait_demande_le = NULL, retrait_demande_par = NULL, retrait_motif = NULL,
              assigne_a = NULL, assigne_le = NULL WHERE id = ?`,
    ).run(Number(id));
  }
  tracer(acteur, `habilitation:${action}`, {
    entite: 'habilitation',
    entiteId: Number(id),
    details: { de: h.statut, vers: t.vers, ...(m ? { motif: m } : {}), ...suiteDe },
  });
  return habilitationParId(id);
}

// Une file partagée sans nom dessus n'est traitée par personne.
export function assigner(acteur, id, login) {
  const db = ouvrirDb();
  const h = db.prepare('SELECT * FROM habilitations WHERE id = ?').get(Number(id));
  if (!h) throw new Error('Habilitation introuvable.');
  if (!['demandee', 'validee'].includes(h.statut) && !h.retrait_demande_le) {
    throw new Error("Cette habilitation n'est pas dans la file de traitement.");
  }
  const qui = String(login ?? '').trim() || null;
  db.prepare(
    `UPDATE habilitations SET assigne_a = ?, assigne_le = ${qui ? "datetime('now')" : 'NULL'},
            maj_le = datetime('now') WHERE id = ?`,
  ).run(qui, Number(id));
  tracer(acteur, qui ? 'habilitation:assigner' : 'habilitation:desassigner', {
    entite: 'habilitation',
    entiteId: Number(id),
    details: qui ? { a: qui } : {},
  });
  return habilitationParId(id);
}

// L'accès reste ouvert : seul le référent le ferme, la demande n'est qu'un signalement.
export function demanderRetrait(acteur, id, { motif = '', demandeur = '' } = {}) {
  const db = ouvrirDb();
  const h = db.prepare('SELECT * FROM habilitations WHERE id = ?').get(Number(id));
  if (!h) throw new Error('Habilitation introuvable.');
  if (h.statut !== 'executee') throw new Error('Seul un accès ouvert peut faire l’objet d’une demande de fermeture.');
  if (h.retrait_demande_le) throw new Error('Une fermeture est déjà demandée pour cet accès.');
  const m = String(motif ?? '').trim().slice(0, 300);
  if (!m) throw new Error('Indiquez le motif de la fermeture : départ, mutation, fin de mission.');

  const r = db
    .prepare(
      `UPDATE habilitations SET retrait_demande_le = datetime('now'), retrait_demande_par = ?,
              retrait_motif = ?, maj_le = datetime('now')
        WHERE id = ? AND statut = 'executee' AND retrait_demande_le IS NULL`,
    )
    .run(String(demandeur || acteur).slice(0, 120), m, Number(id));
  if (r.changes === 0) throw new Error('La demande a été enregistrée entre-temps par un autre utilisateur.');
  tracer(acteur, 'retrait:demander', { entite: 'habilitation', entiteId: Number(id), details: { motif: m } });
  return habilitationParId(id);
}

export function refuserRetrait(acteur, id, { motif = '' } = {}) {
  const db = ouvrirDb();
  const h = db.prepare('SELECT * FROM habilitations WHERE id = ?').get(Number(id));
  if (!h) throw new Error('Habilitation introuvable.');
  if (!h.retrait_demande_le) throw new Error('Aucune fermeture n’est demandée pour cet accès.');
  const m = String(motif ?? '').trim().slice(0, 300);
  if (!m) throw new Error('Un refus de fermeture doit être motivé.');
  db.prepare(
    `UPDATE habilitations SET retrait_demande_le = NULL, retrait_demande_par = NULL, retrait_motif = NULL,
            assigne_a = NULL, assigne_le = NULL, maj_le = datetime('now') WHERE id = ?`,
  ).run(Number(id));
  tracer(acteur, 'retrait:refuser', {
    entite: 'habilitation',
    entiteId: Number(id),
    details: { motif: m, demandeePar: h.retrait_demande_par, motifDemande: h.retrait_motif },
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
