// Point d'entrée bibliothèque : usage programmatique et tests.

export { config } from './config.js';
export { ouvrirDb, initialiserSchema, fermerDb } from './db.js';
export { authentifier, hacherMotDePasse } from './auth.js';
export * as habilitations from './habilitations.js';
export * as preuves from './preuves.js';
export * as administration from './administration.js';
export * as audit from './audit.js';
export { genererDossierZip, resoudreMatricules } from './export-audit.js';
export { creerApp } from './serveur.js';
