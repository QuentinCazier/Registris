// Relances des demandes en attente : à qui tient la demande, sinon au routage de la catégorie, une fois par période.

import { config } from './config.js';
import { ouvrirDb } from './db.js';
import { tracer } from './audit.js';
import { CONDITION_FILE } from './habilitations.js';
import { emailUtilisateur } from './administration.js';
import { getRoutage } from './parametres.js';
import { notifier } from './mailer.js';

// Date de début d'attente : dépôt pour une ouverture, signalement pour une fermeture.
const DEPUIS = 'COALESCE(h.retrait_demande_le, h.date_demande, h.cree_le)';

export function demandesEnRetard({ jours = config.relanceJours } = {}) {
  return ouvrirDb()
    .prepare(
      `SELECT h.*, a.libelle AS app_libelle, a.code AS app_code, a.categorie_id AS app_cat_id,
              ag.matricule, ag.nom, ag.prenom,
              CAST(julianday('now') - julianday(${DEPUIS}) AS INTEGER) AS jours_attente
         FROM habilitations h
         JOIN applications a ON a.id = h.application_id
         JOIN agents ag ON ag.id = h.agent_id
        WHERE ${CONDITION_FILE}
          AND julianday('now') - julianday(${DEPUIS}) >= ?
        ORDER BY jours_attente DESC, h.id`,
    )
    .all(Number(jours));
}

// Pas deux relances dans la même période.
export function aRelancer({ jours = config.relanceJours } = {}) {
  return demandesEnRetard({ jours }).filter(
    (h) => !h.relance_le || (Date.now() - Date.parse(`${h.relance_le}T00:00:00Z`)) / 86400000 >= jours,
  );
}

export function destinataire(h) {
  const assigne = h.assigne_a ? emailUtilisateur(h.assigne_a) : null;
  return assigne || getRoutage(h.app_cat_id) || '';
}

const lien = (h) => (config.urlPublique ? `${config.urlPublique}/habilitations/${h.id}` : `demande n°${h.id}`);

function message(lignes) {
  const corps = lignes
    .map((h) => {
      const quoi = h.retrait_demande_le
        ? `fermeture demandée par ${h.retrait_demande_par ?? 'un agent'}`
        : `demande ${h.statut === 'validee' ? 'validée, à exécuter' : 'à valider'}`;
      return [
        `- n°${h.id} · ${h.nom} ${h.prenom} (${h.matricule}) · ${h.app_libelle}, ${h.role}`,
        `  ${quoi}, en attente depuis ${h.jours_attente} jours`,
        `  ${lien(h)}`,
      ].join('\n');
    })
    .join('\n\n');
  return [
    `${lignes.length === 1 ? 'Une demande attend' : `${lignes.length} demandes attendent`} depuis plus de ${config.relanceJours} jours :`,
    '',
    corps,
    '',
    "Tant qu'elles ne sont pas traitées, elles restent dans la file et comptent au registre.",
  ].join('\n');
}

// Une relance par destinataire. simuler : rien n'est envoyé ni écrit. envoyer : injectable pour les tests.
export async function relancer({
  jours = config.relanceJours, simuler = false, acteur = 'cli', envoyer = notifier,
} = {}) {
  const candidates = aRelancer({ jours });
  const parDestinataire = new Map();
  const orphelines = [];

  for (const h of candidates) {
    const to = destinataire(h);
    if (!to) {
      orphelines.push(h);
      continue;
    }
    if (!parDestinataire.has(to)) parDestinataire.set(to, []);
    parDestinataire.get(to).push(h);
  }

  const envois = [];
  for (const [to, lignes] of parDestinataire) {
    const sujet = `${lignes.length} demande${lignes.length > 1 ? 's' : ''} d'habilitation en attente`;
    const envoye = simuler ? null : await envoyer({ to, sujet, texte: message(lignes) });
    envois.push({ destinataire: to, demandes: lignes.map((h) => h.id), envoye });
  }

  // Seules les relances réellement parties sont notées.
  const parties = envois.filter((e) => e.envoye);
  if (!simuler && parties.length) {
    const db = ouvrirDb();
    const maj = db.prepare(
      "UPDATE habilitations SET relance_le = date('now'), relances = relances + 1 WHERE id = ?",
    );
    for (const e of parties) for (const id of e.demandes) maj.run(id);
    // Une écriture par exécution, pas une par demande : le journal reste lisible.
    tracer(acteur, 'relance:envoyer', {
      details: { destinataires: parties.length, demandes: parties.reduce((n, e) => n + e.demandes.length, 0), seuil: jours },
    });
  }

  return {
    envois,
    orphelines,
    enRetard: demandesEnRetard({ jours }).length,
    aRelancer: candidates.length,
    simule: simuler,
    relaisConfigure: Boolean(config.smtp.host),
  };
}
