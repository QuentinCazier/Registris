// Revue périodique : une campagne fige les accès actifs, chaque référent statue sur ses applications.

import { ouvrirDb, transaction } from './db.js';
import { tracer } from './audit.js';
import { changerStatut } from './habilitations.js';

export const DECISIONS = ['maintenue', 'retiree'];

/**
 * @param {string} acteur
 * @param {{ libelle?: string, echeance?: string | null, applicationId?: number }} [campagne]
 */
export function ouvrirCampagne(acteur, { libelle, echeance = null, applicationId = 0 } = {}) {
  const nom = String(libelle ?? '').trim();
  if (!nom) throw new Error('Le libellé de la campagne est obligatoire.');
  if (echeance && !/^\d{4}-\d{2}-\d{2}$/.test(echeance)) throw new Error('Échéance attendue au format AAAA-MM-JJ.');
  const db = ouvrirDb();
  const app = Number(applicationId) || null;
  if (enCours({ applicationId: app })) {
    throw new Error('Une campagne est déjà ouverte sur ce périmètre. Clôturez-la avant d’en ouvrir une autre.');
  }

  return transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO campagnes (libelle, echeance, perimetre_application_id, ouverte_par) VALUES (?, ?, ?, ?)')
      .run(nom, echeance, app, acteur);
    const cibles = db
      .prepare(
        `SELECT id, application_id FROM habilitations
          WHERE statut = 'executee' ${app ? 'AND application_id = ?' : ''}`,
      )
      .all(...(app ? [app] : []));
    const inserer = db.prepare('INSERT INTO revues (campagne_id, habilitation_id, application_id) VALUES (?, ?, ?)');
    for (const h of cibles) inserer.run(id, h.id, h.application_id);
    tracer(acteur, 'revue:ouvrir', {
      entite: 'campagne',
      entiteId: Number(id),
      details: { libelle: nom, acces: cibles.length, echeance, applicationId: app },
    });
    return { ...campagneParId(id), accesEntres: cibles.length };
  });
}

export function enCours({ applicationId = null } = {}) {
  const db = ouvrirDb();
  return applicationId
    ? db.prepare('SELECT * FROM campagnes WHERE cloturee_le IS NULL AND (perimetre_application_id IS NULL OR perimetre_application_id = ?)').get(applicationId)
    : db.prepare('SELECT * FROM campagnes WHERE cloturee_le IS NULL ORDER BY id DESC').get();
}

export function campagneParId(id) {
  return ouvrirDb().prepare('SELECT * FROM campagnes WHERE id = ?').get(Number(id));
}

export function listerCampagnes() {
  return ouvrirDb()
    .prepare(
      `SELECT c.*, a.libelle AS perimetre_libelle,
              (SELECT COUNT(*) FROM revues r WHERE r.campagne_id = c.id) AS total,
              (SELECT COUNT(*) FROM revues r WHERE r.campagne_id = c.id AND r.decision IS NOT NULL) AS decidees,
              (SELECT COUNT(*) FROM revues r WHERE r.campagne_id = c.id AND r.decision = 'retiree') AS retirees
         FROM campagnes c
         LEFT JOIN applications a ON a.id = c.perimetre_application_id
        ORDER BY c.id DESC`,
    )
    .all();
}

// La maille de travail du référent.
export function avancementParApplication(campagneId) {
  return ouvrirDb()
    .prepare(
      `SELECT a.id, a.code, a.libelle,
              COUNT(*) AS total,
              SUM(CASE WHEN r.decision IS NOT NULL THEN 1 ELSE 0 END) AS decidees,
              SUM(CASE WHEN r.decision = 'retiree' THEN 1 ELSE 0 END) AS retirees,
              (SELECT group_concat(ra.login, ', ') FROM referent_applications ra WHERE ra.application_id = a.id) AS referents
         FROM revues r JOIN applications a ON a.id = r.application_id
        WHERE r.campagne_id = ?
        GROUP BY a.id ORDER BY a.libelle`,
    )
    .all(Number(campagneId));
}

// `applicationIds` limite au périmètre du référent connecté.
export function lignesCampagne(campagneId, { applicationIds = null, enAttente = false, applicationId = 0 } = {}) {
  const cond = ['r.campagne_id = ?'];
  const args = [Number(campagneId)];
  if (Array.isArray(applicationIds)) {
    if (!applicationIds.length) return [];
    cond.push(`r.application_id IN (${applicationIds.map(() => '?').join(',')})`);
    args.push(...applicationIds);
  }
  if (Number(applicationId)) {
    cond.push('r.application_id = ?');
    args.push(Number(applicationId));
  }
  if (enAttente) cond.push('r.decision IS NULL');
  return ouvrirDb()
    .prepare(
      `SELECT r.*, h.role, h.statut, h.date_realisation, h.site_id,
              a.code AS app_code, a.libelle AS app_libelle,
              ag.matricule, ag.nom, ag.prenom,
              (SELECT COUNT(*) FROM preuves p WHERE p.habilitation_id = h.id) AS nb_preuves
         FROM revues r
         JOIN habilitations h ON h.id = r.habilitation_id
         JOIN applications a ON a.id = r.application_id
         JOIN agents ag ON ag.id = h.agent_id
        WHERE ${cond.join(' AND ')}
        ORDER BY a.libelle, ag.nom, ag.prenom`,
    )
    .all(...args);
}

// « Retirée » révoque réellement l'habilitation : une revue sans effet ne prouve rien.
export function decider(acteur, campagneId, habilitationId, decision, { motif = '' } = {}) {
  if (!DECISIONS.includes(decision)) throw new Error('Décision inconnue.');
  const db = ouvrirDb();
  const campagne = campagneParId(campagneId);
  if (!campagne) throw new Error('Campagne introuvable.');
  if (campagne.cloturee_le) throw new Error('Cette campagne est clôturée.');
  const ligne = db
    .prepare('SELECT * FROM revues WHERE campagne_id = ? AND habilitation_id = ?')
    .get(Number(campagneId), Number(habilitationId));
  if (!ligne) throw new Error('Cette habilitation ne fait pas partie de la campagne.');

  const m = String(motif ?? '').trim().slice(0, 300);
  if (decision === 'retiree') {
    changerStatut(acteur, habilitationId, 'revoquer', {
      motif: `Revue périodique « ${campagne.libelle} »${m ? ` : ${m}` : ''}`,
    });
  }
  db.prepare(
    `UPDATE revues SET decision = ?, decide_par = ?, decide_le = datetime('now'), motif = ?
      WHERE campagne_id = ? AND habilitation_id = ?`,
  ).run(decision, acteur, m || null, Number(campagneId), Number(habilitationId));
  tracer(acteur, decision === 'retiree' ? 'revue:retirer' : 'revue:maintenir', {
    entite: 'habilitation',
    entiteId: Number(habilitationId),
    details: { campagne: campagne.libelle, campagneId: Number(campagneId), ...(m ? { motif: m } : {}) },
  });
  return db.prepare('SELECT * FROM revues WHERE campagne_id = ? AND habilitation_id = ?')
    .get(Number(campagneId), Number(habilitationId));
}

// Les lignes sans décision le restent : c'est le constat.
export function cloturer(acteur, campagneId) {
  const db = ouvrirDb();
  const campagne = campagneParId(campagneId);
  if (!campagne) throw new Error('Campagne introuvable.');
  if (campagne.cloturee_le) throw new Error('Campagne déjà clôturée.');
  const bilan = synthese(campagneId);
  db.prepare("UPDATE campagnes SET cloturee_le = datetime('now'), cloturee_par = ? WHERE id = ?")
    .run(acteur, Number(campagneId));
  tracer(acteur, 'revue:cloturer', { entite: 'campagne', entiteId: Number(campagneId), details: bilan });
  return campagneParId(campagneId);
}

export function synthese(campagneId) {
  const r = ouvrirDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN decision = 'maintenue' THEN 1 ELSE 0 END) AS maintenues,
              SUM(CASE WHEN decision = 'retiree' THEN 1 ELSE 0 END) AS retirees,
              SUM(CASE WHEN decision IS NULL THEN 1 ELSE 0 END) AS sansDecision
         FROM revues WHERE campagne_id = ?`,
    )
    .get(Number(campagneId));
  return { total: r.total ?? 0, maintenues: r.maintenues ?? 0, retirees: r.retirees ?? 0, sansDecision: r.sansDecision ?? 0 };
}

export function resteAStatuer(campagneId, applicationIds = null) {
  return lignesCampagne(campagneId, { applicationIds, enAttente: true }).length;
}
