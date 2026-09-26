// Serveur web (Express), rendu HTML côté serveur. Les routes vivent dans src/routes/,
// montées ici dans l'ordre où Express doit les essayer.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createRequire } from 'node:module';

import express from 'express';
import session from 'express-session';

import { config, optionsTls } from './config.js';
import { exigerAuth, peut } from './roles.js';
import { statistiques, compterHabilitations } from './habilitations.js';
import { resteAStatuer, enCours } from './revues.js';
import { MagasinSessions } from './sessions.js';
import { pageErreur } from './ui.js';
import { perimetreRevue } from './routes/outils.js';

import { monter as connexion } from './routes/connexion.js';
import { monter as accueil } from './routes/accueil.js';
import { monter as traitement } from './routes/traitement.js';
import { monter as revue } from './routes/revue.js';
import { monter as agents } from './routes/agents.js';
import { monter as demandes } from './routes/demandes.js';
import { monter as registre } from './routes/registre.js';
import { monter as habilitation } from './routes/habilitation.js';
import { monter as packs } from './routes/packs.js';
import { monter as audit } from './routes/audit.js';
import { monter as admin } from './routes/admin.js';
import { monter as indicateurs } from './routes/indicateurs.js';
import { monter as rapprochement } from './routes/rapprochement.js';
import { monter as aide } from './routes/aide.js';
import { monter as departs } from './routes/departs.js';
import { monter as approbations } from './routes/approbations.js';
import { monter as absences } from './routes/absences.js';
import { monter as adminApi, routeurApi } from './routes/api.js';
import { monter as configuration } from './routes/configuration.js';
import { perimetreEffectif } from './suppleances.js';
import { compterAApprouver } from './accords.js';
import { departsAConfirmer } from './departs.js';

const { version: VERSION } = createRequire(import.meta.url)('../package.json');

// « /habilitations/nouvelle » doit passer avant « /habilitations/:id ».
const ROUTES = [
  connexion, accueil, traitement, revue, agents, demandes, registre, habilitation, packs, audit, indicateurs,
  rapprochement, admin, aide, departs, approbations, absences, adminApi, configuration,
];

// Seules ces routes lisent un formulaire multipart ; elles vérifient le jeton après multer.
const MULTIPART = [
  /^\/habilitations$/, /^\/habilitations\/multiple$/, /^\/habilitations\/\d+\/preuves$/,
  /^\/rapprochements$/, /^\/admin\/applications$/, /^\/admin\/applications\/\d+\/modifier$/,
  /^\/admin\/import\/(applications|ufs)$/, /^\/departs\/fichier-rh$/,
];

const refusJeton = (res) => res.status(403).type('html').send(
  '<!doctype html><meta charset="utf-8"><p>Jeton de sécurité invalide ou expiré. ' +
    'Revenez en arrière, rechargez la page puis réessayez.</p>',
);

export function creerApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.nonce = crypto.randomBytes(16).toString('base64');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; " +
        `base-uri 'self'; form-action 'self'; script-src 'self' 'nonce-${req.nonce}'; style-src 'self' 'unsafe-inline'`,
    );
    if (config.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Supervision, sans session ni cookie.
  app.get('/sante', (req, res) => {
    let base = 'ok';
    try {
      statistiques();
    } catch {
      base = 'ko';
    }
    res.json({ application: 'registris', version: VERSION, statut: base === 'ok' ? 'ok' : 'degrade', base });
  });

  // API en lecture : jeton porteur, ni session ni cookie.
  app.use('/api/v1', routeurApi());

  app.use(express.static(config.publicDir, { index: false, maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  // Express 5 laisse req.body indéfini quand rien n'a été lu.
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.use(
    session({
      store: new MagasinSessions(),
      name: 'registris.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: config.secureCookie, sameSite: 'lax', maxAge: 8 * 3600 * 1000 },
    }),
  );

  // Jeton CSRF par session, injecté dans chaque formulaire POST et vérifié en retour.
  app.use((req, res, next) => {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
    const jeton = req.session.csrf;
    const envoyer = res.send.bind(res);
    res.send = (corps) => {
      if (typeof corps === 'string' && corps.includes('<form')) {
        corps = corps.replace(
          /<form\b([^>]*\bmethod=["']?post["']?[^>]*)>/gi,
          (_, attrs) => `<form${attrs}><input type="hidden" name="_csrf" value="${jeton}">`,
        );
      }
      return envoyer(corps);
    };
    next();
  });
  function verifierCsrf(req, res, next) {
    const recu = req.body?._csrf;
    const ok = typeof recu === 'string' && recu.length === req.session.csrf.length &&
      crypto.timingSafeEqual(Buffer.from(recu), Buffer.from(req.session.csrf));
    if (!ok) return refusJeton(res);
    next();
  }
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const multipart = String(req.headers['content-type'] || '').includes('multipart/form-data');
    if (!multipart) return verifierCsrf(req, res, next);
    if (!MULTIPART.some((m) => m.test(req.path))) return refusJeton(res);
    next();
  });

  // Le périmètre d'un référent suit ses suppléances du jour, sans reconnexion.
  app.use((req, res, next) => {
    const u = req.session?.utilisateur;
    if (u?.role === 'referent') {
      try {
        if (u.perimetrePropre === undefined) u.perimetrePropre = u.referentApps;
        u.referentApps = perimetreEffectif(u.login, u.perimetrePropre);
      } catch {
        /* base pas encore prête : le périmètre de la connexion reste valable */
      }
    }
    next();
  });

  app.use((req, res, next) => {
    const u = req.session?.utilisateur;
    if (!u || req.method !== 'GET') return next();
    try {
      req.compteurs = { approbations: compterAApprouver(u.login) };
      if (peut(u.role, 'habilitation:suivre')) {
        const s = statistiques();
        const campagne = enCours();
        Object.assign(req.compteurs, {
          aTraiter: compterHabilitations({ file: true, applicationIds: perimetreRevue(u) }),
          registre: s.habilitations,
          revue: campagne ? resteAStatuer(campagne.id, perimetreRevue(u)) : 0,
          departs: departsAConfirmer().length,
        });
      }
    } catch {
      /* la navigation se passe de compteurs si la base n'est pas prête */
    }
    next();
  });

  app.get('/logos/:fichier', exigerAuth, (req, res) => {
    const f = path.basename(req.params.fichier);
    const p = path.join(config.logosDir, f);
    if (!/^logo_[a-f0-9]{16}\.(png|jpe?g|svg|webp|gif)$/.test(f) || !fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });

  for (const monter of ROUTES) monter(app, { verifierCsrf });

  app.use((req, res) => {
    if (!req.session?.utilisateur) return res.redirect('/connexion');
    res.status(404).send(pageErreur(req, 'Page introuvable', "Cette page n'existe pas."));
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(`[${config.nom}]`, err);
    if (res.headersSent) return;
    res.status(500).type('html').send('<!doctype html><meta charset="utf-8"><p>Erreur interne. Consultez le journal du serveur.</p><p><a href="/">Retour</a></p>');
  });

  return app;
}

// HTTPS direct si un certificat est configuré, sinon HTTP derrière un reverse-proxy.
export function ecouter(app, { port = config.port, hote = config.hote } = {}) {
  const tls = optionsTls();
  const serveur = tls ? https.createServer(tls, app) : http.createServer(app);
  serveur.protocole = tls ? 'https' : 'http';
  return serveur.listen(port, hote);
}
