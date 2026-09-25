// Durées de conservation (RGPD) : au-delà, l'identité des agents partis est effacée et leurs pièces supprimées.
// Le journal d'audit n'est pas touché : il est la preuve elle-même, voir docs/RGPD.md.

import fs from 'node:fs';

import { config } from './config.js';
import { ouvrirDb, transaction } from './db.js';
import { tracer } from './audit.js';
import { cheminPreuve } from './preuves.js';

const limite = (annees, maintenant = new Date()) => {
  const d = new Date(maintenant);
  d.setUTCFullYear(d.getUTCFullYear() - annees);
  return d.toISOString().slice(0, 10);
};

// Agents dont tous les accès sont clos depuis plus de `annees` ans.
export function agentsAPurger({ annees = config.conservationAnnees, maintenant = new Date() } = {}) {
  return ouvrirDb()
    .prepare(
      `SELECT ag.id, ag.matricule, MAX(COALESCE(h.date_revocation, h.date_refus, h.date_demande)) AS clos_le
         FROM agents ag JOIN habilitations h ON h.agent_id = ag.id
        WHERE ag.nom <> 'Anonymisé'
        GROUP BY ag.id
       HAVING SUM(CASE WHEN h.statut IN ('demandee', 'validee', 'executee') THEN 1 ELSE 0 END) = 0
          AND MAX(COALESCE(h.date_revocation, h.date_refus, h.date_demande)) < ?`,
    )
    .all(limite(annees, maintenant));
}

export function purger(acteur, { annees = config.conservationAnnees, simuler = false, maintenant = new Date() } = {}) {
  const db = ouvrirDb();
  const agents = agentsAPurger({ annees, maintenant });
  const pieces = agents.length
    ? db.prepare(
      `SELECT p.* FROM preuves p JOIN habilitations h ON h.id = p.habilitation_id
        WHERE p.purgee_le IS NULL AND h.agent_id IN (${agents.map(() => '?').join(',')})`,
    ).all(...agents.map((a) => a.id))
    : [];
  const comptes = db.prepare('SELECT COUNT(*) n FROM comptes_annuaire WHERE vu_le < ?').get(limite(annees, maintenant)).n;
  const bilan = { annees, agents: agents.length, pieces: pieces.length, comptesAnnuaire: comptes };
  if (simuler || (!agents.length && !comptes)) return { ...bilan, simule: simuler };

  transaction(() => {
    const anonymiser = db.prepare("UPDATE agents SET nom = 'Anonymisé', prenom = '', email = NULL, matricule = 'ANONYME-' || id, actif = 0 WHERE id = ?");
    for (const a of agents) anonymiser.run(a.id);
    db.prepare(`UPDATE habilitations SET commentaire = NULL, uf_libre = NULL WHERE agent_id IN (${agents.map(() => '?').join(',') || 'NULL'})`).run(...agents.map((a) => a.id));
    const marquer = db.prepare("UPDATE preuves SET purgee_le = datetime('now') WHERE id = ?");
    for (const p of pieces) marquer.run(p.id);
    db.prepare('DELETE FROM comptes_annuaire WHERE vu_le < ?').run(limite(annees, maintenant));
    db.prepare("DELETE FROM departs_detectes WHERE statut <> 'a_confirmer' AND traite_le < ?").run(limite(annees, maintenant));
    tracer(acteur, 'conservation:purger', { details: bilan });
  });
  // Les fichiers après la base : une purge interrompue laisse au pire un fichier orphelin, jamais une pièce manquante.
  for (const p of pieces) fs.rmSync(cheminPreuve(p), { force: true });
  return bilan;
}
