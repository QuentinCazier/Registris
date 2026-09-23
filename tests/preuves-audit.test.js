import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PNG, EML } from './_env.js';

const { initialiserSchema, ouvrirDb } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const H = await import('../src/habilitations.js');
const A = await import('../src/administration.js');
const P = await import('../src/preuves.js');
const audit = await import('../src/audit.js');
const { genererDossierZip, resoudreMatricules, analyserMatricules } = await import('../src/export-audit.js');

initialiserSchema();
const app = A.creerApplication('test', { code: 'GAM', libelle: 'GAM' });
const h = H.creerHabilitation('agent', { agent: { matricule: 'E12345', nom: 'Durand', prenom: 'Claire' }, applicationId: app, role: 'Gestionnaire' });

test('validation des pièces : extension, signature, taille', () => {
  assert.throws(() => P.valider({ tampon: PNG, nom: 'x.exe' }), /Format non accepté/);
  assert.throws(() => P.valider({ tampon: Buffer.from('MZ....'), nom: 'faux.pdf' }), /ne correspond pas/);
  assert.throws(() => P.valider({ tampon: Buffer.alloc(0), nom: 'vide.png' }), /vide/);
  assert.equal(P.valider({ tampon: PNG, nom: 'capture.PNG' }), 'capture');
  assert.equal(P.valider({ tampon: EML, nom: 'mail.eml' }), 'mail');
  assert.equal(P.valider({ tampon: Buffer.from('%PDF-1.4 ...'), nom: 'doc.pdf' }), 'pdf');
  const gros = Buffer.alloc(config.tailleMaxPreuve + 1, 1);
  assert.throws(() => P.valider({ tampon: gros, nom: 'gros.eml' }), /volumineux/);
});

test('dépôt d\'une preuve : fichier stocké sous nom neutre, empreinte exacte, journal tracé', () => {
  const p = P.ajouterPreuve('agent', h.id, { tampon: PNG, nom: '../../capture écran.png' });
  assert.equal(p.type, 'capture');
  assert.equal(p.nom_origine, 'capture écran.png');
  assert.match(p.fichier, /^h\d+_[0-9a-f]{16}\.png$/);
  assert.equal(p.sha256.length, 64);
  assert.ok(fs.existsSync(P.cheminPreuve(p)));
  assert.equal(P.verifierIntegrite(p).intacte, true);
  const j = audit.historique('habilitation', h.id);
  assert.ok(j.some((e) => e.action === 'preuve:ajouter'));
  assert.throws(() => P.ajouterPreuve('agent', 999999, { tampon: PNG, nom: 'a.png' }), /introuvable/);
});

test('altération d\'une pièce sur disque détectée par le coffre', () => {
  const p = P.ajouterPreuve('agent', h.id, { tampon: EML, nom: 'demande.eml' });
  fs.appendFileSync(P.cheminPreuve(p), 'texte ajouté après coup');
  assert.equal(P.verifierIntegrite(p).intacte, false);
  const r = P.auditerCoffre();
  assert.equal(r.total, 2);
  assert.equal(r.anomalies.length, 1);
  assert.equal(r.anomalies[0].id, p.id);
  // Remise en état pour la suite.
  fs.writeFileSync(P.cheminPreuve(p), EML);
  assert.equal(P.auditerCoffre().anomalies.length, 0);
});

test('journal chaîné : intègre, puis rupture détectée après modification directe en base', () => {
  assert.equal(audit.verifierChaine().valide, true);
  const db = ouvrirDb();
  const premiere = db.prepare('SELECT id, acteur FROM journal_audit ORDER BY id LIMIT 1').get();
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run('pirate', premiere.id);
  const c = audit.verifierChaine();
  assert.equal(c.valide, false);
  assert.equal(c.rupture, premiere.id);
  assert.equal(c.raison, 'contenu');
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run(premiere.acteur, premiere.id);
  assert.equal(audit.verifierChaine().valide, true);
  // Suppression d'une entrée intermédiaire : rupture de chaînage.
  const milieu = db.prepare('SELECT id FROM journal_audit ORDER BY id LIMIT 1 OFFSET 1').get().id;
  const sauvegarde = db.prepare('SELECT * FROM journal_audit WHERE id = ?').get(milieu);
  db.prepare('DELETE FROM journal_audit WHERE id = ?').run(milieu);
  assert.equal(audit.verifierChaine().raison, 'chainage');
  db.prepare(
    'INSERT INTO journal_audit (id, horodatage, acteur, action, entite, entite_id, details, hash_precedent, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(sauvegarde.id, sauvegarde.horodatage, sauvegarde.acteur, sauvegarde.action, sauvegarde.entite, sauvegarde.entite_id, sauvegarde.details, sauvegarde.hash_precedent, sauvegarde.hash);
  assert.equal(audit.verifierChaine().valide, true);
});

test('état de chaîne : reprise au dernier contrôle complet, sans perdre la détection', () => {
  const db = ouvrirDb();
  assert.equal(audit.verifierChaine().valide, true);

  // Sans point de reprise, l'affichage vérifie tout : correct, mais lent.
  const vierge = audit.etatChaine();
  assert.equal(vierge.valide, true);
  assert.equal(vierge.complet, true, 'aucun contrôle enregistré : vérification complète');

  audit.enregistrerControle('test', { valide: true });
  const repris = audit.etatChaine();
  assert.equal(repris.complet, false);
  assert.equal(repris.nouvelles, 0, 'rien de neuf depuis le contrôle');
  assert.equal(repris.entrees, audit.verifierChaine().entrees, 'le total reste celui du journal entier');

  // Une écriture postérieure au point de reprise est bien contrôlée.
  audit.tracer('test', 'habilitation:valider', { entite: 'habilitation', entiteId: h.id });
  assert.equal(audit.etatChaine().nouvelles, 1);
  const derniere = db.prepare('SELECT id, acteur FROM journal_audit ORDER BY id DESC LIMIT 1').get();
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run('pirate', derniere.id);
  const rompu = audit.etatChaine();
  assert.equal(rompu.valide, false, 'une retouche après la reprise reste vue à l’écran');
  assert.equal(rompu.rupture, derniere.id);
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run(derniere.acteur, derniere.id);
  assert.equal(audit.etatChaine().valide, true);

  // Le point de reprise lui-même est contrôlé : on ne repart pas d'une entrée effacée.
  const controle = audit.dernierControle();
  const reprise = db.prepare('SELECT * FROM journal_audit WHERE id = ?').get(controle.dernier_id);
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run('pirate', reprise.id);
  const casse = audit.etatChaine();
  assert.equal(casse.valide, false);
  assert.equal(casse.raison, 'point de reprise');
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run(reprise.acteur, reprise.id);

  // Le prix assumé : une retouche antérieure attend le contrôle complet.
  const ancienne = db.prepare('SELECT id, acteur FROM journal_audit ORDER BY id LIMIT 1').get();
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run('pirate', ancienne.id);
  assert.equal(audit.etatChaine().valide, true, 'invisible à l’écran, c’est le compromis');
  assert.equal(audit.verifierChaine().valide, false, 'mais le contrôle complet la voit');
  db.prepare('UPDATE journal_audit SET acteur = ? WHERE id = ?').run(ancienne.acteur, ancienne.id);
  assert.equal(audit.verifierChaine().valide, true);
});

test('journal : recherche texte et historique par entité', () => {
  assert.ok(audit.journal({ q: 'E12345' }).length >= 1);
  assert.equal(audit.journal({ q: 'zzz-inexistant' }).length, 0);
  assert.ok(audit.historique('habilitation', h.id).length >= 3);
});

test('export : analyse des matricules et résolution', () => {
  assert.deepEqual(analyserMatricules('E12345\nE99999, E12345 ;E00001'), ['E12345', 'E99999', 'E00001']);
  const r = resoudreMatricules('E12345 E99999');
  assert.equal(r.trouves.length, 1);
  assert.deepEqual(r.introuvables, ['E99999']);
});

test('export : le ZIP contient la synthèse, le CSV, le manifeste et les pièces', async () => {
  const chemin = path.join(path.dirname(config.dbPath), 'export.zip');
  const flux = fs.createWriteStream(chemin);
  const fin = new Promise((resolve, reject) => flux.on('close', resolve).on('error', reject));
  const r = genererDossierZip('controleur', 'E12345', flux);
  await fin;
  assert.equal(r.trouves.length, 1);
  const contenu = fs.readFileSync(chemin);
  assert.equal(contenu.subarray(0, 2).toString(), 'PK');
  const texte = contenu.toString('latin1');
  for (const nom of ['synthese.html', 'synthese.csv', 'integrite.txt', 'E12345/', 'capture', 'demande.eml']) {
    assert.ok(texte.includes(nom), `ZIP sans ${nom}`);
  }
  assert.ok(audit.journal({ limite: 5 }).some((e) => e.action === 'export:audit'));
});
