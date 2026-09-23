// Connexion et déconnexion.

import crypto from 'node:crypto';

import { config } from '../config.js';
import { authentifierDetail, expliquerErreurLdap } from '../auth.js';
import { tracer } from '../audit.js';
import { estBloque, enregistrerEchec, reinitialiser } from '../connexion.js';
import { memoriserCompteAnnuaire } from '../administration.js';
import { pageConnexion } from '../ui.js';

const MESSAGES = {
  identifiants: 'Identifiants invalides ou rôle non attribué.',
  role: 'Compte reconnu, mais aucun rôle Registris ne lui est attribué. Demandez à la DSI de vous ajouter au groupe voulu.',
  injoignable: "L'annuaire est injoignable pour le moment. Réessayez dans quelques minutes ; un compte local de secours reste utilisable.",
};

export function monter(app) {
  app.get('/connexion', (req, res) => {
    if (req.session.utilisateur) return res.redirect('/');
    res.send(pageConnexion(req));
  });
  app.post('/connexion', async (req, res) => {
    const login = String(req.body.login ?? '').trim().slice(0, 200);
    const cle = `${req.ip}|${login.toLowerCase()}`;
    if (estBloque(cle)) {
      tracer(login || '?', 'auth:bloque', { details: { ip: req.ip } });
      return res.status(429).send(pageConnexion(req, { erreur: 'Trop de tentatives. Réessayez dans dix minutes.' }));
    }
    const { utilisateur: u, motif, detail } = await authentifierDetail(login, String(req.body.motDePasse ?? ''));
    if (!u) {
      if (motif === 'injoignable') {
        console.error(`[${config.nom}] annuaire injoignable : ${detail}`);
        tracer(login || '?', 'auth:annuaire-injoignable', { details: { ip: req.ip, erreur: String(detail).slice(0, 300) } });
        return res.status(503).send(pageConnexion(req, { erreur: MESSAGES.injoignable }));
      }
      if (motif === 'role') {
        tracer(login, 'auth:sans-role', { details: { ip: req.ip, groupes: String(detail).slice(0, 300) } });
        return res.status(403).send(pageConnexion(req, { erreur: MESSAGES.role }));
      }
      enregistrerEchec(cle);
      const raison = expliquerErreurLdap(detail);
      tracer(login || '?', 'auth:echec', { details: { ip: req.ip, ...(raison ? { raison } : {}) } });
      return res.status(401).send(pageConnexion(req, { erreur: MESSAGES.identifiants }));
    }
    reinitialiser(cle);
    if (u.source === 'ldap') memoriserCompteAnnuaire(u);
    req.session.regenerate((err) => {
      if (err) return res.status(500).send(pageConnexion(req, { erreur: 'Erreur de session.' }));
      req.session.utilisateur = u;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      tracer(u.login, 'auth:succes', { details: { role: u.role, source: u.source, ...(u.secours ? { secours: true } : {}) } });
      res.redirect('/');
    });
  });
  app.get('/deconnexion', (req, res) => {
    const login = req.session.utilisateur?.login;
    req.session.destroy(() => {
      if (login) tracer(login, 'auth:deconnexion');
      res.redirect('/connexion');
    });
  });
}
