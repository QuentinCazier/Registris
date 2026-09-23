import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

process.env.AUTH_MODE = 'ldap';
process.env.LDAP_URL = 'ldaps://annuaire.test:636';
process.env.LDAP_BASE_DN = 'DC=hopital,DC=test';
process.env.LDAP_BIND_DN = 'CN=svc_registris,CN=Users,DC=hopital,DC=test';
process.env.LDAP_BIND_PASSWORD = 'secret';
process.env.LDAP_GROUPE_ADMIN = 'GG_Registris_Admin';
process.env.LDAP_GROUPE_CONTROLEUR = 'GG_Registris_Controleur';
process.env.LDAP_GROUPE_REFERENT = 'GG_Registris_Referent';
process.env.LDAP_GROUPE_UTILISATEUR = 'GG_Registris_Utilisateur';

const { config } = await import('../src/config.js');
const { initialiserSchema } = await import('../src/db.js');
const A = await import('../src/administration.js');
const R = await import('../src/roles.js');
const { authentifierDetail, optionsLdap, remplacerInterrogationLdap, expliquerErreurLdap, diagnostiquerLdap } = await import('../src/auth.js');
const { annuaire } = await import('../src/annuaire.js');

initialiserSchema();
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM' });
A.creerUtilisateur('test', { login: 'Secours', nom: 'Compte de secours', role: 'admin', motDePasse: 'mot-de-passe-de-secours' });

const groupe = (cn) => ({ cn, dn: `CN=${cn},CN=Users,DC=hopital,DC=test` });
const personne = (sam, groupes, extra = {}) => ({
  dn: `CN=${sam},CN=Users,DC=hopital,DC=test`, sAMAccountName: sam, displayName: `Nom ${sam}`,
  mail: `${sam.toLowerCase()}@hopital.test`, employeeNumber: 'E1', groups: groupes.map(groupe), ...extra,
});
const reponse = (code, user = null, message = '') => ({ code, user, messages: [message] });

// Un annuaire simulé : la réponse dépend de l'identifiant et du mot de passe.
const ANNUAIRE = {
  pdurand: personne('PDurand', ['GG_Registris_Referent']),
  smartin: personne('SMartin', ['GG_Registris_Admin']),
  jmoreau: personne('JMoreau', []),
  rimbrique: personne('RImbrique', ['GG_DSI_Equipe']),
  ancien: personne('Ancien', ['GG_Registris_Admin_Ancien']),
};
let panne = null;
const simule = async (options) => {
  if (panne) throw panne;
  const u = ANNUAIRE[options.username.toLowerCase()];
  if (!u) return reponse(-1, null, 'Authentication identity not found');
  if (options.userPassword !== 'bon') return reponse(-3, null, '80090308: LdapErr: DSID-0C0903A9, comment: AcceptSecurityContext error, data 52e, v1db1');
  return reponse(1, u, 'Authentication successful');
};
remplacerInterrogationLdap(simule);

test("annuaire : l'identifiant de session est celui de l'annuaire, en minuscules, quelle que soit la casse tapée", async () => {
  for (const tape of ['pdurand', 'PDURAND', 'PDurand']) {
    const { utilisateur: u, motif } = await authentifierDetail(tape, 'bon');
    assert.equal(motif, null, tape);
    assert.equal(u.login, 'pdurand');
    assert.equal(u.source, 'ldap');
    assert.equal(u.role, 'referent');
    assert.equal(u.email, 'pdurand@hopital.test');
  }
});

test('annuaire : le périmètre déclaré suit cet identifiant, même saisi en majuscules', async () => {
  assert.equal((await authentifierDetail('pdurand', 'bon')).utilisateur.referentApps, 'ALL');
  A.definirPerimetreReferent('test', 'PDurand', [gam]);
  assert.deepEqual((await authentifierDetail('PDURAND', 'bon')).utilisateur.referentApps, [gam]);
  assert.deepEqual([...A.perimetresReferents().keys()], ['pdurand']);
});

test('annuaire : mauvais mot de passe ou identité inconnue sont imputables, sans rôle ne l’est pas', async () => {
  const faux = await authentifierDetail('pdurand', 'faux');
  assert.equal(faux.motif, 'identifiants');
  assert.equal(expliquerErreurLdap(faux.detail), 'mot de passe incorrect');
  assert.equal((await authentifierDetail('inconnu', 'bon')).motif, 'identifiants');
  const sansRole = await authentifierDetail('jmoreau', 'bon');
  assert.equal(sansRole.motif, 'role');
  assert.equal(sansRole.utilisateur, null);
});

test('annuaire injoignable : motif distinct, et le compte local de secours prend le relais', async () => {
  panne = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:636'), { code: 'ECONNREFUSED' });
  try {
    assert.equal((await authentifierDetail('pdurand', 'bon')).motif, 'injoignable');
    const secours = await authentifierDetail('secours', 'mot-de-passe-de-secours');
    assert.equal(secours.motif, null);
    assert.equal(secours.utilisateur.source, 'local');
    assert.equal(secours.utilisateur.secours, true);
    assert.equal(secours.utilisateur.login, 'Secours', 'identifiant tel qu’enregistré pour un compte local');
    assert.equal((await authentifierDetail('secours', 'faux')).motif, 'identifiants', 'un compte local existant compte ses échecs');
  } finally {
    panne = null;
  }
  const r = await authentifierDetail('secours', 'mot-de-passe-de-secours');
  assert.equal(r.motif, 'identifiants', 'annuaire joignable : le compte local ne sert plus');
});

test('annuaire : un échec du bind du compte de service n’est pas imputé à l’utilisateur', async () => {
  try {
    remplacerInterrogationLdap(async () => reponse(0, null, 'connect ETIMEDOUT 10.0.0.1:636'));
    assert.equal((await authentifierDetail('pdurand', 'bon')).motif, 'injoignable');
    remplacerInterrogationLdap(async () => reponse(0, null, '80090308: LdapErr: DSID-0C0903A9, comment: AcceptSecurityContext error, data 52e, v1db1'));
    assert.equal((await authentifierDetail('pdurand', 'bon')).motif, 'injoignable', 'mot de passe du compte de service faux : configuration, pas utilisateur');
  } finally {
    remplacerInterrogationLdap(simule);
  }
});

test('bind direct sans compte de service : modèle LDAP_USER_DN, et classification par le message', async () => {
  const bindDN = config.ldap.bindDN;
  config.ldap.bindDN = '';
  config.ldap.userDn = '%s@hopital.test';
  try {
    assert.equal(optionsLdap('pdurand', 'x').userDn, 'pdurand@hopital.test');
    assert.equal(optionsLdap('pdurand', 'x').adminDn, undefined);
    remplacerInterrogationLdap(async () => reponse(0, null, '80090308: LdapErr: DSID-0C0903A9, comment: AcceptSecurityContext error, data 52e, v1db1'));
    assert.equal((await authentifierDetail('pdurand', 'x')).motif, 'identifiants');
    remplacerInterrogationLdap(async () => reponse(0, null, 'Connection timeout'));
    assert.equal((await authentifierDetail('pdurand', 'x')).motif, 'injoignable');
  } finally {
    config.ldap.bindDN = bindDN;
    config.ldap.userDn = '';
    remplacerInterrogationLdap(simule);
  }
});

test('groupes : correspondance exacte sur le nom ou le DN, jamais sur un fragment', async () => {
  const mapping = config.ldap.groupes;
  assert.equal(R.roleDepuisGroupes(['GG_Registris_Admin_Ancien'], mapping), null);
  assert.equal(R.roleDepuisGroupes(['ZZ_GG_Registris_Admin'], mapping), null);
  assert.equal(R.roleDepuisGroupes(['gg_registris_admin'], mapping), 'admin');
  assert.equal(R.roleDepuisGroupes(['CN=GG_Registris_Referent,OU=Groupes,DC=hopital,DC=test'], mapping), 'referent');
  assert.equal(R.roleDepuisGroupes(['CN=GG_Registris_Referent,OU=Groupes,DC=hopital,DC=test'], { ...mapping, referent: 'cn=gg_registris_referent,ou=groupes,dc=hopital,dc=test' }), 'referent');
  assert.equal((await authentifierDetail('ancien', 'bon')).motif, 'role');
});

test('groupes imbriqués : résolus par la règle en chaîne quand l’option est active', async () => {
  const sauve = annuaire.groupesImbriques;
  annuaire.groupesImbriques = async (dn) => (dn.includes('RImbrique') ? ['GG_DSI_Equipe', 'GG_Registris_Referent'] : []);
  try {
    assert.equal((await authentifierDetail('rimbrique', 'bon')).motif, 'role', 'sans l’option, appartenance directe seulement');
    config.ldap.groupesImbriques = true;
    const r = await authentifierDetail('rimbrique', 'bon');
    assert.equal(r.utilisateur.role, 'referent');
    annuaire.groupesImbriques = async () => { throw new Error('connect ECONNRESET'); };
    assert.equal((await authentifierDetail('rimbrique', 'bon')).motif, 'injoignable');
  } finally {
    config.ldap.groupesImbriques = false;
    annuaire.groupesImbriques = sauve;
  }
});

test('diagnostic : chaque étape porte son verdict, la panne et le refus sont nommés', async () => {
  const ok = await diagnostiquerLdap('PDurand', 'bon');
  assert.ok(ok.session);
  assert.equal(ok.session.login, 'pdurand');
  assert.ok(ok.etapes.every((e) => e.ok), ok.etapes.map((e) => `${e.ok ? 'OK' : 'ECHEC'} ${e.etape}`).join('\n'));
  assert.ok(ok.etapes.some((e) => e.etape === 'identifiant de session' && e.detail === 'pdurand'));

  const refus = await diagnostiquerLdap('pdurand', 'faux');
  assert.equal(refus.session, null);
  const echec = refus.etapes.find((e) => !e.ok);
  assert.equal(echec.etape, "authentification de l'utilisateur");
  assert.match(echec.detail, /^mot de passe incorrect : /);

  panne = new Error('connect ECONNREFUSED 127.0.0.1:636');
  try {
    const p = await diagnostiquerLdap('pdurand', 'bon');
    assert.equal(p.etapes.find((e) => !e.ok).etape, "connexion à l'annuaire");
  } finally {
    panne = null;
  }

  const sansRole = await diagnostiquerLdap('jmoreau', 'bon');
  assert.match(sansRole.etapes.find((e) => e.etape === "groupes directs de l'utilisateur").detail, /soit l'utilisateur n'en a pas/);
});

test('comptes de l’annuaire mémorisés : traitants possibles et courriel', () => {
  A.memoriserCompteAnnuaire({ login: 'PDurand', nom: 'Pierre Durand', email: 'pierre.durand@hopital.test', matricule: 'R0001', role: 'referent' });
  A.memoriserCompteAnnuaire({ login: 'mmulti', nom: 'Marc Multi', email: 'marc.multi@hopital.test', matricule: 'E30112', role: 'referent' });
  A.memoriserCompteAnnuaire({ login: 'cpetit', nom: 'Claire Petit', email: 'claire.petit@hopital.test', matricule: 'E45678', role: 'utilisateur' });
  const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'DPI' });
  const surGam = A.traitantsPossibles(gam);
  const surDpi = A.traitantsPossibles(dpi);
  assert.deepEqual({ ...surGam.find((t) => t.login === 'pdurand') }, { login: 'pdurand', nom: 'Pierre Durand', role: 'referent' });
  assert.ok(surGam.some((t) => t.login === 'mmulti'), 'un référent d’annuaire sans périmètre couvre tout');
  assert.ok(!surDpi.some((t) => t.login === 'pdurand'), 'hors périmètre déclaré');
  assert.ok(surDpi.some((t) => t.login === 'mmulti'));
  assert.ok(!surGam.some((t) => t.login === 'cpetit'), 'un utilisateur ne traite rien');
  assert.equal(A.emailUtilisateur('PDURAND'), 'pierre.durand@hopital.test');
  assert.equal(A.emailUtilisateur('secours'), null);
  A.memoriserCompteAnnuaire({ login: 'pdurand', nom: 'Pierre Durand', email: 'nouveau@hopital.test', matricule: 'R0001', role: 'referent' });
  assert.equal(A.listerComptesAnnuaire().filter((c) => c.login === 'pdurand').length, 1, 'une ligne par identifiant');
  assert.equal(A.emailUtilisateur('pdurand'), 'nouveau@hopital.test');
});
