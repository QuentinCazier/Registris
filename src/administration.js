/**
 * Fonctions réservées à l'administrateur : catalogue (catégories, applications,
 * logos), référentiels (UF, sites), packs « nouvel arrivant », comptes locaux et
 * périmètre des référents.
 *
 * En mode LDAP, les comptes et rôles viennent de l'annuaire ; seuls le catalogue,
 * les référentiels, les packs et le périmètre des référents restent gérés ici.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { ouvrirDb, transaction } from './db.js';
import { hacherMotDePasse } from './auth.js';
import { tracer } from './audit.js';
import { ROLES } from './roles.js';

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

/** Stocke un logo téléversé sous un nom neutre ; renvoie ce nom. */
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

export function creerApplication(acteur, { code, libelle, categorieId, logo }) {
  const c = texte(code).toUpperCase();
  const l = texte(libelle);
  if (!c || !l) throw new Error('Code et libellé requis.');
  if (!/^[A-Z0-9_.-]{2,40}$/.test(c)) throw new Error('Code invalide : lettres, chiffres, tirets et points, 2 à 40 caractères.');
  const db = ouvrirDb();
  if (db.prepare('SELECT 1 FROM applications WHERE code = ?').get(c)) throw new Error(`L'application « ${c} » existe déjà.`);
  const cat = categorieId ? db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(categorieId)) : null;
  const info = db
    .prepare('INSERT INTO applications (code, libelle, categorie_id, logo) VALUES (?, ?, ?, ?)')
    .run(c, l, cat?.id ?? null, logo ?? null);
  const id = Number(info.lastInsertRowid);
  tracer(acteur, 'application:creer', { entite: 'application', entiteId: id, details: { code: c, libelle: l } });
  return id;
}

export function modifierApplication(acteur, id, { libelle, categorieId, logo, actif }) {
  const db = ouvrirDb();
  const a = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(id));
  if (!a) throw new Error('Application introuvable.');
  const l = texte(libelle) || a.libelle;
  const cat = categorieId ? db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(categorieId)) : null;
  const catId = categorieId === '' ? null : cat ? cat.id : a.categorie_id;
  const act = actif === undefined ? a.actif : actif ? 1 : 0;
  db.prepare('UPDATE applications SET libelle = ?, categorie_id = ?, logo = ?, actif = ? WHERE id = ?').run(
    l, catId, logo ?? a.logo, act, a.id,
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
  return users.map((u) => ({ ...u, applications: perimetres.get(u.login) ?? [] }));
}

/** Map login -> libellés des applications du périmètre (tous logins, locaux ou annuaire). */
export function perimetresReferents() {
  const lignes = ouvrirDb()
    .prepare(
      `SELECT ra.login, a.id, a.libelle FROM referent_applications ra
         JOIN applications a ON a.id = ra.application_id ORDER BY ra.login, a.libelle`,
    )
    .all();
  const m = new Map();
  for (const l of lignes) {
    if (!m.has(l.login)) m.set(l.login, []);
    m.get(l.login).push({ id: l.id, libelle: l.libelle });
  }
  return m;
}

/** Remplace le périmètre d'un référent (login local ou identifiant annuaire). */
export function definirPerimetreReferent(acteur, login, applicationIds = []) {
  const l = texte(login);
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
  if (db.prepare('SELECT 1 FROM utilisateurs WHERE login = ?').get(l)) throw new Error(`Le compte « ${l} » existe déjà.`);
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
  const u = db.prepare('SELECT id, login, nom, role, matricule, email, actif FROM utilisateurs WHERE login = ?').get(login);
  if (!u) return null;
  u.applicationIds = db
    .prepare('SELECT application_id FROM referent_applications WHERE login = ?')
    .all(login)
    .map((r) => r.application_id);
  return u;
}

/** Courriel d'un compte local (pour notifier le demandeur). Null si inconnu. */
export function emailUtilisateur(login) {
  if (!login) return null;
  return ouvrirDb().prepare('SELECT email FROM utilisateurs WHERE login = ?').get(login)?.email || null;
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
