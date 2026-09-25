// API en lecture : jetons d'accès et requêtes servies aux outils de l'établissement (GLPI, supervision).

import crypto from 'node:crypto';

import { ouvrirDb } from './db.js';
import { tracer } from './audit.js';
import { CONDITION_FILE, STATUTS } from './habilitations.js';

const empreinte = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex');

// Le jeton n'est montré qu'une fois ; la base n'en garde que l'empreinte.
export function creerJeton(acteur, nom) {
  const n = String(nom ?? '').trim().slice(0, 80);
  if (!n) throw new Error('Donnez un nom au jeton : l’outil qui l’utilisera, par exemple « GLPI ».');
  const jeton = `rgs_${crypto.randomBytes(24).toString('base64url')}`;
  const info = ouvrirDb()
    .prepare('INSERT INTO jetons_api (nom, prefixe, empreinte, cree_par) VALUES (?, ?, ?, ?)')
    .run(n, jeton.slice(0, 10), empreinte(jeton), acteur);
  tracer(acteur, 'api:jeton-creer', { entite: 'jeton', entiteId: Number(info.lastInsertRowid), details: { nom: n } });
  return { id: Number(info.lastInsertRowid), jeton };
}

export function listerJetons() {
  return ouvrirDb().prepare('SELECT id, nom, prefixe, cree_par, cree_le, dernier_usage, usages, actif FROM jetons_api ORDER BY actif DESC, cree_le DESC').all();
}

export function revoquerJeton(acteur, id) {
  const r = ouvrirDb().prepare('UPDATE jetons_api SET actif = 0 WHERE id = ? AND actif = 1').run(Number(id));
  if (!r.changes) throw new Error('Jeton introuvable ou déjà révoqué.');
  tracer(acteur, 'api:jeton-revoquer', { entite: 'jeton', entiteId: Number(id) });
}

export function jetonValide(jeton) {
  if (!/^rgs_[\w-]{20,}$/.test(String(jeton ?? ''))) return null;
  const db = ouvrirDb();
  const j = db.prepare('SELECT id, nom FROM jetons_api WHERE empreinte = ? AND actif = 1').get(empreinte(jeton));
  if (j) db.prepare("UPDATE jetons_api SET dernier_usage = datetime('now'), usages = usages + 1 WHERE id = ?").run(j.id);
  return j ?? null;
}

// --- Représentation publique ---------------------------------------------------------------------

const ETAT = {
  demandee: 'demandee', validee: 'validee', executee: 'ouverte', revoquee: 'fermee', refusee: 'refusee',
};

export function versApi(h, ufs = []) {
  return {
    id: h.id,
    agent: { matricule: h.matricule, nom: h.nom, prenom: h.prenom },
    application: { code: h.app_code, libelle: h.app_libelle },
    profil: h.role,
    etat: ETAT[h.statut] ?? h.statut,
    fermeture_demandee: h.retrait_demande_le ? { le: h.retrait_demande_le, motif: h.retrait_motif } : null,
    accord_cadre: h.accord_cadre ?? null,
    ufs,
    date_fin: h.date_fin ?? null,
    dates: {
      demande: h.date_demande, validation: h.date_validation, ouverture: h.date_realisation,
      fermeture: h.date_revocation, refus: h.date_refus, modification: h.maj_le,
    },
    prise_en_charge: h.assigne_a ?? null,
    pieces: h.nb_preuves ?? undefined,
  };
}

const SELECT = `SELECT h.*, a.code AS app_code, a.libelle AS app_libelle, ag.matricule, ag.nom, ag.prenom,
       (SELECT COUNT(*) FROM preuves p WHERE p.habilitation_id = h.id) AS nb_preuves
  FROM habilitations h JOIN applications a ON a.id = h.application_id JOIN agents ag ON ag.id = h.agent_id`;

function ufsDe(ids) {
  const m = new Map();
  if (!ids.length) return m;
  const lignes = ouvrirDb()
    .prepare(`SELECT hu.habilitation_id, u.code FROM habilitation_ufs hu JOIN ufs u ON u.id = hu.uf_id
               WHERE hu.habilitation_id IN (${ids.map(() => '?').join(',')}) ORDER BY u.code`)
    .all(...ids);
  for (const l of lignes) {
    if (!m.has(l.habilitation_id)) m.set(l.habilitation_id, []);
    m.get(l.habilitation_id).push(l.code);
  }
  return m;
}
const enrichir = (lignes) => {
  const ufs = ufsDe(lignes.map((h) => h.id));
  return lignes.map((h) => versApi(h, ufs.get(h.id) ?? []));
};

// Pagination par curseur : `apres` est le dernier id reçu.
/** @param {{ statut?: string, application?: string, modifieDepuis?: string, apres?: number, limite?: number, enAttente?: boolean }} [criteres] */
export function habilitationsApi({ statut = '', application = '', modifieDepuis = '', apres = 0, limite = 100, enAttente = false } = {}) {
  const cond = ['h.id > ?'];
  /** @type {Array<string | number>} */
  const args = [Number(apres) || 0];
  if (enAttente) cond.push(CONDITION_FILE);
  const st = Object.entries(ETAT).find(([, v]) => v === statut)?.[0] ?? (STATUTS.includes(statut) ? statut : '');
  if (statut && !st) throw new Error(`État inconnu : ${statut}. Valeurs : ${Object.values(ETAT).join(', ')}.`);
  if (st) { cond.push('h.statut = ?'); args.push(st); }
  if (application) { cond.push('a.code = ?'); args.push(String(application).toUpperCase()); }
  if (modifieDepuis) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(modifieDepuis)) throw new Error('modifie_depuis attend une date AAAA-MM-JJ.');
    cond.push('h.maj_le >= ?'); args.push(String(modifieDepuis).replace('T', ' ').slice(0, 19));
  }
  const n = Math.min(Math.max(Number(limite) || 100, 1), 500);
  const lignes = ouvrirDb().prepare(`${SELECT} WHERE ${cond.join(' AND ')} ORDER BY h.id LIMIT ?`).all(...args, n + 1);
  const suite = lignes.length > n;
  const page = lignes.slice(0, n);
  return { habilitations: enrichir(page), suivant: suite ? page.at(-1).id : null };
}

export function accesAgentApi(matricule, { tous = false } = {}) {
  const ag = ouvrirDb().prepare('SELECT matricule, nom, prenom, email FROM agents WHERE matricule = ?').get(String(matricule ?? '').trim());
  if (!ag) return null;
  const lignes = ouvrirDb()
    .prepare(`${SELECT} WHERE ag.matricule = ? ${tous ? '' : "AND h.statut IN ('demandee', 'validee', 'executee')"} ORDER BY h.id`)
    .all(ag.matricule);
  return { agent: ag, acces: enrichir(lignes) };
}

export function applicationsApi() {
  return ouvrirDb()
    .prepare(`SELECT a.code, a.libelle, c.libelle AS categorie, a.actif, a.accord_cadre,
                     (SELECT COUNT(*) FROM habilitations h WHERE h.application_id = a.id AND h.statut = 'executee') AS acces_ouverts
                FROM applications a LEFT JOIN categories c ON c.id = a.categorie_id ORDER BY a.code`)
    .all()
    .map((a) => ({ ...a, actif: Boolean(a.actif), accord_cadre: Boolean(a.accord_cadre) }));
}
