// Configuration : environnement et fichier .env, lu sans dépendance.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (v, defaut = false) =>
  v === undefined || v === '' ? defaut : ['1', 'true', 'oui', 'yes'].includes(String(v).toLowerCase());

// Les guillemets qui entourent une valeur sont retirés, comme le font les autres lecteurs de .env.
export function analyserDotEnv(texte) {
  const valeurs = {};
  for (const ligne of String(texte ?? '').split(/\r?\n/)) {
    const trim = ligne.trim();
    if (!trim || trim.startsWith('#')) continue;
    const egal = trim.indexOf('=');
    if (egal === -1) continue;
    const brut = trim.slice(egal + 1).trim();
    valeurs[trim.slice(0, egal).trim()] = /^(["']).*\1$/.test(brut) ? brut.slice(1, -1) : brut;
  }
  return valeurs;
}

function chargerDotEnv(racine) {
  const chemin = path.join(racine, '.env');
  if (!fs.existsSync(chemin)) return;
  for (const [cle, valeur] of Object.entries(analyserDotEnv(fs.readFileSync(chemin, 'utf8')))) {
    if (!(cle in process.env)) process.env[cle] = valeur;
  }
}

chargerDotEnv(RACINE);

const resoudre = (p) => (path.isAbsolute(p) ? p : path.join(RACINE, p));

export const SECRET_PAR_DEFAUT = 'dev-secret-non-securise';

const COULEUR_PAR_DEFAUT = '#12558f';
const couleurValide = (v) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v ?? '')) ? String(v) : null);

export const config = {
  nom: 'Registris',
  etablissement: process.env.NOM_ETABLISSEMENT ?? '',
  // ui.js en dérive les nuances et la couleur de texte.
  couleurAccent: couleurValide(process.env.COULEUR_ACCENT) ?? COULEUR_PAR_DEFAUT,

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

  // Sert aux liens des relances ; vide, le courriel décrit la demande sans lien.
  urlPublique: String(process.env.APP_URL ?? '').replace(/\/+$/, ''),

  // Seuil en jours au-delà duquel une demande est en retard et relancée.
  relanceJours: Math.max(1, Number(process.env.RELANCE_JOURS ?? 7)),

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
    // Sans compte de service : modèle du nom de bind, %s remplacé par l'identifiant saisi.
    userDn: process.env.LDAP_USER_DN ?? '',
    caCert: process.env.LDAP_CA_CERT ? resoudre(process.env.LDAP_CA_CERT) : '',
    timeoutMs: Math.max(1000, Number(process.env.LDAP_TIMEOUT_MS) || 5000),
    groupesImbriques: bool(process.env.LDAP_GROUPES_IMBRIQUES, false),
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

// Renvoie les avertissements ; lève si un réglage rend le déploiement dangereux.
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
  if (config.authMode === 'ldap') {
    const { ldap } = config;
    if (!ldap.url) throw new Error('AUTH_MODE=ldap mais LDAP_URL est vide.');
    if (!ldap.bindDN && !ldap.userDn) {
      throw new Error('AUTH_MODE=ldap : renseignez LDAP_BIND_DN (compte de service) ou LDAP_USER_DN (bind direct, avec %s).');
    }
    if (ldap.userDn && !ldap.userDn.includes('%s')) throw new Error("LDAP_USER_DN doit contenir %s, remplacé par l'identifiant saisi.");
    if (ldap.caCert && !fs.existsSync(ldap.caCert)) throw new Error(`LDAP_CA_CERT introuvable : ${ldap.caCert}`);
    if (!ldap.url.startsWith('ldaps://')) avertissements.push('LDAP_URL sans ldaps:// : les mots de passe transiteraient en clair.');
  }
  if (!['local', 'ldap'].includes(config.authMode)) {
    throw new Error(`AUTH_MODE inconnu : « ${config.authMode} » (attendu : local ou ldap).`);
  }
  return avertissements;
}
