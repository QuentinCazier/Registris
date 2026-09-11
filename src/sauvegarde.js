/**
 * Sauvegarde et restauration. Une sauvegarde est une archive ZIP autoportante :
 *
 *   base.db          copie cohérente de la base (VACUUM INTO, sûr pendant le service)
 *   preuves/…        les pièces du coffre, sous leur nom de stockage
 *   logos/…          les logos du catalogue
 *   ancrages/…       les fichiers d'ancrage de la chaîne d'audit
 *   manifeste.json   version, date, compteurs, état de la chaîne, empreinte SHA-256 de chaque fichier
 *
 * `inspecter` vérifie une archive sans rien écrire ; `restaurer` la déploie sur
 * une installation arrêtée et refuse d'écraser une base existante sans `forcer`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import archiver from 'archiver';

import { config } from './config.js';
import { ouvrirDb } from './db.js';
import { tracer, verifierChaine, verifierAncrages } from './audit.js';
import { lireZip } from './zip.js';

const { version: VERSION } = createRequire(import.meta.url)('../package.json');

const sha256 = (tampon) => crypto.createHash('sha256').update(tampon).digest('hex');

function listerFichiers(dossier) {
  if (!dossier || !fs.existsSync(dossier)) return [];
  const resultat = [];
  const parcourir = (d, prefixe) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const relatif = prefixe ? `${prefixe}/${e.name}` : e.name;
      if (e.isDirectory()) parcourir(path.join(d, e.name), relatif);
      else if (e.isFile()) resultat.push({ relatif, absolu: path.join(d, e.name) });
    }
  };
  parcourir(dossier, '');
  return resultat;
}

/**
 * Crée une archive dans `destination` (dossier). Renvoie { fichier, taille, manifeste }.
 */
export async function sauvegarder({ destination = config.sauvegardesDir, acteur = 'système' } = {}) {
  const db = ouvrirDb();
  fs.mkdirSync(destination, { recursive: true });
  const horodatage = new Date().toISOString();
  const nom = `registris-sauvegarde-${horodatage.replace(/[:.]/g, '-')}.zip`;
  const fichier = path.join(destination, nom);

  // Copie cohérente de la base, même pendant le service.
  const temporaire = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'registris-sauv-')), 'base.db');
  db.exec(`VACUUM INTO '${temporaire.replace(/'/g, "''")}'`);

  const compteur = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const entrees = [
    { relatif: 'base.db', absolu: temporaire },
    ...listerFichiers(config.preuvesDir).map((f) => ({ ...f, relatif: `preuves/${f.relatif}` })),
    ...listerFichiers(config.logosDir).map((f) => ({ ...f, relatif: `logos/${f.relatif}` })),
    ...listerFichiers(config.ancragesDir).map((f) => ({ ...f, relatif: `ancrages/${f.relatif}` })),
  ];
  const manifeste = {
    application: config.nom,
    version: VERSION,
    etablissement: config.etablissement,
    date: horodatage,
    compteurs: {
      agents: compteur('agents'), habilitations: compteur('habilitations'), preuves: compteur('preuves'),
      utilisateurs: compteur('utilisateurs'), journal: compteur('journal_audit'), ancrages: compteur('ancrages'),
    },
    chaine: verifierChaine(),
    ancrages: (({ valide, ancrages, anomalies }) => ({ valide, ancrages, anomalies: anomalies.length }))(verifierAncrages()),
    fichiers: entrees.map((e) => {
      const contenu = fs.readFileSync(e.absolu);
      return { chemin: e.relatif, taille: contenu.length, sha256: sha256(contenu) };
    }),
  };

  await new Promise((resoudre, rejeter) => {
    const sortie = fs.createWriteStream(fichier);
    const zip = archiver('zip', { zlib: { level: 6 } });
    sortie.on('close', resoudre);
    sortie.on('error', rejeter);
    zip.on('error', rejeter);
    zip.pipe(sortie);
    for (const e of entrees) zip.file(e.absolu, { name: e.relatif });
    zip.append(JSON.stringify(manifeste, null, 2) + '\n', { name: 'manifeste.json' });
    zip.finalize();
  });
  fs.rmSync(path.dirname(temporaire), { recursive: true, force: true });

  const taille = fs.statSync(fichier).size;
  tracer(acteur, 'sauvegarde:creee', { details: { fichier: nom, taille, fichiers: entrees.length } });
  return { fichier, taille, manifeste };
}

/**
 * Lit une archive et confronte chaque fichier au manifeste. Ne touche ni à la
 * base ni au disque. Renvoie { valide, manifeste, verifications }.
 */
export function inspecter(cheminZip) {
  const entrees = lireZip(cheminZip);
  const brut = entrees.get('manifeste.json');
  if (!brut) throw new Error('archive sans manifeste.json : ce n\'est pas une sauvegarde Registris');
  const manifeste = JSON.parse(brut.toString('utf8'));
  const verifications = manifeste.fichiers.map((f) => {
    const contenu = entrees.get(f.chemin);
    if (!contenu) return { chemin: f.chemin, ok: false, raison: 'absent de l\'archive' };
    if (contenu.length !== f.taille) return { chemin: f.chemin, ok: false, raison: `taille ${contenu.length} au lieu de ${f.taille}` };
    if (sha256(contenu) !== f.sha256) return { chemin: f.chemin, ok: false, raison: 'empreinte différente' };
    return { chemin: f.chemin, ok: true };
  });
  const attendus = new Set(manifeste.fichiers.map((f) => f.chemin));
  for (const nom of entrees.keys()) {
    if (nom !== 'manifeste.json' && !attendus.has(nom)) verifications.push({ chemin: nom, ok: false, raison: 'fichier non listé dans le manifeste' });
  }
  return { valide: verifications.every((v) => v.ok), manifeste, verifications, entrees };
}

/**
 * Déploie une archive vérifiée. Les cibles par défaut sont celles de la
 * configuration ; l'application doit être arrêtée. Refuse d'écraser une base
 * existante sans `forcer`. Renvoie le nombre de fichiers écrits par famille.
 */
export function restaurer(cheminZip, { forcer = false, cibles = {} } = {}) {
  const c = {
    dbPath: cibles.dbPath ?? config.dbPath,
    preuvesDir: cibles.preuvesDir ?? config.preuvesDir,
    logosDir: cibles.logosDir ?? config.logosDir,
    ancragesDir: cibles.ancragesDir ?? config.ancragesDir,
  };
  const rapport = inspecter(cheminZip);
  if (!rapport.valide) {
    const details = rapport.verifications.filter((v) => !v.ok).map((v) => `${v.chemin} (${v.raison})`).join(', ');
    throw new Error(`archive invalide, restauration refusée : ${details}`);
  }
  if (fs.existsSync(c.dbPath) && !forcer) {
    throw new Error(`une base existe déjà (${c.dbPath}) : arrêtez l'application et relancez avec --forcer pour la remplacer`);
  }
  const ecrits = { base: 0, preuves: 0, logos: 0, ancrages: 0 };
  const ecrire = (chemin, contenu) => { fs.mkdirSync(path.dirname(chemin), { recursive: true }); fs.writeFileSync(chemin, contenu); };
  const sur = (dossier, relatif) => {
    const cible = path.resolve(dossier, relatif);
    if (!cible.startsWith(path.resolve(dossier) + path.sep) && cible !== path.resolve(dossier)) throw new Error(`chemin suspect dans l'archive : ${relatif}`);
    return cible;
  };
  for (const [nom, contenu] of rapport.entrees) {
    if (nom === 'base.db') { ecrire(c.dbPath, contenu); ecrits.base++; }
    else if (nom.startsWith('preuves/')) { ecrire(sur(c.preuvesDir, nom.slice(8)), contenu); ecrits.preuves++; }
    else if (nom.startsWith('logos/')) { ecrire(sur(c.logosDir, nom.slice(6)), contenu); ecrits.logos++; }
    else if (nom.startsWith('ancrages/')) { ecrire(sur(c.ancragesDir, nom.slice(9)), contenu); ecrits.ancrages++; }
  }
  // Une base restaurée n'a plus de journal WAL valide : on retire les résidus éventuels.
  for (const suffixe of ['-wal', '-shm']) fs.rmSync(c.dbPath + suffixe, { force: true });
  return { ecrits, manifeste: rapport.manifeste };
}
