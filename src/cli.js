#!/usr/bin/env node
// Ligne de commande de Registris.

import fs from 'node:fs';
import readline from 'node:readline/promises';

import { config, verifierPourProduction } from './config.js';
import { ouvrirDb, initialiserSchema } from './db.js';
import { diagnostiquerLdap } from './auth.js';
import { ROLES } from './roles.js';
import { creerUtilisateur } from './administration.js';
import { verifierChaine, verifierAncrages, ancrer, enregistrerControle } from './audit.js';
import { auditerCoffre } from './preuves.js';
import { sauvegarder, inspecter, restaurer } from './sauvegarde.js';
import { relancer } from './relances.js';
import { notifier } from './mailer.js';
import { creerApp, ecouter } from './serveur.js';
import { chargerDemo } from './demo.js';
import { entretien, planifierEntretien } from './entretien.js';
import { purger } from './conservation.js';

const USAGE = `Usage : registris <commande>

  init                              crée la base si besoin
  servir                            démarre le serveur web (défaut)
  utilisateur <login> <rôle> <nom>  crée un compte local (mot de passe demandé, ou REGISTRIS_MOT_DE_PASSE)
  ufs <fichier.csv>                 importe un référentiel d'UF (code;libelle)
  verifier                          vérifie la chaîne d'audit, ses ancrages et l'intégrité du coffre
  ancrer                            dépose l'empreinte de tête de la chaîne hors de la base
  relancer [--simuler]              relance les demandes en attente depuis plus de RELANCE_JOURS
  entretien                         demande la fermeture des accès temporaires échus (le serveur le fait seul chaque heure)
  purger [--simuler]                applique CONSERVATION_ANNEES : identité des agents partis effacée, pièces supprimées
  sauvegarder [dossier]             archive ZIP : base, pièces, logos, ancrages, manifeste
  restaurer <zip> [--verifier] [--forcer]
                                    contrôle une archive, ou la redéploie (application arrêtée)
  tester-ldap <login>               diagnostic pas à pas de la connexion à l'annuaire
  demo                              charge le jeu de démonstration (données fictives)`;

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
  initialiserSchema();
  try {
    creerUtilisateur('cli', { login, nom: nomParts.join(' ') || login, role, motDePasse });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
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
  enregistrerControle('cli', chaine);
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

async function relancerDemandes() {
  initialiserSchema();
  const simuler = drapeaux.has('--simuler');
  const r = await relancer({ simuler });

  if (!r.enRetard) {
    console.log(`Aucune demande en attente depuis plus de ${config.relanceJours} jours.`);
    return;
  }
  console.log(`${r.enRetard} demande(s) en attente depuis plus de ${config.relanceJours} jours, dont ${r.aRelancer} à relancer.`);
  if (!r.aRelancer) {
    console.log('Les autres ont déjà été relancées dans la période.');
    return;
  }
  for (const e of r.envois) {
    const etat = simuler ? 'à relancer'
      : e.envoye ? 'relance envoyée'
        : r.relaisConfigure ? 'ENVOI ÉCHOUÉ' : 'non envoyée';
    console.log(`  ${e.destinataire} · ${e.demandes.length} demande(s) · ${etat}`);
  }
  if (!simuler && !r.relaisConfigure && r.envois.length) {
    console.log('Aucun relais SMTP configuré (SMTP_HOST) : rien n\'a été envoyé, et aucune demande');
    console.log('n\'a été marquée comme relancée. Les retards restent visibles dans la file.');
  }
  if (r.orphelines.length) {
    console.log(`${r.orphelines.length} demande(s) sans destinataire : ni traitant, ni adresse de routage sur la catégorie.`);
    for (const h of r.orphelines) console.log(`  - n°${h.id} · ${h.app_libelle} · ${h.jours_attente} jours`);
    console.log('Assignez-les, ou renseignez une adresse dans « Administration, Notifications ».');
  }
  if (simuler) console.log('Simulation : aucun courriel envoyé, aucune date de relance écrite.');
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
  const serveur = ecouter(creerApp());
  planifierEntretien();
  serveur.on('listening', () => {
    console.log(`${config.nom} en écoute sur ${serveur.protocole}://${config.hote}:${config.port}`);
    console.log(`Authentification : ${config.authMode} · base : ${config.dbPath} · configuration : ${config.fichierConfig}`);
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
  case 'relancer':
    await relancerDemandes();
    break;
  case 'purger': {
    initialiserSchema();
    const b = purger('système', { simuler: drapeaux.has('--simuler') });
    console.log(`${b.simule ? 'Simulation : ' : ''}${b.agents} agent(s) anonymisé(s), ${b.pieces} pièce(s) supprimée(s), ${b.comptesAnnuaire} compte(s) de l'annuaire oublié(s), au-delà de ${b.annees} an(s).`);
    break;
  }
  case 'entretien': {
    initialiserSchema();
    const bilan = await entretien();
    console.log(`Accès temporaires échus : ${bilan.fermeturesEchues} fermeture(s) demandée(s).`);
    break;
  }
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
  case 'aide':
  case '--aide':
  case '--help':
    console.log(USAGE);
    break;
  default:
    console.error(`Commande inconnue : ${commande}\n\n${USAGE}`);
    process.exit(1);
}
