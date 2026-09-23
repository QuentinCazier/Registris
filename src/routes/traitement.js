// Boîte de traitement : la file à gauche, le dossier à droite.

import { config } from '../config.js';
import { exigerAuth, exigerDroit, peut, referentGereApplication } from '../roles.js';
import {
  habilitationParId, habilitationsDeAgent, listerHabilitations, libelleUfs, compterHabilitations,
} from '../habilitations.js';
import { traitantsPossibles } from '../administration.js';
import { verifierIntegrite, EXTENSIONS_ACCEPTEES } from '../preuves.js';
import { historique } from '../audit.js';
import {
  echap, ICONES, page, tag, item, bandeauAlerte, libelleAction, pluriel, depuis, joursDepuis,
} from '../ui.js';
import { nombre, perimetreRevue } from './outils.js';

export function monter(app) {
  // Tout reste rendu côté serveur : chaque demande de la file a sa propre adresse.
  app.get(['/traiter', '/traiter/:id'], exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const vue = ['moi', 'libres'].includes(req.query.f) ? req.query.f : '';
    const filtreVue = vue === 'moi' ? { assigneA: u.login } : vue === 'libres' ? { nonAssignees: true } : {};
    // Un référent restreint ne voit que la file de ses applications.
    const perimetre = perimetreRevue(u);
    const file = listerHabilitations({ file: true, applicationIds: perimetre, ...filtreVue, tri: 'demande', sens: 'asc' });
    const nbMoi = compterHabilitations({ file: true, applicationIds: perimetre, assigneA: u.login });
    const demande = nombre(req.params.id);
    const courant = file.find((h) => h.id === demande) ?? file[0] ?? null;
    if (demande && !file.some((h) => h.id === demande)) {
      // Demande déjà traitée ou hors file : la fiche complète reste la bonne page.
      return habilitationParId(demande) ? res.redirect(`/habilitations/${demande}`) : res.redirect('/traiter');
    }

    const entree = (h) => {
      const benef = `${h.nom} ${h.prenom}`.trim();
      const manque = h.nb_preuves === 0 && h.statut === 'validee';
      const fermeture = Boolean(h.retrait_demande_le);
      const attente = fermeture ? h.retrait_demande_le.slice(0, 10) : h.date_demande;
      const retard = joursDepuis(attente) >= config.relanceJours;
      return `<a class="file-item${courant && h.id === courant.id ? ' sel' : ''}" href="/traiter/${h.id}">
        <div class="l1"><span class="qui">${echap(benef)}</span><span class="mat">${echap(h.matricule)}</span>
          <span class="no">n° ${h.id}</span></div>
        <div class="l2">${echap(h.app_libelle)}, ${echap(h.role)}</div>
        <div class="l3">${fermeture ? '<span class="puce p-fermeture">fermeture demandée</span>' : tag(h.statut)}
          ${manque ? '<span class="puce p-attente">sans pièce</span>' : ''}
          ${retard ? `<span class="puce p-anomalie">en retard${h.relances ? `, relancé ${pluriel(h.relances, 'fois', '')}` : ''}</span>` : ''}
          ${h.assigne_a ? `<span class="a-qui">${echap(h.assigne_a === u.login ? 'à moi' : h.assigne_a)}</span>` : ''}
          <span class="age">${echap(depuis(attente))}</span></div></a>`;
    };

    if (!courant) {
      return res.send(
        page(req, 'À traiter',
          `<div class="boite"><div class="boite-vide"><div>
             <h1 class="t">Rien à traiter</h1>
             <p>${vue === 'moi' ? "Aucune demande ne vous est assignée."
               : vue === 'libres' ? 'Toutes les demandes ont un traitant.'
               : "Aucune demande n'attend de validation, d'exécution ni de fermeture."}</p>
             <p>${vue ? '<a href="/traiter">Voir toute la file</a> · ' : ''}<a href="/suivi">Voir le registre complet</a></p>
           </div></div></div>`,
          '', { plein: true }),
      );
    }

    const h = habilitationParId(courant.id) ?? courant;
    const benef = `${h.nom} ${h.prenom}`.trim();
    const peutAgir = (droit) => peut(u.role, droit) && referentGereApplication(u, h.application_id);
    const bouton = (action, label, droit, classe = 'btn') => peutAgir(droit)
      ? `<form method="post" action="/habilitations/${h.id}/${action}"><input type="hidden" name="retour" value="/traiter">
           <button class="${classe}">${label}</button></form>` : '';
    const formMotif = (action, label, droit, placeholder, classe = 'btn') => (peutAgir(droit)
      ? `<form method="post" action="/habilitations/${h.id}/${action}" class="ligne-motif">
           <input type="hidden" name="retour" value="/traiter">
           <input type="text" name="motif" required maxlength="300" placeholder="${placeholder}"
                  aria-label="${label}, motif obligatoire">
           <button class="${classe}">${label}</button></form>` : '');

    const fermetureDemandee = Boolean(h.retrait_demande_le);
    const actions = fermetureDemandee
      ? `<a class="btn" href="/habilitations/${h.id}">Fiche complète</a>`
      : [
        h.statut === 'demandee' ? bouton('valider', 'Valider', 'habilitation:valider', 'btn btn-primary') : '',
        ['demandee', 'validee'].includes(h.statut)
          ? bouton('executer', "Marquer l'accès ouvert", 'habilitation:executer', h.statut === 'validee' ? 'btn btn-primary' : 'btn') : '',
        `<a class="btn" href="/habilitations/${h.id}">Fiche complète</a>`,
      ].join('');

    // Qui tient la demande. Le référent se l'attribue, ou la passe à un pair.
    const traitants = peut(u.role, 'habilitation:valider') && referentGereApplication(u, h.application_id)
      ? traitantsPossibles(h.application_id) : [];
    const assignation = traitants.length
      ? `<form method="post" action="/habilitations/${h.id}/assigner" class="assignation">
           <input type="hidden" name="retour" value="/traiter/${h.id}">
           <label class="sr" for="assig">Prise en charge</label>
           <select id="assig" name="login">
             <option value="">Personne</option>
             ${traitants.map((t) => `<option value="${echap(t.login)}"${h.assigne_a === t.login ? ' selected' : ''}>${echap(t.login === u.login ? `${t.nom} (moi)` : t.nom)}</option>`).join('')}
           </select>
           <button class="btn btn-petit">${h.assigne_a ? 'Changer' : 'Prendre en charge'}</button>
         </form>`
      : '';

    const autres = habilitationsDeAgent(h.agent_id)
      .filter((x) => x.id !== h.id)
      .slice(0, 8)
      .map((x) => `<div class="piece">
        <div><div class="f">${echap(x.app_libelle)}</div><div class="m">${echap(x.role)}</div></div>
        <div class="d">${tag(x.statut)}<span class="mono" style="font-size:11.5px;color:var(--encre-3)">${echap(x.date_realisation ?? x.date_demande ?? '')}</span>
          <a class="btn btn-petit" href="/habilitations/${x.id}">Ouvrir</a></div></div>`).join('');

    const pieces = h.preuves.length
      ? h.preuves.map((p) => {
          const v = verifierIntegrite(p);
          return `<div class="piece"><span class="ic">${ICONES.routage}</span>
            <div><div class="f">${echap(p.nom_origine)}</div>
              <div class="m">${echap(p.type)} · ${echap(p.cree_le.slice(0, 16).replace('T', ' '))} · ${echap(p.ajoutee_par ?? '')}</div></div>
            <div class="d">${v.intacte ? '<span class="tag t-executee">intègre</span>' : '<span class="tag t-revoquee">altérée</span>'}
              <a class="btn btn-petit" href="/preuves/${p.id}">Télécharger</a></div></div>`;
        }).join('')
      : '';

    const ecritures = historique('habilitation', h.id).map((j) =>
      `<li><span class="e"><b>${echap(j.acteur)}</b> ${libelleAction(j.action)}
        <span class="q">${echap(j.horodatage.slice(0, 16).replace('T', ' '))}</span></span></li>`).join('');

    res.send(
      page(req, 'À traiter',
        `<div class="boite">
          <section class="file" aria-label="Demandes à traiter">
            <div class="file-tete"><h2>À traiter</h2><span class="c">${file.length}</span>
              <span class="tri">les plus anciennes d'abord</span></div>
            <div class="file-filtres">
              <a href="/traiter"${vue === '' ? ' class="actif" aria-current="true"' : ''}>Toutes</a>
              <a href="/traiter?f=moi"${vue === 'moi' ? ' class="actif" aria-current="true"' : ''}>À moi${nbMoi ? ` (${nbMoi})` : ''}</a>
              <a href="/traiter?f=libres"${vue === 'libres' ? ' class="actif" aria-current="true"' : ''}>Sans traitant</a>
            </div>
            <div class="file-corps">${file.map(entree).join('')}</div>
          </section>

          <section class="dossier" aria-label="Dossier de la demande">
            <div class="page-tete">
              <div>
                <h1>${echap(benef)}, ${echap(h.app_libelle)}</h1>
                <div class="sous">Demande <b>n° ${h.id}</b> déposée ${echap(depuis(h.date_demande))} par ${echap(h.demandeur ?? '-')}
                  · profil ${echap(h.role)} · ${tag(h.statut)}</div>
              </div>
              <div class="a">${assignation}${actions}</div>
            </div>

            ${fermetureDemandee
              ? `<div class="bloc">
                  <div class="bloc-tete"><h2>Fermeture demandée</h2>
                    <span class="d">${echap(depuis(h.retrait_demande_le.slice(0, 10)))}</span></div>
                  <div class="paires">
                    ${item('Demandée par', echap(h.retrait_demande_par ?? '-'))}
                    ${item('Le', `<span class="mono">${echap(h.retrait_demande_le.slice(0, 10))}</span>`)}
                    ${item('Accès concerné', `${echap(h.role)} sur ${echap(h.app_libelle)}`)}
                    ${item('État', tag(h.statut))}
                  </div>
                  <div class="bloc-pied" style="white-space:pre-wrap">Motif : ${echap(h.retrait_motif ?? '')}</div>
                  ${peutAgir('habilitation:revoquer')
                    ? `<div class="bloc-pied" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                        ${bouton('revoquer', "Fermer l'accès", 'habilitation:revoquer', 'btn btn-primary')}
                        ${formMotif('retrait/refuser', 'Refuser la fermeture', 'habilitation:revoquer', 'Motif du refus')}
                      </div>`
                    : `<div class="bloc-pied">Seul un référent de ${echap(h.app_libelle)} peut fermer cet accès.</div>`}
                </div>`
              : ''}

            ${h.preuves.length === 0
              ? bandeauAlerte("Aucune pièce n'est jointe. Une habilitation sans preuve écrite ne sera pas opposable à un auditeur.")
              : ''}

            ${!fermetureDemandee && ['demandee', 'validee'].includes(h.statut) && peutAgir('habilitation:valider')
              ? `<div class="bloc"><div class="bloc-tete"><h2>Refuser la demande</h2></div>
                  <div class="bloc-pied" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    ${formMotif('refuser', 'Refuser', 'habilitation:valider', 'Motif communiqué au demandeur')}
                    <span class="micro">Le motif part au demandeur. La demande quitte la file sans créer d'accès.</span>
                  </div></div>`
              : ''}

            <div class="bloc">
              <div class="bloc-tete"><h2>La demande</h2></div>
              <div class="paires">
                ${item('Bénéficiaire', echap(benef))}
                ${item('Matricule', `<span class="mono">${echap(h.matricule)}</span>`)}
                ${item('Profil demandé', echap(h.role))}
                ${item('Application', `${echap(h.app_libelle)} <span class="mono" style="color:var(--encre-3)">${echap(h.app_code)}</span>`)}
                ${item('Unité fonctionnelle', `<span class="mono">${echap(libelleUfs(h) || '-')}</span>`)}
                ${item('Site', echap(h.site_nom ?? '-'))}
                ${item('Demandeur', `${echap(h.demandeur ?? '-')}${h.pour_autrui ? '' : ' (pour lui-même)'}`)}
                ${item('Date de demande', `<span class="mono">${echap(h.date_demande ?? '-')}</span>`)}
                ${item('Date de validation', `<span class="mono">${echap(h.date_validation ?? '-')}</span>`)}
              </div>
              ${h.commentaire ? `<div class="bloc-pied" style="white-space:pre-wrap">${echap(h.commentaire)}</div>` : ''}
            </div>

            ${autres ? `<div class="bloc"><div class="bloc-tete"><h2>Autres accès de l'agent</h2>
                <span class="d"><a href="/recherche?q=${encodeURIComponent(h.matricule)}">Tout voir</a></span></div>${autres}</div>` : ''}

            <div class="bloc">
              <div class="bloc-tete"><h2>Pièces au coffre</h2><span class="c">${h.preuves.length}</span></div>
              ${pieces}
              ${peut(u.role, 'preuve:ajouter')
                ? `<form method="post" action="/habilitations/${h.id}/preuves" enctype="multipart/form-data" style="padding:13px 16px;border-top:1px dashed var(--filet-fort)">
                     <input type="hidden" name="retour" value="/traiter/${h.id}">
                     <label for="piece-boite">Joindre le mail de demande, la validation du cadre ou une capture
                       <span class="opt">(${EXTENSIONS_ACCEPTEES.join(', ')} · ${Math.round(config.tailleMaxPreuve / 1048576)} Mo maximum)</span></label>
                     <input id="piece-boite" type="file" name="preuve" required accept="${EXTENSIONS_ACCEPTEES.join(',')}">
                     <div class="actions"><button class="btn" type="submit">${ICONES.televerser}Déposer au coffre</button></div>
                   </form>` : ''}
            </div>

            <div class="bloc">
              <div class="bloc-tete"><h2>Écritures scellées</h2><span class="c">${historique('habilitation', h.id).length}</span></div>
              <ul class="fil">${ecritures || '<li>Aucune écriture.</li>'}</ul>
            </div>
          </section>
        </div>`,
        '', { plein: true }),
    );
  });
}
