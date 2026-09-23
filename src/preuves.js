// Coffre à preuves : nom de stockage neutre, empreinte SHA-256, validation par extension et signature.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { ouvrirDb } from './db.js';
import { tracer } from './audit.js';

// Extension -> { type métier, signature attendue en tête de fichier (hex) ou null }.
const FORMATS = {
  '.msg': { type: 'mail', magie: ['d0cf11e0a1b11ae1'] }, // conteneur OLE (Outlook)
  '.eml': { type: 'mail', magie: null }, // texte : pas de signature fiable
  '.pdf': { type: 'pdf', magie: ['25504446'] }, // %PDF
  '.png': { type: 'capture', magie: ['89504e470d0a1a0a'] },
  '.jpg': { type: 'capture', magie: ['ffd8ff'] },
  '.jpeg': { type: 'capture', magie: ['ffd8ff'] },
  '.txt': { type: 'autre', magie: null },
};

export const EXTENSIONS_ACCEPTEES = Object.freeze(Object.keys(FORMATS));

// Lève si le fichier n'est pas acceptable, sinon renvoie le type métier déduit.
export function valider({ tampon, nom }) {
  if (!tampon || !tampon.length) throw new Error('Fichier vide.');
  if (tampon.length > config.tailleMaxPreuve) {
    throw new Error(`Fichier trop volumineux (maximum ${Math.round(config.tailleMaxPreuve / 1024 / 1024)} Mo).`);
  }
  const ext = path.extname(String(nom ?? '')).toLowerCase();
  const format = FORMATS[ext];
  if (!format) {
    throw new Error(`Format non accepté (${ext || 'sans extension'}). Formats : ${EXTENSIONS_ACCEPTEES.join(', ')}.`);
  }
  if (format.magie) {
    const tete = tampon.subarray(0, 8).toString('hex');
    if (!format.magie.some((m) => tete.startsWith(m))) {
      throw new Error(`Le contenu du fichier ne correspond pas à son extension (${ext}).`);
    }
  }
  return format.type;
}

function ecrire(prefixe, tampon, nom) {
  fs.mkdirSync(config.preuvesDir, { recursive: true });
  const sha256 = crypto.createHash('sha256').update(tampon).digest('hex');
  const nomStocke = `${prefixe}_${sha256.slice(0, 16)}${path.extname(nom).toLowerCase()}`;
  fs.writeFileSync(path.join(config.preuvesDir, nomStocke), tampon);
  return { sha256, nomStocke };
}

export function ajouterPreuve(acteur, habilitationId, { tampon, nom }) {
  const type = valider({ tampon, nom });
  const db = ouvrirDb();
  const hab = db.prepare('SELECT id FROM habilitations WHERE id = ?').get(Number(habilitationId));
  if (!hab) throw new Error('Habilitation introuvable.');
  const nomOrigine = path.basename(String(nom)).slice(0, 200);
  const { sha256, nomStocke } = ecrire(`h${hab.id}`, tampon, nomOrigine);
  const info = db
    .prepare(
      `INSERT INTO preuves (habilitation_id, type, nom_origine, fichier, sha256, taille, ajoutee_par)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(hab.id, type, nomOrigine, nomStocke, sha256, tampon.length, acteur);
  const id = Number(info.lastInsertRowid);
  tracer(acteur, 'preuve:ajouter', {
    entite: 'habilitation',
    entiteId: hab.id,
    details: { preuve: id, nom: nomOrigine, sha256, taille: tampon.length },
  });
  return db.prepare('SELECT * FROM preuves WHERE id = ?').get(id);
}

export function preuveParId(id) {
  return ouvrirDb().prepare('SELECT * FROM preuves WHERE id = ?').get(Number(id));
}

export function cheminPreuve(preuve) {
  // Le nom stocké est généré par nous ; basename par sécurité.
  return path.join(config.preuvesDir, path.basename(preuve.fichier));
}

export function verifierIntegrite(preuve) {
  const chemin = cheminPreuve(preuve);
  if (!fs.existsSync(chemin)) return { intacte: false, raison: 'fichier absent' };
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex');
  return { intacte: sha256 === preuve.sha256, sha256 };
}

// Renvoie les pièces altérées ou manquantes.
export function auditerCoffre() {
  const preuves = ouvrirDb().prepare('SELECT * FROM preuves ORDER BY id').all();
  const anomalies = [];
  for (const p of preuves) {
    const r = verifierIntegrite(p);
    if (!r.intacte) anomalies.push({ ...p, raison: r.raison ?? 'empreinte différente' });
  }
  return { total: preuves.length, anomalies };
}
