/**
 * Serveur web (Express). Rendu HTML côté serveur, sans framework front.
 *
 * Sécurité intégrée : en-têtes (CSP, X-Frame-Options…), session httpOnly, jeton
 * CSRF injecté dans chaque formulaire POST et vérifié, anti-force-brute sur la
 * connexion, contrôle des droits par rôle sur chaque route, validation des pièces
 * téléversées (extension + signature), journalisation chaînée des actions.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import session from 'express-session';
import multer from 'multer';

import { config } from './config.js';
import { authentifier } from './auth.js';
import { exigerAuth, exigerDroit, peut, referentGereApplication, LIBELLES_ROLE, ROLES } from './roles.js';
import {
  listerApplications, applicationParId, listerUfs, listerSites, agentParMatricule, rechercherAgents,
  habilitationParId, creerHabilitation, appliquerPack, changerStatut, statistiques, listerHabilitations,
  listerDemandesDe, libelleUfs, STATUTS, LIB_STATUT,
} from './habilitations.js';
import {
  listerCategories, creerCategorie, supprimerCategorie, creerApplication, modifierApplication,
  supprimerApplication, enregistrerLogo, creerUf, supprimerUf, creerSite, supprimerSite,
  listerUtilisateurs, utilisateurParLogin, emailUtilisateur, creerUtilisateur, modifierUtilisateur,
  supprimerUtilisateur, perimetresReferents, definirPerimetreReferent,
  listerPacks, packParId, creerPack, modifierPack, supprimerPack, ajouterElementPack, retirerElementPack,
} from './administration.js';
import { getRoutage, setRoutage } from './parametres.js';
import { ajouterPreuve, preuveParId, cheminPreuve, verifierIntegrite, auditerCoffre, EXTENSIONS_ACCEPTEES } from './preuves.js';
import { genererDossierZip, analyserMatricules } from './export-audit.js';
import { journal, verifierChaine, verifierAncrages, historique, tracer } from './audit.js';
import { estBloque, enregistrerEchec, reinitialiser } from './connexion.js';
import { notifier } from './mailer.js';
import {
  echap, jsonInline, ICONES, page, pageConnexion, pageErreur, tag, tagRole, logoApp, initiales, item,
  bandeauErreur, bandeauOk, barres, tableauColonnes,
} from './ui.js';

import { createRequire } from 'node:module';
const { version: VERSION } = createRequire(import.meta.url)('../package.json');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.tailleMaxPreuve, files: 1 } });
const cheminSur = (v, defaut) => (typeof v === 'string' && /^\/[\w\-/?=&.%]*$/.test(v) ? v : defaut);
const nombre = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);

export function creerApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // --- En-têtes de sécurité -----------------------------------------------------------
  // Un nonce par réponse : seuls les scripts en ligne qui le portent s'exécutent.
  // Les styles restent en ligne (attributs style dans les gabarits), sans risque
  // d'exécution de code.
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

  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(
    session({
      name: 'registris.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: config.secureCookie, sameSite: 'lax', maxAge: 8 * 3600 * 1000 },
    }),
  );
  app.use(express.static(config.publicDir, { index: false, maxAge: '1h' }));

  // --- CSRF : jeton par session, injecté dans chaque formulaire POST, vérifié en retour --
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
    if (!ok) {
      return res.status(403).type('html').send(
        '<!doctype html><meta charset="utf-8"><p>Jeton de sécurité invalide ou expiré. ' +
          'Revenez en arrière, rechargez la page puis réessayez.</p>',
      );
    }
    next();
  }
  app.use((req, res, next) => {
    const multipart = String(req.headers['content-type'] || '').includes('multipart/form-data');
    if (req.method === 'POST' && !multipart) return verifierCsrf(req, res, next);
    next();
  });

  // --- Santé (sans session) : pour la supervision ----------------------------------------
  app.get('/sante', (req, res) => {
    let base = 'ok';
    try {
      statistiques();
    } catch {
      base = 'ko';
    }
    res.json({ application: 'registris', version: VERSION, statut: base === 'ok' ? 'ok' : 'degrade', base });
  });

  // --- Connexion --------------------------------------------------------------------------
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
    const u = await authentifier(login, String(req.body.motDePasse ?? ''));
    if (!u) {
      enregistrerEchec(cle);
      tracer(login || '?', 'auth:echec', { details: { ip: req.ip } });
      return res.status(401).send(pageConnexion(req, { erreur: 'Identifiants invalides ou rôle non attribué.' }));
    }
    reinitialiser(cle);
    req.session.regenerate((err) => {
      if (err) return res.status(500).send(pageConnexion(req, { erreur: 'Erreur de session.' }));
      req.session.utilisateur = u;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      tracer(u.login, 'auth:succes', { details: { role: u.role, source: u.source } });
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

  // --- Logos des applications ---------------------------------------------------------------
  app.get('/logos/:fichier', exigerAuth, (req, res) => {
    const f = path.basename(req.params.fichier);
    const p = path.join(config.logosDir, f);
    if (!/^logo_[a-f0-9]{16}\.(png|jpe?g|svg|webp|gif)$/.test(f) || !fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });

  // --- Tableau de bord ------------------------------------------------------------------------
  app.get('/', exigerAuth, (req, res) => {
    const u = req.session.utilisateur;
    if (!peut(u.role, 'habilitation:suivre')) {
      const rac = (href, icone, titre, desc) =>
        `<a class="rac" href="${href}"><span class="ic">${ICONES[icone]}</span>
          <span><span class="t">${titre}</span><span class="d">${desc}</span></span></a>`;
      return res.send(
        page(req, 'Accueil',
          `<div class="raccourcis">
            ${rac('/habilitations/nouvelle', 'plus', 'Demander un accès', 'Pour vous ou pour un collègue')}
            ${rac('/mes-demandes', 'liste', 'Mes demandes', 'Suivre mes demandes en cours')}
            ${rac('/recherche', 'loupe', 'Rechercher un agent', 'Ses accès, ses preuves')}
          </div>
          <p class="aide">Chaque demande est tracée et conservée avec ses pièces justificatives (mail de la
          demande, capture, PDF). C'est ce registre qui est présenté aux auditeurs.</p>`),
      );
    }
    const s = statistiques();
    const n = (st) => s.parStatut[st] ?? 0;
    const tuile = (v, label, href, alerte = false) =>
      `<a class="tuile${alerte && v > 0 ? ' alerte' : ''}" href="${href}"><div class="v">${v}</div><div class="l micro">${label}</div></a>`;
    const chaine = verifierChaine();
    res.send(
      page(req, 'Tableau de bord',
        `${chaine.valide ? '' : bandeauErreur(`Rupture de la chaîne d'audit détectée (entrée n°${chaine.rupture}). Consultez le journal.`)}
        <div class="micro" style="margin:0 0 10px">Demandes d'habilitation</div>
        <div class="tuiles">
          ${tuile(n('demandee'), 'À valider', '/suivi?statut=demandee', true)}
          ${tuile(n('validee'), 'À exécuter', '/suivi?statut=validee', true)}
          ${tuile(n('executee'), 'Actives', '/suivi?statut=executee')}
          ${tuile(n('revoquee'), 'Révoquées', '/suivi?statut=revoquee')}
        </div>
        <div class="micro" style="margin:26px 0 10px">Registre et preuves</div>
        <div class="tuiles">
          ${tuile(s.agents, 'Agents au registre', '/recherche')}
          ${tuile(s.habilitations, 'Habilitations', '/suivi')}
          ${tuile(s.preuves, 'Pièces au coffre', '/coffre')}
          ${tuile(s.sansPreuve, 'Validées sans preuve', '/suivi?sans_preuve=1', true)}
        </div>
        <div class="deux-col" style="margin-top:30px">
          <section style="margin-top:0"><h2>Habilitations actives par application</h2>
            <div class="carte">${barres(s.parApplication.slice(0, 10).map((r) => ({ label: r.libelle, n: r.n })))}</div>
          </section>
          <section style="margin-top:0"><h2>Journal</h2>
            <div class="carte">${chaine.valide
              ? `<p style="margin:0 0 8px">${bandeauOk(`Chaîne d'audit intègre : ${chaine.entrees} entrée(s).`)}</p>`
              : ''}
              <ul class="histo">${journal({ limite: 8 }).map((j) =>
                `<li><span class="q">${echap(j.horodatage.slice(0, 16).replace('T', ' '))}</span><span>${echap(j.acteur)} · ${echap(j.action)}</span></li>`).join('')}</ul>
              <p style="margin:12px 0 0"><a href="/audit">Tout le journal</a></p>
            </div>
          </section>
        </div>`,
        peut(u.role, 'habilitation:creer') ? `<a class="btn btn-primary" href="/habilitations/nouvelle">${ICONES.plus}Nouvelle demande</a>` : ''),
    );
  });

  // --- Recherche d'un agent -----------------------------------------------------------------
  app.get('/recherche', exigerAuth, exigerDroit('habilitation:lire'), (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    let resultats;
    if (q.trim()) {
      const agents = rechercherAgents(q);
      resultats = agents.length
        ? agents.map((a) => `<div class="groupe-agent">
              <div class="entete-a"><h3>${echap(a.nom)} ${echap(a.prenom)}</h3><span class="matricule micro">${echap(a.matricule)}</span></div>
              <table><thead><tr><th>Application</th><th>Profil</th><th>UF</th><th>Statut</th><th>Demande</th><th>Réalisation</th><th>Preuves</th><th></th></tr></thead>
              <tbody>${a.habilitations.map((h) => `<tr>
                <td>${echap(h.app_libelle)}</td><td>${echap(h.role)}</td>
                <td class="mono">${echap(libelleUfs(h) || '-')}</td>
                <td>${tag(h.statut)}</td><td class="mono">${echap(h.date_demande ?? '')}</td>
                <td class="mono">${echap(h.date_realisation ?? '')}</td>
                <td class="mono">${h.nb_preuves}</td>
                <td><a href="/habilitations/${h.id}">Ouvrir</a></td></tr>`).join('')
                || '<tr><td colspan="8" style="color:var(--ink-3)">Aucune habilitation.</td></tr>'}</tbody></table>
            </div>`).join('')
        : `<div class="vide">Aucun agent ne correspond à « ${echap(q)} ».</div>`;
    } else {
      resultats = '<div class="vide">Saisissez un matricule, un nom ou un prénom.</div>';
    }
    res.send(
      page(req, 'Rechercher un agent',
        `<form method="get" class="carte" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:240px"><label for="q">Matricule, nom ou prénom</label>
            <input id="q" name="q" value="${echap(q)}" autofocus placeholder="ex. E12345 ou Durand"></div>
          <button class="btn btn-primary" type="submit">${ICONES.loupe}Rechercher</button>
        </form><section>${resultats}</section>`),
    );
  });

  // --- Nouvelle demande : catalogue puis formulaire -----------------------------------------------
  app.get('/habilitations/nouvelle', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const apps = listerApplications({ actives: true });
    const cats = listerCategories().filter((c) => apps.some((a) => a.categorie_id === c.id));
    const sansCat = apps.filter((a) => !a.categorie_id);
    if (sansCat.length) cats.push({ id: 0, libelle: 'Autres' });
    const courante = cats.some((c) => String(c.id) === String(req.query.cat)) ? Number(req.query.cat) : cats[0]?.id;
    const tabs = cats.map((c) => `<a href="/habilitations/nouvelle?cat=${c.id}" class="${c.id === courante ? 'actif' : ''}">${echap(c.libelle)}</a>`).join('');
    const cartes = apps
      .filter((a) => (courante === 0 ? !a.categorie_id : a.categorie_id === courante))
      .map((a) => `<div class="srv"><span class="ico">${logoApp(a)}</span>
          <div class="n">${echap(a.libelle)}</div><div class="c mono">${echap(a.code)}</div>
          <div class="b"><a class="btn btn-primary btn-petit" href="/habilitations/nouvelle/${a.id}">${ICONES.plus}Demander l'accès</a></div></div>`)
      .join('');
    res.send(
      page(req, 'Nouvelle demande',
        apps.length
          ? `${cats.length > 1 ? `<div class="cat-tabs">${tabs}</div>` : ''}<div class="cat-grid">${cartes}</div>`
          : '<div class="vide">Aucune application au catalogue. Un administrateur doit d\'abord en déclarer.</div>'),
    );
  });

  app.get('/habilitations/nouvelle/:appId', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const a = applicationParId(nombre(req.params.appId));
    if (!a || a.actif === 0) return res.status(404).send(pageErreur(req, 'Introuvable', 'Application introuvable ou désactivée.', '/habilitations/nouvelle'));
    const u = req.session.utilisateur;
    const sites = listerSites().map((s) => `<option value="${s.id}">${echap(s.nom)}</option>`).join('');
    const ufs = listerUfs().map((f) => `<option value="${f.id}">${echap(f.code)} · ${echap(f.libelle)}</option>`).join('');
    const SELF = jsonInline({ matricule: u.matricule || '', email: u.email || '', nom: u.nom || '' });
    res.send(
      page(req, 'Nouvelle demande',
        `<div class="srv-tete"><span class="ico">${logoApp(a)}</span>
          <div><h2>${echap(a.libelle)}</h2><div class="c">${echap(a.cat_libelle ?? '')} · ${echap(a.code)}</div></div></div>
        <form method="post" action="/habilitations" class="carte" style="max-width:680px">
          <input type="hidden" name="applicationId" value="${a.id}">
          <label>Pour qui ?</label>
          <div class="radios">
            <label class="radio"><input type="radio" name="pour_autrui" value="0" checked> Pour moi</label>
            <label class="radio"><input type="radio" name="pour_autrui" value="1"> Pour un autre agent</label>
          </div>
          <div class="grille2">
            <div><label for="matricule">Matricule du bénéficiaire</label><input id="matricule" name="matricule" value="${echap(u.matricule || '')}" required readonly maxlength="40"></div>
            <div><label for="email">Courriel du bénéficiaire <span class="opt">(notifications)</span></label><input id="email" name="email" type="email" value="${echap(u.email || '')}" readonly maxlength="200"></div>
          </div>
          <div id="benef" class="grille2" hidden>
            <div><label for="nom">Nom</label><input id="nom" name="nom" maxlength="100"></div>
            <div><label for="prenom">Prénom</label><input id="prenom" name="prenom" maxlength="100"></div>
          </div>
          <label for="role">Profil ou droit demandé</label>
          <input id="role" name="role" required maxlength="200" placeholder="ex. Gestionnaire admissions, Lecture seule, Prescripteur…">
          <div class="grille2">
            <div><label for="ufIds">UF concernées <span class="opt">(référentiel, plusieurs possibles)</span></label>
              <select id="ufIds" name="ufIds" multiple size="5">${ufs || '<option disabled>Aucune UF déclarée</option>'}</select></div>
            <div><label for="uf_libre">Autres UF <span class="opt">(saisie libre)</span></label><input id="uf_libre" name="uf_libre" maxlength="200" placeholder="ex. 1101, Urgences">
              <label for="siteId">Site</label><select id="siteId" name="siteId"><option value="">Non précisé</option>${sites}</select></div>
          </div>
          <label for="commentaire">Motif, contexte <span class="opt">(facultatif)</span></label>
          <textarea id="commentaire" name="commentaire" maxlength="2000" placeholder="Prise de poste, remplacement, changement de service…"></textarea>
          <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Déposer la demande</button>
            <a class="btn btn-ghost" href="/habilitations/nouvelle?cat=${a.categorie_id ?? 0}">Retour au catalogue</a></div>
        </form>
        <script nonce="${req.nonce}">(function(){
          var SELF=${SELF},benef=document.getElementById('benef'),mat=document.getElementById('matricule'),
              mail=document.getElementById('email'),nom=document.getElementById('nom'),prenom=document.getElementById('prenom');
          function autre(){return document.querySelector('input[name=pour_autrui]:checked').value==='1';}
          function maj(){var a=autre();benef.hidden=!a;mat.readOnly=!a;mail.readOnly=!a;nom.required=a;
            if(!a){mat.value=SELF.matricule;mail.value=SELF.email;nom.value='';prenom.value='';}
            else{if(mat.value===SELF.matricule)mat.value='';if(mail.value===SELF.email)mail.value='';}}
          document.querySelectorAll('input[name=pour_autrui]').forEach(function(r){r.addEventListener('change',maj);});
          mat.addEventListener('blur',function(){if(!autre()||!mat.value)return;
            fetch('/api/agent?matricule='+encodeURIComponent(mat.value)).then(function(r){return r.json();})
              .then(function(d){if(d&&d.trouve){if(!nom.value)nom.value=d.nom||'';if(!prenom.value)prenom.value=d.prenom||'';if(!mail.value)mail.value=d.email||'';}})
              .catch(function(){});});
          maj();})();</script>`),
    );
  });

  app.get('/api/agent', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const a = agentParMatricule(String(req.query.matricule ?? '').slice(0, 40));
    res.json(a ? { trouve: true, nom: a.nom, prenom: a.prenom, email: a.email ?? '' } : { trouve: false });
  });

  app.post('/habilitations', exigerAuth, exigerDroit('habilitation:creer'), async (req, res) => {
    const b = req.body;
    const u = req.session.utilisateur;
    const pourAutrui = b.pour_autrui === '1';
    const agent = pourAutrui
      ? { matricule: b.matricule, nom: b.nom, prenom: b.prenom, email: b.email }
      : { matricule: u.matricule || b.matricule, nom: u.nom, prenom: '', email: u.email || b.email };
    let h;
    try {
      h = creerHabilitation(u.login, {
        agent,
        applicationId: nombre(b.applicationId),
        role: b.role,
        ufIds: [].concat(b.ufIds ?? []).map(nombre).filter(Boolean),
        ufLibre: b.uf_libre,
        siteId: nombre(b.siteId) || null,
        demandeur: `${u.matricule ? u.matricule + ' ' : ''}${u.nom}`.trim(),
        commentaire: b.commentaire,
        pourAutrui,
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Demande refusée', e.message, `/habilitations/nouvelle/${nombre(b.applicationId) || ''}`));
    }
    const resume = `Demande n°${h.id} : « ${h.role} » sur ${h.app_libelle} pour ${h.nom} ${h.prenom} (matricule ${h.matricule}), déposée par ${h.demandeur}.`;
    await Promise.all([
      notifier({ to: getRoutage(h.app_cat_id), sujet: `Nouvelle demande d'habilitation : ${h.app_libelle}`, texte: resume }),
      notifier({ to: h.email, sujet: `Demande enregistrée : ${h.app_libelle}`, texte: resume }),
    ]);
    res.redirect(`/habilitations/${h.id}`);
  });

  // --- Mes demandes -----------------------------------------------------------------------------
  app.get('/mes-demandes', exigerAuth, (req, res) => {
    const demandes = listerDemandesDe(req.session.utilisateur.login);
    res.send(
      page(req, 'Mes demandes',
        demandes.length
          ? `<table><thead><tr><th>N°</th><th>Application</th><th>Profil</th><th>Bénéficiaire</th><th>Statut</th><th>Date</th><th></th></tr></thead>
            <tbody>${demandes.map((h) => `<tr><td class="mono">${h.id}</td><td>${echap(h.app_libelle)}</td><td>${echap(h.role)}</td>
              <td>${echap(h.nom)} ${echap(h.prenom)} <span class="mono">(${echap(h.matricule)})</span></td>
              <td>${tag(h.statut)}</td><td class="mono">${echap(h.date_demande ?? '')}</td>
              <td><a href="/habilitations/${h.id}">Ouvrir</a></td></tr>`).join('')}</tbody></table>`
          : '<div class="vide">Vous n\'avez pas encore déposé de demande.</div>',
        peut(req.session.utilisateur.role, 'habilitation:creer') ? `<a class="btn btn-primary" href="/habilitations/nouvelle">${ICONES.plus}Nouvelle demande</a>` : ''),
    );
  });

  // --- Suivi (colonnes par statut, filtrable) ------------------------------------------------------
  app.get('/suivi', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const statut = STATUTS.includes(req.query.statut) ? req.query.statut : '';
    const applicationId = nombre(req.query.app);
    const q = String(req.query.q ?? '').slice(0, 100);
    const sansPreuve = req.query.sans_preuve === '1';
    let habs = listerHabilitations({ statut, applicationId, q });
    if (sansPreuve) habs = habs.filter((h) => h.nb_preuves === 0 && ['validee', 'executee'].includes(h.statut));
    const peutAgir = (h, droit) => peut(u.role, droit) && referentGereApplication(u, h.application_id);
    const carte = (h) => {
      const benef = `${h.nom} ${h.prenom}`.trim();
      const btn = (action, label, droit) => peutAgir(h, droit)
        ? `<form method="post" action="/habilitations/${h.id}/${action}"><input type="hidden" name="retour" value="${echap(req.originalUrl)}">
             <button class="btn btn-ghost btn-petit">${label}</button></form>` : '';
      const acts = h.statut === 'demandee' ? btn('valider', 'Valider', 'habilitation:valider') + btn('executer', 'Exécuter', 'habilitation:executer')
        : h.statut === 'validee' ? btn('executer', 'Exécuter', 'habilitation:executer') : '';
      return `<div class="ticket">
        <div class="top"><a class="id" href="/habilitations/${h.id}">#${h.id}</a><span class="date">${echap(h.date_demande ?? '')}</span></div>
        <a class="titre" href="/habilitations/${h.id}">${echap(h.app_libelle)} · ${echap(h.role)}</a>
        <div class="who"><span class="av">${echap(initiales(benef))}</span>${echap(benef)} <span class="mono" style="color:var(--ink-3)">${echap(h.matricule)}</span></div>
        ${h.nb_preuves === 0 && h.statut !== 'demandee' ? '<div style="margin-top:8px;font-size:12px;color:var(--demande)">Aucune preuve jointe</div>' : ''}
        ${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
    };
    const col = (st) => habs.filter((h) => h.statut === st).map(carte);
    const optsApp = listerApplications().map((a) => `<option value="${a.id}" ${a.id === applicationId ? 'selected' : ''}>${echap(a.libelle)}</option>`).join('');
    const optsStatut = STATUTS.map((s) => `<option value="${s}" ${s === statut ? 'selected' : ''}>${LIB_STATUT[s]}</option>`).join('');
    const colonnes = (statut ? [statut] : STATUTS).map((st) => ({
      titre: LIB_STATUT[st],
      couleur: { demandee: '#9a6a00', validee: '#1f6fd6', executee: '#0e8f5d', revoquee: '#c0392b' }[st],
      cartes: col(st),
    }));
    res.send(
      page(req, 'Suivi des demandes',
        `<form method="get" class="filtres">
          <div><label for="f-q">Agent, profil, application</label><input id="f-q" name="q" value="${echap(q)}" placeholder="Rechercher"></div>
          <div><label for="f-st">Statut</label><select id="f-st" name="statut"><option value="">Tous</option>${optsStatut}</select></div>
          <div><label for="f-app">Application</label><select id="f-app" name="app"><option value="">Toutes</option>${optsApp}</select></div>
          <label class="radio"><input type="checkbox" name="sans_preuve" value="1" ${sansPreuve ? 'checked' : ''}> Sans preuve</label>
          <button class="btn btn-ghost" type="submit">Filtrer</button>
          ${q || statut || applicationId || sansPreuve ? '<a class="btn btn-ghost" href="/suivi">Réinitialiser</a>' : ''}
        </form>
        ${habs.length ? tableauColonnes(colonnes) : '<div class="vide">Aucune demande ne correspond.</div>'}
        <p class="champ-aide">${habs.length} habilitation(s) affichée(s).</p>`,
        peut(u.role, 'habilitation:creer') ? `<a class="btn btn-primary" href="/habilitations/nouvelle">${ICONES.plus}Nouvelle demande</a>` : '',
        { large: true }),
    );
  });

  // --- Fiche d'une habilitation --------------------------------------------------------------------
  app.get('/habilitations/:id', exigerAuth, exigerDroit('habilitation:lire'), (req, res) => {
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    const u = req.session.utilisateur;
    const peutAgir = (droit) => peut(u.role, droit) && referentGereApplication(u, h.application_id);
    const bouton = (action, label, droit, classe = 'btn-ghost') => peutAgir(droit)
      ? `<form method="post" action="/habilitations/${h.id}/${action}"><button class="btn ${classe}">${label}</button></form>` : '';
    const actions = [
      h.statut === 'demandee' ? bouton('valider', 'Valider', 'habilitation:valider', 'btn-primary') : '',
      ['demandee', 'validee'].includes(h.statut) ? bouton('executer', 'Marquer exécutée', 'habilitation:executer', h.statut === 'validee' ? 'btn-primary' : 'btn-ghost') : '',
    ].join('');
    const revocation = h.statut !== 'revoquee' && peutAgir('habilitation:revoquer')
      ? `<form method="post" action="/habilitations/${h.id}/revoquer" class="carte" style="margin-top:14px;max-width:560px">
          <label for="motif">Révoquer cette habilitation <span class="opt">(motif conservé au journal)</span></label>
          <input id="motif" name="motif" maxlength="300" placeholder="ex. départ de l'agent le 31/12">
          <div class="actions"><button class="btn btn-danger" type="submit">Révoquer</button></div></form>` : '';
    const preuves = h.preuves.length
      ? `<table><thead><tr><th>Type</th><th>Fichier</th><th>Déposée</th><th>Empreinte SHA-256</th><th>Intégrité</th><th></th></tr></thead><tbody>${h.preuves.map((p) => {
          const v = verifierIntegrite(p);
          return `<tr><td>${echap(p.type)}</td><td>${echap(p.nom_origine)}</td>
            <td class="mono">${echap(p.cree_le.slice(0, 16))} · ${echap(p.ajoutee_par ?? '')}</td>
            <td><code class="hash" title="${echap(p.sha256)}">${p.sha256.slice(0, 20)}…</code></td>
            <td>${v.intacte ? '<span class="tag t-executee">intègre</span>' : '<span class="tag t-revoquee">altérée</span>'}</td>
            <td><a href="/preuves/${p.id}">Télécharger</a></td></tr>`;
        }).join('')}</tbody></table>`
      : '<div class="vide">Aucune preuve jointe. Joignez le mail de demande, la validation du responsable ou une capture.</div>';
    const histo = historique('habilitation', h.id).map((j) => {
      const d = j.details ? JSON.parse(j.details) : {};
      const extra = d.motif ? ` · motif : ${echap(d.motif)}` : d.nom ? ` · ${echap(d.nom)}` : '';
      return `<li><span class="q">${echap(j.horodatage.slice(0, 19).replace('T', ' '))}</span><span>${echap(j.acteur)} · ${echap(j.action)}${extra}</span></li>`;
    }).join('');
    res.send(
      page(req, `Habilitation n°${h.id}`,
        `<div class="carte"><div class="fiche-meta">
            ${item('Bénéficiaire', `${echap(h.nom)} ${echap(h.prenom)}`)}
            ${item('Matricule', `<span class="mono">${echap(h.matricule)}</span>`)}
            ${item('Application', `${echap(h.app_libelle)} <span class="mono" style="color:var(--ink-3)">${echap(h.app_code)}</span>`)}
            ${item('Profil / droit', echap(h.role))}
            ${item('Statut', tag(h.statut))}
            ${item('UF', `<span class="mono">${echap(libelleUfs(h) || '-')}</span>`)}
            ${item('Site', echap(h.site_nom ?? '-'))}
            ${item('Demandeur', `${echap(h.demandeur ?? '-')}${h.pour_autrui ? '' : ' (pour lui-même)'}`)}
            ${item('Demande', `<span class="mono">${echap(h.date_demande ?? '-')}</span>`)}
            ${item('Validation', `<span class="mono">${echap(h.date_validation ?? '-')}</span>`)}
            ${item('Réalisation', `<span class="mono">${echap(h.date_realisation ?? '-')}</span>`)}
            ${item('Révocation', `<span class="mono">${echap(h.date_revocation ?? '-')}</span>`)}
          </div>
          ${h.commentaire ? `<p style="margin:16px 0 0;color:var(--ink-2);white-space:pre-wrap">${echap(h.commentaire)}</p>` : ''}
        </div>
        ${actions ? `<div class="actions-ligne" style="margin-top:16px">${actions}</div>` : ''}
        <section><h2>Preuves</h2>${preuves}
          ${peut(u.role, 'preuve:ajouter') && h.statut !== 'revoquee'
            ? `<form method="post" action="/habilitations/${h.id}/preuves" enctype="multipart/form-data" class="carte" style="margin-top:14px">
                 <label for="preuve">Joindre une pièce <span class="opt">(${EXTENSIONS_ACCEPTEES.join(', ')} · ${Math.round(config.tailleMaxPreuve / 1048576)} Mo max)</span></label>
                 <input id="preuve" type="file" name="preuve" required accept="${EXTENSIONS_ACCEPTEES.join(',')}">
                 <div class="actions"><button class="btn btn-ghost" type="submit">${ICONES.coffre}Déposer au coffre</button></div></form>` : ''}
        </section>
        <section><h2>Historique tracé</h2><div class="carte"><ul class="histo">${histo || '<li>Aucune entrée.</li>'}</ul></div></section>
        ${revocation}`,
        `<a class="btn btn-ghost" href="/recherche?q=${encodeURIComponent(h.matricule)}">Tous les accès de l'agent</a>`),
    );
  });

  app.post('/habilitations/:id/:action', exigerAuth, (req, res, next) => {
    const droits = { valider: 'habilitation:valider', executer: 'habilitation:executer', revoquer: 'habilitation:revoquer' };
    const action = req.params.action;
    if (action === 'preuves') return next();
    const u = req.session.utilisateur;
    const droit = droits[action];
    if (!droit || !peut(u.role, droit)) return res.status(403).send(pageErreur(req, 'Accès refusé', 'Votre rôle ne permet pas cette action.'));
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    if (!referentGereApplication(u, h.application_id)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', `Vous n'êtes pas référent de l'application « ${h.app_libelle} ».`, `/habilitations/${h.id}`));
    }
    let maj;
    try {
      maj = changerStatut(u.login, h.id, action, { motif: req.body.motif });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Action impossible', e.message, `/habilitations/${h.id}`));
    }
    const MESSAGES = {
      valider: { sujet: 'Demande validée', texte: 'a été validée' },
      executer: { sujet: 'Accès ouvert', texte: "a été exécutée : l'accès est ouvert" },
      revoquer: { sujet: 'Habilitation révoquée', texte: 'a été révoquée' },
    };
    const m = MESSAGES[action];
    notifier({
      to: [...new Set([maj.email, emailUtilisateur(maj.cree_par)].filter(Boolean))],
      sujet: `${m.sujet} : ${maj.app_libelle}`,
      texte: `L'habilitation n°${maj.id} « ${maj.role} » sur ${maj.app_libelle} pour ${maj.nom} ${maj.prenom} ${m.texte}.`,
    });
    res.redirect(cheminSur(req.body.retour, `/habilitations/${h.id}`));
  });

  app.post('/habilitations/:id/preuves', exigerAuth, exigerDroit('preuve:ajouter'), (req, res, next) => {
    upload.single('preuve')(req, res, (err) => {
      if (err) return res.status(400).send(pageErreur(req, 'Pièce refusée', err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux.' : err.message, `/habilitations/${nombre(req.params.id)}`));
      next();
    });
  }, verifierCsrf, (req, res) => {
    const id = nombre(req.params.id);
    if (!req.file) return res.status(400).send(pageErreur(req, 'Pièce refusée', 'Aucun fichier reçu.', `/habilitations/${id}`));
    try {
      ajouterPreuve(req.session.utilisateur.login, id, { tampon: req.file.buffer, nom: req.file.originalname });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Pièce refusée', e.message, `/habilitations/${id}`));
    }
    res.redirect(`/habilitations/${id}`);
  });

  app.get('/preuves/:id', exigerAuth, exigerDroit('preuve:lire'), (req, res) => {
    const p = preuveParId(nombre(req.params.id));
    if (!p || !fs.existsSync(cheminPreuve(p))) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pièce introuvable.'));
    tracer(req.session.utilisateur.login, 'preuve:consulter', { entite: 'habilitation', entiteId: p.habilitation_id, details: { preuve: p.id } });
    res.download(cheminPreuve(p), p.nom_origine);
  });

  // --- Packs « nouvel arrivant » ---------------------------------------------------------------------
  app.get('/packs', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const packs = listerPacks();
    res.send(
      page(req, 'Nouvel arrivant',
        `<p class="aide">Un pack regroupe les accès habituels d'un poste. Toutes les demandes sont déposées d'un coup pour l'agent qui arrive.</p>
        ${packs.length ? `<div class="cat-grid">${packs.map((p) => `<div class="srv"><span class="ico">${ICONES.pack}</span>
            <div class="n">${echap(p.nom)}</div><div class="c">${p.nb} accès${p.description ? ' · ' + echap(p.description) : ''}</div>
            <div class="b"><a class="btn btn-primary btn-petit" href="/packs/${p.id}/appliquer">Préparer les accès</a></div></div>`).join('')}</div>`
          : '<div class="vide">Aucun pack défini. Un administrateur peut en créer dans Administration, Packs nouvel arrivant.</div>'}`),
    );
  });

  app.get('/packs/:id/appliquer', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const p = packParId(nombre(req.params.id));
    if (!p || !p.actif) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pack introuvable.', '/packs'));
    const sites = listerSites().map((s) => `<option value="${s.id}">${echap(s.nom)}</option>`).join('');
    const ufs = listerUfs().map((f) => `<option value="${f.id}">${echap(f.code)} · ${echap(f.libelle)}</option>`).join('');
    res.send(
      page(req, `Pack : ${p.nom}`,
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Accès inclus (${p.elements.length})</h2>
            <div class="carte"><ul style="margin:0;padding-left:18px;line-height:1.9">${p.elements.map((e) => `<li>${echap(e.app_libelle)} <span style="color:var(--ink-3)">· ${echap(e.role || p.nom)}</span></li>`).join('') || '<li>Aucun élément.</li>'}</ul></div>
          </section>
          <section style="margin-top:0"><h2>Bénéficiaire</h2>
            <form method="post" action="/packs/${p.id}/appliquer" class="carte">
              <div class="grille2">
                <div><label for="matricule">Matricule</label><input id="matricule" name="matricule" required maxlength="40"></div>
                <div><label for="email">Courriel <span class="opt">(facultatif)</span></label><input id="email" name="email" type="email" maxlength="200"></div>
                <div><label for="nom">Nom</label><input id="nom" name="nom" required maxlength="100"></div>
                <div><label for="prenom">Prénom</label><input id="prenom" name="prenom" maxlength="100"></div>
              </div>
              <div class="grille2">
                <div><label for="ufIds">UF <span class="opt">(référentiel)</span></label><select id="ufIds" name="ufIds" multiple size="4">${ufs || '<option disabled>Aucune UF déclarée</option>'}</select></div>
                <div><label for="uf_libre">Autres UF</label><input id="uf_libre" name="uf_libre" maxlength="200">
                  <label for="siteId">Site</label><select id="siteId" name="siteId"><option value="">Non précisé</option>${sites}</select></div>
              </div>
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.pack}Déposer les ${p.elements.length} demandes</button>
                <a class="btn btn-ghost" href="/packs">Annuler</a></div>
            </form>
          </section>
        </div>
        <script nonce="${req.nonce}">(function(){var mat=document.getElementById('matricule'),nom=document.getElementById('nom'),prenom=document.getElementById('prenom'),mail=document.getElementById('email');
          mat.addEventListener('blur',function(){if(!mat.value)return;fetch('/api/agent?matricule='+encodeURIComponent(mat.value)).then(function(r){return r.json();})
            .then(function(d){if(d&&d.trouve){if(!nom.value)nom.value=d.nom||'';if(!prenom.value)prenom.value=d.prenom||'';if(!mail.value)mail.value=d.email||'';}}).catch(function(){});});})();</script>`),
    );
  });

  app.post('/packs/:id/appliquer', exigerAuth, exigerDroit('habilitation:creer'), async (req, res) => {
    const p = packParId(nombre(req.params.id));
    if (!p || !p.actif) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pack introuvable.', '/packs'));
    const b = req.body;
    const u = req.session.utilisateur;
    let creees;
    try {
      creees = appliquerPack(u.login, p, {
        agent: { matricule: b.matricule, nom: b.nom, prenom: b.prenom, email: b.email },
        siteId: nombre(b.siteId) || null,
        ufIds: [].concat(b.ufIds ?? []).map(nombre).filter(Boolean),
        ufLibre: b.uf_libre,
        demandeur: `${u.matricule ? u.matricule + ' ' : ''}${u.nom}`.trim(),
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Pack non appliqué', e.message, `/packs/${p.id}/appliquer`));
    }
    const resume = `Pack « ${p.nom} » appliqué pour ${b.nom} ${b.prenom ?? ''} (matricule ${b.matricule}) par ${u.nom} : ${creees.map((h) => h.app_libelle).join(', ')}.`;
    await notifier({ to: [...new Set([p.destinataire, b.email].filter(Boolean))], sujet: `Nouvel arrivant : pack ${p.nom}`, texte: resume });
    res.send(
      page(req, 'Demandes déposées',
        `${bandeauOk(`${creees.length} demande(s) déposée(s) pour ${b.nom} ${b.prenom ?? ''} via le pack « ${p.nom} ».`)}
        <table><thead><tr><th>N°</th><th>Application</th><th>Profil</th><th>Statut</th><th></th></tr></thead><tbody>${creees.map((h) =>
          `<tr><td class="mono">${h.id}</td><td>${echap(h.app_libelle)}</td><td>${echap(h.role)}</td><td>${tag(h.statut)}</td><td><a href="/habilitations/${h.id}">Ouvrir</a></td></tr>`).join('')}</tbody></table>`,
        `<a class="btn btn-ghost" href="/packs">Retour aux packs</a>`),
    );
  });

  // --- Audit : dossier de preuves, coffre, journal --------------------------------------------------------
  app.get('/export', exigerAuth, exigerDroit('export:audit'), (req, res) => {
    res.send(
      page(req, 'Dossier de preuves',
        `<div class="carte" style="max-width:680px">
          <p class="aide">Collez la liste des matricules échantillonnés par l'auditeur. Vous obtenez un ZIP contenant
            une synthèse imprimable, un tableau CSV, le manifeste des empreintes et toutes les pièces classées par matricule.</p>
          <form method="post" action="/export">
            <label for="matricules">Matricules <span class="opt">(un par ligne, ou séparés par virgule ou espace)</span></label>
            <textarea id="matricules" name="matricules" rows="8" required class="mono" placeholder="E12345&#10;E22222&#10;E33333"></textarea>
            <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.coffre}Générer le dossier ZIP</button></div>
          </form>
        </div>`),
    );
  });
  app.post('/export', exigerAuth, exigerDroit('export:audit'), (req, res) => {
    const matricules = analyserMatricules(req.body.matricules);
    if (!matricules.length || matricules.length > 500) {
      return res.status(400).send(pageErreur(req, 'Export impossible', 'Saisissez entre 1 et 500 matricules.', '/export'));
    }
    const nom = `dossier-preuves-habilitations-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    genererDossierZip(req.session.utilisateur.login, matricules.join('\n'), res);
  });

  app.get('/coffre', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const r = auditerCoffre();
    res.send(
      page(req, 'Intégrité du coffre',
        `${r.anomalies.length ? bandeauErreur(`${r.anomalies.length} pièce(s) altérée(s) ou manquante(s) sur ${r.total}.`) : bandeauOk(`${r.total} pièce(s) vérifiée(s), toutes intègres.`)}
        ${r.anomalies.length ? `<table><thead><tr><th>Habilitation</th><th>Fichier</th><th>Empreinte attendue</th><th>Constat</th></tr></thead><tbody>${r.anomalies.map((p) =>
          `<tr><td><a href="/habilitations/${p.habilitation_id}">n°${p.habilitation_id}</a></td><td>${echap(p.nom_origine)}</td><td><code class="hash">${p.sha256.slice(0, 20)}…</code></td><td>${echap(p.raison)}</td></tr>`).join('')}</tbody></table>` : ''}
        <p class="champ-aide">Chaque pièce est ré-empreintée (SHA-256) et comparée à l'empreinte enregistrée lors du dépôt.</p>`),
    );
  });

  app.get('/audit', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    const chaine = verifierChaine();
    const ancr = verifierAncrages();
    const bandeauAncrage = !ancr.valide
      ? bandeauErreur(`${ancr.anomalies.length} anomalie(s) d'ancrage : ${ancr.anomalies.map((a) => a.raison).join(' ; ')}`)
      : ancr.dernier
        ? bandeauOk(`Dernier ancrage le ${echap(ancr.dernier.horodatage.slice(0, 19).replace('T', ' '))} UTC (${ancr.ancrages} ancrage(s), tous cohérents avec la chaîne).`)
        : `<p class="champ-aide">Aucun ancrage enregistré : lancez <code>registris ancrer</code> régulièrement pour déposer l'empreinte de tête hors de la base.</p>`;
    const lignes = journal({ limite: 300, q }).map((j) =>
      `<tr><td class="mono">${echap(j.horodatage.slice(0, 19).replace('T', ' '))}</td><td>${echap(j.acteur)}</td>
        <td><code class="hash">${echap(j.action)}</code></td>
        <td class="mono">${j.entite === 'habilitation' && j.entite_id ? `<a href="/habilitations/${j.entite_id}">habilitation n°${j.entite_id}</a>` : echap(`${j.entite ?? ''} ${j.entite_id ?? ''}`)}</td>
        <td style="font-size:12px;color:var(--ink-2)">${echap(j.details ?? '')}</td></tr>`).join('');
    res.send(
      page(req, "Journal d'audit",
        `${chaine.valide ? bandeauOk(`Chaîne d'audit intègre : ${chaine.entrees} entrée(s) vérifiée(s).`)
          : bandeauErreur(`Rupture détectée à l'entrée n°${chaine.rupture} (${chaine.raison}). Le journal a été altéré après coup.`)}
        ${bandeauAncrage}
        <form method="get" class="filtres"><div style="flex:1"><label for="q">Filtrer</label><input id="q" name="q" value="${echap(q)}" placeholder="acteur, action, matricule…"></div>
          <button class="btn btn-ghost" type="submit">Filtrer</button></form>
        <table><thead><tr><th>Horodatage (UTC)</th><th>Acteur</th><th>Action</th><th>Cible</th><th>Détail</th></tr></thead>
          <tbody>${lignes || '<tr><td colspan="5" style="color:var(--ink-3)">Aucune entrée.</td></tr>'}</tbody></table>
        <p class="champ-aide">300 dernières entrées. Chaque entrée scelle la précédente par son empreinte : rien ne peut être modifié ou supprimé discrètement.</p>`,
        '', { large: true }),
    );
  });

  // --- Administration -----------------------------------------------------------------------------------
  const admin = exigerDroit('admin:gerer');
  const acteur = (req) => req.session.utilisateur.login;
  const erreur400 = (req, res, titre, e, retour) => res.status(400).send(pageErreur(req, titre, e.message, retour));

  app.get('/admin/applications', exigerAuth, admin, (req, res) => {
    const cats = listerCategories({ tous: true });
    const optCat = (sel) => `<option value="">Sans catégorie</option>${cats.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${echap(c.libelle)}</option>`).join('')}`;
    const lignes = listerApplications().map((a) => `<tr>
        <td><span class="ico" style="width:34px;height:34px">${logoApp(a)}</span></td>
        <td class="mono">${echap(a.code)}</td>
        <td>${echap(a.libelle)}${a.actif === 0 ? ' <span class="micro">(inactive)</span>' : ''}</td>
        <td>${echap(a.cat_libelle ?? '-')}</td>
        <td><div class="actions-ligne" style="margin:0">
          <a class="btn btn-ghost btn-petit" href="/admin/applications/${a.id}/modifier">Modifier</a>
          <form method="post" action="/admin/applications/${a.id}/supprimer" data-confirmer="Supprimer cette application ?"><button class="btn btn-danger btn-petit">Supprimer</button></form>
        </div></td></tr>`).join('');
    res.send(
      page(req, 'Applications',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Catalogue</h2>
            <table><thead><tr><th></th><th>Code</th><th>Libellé</th><th>Catégorie</th><th></th></tr></thead>
              <tbody>${lignes || '<tr><td colspan="5" style="color:var(--ink-3)">Aucune application.</td></tr>'}</tbody></table>
          </section>
          <section style="margin-top:0"><h2>Ajouter une application</h2>
            <form method="post" action="/admin/applications" enctype="multipart/form-data" class="carte">
              <label for="code">Code <span class="opt">(unique, ex. GAM, DPI)</span></label><input id="code" name="code" required maxlength="40" pattern="[A-Za-z0-9_.\\-]{2,40}">
              <label for="libelle">Libellé</label><input id="libelle" name="libelle" required maxlength="120" placeholder="ex. Gestion administrative des malades">
              <label for="categorieId">Catégorie</label><select id="categorieId" name="categorieId">${optCat(null)}</select>
              <label for="logo">Logo <span class="opt">(png, jpg, svg, webp, 2 Mo max, facultatif)</span></label><input id="logo" type="file" name="logo" accept=".png,.jpg,.jpeg,.svg,.webp,.gif">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div>
            </form>
          </section>
        </div>`),
    );
  });
  const uploadLogo = (req, res, next) => upload.single('logo')(req, res, (err) => (err ? erreur400(req, res, 'Logo refusé', err, '/admin/applications') : next()));
  app.post('/admin/applications', exigerAuth, admin, uploadLogo, verifierCsrf, (req, res) => {
    try {
      const logo = req.file ? enregistrerLogo({ tampon: req.file.buffer, nom: req.file.originalname }) : null;
      creerApplication(acteur(req), { code: req.body.code, libelle: req.body.libelle, categorieId: nombre(req.body.categorieId), logo });
    } catch (e) {
      return erreur400(req, res, 'Application non créée', e, '/admin/applications');
    }
    res.redirect('/admin/applications');
  });
  app.get('/admin/applications/:id/modifier', exigerAuth, admin, (req, res) => {
    const a = applicationParId(nombre(req.params.id));
    if (!a) return res.status(404).send(pageErreur(req, 'Introuvable', 'Application introuvable.', '/admin/applications'));
    const cats = listerCategories({ tous: true });
    res.send(
      page(req, `Modifier ${a.code}`,
        `<form method="post" action="/admin/applications/${a.id}/modifier" enctype="multipart/form-data" class="carte" style="max-width:560px">
          <div class="srv-tete"><span class="ico">${logoApp(a)}</span><div><h2>${echap(a.code)}</h2></div></div>
          <label for="libelle">Libellé</label><input id="libelle" name="libelle" value="${echap(a.libelle)}" required maxlength="120">
          <label for="categorieId">Catégorie</label><select id="categorieId" name="categorieId"><option value="">Sans catégorie</option>${cats.map((c) => `<option value="${c.id}" ${c.id === a.categorie_id ? 'selected' : ''}>${echap(c.libelle)}</option>`).join('')}</select>
          <label class="radio" style="margin-top:14px"><input type="checkbox" name="actif" value="1" ${a.actif !== 0 ? 'checked' : ''}> Active (proposée au catalogue)</label>
          <label for="logo">Remplacer le logo <span class="opt">(facultatif)</span></label><input id="logo" type="file" name="logo" accept=".png,.jpg,.jpeg,.svg,.webp,.gif">
          <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button><a class="btn btn-ghost" href="/admin/applications">Annuler</a></div>
        </form>`),
    );
  });
  app.post('/admin/applications/:id/modifier', exigerAuth, admin, uploadLogo, verifierCsrf, (req, res) => {
    try {
      const logo = req.file ? enregistrerLogo({ tampon: req.file.buffer, nom: req.file.originalname }) : undefined;
      modifierApplication(acteur(req), nombre(req.params.id), {
        libelle: req.body.libelle, categorieId: req.body.categorieId === '' ? '' : nombre(req.body.categorieId), logo, actif: req.body.actif === '1',
      });
    } catch (e) {
      return erreur400(req, res, 'Modification refusée', e, `/admin/applications/${nombre(req.params.id)}/modifier`);
    }
    res.redirect('/admin/applications');
  });
  app.post('/admin/applications/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerApplication(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/applications');
    }
    res.redirect('/admin/applications');
  });

  app.get('/admin/categories', exigerAuth, admin, (req, res) => {
    const lignes = listerCategories({ tous: true }).map((c) => `<tr><td class="mono">${c.ordre}</td><td>${echap(c.libelle)}</td>
        <td><form method="post" action="/admin/categories/${c.id}/supprimer" data-confirmer="Supprimer cette catégorie ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Catégories',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Catégories du catalogue</h2>
            <table><thead><tr><th>Ordre</th><th>Libellé</th><th></th></tr></thead><tbody>${lignes || '<tr><td colspan="3" style="color:var(--ink-3)">Aucune catégorie.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Ajouter</h2>
            <form method="post" action="/admin/categories" class="carte">
              <label for="libelle">Libellé</label><input id="libelle" name="libelle" required maxlength="80" placeholder="ex. Applications médicales">
              <label for="ordre">Ordre d'affichage</label><input id="ordre" name="ordre" type="number" min="0" value="0">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form></section>
        </div>`),
    );
  });
  app.post('/admin/categories', exigerAuth, admin, (req, res) => {
    try {
      creerCategorie(acteur(req), { libelle: req.body.libelle, ordre: req.body.ordre });
    } catch (e) {
      return erreur400(req, res, 'Catégorie non créée', e, '/admin/categories');
    }
    res.redirect('/admin/categories');
  });
  app.post('/admin/categories/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerCategorie(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/categories');
    }
    res.redirect('/admin/categories');
  });

  app.get('/admin/ufs', exigerAuth, admin, (req, res) => {
    const lignes = listerUfs().map((f) => `<tr><td class="mono">${echap(f.code)}</td><td>${echap(f.libelle)}</td>
        <td><form method="post" action="/admin/ufs/${f.id}/supprimer" data-confirmer="Supprimer cette UF ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Unités fonctionnelles',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Référentiel des UF</h2>
            <table><thead><tr><th>Code</th><th>Libellé</th><th></th></tr></thead><tbody>${lignes || '<tr><td colspan="3" style="color:var(--ink-3)">Aucune UF. Les demandes peuvent toujours saisir des UF en texte libre.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Ajouter une UF</h2>
            <form method="post" action="/admin/ufs" class="carte">
              <label for="code">Code</label><input id="code" name="code" required maxlength="20" placeholder="ex. 1101">
              <label for="libelle">Libellé</label><input id="libelle" name="libelle" required maxlength="120" placeholder="ex. Médecine polyvalente">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form>
            <p class="champ-aide" style="margin-top:12px">Pour un import en masse, utilisez la ligne de commande : <code>registris ufs fichier.csv</code>.</p></section>
        </div>`),
    );
  });
  app.post('/admin/ufs', exigerAuth, admin, (req, res) => {
    try {
      creerUf(acteur(req), { code: req.body.code, libelle: req.body.libelle });
    } catch (e) {
      return erreur400(req, res, 'UF non créée', e, '/admin/ufs');
    }
    res.redirect('/admin/ufs');
  });
  app.post('/admin/ufs/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerUf(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/ufs');
    }
    res.redirect('/admin/ufs');
  });

  app.get('/admin/sites', exigerAuth, admin, (req, res) => {
    const lignes = listerSites({ tous: true }).map((s) => `<tr><td>${echap(s.nom)}</td>
        <td><form method="post" action="/admin/sites/${s.id}/supprimer" data-confirmer="Supprimer ce site ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Sites',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Sites de l'établissement</h2>
            <table><thead><tr><th>Site</th><th></th></tr></thead><tbody>${lignes || '<tr><td colspan="2" style="color:var(--ink-3)">Aucun site.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Ajouter un site</h2>
            <form method="post" action="/admin/sites" class="carte">
              <label for="nom">Nom</label><input id="nom" name="nom" required maxlength="120" placeholder="ex. Hôpital Nord">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form></section>
        </div>`),
    );
  });
  app.post('/admin/sites', exigerAuth, admin, (req, res) => {
    try {
      creerSite(acteur(req), req.body.nom);
    } catch (e) {
      return erreur400(req, res, 'Site non créé', e, '/admin/sites');
    }
    res.redirect('/admin/sites');
  });
  app.post('/admin/sites/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerSite(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/sites');
    }
    res.redirect('/admin/sites');
  });

  // Comptes locaux et périmètre des référents.
  app.get('/admin/utilisateurs', exigerAuth, admin, (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    const roleF = ROLES.includes(req.query.role) ? req.query.role : '';
    const comptes = listerUtilisateurs({ q, role: roleF });
    const apps = listerApplications();
    const optionsApp = (sel = []) => apps.map((a) => `<option value="${a.id}" ${sel.includes(a.id) ? 'selected' : ''}>${echap(a.libelle)}</option>`).join('');
    const optionsRole = ROLES.map((r) => `<option value="${r}">${LIBELLES_ROLE[r]}</option>`).join('');
    const lignes = comptes.map((c) => `<tr>
        <td>${echap(c.nom)}${c.actif === 0 ? ' <span class="micro">(inactif)</span>' : ''}<div class="mono" style="color:var(--ink-3);font-size:11.5px">${echap(c.login)}</div></td>
        <td class="mono">${echap(c.matricule ?? '-')}</td><td>${tagRole(c.role)}</td>
        <td>${c.applications.length ? echap(c.applications.map((a) => a.libelle).join(', ')) : '-'}</td>
        <td><div class="actions-ligne" style="margin:0">
          <a class="btn btn-ghost btn-petit" href="/admin/utilisateurs/${encodeURIComponent(c.login)}/modifier">Modifier</a>
          ${c.login !== req.session.utilisateur.login ? `<form method="post" action="/admin/utilisateurs/${encodeURIComponent(c.login)}/supprimer" data-confirmer="Supprimer ce compte ?"><button class="btn btn-danger btn-petit">Supprimer</button></form>` : ''}
        </div></td></tr>`).join('');
    const perims = [...perimetresReferents()].filter(([login]) => !comptes.some((c) => c.login === login));
    const modeLdap = config.authMode === 'ldap';
    res.send(
      page(req, 'Comptes et référents',
        `${modeLdap ? '<div class="bandeau b-ok"><span>Mode annuaire (LDAP) : les comptes et les rôles viennent des groupes de l\'Active Directory. Les comptes locaux ci-dessous ne servent qu\'en secours.</span></div>' : ''}
        <form method="get" class="filtres"><div><label for="q">Recherche</label><input id="q" name="q" value="${echap(q)}" placeholder="nom, identifiant, matricule"></div>
          <div><label for="role">Rôle</label><select id="role" name="role"><option value="">Tous</option>${ROLES.map((r) => `<option value="${r}" ${r === roleF ? 'selected' : ''}>${LIBELLES_ROLE[r]}</option>`).join('')}</select></div>
          <button class="btn btn-ghost" type="submit">Filtrer</button></form>
        <section style="margin-top:0"><h2>Comptes locaux (${comptes.length})</h2>
          <table><thead><tr><th>Nom / identifiant</th><th>Matricule</th><th>Rôle</th><th>Périmètre référent</th><th></th></tr></thead>
            <tbody>${lignes || '<tr><td colspan="5" style="color:var(--ink-3)">Aucun compte.</td></tr>'}</tbody></table></section>
        <div class="deux-col">
          <section><h2>Créer un compte local</h2>
            <form method="post" action="/admin/utilisateurs" class="carte">
              <div class="grille2"><div><label for="login">Identifiant</label><input id="login" name="login" required maxlength="100"></div>
                <div><label for="nom">Nom complet</label><input id="nom" name="nom" required maxlength="120"></div>
                <div><label for="matricule">Matricule</label><input id="matricule" name="matricule" maxlength="40"></div>
                <div><label for="email">Courriel</label><input id="email" name="email" type="email" maxlength="200"></div></div>
              <label for="c-role">Rôle</label><select id="c-role" name="role" required>${optionsRole}</select>
              <label for="c-apps">Applications <span class="opt">(si référent)</span></label><select id="c-apps" name="applicationIds" multiple size="4">${optionsApp()}</select>
              <label for="mdp">Mot de passe <span class="opt">(12 caractères minimum)</span></label><input id="mdp" name="motDePasse" type="password" required minlength="12" autocomplete="new-password">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Créer</button></div></form></section>
          <section><h2>Périmètre d'un référent de l'annuaire</h2>
            <p class="aide">En mode LDAP, un référent sans périmètre déclaré couvre toutes les applications. Restreignez-le ici par son identifiant Windows.</p>
            <form method="post" action="/admin/referents" class="carte">
              <label for="r-login">Identifiant annuaire</label><input id="r-login" name="login" required maxlength="100" placeholder="ex. jdupont">
              <label for="r-apps">Applications du périmètre</label><select id="r-apps" name="applicationIds" multiple size="5">${optionsApp()}</select>
              <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer le périmètre</button></div></form>
            ${perims.length ? `<table style="margin-top:14px"><thead><tr><th>Identifiant</th><th>Applications</th><th></th></tr></thead><tbody>${perims.map(([login, liste]) =>
              `<tr><td class="mono">${echap(login)}</td><td>${echap(liste.map((a) => a.libelle).join(', '))}</td>
               <td><form method="post" action="/admin/referents"><input type="hidden" name="login" value="${echap(login)}"><button class="btn btn-danger btn-petit">Retirer</button></form></td></tr>`).join('')}</tbody></table>` : ''}
          </section>
        </div>`, '', { large: true }),
    );
  });
  app.post('/admin/utilisateurs', exigerAuth, admin, (req, res) => {
    const b = req.body;
    try {
      creerUtilisateur(acteur(req), {
        login: b.login, nom: b.nom, role: b.role, motDePasse: b.motDePasse, matricule: b.matricule, email: b.email,
        applicationIds: [].concat(b.applicationIds ?? []).map(nombre).filter(Boolean),
      });
    } catch (e) {
      return erreur400(req, res, 'Compte non créé', e, '/admin/utilisateurs');
    }
    res.redirect('/admin/utilisateurs');
  });
  app.post('/admin/referents', exigerAuth, admin, (req, res) => {
    try {
      definirPerimetreReferent(acteur(req), req.body.login, [].concat(req.body.applicationIds ?? []).map(nombre).filter(Boolean));
    } catch (e) {
      return erreur400(req, res, 'Périmètre non enregistré', e, '/admin/utilisateurs');
    }
    res.redirect('/admin/utilisateurs');
  });
  app.get('/admin/utilisateurs/:login/modifier', exigerAuth, admin, (req, res) => {
    const c = utilisateurParLogin(req.params.login);
    if (!c) return res.status(404).send(pageErreur(req, 'Introuvable', 'Compte introuvable.', '/admin/utilisateurs'));
    const apps = listerApplications();
    res.send(
      page(req, `Modifier ${c.login}`,
        `<form method="post" action="/admin/utilisateurs/${encodeURIComponent(c.login)}/modifier" class="carte" style="max-width:560px">
          <label>Identifiant</label><input value="${echap(c.login)}" readonly>
          <div class="grille2"><div><label for="nom">Nom complet</label><input id="nom" name="nom" value="${echap(c.nom)}" required maxlength="120"></div>
            <div><label for="matricule">Matricule</label><input id="matricule" name="matricule" value="${echap(c.matricule ?? '')}" maxlength="40"></div></div>
          <label for="email">Courriel</label><input id="email" name="email" type="email" value="${echap(c.email ?? '')}" maxlength="200">
          <label for="role">Rôle</label><select id="role" name="role" required>${ROLES.map((r) => `<option value="${r}" ${r === c.role ? 'selected' : ''}>${LIBELLES_ROLE[r]}</option>`).join('')}</select>
          <label for="apps">Applications <span class="opt">(si référent)</span></label>
          <select id="apps" name="applicationIds" multiple size="5">${apps.map((a) => `<option value="${a.id}" ${c.applicationIds.includes(a.id) ? 'selected' : ''}>${echap(a.libelle)}</option>`).join('')}</select>
          <label class="radio" style="margin-top:14px"><input type="checkbox" name="actif" value="1" ${c.actif ? 'checked' : ''}> Compte actif</label>
          <label for="mdp">Nouveau mot de passe <span class="opt">(vide : inchangé)</span></label><input id="mdp" name="motDePasse" type="password" minlength="12" autocomplete="new-password">
          <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button><a class="btn btn-ghost" href="/admin/utilisateurs">Annuler</a></div>
        </form>`),
    );
  });
  app.post('/admin/utilisateurs/:login/modifier', exigerAuth, admin, (req, res) => {
    const b = req.body;
    try {
      modifierUtilisateur(acteur(req), req.params.login, {
        nom: b.nom, role: b.role, motDePasse: b.motDePasse, matricule: b.matricule, email: b.email, actif: b.actif === '1',
        applicationIds: [].concat(b.applicationIds ?? []).map(nombre).filter(Boolean),
      });
    } catch (e) {
      return erreur400(req, res, 'Modification refusée', e, `/admin/utilisateurs/${encodeURIComponent(req.params.login)}/modifier`);
    }
    res.redirect('/admin/utilisateurs');
  });
  app.post('/admin/utilisateurs/:login/supprimer', exigerAuth, admin, (req, res) => {
    if (req.params.login === req.session.utilisateur.login) return erreur400(req, res, 'Suppression refusée', new Error('Vous ne pouvez pas supprimer votre propre compte.'), '/admin/utilisateurs');
    try {
      supprimerUtilisateur(acteur(req), req.params.login);
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/utilisateurs');
    }
    res.redirect('/admin/utilisateurs');
  });

  // Packs : administration.
  app.get('/admin/packs', exigerAuth, admin, (req, res) => {
    const lignes = listerPacks({ tous: true }).map((p) => `<tr><td><a href="/admin/packs/${p.id}">${echap(p.nom)}</a>${p.actif ? '' : ' <span class="micro">(inactif)</span>'}</td>
        <td>${echap(p.description ?? '')}</td><td class="mono">${p.nb}</td>
        <td><form method="post" action="/admin/packs/${p.id}/supprimer" data-confirmer="Supprimer ce pack ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Packs nouvel arrivant',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Packs</h2>
            <table><thead><tr><th>Nom</th><th>Description</th><th>Accès</th><th></th></tr></thead><tbody>${lignes || '<tr><td colspan="4" style="color:var(--ink-3)">Aucun pack.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Créer un pack</h2>
            <form method="post" action="/admin/packs" class="carte">
              <label for="nom">Nom</label><input id="nom" name="nom" required maxlength="80" placeholder="ex. Secrétaire médicale">
              <label for="description">Description</label><input id="description" name="description" maxlength="200">
              <label for="destinataire">Courriel notifié à chaque application du pack <span class="opt">(facultatif)</span></label><input id="destinataire" name="destinataire" type="email" maxlength="200">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Créer</button></div></form></section>
        </div>`),
    );
  });
  app.post('/admin/packs', exigerAuth, admin, (req, res) => {
    try {
      const id = creerPack(acteur(req), req.body);
      return res.redirect(`/admin/packs/${id}`);
    } catch (e) {
      return erreur400(req, res, 'Pack non créé', e, '/admin/packs');
    }
  });
  app.get('/admin/packs/:id', exigerAuth, admin, (req, res) => {
    const p = packParId(nombre(req.params.id));
    if (!p) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pack introuvable.', '/admin/packs'));
    const optionsApp = listerApplications({ actives: true }).map((a) => `<option value="${a.id}">${echap(a.libelle)}</option>`).join('');
    res.send(
      page(req, `Pack : ${p.nom}`,
        `<section style="margin-top:0"><h2>Paramètres</h2>
          <form method="post" action="/admin/packs/${p.id}/modifier" class="carte" style="max-width:600px">
            <div class="grille2"><div><label for="nom">Nom</label><input id="nom" name="nom" value="${echap(p.nom)}" required maxlength="80"></div>
              <div><label for="destinataire">Courriel notifié</label><input id="destinataire" name="destinataire" type="email" value="${echap(p.destinataire ?? '')}" maxlength="200"></div></div>
            <label for="description">Description</label><input id="description" name="description" value="${echap(p.description ?? '')}" maxlength="200">
            <label class="radio" style="margin-top:14px"><input type="checkbox" name="actif" value="1" ${p.actif ? 'checked' : ''}> Pack actif</label>
            <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form></section>
        <div class="deux-col">
          <section><h2>Accès du pack</h2>
            <table><thead><tr><th>Application</th><th>Profil par défaut</th><th></th></tr></thead><tbody>${p.elements.map((e) =>
              `<tr><td>${echap(e.app_libelle)} <span class="mono" style="color:var(--ink-3)">${echap(e.app_code)}</span></td><td>${echap(e.role || '-')}</td>
               <td><form method="post" action="/admin/packs/${p.id}/elements/${e.application_id}/retirer"><button class="btn btn-danger btn-petit">Retirer</button></form></td></tr>`).join('')
              || '<tr><td colspan="3" style="color:var(--ink-3)">Aucun accès. Ajoutez-en à droite.</td></tr>'}</tbody></table></section>
          <section><h2>Ajouter un accès</h2>
            <form method="post" action="/admin/packs/${p.id}/elements" class="carte">
              <label for="applicationId">Application</label><select id="applicationId" name="applicationId" required>${optionsApp}</select>
              <label for="role">Profil par défaut</label><input id="role" name="role" maxlength="200" placeholder="ex. Gestionnaire">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form></section>
        </div>`,
        `<a class="btn btn-ghost" href="/admin/packs">Retour</a>`),
    );
  });
  app.post('/admin/packs/:id/modifier', exigerAuth, admin, (req, res) => {
    try {
      modifierPack(acteur(req), nombre(req.params.id), { ...req.body, actif: req.body.actif === '1' });
    } catch (e) {
      return erreur400(req, res, 'Modification refusée', e, `/admin/packs/${nombre(req.params.id)}`);
    }
    res.redirect(`/admin/packs/${nombre(req.params.id)}`);
  });
  app.post('/admin/packs/:id/supprimer', exigerAuth, admin, (req, res) => {
    supprimerPack(acteur(req), nombre(req.params.id));
    res.redirect('/admin/packs');
  });
  app.post('/admin/packs/:id/elements', exigerAuth, admin, (req, res) => {
    try {
      ajouterElementPack(acteur(req), nombre(req.params.id), nombre(req.body.applicationId), req.body.role);
    } catch (e) {
      return erreur400(req, res, 'Ajout refusé', e, `/admin/packs/${nombre(req.params.id)}`);
    }
    res.redirect(`/admin/packs/${nombre(req.params.id)}`);
  });
  app.post('/admin/packs/:id/elements/:appId/retirer', exigerAuth, admin, (req, res) => {
    retirerElementPack(acteur(req), nombre(req.params.id), nombre(req.params.appId));
    res.redirect(`/admin/packs/${nombre(req.params.id)}`);
  });

  // Notifications : adresse destinataire des nouvelles demandes, par catégorie.
  app.get('/admin/routage', exigerAuth, admin, (req, res) => {
    const cats = listerCategories({ tous: true });
    res.send(
      page(req, 'Notifications',
        `<div class="carte" style="max-width:640px">
          <p class="aide">À chaque nouvelle demande, un courriel part à l'adresse de la catégorie concernée (équipe qui ouvre les droits).
            ${config.smtp.actif ? '' : '<b>Envoi désactivé</b> : renseignez SMTP_HOST dans la configuration pour l\'activer.'}</p>
          <form method="post" action="/admin/routage">
            ${cats.map((c) => `<label for="cat-${c.id}">${echap(c.libelle)}</label><input id="cat-${c.id}" name="cat__${c.id}" type="email" value="${echap(getRoutage(c.id))}" maxlength="200" placeholder="equipe@etablissement.fr">`).join('')
              || '<p style="color:var(--ink-3)">Aucune catégorie déclarée.</p>'}
            <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
          </form></div>`),
    );
  });
  app.post('/admin/routage', exigerAuth, admin, (req, res) => {
    for (const c of listerCategories({ tous: true })) setRoutage(acteur(req), c.id, req.body[`cat__${c.id}`] ?? '');
    res.redirect('/admin/routage');
  });

  // --- 404 et erreurs -----------------------------------------------------------------------------------
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
