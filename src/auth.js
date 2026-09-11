/**
 * Authentification. Deux modes, choisis par AUTH_MODE :
 *
 *   local : comptes de la table `utilisateurs`, mot de passe vérifié par scrypt ;
 *   ldap  : bind LDAPS contre l'Active Directory de l'établissement. Le mot de passe
 *           n'est jamais stocké : le contrôleur de domaine le valide, puis on lit les
 *           groupes de l'agent pour en déduire son rôle applicatif.
 *
 * Dans les deux cas on renvoie l'objet mis en session : login, nom, matricule,
 * email, rôle, source, et le périmètre du référent (`referentApps`).
 */

import crypto from 'node:crypto';

import { config } from './config.js';
import { ouvrirDb } from './db.js';
import { roleDepuisGroupes } from './roles.js';

// --- Mots de passe locaux (scrypt) -----------------------------------------

export function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(motDePasse, sel, 64).toString('hex');
  return { sel, hash };
}

function verifierMotDePasse(motDePasse, sel, hashAttendu) {
  const hash = crypto.scryptSync(motDePasse, sel, 64);
  const attendu = Buffer.from(hashAttendu, 'hex');
  return hash.length === attendu.length && crypto.timingSafeEqual(hash, attendu);
}

/** Périmètre d'un référent en mode local : les applications dont il est référent. */
function referentAppsLocales(login) {
  return ouvrirDb()
    .prepare('SELECT application_id FROM referent_applications WHERE login = ?')
    .all(login)
    .map((r) => r.application_id);
}

async function connexionLocale(login, motDePasse) {
  const u = ouvrirDb().prepare('SELECT * FROM utilisateurs WHERE login = ? AND actif = 1').get(login);
  if (!u) return null;
  if (!verifierMotDePasse(motDePasse, u.sel, u.hash_mdp)) return null;
  return {
    login: u.login,
    nom: u.nom,
    matricule: u.matricule ?? '',
    email: u.email ?? '',
    role: u.role,
    source: 'local',
    referentApps: u.role === 'referent' ? referentAppsLocales(u.login) : [],
  };
}

// --- Active Directory (bind LDAPS) ------------------------------------------

function optionsLdap(login, motDePasse) {
  const { ldap } = config;
  const options = {
    ldapOpts: { url: ldap.url },
    userPassword: motDePasse,
    userSearchBase: ldap.searchBase,
    usernameAttribute: ldap.loginAttr,
    username: login,
    groupsSearchBase: ldap.searchBase,
    groupClass: 'group',
    groupMemberAttribute: 'member',
  };
  // Compte de service en lecture seule pour retrouver l'utilisateur avant le bind.
  if (ldap.bindDN) {
    options.adminDn = ldap.bindDN;
    options.adminPassword = ldap.bindPassword;
  }
  return options;
}

/** Bind et lecture de l'utilisateur ; lève une erreur explicite en cas d'échec. */
async function interrogerLdap(login, motDePasse) {
  // Import différé : la dépendance n'est chargée qu'en mode LDAP.
  const { authenticate } = await import('ldap-authentication');
  return authenticate(optionsLdap(login, motDePasse));
}

const groupesDe = (utilisateur) =>
  (utilisateur.groups ?? utilisateur.memberOf ?? [])
    .map((g) => (typeof g === 'string' ? g : g?.cn ?? g?.dn ?? ''))
    .filter(Boolean);

function sessionDepuisLdap(login, utilisateur, role) {
  // Le périmètre fin d'un référent peut être défini dans l'admin (même en LDAP) ;
  // sans périmètre déclaré, il couvre toutes les applications.
  const perimetre = role === 'referent' ? referentAppsLocales(login) : [];
  return {
    login,
    nom: utilisateur.displayName ?? utilisateur.cn ?? login,
    matricule: utilisateur.employeeNumber ?? utilisateur.employeeID ?? '',
    email: utilisateur.mail ?? utilisateur.userPrincipalName ?? '',
    role,
    source: 'ldap',
    referentApps: role === 'referent' && perimetre.length === 0 ? 'ALL' : perimetre,
  };
}

async function connexionLdap(login, motDePasse) {
  let utilisateur;
  try {
    utilisateur = await interrogerLdap(login, motDePasse);
  } catch {
    return null; // identifiants invalides ou annuaire injoignable
  }
  if (!utilisateur) return null;
  const role = roleDepuisGroupes(groupesDe(utilisateur), config.ldap.groupes);
  if (!role) return null; // authentifié mais aucun rôle attribué -> refus
  return sessionDepuisLdap(login, utilisateur, role);
}

/**
 * Diagnostic pas à pas d'une connexion à l'annuaire, pour la ligne de commande
 * `tester-ldap`. Ne lève pas : chaque étape porte son résultat et son détail.
 * @returns {Promise<{ etapes: {etape: string, ok: boolean, detail: string}[], session: object|null }>}
 */
export async function diagnostiquerLdap(login, motDePasse) {
  const { ldap } = config;
  const etapes = [];
  const etape = (nom, ok, detail = '') => etapes.push({ etape: nom, ok, detail });

  etape('configuration : LDAP_URL', Boolean(ldap.url), ldap.url || 'vide');
  etape('configuration : base de recherche', Boolean(ldap.searchBase), ldap.searchBase || 'vide (LDAP_SEARCH_BASE ou LDAP_BASE_DN)');
  etape('configuration : compte de service', Boolean(ldap.bindDN), ldap.bindDN ? `${ldap.bindDN}${ldap.bindPassword ? '' : ' (mot de passe vide)'}` : 'aucun : le bind se fera directement avec l\'utilisateur');
  const groupesConfigures = Object.entries(ldap.groupes).filter(([, g]) => g);
  etape('configuration : groupes de rôles', groupesConfigures.length > 0,
    groupesConfigures.length ? groupesConfigures.map(([r, g]) => `${r} = ${g}`).join(' ; ') : 'aucun groupe défini, aucun rôle ne pourra être attribué');
  if (!ldap.url) return { etapes, session: null };

  let utilisateur;
  try {
    utilisateur = await interrogerLdap(login, motDePasse);
    etape('bind et recherche de l\'utilisateur', Boolean(utilisateur), utilisateur ? `trouvé (attribut ${ldap.loginAttr} = ${login})` : 'aucun utilisateur renvoyé');
  } catch (e) {
    etape('bind et recherche de l\'utilisateur', false, `${e?.message ?? e}${e?.code ? ` (code ${e.code})` : ''}`);
    return { etapes, session: null };
  }
  if (!utilisateur) return { etapes, session: null };

  const attributs = ['displayName', 'cn', 'mail', 'userPrincipalName', 'employeeNumber', 'employeeID']
    .filter((a) => utilisateur[a] !== undefined && utilisateur[a] !== '')
    .map((a) => `${a} = ${utilisateur[a]}`);
  etape('attributs lus', attributs.length > 0, attributs.join(' ; ') || 'aucun des attributs attendus (displayName, mail, employeeNumber…)');

  const groupes = groupesDe(utilisateur);
  etape('groupes de l\'utilisateur', groupes.length > 0, groupes.length ? groupes.join(' ; ') : 'aucun groupe lu : vérifiez groupsSearchBase et les droits du compte de service');

  const role = roleDepuisGroupes(groupes, ldap.groupes);
  etape('rôle déduit', Boolean(role), role ?? 'aucun : l\'utilisateur n\'appartient à aucun groupe configuré, la connexion serait refusée');
  if (!role) return { etapes, session: null };

  const session = sessionDepuisLdap(login, utilisateur, role);
  if (role === 'referent') {
    etape('périmètre du référent', true, session.referentApps === 'ALL' ? 'toutes les applications (aucun périmètre déclaré dans l\'administration)' : `${session.referentApps.length} application(s)`);
  }
  return { etapes, session };
}

/** Point d'entrée unique. Renvoie l'objet utilisateur de session, ou null. */
export async function authentifier(login, motDePasse) {
  if (!login || !motDePasse) return null;
  const l = String(login).trim();
  return config.authMode === 'ldap' ? connexionLdap(l, motDePasse) : connexionLocale(l, motDePasse);
}
