// Petits outils partagés par les modules de routes.

import multer from 'multer';

import { config } from '../config.js';
import { peut } from '../roles.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.tailleMaxPreuve, files: 1 } });
// Un chemin interne seulement : « //cible » serait une redirection ouverte.
export const cheminSur = (v, defaut) => (typeof v === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(v) ? v : defaut);
export const nombre = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);

// null : aucune restriction.
export const perimetreRevue = (u) =>
  u.role === 'admin' || u.role === 'controleur' || u.referentApps === 'ALL'
    ? null
    : (Array.isArray(u.referentApps) ? u.referentApps.map(Number) : []);

// Sans droit de lecture du registre, un agent ne voit que son accès ou sa propre demande.
export const peutConsulter = (u, h) =>
  peut(u.role, 'habilitation:lire') || (Boolean(h.matricule) && h.matricule === u.matricule) || h.cree_par === u.login;
