// Jeu de démonstration : données fictives, un compte par rôle, mot de passe commun demo-registris.

import { ouvrirDb } from './db.js';
import { hacherMotDePasse } from './auth.js';
import { creerHabilitation, changerStatut, demanderRetrait, assigner } from './habilitations.js';
import { ajouterPreuve } from './preuves.js';
import { setRoutage } from './parametres.js';
import { ouvrirCampagne, decider } from './revues.js';

export const MOT_DE_PASSE_DEMO = 'demo-registris';

const CATEGORIES = [
  ['Dossier patient et soins', 1],
  ['Gestion administrative', 2],
  ['Ressources humaines et paie', 3],
  ['Plateaux techniques', 4],
  ['Collaboratif et infrastructure', 5],
];

// [code, libellé, catégorie]
const APPLICATIONS = [
  ['DPI', 'Dossier patient informatisé', 'Dossier patient et soins'],
  ['PRESCRIPTION', 'Prescription et circuit du médicament', 'Dossier patient et soins'],
  ['URGENCES', 'Logiciel des urgences', 'Dossier patient et soins'],
  ['GAM', 'Gestion administrative des malades (admissions, facturation)', 'Gestion administrative'],
  ['GEF', 'Gestion économique et financière', 'Gestion administrative'],
  ['ARCHIVES', 'Archives médicales', 'Gestion administrative'],
  ['RH', 'Gestion des ressources humaines', 'Ressources humaines et paie'],
  ['PAIE', 'Paie', 'Ressources humaines et paie'],
  ['GTA', 'Gestion des temps et plannings', 'Ressources humaines et paie'],
  ['PACS', 'Imagerie (PACS / RIS)', 'Plateaux techniques'],
  ['LABO', 'Système de gestion de laboratoire', 'Plateaux techniques'],
  ['PHARMACIE', 'Gestion de la pharmacie', 'Plateaux techniques'],
  ['MESSAGERIE', 'Messagerie professionnelle', 'Collaboratif et infrastructure'],
  ['PARTAGE', 'Partages réseau et lecteurs', 'Collaboratif et infrastructure'],
  ['VPN', 'Accès distant (VPN)', 'Collaboratif et infrastructure'],
];

const UFS = [
  ['1101', 'Médecine polyvalente'],
  ['1203', 'Chirurgie viscérale'],
  ['2401', 'Urgences'],
  ['3105', 'Réanimation'],
  ['5002', 'Laboratoire de biologie'],
  ['9001', 'Bureau des entrées'],
  ['9010', 'Direction des ressources humaines'],
  ['9020', 'Direction des systèmes d\'information'],
];

const SITES = ['Site principal', 'Hôpital Nord', 'EHPAD Les Tilleuls'];

const COMPTES = [
  // login, nom, rôle, matricule, email
  ['admin', 'Sophie Martin', 'admin', 'A0001', 'sophie.martin@exemple.fr'],
  ['referent', 'Pierre Durand', 'referent', 'R0001', 'pierre.durand@exemple.fr'],
  ['controleur', 'Luc Bernard', 'controleur', 'C0001', 'luc.bernard@exemple.fr'],
  ['agent', 'Claire Petit', 'utilisateur', 'E45678', 'claire.petit@exemple.fr'],
];

const PACKS = [
  {
    nom: 'Secrétaire médicale',
    description: 'Accès type pour un secrétariat médical',
    elements: [['DPI', 'Secrétariat'], ['GAM', 'Consultation'], ['MESSAGERIE', 'Boîte nominative'], ['PARTAGE', 'Lecteur service']],
  },
  {
    nom: 'Infirmier / infirmière',
    description: 'Accès type soignant',
    elements: [['DPI', 'Soignant'], ['PRESCRIPTION', 'Administration'], ['MESSAGERIE', 'Boîte nominative']],
  },
  {
    nom: 'Agent du bureau des entrées',
    description: 'Accueil, admissions, facturation',
    elements: [['GAM', 'Gestionnaire admissions'], ['ARCHIVES', 'Consultation'], ['MESSAGERIE', 'Boîte nominative']],
  },
];

// PNG 1×1 pixel valide (signature + IHDR + IDAT + IEND), pour une capture factice.
const PNG_MINIMAL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const mailFactice = (objet, corps) =>
  Buffer.from(
    `From: cadre.service@exemple.fr\r\nTo: dsi@exemple.fr\r\nSubject: ${objet}\r\nDate: Mon, 02 Jun 2026 09:14:00 +0200\r\n\r\n${corps}\r\n\r\nCordialement,\r\nLe cadre de santé (données fictives de démonstration)\r\n`,
    'utf8',
  );

export function chargerDemo() {
  const db = ouvrirDb();
  if (db.prepare('SELECT COUNT(*) n FROM utilisateurs').get().n > 0) {
    console.log('La base contient déjà des comptes : démonstration non chargée.');
    return;
  }

  const insCat = db.prepare('INSERT OR IGNORE INTO categories (libelle, ordre) VALUES (?, ?)');
  for (const [libelle, ordre] of CATEGORIES) insCat.run(libelle, ordre);
  const catId = (l) => db.prepare('SELECT id FROM categories WHERE libelle = ?').get(l).id;

  const insApp = db.prepare('INSERT OR IGNORE INTO applications (code, libelle, categorie_id) VALUES (?, ?, ?)');
  for (const [code, libelle, cat] of APPLICATIONS) insApp.run(code, libelle, catId(cat));
  const appId = (code) => db.prepare('SELECT id FROM applications WHERE code = ?').get(code).id;

  const insUf = db.prepare('INSERT OR IGNORE INTO ufs (code, libelle) VALUES (?, ?)');
  for (const [code, libelle] of UFS) insUf.run(code, libelle);
  const ufId = (code) => db.prepare('SELECT id FROM ufs WHERE code = ?').get(code).id;

  const insSite = db.prepare('INSERT OR IGNORE INTO sites (nom) VALUES (?)');
  for (const s of SITES) insSite.run(s);
  const siteId = (nom) => db.prepare('SELECT id FROM sites WHERE nom = ?').get(nom).id;

  const insU = db.prepare(
    'INSERT INTO utilisateurs (login, nom, role, sel, hash_mdp, matricule, email) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [login, nom, role, matricule, email] of COMPTES) {
    const { sel, hash } = hacherMotDePasse(MOT_DE_PASSE_DEMO);
    insU.run(login, nom, role, sel, hash, matricule, email);
  }
  // Le référent de démonstration couvre la GAM et les archives.
  const insRef = db.prepare('INSERT OR IGNORE INTO referent_applications (login, application_id) VALUES (?, ?)');
  insRef.run('referent', appId('GAM'));
  insRef.run('referent', appId('ARCHIVES'));

  const insPack = db.prepare('INSERT INTO packs (nom, description, destinataire) VALUES (?, ?, ?)');
  const insPE = db.prepare('INSERT OR IGNORE INTO pack_elements (pack_id, application_id, role) VALUES (?, ?, ?)');
  for (const p of PACKS) {
    const pid = Number(insPack.run(p.nom, p.description, 'dsi@exemple.fr').lastInsertRowid);
    for (const [code, role] of p.elements) insPE.run(pid, appId(code), role);
  }

  setRoutage('admin', catId('Gestion administrative'), 'support.gam@exemple.fr');
  setRoutage('admin', catId('Dossier patient et soins'), 'support.dpi@exemple.fr');

  // Quelques habilitations à différents stades, avec des preuves factices.
  const h1 = creerHabilitation('agent', {
    agent: { matricule: 'E45678', nom: 'Petit', prenom: 'Claire', email: 'claire.petit@exemple.fr' },
    applicationId: appId('GAM'), role: 'Gestionnaire admissions', ufIds: [ufId('9001')],
    siteId: siteId('Site principal'), demandeur: 'E45678 Claire Petit', commentaire: 'Prise de poste au bureau des entrées.',
  });
  ajouterPreuve('agent', h1.id, { tampon: mailFactice('Demande accès GAM pour Claire Petit', 'Bonjour, merci d\'ouvrir un profil gestionnaire admissions à Claire Petit (E45678), qui prend son poste au bureau des entrées le 2 juin.'), nom: 'demande-acces-gam.eml' });
  changerStatut('referent', h1.id, 'valider');
  ajouterPreuve('referent', h1.id, { tampon: PNG_MINIMAL, nom: 'validation-responsable.png' });
  changerStatut('referent', h1.id, 'executer');

  const h2 = creerHabilitation('agent', {
    agent: { matricule: 'E45678', nom: 'Petit', prenom: 'Claire', email: 'claire.petit@exemple.fr' },
    applicationId: appId('ARCHIVES'), role: 'Consultation', ufIds: [ufId('9001')], demandeur: 'E45678 Claire Petit',
  });
  changerStatut('referent', h2.id, 'valider');

  const h3 = creerHabilitation('referent', {
    agent: { matricule: 'E30112', nom: 'Moreau', prenom: 'Julien', email: 'julien.moreau@exemple.fr' },
    applicationId: appId('DPI'), role: 'Soignant', ufIds: [ufId('2401')], siteId: siteId('Site principal'),
    demandeur: 'R0001 Pierre Durand', pourAutrui: true, commentaire: 'Infirmier arrivant aux urgences.',
  });
  ajouterPreuve('referent', h3.id, { tampon: mailFactice('Arrivée Julien Moreau aux urgences', 'Merci d\'ouvrir le DPI en profil soignant sur l\'UF 2401 pour Julien Moreau (E30112).'), nom: 'demande-dpi-moreau.eml' });
  changerStatut('admin', h3.id, 'valider');
  changerStatut('admin', h3.id, 'executer');

  const h4 = creerHabilitation('referent', {
    agent: { matricule: 'E30112', nom: 'Moreau', prenom: 'Julien' },
    applicationId: appId('PRESCRIPTION'), role: 'Administration', ufIds: [ufId('2401')], demandeur: 'R0001 Pierre Durand', pourAutrui: true,
  });
  changerStatut('admin', h4.id, 'executer');

  const h5 = creerHabilitation('admin', {
    agent: { matricule: 'E20987', nom: 'Lefevre', prenom: 'Anne', email: 'anne.lefevre@exemple.fr' },
    applicationId: appId('GEF'), role: 'Engagement des dépenses', ufLibre: 'Direction des achats',
    demandeur: 'A0001 Sophie Martin', pourAutrui: true, dateDemande: '2025-11-03',
  });
  changerStatut('admin', h5.id, 'valider');
  changerStatut('admin', h5.id, 'executer');
  changerStatut('admin', h5.id, 'revoquer', { motif: 'Mutation vers un autre établissement le 31/03/2026' });

  creerHabilitation('agent', {
    agent: { matricule: 'E51230', nom: 'Garcia', prenom: 'Nadia' },
    applicationId: appId('PACS'), role: 'Lecture des examens', ufIds: [ufId('1203')], demandeur: 'E45678 Claire Petit', pourAutrui: true,
  });
  creerHabilitation('agent', {
    agent: { matricule: 'E51230', nom: 'Garcia', prenom: 'Nadia' },
    applicationId: appId('VPN'), role: 'Accès distant standard', demandeur: 'E45678 Claire Petit', pourAutrui: true,
    commentaire: 'Télétravail un jour par semaine.',
  });

  // Une fermeture demandée par un cadre : l'accès reste ouvert tant qu'un
  // référent n'a pas agi, et la demande attend dans la file de traitement.
  demanderRetrait('agent', h1.id, {
    motif: 'Mutation de l\'agent au service des admissions programmées le 30/06.',
    demandeur: 'R0001 Pierre Durand',
  });
  assigner('admin', h1.id, 'referent');

  // Une demande refusée : elle quitte la file sans jamais devenir un accès.
  const h6 = creerHabilitation('agent', {
    agent: { matricule: 'E51230', nom: 'Garcia', prenom: 'Nadia' },
    applicationId: appId('GEF'), role: 'Engagement des dépenses',
    demandeur: 'E45678 Claire Petit', pourAutrui: true,
  });
  changerStatut('admin', h6.id, 'refuser', { motif: 'Profil réservé à la direction des achats.' });

  // Une campagne en cours : c'est ce qu'un auditeur demande après le registre.
  const campagne = ouvrirCampagne('admin', {
    libelle: `Revue annuelle des accès ${new Date().getFullYear()}`,
    echeance: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  });
  // Le référent ne couvre pas le dossier patient : l'administratrice y statue.
  decider('admin', campagne.id, h3.id, 'maintenue');

  console.log('Démonstration chargée. Comptes : admin, referent, controleur, agent');
  console.log(`Mot de passe commun : ${MOT_DE_PASSE_DEMO}`);
}
