/**
 * Configuration de Registris.
 *
 * Tout vient de l'environnement (et d'un fichier `.env` à la racine du projet, lu à
 * la main pour ne pas embarquer de dépendance). Les valeurs de repli sont sûres
 * pour un poste de développement et volontairement bruyantes en production :
 * `verifierPourProduction()` refuse de démarrer avec le secret de session par défaut.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (v, defaut = false) =>
  v === undefined || v === '' ? defaut : ['1', 'true', 'oui', 'yes'].includes(String(v).toLowerCase());

function chargerDotEnv(racine) {
  const chemin = path.join(racine, '.env');
  if (!fs.existsSync(chemin)) return;
  for (const ligne of fs.readFileSync(chemin, 'utf8').split(/\r?\n/)) {
    const trim = ligne.trim();
    if (!trim || trim.startsWith('#')) continue;
    const egal = trim.indexOf('=');
    if (egal === -1) continue;
    const cle = trim.slice(0, egal).trim();
    const valeur = trim.slice(egal + 1).trim();
    if (!(cle in process.env)) process.env[cle] = valeur;
  }
}

chargerDotEnv(RACINE);

const resoudre = (p) => (path.isAbsolute(p) ? p : path.join(RACINE, p));

export const SECRET_PAR_DEFAUT = 'dev-secret-non-securise';

export const config = {
  nom: 'Registris',
  etablissement: process.env.NOM_ETABLISSEMENT ?? '',
  themeColor: '#1b4977',

  port: Number(process.env.PORT ?? 3000),
  hote: process.env.HOTE ?? '127.0.0.1',
  sessionSecret: process.env.SESSION_SECRET ?? SECRET_PAR_DEFAUT,
  secureCookie: bool(process.env.SECURE_COOKIE, false),
  trustProxy: bool(process.env.TRUST_PROXY, false),

  dbPath: resoudre(process.env.DB_PATH ?? './data/registris.db'),
  preuvesDir: resoudre(process.env.PREUVES_DIR ?? './data/preuves'),
  logosDir: resoudre(process.env.LOGOS_DIR ?? './data/logos'),
  publicDir: resoudre(process.env.PUBLIC_DIR ?? './public'),
  // Ancrages de la chaîne d'audit (fichiers) et destinataire optionnel des ancrages par courriel.
  ancragesDir: resoudre(process.env.ANCRAGES_DIR ?? './data/ancrages'),
  ancrageEmail: process.env.ANCRAGE_EMAIL ?? '',
  // Dossier par défaut des archives de sauvegarde.
  sauvegardesDir: resoudre(process.env.SAUVEGARDES_DIR ?? './sauvegardes'),

  // Taille maximale d'une pièce de preuve téléversée (octets).
  tailleMaxPreuve: Number(process.env.TAILLE_MAX_PREUVE ?? 25 * 1024 * 1024),

  authMode: (process.env.AUTH_MODE ?? 'local').toLowerCase(),
  ldap: {
    url: process.env.LDAP_URL ?? '',
    baseDN: process.env.LDAP_BASE_DN ?? '',
    loginAttr: process.env.LDAP_LOGIN_ATTR ?? 'sAMAccountName',
    bindDN: process.env.LDAP_BIND_DN ?? '',
    bindPassword: process.env.LDAP_BIND_PASSWORD ?? '',
    searchBase: process.env.LDAP_SEARCH_BASE ?? process.env.LDAP_BASE_DN ?? '',
    groupes: {
      admin: process.env.LDAP_GROUPE_ADMIN ?? '',
      controleur: process.env.LDAP_GROUPE_CONTROLEUR ?? '',
      referent: process.env.LDAP_GROUPE_REFERENT ?? '',
      utilisateur: process.env.LDAP_GROUPE_UTILISATEUR ?? '',
    },
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 25),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'registris@localhost',
    secure: bool(process.env.SMTP_SECURE, false),
    actif: Boolean(process.env.SMTP_HOST),
  },
};

/**
 * Garde-fous de mise en production. Renvoie la liste des avertissements ; lève
 * une erreur si un réglage rend le déploiement dangereux (secret par défaut).
 */
export function verifierPourProduction({ production = process.env.NODE_ENV === 'production' } = {}) {
  const avertissements = [];
  if (config.sessionSecret === SECRET_PAR_DEFAUT) {
    const msg = 'SESSION_SECRET non défini : générez une valeur longue et aléatoire dans .env.';
    if (production) throw new Error(msg);
    avertissements.push(msg);
  }
  if (!config.secureCookie) {
    avertissements.push('SECURE_COOKIE=false : à passer à true derrière un reverse-proxy HTTPS.');
  }
  if (config.authMode === 'ldap' && !config.ldap.url) {
    throw new Error('AUTH_MODE=ldap mais LDAP_URL est vide.');
  }
  if (!['local', 'ldap'].includes(config.authMode)) {
    throw new Error(`AUTH_MODE inconnu : « ${config.authMode} » (attendu : local ou ldap).`);
  }
  return avertissements;
}
