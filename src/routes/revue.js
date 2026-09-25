// Revue périodique des habilitations.

import { fichierCsv } from '../csv.js';
import { exigerAuth, exigerDroit, peut, referentGereApplication } from '../roles.js';
import { listerApplications, habilitationParId } from '../habilitations.js';
import { tracer } from '../audit.js';
import {
  ouvrirCampagne, listerCampagnes, campagneParId, avancementParApplication, lignesCampagne, decider,
  cloturer, synthese, resteAStatuer,
} from '../revues.js';
import { echap, ICONES, page, pageErreur, pluriel, dateFr } from '../ui.js';
import { nomsActeurs } from '../administration.js';
import { cheminSur, nombre, perimetreRevue } from './outils.js';

export function monter(app) {
  const barreAvancement = (decidees, total) => {
    const part = total ? Math.round((decidees / total) * 100) : 100;
    return `<div class="bl-t" style="max-width:160px" title="${decidees} sur ${total}">
      <div class="bl-f" style="width:${part}%"></div></div>`;
  };

  app.get('/revues', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const campagnes = listerCampagnes();
    const ouverte = campagnes.find((c) => !c.cloturee_le);
    const perimetre = perimetreRevue(u);
    const maPart = ouverte ? resteAStatuer(ouverte.id, perimetre) : 0;

    const formulaire = peut(u.role, 'admin:gerer')
      ? `<div class="bloc">
          <div class="bloc-tete"><h2>Ouvrir une campagne</h2></div>
          <form method="post" action="/revues" style="padding:16px">
            <div class="grille2">
              <div><label for="c-lib">Libellé <span class="opt">(ce qui figurera au rapport)</span></label>
                <input id="c-lib" name="libelle" maxlength="120" required placeholder="Revue annuelle des accès ${new Date().getFullYear()}"></div>
              <div><label for="c-ech">Échéance <span class="opt">(facultative)</span></label>
                <input id="c-ech" name="echeance" type="date"></div>
            </div>
            <label for="c-app">Périmètre</label>
            <select id="c-app" name="applicationId">
              <option value="">Toutes les applications</option>
              ${listerApplications().map((a) => `<option value="${a.id}">${echap(a.libelle)}</option>`).join('')}
            </select>
            <p class="champ-aide">À l'ouverture, la campagne fige la liste des accès actifs. Les accès ouverts
              après cette date ne sont pas concernés : ils relèveront de la campagne suivante.</p>
            <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.revue}Ouvrir la campagne</button></div>
          </form>
        </div>`
      : '';

    const lignes = campagnes.map((c) => `<tr>
      <td class="num">${c.id}</td>
      <td><a href="/revues/${c.id}">${echap(c.libelle)}</a>
        <span class="sous">${c.perimetre_libelle ? echap(c.perimetre_libelle) : 'toutes les applications'}</span></td>
      <td class="num">${echap(dateFr(c.ouverte_le))}</td>
      <td class="num">${echap(dateFr(c.echeance))}</td>
      <td>${c.cloturee_le
        ? `<span class="tag t-revoquee">Clôturée</span>`
        : `<span class="tag t-validee">En cours</span>`}</td>
      <td style="min-width:190px">${barreAvancement(c.decidees, c.total)}
        <span style="font-size:12px;color:var(--encre-3)">${c.decidees} sur ${c.total}</span></td>
      <td class="num">${c.retirees}</td>
      <td class="acts"><a class="btn btn-petit" href="/revues/${c.id}">Ouvrir</a></td>
    </tr>`).join('');

    res.send(
      page(req, 'Revue périodique',
        `${ouverte && maPart
          ? `<div class="bandeau b-warn">${ICONES.revue}
              <div><div class="t">${pluriel(maPart, 'accès', '')} ${maPart >= 2 ? 'restent' : 'reste'} à revoir dans votre périmètre</div>
                <div class="d">Campagne « ${echap(ouverte.libelle)} »${ouverte.echeance ? `, à finir avant le ${echap(dateFr(ouverte.echeance))}` : ''}.</div></div>
              <a class="r btn btn-primary" href="/revues/${ouverte.id}">Traiter ma part</a></div>`
          : ''}
        ${formulaire}
        <div class="bloc">
          <div class="bloc-tete"><h2>Campagnes</h2><span class="c">${campagnes.length}</span></div>
          ${campagnes.length
            ? `<table><caption>Campagnes de revue périodique</caption>
                <thead><tr><th scope="col" class="num">N°</th><th scope="col">Campagne</th>
                  <th scope="col">Ouverte le</th><th scope="col">Échéance</th><th scope="col">État</th>
                  <th scope="col">Avancement</th><th scope="col" class="num">Retirés</th>
                  <th scope="col">Actions</th></tr></thead>
                <tbody>${lignes}</tbody></table>`
            : `<div class="vide">Aucune campagne à ce jour. La revue périodique est ce qu'un auditeur
                réclame après le registre : la preuve que les accès ont été réexaminés.</div>`}
        </div>`,
        '',
        { sous: 'Réexamen des accès actifs, application par application, avec une trace de chaque décision.', large: true }),
    );
  });

  app.post('/revues', exigerAuth, exigerDroit('admin:gerer'), (req, res) => {
    try {
      const c = ouvrirCampagne(req.session.utilisateur.login, {
        libelle: req.body.libelle,
        echeance: String(req.body.echeance ?? '').trim() || null,
        applicationId: nombre(req.body.applicationId),
      });
      res.redirect(`/revues/${c.id}`);
    } catch (e) {
      res.status(400).send(pageErreur(req, 'Campagne impossible', e.message, '/revues'));
    }
  });

  app.get('/revues/:id', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const nomDe = nomsActeurs();
    const campagne = campagneParId(nombre(req.params.id));
    if (!campagne) return res.status(404).send(pageErreur(req, 'Introuvable', 'Campagne introuvable.', '/revues'));
    const perimetre = perimetreRevue(u);
    const filtreApp = nombre(req.query.app);
    const enAttente = req.query.reste === '1';
    const bilan = synthese(campagne.id);
    const parApplication = avancementParApplication(campagne.id);
    const toutes = lignesCampagne(campagne.id, { applicationIds: perimetre, applicationId: filtreApp, enAttente });
    // Une campagne d'établissement compte des milliers de lignes : on n'en rend qu'une page.
    const PLAFOND = 200;
    const lignes = toutes.slice(0, PLAFOND);
    const close = Boolean(campagne.cloturee_le);

    const ligne = (r) => {
      const benef = `${r.nom} ${r.prenom}`.trim();
      const peutStatuer = !close && peut(u.role, 'habilitation:revoquer') && referentGereApplication(u, r.application_id);
      const decision = r.decision
        ? `<span class="tag ${r.decision === 'retiree' ? 't-revoquee' : 't-executee'}">${r.decision === 'retiree' ? 'Retiré' : 'Maintenu'}</span>
           <span class="sous decision-prise">${echap(nomDe(r.decide_par))} · ${echap(dateFr(r.decide_le))}</span>${r.motif ? `<span class="sous">${echap(r.motif)}</span>` : ''}`
        : '<span class="puce p-attente">à revoir</span>';
      const actions = peutStatuer && !r.decision
        ? `<form method="post" action="/revues/${campagne.id}/decision" class="revue-actions">
             <input type="hidden" name="habilitationId" value="${r.habilitation_id}">
             <input type="text" name="motif" maxlength="300" placeholder="motif (si retrait)" aria-label="Motif du retrait">
             <button class="btn btn-petit" name="decision" value="maintenue">Maintenir</button>
             <button class="btn btn-petit btn-danger" name="decision" value="retiree"
               data-confirmer="Retirer l'accès de ${echap(benef)} à ${echap(r.app_libelle)} ?">Retirer</button>
           </form>`
        : `<a class="btn btn-petit" href="/habilitations/${r.habilitation_id}">Fiche</a>`;
      return `<tr>
        <td class="num"><a href="/habilitations/${r.habilitation_id}">${r.habilitation_id}</a></td>
        <td><span class="nom">${echap(benef)}</span><span class="mat">${echap(r.matricule)}</span></td>
        <td>${echap(r.app_libelle)}</td>
        <td>${echap(r.role)}</td>
        <td class="num">${echap(dateFr(r.date_realisation))}</td>
        <td class="num">${r.nb_preuves === 0 ? '<span class="puce p-attente">0</span>' : r.nb_preuves}</td>
        <td>${decision}</td>
        <td class="acts">${actions}</td>
      </tr>`;
    };

    const applications = parApplication.map((a) => `<tr>
      <td>${echap(a.libelle)} <span class="mono" style="color:var(--encre-3)">${echap(a.code)}</span></td>
      <td>${a.referents ? echap(String(a.referents).split(', ').map(nomDe).join(', ')) : '<span class="puce p-attente">aucun référent</span>'}</td>
      <td style="min-width:190px">${barreAvancement(a.decidees, a.total)}
        <span style="font-size:12px;color:var(--encre-3)">${a.decidees} sur ${a.total}</span></td>
      <td class="num">${a.retirees}</td>
      <td class="acts"><a class="btn btn-petit" href="/revues/${campagne.id}?app=${a.id}">Voir</a></td>
    </tr>`).join('');

    const actions = [
      peut(u.role, 'audit:lire') ? `<a class="btn" href="/revues/${campagne.id}/export.csv">${ICONES.coffre}Exporter le rapport</a>` : '',
      !close && peut(u.role, 'admin:gerer')
        ? `<form method="post" action="/revues/${campagne.id}/cloturer"
             data-confirmer="Clôturer la campagne ? Les accès non revus resteront marqués comme non revus.">
             <button class="btn btn-primary" type="submit">Clôturer la campagne</button></form>` : '',
    ].join('');

    res.send(
      page(req, campagne.libelle,
        `${close
          ? `<div class="bandeau b-ok">${ICONES.bouclier}<div>
              <div class="t">Campagne clôturée le ${echap(dateFr(campagne.cloturee_le))} par ${echap(nomDe(campagne.cloturee_par))}</div>
              <div class="d">${pluriel(bilan.maintenues, 'accès', '')} maintenu${bilan.maintenues >= 2 ? 's' : ''},
                ${pluriel(bilan.retirees, 'retiré')}, ${pluriel(bilan.sansDecision, 'jamais revu')}.</div></div></div>`
          : bilan.sansDecision
            ? `<div class="bandeau b-warn">${ICONES.alerte}<div>
                <div class="t">${pluriel(bilan.sansDecision, 'accès', '')} ${bilan.sansDecision >= 2 ? 'restent' : 'reste'} à revoir</div>
                <div class="d">Sur ${pluriel(bilan.total, 'accès', '')} figé${bilan.total >= 2 ? 's' : ''} à l'ouverture de la campagne.</div></div>
                ${campagne.echeance ? `<span class="r">à finir avant le ${echap(dateFr(campagne.echeance))}</span>` : ''}</div>`
            : `<div class="bandeau b-ok">${ICONES.bouclier}<div><div class="t">Tous les accès ont été revus</div>
                <div class="d">La campagne peut être clôturée.</div></div></div>`}

        <div class="bloc">
          <div class="bloc-tete"><h2>Avancement par application</h2>
            <span class="c">${pluriel(parApplication.length, 'application')}</span>
            <span class="d">${filtreApp ? `<a href="/revues/${campagne.id}">Retirer le filtre</a>` : ''}</span></div>
          ${applications
            ? `<table><caption>Avancement de la revue par application</caption>
                <thead><tr><th scope="col">Application</th><th scope="col">Référents</th>
                  <th scope="col">Avancement</th><th scope="col" class="num">Retirés</th>
                  <th scope="col">Actions</th></tr></thead><tbody>${applications}</tbody></table>`
            : '<div class="vide">Aucun accès actif n\'était ouvert à l\'ouverture de la campagne.</div>'}
        </div>

        <div class="bloc">
          <div class="bloc-tete"><h2>Accès à revoir</h2><span class="c">${toutes.length}</span>
            <span class="d">
              <a href="/revues/${campagne.id}${filtreApp ? `?app=${filtreApp}` : ''}">Tous</a>
              <a href="/revues/${campagne.id}?reste=1${filtreApp ? `&app=${filtreApp}` : ''}">Restant à statuer</a>
            </span></div>
          ${lignes.length
            ? `<table><caption>Accès entrés dans la campagne</caption>
                <thead><tr><th scope="col" class="num">N°</th><th scope="col">Bénéficiaire</th>
                  <th scope="col">Application</th><th scope="col">Profil</th>
                  <th scope="col">Ouvert le</th><th scope="col" class="num">Pièces</th>
                  <th scope="col">Décision</th><th scope="col">Actions</th></tr></thead>
                <tbody>${lignes.map(ligne).join('')}</tbody></table>
                ${toutes.length > PLAFOND
                  ? `<div class="bloc-pied">${toutes.length} accès dans ce périmètre, ${PLAFOND} affichés.
                      Filtrez par application, ou exportez le rapport complet.</div>` : ''}`
            : `<div class="vide">${perimetre && !perimetre.length
                ? "Aucune application ne vous est confiée : il n'y a rien à revoir de votre côté."
                : 'Aucun accès ne correspond à ce filtre.'}</div>`}
        </div>`,
        actions,
        {
          large: true,
          sous: `Ouverte le <b>${echap(dateFr(campagne.ouverte_le))}</b> par ${echap(nomDe(campagne.ouverte_par))} · `
            + `périmètre : ${campagne.perimetre_application_id ? 'une application' : 'toutes les applications'} · `
            + `<b>${bilan.total}</b> accès figés, <b>${bilan.maintenues}</b> maintenus, <b>${bilan.retirees}</b> retirés, <b>${bilan.sansDecision}</b> non revus`,
        }),
    );
  });

  app.post('/revues/:id/decision', exigerAuth, exigerDroit('habilitation:revoquer'), (req, res) => {
    const u = req.session.utilisateur;
    const campagneId = nombre(req.params.id);
    const habilitationId = nombre(req.body.habilitationId);
    const h = habilitationParId(habilitationId);
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.', `/revues/${campagneId}`));
    if (!referentGereApplication(u, h.application_id)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé',
        `Vous n'êtes pas référent de l'application « ${h.app_libelle} ».`, `/revues/${campagneId}`));
    }
    try {
      decider(u.login, campagneId, habilitationId, String(req.body.decision ?? ''), { motif: req.body.motif });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Décision impossible', e.message, `/revues/${campagneId}`));
    }
    res.redirect(cheminSur(req.body.retour, `/revues/${campagneId}`));
  });

  app.post('/revues/:id/cloturer', exigerAuth, exigerDroit('admin:gerer'), (req, res) => {
    try {
      cloturer(req.session.utilisateur.login, nombre(req.params.id));
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Clôture impossible', e.message, `/revues/${nombre(req.params.id)}`));
    }
    res.redirect(`/revues/${nombre(req.params.id)}`);
  });

  // Rapport de campagne : c'est cette pièce que l'on remet à l'auditeur.
  app.get('/revues/:id/export.csv', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const campagne = campagneParId(nombre(req.params.id));
    if (!campagne) return res.status(404).send(pageErreur(req, 'Introuvable', 'Campagne introuvable.', '/revues'));
    const lignes = lignesCampagne(campagne.id, {});
    /** @type {Array<[string, (r: any) => any]>} */
    const colonnes = [
      ['campagne', () => campagne.libelle],
      ['habilitation', (r) => r.habilitation_id],
      ['matricule', (r) => r.matricule],
      ['nom', (r) => r.nom],
      ['prenom', (r) => r.prenom],
      ['application_code', (r) => r.app_code],
      ['application', (r) => r.app_libelle],
      ['profil', (r) => r.role],
      ['ouvert_le', (r) => r.date_realisation],
      ['nb_pieces', (r) => r.nb_preuves],
      ['decision', (r) => (r.decision === 'retiree' ? 'retiré' : r.decision === 'maintenue' ? 'maintenu' : 'non revu')],
      ['decide_par', (r) => r.decide_par],
      ['decide_le', (r) => r.decide_le],
      ['motif', (r) => r.motif],
    ];
    const corps = fichierCsv([
      colonnes.map(([n]) => n),
      ...lignes.map((r) => colonnes.map(([, lire]) => lire(r))),
    ]);
    tracer(req.session.utilisateur.login, 'revue:exporter', {
      entite: 'campagne', entiteId: campagne.id, details: synthese(campagne.id),
    });
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="revue-${campagne.id}-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(corps);
  });
}
