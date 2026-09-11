#!/usr/bin/env node
/**
 * Ligne de commande de Registris.
 *
 *   registris init                       crée la base (schéma) si besoin
 *   registris servir                     démarre le serveur web
 *   registris utilisateur <login> <role> <nom…>
 *                                                crée un compte local (mot de passe demandé au clavier,
 *                                                ou variable REGISTRIS_MOT_DE_PASSE)
 *   registris ufs <fichier.csv>          importe un référentiel d'UF (code;libelle)
 *   registris verifier                   vérifie la chaîne d'audit, ses ancrages et l'intégrité du coffre
 *   registris ancrer                     dépose l'empreinte de tête de la chaîne hors de la base (fichier, courriel)
 *   registris sauvegarder [dossier]      archive ZIP : base, pièces, logos, ancrages, manifeste
 *   registris restaurer <zip> [--verifier] [--forcer]
 *                                                contrôle une archive, ou la redéploie (application arrêtée)
 *   registris tester-ldap <login>        diagnostic pas à pas de la connexion à l'annuaire
 *   registris demo                       base de démonstration (données fictives)
 */

import fs from 'node:fs';
import readline from 'node:readline/promises';

import { config, verifierPourProduction } from './config.js';
import { ouvrirDb, initialiserSchema } from './db.js';
import { hacherMotDePasse, diagnostiquerLdap } from './auth.js';
import { ROLES } from './roles.js';
import { verifierChaine, verifierAncrages, ancrer } from './audit.js';
import { auditerCoffre } from './preuves.js';
import { sauvegarder, inspecter, restaurer } from './sauvegarde.js';
import { notifier } from './mailer.js';
import { creerApp } from './serveur.js';
import { chargerDemo } from './demo.js';

const [, , commande, ...argsBruts] = process.argv;
const drapeaux = new Set(argsBruts.filter((a) => a.startsWith('--')));
const args = argsBruts.filter((a) => !a.startsWith('--'));

function init() {
  initialiserSchema();
  console.log(`Base prête : ${config.dbPath}`);
}

async function lireMotDePasse() {
  if (process.env.REGISTRIS_MOT_DE_PASSE) return process.env.REGISTRIS_MOT_DE_PASSE;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const mdp = await rl.question('Mot de passe (12 caractères minimum) : ');
  rl.close();
  return mdp;
}

async function creerCompte() {
  const [login, role, ...nomParts] = args;
  if (!login || !role) {
    console.error('Usage : registris utilisateur <login> <role> <nom…>');
    console.error(`Rôles : ${ROLES.join(', ')}`);
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Rôle inconnu : ${role}. Rôles : ${ROLES.join(', ')}`);
    process.exit(1);
  }
  const motDePasse = await lireMotDePasse();
  if (String(motDePasse).length < 12) {
    console.error('Mot de passe trop court (12 caractères minimum).');
    process.exit(1);
  }
  initialiserSchema();
  const { sel, hash } = hacherMotDePasse(motDePasse);
  ouvrirDb()
    .prepare('INSERT INTO utilisateurs (login, nom, role, sel, hash_mdp) VALUES (?, ?, ?, ?, ?)')
    .run(login, nomParts.join(' ') || login, role, sel, hash);
  console.log(`Compte « ${login} » (${role}) créé.`);
}

function importerUfs() {
  const [fichier] = args;
  if (!fichier || !fs.existsSync(fichier)) {
    console.error('Usage : registris ufs <fichier.csv>   (colonnes : code;libelle, une UF par ligne)');
    process.exit(1);
  }
  initialiserSchema();
  const db = ouvrirDb();
  const ins = db.prepare('INSERT OR IGNORE INTO ufs (code, libelle) VALUES (?, ?)');
  let n = 0;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const t = ligne.trim();
    if (!t || t.startsWith('#') || /^code\s*;/i.test(t)) continue;
    const [code, ...reste] = t.split(';');
    const libelle = reste.join(';').trim();
    if (!code?.trim() || !libelle) continue;
    n += ins.run(code.trim(), libelle).changes;
  }
  console.log(`${n} UF importée(s).`);
}

function verifier() {
  initialiserSchema();
  const chaine = verifierChaine();
  const ancrages = verifierAncrages();
  const coffre = auditerCoffre();
  console.log(chaine.valide ? `Chaîne d'audit intègre (${chaine.entrees} entrées).` : `RUPTURE de la chaîne d'audit à l'entrée n°${chaine.rupture} (${chaine.raison}).`);
  if (!ancrages.ancrages && !ancrages.fichiers) console.log('Aucun ancrage : lancez « registris ancrer » régulièrement.');
  else if (ancrages.valide) console.log(`Ancrages cohérents (${ancrages.ancrages} en base, ${ancrages.fichiers} fichier(s), dernier le ${ancrages.dernier?.horodatage ?? '?'}).`);
  else {
    console.log(`${ancrages.anomalies.length} anomalie(s) d'ancrage :`);
    for (const a of ancrages.anomalies) console.log(`  - ${a.ancrage} (${a.origine}) · ${a.raison}`);
  }
  console.log(coffre.anomalies.length ? `${coffre.anomalies.length} pièce(s) altérée(s) ou manquante(s) sur ${coffre.total} :` : `Coffre intègre (${coffre.total} pièces).`);
  for (const a of coffre.anomalies) console.log(`  - habilitation n°${a.habilitation_id} · ${a.nom_origine} · ${a.raison}`);
  process.exit(chaine.valide && ancrages.valide && !coffre.anomalies.length ? 0 : 2);
}

async function ancrerChaine() {
  initialiserSchema();
  const a = ancrer({ acteur: 'cli' });
  console.log(`Ancrage n°${a.id} : ${a.entrees} entrées, tête n°${a.dernier_id}, empreinte ${a.hash_tete.slice(0, 16)}…`);
  console.log(`Fichier : ${a.fichier}`);
  if (config.ancrageEmail) {
    const envoye = await notifier({ to: config.ancrageEmail, sujet: `Ancrage de la chaîne d'audit du ${a.horodatage.slice(0, 10)}`, texte: a.texte });
    console.log(envoye ? `Courriel remis au relais pour ${config.ancrageEmail}.` : `Courriel non envoyé (relais SMTP indisponible ou non configuré).`);
  }
  console.log('Conservez le fichier ou le courriel hors du serveur : ils permettent de détecter une base remplacée.');
}

async function sauvegarderBase() {
  initialiserSchema();
  const destination = args[0] ?? config.sauvegardesDir;
  const { fichier, taille, manifeste } = await sauvegarder({ destination, acteur: 'cli' });
  const c = manifeste.compteurs;
  console.log(`Sauvegarde écrite : ${fichier} (${(taille / 1e6).toFixed(1)} Mo)`);
  console.log(`${c.habilitations} habilitations, ${c.preuves} pièces, ${c.journal} entrées de journal, ${manifeste.fichiers.length} fichiers ; chaîne ${manifeste.chaine.valide ? 'intègre' : 'ROMPUE'}.`);
  console.log('Copiez cette archive hors du serveur. « registris restaurer <zip> --verifier » la contrôle sans rien écrire.');
}

function restaurerBase() {
  const [zip] = args;
  if (!zip || !fs.existsSync(zip)) {
    console.error('Usage : registris restaurer <archive.zip> [--verifier] [--forcer]');
    process.exit(1);
  }
  if (drapeaux.has('--verifier')) {
    const r = inspecter(zip);
    const m = r.manifeste;
    console.log(`Sauvegarde ${m.application} ${m.version} du ${m.date}${m.etablissement ? ` (${m.etablissement})` : ''}`);
    console.log(`${m.compteurs.habilitations} habilitations, ${m.compteurs.preuves} pièces, ${m.compteurs.journal} entrées de journal, chaîne ${m.chaine.valide ? 'intègre' : 'ROMPUE'} au moment de la sauvegarde.`);
    const echecs = r.verifications.filter((v) => !v.ok);
    console.log(echecs.length ? `${echecs.length} fichier(s) en défaut :` : `${r.verifications.length} fichiers vérifiés, tous conformes au manifeste.`);
    for (const e of echecs) console.log(`  - ${e.chemin} · ${e.raison}`);
    process.exit(echecs.length ? 2 : 0);
  }
  try {
    const { ecrits, manifeste } = restaurer(zip, { forcer: drapeaux.has('--forcer') });
    console.log(`Restauré depuis la sauvegarde du ${manifeste.date} : base, ${ecrits.preuves} pièce(s), ${ecrits.logos} logo(s), ${ecrits.ancrages} ancrage(s).`);
    console.log('Lancez « registris verifier » avant de redémarrer le service.');
  } catch (e) {
    console.error(`Restauration refusée : ${e.message}`);
    process.exit(2);
  }
}

async function testerLdap() {
  const [login] = args;
  if (!login) {
    console.error('Usage : registris tester-ldap <login>   (le mot de passe est demandé au clavier, ou REGISTRIS_MOT_DE_PASSE)');
    process.exit(1);
  }
  initialiserSchema();
  const motDePasse = await lireMotDePasse();
  const { etapes, session } = await diagnostiquerLdap(login, motDePasse);
  for (const e of etapes) console.log(`${e.ok ? 'OK    ' : 'ECHEC '} ${e.etape}${e.detail ? ` : ${e.detail}` : ''}`);
  console.log(session ? `Connexion possible : ${session.nom} (${session.role}).` : 'Connexion impossible avec cette configuration.');
  process.exit(session ? 0 : 2);
}

function servir() {
  let avertissements;
  try {
    avertissements = verifierPourProduction();
  } catch (e) {
    console.error(`Démarrage refusé : ${e.message}`);
    process.exit(1);
  }
  for (const a of avertissements) console.warn(`Attention : ${a}`);
  initialiserSchema();
  const app = creerApp();
  app.listen(config.port, config.hote, () => {
    console.log(`${config.nom} en écoute sur http://${config.hote}:${config.port}`);
    console.log(`Authentification : ${config.authMode} · base : ${config.dbPath}`);
  });
}

switch (commande) {
  case 'init':
    init();
    break;
  case 'servir':
  case undefined:
    servir();
    break;
  case 'utilisateur':
    await creerCompte();
    break;
  case 'ufs':
    importerUfs();
    break;
  case 'verifier':
    verifier();
    break;
  case 'ancrer':
    await ancrerChaine();
    break;
  case 'sauvegarder':
    await sauvegarderBase();
    break;
  case 'restaurer':
    restaurerBase();
    break;
  case 'tester-ldap':
    await testerLdap();
    break;
  case 'demo':
    initialiserSchema();
    chargerDemo();
    break;
  default:
    console.error(`Commande inconnue : ${commande}`);
    console.error('Commandes : init | servir | utilisateur | ufs | verifier | ancrer | sauvegarder | restaurer | tester-ldap | demo');
    process.exit(1);
}
