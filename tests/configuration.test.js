import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { tmp } from './_env.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { config, SECRET_PAR_DEFAUT, assurerSecretSession, verifierPourProduction, optionsTls } = await import('../src/config.js');
const { initialiserSchema } = await import('../src/db.js');
const { creerApp, ecouter } = await import('../src/serveur.js');

initialiserSchema();

test('REGISTRIS_CONFIG : un fichier de configuration hors du dépôt est lu, BOM compris', () => {
  const fichier = path.join(tmp, 'ailleurs.env');
  fs.writeFileSync(fichier, '﻿NOM_ETABLISSEMENT="CH Test"\r\nPORT=3999\r\n');
  const env = { ...process.env, REGISTRIS_CONFIG: fichier };
  delete env.NOM_ETABLISSEMENT;
  delete env.PORT;
  const r = spawnSync(process.execPath, ['-e', "import('./src/config.js').then((m) => console.log(JSON.stringify({ e: m.config.etablissement, p: m.config.port, f: m.config.fichierConfig })))"], { cwd: RACINE, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { e: 'CH Test', p: 3999, f: fichier });
});

test('secret de session : généré une fois, conservé à côté de la base, réutilisé', () => {
  const avant = config.sessionSecret;
  config.sessionSecret = SECRET_PAR_DEFAUT;
  try {
    const s1 = assurerSecretSession();
    assert.ok(s1.length >= 64 && s1 !== SECRET_PAR_DEFAUT);
    config.sessionSecret = SECRET_PAR_DEFAUT;
    assert.equal(assurerSecretSession(), s1, 'le même secret est relu');
    assert.equal(fs.readFileSync(path.join(path.dirname(config.dbPath), 'session.secret'), 'utf8').trim(), s1);
    config.sessionSecret = SECRET_PAR_DEFAUT;
    const avertissements = verifierPourProduction({ production: true });
    assert.ok(avertissements.some((a) => /secret généré/.test(a)));
    assert.equal(config.sessionSecret, s1);
  } finally {
    config.sessionSecret = avant;
  }
});

test('TLS : un certificat déclaré mais absent bloque le démarrage, un hôte exposé sans TLS avertit', () => {
  const sauve = { ...config.tls };
  const hote = config.hote;
  try {
    config.tls = { cert: path.join(tmp, 'absent.crt'), key: path.join(tmp, 'absent.key'), pfx: '', passphrase: '', actif: true };
    assert.throws(() => verifierPourProduction({ production: false }), /TLS_CERT introuvable/);
    config.tls = { cert: '', key: '', pfx: '', passphrase: '', actif: false };
    config.hote = '0.0.0.0';
    assert.ok(verifierPourProduction({ production: false }).some((a) => /en clair/.test(a)));
    assert.equal(optionsTls(), null);
  } finally {
    config.tls = sauve;
    config.hote = hote;
  }
});

const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;

test('HTTPS direct : le serveur écoute en TLS avec un certificat PEM', { skip: !openssl && 'openssl absent' }, async () => {
  const cert = path.join(tmp, 'test.crt');
  const cle = path.join(tmp, 'test.key');
  const gen = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-keyout', cle, '-out', cert], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  const sauve = { ...config.tls };
  config.tls = { cert, key: cle, pfx: '', passphrase: '', actif: true };
  let serveur;
  try {
    assert.ok(optionsTls().cert);
    serveur = ecouter(creerApp(), { port: 0, hote: '127.0.0.1' });
    await new Promise((r) => serveur.once('listening', r));
    assert.equal(serveur.protocole, 'https');
    const reponse = await new Promise((resoudre, rejeter) => {
      https.get({ host: '127.0.0.1', port: serveur.address().port, path: '/sante', rejectUnauthorized: false, agent: false }, (rep) => {
        const chiffre = rep.socket?.encrypted === true;
        let corps = '';
        rep.on('data', (d) => { corps += d; });
        rep.on('end', () => resoudre({ statut: rep.statusCode, corps, tls: chiffre }));
      }).on('error', rejeter);
    });
    assert.equal(reponse.statut, 200);
    assert.equal(reponse.tls, true);
    assert.match(reponse.corps, /"statut":"ok"/);
  } finally {
    config.tls = sauve;
    if (serveur) {
      serveur.closeAllConnections?.();
      serveur.close();
    }
  }
});
