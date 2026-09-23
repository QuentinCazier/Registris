// Authentification locale (scrypt) ou LDAP (bind, rôle déduit des groupes) ; même objet de session.

import crypto from 'node:crypto';
import fs from 'node:fs';

import { config } from './config.js';
import { ouvrirDb } from './db.js';
import { roleDepuisGroupes } from './roles.js';
import { optionsClient, annuaire } from './annuaire.js';

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

function referentAppsLocales(login) {
  return ouvrirDb()
    .prepare('SELECT application_id FROM referent_applications WHERE login = ? COLLATE NOCASE')
    .all(login)
    .map((r) => r.application_id);
}

// `existe` permet de compter un mauvais mot de passe même quand le compte local sert de secours.
function connexionLocale(login, motDePasse) {
  const u = ouvrirDb().prepare('SELECT * FROM utilisateurs WHERE login = ? COLLATE NOCASE AND actif = 1').get(login);
  if (!u) return { utilisateur: null, existe: false };
  if (!verifierMotDePasse(motDePasse, u.sel, u.hash_mdp)) return { utilisateur: null, existe: true };
  return {
    existe: true,
    utilisateur: {
      login: u.login,
      nom: u.nom,
      matricule: u.matricule ?? '',
      email: u.email ?? '',
      role: u.role,
      source: 'local',
      referentApps: u.role === 'referent' ? referentAppsLocales(u.login) : [],
    },
  };
}

// --- Annuaire (bind LDAP) ------------------------------------------------------

export function optionsLdap(login, motDePasse) {
  const { ldap } = config;
  const options = {
    ldapOpts: optionsClient(),
    userPassword: motDePasse,
    userSearchBase: ldap.searchBase,
    usernameAttribute: ldap.loginAttr,
    username: login,
    groupsSearchBase: ldap.searchBase,
    groupClass: 'group',
    groupMemberAttribute: 'member',
  };
  if (ldap.bindDN) {
    options.adminDn = ldap.bindDN;
    options.adminPassword = ldap.bindPassword;
  } else if (ldap.userDn) {
    options.userDn = ldap.userDn.replace(/%s/g, login);
  }
  return options;
}

const interrogerParDefaut = async (options) => (await import('ldap-authentication')).authenticateResult(options);
let interroger = interrogerParDefaut;

// Pour les tests, qui n'ont pas d'annuaire.
export function remplacerInterrogationLdap(fn) {
  interroger = fn ?? interrogerParDefaut;
}

const CODE_SUCCES = 1;
const CODES_UTILISATEUR = [-1, -2, -3];
const RESEAU = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|EPIPE|timeout|timed out|certificate|TLS|SSL|socket|hang up|could not be found|missing required option/i;

// Codes « data » d'Active Directory dans un refus de bind.
const RAISONS_AD = {
  525: 'utilisateur introuvable',
  '52e': 'mot de passe incorrect',
  530: 'connexion interdite à cette heure',
  531: 'connexion interdite depuis ce poste',
  532: 'mot de passe expiré',
  533: 'compte désactivé',
  701: 'compte expiré',
  773: 'mot de passe à changer',
  775: 'compte verrouillé',
};

export function expliquerErreurLdap(message) {
  const m = /data ([0-9a-f]{3})\b/i.exec(String(message ?? ''));
  return m ? RAISONS_AD[m[1].toLowerCase()] ?? null : null;
}

const groupesDe = (utilisateur) =>
  [...(utilisateur.groups ?? []), ...[].concat(utilisateur.memberOf ?? [])]
    .map((g) => (typeof g === 'string' ? g : g?.cn ?? g?.dn ?? ''))
    .filter(Boolean);

// Toujours le même identifiant pour la même personne : celui de l'annuaire, en minuscules.
function identifiantCanonique(login, utilisateur) {
  const v = utilisateur[config.ldap.loginAttr];
  return String((Array.isArray(v) ? v[0] : v) || login).trim().toLowerCase();
}

function sessionDepuisLdap(login, utilisateur, role) {
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

// Un échec imputable à l'utilisateur compte pour l'anti-force-brute ; un annuaire injoignable, non.
function imputable(resultat) {
  const detail = String(resultat.messages?.at(-1) ?? '');
  return CODES_UTILISATEUR.includes(resultat.code) || (!config.ldap.bindDN && resultat.code === 0 && !RESEAU.test(detail));
}

// { utilisateur, motif: null | 'identifiants' | 'role' | 'injoignable', detail }
async function connexionLdap(login, motDePasse) {
  let resultat;
  try {
    resultat = await interroger(optionsLdap(login, motDePasse));
  } catch (e) {
    return { utilisateur: null, motif: 'injoignable', detail: e?.message ?? String(e) };
  }
  if (resultat.code !== CODE_SUCCES) {
    const detail = String(resultat.messages?.at(-1) ?? 'échec');
    return { utilisateur: null, motif: imputable(resultat) ? 'identifiants' : 'injoignable', detail };
  }
  const u = resultat.user;
  let groupes = groupesDe(u);
  // Les groupes imbriqués s'ajoutent aux groupes directs : un annuaire qui ignore la règle ne retire rien.
  if (config.ldap.groupesImbriques && config.ldap.bindDN) {
    try {
      groupes = [...new Set([...groupes, ...(await annuaire.groupesImbriques(u.dn))])];
    } catch (e) {
      return { utilisateur: null, motif: 'injoignable', detail: e?.message ?? String(e) };
    }
  }
  const role = roleDepuisGroupes(groupes, config.ldap.groupes);
  if (!role) return { utilisateur: null, motif: 'role', detail: groupes.join(' ; ') || 'aucun groupe' };
  return { utilisateur: sessionDepuisLdap(identifiantCanonique(login, u), u, role), motif: null, detail: '' };
}

// En mode annuaire, un compte local ne sert que si l'annuaire est injoignable.
export async function authentifierDetail(login, motDePasse) {
  if (!login || !motDePasse) return { utilisateur: null, motif: 'identifiants', detail: '' };
  const l = String(login).trim();
  if (config.authMode !== 'ldap') {
    const { utilisateur } = connexionLocale(l, motDePasse);
    return { utilisateur, motif: utilisateur ? null : 'identifiants', detail: '' };
  }
  const r = await connexionLdap(l, motDePasse);
  if (r.utilisateur || r.motif !== 'injoignable') return r;
  const local = connexionLocale(l, motDePasse);
  if (local.utilisateur) return { utilisateur: { ...local.utilisateur, secours: true }, motif: null, detail: r.detail };
  if (local.existe) return { utilisateur: null, motif: 'identifiants', detail: r.detail };
  return r;
}

export async function authentifier(login, motDePasse) {
  return (await authentifierDetail(login, motDePasse)).utilisateur;
}

// Ne lève pas : chaque étape porte son résultat, pour la commande `tester-ldap`.
export async function diagnostiquerLdap(login, motDePasse) {
  const { ldap } = config;
  const etapes = [];
  const etape = (nom, ok, detail = '') => etapes.push({ etape: nom, ok, detail });

  etape('configuration : LDAP_URL', Boolean(ldap.url), ldap.url || 'vide');
  etape('configuration : base de recherche', Boolean(ldap.searchBase), ldap.searchBase || 'vide (LDAP_SEARCH_BASE ou LDAP_BASE_DN)');
  if (ldap.bindDN) {
    etape('configuration : compte de service', true, `${ldap.bindDN}${ldap.bindPassword ? '' : ' (mot de passe vide)'}`);
  } else if (ldap.userDn) {
    etape('configuration : bind direct', ldap.userDn.includes('%s'),
      `LDAP_USER_DN = ${ldap.userDn}${ldap.userDn.includes('%s') ? '' : ' (doit contenir %s)'} ; sans compte de service, ni groupes imbriqués ni recherche d'agents`);
  } else {
    etape('configuration : compte de service ou bind direct', false, 'ni LDAP_BIND_DN ni LDAP_USER_DN : aucune connexion possible');
  }
  const caPresent = !ldap.caCert || fs.existsSync(ldap.caCert);
  etape('configuration : certificat', caPresent, ldap.caCert
    ? `LDAP_CA_CERT = ${ldap.caCert}${caPresent ? '' : ' (fichier introuvable)'}`
    : 'aucun CA déclaré : le certificat doit être reconnu par le système (NODE_EXTRA_CA_CERTS ou --use-system-ca)');
  const groupesConfigures = Object.entries(ldap.groupes).filter(([, g]) => g);
  etape('configuration : groupes de rôles', groupesConfigures.length > 0,
    (groupesConfigures.length ? groupesConfigures.map(([r, g]) => `${r} = ${g}`).join(' ; ') : 'aucun groupe défini, aucun rôle ne pourra être attribué')
      + ` ; ${ldap.groupesImbriques ? 'groupes imbriqués résolus' : 'appartenance directe seulement'}`);
  if (!ldap.url || (!ldap.bindDN && !ldap.userDn) || !caPresent) return { etapes, session: null };

  let resultat;
  try {
    resultat = await interroger(optionsLdap(login, motDePasse));
  } catch (e) {
    etape("connexion à l'annuaire", false, `${e?.message ?? e}${e?.code ? ` (${e.code})` : ''}`);
    return { etapes, session: null };
  }
  if (resultat.code !== CODE_SUCCES) {
    const detail = String(resultat.messages?.at(-1) ?? '');
    const raison = expliquerErreurLdap(detail);
    etape(imputable(resultat) ? "authentification de l'utilisateur" : "connexion à l'annuaire", false,
      `${raison ? `${raison} : ` : ''}${detail} (code ${resultat.code})`);
    return { etapes, session: null };
  }
  const utilisateur = resultat.user;
  etape("bind et recherche de l'utilisateur", true, `trouvé (${ldap.loginAttr} = ${login}), DN ${utilisateur.dn}`);

  const attributs = ['displayName', 'cn', 'mail', 'userPrincipalName', 'employeeNumber', 'employeeID']
    .filter((a) => utilisateur[a] !== undefined && utilisateur[a] !== '')
    .map((a) => `${a} = ${utilisateur[a]}`);
  etape('attributs lus', attributs.length > 0, attributs.join(' ; ') || 'aucun des attributs attendus (displayName, mail, employeeNumber…)');

  let groupes = groupesDe(utilisateur);
  etape("groupes directs de l'utilisateur", groupes.length > 0, groupes.length
    ? groupes.join(' ; ')
    : "aucun groupe : soit l'utilisateur n'en a pas, soit la base de recherche ou les droits du compte de service ne permettent pas de les lire");
  if (ldap.groupesImbriques && ldap.bindDN) {
    try {
      const imbriques = await annuaire.groupesImbriques(utilisateur.dn);
      groupes = [...new Set([...groupes, ...imbriques])];
      etape('groupes par la règle en chaîne', true, imbriques.length
        ? imbriques.join(' ; ')
        : "aucun : l'annuaire ignore peut-être la règle en chaîne, les groupes directs restent pris en compte");
    } catch (e) {
      etape('groupes par la règle en chaîne', false, e?.message ?? String(e));
    }
  }

  const role = roleDepuisGroupes(groupes, ldap.groupes);
  etape('rôle déduit', Boolean(role), role ?? "aucun : l'utilisateur n'appartient à aucun groupe configuré, la connexion serait refusée");
  if (!role) return { etapes, session: null };

  const session = sessionDepuisLdap(identifiantCanonique(login, utilisateur), utilisateur, role);
  etape('identifiant de session', true, session.login);
  if (role === 'referent') {
    etape('périmètre du référent', true, session.referentApps === 'ALL'
      ? "toutes les applications (aucun périmètre déclaré dans l'administration)"
      : `${session.referentApps.length} application(s)`);
  }
  return { etapes, session };
}
