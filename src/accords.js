// Accord du cadre : pour les applications qui l'exigent, le responsable de l'UF approuve avant le référent.

import { ouvrirDb, transaction } from './db.js';
import { tracer } from './audit.js';
import { changerStatut, habilitationParId } from './habilitations.js';

const liste = (v) => [...new Set([].concat(v ?? []).flatMap((x) => String(x).split(/[\s,;]+/)).map((x) => x.trim().toLowerCase()).filter(Boolean))];

export function responsablesUf(ufId) {
  return ouvrirDb().prepare('SELECT login FROM uf_responsables WHERE uf_id = ? ORDER BY login').all(Number(ufId)).map((r) => r.login);
}

export function responsablesParUf() {
  const m = new Map();
  for (const r of ouvrirDb().prepare('SELECT uf_id, login FROM uf_responsables ORDER BY login').all()) {
    if (!m.has(r.uf_id)) m.set(r.uf_id, []);
    m.get(r.uf_id).push(r.login);
  }
  return m;
}

export function definirResponsablesUf(acteur, ufId, logins) {
  const ls = liste(logins);
  for (const l of ls) if (!/^[\w.@\\-]{1,100}$/.test(l)) throw new Error(`Identifiant invalide : ${l}`);
  const db = ouvrirDb();
  transaction(() => {
    db.prepare('DELETE FROM uf_responsables WHERE uf_id = ?').run(Number(ufId));
    const ins = db.prepare('INSERT OR IGNORE INTO uf_responsables (uf_id, login) VALUES (?, ?)');
    for (const l of ls) ins.run(Number(ufId), l);
  });
  tracer(acteur, 'uf:responsables', { entite: 'uf', entiteId: Number(ufId), details: { responsables: ls } });
  return ls;
}

// Cadres qui peuvent donner leur accord : responsables d'au moins une UF de la demande.
export function cadresDe(habilitationId) {
  return ouvrirDb()
    .prepare(
      `SELECT DISTINCT r.login FROM habilitation_ufs hu JOIN uf_responsables r ON r.uf_id = hu.uf_id
        WHERE hu.habilitation_id = ? ORDER BY r.login`,
    )
    .all(Number(habilitationId))
    .map((r) => r.login);
}

export function demandesAApprouver(login) {
  return ouvrirDb()
    .prepare(
      `SELECT DISTINCT h.*, a.libelle AS app_libelle, a.code AS app_code, ag.matricule, ag.nom, ag.prenom
         FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         JOIN agents ag ON ag.id = h.agent_id
         JOIN habilitation_ufs hu ON hu.habilitation_id = h.id
         JOIN uf_responsables r ON r.uf_id = hu.uf_id
        WHERE h.accord_cadre = 'attente' AND h.statut = 'demandee' AND r.login = ? COLLATE NOCASE
        ORDER BY h.date_demande, h.id`,
    )
    .all(String(login ?? '').toLowerCase());
}

export const compterAApprouver = (login) => demandesAApprouver(login).length;

// decision : « accorder » ou « refuser » (motif obligatoire). horsOutil : accord reçu par un autre canal, saisi par le référent.
/**
 * @param {string} acteur
 * @param {number} id
 * @param {{ decision?: string, motif?: string, horsOutil?: boolean }} [choix]
 */
export function statuerAccord(acteur, id, { decision, motif = '', horsOutil = false } = {}) {
  const db = ouvrirDb();
  const h = db.prepare('SELECT * FROM habilitations WHERE id = ?').get(Number(id));
  if (!h) throw new Error('Demande introuvable.');
  if (h.accord_cadre !== 'attente' || h.statut !== 'demandee') throw new Error("Cette demande n'attend plus d'accord.");
  const m = String(motif ?? '').trim().slice(0, 300);
  if (!horsOutil && !cadresDe(h.id).includes(String(acteur).toLowerCase())) {
    throw new Error("Vous n'êtes responsable d'aucune UF de cette demande.");
  }
  if (horsOutil && !m) throw new Error("Indiquez qui a donné l'accord et comment : « Accord de Mme Durand par courriel du 12/10 ».");
  if (decision === 'refuser') {
    if (!m) throw new Error('Un refus doit être motivé : le demandeur doit pouvoir le lire.');
    return transaction(() => {
      db.prepare("UPDATE habilitations SET accord_cadre = 'refuse', accord_par = ?, accord_le = datetime('now') WHERE id = ?").run(acteur, h.id);
      tracer(acteur, 'accord:refuser', { entite: 'habilitation', entiteId: h.id, details: { motif: m } });
      return changerStatut(acteur, h.id, 'refuser', { motif: `Refus du cadre : ${m}` });
    });
  }
  if (decision !== 'accorder') throw new Error('Décision inconnue.');
  db.prepare("UPDATE habilitations SET accord_cadre = 'accorde', accord_par = ?, accord_le = datetime('now') WHERE id = ?").run(acteur, h.id);
  tracer(acteur, horsOutil ? 'accord:hors-outil' : 'accord:donner', { entite: 'habilitation', entiteId: h.id, details: m ? { motif: m } : null });
  return habilitationParId(h.id);
}
