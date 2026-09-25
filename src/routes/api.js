// API en lecture (docs/API.md) et gestion de ses jetons par l'administrateur.

import express from 'express';

import { exigerAuth, exigerDroit } from '../roles.js';
import { jetonValide, creerJeton, listerJetons, revoquerJeton, habilitationsApi, accesAgentApi, applicationsApi } from '../api.js';
import { echap, page, pageErreur, dateFr } from '../ui.js';
import { nombre } from './outils.js';

export function routeurApi() {
  const r = express.Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    const j = m ? jetonValide(m[1]) : null;
    if (!j) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ erreur: 'Jeton absent, inconnu ou révoqué.' });
    if (req.method !== 'GET') return res.status(405).set('Allow', 'GET').json({ erreur: 'API en lecture seule.' });
    req.jeton = j;
    next();
  });
  const repondre = (fn) => (req, res) => {
    try {
      const resultat = fn(req);
      if (resultat === null) return res.status(404).json({ erreur: 'Introuvable.' });
      res.json(resultat);
    } catch (e) {
      res.status(400).json({ erreur: e.message });
    }
  };
  r.get('/demandes', repondre((req) => habilitationsApi({
    enAttente: true, application: String(req.query.application ?? ''), apres: nombre(req.query.apres), limite: nombre(req.query.limite) || 100,
  })));
  r.get('/habilitations', repondre((req) => habilitationsApi({
    statut: String(req.query.etat ?? ''), application: String(req.query.application ?? ''),
    modifieDepuis: String(req.query.modifie_depuis ?? ''), apres: nombre(req.query.apres), limite: nombre(req.query.limite) || 100,
  })));
  r.get('/agents/:matricule/acces', repondre((req) => accesAgentApi(req.params.matricule, { tous: req.query.tous === '1' })));
  r.get('/applications', repondre(() => ({ applications: applicationsApi() })));
  r.use((req, res) => res.status(404).json({ erreur: 'Point d’accès inconnu. Voir docs/API.md.' }));
  return r;
}

export function monter(app) {
  const admin = exigerDroit('admin:gerer');

  // Le jeton neuf n'est affiché que dans la réponse à sa création : il ne passe ni par la session ni par la base.
  const pageJetons = (req, nouveau = null) => {
    const lignes = listerJetons().map((j) => `<tr>
        <td>${echap(j.nom)}<span class="sous">${echap(j.prefixe)}…</span></td>
        <td>${echap(dateFr(j.cree_le))}</td>
        <td>${j.dernier_usage ? `${echap(dateFr(j.dernier_usage))}<span class="sous">${j.usages} appel${j.usages >= 2 ? 's' : ''}</span>` : 'jamais'}</td>
        <td>${j.actif ? '<span class="tag t-executee">actif</span>' : '<span class="tag t-revoquee">révoqué</span>'}</td>
        <td class="acts">${j.actif ? `<form method="post" action="/admin/api/${j.id}/revoquer" data-confirmer="Révoquer ce jeton ? L'outil qui l'utilise perdra l'accès."><button class="btn btn-danger btn-petit">Révoquer<span class="sr"> ${echap(j.nom)}</span></button></form>` : ''}</td></tr>`).join('');
    return page(req, 'API en lecture',
        `${nouveau ? `<div class="bandeau b-ok"><div><div class="t">Jeton créé pour « ${echap(nouveau.nom)} »</div>
            <div class="d">Copiez-le maintenant : il ne sera plus affiché.</div>
            <code class="hash" style="display:inline-block;margin-top:6px;user-select:all">${echap(nouveau.jeton)}</code></div></div>` : ''}
        <p class="aide">GLPI, la supervision ou un script lisent les demandes en attente et les accès d'un agent, sans pouvoir rien modifier.
          Chaque outil a son jeton, révocable à tout moment. Mode d'emploi : <a href="https://github.com/QuentinCazier/Registris/blob/main/docs/API.md">docs/API.md</a>.</p>
        <div class="deux-col">
          <section style="margin-top:0"><h2>Jetons</h2>
            ${lignes ? `<div class="bloc"><table><caption>Jetons de l'API</caption><thead><tr><th scope="col">Outil</th><th scope="col">Créé le</th><th scope="col">Dernier appel</th><th scope="col">État</th><th scope="col"><span class="sr">Action</span></th></tr></thead><tbody>${lignes}</tbody></table></div>`
              : '<div class="vide">Aucun jeton.</div>'}
          </section>
          <form method="post" action="/admin/api" class="carte">
            <h2 style="margin:0 0 8px;font-size:15px">Nouveau jeton</h2>
            <label for="nom-jeton">Outil qui l'utilisera</label>
            <input id="nom-jeton" name="nom" required maxlength="80" placeholder="ex. GLPI, supervision Centreon">
            <div class="actions"><button class="btn btn-primary" type="submit">Créer le jeton</button></div>
          </form>
        </div>`);
  };

  app.get('/admin/api', exigerAuth, admin, (req, res) => res.send(pageJetons(req)));

  app.post('/admin/api', exigerAuth, admin, (req, res) => {
    let jeton;
    try {
      ({ jeton } = creerJeton(req.session.utilisateur.login, req.body.nom));
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Jeton non créé', e.message, '/admin/api'));
    }
    res.set('Cache-Control', 'no-store').send(pageJetons(req, { nom: String(req.body.nom).trim(), jeton }));
  });

  app.post('/admin/api/:id/revoquer', exigerAuth, admin, (req, res) => {
    try {
      revoquerJeton(req.session.utilisateur.login, nombre(req.params.id));
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Révocation impossible', e.message, '/admin/api'));
    }
    res.redirect('/admin/api');
  });
}
