import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

process.env.AUTH_MODE = 'ldap';
process.env.LDAP_URL = 'ldaps://annuaire.test:636';
process.env.LDAP_BASE_DN = 'DC=hopital,DC=test';
process.env.LDAP_BIND_DN = 'CN=svc_registris,CN=Users,DC=hopital,DC=test';
process.env.LDAP_BIND_PASSWORD = 'secret';
process.env.LDAP_GROUPE_ADMIN = 'GG_Registris_Admin';
process.env.LDAP_GROUPE_REFERENT = 'GG_Registris_Referent';
process.env.LDAP_GROUPE_UTILISATEUR = 'GG_Registris_Utilisateur';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const { remplacerInterrogationLdap } = await import('../src/auth.js');
const { annuaire } = await import('../src/annuaire.js');
const { creerApp } = await import('../src/serveur.js');

initialiserSchema();
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM' });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'DPI' });
A.creerUtilisateur('test', { login: 'secours', nom: 'Compte de secours', role: 'admin', motDePasse: 'mot-de-passe-de-secours' });
const surGam = H.creerHabilitation('smartin', { agent: { matricule: 'E1', nom: 'Un' }, applicationId: gam, role: 'Lecture' });
const surDpi = H.creerHabilitation('smartin', { agent: { matricule: 'E2', nom: 'Deux' }, applicationId: dpi, role: 'Lecture' });

const groupe = (cn) => ({ cn, dn: `CN=${cn},CN=Users,DC=hopital,DC=test` });
const personne = (sam, nom, groupes) => ({
  dn: `CN=${nom},CN=Users,DC=hopital,DC=test`, sAMAccountName: sam, displayName: nom, mail: `${sam.toLowerCase()}@hopital.test`,
  employeeNumber: `M-${sam}`, groups: groupes.map(groupe),
});
const ANNUAIRE = {
  smartin: personne('SMartin', 'Sophie Martin', ['GG_Registris_Admin']),
  pdurand: personne('PDurand', 'Pierre Durand', ['GG_Registris_Referent']),
  mmulti: personne('MMulti', 'Marc Multi', ['GG_Registris_Referent', 'GG_Registris_Utilisateur']),
  cpetit: personne('CPetit', 'Claire Petit', ['GG_Registris_Utilisateur']),
  jmoreau: personne('JMoreau', 'Julien Moreau', []),
};
let panne = null;
remplacerInterrogationLdap(async (options) => {
  if (panne) throw panne;
  const u = ANNUAIRE[options.username.toLowerCase()];
  if (!u) return { code: -1, user: null, messages: ['Authentication identity not found'] };
  if (options.userPassword !== 'bon') {
    return { code: -3, user: null, messages: ['80090308: LdapErr: DSID-0C0903A9, comment: AcceptSecurityContext error, data 52e, v1db1'] };
  }
  return { code: 1, user: u, messages: ['Authentication successful'] };
});
annuaire.chercherAgent = async (m) => (m === 'E20987' ? { matricule: m, nom: "D'Arcy", prenom: 'Hélène', email: 'helene.darcy@hopital.test', login: 'hdarcy' } : null);

const serveur = creerApp().listen(0, '127.0.0.1');
await new Promise((r) => serveur.once('listening', r));
const BASE = `http://127.0.0.1:${serveur.address().port}`;
test.after(() => serveur.close());

function client() {
  let cookie = '';
  const go = async (chemin, options = {}) => {
    const r = await fetch(BASE + chemin, { ...options, redirect: 'manual', headers: { ...(options.headers ?? {}), cookie } });
    const sc = r.headers.getSetCookie?.() ?? [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return r;
  };
  const csrf = (html) => html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
  const post = async (chemin, champs) => {
    const page = await (await go('/')).text();
    return go(chemin, {
      method: 'POST', body: new URLSearchParams({ ...champs, _csrf: csrf(page) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  };
  const connecter = async (login, motDePasse) => {
    const page = await (await go('/connexion')).text();
    return go('/connexion', {
      method: 'POST', body: new URLSearchParams({ login, motDePasse, _csrf: csrf(page) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  };
  return { go, post, connecter };
}
const journal = (action) => ouvrirDb().prepare('SELECT acteur, details FROM journal_audit WHERE action = ? ORDER BY id DESC').all(action);

test('connexion par l’annuaire : identifiant canonique au journal, compte mémorisé, barre haute', async () => {
  const c = client();
  const r = await c.connecter('PDURAND', 'bon');
  assert.equal(r.status, 302);
  assert.equal(journal('auth:succes')[0].acteur, 'pdurand');
  assert.match(journal('auth:succes')[0].details, /"source":"ldap"/);
  const accueil = await (await c.go('/')).text();
  assert.match(accueil, /Pierre Durand/);
  assert.match(accueil, /Référent applicatif/);
  const vu = ouvrirDb().prepare('SELECT * FROM comptes_annuaire WHERE login = ?').get('pdurand');
  assert.equal(vu.email, 'pdurand@hopital.test');
  assert.equal(vu.role, 'referent');
});

test('périmètre : la file d’un référent restreint ne montre que ses applications, quelle que soit la casse tapée', async () => {
  const admin = client();
  await admin.connecter('smartin', 'bon');
  assert.equal((await admin.post('/admin/referents', { login: 'PDurand', applicationIds: String(gam) })).status, 302);
  const page = await (await admin.go('/admin/utilisateurs')).text();
  assert.match(page, /Comptes de l'annuaire et périmètres déclarés/);
  assert.match(page, /Pierre Durand/);
  for (const tape of ['pdurand', 'PDurand']) {
    const ref = client();
    assert.equal((await ref.connecter(tape, 'bon')).status, 302, tape);
    const file = await (await ref.go('/traiter')).text();
    assert.match(file, new RegExp(`/traiter/${surGam.id}"`), `${tape} voit la GAM`);
    assert.doesNotMatch(file, new RegExp(`/traiter/${surDpi.id}"`), `${tape} ne voit pas le DPI`);
    const fiche = await ref.go(`/traiter/${surDpi.id}`);
    assert.equal(fiche.status, 302, 'hors file : renvoi vers la fiche');
  }
  const tout = await (await admin.go('/traiter')).text();
  assert.match(tout, new RegExp(`/traiter/${surDpi.id}"`), 'l’administrateur voit tout');
});

test('traitants : un référent de l’annuaire déjà vu peut se voir confier une demande, avec son nom', async () => {
  const admin = client();
  await admin.connecter('smartin', 'bon');
  const avantMmulti = await admin.post(`/habilitations/${surDpi.id}/assigner`, { login: 'mmulti' });
  assert.equal(avantMmulti.status, 400, 'jamais connecté, sans périmètre : inconnu');
  await client().connecter('mmulti', 'bon');
  const fiche = await (await admin.go(`/traiter/${surDpi.id}`)).text();
  assert.match(fiche, /<option value="mmulti"[^>]*>Marc Multi<\/option>/);
  assert.equal((await admin.post(`/habilitations/${surDpi.id}/assigner`, { login: 'mmulti' })).status, 302);
  assert.equal(H.habilitationParId(surDpi.id).assigne_a, 'mmulti');
  assert.equal(A.emailUtilisateur('mmulti'), 'mmulti@hopital.test');
});

test('sans rôle : refus explicite, journal dédié, pas de blocage', async () => {
  for (let i = 0; i < 6; i += 1) {
    const r = await client().connecter('jmoreau', 'bon');
    assert.equal(r.status, 403);
    assert.match(await r.text(), /aucun rôle Registris/);
  }
  assert.ok(journal('auth:sans-role').length >= 6);
});

test('mauvais mot de passe : générique pour l’utilisateur, raison au journal, compté', async () => {
  const r = await client().connecter('cpetit', 'faux');
  assert.equal(r.status, 401);
  assert.match(await r.text(), /Identifiants invalides/);
  assert.match(journal('auth:echec')[0].details, /"raison":"mot de passe incorrect"/);
});

test('annuaire injoignable : 503 sans compter, journal dédié, compte de secours accepté et signalé', async () => {
  panne = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:636'), { code: 'ECONNREFUSED' });
  try {
    for (let i = 0; i < 6; i += 1) {
      const r = await client().connecter('smartin', 'bon');
      assert.equal(r.status, 503);
      assert.match(await r.text(), /annuaire est injoignable/);
    }
    assert.ok(journal('auth:annuaire-injoignable').length >= 6);
    const s = client();
    assert.equal((await s.connecter('secours', 'mot-de-passe-de-secours')).status, 302);
    assert.match(journal('auth:succes')[0].details, /"source":"local","secours":true/);
    assert.match(await (await s.go('/')).text(), /compte local de secours/);
    assert.equal((await client().connecter('secours', 'faux')).status, 401, 'un mauvais mot de passe local reste compté');
  } finally {
    panne = null;
  }
  assert.equal((await client().connecter('smartin', 'bon')).status, 302, 'annuaire revenu');
  assert.equal((await client().connecter('secours', 'mot-de-passe-de-secours')).status, 401, 'le secours ne sert plus');
});

test('préremplissage : le registre d’abord, puis l’annuaire par matricule', async () => {
  const c = client();
  await c.connecter('cpetit', 'bon');
  assert.deepEqual(await (await c.go('/api/agent?matricule=E1')).json(), { trouve: true, nom: 'Un', prenom: '', email: '', source: 'registre' });
  assert.deepEqual(await (await c.go('/api/agent?matricule=E20987')).json(), { trouve: true, nom: "D'Arcy", prenom: 'Hélène', email: 'helene.darcy@hopital.test', source: 'annuaire' });
  assert.deepEqual(await (await c.go('/api/agent?matricule=E99')).json(), { trouve: false });
});
