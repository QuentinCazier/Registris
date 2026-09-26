// Accès direct à l'annuaire avec le compte de service : groupes imbriqués et recherche d'agents.

import fs from 'node:fs';

import { config } from './config.js';

let caCache;

// Options communes aux clients LDAP (ldapts), certificat d'autorité compris.
export function optionsClient() {
  const { ldap } = config;
  const options = { url: ldap.url, connectTimeout: ldap.timeoutMs, timeout: ldap.timeoutMs };
  if (ldap.caCert && ldap.url.startsWith('ldaps://')) {
    caCache ??= fs.readFileSync(ldap.caCert);
    options.tlsOptions = { ca: [caCache] };
  }
  return options;
}

async function avecCompteDeService(fn) {
  const { ldap } = config;
  if (!ldap.bindDN) throw new Error('Cette fonction exige un compte de service (LDAP_BIND_DN).');
  const { Client } = await import('ldapts');
  const client = new Client(optionsClient());
  try {
    await client.bind(ldap.bindDN, ldap.bindPassword);
    return await fn(client);
  } finally {
    try {
      await client.unbind();
    } catch {
      /* socket déjà fermé */
    }
  }
}

const valeur = (v) => String((Array.isArray(v) ? v[0] : v) ?? '').trim();

// Règle LDAP_MATCHING_RULE_IN_CHAIN : les groupes de l'utilisateur, directs ou par imbrication.
// Filtres construits en objets : l'analyseur de texte de ldapts tronque une valeur contenant « = ».
async function groupesImbriquesLdap(dnUtilisateur) {
  const { AndFilter, EqualityFilter, ExtensibleFilter } = await import('ldapts');
  return avecCompteDeService(async (client) => {
    const { searchEntries } = await client.search(config.ldap.searchBase, {
      scope: 'sub',
      filter: new AndFilter({
        filters: [
          new EqualityFilter({ attribute: 'objectClass', value: 'group' }),
          new ExtensibleFilter({ matchType: 'member', rule: '1.2.840.113556.1.4.1941', value: dnUtilisateur }),
        ],
      }),
      attributes: ['cn'],
    });
    return searchEntries.map((g) => valeur(g.cn) || g.dn);
  });
}

// Un agent par son matricule (employeeNumber ou employeeID), pour préremplir une demande.
async function chercherAgentLdap(matricule) {
  const m = valeur(matricule);
  if (!m) return null;
  const { OrFilter, EqualityFilter } = await import('ldapts');
  return avecCompteDeService(async (client) => {
    const { searchEntries } = await client.search(config.ldap.searchBase, {
      scope: 'sub',
      filter: new OrFilter({
        filters: [
          new EqualityFilter({ attribute: 'employeeNumber', value: m }),
          new EqualityFilter({ attribute: 'employeeID', value: m }),
        ],
      }),
      attributes: ['sAMAccountName', 'givenName', 'sn', 'displayName', 'mail', 'employeeNumber', 'employeeID'],
      sizeLimit: 2,
    });
    if (searchEntries.length !== 1) return null;
    const e = searchEntries[0];
    const affiche = valeur(e.displayName);
    return {
      matricule: valeur(e.employeeNumber) || valeur(e.employeeID) || m,
      nom: valeur(e.sn) || affiche.split(/\s+/).slice(1).join(' ') || affiche,
      prenom: valeur(e.givenName) || (valeur(e.sn) ? '' : affiche.split(/\s+/)[0]),
      email: valeur(e.mail),
      login: valeur(e.sAMAccountName).toLowerCase(),
    };
  });
}

// État des comptes par matricule, par lots : trouvé, désactivé (bit ACCOUNTDISABLE de userAccountControl).
async function etatComptesLdap(matricules) {
  const liste = [...new Set(matricules.map(valeur).filter(Boolean))];
  const etats = new Map();
  if (!liste.length) return etats;
  const { OrFilter, EqualityFilter } = await import('ldapts');
  return avecCompteDeService(async (client) => {
    for (let i = 0; i < liste.length; i += 50) {
      const lot = liste.slice(i, i + 50);
      const { searchEntries } = await client.search(config.ldap.searchBase, {
        scope: 'sub',
        filter: new OrFilter({
          filters: lot.flatMap((m) => [
            new EqualityFilter({ attribute: 'employeeNumber', value: m }),
            new EqualityFilter({ attribute: 'employeeID', value: m }),
          ]),
        }),
        attributes: ['sAMAccountName', 'employeeNumber', 'employeeID', 'userAccountControl'],
      });
      for (const e of searchEntries) {
        const m = valeur(e.employeeNumber) || valeur(e.employeeID);
        if (!lot.includes(m)) continue;
        const uac = Number(valeur(e.userAccountControl)) || 0;
        const desactive = (uac & 2) === 2;
        // Plusieurs comptes pour un matricule : désactivé seulement si tous le sont.
        const avant = etats.get(m);
        etats.set(m, { trouve: true, desactive: avant ? avant.desactive && desactive : desactive, login: valeur(e.sAMAccountName).toLowerCase() });
      }
    }
    return etats;
  });
}

// Le compte de service se connecte, la base de recherche existe, chaque groupe de rôle se trouve.
async function verifierCompteServiceLdap() {
  const { AndFilter, OrFilter, EqualityFilter } = await import('ldapts');
  return avecCompteDeService(async (client) => {
    const base = await client.search(config.ldap.searchBase, { scope: 'base', attributes: ['distinguishedName'] })
      .then(({ searchEntries }) => searchEntries.length > 0, () => false);
    const groupes = {};
    for (const [role, nom] of Object.entries(config.ldap.groupes)) {
      if (!nom) continue;
      const cn = /^cn=([^,]+)/i.exec(nom)?.[1] ?? nom;
      const { searchEntries } = await client.search(config.ldap.searchBase, {
        scope: 'sub',
        filter: new AndFilter({
          filters: [
            new EqualityFilter({ attribute: 'objectClass', value: 'group' }),
            new OrFilter({ filters: [new EqualityFilter({ attribute: 'cn', value: cn }), new EqualityFilter({ attribute: 'distinguishedName', value: nom })] }),
          ],
        }),
        attributes: ['cn'],
        sizeLimit: 2,
      });
      groupes[role] = searchEntries.length > 0;
    }
    return { base, groupes };
  });
}

// Remplaçable par les tests, qui n'ont pas d'annuaire.
export const annuaire = {
  groupesImbriques: groupesImbriquesLdap, chercherAgent: chercherAgentLdap, etatComptes: etatComptesLdap,
  verifierCompteService: verifierCompteServiceLdap,
};
