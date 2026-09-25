// Tenue en charge : un registre d'établissement important, puis le temps de réponse des pages courantes.
//   node scripts/charge.mjs [habilitations=50000] [agents=12000]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HABILITATIONS = Number(process.argv[2] ?? 50000);
const AGENTS = Number(process.argv[3] ?? 12000);
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'registris-charge-'));
Object.assign(process.env, {
  DB_PATH: path.join(dossier, 'charge.db'), PREUVES_DIR: path.join(dossier, 'preuves'), LOGOS_DIR: path.join(dossier, 'logos'),
  SMTP_HOST: '', AUTH_MODE: 'local', SESSION_SECRET: 'secret-de-charge-suffisamment-long', NODE_ENV: 'test', ENTRETIEN_AUTO: 'non',
});

const { initialiserSchema, ouvrirDb, transaction } = await import('../src/db.js');
const A = await import('../src/administration.js');
const { tracer, verifierChaine, enregistrerControle } = await import('../src/audit.js');
const { creerApp } = await import('../src/serveur.js');

const t0 = performance.now();
initialiserSchema();
const db = ouvrirDb();
const MDP = 'mot-de-passe-de-charge';
A.creerUtilisateur('charge', { login: 'admin', nom: 'Admin Charge', role: 'admin', motDePasse: MDP });

const alea = ((graine) => () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648))(42);
const choix = (t) => t[Math.floor(alea() * t.length)];
const NOMS = ['Martin', 'Bernard', 'Thomas', 'Petit', 'Robert', 'Richard', 'Durand', 'Dubois', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefebvre', 'Leroy', 'Roux', 'David'];
const PRENOMS = ['Marie', 'Jean', 'Claire', 'Pierre', 'Sophie', 'Luc', 'Anne', 'Paul', 'Julie', 'Marc', 'Nadia', 'Louis'];
const STATUTS = [['executee', 0.62], ['revoquee', 0.2], ['refusee', 0.05], ['demandee', 0.08], ['validee', 0.05]];
const statut = () => { let x = alea(); for (const [s, p] of STATUTS) { if ((x -= p) <= 0) return s; } return 'executee'; };
const date = (maxJours) => new Date(Date.now() - Math.floor(alea() * maxJours) * 86400000).toISOString().slice(0, 10);

transaction(() => {
  for (let c = 1; c <= 8; c += 1) db.prepare('INSERT INTO categories (libelle, ordre) VALUES (?, ?)').run(`Catégorie ${c}`, c);
  for (let a = 1; a <= 80; a += 1) db.prepare('INSERT INTO applications (code, libelle, categorie_id, profils) VALUES (?, ?, ?, ?)').run(`APP${a}`, `Application ${a}`, 1 + (a % 8), 'Consultation\nSaisie\nAdministration');
  for (let u = 1; u <= 300; u += 1) db.prepare('INSERT INTO ufs (code, libelle) VALUES (?, ?)').run(String(1000 + u), `Unité ${u}`);
  const insA = db.prepare('INSERT INTO agents (matricule, nom, prenom, email) VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= AGENTS; i += 1) insA.run(`E${String(i).padStart(6, '0')}`, choix(NOMS), choix(PRENOMS), `agent${i}@exemple.fr`);
  const insH = db.prepare(`INSERT INTO habilitations (agent_id, application_id, role, statut, demandeur, cree_par, date_demande, date_validation, date_realisation, date_revocation, date_refus, date_fin, retrait_demande_le, retrait_motif)
                           VALUES (?, ?, ?, ?, 'charge', 'charge', ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insU = db.prepare('INSERT OR IGNORE INTO habilitation_ufs (habilitation_id, uf_id) VALUES (?, ?)');
  for (let i = 0; i < HABILITATIONS; i += 1) {
    const s = statut();
    const d = date(1500);
    const fin = alea() < 0.08 ? new Date(Date.now() + Math.floor(alea() * 120) * 86400000).toISOString().slice(0, 10) : null;
    const retrait = s === 'executee' && alea() < 0.02;
    const { lastInsertRowid } = insH.run(1 + Math.floor(alea() * AGENTS), 1 + Math.floor(alea() * 80), choix(['Consultation', 'Saisie', 'Administration']), s,
      d, ['validee', 'executee', 'revoquee'].includes(s) ? d : null, ['executee', 'revoquee'].includes(s) ? d : null,
      s === 'revoquee' ? date(300) : null, s === 'refusee' ? d : null, fin, retrait ? `${date(20)} 08:00:00` : null, retrait ? 'Départ' : null);
    insU.run(Number(lastInsertRowid), 1 + Math.floor(alea() * 300));
  }
  for (let i = 1; i <= HABILITATIONS; i += 1) tracer('charge', 'habilitation:creer', { entite: 'habilitation', entiteId: i, details: { charge: true } });
});
enregistrerControle('charge', verifierChaine());
const tBase = performance.now() - t0;

const serveur = creerApp().listen(0, '127.0.0.1');
await new Promise((r) => serveur.once('listening', r));
const BASE = `http://127.0.0.1:${serveur.address().port}`;
let cookie = '';
const go = async (chemin, options = {}) => {
  const r = await fetch(BASE + chemin, { ...options, redirect: 'manual', headers: { ...(options.headers ?? {}), cookie } });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return r;
};
const page = await (await go('/connexion')).text();
await go('/connexion', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ login: 'admin', motDePasse: MDP, _csrf: page.match(/name="_csrf" value="([a-f0-9]+)"/)[1] }) });
const { jeton } = (await import('../src/api.js')).creerJeton('charge', 'charge');

const PAGES = [
  '/', '/traiter', '/suivi', '/suivi?q=Martin', '/suivi?temp=1&tri=fin&sens=asc', '/suivi?page=500', '/suivi.csv',
  '/recherche?q=E000123', '/habilitations/25000', '/habilitations/nouvelle', '/mes-demandes', '/departs', '/indicateurs', '/audit',
  '/api/v1/demandes?limite=500', '/api/v1/habilitations?limite=500&apres=40000', '/api/v1/agents/E000123/acces',
];
// Une page doit répondre en moins d’une seconde ; un export complet, en moins de cinq.
const seuil = (p) => (p.includes('.csv') ? 5000 : 1000);
const resultats = [];
for (const p of PAGES) {
  const temps = [];
  let statut = 0;
  let octets = 0;
  for (let i = 0; i < 5; i += 1) {
    const debut = performance.now();
    const r = await go(p, p.startsWith('/api/') ? { headers: { authorization: `Bearer ${jeton}` } } : {});
    octets = (await r.arrayBuffer()).byteLength;
    statut = r.status;
    temps.push(performance.now() - debut);
  }
  temps.sort((a, b) => a - b);
  resultats.push({ page: p, statut, mediane: Math.round(temps[2]), max: Math.round(temps[4]), ko: Math.round(octets / 1024), seuil: seuil(p) });
}
serveur.close();

console.log(`Base : ${HABILITATIONS} habilitations, ${AGENTS} agents, 80 applications, ${HABILITATIONS + 10} écritures au journal, préparée en ${Math.round(tBase / 1000)} s.`);
console.table(resultats);
const lentes = resultats.filter((r) => r.mediane > r.seuil || r.statut >= 400);
try {
  db.close();
  fs.rmSync(dossier, { recursive: true, force: true });
} catch {
  console.warn(`Base de charge laissée dans ${dossier}`);
}
if (lentes.length) {
  console.error(`Au-delà du seuil ou en erreur : ${lentes.map((r) => r.page).join(', ')}`);
  process.exit(1);
}
console.log('Toutes les pages répondent sous leur seuil (médiane de 5 appels) : 1 s pour une page, 5 s pour un export complet.');
