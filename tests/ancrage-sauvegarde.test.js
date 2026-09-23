import { tmp, PNG } from './_env.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const { tracer, verifierChaine, ancrer, verifierAncrages, teteDeChaine, lireFichierAncrage, texteAncrage } = await import('../src/audit.js');
const { sauvegarder, inspecter, restaurer } = await import('../src/sauvegarde.js');
const { estBloque, enregistrerEchec, reinitialiser, purger, MAX_ECHECS, FENETRE_MS } = await import('../src/connexion.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const { ajouterPreuve } = await import('../src/preuves.js');

initialiserSchema();
const ANCRAGES = path.join(tmp, 'ancrages');

A.creerCategorie('test', { libelle: 'Gestion' });
const app = A.creerApplication('test', { code: 'GAM', libelle: 'GAM', categorieId: 1 });
const hab = H.creerHabilitation('agent', { agent: { matricule: 'M1', nom: 'Martin', prenom: 'Camille' }, applicationId: app, role: 'lecture', demandeur: 'agent' });
ajouterPreuve('agent', hab.id, { tampon: PNG, nom: 'capture.png' });

test('ancrer photographie la tête de chaîne en base et dans un fichier', () => {
  tracer('test', 'action:une');
  const tete = teteDeChaine();
  const a = ancrer({ acteur: 'test', dossier: ANCRAGES });
  assert.equal(a.dernier_id, tete.dernier_id);
  assert.equal(a.hash_tete, tete.hash_tete);
  assert.equal(a.entrees, tete.entrees);
  assert.ok(fs.existsSync(a.fichier));
  const lu = lireFichierAncrage(a.fichier);
  assert.equal(lu.empreinte, a.empreinte);
  assert.equal(lu.dernier_id, a.dernier_id);
  assert.ok(texteAncrage(a).includes(`hash_tete=${a.hash_tete}`));

  const v = verifierAncrages({ dossier: ANCRAGES });
  assert.equal(v.valide, true);
  assert.equal(v.ancrages, 1);
  assert.equal(v.fichiers, 1);
  assert.equal(v.dernier.empreinte, a.empreinte);
});

test('verifierAncrages détecte une entrée de tête modifiée et un fichier manquant', () => {
  tracer('test', 'action:deux');
  const a = ancrer({ acteur: 'test', dossier: ANCRAGES });
  const db = ouvrirDb();
  const original = db.prepare('SELECT hash FROM journal_audit WHERE id = ?').get(a.dernier_id).hash;
  db.prepare('UPDATE journal_audit SET hash = ? WHERE id = ?').run('0'.repeat(64), a.dernier_id);
  let v = verifierAncrages({ dossier: ANCRAGES });
  assert.equal(v.valide, false);
  assert.ok(v.anomalies.some((x) => x.raison.includes(`entrée n°${a.dernier_id} modifiée`)));
  db.prepare('UPDATE journal_audit SET hash = ? WHERE id = ?').run(original, a.dernier_id);
  assert.equal(verifierAncrages({ dossier: ANCRAGES }).valide, true);

  fs.unlinkSync(a.fichier);
  v = verifierAncrages({ dossier: ANCRAGES });
  assert.equal(v.valide, false);
  assert.ok(v.anomalies.some((x) => x.raison.includes('manquant')));
  fs.writeFileSync(a.fichier, texteAncrage(a));
  assert.equal(verifierAncrages({ dossier: ANCRAGES }).valide, true);
});

test('verifierAncrages signale un fichier d\'ancrage inconnu de la base (base remplacée)', () => {
  const etranger = { horodatage: '2020-01-01T00:00:00.000Z', entrees: 999, dernier_id: 999, hash_tete: 'f'.repeat(64) };
  etranger.empreinte = crypto.createHash('sha256').update([etranger.horodatage, etranger.entrees, etranger.dernier_id, etranger.hash_tete].join('|')).digest('hex');
  const chemin = path.join(ANCRAGES, 'ancrage-2020-01-01T00-00-00-000Z.txt');
  fs.writeFileSync(chemin, texteAncrage(etranger));
  const v = verifierAncrages({ dossier: ANCRAGES });
  assert.equal(v.valide, false);
  assert.ok(v.anomalies.some((x) => x.raison.includes('inconnu de la base')));
  assert.ok(v.anomalies.some((x) => x.raison.includes('entrée n°999 absente')));
  fs.unlinkSync(chemin);
  assert.equal(verifierAncrages({ dossier: ANCRAGES }).valide, true);
});

test('sauvegarder produit une archive vérifiable, restaurer la redéploie ailleurs', async () => {
  process.env.ANCRAGES_DIR = ANCRAGES;
  const destination = path.join(tmp, 'sauvegardes');
  const { fichier, taille, manifeste } = await sauvegarder({ destination, acteur: 'test' });
  assert.ok(fs.existsSync(fichier));
  assert.ok(taille > 0);
  assert.equal(manifeste.compteurs.habilitations, 1);
  assert.equal(manifeste.compteurs.preuves, 1);
  assert.equal(manifeste.chaine.valide, true);
  assert.ok(manifeste.fichiers.some((f) => f.chemin === 'base.db'));
  assert.ok(manifeste.fichiers.some((f) => f.chemin.startsWith('preuves/')));

  const rapport = inspecter(fichier);
  assert.equal(rapport.valide, true);
  assert.equal(rapport.verifications.filter((v) => !v.ok).length, 0);

  const cibles = {
    dbPath: path.join(tmp, 'restaure', 'base.db'),
    preuvesDir: path.join(tmp, 'restaure', 'preuves'),
    logosDir: path.join(tmp, 'restaure', 'logos'),
    ancragesDir: path.join(tmp, 'restaure', 'ancrages'),
  };
  const r = restaurer(fichier, { cibles });
  assert.equal(r.ecrits.base, 1);
  assert.equal(r.ecrits.preuves, 1);
  const restauree = new DatabaseSync(cibles.dbPath);
  assert.equal(restauree.prepare('SELECT COUNT(*) AS n FROM habilitations').get().n, 1);
  assert.equal(restauree.prepare('SELECT COUNT(*) AS n FROM journal_audit').get().n, manifeste.compteurs.journal);
  restauree.close();

  assert.throws(() => restaurer(fichier, { cibles }), /base existe déjà/);
  assert.equal(restaurer(fichier, { cibles, forcer: true }).ecrits.base, 1);

  const journalApres = verifierChaine();
  assert.equal(journalApres.valide, true, 'la sauvegarde est elle-même tracée sans casser la chaîne');
});

test('inspecter refuse une archive altérée', async () => {
  const destination = path.join(tmp, 'sauvegardes2');
  const { fichier } = await sauvegarder({ destination, acteur: 'test' });
  const octets = fs.readFileSync(fichier);
  // On corrompt un octet au milieu des données (hors répertoire central).
  octets[Math.floor(octets.length / 3)] ^= 0xff;
  const altere = path.join(destination, 'alteree.zip');
  fs.writeFileSync(altere, octets);
  let valide;
  try {
    valide = inspecter(altere).valide;
  } catch {
    valide = false; // décompression impossible : refus aussi
  }
  assert.equal(valide, false);
});

test('anti-force-brute persistant : blocage après N échecs, expiration, réinitialisation', () => {
  const cle = '127.0.0.1|cible';
  assert.equal(estBloque(cle), false);
  for (let i = 0; i < MAX_ECHECS - 1; i++) enregistrerEchec(cle);
  assert.equal(estBloque(cle), false);
  enregistrerEchec(cle);
  assert.equal(estBloque(cle), true);
  assert.equal(estBloque(cle, Date.now() + FENETRE_MS + 1000), false, 'la fenêtre expirée lève le blocage');
  for (let i = 0; i < MAX_ECHECS; i++) enregistrerEchec(cle);
  assert.equal(estBloque(cle), true);
  reinitialiser(cle);
  assert.equal(estBloque(cle), false);
  enregistrerEchec('autre|x', Date.now() - FENETRE_MS - 5000);
  assert.ok(purger() >= 1);
});
