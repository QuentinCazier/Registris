// Indicateurs de délai (ouverture, fermeture après signalement), en médiane et 90e centile.

import { ouvrirDb } from './db.js';
import { CONDITION_FILE } from './habilitations.js';

const JOUR = 86400000;

// Dates du registre (AAAA-MM-JJ), horodatages SQLite (UTC) et du journal (ISO 8601).
export function versInstant(valeur) {
  const s = String(valeur ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return Date.parse(`${s.replace(' ', 'T')}Z`);
  return Date.parse(s);
}

export function depuisMois(mois, maintenant = new Date()) {
  const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - Number(mois), maintenant.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export function synthese(delais) {
  const v = delais.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mediane: null, p90: null, max: null };
  const milieu = Math.floor(v.length / 2);
  return {
    n: v.length,
    mediane: v.length % 2 ? v[milieu] : (v[milieu - 1] + v[milieu]) / 2,
    p90: v[Math.ceil(0.9 * v.length) - 1],
    max: v[v.length - 1],
  };
}

// Du dépôt à l'ouverture. Les deux dates sont au jour près dans le registre.
export function delaisOuverture({ depuis }) {
  return ouvrirDb()
    .prepare(
      `SELECT h.id, h.application_id, a.libelle AS app_libelle,
              h.date_demande, h.date_realisation
         FROM habilitations h JOIN applications a ON a.id = h.application_id
        WHERE h.date_realisation IS NOT NULL AND h.date_demande IS NOT NULL
          AND h.date_realisation >= ?`,
    )
    .all(depuis)
    .map((h) => ({ ...h, jours: (versInstant(h.date_realisation) - versInstant(h.date_demande)) / JOUR }));
}

// Du signalement à la fermeture, lu dans le journal : seules les révocations qui soldent une demande.
export function delaisFermeture({ depuis }) {
  return ouvrirDb()
    .prepare(
      `SELECT r.entite_id AS id, r.horodatage AS ferme_le, h.application_id, a.libelle AS app_libelle,
              (SELECT d.horodatage FROM journal_audit d
                WHERE d.entite = 'habilitation' AND d.entite_id = r.entite_id
                  AND d.action = 'retrait:demander' AND d.id < r.id
                ORDER BY d.id DESC LIMIT 1) AS demande_le
         FROM journal_audit r
         JOIN habilitations h ON h.id = r.entite_id
         JOIN applications a ON a.id = h.application_id
        WHERE r.action = 'habilitation:revoquer' AND r.entite = 'habilitation'
          AND json_extract(r.details, '$.suiteA') = 'demande de fermeture'
          AND r.horodatage >= ?`,
    )
    .all(depuis)
    .filter((l) => l.demande_le)
    .map((l) => ({ ...l, jours: (versInstant(l.ferme_le) - versInstant(l.demande_le)) / JOUR }));
}

// Ce qui attend en ce moment, avec l'âge du plus ancien.
export function enAttente(maintenant = new Date()) {
  const lignes = ouvrirDb()
    .prepare(
      `SELECT h.statut, h.retrait_demande_le, h.date_demande
         FROM habilitations h WHERE ${CONDITION_FILE}`,
    )
    .all();
  const age = (d) => (d ? (maintenant.getTime() - versInstant(d)) / JOUR : 0);
  const ouvertures = lignes.filter((l) => !l.retrait_demande_le).map((l) => age(l.date_demande));
  const fermetures = lignes.filter((l) => l.retrait_demande_le).map((l) => age(l.retrait_demande_le));
  return {
    ouvertures: { n: ouvertures.length, plusAncienne: ouvertures.length ? Math.max(...ouvertures) : null },
    fermetures: { n: fermetures.length, plusAncienne: fermetures.length ? Math.max(...fermetures) : null },
  };
}

export function parApplication(delais) {
  const groupes = new Map();
  for (const d of delais) {
    if (!groupes.has(d.application_id)) groupes.set(d.application_id, { libelle: d.app_libelle, jours: [] });
    groupes.get(d.application_id).jours.push(d.jours);
  }
  return [...groupes.entries()]
    .map(([id, g]) => ({ applicationId: id, libelle: g.libelle, ...synthese(g.jours) }))
    .sort((a, b) => (b.p90 ?? 0) - (a.p90 ?? 0) || a.libelle.localeCompare(b.libelle, 'fr'));
}

// Volumes des douze derniers mois, mois par mois, du plus ancien au plus récent.
export function volumesParMois({ mois = 12, maintenant = new Date() } = {}) {
  const cles = [];
  for (let i = mois - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1));
    cles.push(d.toISOString().slice(0, 7));
  }
  const db = ouvrirDb();
  const compter = (colonne) => new Map(
    db.prepare(
      `SELECT substr(${colonne}, 1, 7) AS m, COUNT(*) AS n FROM habilitations
        WHERE ${colonne} >= ? GROUP BY m`,
    ).all(`${cles[0]}-01`).map((r) => [r.m, r.n]),
  );
  const deposees = compter('date_demande');
  const ouvertes = compter('date_realisation');
  const refusees = compter('date_refus');
  const fermees = compter('date_revocation');
  return cles.map((m) => ({
    mois: m,
    deposees: deposees.get(m) ?? 0,
    ouvertes: ouvertes.get(m) ?? 0,
    refusees: refusees.get(m) ?? 0,
    fermees: fermees.get(m) ?? 0,
  }));
}
