/**
 * Rapprochement. On fabrique un registre et une extraction dont on connaît
 * chaque écart d'avance : un constat faux ferait fermer un accès légitime ou
 * laisserait ouvert un accès qui ne l'est pas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const R = await import('../src/rapprochements.js');
const { journal } = await import('../src/audit.js');

initialiserSchema();
const cat = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: cat });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'DPI', categorieId: cat });

const hab = (matricule, applicationId, statut, { nom = 'Agent', prenom = matricule, role = 'Guichet' } = {}) => {
  const h = H.creerHabilitation('test', { agent: { matricule, nom, prenom }, applicationId, role, demandeur: 'test' });
  if (statut === 'validee') H.changerStatut('test', h.id, 'valider');
  if (['executee', 'revoquee'].includes(statut)) H.changerStatut('test', h.id, 'executer');
  if (statut === 'revoquee') H.changerStatut('test', h.id, 'revoquer', { motif: 'départ' });
  return h;
};
const csv = (texte) => Buffer.from(texte, 'utf8');

// --- Lecture ----------------------------------------------------------------------

test('lecture : séparateurs, guillemets, retours à la ligne et BOM', () => {
  const t = '﻿Matricule;Nom;Profil\r\n001;"Durand; Marie";"Gestion ""élargie"""\r\n002;Martin;"ligne\nsur deux"\r\n\r\n';
  const { separateur, lignes } = R.lireCsv(R.decoder(Buffer.from(t, 'utf8')));
  assert.equal(separateur, ';');
  assert.equal(lignes.length, 3, 'la ligne vide finale est ignorée');
  assert.deepEqual(lignes[0], ['Matricule', 'Nom', 'Profil'], 'le BOM ne colle pas au premier en-tête');
  assert.equal(lignes[1][1], 'Durand; Marie', 'un séparateur entre guillemets reste dans la cellule');
  assert.equal(lignes[1][2], 'Gestion "élargie"', 'les guillemets doublés se lisent comme un seul');
  assert.equal(lignes[2][2], 'ligne\nsur deux', 'un retour à la ligne dans une cellule ne coupe pas la ligne');

  assert.equal(R.lireCsv('a,b,c\n1,2,3').separateur, ',');
  assert.equal(R.lireCsv('a\tb\tc\n1\t2\t3').separateur, '\t');
});

test('lecture : un export Windows en ANSI garde ses accents', () => {
  const ansi = Buffer.from([0x4e, 0x6f, 0x6d, 0x0a, 0x48, 0xe9, 0x6c, 0xe8, 0x6e, 0x65]);
  assert.equal(R.decoder(ansi), 'Nom\nHélène');
});

test('colonnes : une proposition tirée d’en-têtes réalistes', () => {
  assert.deepEqual(R.devinerColonnes(['N° Matricule', 'Nom Prénom', 'Profil', 'État']),
    { matricule: 0, nom: 1, profil: 2, statut: 3 });
  assert.deepEqual(R.devinerColonnes(['Login', 'Libellé', 'Groupe', 'Actif', 'MATRICULE']),
    { matricule: 4, nom: 1, profil: 2, statut: 3 });
  assert.equal(R.devinerColonnes(['A', 'B']).matricule, null, 'sans indice, l’outil ne devine pas au hasard');
});

test('matricules : les zéros de tête perdus à l’export ne cassent pas l’appariement', () => {
  assert.equal(R.normaliserMatricule(' 0012345 '), '12345');
  assert.equal(R.normaliserMatricule('12345'), '12345');
  assert.equal(R.normaliserMatricule('000'), '0');
  assert.equal(R.normaliserMatricule('e045'), 'E045', 'un matricule alphanumérique garde ses zéros');
});

test('état : les comptes désactivés sont reconnus sous leurs formes courantes', () => {
  for (const v of ['Désactivé', 'BLOQUÉ', 'inactif', '0', 'non', 'Suspendu', 'disabled']) assert.ok(R.estInactif(v), v);
  for (const v of ['Actif', 'oui', '1', '', 'Valide']) assert.ok(!R.estInactif(v), v);
});

// --- Dépôt ------------------------------------------------------------------------

test('dépôt : l’extraction est conservée avec son empreinte', () => {
  const tampon = csv('Matricule;Nom\n900;Test\n');
  const id = R.deposer('ctrl', { applicationId: gam, tampon, nom: 'extraction-gam.csv' });
  const r = R.rapprochementParId(id);
  assert.equal(r.statut, 'a_configurer');
  assert.match(r.empreinte, /^[0-9a-f]{64}$/);
  assert.deepEqual(Buffer.from(R.contenu(id)), tampon, 'le fichier est rendu octet pour octet');
  assert.equal(r.colonnes.matricule, 0, 'la colonne matricule est proposée d’emblée');
});

test('dépôt : format, contenu et taille vérifiés', () => {
  assert.throws(() => R.deposer('c', { applicationId: gam, tampon: csv('a;b\n1;2'), nom: 'x.xlsx' }), /CSV/);
  assert.throws(() => R.deposer('c', { applicationId: gam, tampon: Buffer.from([0x50, 0x4b, 0x00, 0x03]), nom: 'x.csv' }), /pas un texte/);
  assert.throws(() => R.deposer('c', { applicationId: gam, tampon: csv('Matricule\n'), nom: 'x.csv' }), /au moins un compte/);
  assert.throws(() => R.deposer('c', { applicationId: 9999, tampon: csv('a\n1'), nom: 'x.csv' }), /Application introuvable/);
});

// --- Analyse ----------------------------------------------------------------------

// Le registre de la GAM, et ce que l'application contient vraiment.
const concordant = hab('00100', gam, 'executee', { nom: 'Concorde' });
const revoque = hab('00200', gam, 'revoquee', { nom: 'Parti' });
const introuvable = hab('00300', gam, 'executee', { nom: 'Fantome', role: 'Facturation' });
const enCours = hab('00400', gam, 'validee', { nom: 'Presse' });
hab('00500', dpi, 'executee', { nom: 'Ailleurs' });
hab('00600', gam, 'executee', { nom: 'Desactive' });

const EXTRACTION = [
  'Matricule;Nom;Profil;Etat',
  '100;CONCORDE Jean;Guichet;Actif',
  '200;PARTI Paul;Guichet;Actif',
  '400;PRESSE Anne;Guichet;Actif',
  '500;AILLEURS Luc;Admissions;Actif',
  '700;INCONNU Marc;Gestionnaire;Actif',
  '600;DESACTIVE Eve;Guichet;Désactivé',
].join('\n');

let rid;
test('analyse : chaque compte rangé dans le bon constat', () => {
  rid = R.deposer('ctrl', { applicationId: gam, tampon: csv(EXTRACTION), nom: 'gam.csv' });
  const bilan = R.analyser('ctrl', rid, { matricule: 0, nom: 1, profil: 2, statut: 3 });

  const par = (categorie) => R.lignesRapprochement(rid, { categorie }).map((l) => l.matricule).sort();
  assert.deepEqual(par('concordant'), ['00100'], 'le matricule du registre fait foi, zéros compris');
  assert.deepEqual(par('revoque_present'), ['00200'], 'révoqué au registre mais toujours dans la GAM');
  assert.deepEqual(par('en_cours_present'), ['00400'], 'validé mais pas encore enregistré comme ouvert');
  assert.deepEqual(par('non_declare').sort(), ['500', '700'],
    'un accès au DPI ne couvre pas un compte GAM, et un inconnu reste inconnu');
  assert.deepEqual(par('introuvable').sort(), ['00300', '00600'],
    'absent de l’extraction, ou présent mais désactivé : dans les deux cas il n’a plus d’accès');

  assert.equal(bilan.ecarts, 6);
  assert.equal(bilan.traites, 0);
  assert.equal(R.rapprochementParId(rid).comptes, 5, 'le compte désactivé n’est pas compté comme ouvert');
});

test('analyse : les liens vers le registre sont les bons', () => {
  const lignes = R.lignesRapprochement(rid);
  assert.equal(lignes.find((l) => l.matricule === '00100').habilitation_id, concordant.id);
  assert.equal(lignes.find((l) => l.matricule === '00200').habilitation_id, revoque.id);
  assert.equal(lignes.find((l) => l.matricule === '00300').habilitation_id, introuvable.id);
  assert.equal(lignes.find((l) => l.matricule === '00400').habilitation_id, enCours.id);
  assert.equal(lignes.find((l) => l.matricule === '700').habilitation_id, null);
  assert.equal(lignes.find((l) => l.matricule === '700').profil_application, 'Gestionnaire');
});

test('analyse : sans colonne matricule, rien ne se fait', () => {
  const id = R.deposer('ctrl', { applicationId: gam, tampon: csv('A;B\n1;2'), nom: 'x.csv' });
  assert.throws(() => R.analyser('ctrl', id, { matricule: '' }), /matricule/);
});

// --- Suites -----------------------------------------------------------------------

const ligne = (matricule) => R.lignesRapprochement(rid).find((l) => l.matricule === matricule);

test('suite : une suite qui ne convient pas au constat est refusée', () => {
  assert.throws(() => R.donnerSuite('ref', ligne('00300').id, 'regularise'), /ne convient pas/);
  assert.throws(() => R.donnerSuite('ref', ligne('700').id, 'revoque'), /ne convient pas/);
});

test('régulariser : le registre rattrape la réalité, avec la référence du rapprochement', () => {
  const l = R.donnerSuite('ref', ligne('700').id, 'regularise', { role: 'Gestionnaire', nom: 'Inconnu', prenom: 'Marc' });
  assert.equal(l.suite, 'regularise');
  const h = H.habilitationParId(l.habilitation_id);
  assert.equal(h.statut, 'executee');
  assert.equal(h.matricule, '700');
  assert.equal(h.role, 'Gestionnaire');
  assert.match(h.commentaire, new RegExp(`rapprochement n°${rid}`));
});

test('régulariser un agent déjà connu ne crée pas de doublon, zéros de tête compris', () => {
  hab('00800', dpi, 'executee', { nom: 'Connu' });
  const id = R.deposer('ctrl', { applicationId: gam, tampon: csv('Matricule;Nom\n800;CONNU\n'), nom: 'g2.csv' });
  R.analyser('ctrl', id, { matricule: 0, nom: 1 });
  const l = R.lignesRapprochement(id, { categorie: 'non_declare' })[0];
  const fait = R.donnerSuite('ref', l.id, 'regularise', { role: 'Guichet' });
  assert.equal(H.habilitationParId(fait.habilitation_id).matricule, '00800', 'rattaché à l’agent existant');
  assert.equal(H.rechercherAgents('800').filter((a) => a.matricule.endsWith('800')).length, 1, 'aucun second agent');
});

test('révoquer au registre : l’accès introuvable se ferme, motif à l’appui', () => {
  R.donnerSuite('ref', ligne('00300').id, 'revoque');
  const h = H.habilitationParId(introuvable.id);
  assert.equal(h.statut, 'revoquee');
  assert.match(JSON.stringify(journal({ limite: 20 })), /Absent de l'application/);
});

test('marquer exécutée : l’ouverture qui avait échappé au registre est enregistrée', () => {
  R.donnerSuite('ref', ligne('00400').id, 'execute');
  assert.equal(H.habilitationParId(enCours.id).statut, 'executee');
});

test('fermé dans l’application : la décision est notée, le registre reste juste', () => {
  const l = R.donnerSuite('ref', ligne('00200').id, 'ferme_dans_app');
  assert.equal(l.suite, 'ferme_dans_app');
  assert.equal(H.habilitationParId(revoque.id).statut, 'revoquee', 'le registre disait déjà vrai');
});

test('un écart ne se traite qu’une fois, et le constat ne se refait plus ensuite', () => {
  assert.throws(() => R.donnerSuite('ref', ligne('00200').id, 'ferme_dans_app'), /déjà été traité/);
  assert.throws(() => R.analyser('ctrl', rid, { matricule: 0 }), /ne se refait plus/);
  const bilan = R.bilanRapprochement(rid);
  assert.equal(bilan.traites, 4);
  assert.equal(bilan.ecarts, 6);
});

test('tant que rien n’est traité, une erreur de colonne se corrige', () => {
  const id = R.deposer('ctrl', { applicationId: gam, tampon: csv('Nom;Matricule\nCONCORDE;100\n'), nom: 'g3.csv' });
  R.analyser('ctrl', id, { matricule: 0 });
  assert.equal(R.bilanRapprochement(id).parCategorie.non_declare, 1, 'mauvaise colonne : le nom pris pour un matricule');
  R.analyser('ctrl', id, { matricule: 1 });
  assert.equal(R.bilanRapprochement(id).parCategorie.concordant, 1, 'bonne colonne : le constat est refait');
});

test('chaque étape laisse sa trace au journal', () => {
  const actions = journal({ limite: 200 }).map((j) => j.action);
  for (const a of ['rapprochement:deposer', 'rapprochement:analyser', 'rapprochement:suite']) {
    assert.ok(actions.includes(a), a);
  }
});
