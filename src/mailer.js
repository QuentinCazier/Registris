/**
 * Notifications par courriel via le relais SMTP interne de l'établissement.
 * Désactivé proprement si SMTP_HOST est vide : l'application fonctionne sans mail.
 * Ne lève jamais : une panne SMTP ne doit pas bloquer une demande d'habilitation.
 */

import { config } from './config.js';

let transport;

async function obtenirTransport() {
  if (!config.smtp.actif) return null;
  if (transport) return transport;
  const nodemailer = (await import('nodemailer')).default;
  const options = { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure };
  if (config.smtp.user) options.auth = { user: config.smtp.user, pass: config.smtp.password };
  transport = nodemailer.createTransport(options);
  return transport;
}

/** Envoie un mail. Renvoie true si remis au relais, false sinon. */
export async function notifier({ to, sujet, texte }) {
  const destinataires = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!destinataires.length) return false;
  try {
    const t = await obtenirTransport();
    if (!t) return false;
    await t.sendMail({
      from: config.smtp.from,
      to: destinataires.join(', '),
      subject: `[${config.nom}] ${sujet}`,
      text: texte,
    });
    return true;
  } catch (err) {
    console.error(`[${config.nom}] envoi mail échoué :`, err.message);
    return false;
  }
}
