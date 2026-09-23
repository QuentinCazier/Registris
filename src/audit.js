// Journal d'audit chaîné : chaque écriture porte l'empreinte SHA-256 de la précédente.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { ouvrirDb } from './db.js';

function calculerHash(entree) {
  const charge = [
    entree.horodatage,
    entree.acteur,
    entree.action,
    entree.entite ?? '',
    entree.entite_id ?? '',
    entree.details ?? '',
    entree.hash_precedent ?? '',
  ].join('|');
  return crypto.createHash('sha256').update(charge).digest('hex');
}

// `details` est un objet, sérialisé en JSON.
export function tracer(acteur, action, { entite = null, entiteId = null, details = null } = {}) {
  const db = ouvrirDb();
  const precedent = db.prepare('SELECT hash FROM journal_audit ORDER BY id DESC LIMIT 1').get();
  const entree = {
    horodatage: new Date().toISOString(),
    acteur: String(acteur ?? 'système'),
    action,
    entite,
    entite_id: entiteId,
    details: details ? JSON.stringify(details) : null,
    hash_precedent: precedent?.hash ?? null,
  };
  entree.hash = calculerHash(entree);
  db.prepare(
    `INSERT INTO journal_audit
       (horodatage, acteur, action, entite, entite_id, details, hash_precedent, hash)
     VALUES (@horodatage, @acteur, @action, @entite, @entite_id, @details, @hash_precedent, @hash)`,
  ).run(entree);
  return entree;
}

// Renvoie la première rupture éventuelle.
export function verifierChaine() {
  const lignes = ouvrirDb().prepare('SELECT * FROM journal_audit ORDER BY id ASC').all();
  let precedent = null;
  for (const ligne of lignes) {
    if ((ligne.hash_precedent ?? null) !== precedent) {
      return { valide: false, rupture: ligne.id, raison: 'chainage' };
    }
    if (calculerHash(ligne) !== ligne.hash) {
      return { valide: false, rupture: ligne.id, raison: 'contenu' };
    }
    precedent = ligne.hash;
  }
  return { valide: true, entrees: lignes.length };
}

// --- Contrôle complet et point de reprise -----------------------------------------
// Les pages repartent du dernier contrôle complet ; ce qui le précède n'est revérifié
// que par « registris verifier », à planifier.

export function dernierControle() {
  return ouvrirDb().prepare('SELECT * FROM controles_chaine ORDER BY id DESC LIMIT 1').get() ?? null;
}

export function enregistrerControle(acteur, resultat) {
  const tete = teteDeChaine();
  return ouvrirDb()
    .prepare(
      `INSERT INTO controles_chaine (verifie_par, dernier_id, hash_tete, entrees, valide)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(acteur, tete.dernier_id, tete.hash_tete, tete.entrees, resultat.valide ? 1 : 0);
}

// État de la chaîne pour l'affichage, depuis le dernier contrôle complet valide.
export function etatChaine() {
  const db = ouvrirDb();
  const controle = dernierControle();
  const total = db.prepare('SELECT COUNT(*) n FROM journal_audit').get().n;

  if (!controle || !controle.valide || !controle.dernier_id) {
    return { ...verifierChaine(), entrees: total, complet: true, controleLe: controle?.verifie_le ?? null };
  }

  // Le point de reprise doit lui-même être intact.
  const reprise = db.prepare('SELECT * FROM journal_audit WHERE id = ?').get(controle.dernier_id);
  if (!reprise || reprise.hash !== controle.hash_tete || calculerHash(reprise) !== reprise.hash) {
    return { valide: false, rupture: controle.dernier_id, raison: 'point de reprise', entrees: total, complet: false, controleLe: controle.verifie_le };
  }

  const lignes = db.prepare('SELECT * FROM journal_audit WHERE id > ? ORDER BY id ASC').all(controle.dernier_id);
  let precedent = controle.hash_tete;
  for (const ligne of lignes) {
    if ((ligne.hash_precedent ?? null) !== precedent) {
      return { valide: false, rupture: ligne.id, raison: 'chainage', entrees: total, complet: false, controleLe: controle.verifie_le };
    }
    if (calculerHash(ligne) !== ligne.hash) {
      return { valide: false, rupture: ligne.id, raison: 'contenu', entrees: total, complet: false, controleLe: controle.verifie_le };
    }
    precedent = ligne.hash;
  }
  return { valide: true, entrees: total, complet: false, depuis: controle.dernier_id, nouvelles: lignes.length, controleLe: controle.verifie_le };
}

// --- Ancrage : la tête de chaîne déposée hors de la base, contre un remplacement en bloc ----

const empreinteAncrage = (a) =>
  crypto.createHash('sha256').update([a.horodatage, a.entrees, a.dernier_id, a.hash_tete].join('|')).digest('hex');

export function teteDeChaine() {
  const db = ouvrirDb();
  const dernier = db.prepare('SELECT id, hash FROM journal_audit ORDER BY id DESC LIMIT 1').get();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM journal_audit').get();
  return { dernier_id: dernier?.id ?? 0, hash_tete: dernier?.hash ?? '', entrees: n };
}

export function texteAncrage(a) {
  return [
    `${config.nom} : ancrage de la chaîne d'audit`,
    `etablissement=${config.etablissement}`,
    `horodatage=${a.horodatage}`,
    `entrees=${a.entrees}`,
    `dernier_id=${a.dernier_id}`,
    `hash_tete=${a.hash_tete}`,
    `empreinte=${a.empreinte}`,
    '',
    'Conservez ce texte hors du serveur. Il permet de vérifier que la base n\'a pas été remplacée :',
    'registris verifier compare chaque ancrage à la chaîne courante.',
  ].join('\n') + '\n';
}

// `dossier` à null : ancrage enregistré en base, sans fichier.
export function ancrer({ acteur = 'système', dossier = config.ancragesDir } = {}) {
  const db = ouvrirDb();
  const tete = teteDeChaine();
  const a = { horodatage: new Date().toISOString(), ...tete, acteur: String(acteur) };
  a.empreinte = empreinteAncrage(a);
  a.fichier = null;
  if (dossier) {
    fs.mkdirSync(dossier, { recursive: true });
    a.fichier = path.join(dossier, `ancrage-${a.horodatage.replace(/[:.]/g, '-')}.txt`);
    fs.writeFileSync(a.fichier, texteAncrage(a));
  }
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO ancrages (horodatage, dernier_id, hash_tete, entrees, empreinte, fichier, acteur)
     VALUES (@horodatage, @dernier_id, @hash_tete, @entrees, @empreinte, @fichier, @acteur)`,
  ).run(a);
  a.id = Number(lastInsertRowid);
  a.texte = texteAncrage(a);
  return a;
}

export function dernierAncrage() {
  return ouvrirDb().prepare('SELECT * FROM ancrages ORDER BY id DESC LIMIT 1').get() ?? null;
}

// Fichier clé=valeur ; null s'il est illisible.
export function lireFichierAncrage(chemin) {
  try {
    const a = {};
    for (const ligne of fs.readFileSync(chemin, 'utf8').split(/\r?\n/)) {
      const m = /^(horodatage|entrees|dernier_id|hash_tete|empreinte)=(.*)$/.exec(ligne.trim());
      if (m) a[m[1]] = m[1] === 'entrees' || m[1] === 'dernier_id' ? Number(m[2]) : m[2];
    }
    return a.hash_tete !== undefined && a.empreinte ? a : null;
  } catch {
    return null;
  }
}

// Un fichier d'ancrage sans équivalent en base signale une base remplacée.
export function verifierAncrages({ dossier = config.ancragesDir } = {}) {
  const db = ouvrirDb();
  const ancrages = db.prepare('SELECT * FROM ancrages ORDER BY id ASC').all();
  const anomalies = [];
  const controler = (a, origine) => {
    if (empreinteAncrage(a) !== a.empreinte) { anomalies.push({ ancrage: a.horodatage, origine, raison: 'ancrage altéré (empreinte différente)' }); return; }
    if (a.dernier_id === 0) return; // ancrage d'une chaîne vide
    const ligne = db.prepare('SELECT hash FROM journal_audit WHERE id = ?').get(a.dernier_id);
    if (!ligne) anomalies.push({ ancrage: a.horodatage, origine, raison: `entrée n°${a.dernier_id} absente du journal` });
    else if (ligne.hash !== a.hash_tete) anomalies.push({ ancrage: a.horodatage, origine, raison: `entrée n°${a.dernier_id} modifiée depuis l'ancrage` });
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM journal_audit WHERE id <= ?').get(a.dernier_id);
    if (n !== a.entrees) anomalies.push({ ancrage: a.horodatage, origine, raison: `${n} entrées jusqu'à la n°${a.dernier_id} au lieu de ${a.entrees}` });
  };

  const empreintesEnBase = new Set(ancrages.map((a) => a.empreinte));
  for (const a of ancrages) {
    controler(a, 'base');
    if (a.fichier) {
      const f = lireFichierAncrage(a.fichier);
      if (!f) anomalies.push({ ancrage: a.horodatage, origine: 'fichier', raison: `fichier d'ancrage manquant ou illisible : ${path.basename(a.fichier)}` });
      else if (f.empreinte !== a.empreinte) anomalies.push({ ancrage: a.horodatage, origine: 'fichier', raison: 'fichier d\'ancrage différent de l\'ancrage en base' });
    }
  }
  let fichiers = 0;
  if (dossier && fs.existsSync(dossier)) {
    for (const nom of fs.readdirSync(dossier).filter((n) => /^ancrage-.*\.txt$/.test(n))) {
      const f = lireFichierAncrage(path.join(dossier, nom));
      if (!f) continue;
      fichiers++;
      if (!empreintesEnBase.has(f.empreinte)) {
        anomalies.push({ ancrage: f.horodatage, origine: 'fichier', raison: `ancrage ${nom} inconnu de la base : la base a-t-elle été remplacée ?` });
        controler(f, 'fichier');
      }
    }
  }
  return { valide: anomalies.length === 0, ancrages: ancrages.length, fichiers, dernier: ancrages.at(-1) ?? null, anomalies };
}

export function journal({ limite = 200, q = '' } = {}) {
  const db = ouvrirDb();
  const terme = String(q ?? '').trim();
  if (!terme) {
    return db.prepare('SELECT * FROM journal_audit ORDER BY id DESC LIMIT ?').all(limite);
  }
  const like = `%${terme}%`;
  return db
    .prepare(
      `SELECT * FROM journal_audit
        WHERE acteur LIKE ? OR action LIKE ? OR details LIKE ? OR (entite || ' ' || COALESCE(entite_id, '')) LIKE ?
        ORDER BY id DESC LIMIT ?`,
    )
    .all(like, like, like, like, limite);
}

// Du plus ancien au plus récent.
export function historique(entite, entiteId) {
  return ouvrirDb()
    .prepare('SELECT * FROM journal_audit WHERE entite = ? AND entite_id = ? ORDER BY id ASC')
    .all(entite, Number(entiteId));
}
