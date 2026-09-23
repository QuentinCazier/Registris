// Registre : tableau trié, paginé, exportable.

import { fichierCsv } from '../csv.js';
import { exigerAuth, exigerDroit, peut, referentGereApplication } from '../roles.js';
import {
  listerApplications, listerHabilitations, STATUTS, LIB_STATUT, TRIS, compterHabilitations,
  exporterHabilitations,
} from '../habilitations.js';
import { tracer } from '../audit.js';
import { echap, ICONES, page, tag, pluriel } from '../ui.js';
import { nombre } from './outils.js';

export function monter(app) {
  const PAR_PAGE = 50;

  // Partagés par la page et par l'export CSV.
  const criteresRegistre = (req) => {
    const vue = req.query.vue === 'a-traiter' ? 'a-traiter' : '';
    return {
      vue,
      statut: STATUTS.includes(req.query.statut) ? req.query.statut : '',
      applicationId: nombre(req.query.app),
      q: String(req.query.q ?? '').slice(0, 100),
      sansPreuve: req.query.sans_preuve === '1',
      statuts: vue === 'a-traiter' ? ['demandee', 'validee'] : [],
      tri: Object.keys(TRIS).includes(req.query.tri) ? req.query.tri : '',
      sens: req.query.sens === 'asc' ? 'asc' : 'desc',
    };
  };

  app.get('/suivi', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const c = criteresRegistre(req);
    const total = compterHabilitations(c);
    const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
    const page_ = Math.min(Math.max(1, nombre(req.query.page) || 1), pages);
    const habs = listerHabilitations({ ...c, limite: PAR_PAGE, offset: (page_ - 1) * PAR_PAGE });

    // Les onglets comptent hors de la vue courante : on doit voir ce qu'il y a derrière.
    const base = { applicationId: c.applicationId, q: c.q };
    const lien = (params) => {
      const p = new URLSearchParams();
      if (c.q) p.set('q', c.q);
      if (c.applicationId) p.set('app', String(c.applicationId));
      if (c.tri) { p.set('tri', c.tri); p.set('sens', c.sens); }
      for (const [k, v] of Object.entries(params)) if (v) p.set(k, String(v));
      const s = p.toString();
      return `/suivi${s ? `?${s}` : ''}`;
    };
    const onglet = (libelle, n, href, actif) =>
      `<a href="${href}"${actif ? ' class="actif" aria-current="page"' : ''}>${libelle} <span class="c">${n}</span></a>`;
    const onglets = [
      onglet('Toutes', compterHabilitations(base), lien({}), !c.statut && !c.sansPreuve && !c.vue),
      onglet('À traiter', compterHabilitations({ ...base, statuts: ['demandee', 'validee'] }), lien({ vue: 'a-traiter' }), c.vue === 'a-traiter'),
      onglet('À valider', compterHabilitations({ ...base, statut: 'demandee' }), lien({ statut: 'demandee' }), c.statut === 'demandee'),
      onglet('Actives', compterHabilitations({ ...base, statut: 'executee' }), lien({ statut: 'executee' }), c.statut === 'executee'),
      onglet('Révoquées', compterHabilitations({ ...base, statut: 'revoquee' }), lien({ statut: 'revoquee' }), c.statut === 'revoquee'),
      onglet('Sans pièce', compterHabilitations({ ...base, sansPreuve: true }), lien({ sans_preuve: '1' }), c.sansPreuve),
    ].join('');

    // En-têtes cliquables : un clic trie, un second inverse le sens.
    const enTete = (cle, libelle, classe = '') => {
      const actif = c.tri === cle;
      const sens = actif && c.sens === 'asc' ? 'desc' : 'asc';
      const p = new URLSearchParams();
      if (c.q) p.set('q', c.q);
      if (c.applicationId) p.set('app', String(c.applicationId));
      if (c.statut) p.set('statut', c.statut);
      if (c.sansPreuve) p.set('sans_preuve', '1');
      if (c.vue) p.set('vue', c.vue);
      p.set('tri', cle);
      p.set('sens', sens);
      const fleche = actif ? (c.sens === 'asc' ? ' ↑' : ' ↓') : '';
      return `<th scope="col"${classe ? ` class="${classe}"` : ''}${actif ? ` aria-sort="${c.sens === 'asc' ? 'ascending' : 'descending'}"` : ''}>
        <a href="/suivi?${p.toString()}">${libelle}${fleche}</a></th>`;
    };

    const peutAgir = (h, droit) => peut(u.role, droit) && referentGereApplication(u, h.application_id);
    const ligne = (h) => {
      const benef = `${h.nom} ${h.prenom}`.trim();
      const btn = (action, label, droit) => peutAgir(h, droit)
        ? `<form method="post" action="/habilitations/${h.id}/${action}"><input type="hidden" name="retour" value="${echap(req.originalUrl)}">
             <button class="btn btn-petit">${label}</button></form> ` : '';
      const acts = h.statut === 'demandee'
        ? btn('valider', 'Valider', 'habilitation:valider') + btn('executer', 'Exécuter', 'habilitation:executer')
        : h.statut === 'validee' ? btn('executer', 'Exécuter', 'habilitation:executer') : '';
      const manquePreuve = h.nb_preuves === 0 && ['validee', 'executee'].includes(h.statut);
      return `<tr>
        <td class="num"><a href="/habilitations/${h.id}">${h.id}</a></td>
        <td><span class="nom">${echap(benef)}</span><span class="mat">${echap(h.matricule)}</span></td>
        <td>${echap(h.app_libelle)}</td>
        <td>${echap(h.role)}</td>
        <td class="num">${echap(h.date_demande ?? '')}</td>
        <td class="num">${echap(h.date_realisation ?? '')}</td>
        <td>${tag(h.statut)}</td>
        <td class="num">${manquePreuve ? '<span class="puce p-attente">0</span>' : h.nb_preuves}</td>
        <td class="acts">${acts || `<a class="btn btn-petit" href="/habilitations/${h.id}">Ouvrir</a>`}</td>
      </tr>`;
    };

    const optsApp = listerApplications().map((a) => `<option value="${a.id}" ${a.id === c.applicationId ? 'selected' : ''}>${echap(a.libelle)}</option>`).join('');
    const csv = `/suivi.csv${req.originalUrl.includes('?') ? `?${req.originalUrl.split('?')[1]}` : ''}`;
    const pageLien = (n) => {
      const p = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
      p.set('page', String(n));
      return `/suivi?${p.toString()}`;
    };
    const pagination = pages > 1
      ? `<div style="margin-left:auto;display:flex;align-items:center;gap:10px">
          ${page_ > 1 ? `<a class="btn btn-petit" href="${pageLien(page_ - 1)}">Précédentes</a>` : ''}
          <span class="mono" style="font-size:12px;color:var(--encre-3)">page ${page_} sur ${pages}</span>
          ${page_ < pages ? `<a class="btn btn-petit" href="${pageLien(page_ + 1)}">Suivantes</a>` : ''}
        </div>` : '';

    res.send(
      page(req, c.vue === 'a-traiter' ? 'À traiter' : 'Registre des habilitations',
        `<div class="onglets">${onglets}</div>
        <form method="get" class="filtres">
          ${c.vue ? `<input type="hidden" name="vue" value="${echap(c.vue)}">` : ''}
          ${c.statut ? `<input type="hidden" name="statut" value="${echap(c.statut)}">` : ''}
          ${c.sansPreuve ? '<input type="hidden" name="sans_preuve" value="1">' : ''}
          ${c.tri ? `<input type="hidden" name="tri" value="${echap(c.tri)}"><input type="hidden" name="sens" value="${echap(c.sens)}">` : ''}
          <div><label for="f-q">Agent, profil, application</label><input id="f-q" type="search" name="q" value="${echap(c.q)}" placeholder="Rechercher"></div>
          <div><label for="f-app">Application</label><select id="f-app" name="app"><option value="">Toutes</option>${optsApp}</select></div>
          <button class="btn" type="submit">Filtrer</button>
          ${c.q || c.statut || c.applicationId || c.sansPreuve || c.vue ? '<a class="btn" href="/suivi">Réinitialiser</a>' : ''}
          <a class="btn" href="${echap(csv)}" style="margin-left:auto">${ICONES.coffre}Exporter en CSV</a>
        </form>
        <div class="bloc">
          ${habs.length
            ? `<table><caption>Habilitations du registre</caption>
                <thead><tr>${enTete('id', 'N°', 'num')}${enTete('agent', 'Bénéficiaire')}
                  ${enTete('application', 'Application')}${enTete('role', 'Profil accordé')}
                  ${enTete('demande', 'Demandée')}${enTete('realisation', 'Réalisée')}
                  ${enTete('statut', 'Statut')}${enTete('preuves', 'Pièces', 'num')}
                  <th scope="col">Actions</th></tr></thead>
                <tbody>${habs.map(ligne).join('')}</tbody></table>`
            : '<div class="vide">Aucune habilitation ne correspond à ces critères.</div>'}
          <div class="bloc-pied" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span>${pluriel(total, 'habilitation')} ${total >= 2 ? 'trouvées' : 'trouvée'}${
              total > PAR_PAGE ? `, ${habs.length} affichées` : ''
            }.</span>
            ${pagination}
          </div>
        </div>`,
        '',
        { large: true }),
    );
  });

  // Export du registre tel qu'il est filtré à l'écran.
  app.get('/suivi.csv', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const c = criteresRegistre(req);
    const lignes = exporterHabilitations(c);
    const colonnes = [
      ['id', (h) => h.id],
      ['matricule', (h) => h.matricule],
      ['nom', (h) => h.nom],
      ['prenom', (h) => h.prenom],
      ['application_code', (h) => h.app_code],
      ['application', (h) => h.app_libelle],
      ['profil', (h) => h.role],
      ['ufs', (h) => h.ufs_codes],
      ['site', (h) => h.site_nom],
      ['statut', (h) => LIB_STATUT[h.statut] ?? h.statut],
      ['date_demande', (h) => h.date_demande],
      ['date_validation', (h) => h.date_validation],
      ['date_realisation', (h) => h.date_realisation],
      ['date_revocation', (h) => h.date_revocation],
      ['demandeur', (h) => h.demandeur],
      ['pour_autrui', (h) => (h.pour_autrui ? 'oui' : 'non')],
      ['nb_pieces', (h) => h.nb_preuves],
      ['commentaire', (h) => h.commentaire],
    ];
    const corps = fichierCsv([
      colonnes.map(([nom]) => nom),
      ...lignes.map((h) => colonnes.map(([, lire]) => lire(h))),
    ]);
    const jour = new Date().toISOString().slice(0, 10);
    tracer(u.login, 'registre:exporter', { details: { lignes: lignes.length, filtre: c.statut || c.vue || (c.sansPreuve ? 'sans_preuve' : 'tout') } });
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="registre-habilitations-${jour}.csv"`)
      .send(corps);
  });
}
