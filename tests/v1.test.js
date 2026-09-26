// Fonctions de la 1.0 : accès temporaires, départs détectés, accord du cadre, suppléance, API en lecture, conservation.

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const { journal } = await import('../src/audit.js');
const { entretien } = await import('../src/entretien.js');
const { creerApp } = await import('../src/serveur.js');

initialiserSchema();
const cat = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'Gestion des malades', categorieId: cat });
A.creerApplication('test', { code: 'PAIE', libelle: 'Paie', categorieId: cat });
const MDP = 'mot-de-passe-de-test';
A.creerUtilisateur('test', { login: 'admin', nom: 'Sophie Martin', role: 'admin', motDePasse: MDP });
A.creerUtilisateur('test', { login: 'agent', nom: 'Claire Petit', role: 'utilisateur', motDePasse: MDP, matricule: 'E45678' });
A.creerUtilisateur('test', { login: 'ref', nom: 'Pierre Durand', role: 'referent', motDePasse: MDP, applicationIds: [gam] });

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
  const connecter = async (login) => {
    const page = await (await go('/connexion')).text();
    return go('/connexion', {
      method: 'POST',
      body: new URLSearchParams({ login, motDePasse: MDP, _csrf: csrf(page) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  };
  const poster = async (chemin, champs, depuis = '/') => {
    const corps = new URLSearchParams(champs);
    corps.set('_csrf', csrf(await (await go(depuis)).text()) ?? '');
    return go(chemin, { method: 'POST', body: corps, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  };
  return { go, csrf, connecter, poster };
}
const sansStyle = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
const jourPlus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let seq = 0;
const nouvelAgent = () => ({ matricule: `T${String(++seq).padStart(4, '0')}`, nom: `Agent${seq}`, prenom: 'Test' });

// --- Accès temporaires -------------------------------------------------------------------------

test('accès temporaire : date de fin contrôlée, fermeture demandée une seule fois à l’échéance', async () => {
  assert.throws(() => H.creerHabilitation('ref', { agent: nouvelAgent(), applicationId: gam, role: 'Saisie', dateFin: '2001-01-01' }), /déjà passée/);
  assert.throws(() => H.creerHabilitation('ref', { agent: nouvelAgent(), applicationId: gam, role: 'Saisie', dateFin: '31/12/2030' }), /AAAA-MM-JJ/);
  const h = H.creerHabilitation('ref', { agent: nouvelAgent(), applicationId: gam, role: 'Stagiaire', dateFin: jourPlus(10) });
  assert.equal(h.date_fin, jourPlus(10));
  H.changerStatut('ref', h.id, 'executer');

  assert.equal((await entretien()).fermeturesEchues, 0, 'pas encore échu');
  assert.equal((await entretien({ jour: jourPlus(10) })).fermeturesEchues, 1);
  const apres = H.habilitationParId(h.id);
  assert.ok(apres.retrait_demande_le);
  assert.match(apres.retrait_motif, /Fin de l'accès temporaire/);
  assert.equal(apres.statut, 'executee', "l'accès reste ouvert jusqu'à l'action du référent");
  assert.equal((await entretien({ jour: jourPlus(30) })).fermeturesEchues, 0, 'une seule demande par accès');
  assert.ok(journal({ limite: 10 }).some((j) => j.action === 'entretien:echeances'));
});

test('accès temporaire : le référent fixe ou retire la date, tracé ; accès clos refusé', () => {
  const h = H.creerHabilitation('ref', { agent: nouvelAgent(), applicationId: gam, role: 'Saisie' });
  H.modifierEcheance('ref', h.id, jourPlus(5));
  assert.equal(H.habilitationParId(h.id).date_fin, jourPlus(5));
  H.modifierEcheance('ref', h.id, '');
  assert.equal(H.habilitationParId(h.id).date_fin, null);
  assert.equal(journal({ limite: 10 }).filter((j) => j.action === 'habilitation:echeance' && j.entite_id === h.id).length, 2);
  H.changerStatut('ref', h.id, 'refuser', { motif: 'non' });
  assert.throws(() => H.modifierEcheance('ref', h.id, jourPlus(5)), /clos/);
});

test('accès temporaire : champ du formulaire, onglet du registre, fiche et tableau de bord', async () => {
  const agent = client();
  await agent.connecter('agent');
  const form = await (await agent.go(`/habilitations/nouvelle/${gam}`)).text();
  assert.match(form, /name="date_fin" type="date"/);
  const fd = new FormData();
  fd.set('_csrf', agent.csrf(form));
  for (const [k, v] of Object.entries({ applicationId: String(gam), pour_autrui: '0', matricule: 'E45678', role: 'Remplacement', date_fin: jourPlus(3) })) fd.set(k, v);
  const r = await agent.go('/habilitations', { method: 'POST', body: fd });
  assert.equal(r.status, 302);
  const id = Number(r.headers.get('location').match(/(\d+)$/)[1]);
  H.changerStatut('ref', id, 'executer');

  const ref = client();
  await ref.connecter('ref');
  assert.match(sansStyle(await (await ref.go(`/habilitations/${id}`)).text()), /jusqu'au \d{2}\/\d{2}\/\d{4}/);
  const registre = sansStyle(await (await ref.go('/suivi?temp=1')).text());
  assert.match(registre, /Temporaires <span class="c">\d+<\/span>/);
  assert.match(registre, /Remplacement/);
  assert.match(sansStyle(await (await ref.go('/')).text()), /temporaires? arrive/);
});

// --- Départs détectés ------------------------------------------------------------------------------

const D = await import('../src/departs.js');
const { annuaire } = await import('../src/annuaire.js');

const agentOuvert = (application = gam) => {
  const a = nouvelAgent();
  const h = H.creerHabilitation('ref', { agent: a, applicationId: application, role: 'Saisie' });
  H.changerStatut('ref', h.id, 'executer');
  return { ...a, h };
};

test('départs : fichier RH des sorties, dates futures ignorées, une détection par agent', () => {
  const parti = agentOuvert();
  const bientot = agentOuvert();
  const reste = agentOuvert();
  const csv = Buffer.from(`Matricule;Nom;Date de sortie\n${parti.matricule};${parti.nom};01/01/2020\n${bientot.matricule};${bientot.nom};${jourPlus(40)}\n`, 'utf8');
  const bilan = D.detecterDepuisFichierRh('admin', csv, { mode: 'sorties' });
  assert.equal(bilan.nouveaux, 1);
  const liste = D.departsAConfirmer();
  assert.ok(liste.some((d) => d.matricule === parti.matricule && /01\/01\/2020/.test(d.motif)));
  assert.ok(!liste.some((d) => d.matricule === bientot.matricule), 'sortie à venir : pas encore');
  assert.ok(!liste.some((d) => d.matricule === reste.matricule));
  assert.equal(D.detecterDepuisFichierRh('admin', csv, { mode: 'sorties' }).nouveaux, 0, 'pas de doublon');
});

test('départs : fichier des présents, garde-fou contre un fichier tronqué', () => {
  const tous = D.departsAConfirmer().length;
  const absents = Array.from({ length: 12 }, () => agentOuvert());
  const presents = Buffer.from(`Matricule\n${absents.slice(0, 3).map((a) => a.matricule).join('\n')}\n`, 'utf8');
  assert.throws(() => D.detecterDepuisFichierRh('admin', presents, { mode: 'presents' }), /semble incomplet/);
  assert.equal(D.departsAConfirmer().length, tous, 'rien signalé');
});

test('départs : annuaire, confirmation qui ouvre les fermetures, écart motivé', async () => {
  const desactive = agentOuvert();
  const actif = agentOuvert();
  const original = annuaire.etatComptes;
  annuaire.etatComptes = async (ms) => new Map(ms.map((m) => [m, { trouve: true, desactive: m === desactive.matricule, login: 'x' }]));
  try {
    const bilan = await D.detecterDepuisAnnuaire('admin');
    assert.ok(bilan.nouveaux >= 1);
  } finally {
    annuaire.etatComptes = original;
  }
  const d = D.departsAConfirmer().find((x) => x.matricule === desactive.matricule);
  assert.match(d.motif, /désactivé dans l'annuaire/);
  assert.ok(!D.departsAConfirmer().some((x) => x.matricule === actif.matricule));

  const ref = client();
  await ref.connecter('ref');
  const page = sansStyle(await (await ref.go('/departs')).text());
  assert.match(page, new RegExp(desactive.matricule));
  const r = await ref.poster(`/departs/${d.id}/confirmer`, {}, '/departs');
  assert.equal(r.status, 302);
  assert.ok(H.habilitationParId(desactive.h.id).retrait_demande_le, 'fermeture demandée');
  assert.ok(!D.departsAConfirmer().some((x) => x.id === d.id));

  const autre = D.departsAConfirmer()[0];
  assert.throws(() => D.ecarterDepart('ref', autre.id, { motif: '' }), /Indiquez pourquoi/);
  D.ecarterDepart('ref', autre.id, { motif: 'Retour de congé long' });
  assert.ok(journal({ limite: 30 }).some((j) => j.action === 'depart:ecarter'));
});

// --- Accord du cadre -------------------------------------------------------------------------------

const ACC = await import('../src/accords.js');

test('accord du cadre : demande bloquée, cadre notifié par sa page, accord puis validation', async () => {
  const bloc = A.creerApplication('test', { code: 'BLOC', libelle: 'Planning du bloc', categorieId: cat });
  A.modifierApplication('admin', bloc, { accordCadre: true });
  A.creerUf('test', { code: '3105', libelle: 'Réanimation' });
  const uf = H.listerUfs().find((u) => u.code === '3105').id;
  A.creerUtilisateur('test', { login: 'cadre', nom: 'Anne Cadre', role: 'utilisateur', motDePasse: MDP, matricule: 'C0001' });
  ACC.definirResponsablesUf('admin', uf, 'cadre');
  A.definirPerimetreReferent('admin', 'ref', [gam, bloc]);

  const h = H.creerHabilitation('agent', { agent: nouvelAgent(), applicationId: bloc, role: 'Infirmier', ufIds: [uf] });
  assert.equal(h.accord_cadre, 'attente');
  assert.throws(() => H.changerStatut('ref', h.id, 'valider'), /accord du cadre/);

  const cadre = client();
  await cadre.connecter('cadre');
  const accueil = sansStyle(await (await cadre.go('/')).text());
  assert.match(accueil, /1 demande attend votre accord/);
  const page = sansStyle(await (await cadre.go('/approbations')).text());
  assert.match(page, /Planning du bloc/);
  assert.equal((await cadre.poster(`/approbations/${h.id}`, { decision: 'accorder' }, '/approbations')).status, 302);
  assert.equal(H.habilitationParId(h.id).accord_cadre, 'accorde');
  H.changerStatut('ref', h.id, 'valider');

  // Un autre cadre, responsable d'aucune UF de la demande, ne peut pas statuer.
  const h2 = H.creerHabilitation('agent', { agent: nouvelAgent(), applicationId: bloc, role: 'Aide-soignant', ufIds: [uf] });
  assert.throws(() => ACC.statuerAccord('agent', h2.id, { decision: 'accorder' }), /responsable d'aucune UF/);
  // Refus du cadre : la demande est refusée, motif transmis.
  ACC.statuerAccord('cadre', h2.id, { decision: 'refuser', motif: 'Pas dans mon équipe' });
  assert.equal(H.habilitationParId(h2.id).statut, 'refusee');

  // Le cadre qui demande pour son équipe donne son accord d'office.
  const h3 = H.creerHabilitation('cadre', { agent: nouvelAgent(), applicationId: bloc, role: 'Infirmier', ufIds: [uf] });
  assert.equal(h3.accord_cadre, 'accorde');

  // Accord obtenu par courriel : le référent l'enregistre, avec qui et comment.
  const h4 = H.creerHabilitation('agent', { agent: nouvelAgent(), applicationId: bloc, role: 'Infirmier' });
  assert.throws(() => ACC.statuerAccord('ref', h4.id, { decision: 'accorder', horsOutil: true }), /qui a donné l'accord/);
  const ref = client();
  await ref.connecter('ref');
  const fiche = sansStyle(await (await ref.go(`/habilitations/${h4.id}`)).text());
  assert.match(fiche, /Aucun cadre n'est désigné/);
  assert.equal((await ref.poster(`/approbations/${h4.id}`, { decision: 'accorder', hors_outil: '1', motif: 'Courriel de Mme Durand du 12/10', retour: `/habilitations/${h4.id}` }, `/habilitations/${h4.id}`)).status, 302);
  assert.equal(H.habilitationParId(h4.id).accord_cadre, 'accorde');
  assert.ok(journal({ limite: 30 }).some((j) => j.action === 'accord:hors-outil' && j.entite_id === h4.id));

  // Un agent ne peut pas se servir de la voie « hors outil ».
  const h5 = H.creerHabilitation('agent', { agent: nouvelAgent(), applicationId: bloc, role: 'Infirmier' });
  const agent = client();
  await agent.connecter('agent');
  assert.ok((await agent.poster(`/approbations/${h5.id}`, { decision: 'accorder', hors_outil: '1', motif: 'moi' }, '/depart')).status >= 400);
  assert.equal(H.habilitationParId(h5.id).accord_cadre, 'attente');
});

// --- Suppléance ------------------------------------------------------------------------------------

const SUP = await import('../src/suppleances.js');

test('suppléance : le suppléant reçoit le périmètre du titulaire pendant la période, pas après', async () => {
  A.creerUtilisateur('test', { login: 'ref2', nom: 'Marc Supplée', role: 'referent', motDePasse: MDP, applicationIds: [paieId()] });
  assert.throws(() => SUP.creerSuppleance('ref', { titulaire: 'ref', suppleant: 'agent', du: jourPlus(0), au: jourPlus(5) }), /référent ou un administrateur/);
  assert.throws(() => SUP.creerSuppleance('ref', { titulaire: 'ref', suppleant: 'ref2', du: jourPlus(5), au: jourPlus(1) }), /précède/);

  const h = H.creerHabilitation('agent', { agent: nouvelAgent(), applicationId: gam, role: 'Saisie' });
  const ref2 = client();
  await ref2.connecter('ref2');
  assert.doesNotMatch(sansStyle(await (await ref2.go('/traiter')).text()), new RegExp(`/traiter/${h.id}"`), 'hors périmètre avant la suppléance');

  const id = SUP.creerSuppleance('ref', { titulaire: 'ref', suppleant: 'ref2', du: jourPlus(0), au: jourPlus(3) });
  const file = sansStyle(await (await ref2.go('/traiter')).text());
  assert.match(file, new RegExp(`/traiter/${h.id}"`), 'visible sans se reconnecter');
  assert.match(sansStyle(await (await ref2.go('/')).text()), /Vous remplacez Pierre Durand/);
  assert.equal((await ref2.poster(`/habilitations/${h.id}/valider`, {}, `/habilitations/${h.id}`)).status, 302);
  assert.equal(SUP.suppleantDe('ref'), 'ref2');

  SUP.supprimerSuppleance('ref', id);
  assert.doesNotMatch(sansStyle(await (await ref2.go('/traiter')).text()), /Vous remplacez/);
  const page = sansStyle(await (await ref2.go('/absences')).text());
  assert.match(page, /Déclarer une absence/);
});

function paieId() {
  return H.listerApplications().find((a) => a.code === 'PAIE').id;
}

// --- API en lecture --------------------------------------------------------------------------------

const API = await import('../src/api.js');

test('API : jeton obligatoire, lecture seule, révocable, jamais stocké en clair', async () => {
  assert.equal((await fetch(`${BASE}/api/v1/applications`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/v1/applications`, { headers: { authorization: 'Bearer rgs_inventeinventeinventeinvente' } })).status, 401);
  const { id, jeton } = API.creerJeton('admin', 'GLPI');
  const { ouvrirDb } = await import('../src/db.js');
  assert.ok(!JSON.stringify(ouvrirDb().prepare('SELECT * FROM jetons_api').all()).includes(jeton), 'seule l’empreinte est gardée');
  const auth = { authorization: `Bearer ${jeton}` };
  const apps = await (await fetch(`${BASE}/api/v1/applications`, { headers: auth })).json();
  assert.ok(apps.applications.some((a) => a.code === 'GAM'));
  assert.equal((await fetch(`${BASE}/api/v1/applications`, { method: 'POST', headers: auth })).status, 405);
  assert.equal((await fetch(`${BASE}/api/v1/inconnu`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${BASE}/api/v1/applications`, { headers: auth })).headers.get('set-cookie'), null, 'pas de session');
  API.revoquerJeton('admin', id);
  assert.equal((await fetch(`${BASE}/api/v1/applications`, { headers: auth })).status, 401);
});

test('API : demandes en attente, accès d’un agent, pagination par curseur', async () => {
  const { jeton } = API.creerJeton('admin', 'Supervision');
  const auth = { headers: { authorization: `Bearer ${jeton}` } };
  const a = nouvelAgent();
  const h = H.creerHabilitation('agent', { agent: a, applicationId: gam, role: 'Consultation', dateFin: jourPlus(20) });
  const attente = await (await fetch(`${BASE}/api/v1/demandes?application=gam&limite=500`, auth)).json();
  const vue = attente.habilitations.find((x) => x.id === h.id);
  assert.equal(vue.etat, 'demandee');
  assert.equal(vue.agent.matricule, a.matricule);
  assert.equal(vue.date_fin, jourPlus(20));

  const acces = await (await fetch(`${BASE}/api/v1/agents/${a.matricule}/acces`, auth)).json();
  assert.equal(acces.acces.length, 1);
  assert.equal((await fetch(`${BASE}/api/v1/agents/INCONNU/acces`, auth)).status, 404);
  assert.equal((await fetch(`${BASE}/api/v1/habilitations?etat=nimporte`, auth)).status, 400);

  const p1 = await (await fetch(`${BASE}/api/v1/habilitations?limite=2`, auth)).json();
  assert.equal(p1.habilitations.length, 2);
  const p2 = await (await fetch(`${BASE}/api/v1/habilitations?limite=2&apres=${p1.suivant}`, auth)).json();
  assert.ok(p2.habilitations[0].id > p1.habilitations[1].id);

  const admin = client();
  await admin.connecter('admin');
  const pageApi = sansStyle(await (await admin.go('/admin/api')).text());
  assert.match(pageApi, /Supervision/);
  assert.doesNotMatch(pageApi, new RegExp(jeton), 'le jeton n’est plus affiché');
});

// --- Conservation ----------------------------------------------------------------------------------

const C = await import('../src/conservation.js');
const P = await import('../src/preuves.js');
const { PNG } = await import('./_env.js');

test('conservation : au-delà de la durée, identité effacée, pièces supprimées, coffre toujours cohérent', async () => {
  const a = nouvelAgent();
  const h = H.creerHabilitation('ref', { agent: { ...a, email: 'parti@exemple.fr' }, applicationId: gam, role: 'Ancien', commentaire: 'Mutation' });
  const piece = P.ajouterPreuve('ref', h.id, { tampon: PNG, nom: 'capture.png' });
  H.changerStatut('ref', h.id, 'executer');
  H.changerStatut('ref', h.id, 'revoquer', { motif: 'Départ' });

  const dansDixAns = new Date(Date.now() + 10 * 365 * 86400000);
  const simulation = C.purger('admin', { annees: 5, simuler: true, maintenant: dansDixAns });
  assert.ok(simulation.agents >= 1 && simulation.simule);
  assert.equal(H.agentParMatricule(a.matricule).nom, a.nom, 'la simulation ne touche à rien');

  assert.equal(C.purger('admin', { annees: 5 }).agents, 0, 'rien avant la durée');
  const bilan = C.purger('admin', { annees: 5, maintenant: dansDixAns });
  assert.ok(bilan.agents >= 1 && bilan.pieces >= 1);
  assert.equal(H.agentParMatricule(a.matricule), undefined, 'le matricule a disparu');
  const apres = H.habilitationParId(h.id);
  assert.equal(apres.nom, 'Anonymisé');
  assert.equal(apres.commentaire, null);
  assert.equal(apres.role, 'Ancien', "l'accès lui-même reste au registre");
  const fs = await import('node:fs');
  assert.equal(fs.existsSync(P.cheminPreuve(piece)), false);
  assert.equal(P.auditerCoffre().anomalies.length, 0, 'une pièce purgée n’est pas une anomalie');
  assert.ok(journal({ limite: 10 }).some((j) => j.action === 'conservation:purger'));

  // Un agent qui a encore un accès ouvert n'est jamais purgé.
  const actif = agentOuvert();
  C.purger('admin', { annees: 1, maintenant: dansDixAns });
  assert.equal(H.agentParMatricule(actif.matricule).nom, actif.nom);
});

// --- Import : cadres et accord --------------------------------------------------------------------

test('import : colonne « Accord du cadre » des applications, colonne « Cadres » des UF', async () => {
  const I = await import('../src/import.js');
  I.importerApplications('admin', Buffer.from('Code;Libellé;Accord du cadre\nPHARMA;Pharmacie;oui\nGAM;;non\n', 'utf8'));
  assert.equal(H.listerApplications().find((x) => x.code === 'PHARMA').accord_cadre, 1);
  I.importerUfs('admin', Buffer.from('Code;Libellé;Cadres\n4001;Pharmacie;Cadre.Pharma, adjoint\n', 'utf8'));
  const uf = H.listerUfs().find((u) => u.code === '4001').id;
  assert.deepEqual(ACC.responsablesUf(uf), ['adjoint', 'cadre.pharma']);
});

// --- Contrôle de la configuration ----------------------------------------------------------------

test('contrôle de la configuration : annuaire, groupe manquant, messagerie désactivée', async () => {
  const { config } = await import('../src/config.js');
  const { verifierConfiguration } = await import('../src/verification.js');
  const sauvegarde = { authMode: config.authMode, bindDN: config.ldap.bindDN, url: config.ldap.url, groupes: { ...config.ldap.groupes } };
  const original = annuaire.verifierCompteService;
  try {
    let r = await verifierConfiguration();
    assert.ok(r.some((x) => x.domaine === 'Données' && x.statut === 'ok'));
    assert.ok(r.some((x) => x.domaine === 'Courriels' && x.statut === 'attention'), 'relais non configuré : à regarder');

    config.authMode = 'ldap';
    config.ldap.bindDN = 'CN=svc,DC=essai';
    config.ldap.url = 'ldaps://dc.essai:636';
    config.ldap.groupes = { admin: 'GG_Admin', referent: 'GG_Ref', controleur: '', utilisateur: '' };
    annuaire.verifierCompteService = async () => ({ base: true, groupes: { admin: true, referent: false } });
    r = await verifierConfiguration();
    assert.ok(r.some((x) => x.etape === 'Connexion du compte de service' && x.statut === 'ok'));
    const ref = r.find((x) => x.etape === 'Groupe des référents');
    assert.equal(ref.statut, 'echec');
    assert.match(ref.detail, /GG_Ref/);

    annuaire.verifierCompteService = async () => { throw new Error('80090308: LdapErr: AcceptSecurityContext error, data 52e, v1db1'); };
    r = await verifierConfiguration();
    assert.match(r.find((x) => x.etape === 'Connexion du compte de service').detail, /mot de passe incorrect/);
  } finally {
    annuaire.verifierCompteService = original;
    config.authMode = sauvegarde.authMode;
    config.ldap.bindDN = sauvegarde.bindDN;
    config.ldap.groupes = sauvegarde.groupes;
    config.ldap.url = sauvegarde.url;
  }
});

test('page Configuration : réglages en vigueur, secrets masqués, tests à la demande', async () => {
  const { config } = await import('../src/config.js');
  const ancien = config.smtp.password;
  config.smtp.password = 'Secret-Qui-Ne-Doit-Pas-Sortir';
  try {
    const admin = client();
    await admin.connecter('admin');
    const page = sansStyle(await (await admin.go('/admin/configuration')).text());
    assert.match(page, /SMTP_HOST, SMTP_PORT/);
    assert.match(page, /CONSERVATION_ANNEES/);
    assert.doesNotMatch(page, /Secret-Qui-Ne-Doit-Pas-Sortir/);
    const tests = sansStyle(await (await admin.go('/admin/configuration?tester=1')).text());
    assert.match(tests, /Résultat des tests/);
    const ref = client();
    await ref.connecter('ref');
    assert.equal((await ref.go('/admin/configuration')).status, 403);
  } finally {
    config.smtp.password = ancien;
  }
});
