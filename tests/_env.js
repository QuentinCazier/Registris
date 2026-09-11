/**
 * Isole chaque fichier de test dans une base et un coffre temporaires. À importer
 * en premier : la configuration lit l'environnement au chargement.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'registris-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.PREUVES_DIR = path.join(tmp, 'preuves');
process.env.LOGOS_DIR = path.join(tmp, 'logos');
process.env.SMTP_HOST = '';
process.env.AUTH_MODE = 'local';
process.env.SESSION_SECRET = 'secret-de-test-suffisamment-long';
process.env.NODE_ENV = 'test';

// PNG 1×1 valide, pour les pièces de preuve.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
export const EML = Buffer.from('From: a@exemple.fr\r\nTo: b@exemple.fr\r\nSubject: test\r\n\r\nBonjour.\r\n', 'utf8');
