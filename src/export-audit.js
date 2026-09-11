/**
 * Dossier de preuves pour l'auditeur. On colle la liste des matricules
 * échantillonnés (commissaires aux comptes, contrôle interne, RSSI), on obtient
 * un ZIP horodaté :
 *
 *   synthese.html   synthèse imprimable : par agent, chaque habilitation avec ses
 *                   dates, son demandeur, son historique tracé et ses pièces ;
 *   synthese.csv    la même chose en tableau, pour Excel ;
 *   integrite.txt   empreintes SHA-256 de chaque pièce et état de la chaîne d'audit ;
 *   <matricule>/…   les pièces de preuve, classées par matricule et habilitation.
 */

import archiver from 'archiver';

import { config } from './config.js';
import { ouvrirDb } from './db.js';
import { habilitationsDeAgent, libelleUfs, LIB_STATUT } from './habilitations.js';
import { cheminPreuve, verifierIntegrite } from './preuves.js';
import { tracer, verifierChaine, historique } from './audit.js';

const echap = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Découpe une saisie libre (une ligne, une virgule ou un espace par matricule). */
export function analyserMatricules(saisie) {
  return [...new Set(String(saisie ?? '').split(/[\s,;]+/).map((m) => m.trim()).filter(Boolean))];
}

/** Résout des matricules en agents + habilitations ; signale les introuvables. */
export function resoudreMatricules(saisie) {
  const db = ouvrirDb();
  const trouves = [];
  const introuvables = [];
  for (const matricule of analyserMatricules(saisie)) {
    const agent = db.prepare('SELECT * FROM agents WHERE matricule = ?').get(matricule);
    if (agent) trouves.push({ ...agent, habilitations: habilitationsDeAgent(agent.id) });
    else introuvables.push(matricule);
  }
  return { trouves, introuvables };
}

const nomDossier = (agent, hab) =>
  `${agent.matricule}/${hab.id}_${hab.app_code}`.replace(/[^\w/.-]/g, '_');

function preuvesDe(habId) {
  return ouvrirDb().prepare('SELECT * FROM preuves WHERE habilitation_id = ? ORDER BY id').all(habId);
}

function synthese({ trouves, introuvables }, horodatage, chaine) {
  const blocAgent = (a) => {
    const habs = a.habilitations
      .map((h) => {
        const preuves = preuvesDe(h.id);
        const histo = historique('habilitation', h.id)
          .map((j) => `${j.horodatage.slice(0, 19).replace('T', ' ')} · ${echap(j.acteur)} · ${echap(j.action)}`)
          .join('<br>');
        const pieces = preuves.length
          ? preuves
              .map((p) => {
                const { intacte } = verifierIntegrite(p);
                return `${echap(p.nom_origine)} <small>(${p.sha256.slice(0, 16)}… ${intacte ? 'intègre' : 'ALERTE'})</small>`;
              })
              .join('<br>')
          : '<em>aucune pièce</em>';
        return `<tr>
          <td>${echap(h.app_libelle)}</td>
          <td>${echap(h.role)}</td>
          <td>${echap(libelleUfs(h) || '-')}</td>
          <td>${echap(LIB_STATUT[h.statut] ?? h.statut)}</td>
          <td>${echap(h.date_demande ?? '')}</td>
          <td>${echap(h.date_validation ?? '')}</td>
          <td>${echap(h.date_realisation ?? '')}</td>
          <td>${echap(h.date_revocation ?? '')}</td>
          <td>${echap(h.demandeur ?? '')}</td>
          <td class="petit">${histo || '-'}</td>
          <td class="petit">${pieces}</td>
        </tr>`;
      })
      .join('');
    return `<h2>${echap(a.nom)} ${echap(a.prenom)} : matricule ${echap(a.matricule)}</h2>
      <table>
        <tr><th>Application</th><th>Profil</th><th>UF</th><th>Statut</th><th>Demande</th>
            <th>Validation</th><th>Réalisation</th><th>Révocation</th><th>Demandeur</th>
            <th>Historique tracé</th><th>Pièces</th></tr>
        ${habs || '<tr><td colspan="11">Aucune habilitation enregistrée pour cet agent.</td></tr>'}
      </table>`;
  };
  const etat = chaine.valide
    ? `Chaîne d'audit intègre (${chaine.entrees} entrées vérifiées).`
    : `ALERTE : rupture de la chaîne d'audit à l'entrée n°${chaine.rupture} (${chaine.raison}).`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <title>Dossier de preuves d'habilitations</title>
    <style>body{font-family:sans-serif;margin:2rem;color:#1b2a4a;font-size:13px}
      h1{font-size:20px}h2{font-size:15px;margin-top:2rem}
      table{border-collapse:collapse;margin:.5rem 0 1rem;width:100%}
      th,td{border:1px solid #ccd;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#eef2f9}.petit{font-size:11px}small{color:#666}
      @media print{h2{page-break-before:auto}}</style></head><body>
    <h1>Dossier de preuves d'habilitations${config.etablissement ? ` : ${echap(config.etablissement)}` : ''}</h1>
    <p>Généré le ${echap(horodatage)} par ${echap(config.nom)} · ${trouves.length} agent(s) · ${etat}</p>
    ${introuvables.length ? `<p style="color:#b30000"><strong>Matricules introuvables au registre :</strong> ${introuvables.map(echap).join(', ')}</p>` : ''}
    ${trouves.map(blocAgent).join('')}
    <hr><p style="font-size:11px;color:#666">Les pièces de preuve sont jointes dans ce ZIP, classées par matricule puis par
    habilitation. Le fichier integrite.txt liste leurs empreintes SHA-256 telles qu'enregistrées au dépôt.</p>
  </body></html>`;
}

function csv({ trouves }) {
  const ligne = (cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';');
  const lignes = [
    ligne(['matricule', 'nom', 'prenom', 'application', 'profil', 'uf', 'statut', 'date_demande',
      'date_validation', 'date_realisation', 'date_revocation', 'demandeur', 'nb_preuves']),
  ];
  for (const a of trouves) {
    for (const h of a.habilitations) {
      lignes.push(ligne([a.matricule, a.nom, a.prenom, h.app_libelle, h.role, libelleUfs(h), h.statut,
        h.date_demande, h.date_validation, h.date_realisation, h.date_revocation, h.demandeur, h.nb_preuves]));
    }
  }
  // BOM UTF-8 pour qu'Excel lise les accents.
  return `﻿${lignes.join('\r\n')}\r\n`;
}

function manifeste({ trouves }, horodatage, chaine) {
  const lignes = [`Dossier généré le ${horodatage}`, `Chaîne d'audit : ${chaine.valide ? 'intègre' : 'ROMPUE'}`, ''];
  for (const a of trouves) {
    for (const h of a.habilitations) {
      for (const p of preuvesDe(h.id)) {
        const { intacte } = verifierIntegrite(p);
        lignes.push(`${p.sha256}  ${nomDossier(a, h)}/${p.nom_origine}  ${intacte ? 'OK' : 'ALTEREE_OU_ABSENTE'}`);
      }
    }
  }
  return lignes.join('\n') + '\n';
}

/**
 * Écrit le ZIP du dossier de preuves dans `sortie` (flux, typiquement la réponse
 * HTTP). Renvoie le résultat de la résolution des matricules.
 */
export function genererDossierZip(acteur, saisie, sortie) {
  const resultat = resoudreMatricules(saisie);
  const horodatage = new Date().toISOString();
  const chaine = verifierChaine();

  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.pipe(sortie);
  zip.append(synthese(resultat, horodatage, chaine), { name: 'synthese.html' });
  zip.append(csv(resultat), { name: 'synthese.csv' });
  zip.append(manifeste(resultat, horodatage, chaine), { name: 'integrite.txt' });

  for (const agent of resultat.trouves) {
    for (const hab of agent.habilitations) {
      for (const p of preuvesDe(hab.id)) {
        const { intacte } = verifierIntegrite(p);
        const nom = `${nomDossier(agent, hab)}/${intacte ? '' : 'ALERTE_INTEGRITE_'}${p.nom_origine}`;
        try {
          zip.file(cheminPreuve(p), { name: nom });
        } catch {
          /* fichier manquant : signalé dans integrite.txt */
        }
      }
    }
  }

  tracer(acteur, 'export:audit', {
    details: {
      matricules: resultat.trouves.map((a) => a.matricule),
      introuvables: resultat.introuvables,
    },
  });
  zip.finalize();
  return resultat;
}
