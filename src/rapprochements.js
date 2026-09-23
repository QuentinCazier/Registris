// Rapprochement : l'extraction des comptes d'une application confrontée au registre, sur le matricule.

import crypto from 'node:crypto';
import path from 'node:path';

import { config } from './config.js';
import { ouvrirDb, transaction } from './db.js';
import { tracer } from './audit.js';
import { creerHabilitation, changerStatut, applicationParId } from './habilitations.js';

export const CATEGORIES = Object.freeze({
  revoque_present: { libelle: 'Révoqué au registre, encore présent', gravite: 'anomalie' },
  non_declare: { libelle: 'Compte non déclaré', gravite: 'anomalie' },
  introuvable: { libelle: 'Déclaré, introuvable dans l’application', gravite: 'attente' },
  en_cours_present: { libelle: 'Ouvert sans être enregistré', gravite: 'attente' },
  concordant: { libelle: 'Concordant', gravite: 'fait' },
});

// --- Lecture de l'extraction -------------------------------------------------------

// UTF-8 strict, sinon Windows-1252 : les exports de logiciels Windows sont souvent en ANSI.
export function decoder(tampon) {
  let octets = Buffer.from(tampon);
  if (octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf) octets = octets.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

export function separateur(premiereLigne) {
  const compte = (c) => premiereLigne.split(c).length - 1;
  return [';', '\t', ',', '|'].reduce((meilleur, c) => (compte(c) > compte(meilleur) ? c : meilleur), ';');
}

// Lecteur CSV complet : guillemets, guillemets doublés, retours à la ligne dans une cellule.
export function lireCsv(texte) {
  const propre = texte.replace(/\r\n?/g, '\n');
  const sep = separateur(propre.split('\n', 1)[0] ?? '');
  const lignes = [];
  let ligne = [];
  let champ = '';
  let entreGuillemets = false;
  for (let i = 0; i < propre.length; i += 1) {
    const c = propre[i];
    if (entreGuillemets) {
      if (c === '"' && propre[i + 1] === '"') { champ += '"'; i += 1; }
      else if (c === '"') entreGuillemets = false;
      else champ += c;
    } else if (c === '"' && champ === '') entreGuillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return { separateur: sep, lignes: lignes.filter((l) => l.some((v) => v.trim() !== '')) };
}

const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Proposition d'après les en-têtes, que l'écran laisse corriger.
export function devinerColonnes(entete) {
  const noms = entete.map(sansAccents);
  const trouver = (...motifs) => {
    const i = noms.findIndex((n) => motifs.some((m) => m.test(n)));
    return i >= 0 ? i : null;
  };
  return {
    matricule: trouver(/matricule/, /^mat\b/, /n[°o ]?\s*agent/, /id(entifiant)?\s*rh/),
    nom: trouver(/^nom( |$|_)/, /nom\s*(de\s*)?(l.)?(utilisateur|agent)/, /^nom$/, /libelle/),
    profil: trouver(/profil/, /role/, /groupe/, /habilitation/, /droit/),
    statut: trouver(/statut/, /etat/, /actif/, /active/, /valide/),
  };
}

const INACTIF = /^(0|non|no|false|faux|n|inactif|inactive|desactive|desactivee|bloque|bloquee|suspendu|supprime|expire|disabled|locked|ferme)$/;
export const estInactif = (v) => INACTIF.test(sansAccents(v).trim());

// Un matricule purement numérique perd parfois ses zéros de tête à l'export.
export function normaliserMatricule(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
}

// --- Dépôt et configuration --------------------------------------------------------

const EXTENSIONS = ['.csv', '.txt'];

export function deposer(acteur, { applicationId, tampon, nom }) {
  const app = applicationParId(applicationId);
  if (!app) throw new Error('Application introuvable.');
  if (!tampon?.length) throw new Error('Fichier vide.');
  if (tampon.length > config.tailleMaxPreuve) throw new Error('Fichier trop volumineux.');
  if (!EXTENSIONS.includes(path.extname(String(nom ?? '')).toLowerCase())) {
    throw new Error('Déposez un export au format CSV ou texte (.csv, .txt). Depuis Excel : « Enregistrer sous », CSV.');
  }
  if (tampon.subarray(0, 4096).includes(0)) throw new Error('Ce fichier n’est pas un texte : exportez-le en CSV.');

  const { lignes } = lireCsv(decoder(tampon));
  if (lignes.length < 2) throw new Error('Le fichier doit contenir une ligne d’en-tête et au moins un compte.');

  const empreinte = crypto.createHash('sha256').update(tampon).digest('hex');
  const { lastInsertRowid: id } = ouvrirDb()
    .prepare(
      `INSERT INTO rapprochements (application_id, fichier, empreinte, contenu, colonnes, cree_par)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(app.id, path.basename(String(nom)), empreinte, tampon, JSON.stringify(devinerColonnes(lignes[0])), acteur);
  tracer(acteur, 'rapprochement:deposer', {
    entite: 'rapprochement',
    entiteId: Number(id),
    details: { application: app.libelle, fichier: path.basename(String(nom)), empreinte, lignes: lignes.length - 1 },
  });
  return Number(id);
}

export function rapprochementParId(id) {
  const r = ouvrirDb()
    .prepare(
      `SELECT r.id, r.application_id, r.fichier, r.empreinte, r.colonnes, r.statut, r.comptes,
              r.cree_le, r.cree_par, r.analyse_le, a.libelle AS app_libelle, a.code AS app_code
         FROM rapprochements r JOIN applications a ON a.id = r.application_id WHERE r.id = ?`,
    )
    .get(Number(id));
  return r ? { ...r, colonnes: JSON.parse(r.colonnes ?? '{}') } : null;
}

export function contenu(id) {
  return ouvrirDb().prepare('SELECT contenu FROM rapprochements WHERE id = ?').get(Number(id))?.contenu ?? null;
}

export function apercu(id, { lignes: n = 5 } = {}) {
  const { separateur: sep, lignes } = lireCsv(decoder(contenu(id)));
  return { separateur: sep, entete: lignes[0], exemples: lignes.slice(1, 1 + n), total: lignes.length - 1 };
}

export function listerRapprochements({ applicationIds = null } = {}) {
  const filtre = Array.isArray(applicationIds)
    ? `WHERE r.application_id IN (${applicationIds.map(() => '?').join(',') || 'NULL'})`
    : '';
  return ouvrirDb()
    .prepare(
      `SELECT r.id, r.application_id, r.fichier, r.statut, r.comptes, r.cree_le, r.cree_par, r.analyse_le,
              a.libelle AS app_libelle,
              (SELECT COUNT(*) FROM rapprochement_lignes l WHERE l.rapprochement_id = r.id AND l.categorie <> 'concordant') AS ecarts,
              (SELECT COUNT(*) FROM rapprochement_lignes l WHERE l.rapprochement_id = r.id AND l.categorie <> 'concordant' AND l.suite IS NOT NULL) AS traites
         FROM rapprochements r JOIN applications a ON a.id = r.application_id
         ${filtre}
        ORDER BY r.id DESC`,
    )
    .all(...(Array.isArray(applicationIds) ? applicationIds : []));
}

// --- Analyse -----------------------------------------------------------------------

// Confronte l'extraction au registre ; relançable tant qu'aucun écart n'a été traité.
export function analyser(acteur, id, colonnes) {
  const r = rapprochementParId(id);
  if (!r) throw new Error('Rapprochement introuvable.');
  const db = ouvrirDb();
  const dejaTraite = db.prepare('SELECT 1 FROM rapprochement_lignes WHERE rapprochement_id = ? AND suite IS NOT NULL').get(r.id);
  if (dejaTraite) throw new Error('Des écarts ont déjà été traités : ce constat ne se refait plus. Déposez une nouvelle extraction.');

  const col = Object.fromEntries(['matricule', 'nom', 'profil', 'statut'].map((k) => {
    const v = colonnes?.[k];
    return [k, v === '' || v === null || v === undefined ? null : Number(v)];
  }));
  if (col.matricule === null || !Number.isInteger(col.matricule)) throw new Error('Indiquez la colonne qui contient le matricule.');

  const { lignes } = lireCsv(decoder(contenu(r.id)));
  const [, ...comptes] = lignes;

  // L'application : un compte par matricule, ses profils réunis.
  const application = new Map();
  let ignores = 0;
  for (const l of comptes) {
    const m = normaliserMatricule(l[col.matricule]);
    if (!m) { ignores += 1; continue; }
    if (col.statut !== null && estInactif(l[col.statut] ?? '')) continue;
    if (!application.has(m)) {
      application.set(m, {
        brut: String(l[col.matricule]).trim().toUpperCase(),
        nom: col.nom !== null ? String(l[col.nom] ?? '').trim() : '',
        profils: new Set(),
      });
    }
    if (col.profil !== null && String(l[col.profil] ?? '').trim()) application.get(m).profils.add(String(l[col.profil]).trim());
  }

  // Le registre : pour chaque agent, l'état de ses habilitations sur cette application.
  const registre = new Map();
  for (const h of db.prepare(
    `SELECT h.id, h.statut, h.role, ag.matricule, ag.nom, ag.prenom
       FROM habilitations h JOIN agents ag ON ag.id = h.agent_id
      WHERE h.application_id = ? ORDER BY h.id`,
  ).all(r.application_id)) {
    const m = normaliserMatricule(h.matricule);
    if (!registre.has(m)) registre.set(m, { brut: h.matricule, nom: `${h.nom} ${h.prenom}`.trim(), habilitations: [] });
    registre.get(m).habilitations.push(h);
  }

  const constats = [];
  for (const [cle, compte] of application) {
    const reg = registre.get(cle);
    const m = reg?.brut ?? compte.brut;
    const profil = [...compte.profils].join(', ');
    const nom = compte.nom || reg?.nom || '';
    const par = (statuts) => reg?.habilitations.filter((h) => statuts.includes(h.statut)) ?? [];
    const actives = par(['executee']);
    const enCours = par(['demandee', 'validee']);
    const fermees = par(['revoquee', 'refusee']);
    if (actives.length) constats.push({ categorie: 'concordant', m, nom, profil, h: actives[0].id });
    else if (enCours.length) constats.push({ categorie: 'en_cours_present', m, nom, profil, h: enCours[enCours.length - 1].id });
    else if (fermees.length) constats.push({ categorie: 'revoque_present', m, nom, profil, h: fermees[fermees.length - 1].id });
    else constats.push({ categorie: 'non_declare', m, nom, profil, h: null });
  }
  // Chaque habilitation active sans compte en face est une ligne : chacune se révoque à part.
  for (const [cle, reg] of registre) {
    if (application.has(cle)) continue;
    for (const h of reg.habilitations.filter((x) => x.statut === 'executee')) {
      constats.push({ categorie: 'introuvable', m: reg.brut, nom: reg.nom, profil: h.role, h: h.id });
    }
  }

  transaction(() => {
    db.prepare('DELETE FROM rapprochement_lignes WHERE rapprochement_id = ?').run(r.id);
    const inserer = db.prepare(
      `INSERT INTO rapprochement_lignes (rapprochement_id, categorie, matricule, nom, profil_application, habilitation_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const c of constats) inserer.run(r.id, c.categorie, c.m, c.nom || null, c.profil || null, c.h);
    db.prepare("UPDATE rapprochements SET colonnes = ?, statut = 'termine', comptes = ?, analyse_le = datetime('now') WHERE id = ?")
      .run(JSON.stringify(col), application.size, r.id);
  });

  const bilan = bilanRapprochement(r.id);
  tracer(acteur, 'rapprochement:analyser', {
    entite: 'rapprochement',
    entiteId: r.id,
    details: { application: r.app_libelle, comptes: application.size, ignores, ...bilan.parCategorie },
  });
  return { ...bilan, ignores };
}

export function bilanRapprochement(id) {
  const lignes = ouvrirDb()
    .prepare('SELECT categorie, COUNT(*) n, SUM(CASE WHEN suite IS NOT NULL THEN 1 ELSE 0 END) t FROM rapprochement_lignes WHERE rapprochement_id = ? GROUP BY categorie')
    .all(Number(id));
  const parCategorie = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0]));
  let ecarts = 0;
  let traites = 0;
  for (const l of lignes) {
    parCategorie[l.categorie] = l.n;
    if (l.categorie !== 'concordant') { ecarts += l.n; traites += l.t; }
  }
  return { parCategorie, ecarts, traites };
}

export function lignesRapprochement(id, { categorie = '' } = {}) {
  return ouvrirDb()
    .prepare(
      `SELECT l.*, h.statut AS hab_statut, h.role AS hab_role, h.date_revocation
         FROM rapprochement_lignes l LEFT JOIN habilitations h ON h.id = l.habilitation_id
        WHERE l.rapprochement_id = ? ${categorie ? 'AND l.categorie = ?' : ''}
        ORDER BY l.matricule`,
    )
    .all(Number(id), ...(categorie ? [categorie] : []));
}

export const ligneParId = (id) => ouvrirDb().prepare('SELECT * FROM rapprochement_lignes WHERE id = ?').get(Number(id));

// --- Suites données aux écarts --------------------------------------------------------

// Pour l'affichage : savoir en une fois quels matricules le registre connaît.
export function matriculesConnus() {
  return new Set(ouvrirDb().prepare('SELECT matricule FROM agents').all().map((a) => normaliserMatricule(a.matricule)));
}

// Un agent peut déjà exister sous « 00012345 » quand l'extraction dit « 12345 ».
function agentParMatriculeNormalise(matricule) {
  const cle = normaliserMatricule(matricule);
  return ouvrirDb().prepare('SELECT * FROM agents').all().find((a) => normaliserMatricule(a.matricule) === cle) ?? null;
}

const SUITES_PERMISES = {
  regularise: ['non_declare'],
  ferme_dans_app: ['non_declare', 'revoque_present'],
  revoque: ['introuvable'],
  execute: ['en_cours_present'],
};

// Solde un écart et fait suivre le registre, avec la référence du rapprochement.
export function donnerSuite(acteur, ligneId, suite, { nom = '', prenom = '', role = '' } = {}) {
  const ligne = ligneParId(ligneId);
  if (!ligne) throw new Error('Ligne introuvable.');
  if (ligne.suite) throw new Error('Cet écart a déjà été traité.');
  if (!SUITES_PERMISES[suite]?.includes(ligne.categorie)) throw new Error('Cette suite ne convient pas à cet écart.');
  const r = rapprochementParId(ligne.rapprochement_id);
  const reference = `rapprochement n°${r.id} du ${String(r.analyse_le ?? r.cree_le).slice(0, 10)} (${r.fichier})`;

  return transaction(() => {
    let habilitationId = ligne.habilitation_id;
    if (suite === 'regularise') {
      const profil = String(role || ligne.profil_application || '').trim();
      if (!profil) throw new Error('Indiquez le profil ouvert dans l’application.');
      const [nomDeduit, ...reste] = String(ligne.nom ?? '').trim().split(/\s+/);
      const connu = agentParMatriculeNormalise(ligne.matricule);
      const h = creerHabilitation(acteur, {
        agent: {
          matricule: connu?.matricule ?? ligne.matricule,
          nom: String(nom || nomDeduit || '').trim(),
          prenom: String(prenom || reste.join(' ')).trim(),
        },
        applicationId: r.application_id,
        role: profil,
        demandeur: acteur,
        pourAutrui: true,
        commentaire: `Régularisation : compte trouvé dans l'application lors du ${reference}.`,
      });
      changerStatut(acteur, h.id, 'executer');
      habilitationId = h.id;
    } else if (suite === 'revoque') {
      changerStatut(acteur, ligne.habilitation_id, 'revoquer', { motif: `Absent de l'application au ${reference}.` });
    } else if (suite === 'execute') {
      changerStatut(acteur, ligne.habilitation_id, 'executer');
    }

    ouvrirDb()
      .prepare("UPDATE rapprochement_lignes SET suite = ?, suite_par = ?, suite_le = datetime('now'), habilitation_id = ? WHERE id = ?")
      .run(suite, acteur, habilitationId, ligne.id);
    tracer(acteur, 'rapprochement:suite', {
      entite: 'rapprochement',
      entiteId: r.id,
      details: { suite, categorie: ligne.categorie, matricule: ligne.matricule, habilitationId },
    });
    return ligneParId(ligne.id);
  });
}
