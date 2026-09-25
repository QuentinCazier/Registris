// Entretien courant, lancé par le serveur toutes les heures et par « registris entretien ».

import { config } from './config.js';
import { tracer } from './audit.js';
import { demanderFermeturesEchues } from './habilitations.js';
import { getRoutage, getParametre, setParametre } from './parametres.js';
import { detecterDepuisAnnuaire } from './departs.js';
import { notifier } from './mailer.js';
import { pluriel } from './ui.js';

// Un courriel par adresse de routage, avec les accès qui la concernent.
export async function notifierFermetures(habilitations, { sujet, intro }) {
  const parAdresse = new Map();
  for (const h of habilitations) {
    const to = getRoutage(h.app_cat_id);
    if (!to) continue;
    if (!parAdresse.has(to)) parAdresse.set(to, []);
    parAdresse.get(to).push(h);
  }
  for (const [to, acces] of parAdresse) {
    await notifier({
      to,
      sujet,
      texte: `${intro}\n\n${acces.map((h) => `- ${h.nom} ${h.prenom} (${h.matricule}) : ${h.app_libelle}, « ${h.role} » (n°${h.id})`).join('\n')}`
        + "\n\nIls apparaissent dans la file « À traiter ». L'accès reste ouvert tant qu'il n'a pas été fermé dans l'application.",
    });
  }
}

/** @param {{ jour?: string }} [options] */
export async function entretien({ jour } = {}) {
  const echus = demanderFermeturesEchues('système', jour ? { jour } : {});
  if (echus.length) {
    tracer('système', 'entretien:echeances', { details: { fermetures: echus.map((h) => h.id) } });
    await notifierFermetures(echus, {
      sujet: `Accès temporaires arrivés à échéance : ${echus.length}`,
      intro: `${pluriel(echus.length, 'accès', '')} temporaire${echus.length >= 2 ? 's sont arrivés' : ' est arrivé'} à sa date de fin. Une demande de fermeture a été ouverte pour chacun.`,
    });
  }
  // L'annuaire une fois par jour, quand un compte de service le permet.
  let departs = null;
  const jourCourant = new Date().toISOString().slice(0, 10);
  if (config.authMode === 'ldap' && config.ldap.bindDN && getParametre('annuaire:derniere_detection') !== jourCourant) {
    try {
      departs = await detecterDepuisAnnuaire('système');
      setParametre('système', 'annuaire:derniere_detection', jourCourant);
    } catch (e) {
      console.error(`[${config.nom}] détection des départs dans l'annuaire : ${e.message}`);
    }
  }
  return { fermeturesEchues: echus.length, departs };
}

// Toutes les heures, sans empêcher l'arrêt du processus.
export function planifierEntretien({ intervalleMs = 3600000 } = {}) {
  if (!config.entretienAuto) return null;
  const tour = () => entretien().catch((e) => console.error(`[${config.nom}] entretien : ${e.message}`));
  const premier = setTimeout(tour, 60000);
  premier.unref();
  const minuterie = setInterval(tour, intervalleMs);
  minuterie.unref();
  return minuterie;
}
