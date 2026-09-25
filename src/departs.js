// Départs détectés : un agent qui garde des accès ouverts alors que l'annuaire ou les RH le disent parti.
// Rien ne se ferme seul : chaque détection attend qu'un référent ou l'administrateur la confirme.

import { ouvrirDb } from './db.js';
import { tracer } from './audit.js';
import { signalerDepart } from './habilitations.js';
import { decoder, lireCsv, devinerColonnes, estInactif } from './rapprochements.js';
import { annuaire } from './annuaire.js';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const dateFr = (iso) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');

// Agents qui détiennent au moins un accès ouvert sans fermeture demandée.
function agentsAvecAcces() {
  return ouvrirDb()
    .prepare(
      `SELECT ag.id, ag.matricule, ag.nom, ag.prenom FROM agents ag
        WHERE EXISTS (SELECT 1 FROM habilitations h WHERE h.agent_id = ag.id AND h.statut = 'executee' AND h.retrait_demande_le IS NULL)
        ORDER BY ag.nom, ag.prenom`,
    )
    .all();
}

// Une seule détection en attente par agent.
function signaler(agentId, source, motif) {
  const r = ouvrirDb()
    .prepare(
      `INSERT INTO departs_detectes (agent_id, source, motif)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM departs_detectes WHERE agent_id = ? AND statut = 'a_confirmer')`,
    )
    .run(agentId, source, String(motif).slice(0, 300), agentId);
  return r.changes > 0;
}

// Matricule normalisé : les exports tronquent parfois les zéros de tête.
const cleMatricule = (m) => String(m ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

// `mode` : « sorties » (le fichier liste les agents partis) ou « presents » (il liste les effectifs).
export function detecterDepuisFichierRh(acteur, tampon, { mode = 'sorties' } = {}) {
  const { lignes } = lireCsv(decoder(tampon));
  if (lignes.length < 2) throw new Error('Le fichier ne contient aucune ligne après l’en-tête.');
  const entete = lignes[0];
  const col = devinerColonnes(entete).matricule;
  if (col === null) throw new Error('Colonne « Matricule » introuvable dans l’en-tête.');
  const colDate = entete.map(sansAccents).findIndex((n) => /sortie|depart|fin/.test(n));
  const colStatut = entete.map(sansAccents).findIndex((n) => /statut|etat|actif|position/.test(n));
  const fichier = new Map();
  for (const l of lignes.slice(1)) {
    const cle = cleMatricule(l[col]);
    if (cle) fichier.set(cle, { date: colDate >= 0 ? String(l[colDate] ?? '').trim() : '', statut: colStatut >= 0 ? String(l[colStatut] ?? '') : '' });
  }
  const agents = agentsAvecAcces();
  const jour = aujourdhui();
  const candidats = [];
  if (mode === 'presents') {
    for (const a of agents) if (!fichier.has(cleMatricule(a.matricule))) candidats.push([a, `Absent du fichier des effectifs du ${dateFr(jour)}.`]);
    if (agents.length >= 10 && candidats.length > agents.length / 2) {
      throw new Error(`Le fichier semble incomplet : ${candidats.length} agents sur ${agents.length} en seraient absents. Rien n'a été signalé.`);
    }
  } else {
    for (const a of agents) {
      const ligne = fichier.get(cleMatricule(a.matricule));
      if (!ligne) continue;
      const iso = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ligne.date);
      const date = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : /^\d{4}-\d{2}-\d{2}/.test(ligne.date) ? ligne.date.slice(0, 10) : '';
      if (date && date > jour) continue;
      if (ligne.statut && !estInactif(ligne.statut) && !/sorti|parti|radie|fin/.test(sansAccents(ligne.statut))) continue;
      candidats.push([a, date ? `Sorti des effectifs le ${dateFr(date)} (fichier RH).` : 'Signalé sorti des effectifs par le fichier RH.']);
    }
  }
  const nouveaux = candidats.filter(([a, motif]) => signaler(a.id, 'rh', motif)).length;
  tracer(acteur, 'depart:detecter', { details: { source: 'rh', mode, lignes: fichier.size, detectes: candidats.length, nouveaux } });
  return { lignes: fichier.size, detectes: candidats.length, nouveaux };
}

// Comptes désactivés dans l'Active Directory. Un compte introuvable n'est pas signalé :
// beaucoup d'annuaires ne portent pas le matricule, ce serait du bruit.
export async function detecterDepuisAnnuaire(acteur = 'système') {
  const agents = agentsAvecAcces();
  const etats = await annuaire.etatComptes(agents.map((a) => a.matricule));
  let detectes = 0;
  let nouveaux = 0;
  for (const a of agents) {
    const e = etats.get(a.matricule);
    if (!e?.desactive) continue;
    detectes += 1;
    if (signaler(a.id, 'annuaire', `Compte ${e.login || ''} désactivé dans l'annuaire.`.replace('Compte  ', 'Compte '))) nouveaux += 1;
  }
  tracer(acteur, 'depart:detecter', { details: { source: 'annuaire', agents: agents.length, detectes, nouveaux } });
  return { agents: agents.length, detectes, nouveaux };
}

export function departsAConfirmer() {
  return ouvrirDb()
    .prepare(
      `SELECT d.*, ag.matricule, ag.nom, ag.prenom,
              (SELECT COUNT(*) FROM habilitations h WHERE h.agent_id = d.agent_id AND h.statut = 'executee' AND h.retrait_demande_le IS NULL) AS acces_ouverts
         FROM departs_detectes d JOIN agents ag ON ag.id = d.agent_id
        WHERE d.statut = 'a_confirmer'
          AND EXISTS (SELECT 1 FROM habilitations h WHERE h.agent_id = d.agent_id AND h.statut = 'executee' AND h.retrait_demande_le IS NULL)
        ORDER BY d.detecte_le, d.id`,
    )
    .all();
}

function detection(id) {
  const d = ouvrirDb().prepare("SELECT d.*, ag.matricule FROM departs_detectes d JOIN agents ag ON ag.id = d.agent_id WHERE d.id = ? AND d.statut = 'a_confirmer'").get(Number(id));
  if (!d) throw new Error('Détection introuvable ou déjà traitée.');
  return d;
}

export function confirmerDepart(acteur, id, { demandeur = '' } = {}) {
  const d = detection(id);
  const bilan = signalerDepart(acteur, { matricule: d.matricule, motif: `Départ détecté : ${d.motif}`, demandeur: demandeur || acteur });
  ouvrirDb().prepare("UPDATE departs_detectes SET statut = 'confirme', traite_par = ?, traite_le = datetime('now') WHERE id = ?").run(acteur, d.id);
  tracer(acteur, 'depart:confirmer', { entite: 'agent', entiteId: d.agent_id, details: { source: d.source, acces: bilan.fermeturesDemandees } });
  return bilan;
}

export function ecarterDepart(acteur, id, { motif = '' } = {}) {
  const d = detection(id);
  const m = String(motif ?? '').trim().slice(0, 300);
  if (!m) throw new Error('Indiquez pourquoi cette détection est écartée : retour de congé, homonyme, erreur du fichier.');
  ouvrirDb().prepare("UPDATE departs_detectes SET statut = 'ecarte', traite_par = ?, traite_le = datetime('now'), motif_ecart = ? WHERE id = ?").run(acteur, m, d.id);
  tracer(acteur, 'depart:ecarter', { entite: 'agent', entiteId: d.agent_id, details: { source: d.source, motif: m } });
}
