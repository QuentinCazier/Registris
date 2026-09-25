// Fonctions réservées à l'administrateur.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { ouvrirDb, transaction } from './db.js';
import { hacherMotDePasse } from './auth.js';
import { tracer } from './audit.js';
import { ROLES } from './roles.js';
import { BIBLIOTHEQUE, VERSION_BIBLIOTHEQUE, fonctionParCode, produitParCode } from './logiciels.js';

const texte = (v) => String(v ?? '').trim();

// --- Catégories --------------------------------------------------------------

export function listerCategories({ tous = false } = {}) {
  return ouvrirDb()
    .prepare(`SELECT * FROM categories ${tous ? '' : 'WHERE actif = 1'} ORDER BY ordre, libelle`)
    .all();
}

export function creerCategorie(acteur, { libelle, ordre = 0 }) {
  const l = texte(libelle);
  if (!l) throw new Error('Libellé requis.');
  const db = ouvrirDb();
  if (db.prepare('SELECT 1 FROM categories WHERE libelle = ?').get(l)) throw new Error(`La catégorie « ${l} » existe déjà.`);
  const info = db.prepare('INSERT INTO categories (libelle, ordre) VALUES (?, ?)').run(l, Number(ordre) || 0);
  const id = Number(info.lastInsertRowid);
  tracer(acteur, 'categorie:creer', { entite: 'categorie', entiteId: id, details: { libelle: l } });
  return id;
}

export function supprimerCategorie(acteur, id) {
  const db = ouvrirDb();
  const n = db.prepare('SELECT COUNT(*) n FROM applications WHERE categorie_id = ?').get(Number(id)).n;
  if (n > 0) throw new Error(`Catégorie non vide (${n} application(s)). Déplacez-les d'abord.`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(id));
  tracer(acteur, 'categorie:supprimer', { entite: 'categorie', entiteId: Number(id) });
}

// --- Applications -------------------------------------------------------------

const EXT_LOGO = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'];

// Nom de stockage neutre, renvoyé à l'appelant.
export function enregistrerLogo({ tampon, nom }) {
  if (!tampon?.length || !nom) return null;
  const ext = path.extname(nom).toLowerCase();
  if (!EXT_LOGO.includes(ext)) throw new Error('Format de logo non pris en charge (png, jpg, svg, webp, gif).');
  if (tampon.length > 2 * 1024 * 1024) throw new Error('Logo trop volumineux (2 Mo maximum).');
  fs.mkdirSync(config.logosDir, { recursive: true });
  const fichier = `logo_${crypto.randomBytes(8).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(config.logosDir, fichier), tampon);
  return fichier;
}

// Un profil par ligne, sans doublon ni ligne vide.
export const normaliserProfils = (v) => [...new Set(String(v ?? '').split(/\r?\n|\|/).map((p) => p.trim()).filter(Boolean))]
  .map((p) => p.slice(0, 200)).slice(0, 50).join('\n');

export function creerApplication(acteur, { code, libelle, categorieId, logo, profils = '' }) {
  const c = texte(code).toUpperCase();
  const l = texte(libelle);
  if (!c || !l) throw new Error('Code et libellé requis.');
  if (!/^[A-Z0-9_.-]{2,40}$/.test(c)) throw new Error('Code invalide : lettres, chiffres, tirets et points, 2 à 40 caractères.');
  const db = ouvrirDb();
  if (db.prepare('SELECT 1 FROM applications WHERE code = ?').get(c)) throw new Error(`L'application « ${c} » existe déjà.`);
  const cat = categorieId ? db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(categorieId)) : null;
  const info = db
    .prepare('INSERT INTO applications (code, libelle, categorie_id, logo, profils) VALUES (?, ?, ?, ?, ?)')
    .run(c, l, cat?.id ?? null, logo ?? null, normaliserProfils(profils) || null);
  const id = Number(info.lastInsertRowid);
  tracer(acteur, 'application:creer', { entite: 'application', entiteId: id, details: { code: c, libelle: l } });
  return id;
}

export function modifierApplication(acteur, id, { libelle, categorieId, logo, actif, profils }) {
  const db = ouvrirDb();
  const a = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(id));
  if (!a) throw new Error('Application introuvable.');
  const l = texte(libelle) || a.libelle;
  const cat = categorieId ? db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(categorieId)) : null;
  const catId = categorieId === '' ? null : cat ? cat.id : a.categorie_id;
  const act = actif === undefined ? a.actif : actif ? 1 : 0;
  const prof = profils === undefined ? a.profils : normaliserProfils(profils) || null;
  db.prepare('UPDATE applications SET libelle = ?, categorie_id = ?, logo = ?, actif = ?, profils = ? WHERE id = ?').run(
    l, catId, logo ?? a.logo, act, prof, a.id,
  );
  tracer(acteur, 'application:modifier', { entite: 'application', entiteId: a.id, details: { libelle: l, actif: act } });
}

export function supprimerApplication(acteur, id) {
  const db = ouvrirDb();
  const n = db.prepare('SELECT COUNT(*) n FROM habilitations WHERE application_id = ?').get(Number(id)).n;
  if (n > 0) {
    throw new Error(`Impossible : ${n} habilitation(s) référencent cette application. Désactivez-la plutôt.`);
  }
  db.prepare('DELETE FROM applications WHERE id = ?').run(Number(id));
  tracer(acteur, 'application:supprimer', { entite: 'application', entiteId: Number(id) });
}

// --- Bibliothèque de logiciels ----------------------------------------------------

// Marque les produits déjà au catalogue, reconnus par leur code.
export function etatBibliotheque() {
  const presents = new Set(ouvrirDb().prepare('SELECT code FROM applications').all().map((a) => a.code));
  return BIBLIOTHEQUE.map((f) => ({
    ...f,
    produits: f.produits.map((pr) => ({ ...pr, present: presents.has(pr.code) })),
  }));
}

// Ajoute les produits choisis ; la fonction devient la catégorie, créée si elle manque.
export function ajouterDepuisBibliotheque(acteur, codes = []) {
  const voulus = [...new Set([].concat(codes).map((c) => String(c).trim()).filter(Boolean))];
  const choisis = voulus.map(produitParCode).filter(Boolean);
  if (!choisis.length) throw new Error('Sélectionnez au moins un logiciel.');

  const db = ouvrirDb();
  return transaction(() => {
    const bilan = { ajoutees: [], existantes: [], categorieCreees: [] };
    const categories = new Map(listerCategories({ tous: true }).map((c) => [c.libelle, c.id]));

    for (const produit of choisis) {
      if (db.prepare('SELECT 1 FROM applications WHERE code = ?').get(produit.code)) {
        bilan.existantes.push(produit.nom);
        continue;
      }
      const fonction = fonctionParCode(produit.fonction);
      let categorieId = categories.get(fonction.libelle);
      if (!categorieId) {
        categorieId = creerCategorie(acteur, { libelle: fonction.libelle, ordre: BIBLIOTHEQUE.indexOf(fonction) + 1 });
        categories.set(fonction.libelle, categorieId);
        bilan.categorieCreees.push(fonction.libelle);
      }
      creerApplication(acteur, { code: produit.code, libelle: produit.nom, categorieId });
      bilan.ajoutees.push(produit.nom);
    }

    if (bilan.ajoutees.length) {
      tracer(acteur, 'bibliotheque:ajouter', {
        details: { version: VERSION_BIBLIOTHEQUE, ajoutees: bilan.ajoutees.length, logiciels: bilan.ajoutees },
      });
    }
    return bilan;
  });
}

// --- Référentiels : UF et sites --------------------------------------------------

export function creerUf(acteur, { code, libelle }) {
  const c = texte(code);
  const l = texte(libelle);
  if (!c || !l) throw new Error('Code et libellé d\'UF requis.');
  const db = ouvrirDb();
  if (db.prepare('SELECT 1 FROM ufs WHERE code = ?').get(c)) throw new Error(`L'UF « ${c} » existe déjà.`);
  const info = db.prepare('INSERT INTO ufs (code, libelle) VALUES (?, ?)').run(c, l);
  tracer(acteur, 'uf:creer', { entite: 'uf', entiteId: Number(info.lastInsertRowid), details: { code: c, libelle: l } });
}

export function supprimerUf(acteur, id) {
  const db = ouvrirDb();
  const n = db.prepare('SELECT COUNT(*) n FROM habilitation_ufs WHERE uf_id = ?').get(Number(id)).n;
  if (n > 0) throw new Error(`Impossible : ${n} habilitation(s) référencent cette UF.`);
  db.prepare('DELETE FROM ufs WHERE id = ?').run(Number(id));
  tracer(acteur, 'uf:supprimer', { entite: 'uf', entiteId: Number(id) });
}

export function creerSite(acteur, nom) {
  const n = texte(nom);
  if (!n) throw new Error('Nom du site requis.');
  const db = ouvrirDb();
  if (db.prepare('SELECT 1 FROM sites WHERE nom = ?').get(n)) throw new Error(`Le site « ${n} » existe déjà.`);
  const info = db.prepare('INSERT INTO sites (nom) VALUES (?)').run(n);
  tracer(acteur, 'site:creer', { entite: 'site', entiteId: Number(info.lastInsertRowid), details: { nom: n } });
}

export function supprimerSite(acteur, id) {
  const db = ouvrirDb();
  const n = db.prepare('SELECT COUNT(*) n FROM habilitations WHERE site_id = ?').get(Number(id)).n;
  if (n > 0) throw new Error(`Impossible : ${n} habilitation(s) référencent ce site.`);
  db.prepare('DELETE FROM sites WHERE id = ?').run(Number(id));
  tracer(acteur, 'site:supprimer', { entite: 'site', entiteId: Number(id) });
}

// --- Comptes locaux et périmètre des référents -------------------------------------

export function listerUtilisateurs({ q = '', role = '' } = {}) {
  const db = ouvrirDb();
  const cond = [];
  const args = [];
  if (role) {
    cond.push('role = ?');
    args.push(role);
  }
  if (texte(q)) {
    const like = `%${texte(q)}%`;
    cond.push('(login LIKE ? OR nom LIKE ? OR matricule LIKE ?)');
    args.push(like, like, like);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const users = db
    .prepare(`SELECT id, login, nom, role, matricule, email, actif FROM utilisateurs ${where} ORDER BY nom`)
    .all(...args);
  const perimetres = perimetresReferents();
  return users.map((u) => ({ ...u, applications: perimetres.get(u.login.toLowerCase()) ?? [] }));
}

// Identifiant (en minuscules) vers le nom affiché, comptes locaux et comptes de l'annuaire confondus.
export function nomsActeurs() {
  const db = ouvrirDb();
  const m = new Map();
  for (const c of db.prepare('SELECT login, nom FROM comptes_annuaire').all()) m.set(c.login.toLowerCase(), c.nom);
  for (const u of db.prepare('SELECT login, nom FROM utilisateurs').all()) m.set(u.login.toLowerCase(), u.nom);
  return (login) => m.get(String(login ?? '').toLowerCase()) ?? String(login ?? '');
}

// Étapes de mise en service, dans l'ordre où un administrateur les franchit.
export function etatMiseEnRoute() {
  const db = ouvrirDb();
  const n = (sql) => db.prepare(sql).get().n;
  const categories = n('SELECT COUNT(*) n FROM categories WHERE actif = 1');
  const applications = n('SELECT COUNT(*) n FROM applications WHERE actif = 1');
  const sansReferent = n(`SELECT COUNT(*) n FROM applications a WHERE a.actif = 1
    AND NOT EXISTS (SELECT 1 FROM referent_applications ra WHERE ra.application_id = a.id)`);
  const referentsGlobaux = n(`SELECT COUNT(*) n FROM utilisateurs u WHERE u.actif = 1 AND u.role = 'referent'
    AND NOT EXISTS (SELECT 1 FROM referent_applications ra WHERE ra.login = u.login COLLATE NOCASE)`);
  const ufs = n('SELECT COUNT(*) n FROM ufs');
  const categoriesSansCourriel = n(`SELECT COUNT(*) n FROM categories c WHERE c.actif = 1
    AND COALESCE((SELECT valeur FROM parametres p WHERE p.cle = 'routage:' || c.id), '') = ''`);
  const etapes = [
    { cle: 'categories', fait: categories > 0, titre: 'Créer les catégories', detail: 'Elles rangent le catalogue en onglets : soins, gestion, ressources humaines…', lien: '/admin/categories' },
    { cle: 'applications', fait: applications > 0, titre: 'Déclarer les applications', detail: 'Une par une, depuis la bibliothèque, ou en important un tableur.', lien: '/admin/import' },
    { cle: 'referents', fait: applications > 0 && (sansReferent === 0 || referentsGlobaux > 0), titre: 'Désigner un référent par application', detail: sansReferent ? `${sansReferent} application${sansReferent >= 2 ? 's' : ''} sans référent : leurs demandes n'arrivent chez personne.` : 'Chaque demande arrive chez la personne qui ouvre les droits.', lien: '/admin/utilisateurs' },
    { cle: 'ufs', fait: ufs > 0, titre: 'Importer les unités fonctionnelles', detail: "Les agents choisissent leur service dans une liste au lieu de l'écrire.", lien: '/admin/import' },
    { cle: 'courriels', fait: categories > 0 && categoriesSansCourriel === 0, titre: 'Indiquer les adresses de notification', detail: "L'équipe qui ouvre les droits est prévenue de chaque nouvelle demande.", lien: '/admin/routage' },
  ];
  return { etapes, faites: etapes.filter((e) => e.fait).length, total: etapes.length };
}

// login -> libellés des applications, logins locaux et annuaire confondus.
export function perimetresReferents() {
  const lignes = ouvrirDb()
    .prepare(
      `SELECT ra.login, a.id, a.libelle FROM referent_applications ra
         JOIN applications a ON a.id = ra.application_id ORDER BY ra.login, a.libelle`,
    )
    .all();
  const m = new Map();
  for (const l of lignes) {
    const login = l.login.toLowerCase();
    if (!m.has(login)) m.set(login, []);
    m.get(login).push({ id: l.id, libelle: l.libelle });
  }
  return m;
}

// Traitants possibles : admin, référents couvrant l'application ou sans périmètre, comptes locaux
// comme comptes de l'annuaire déjà vus, et identifiants jamais vus mais dotés d'un périmètre.
export function traitantsPossibles(applicationId) {
  const id = Number(applicationId);
  const couvre = (login) => `(EXISTS (SELECT 1 FROM referent_applications ra WHERE ra.login = ${login} COLLATE NOCASE AND ra.application_id = ?)
       OR NOT EXISTS (SELECT 1 FROM referent_applications ra WHERE ra.login = ${login} COLLATE NOCASE))`;
  return ouvrirDb()
    .prepare(
      `SELECT login, nom, role FROM (
         SELECT u.login, u.nom, u.role FROM utilisateurs u
          WHERE u.actif = 1 AND (u.role = 'admin' OR (u.role = 'referent' AND ${couvre('u.login')}))
         UNION
         SELECT c.login, c.nom, c.role FROM comptes_annuaire c
          WHERE NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.login = c.login COLLATE NOCASE)
            AND (c.role = 'admin' OR (c.role = 'referent' AND ${couvre('c.login')}))
         UNION
         SELECT ra.login, ra.login AS nom, 'referent' AS role FROM referent_applications ra
          WHERE ra.application_id = ?
            AND NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.login = ra.login COLLATE NOCASE)
            AND NOT EXISTS (SELECT 1 FROM comptes_annuaire c WHERE c.login = ra.login COLLATE NOCASE)
       )
        ORDER BY CASE role WHEN 'referent' THEN 0 ELSE 1 END, nom`,
    )
    .all(id, id, id);
}

// L'identifiant est rangé en minuscules : l'annuaire ignore la casse, la jointure doit l'ignorer aussi.
export function definirPerimetreReferent(acteur, login, applicationIds = []) {
  const l = texte(login).toLowerCase();
  if (!l) throw new Error('Identifiant requis.');
  const ids = [...new Set([].concat(applicationIds).map(Number).filter(Boolean))];
  const db = ouvrirDb();
  transaction(() => {
    db.prepare('DELETE FROM referent_applications WHERE login = ?').run(l);
    const lien = db.prepare('INSERT OR IGNORE INTO referent_applications (login, application_id) VALUES (?, ?)');
    for (const id of ids) lien.run(l, id);
  });
  tracer(acteur, 'referent:perimetre', { entite: 'utilisateur', details: { login: l, applications: ids } });
}

export function creerUtilisateur(acteur, { login, nom, role, motDePasse, matricule, email, applicationIds = [] }) {
  const l = texte(login);
  if (!l || !texte(nom) || !motDePasse) throw new Error('Identifiant, nom et mot de passe requis.');
  if (String(motDePasse).length < 12) throw new Error('Mot de passe trop court (12 caractères minimum).');
  if (!ROLES.includes(role)) throw new Error(`Rôle inconnu : ${role}`);
  const db = ouvrirDb();
  if (db.prepare('SELECT 1 FROM utilisateurs WHERE login = ? COLLATE NOCASE').get(l)) throw new Error(`Le compte « ${l} » existe déjà.`);
  const { sel, hash } = hacherMotDePasse(motDePasse);
  transaction(() => {
    db.prepare(
      'INSERT INTO utilisateurs (login, nom, role, sel, hash_mdp, matricule, email) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(l, texte(nom), role, sel, hash, texte(matricule) || null, texte(email) || null);
    if (role === 'referent') definirPerimetreReferent(acteur, l, applicationIds);
  });
  tracer(acteur, 'utilisateur:creer', { entite: 'utilisateur', details: { login: l, role } });
}

export function utilisateurParLogin(login) {
  const db = ouvrirDb();
  const u = db.prepare('SELECT id, login, nom, role, matricule, email, actif FROM utilisateurs WHERE login = ? COLLATE NOCASE').get(login);
  if (!u) return null;
  u.applicationIds = db
    .prepare('SELECT application_id FROM referent_applications WHERE login = ? COLLATE NOCASE')
    .all(login)
    .map((r) => r.application_id);
  return u;
}

export function emailUtilisateur(login) {
  if (!login) return null;
  const db = ouvrirDb();
  return db.prepare('SELECT email FROM utilisateurs WHERE login = ? COLLATE NOCASE').get(login)?.email
    || db.prepare('SELECT email FROM comptes_annuaire WHERE login = ? COLLATE NOCASE').get(login)?.email
    || null;
}

// --- Comptes de l'annuaire vus à la connexion ---------------------------------------------

// C'est ce qui permet de confier une demande à un référent de l'annuaire et de lui écrire.
export function memoriserCompteAnnuaire({ login, nom, email, matricule, role }) {
  ouvrirDb()
    .prepare(
      `INSERT INTO comptes_annuaire (login, nom, email, matricule, role, vu_le)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(login) DO UPDATE SET nom = excluded.nom, email = excluded.email,
         matricule = excluded.matricule, role = excluded.role, vu_le = excluded.vu_le`,
    )
    .run(String(login).toLowerCase(), texte(nom) || String(login), texte(email) || null, texte(matricule) || null, role);
}

export function listerComptesAnnuaire() {
  const perimetres = perimetresReferents();
  return ouvrirDb()
    .prepare('SELECT * FROM comptes_annuaire ORDER BY nom')
    .all()
    .map((c) => ({ ...c, applications: perimetres.get(c.login) ?? [] }));
}

const compterAdmins = (db) =>
  db.prepare("SELECT COUNT(*) n FROM utilisateurs WHERE role = 'admin' AND actif = 1").get().n;

export function modifierUtilisateur(acteur, login, { nom, role, motDePasse, matricule, email, actif, applicationIds = [] }) {
  const db = ouvrirDb();
  const u = db.prepare('SELECT * FROM utilisateurs WHERE login = ?').get(login);
  if (!u) throw new Error('Compte introuvable.');
  if (!ROLES.includes(role)) throw new Error(`Rôle inconnu : ${role}`);
  const act = actif === undefined ? u.actif : actif ? 1 : 0;
  if (u.role === 'admin' && u.actif && (role !== 'admin' || !act) && compterAdmins(db) <= 1) {
    throw new Error("Impossible : c'est le dernier administrateur actif.");
  }
  if (motDePasse && String(motDePasse).length < 12) throw new Error('Mot de passe trop court (12 caractères minimum).');
  transaction(() => {
    db.prepare('UPDATE utilisateurs SET nom = ?, role = ?, matricule = ?, email = ?, actif = ? WHERE login = ?').run(
      texte(nom) || u.nom, role, texte(matricule) || null, texte(email) || null, act, login,
    );
    if (motDePasse) {
      const { sel, hash } = hacherMotDePasse(motDePasse);
      db.prepare('UPDATE utilisateurs SET sel = ?, hash_mdp = ? WHERE login = ?').run(sel, hash, login);
    }
    definirPerimetreReferent(acteur, login, role === 'referent' ? applicationIds : []);
  });
  tracer(acteur, 'utilisateur:modifier', {
    entite: 'utilisateur',
    details: { login, role, actif: act, mdp_reinitialise: Boolean(motDePasse) },
  });
}

export function supprimerUtilisateur(acteur, login) {
  const db = ouvrirDb();
  const u = db.prepare('SELECT role, actif FROM utilisateurs WHERE login = ?').get(login);
  if (!u) return;
  if (u.role === 'admin' && u.actif && compterAdmins(db) <= 1) {
    throw new Error("Impossible : c'est le dernier administrateur actif.");
  }
  transaction(() => {
    db.prepare('DELETE FROM referent_applications WHERE login = ?').run(login);
    db.prepare('DELETE FROM utilisateurs WHERE login = ?').run(login);
  });
  tracer(acteur, 'utilisateur:supprimer', { entite: 'utilisateur', details: { login } });
}

// --- Packs « nouvel arrivant » ---------------------------------------------------

export function listerPacks({ tous = false } = {}) {
  return ouvrirDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM pack_elements pe WHERE pe.pack_id = p.id) AS nb
         FROM packs p ${tous ? '' : 'WHERE p.actif = 1'} ORDER BY p.nom`,
    )
    .all();
}

export function packParId(id) {
  const db = ouvrirDb();
  const p = db.prepare('SELECT * FROM packs WHERE id = ?').get(Number(id));
  if (!p) return null;
  p.elements = db
    .prepare(
      `SELECT pe.application_id, pe.role, a.libelle AS app_libelle, a.code AS app_code
         FROM pack_elements pe JOIN applications a ON a.id = pe.application_id
        WHERE pe.pack_id = ? ORDER BY a.libelle`,
    )
    .all(p.id);
  return p;
}

export function creerPack(acteur, { nom, description, destinataire }) {
  const n = texte(nom);
  if (!n) throw new Error('Nom du pack requis.');
  const db = ouvrirDb();
  if (db.prepare('SELECT 1 FROM packs WHERE nom = ?').get(n)) throw new Error(`Le pack « ${n} » existe déjà.`);
  const info = db
    .prepare('INSERT INTO packs (nom, description, destinataire) VALUES (?, ?, ?)')
    .run(n, texte(description), texte(destinataire));
  const id = Number(info.lastInsertRowid);
  tracer(acteur, 'pack:creer', { entite: 'pack', entiteId: id, details: { nom: n } });
  return id;
}

export function modifierPack(acteur, id, { nom, description, destinataire, actif }) {
  const db = ouvrirDb();
  const p = db.prepare('SELECT * FROM packs WHERE id = ?').get(Number(id));
  if (!p) throw new Error('Pack introuvable.');
  db.prepare('UPDATE packs SET nom = ?, description = ?, destinataire = ?, actif = ? WHERE id = ?').run(
    texte(nom) || p.nom, texte(description), texte(destinataire), actif === undefined ? p.actif : actif ? 1 : 0, p.id,
  );
  tracer(acteur, 'pack:modifier', { entite: 'pack', entiteId: p.id });
}

export function supprimerPack(acteur, id) {
  ouvrirDb().prepare('DELETE FROM packs WHERE id = ?').run(Number(id));
  tracer(acteur, 'pack:supprimer', { entite: 'pack', entiteId: Number(id) });
}

export function ajouterElementPack(acteur, packId, applicationId, role) {
  const db = ouvrirDb();
  if (!db.prepare('SELECT 1 FROM applications WHERE id = ?').get(Number(applicationId))) throw new Error('Application inconnue.');
  db.prepare('INSERT OR REPLACE INTO pack_elements (pack_id, application_id, role) VALUES (?, ?, ?)').run(
    Number(packId), Number(applicationId), texte(role),
  );
  tracer(acteur, 'pack:element-ajouter', { entite: 'pack', entiteId: Number(packId), details: { applicationId: Number(applicationId) } });
}

export function retirerElementPack(acteur, packId, applicationId) {
  ouvrirDb().prepare('DELETE FROM pack_elements WHERE pack_id = ? AND application_id = ?').run(Number(packId), Number(applicationId));
  tracer(acteur, 'pack:element-retirer', { entite: 'pack', entiteId: Number(packId), details: { applicationId: Number(applicationId) } });
}
