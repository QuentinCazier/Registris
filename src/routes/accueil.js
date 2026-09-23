// Tableau de bord : le travail qui attend, pas des compteurs décoratifs.

import { config } from '../config.js';
import { exigerAuth, peut, referentGereApplication } from '../roles.js';
import { listerApplications, statistiques, listerHabilitations } from '../habilitations.js';
import { perimetresReferents } from '../administration.js';
import { journal, etatChaine } from '../audit.js';
import { enCours } from '../revues.js';
import { demandesEnRetard } from '../relances.js';
import { echap, ICONES, page, tag, bandeauErreur, barres, libelleAction, pluriel } from '../ui.js';
import { perimetreRevue } from './outils.js';

export function monter(app) {
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
          </div>
          <p class="aide">Chaque demande est tracée et conservée avec ses pièces justificatives (mail de la
          demande, capture, PDF). C'est ce registre qui est présenté aux auditeurs.</p>`),
      );
    }
    const s = statistiques();
    const chaine = etatChaine();
    const enRetard = demandesEnRetard().length;
    const aTraiter = listerHabilitations({ file: true, applicationIds: perimetreRevue(u), tri: 'demande', sens: 'asc', limite: 8 });

    const ligne = (h) => {
      const benef = `${h.nom} ${h.prenom}`.trim();
      const agir = (action, label, droit) =>
        peut(u.role, droit) && referentGereApplication(u, h.application_id)
          ? `<form method="post" action="/habilitations/${h.id}/${action}"><input type="hidden" name="retour" value="/">
               <button class="btn btn-petit">${label}</button></form> ` : '';
      const actions = h.statut === 'demandee'
        ? agir('valider', 'Valider', 'habilitation:valider') + agir('executer', 'Exécuter', 'habilitation:executer')
        : agir('executer', 'Exécuter', 'habilitation:executer');
      return `<tr>
        <td class="num"><a href="/habilitations/${h.id}">${h.id}</a></td>
        <td><span class="nom">${echap(benef)}</span><span class="mat">${echap(h.matricule)}</span></td>
        <td>${echap(h.app_libelle)}<span class="sous">${echap(h.role)}</span></td>
        <td class="num">${echap(h.date_demande ?? '')}</td>
        <td>${tag(h.statut)}${h.nb_preuves === 0 && h.statut === 'validee' ? ' <span class="puce p-attente">sans pièce</span>' : ''}</td>
        <td class="acts">${actions || `<a class="btn btn-petit" href="/habilitations/${h.id}">Ouvrir</a>`}</td>
      </tr>`;
    };

    const campagne = enCours();
    const avecReferent = new Set([...perimetresReferents().values()].flat().map((a) => a.id));
    const sansReferent = listerApplications().filter((a) => !avecReferent.has(a.id)).length;

    // Ce qui cloche passe devant ce qui va bien : les points réglés ferment la liste.
    const points = [
      {
        n: s.sansPreuve,
        texte: (n) => `${pluriel(n, 'habilitation')} ${n >= 2 ? 'accordées' : 'accordée'} sans aucune pièce au coffre.`,
        lien: '/suivi?sans_preuve=1',
        libelle: 'Les voir et joindre les preuves',
      },
      {
        n: enRetard,
        texte: (n) => `${pluriel(n, 'demande')} en attente depuis plus de ${pluriel(config.relanceJours, 'jour')}.`,
        lien: '/traiter',
        libelle: 'Les traiter',
      },
      {
        n: sansReferent,
        texte: (n) => `${pluriel(n, 'application')} sans référent désigné : ${n >= 2 ? 'leurs demandes ne sont routées' : 'ses demandes ne sont routées'} vers personne.`,
        lien: '/admin/utilisateurs',
        libelle: 'Désigner un référent',
        droit: 'admin:gerer',
      },
      ...(campagne
        ? [{
            n: req.compteurs?.revue ?? 0,
            texte: (n) => `${pluriel(n, 'accès', '')} ${n >= 2 ? 'restent' : 'reste'} à revoir dans la campagne « ${echap(campagne.libelle)} »${campagne.echeance ? `, échéance du ${echap(campagne.echeance)}` : ''}.`,
            lien: `/revues/${campagne.id}`,
            libelle: 'Traiter ma part de la revue',
          }]
        : []),
    ]
      .filter((p) => !p.droit || peut(u.role, p.droit))
      .sort((a, b) => (b.n > 0 ? 1 : 0) - (a.n > 0 ? 1 : 0))
      .map((p) => `<li><span class="ic${p.n ? '' : ' ok'}">${p.n}</span><div><p>${p.texte(p.n)}</p>${
        p.n ? `<a href="${p.lien}">${p.libelle}</a>` : ''
      }</div></li>`)
      .join('');

    const sous = `Registre ${config.etablissement ? `du ${echap(config.etablissement)} : ` : ': '}<b>${pluriel(s.habilitations, 'habilitation')}</b> dont <b>${pluriel(s.parStatut.executee ?? 0, 'active')}</b>, ` +
      `<b>${pluriel(s.agents, 'agent')}</b>, <b>${pluriel(s.preuves, 'pièce')}</b> au coffre, <b>${pluriel(chaine.entrees, 'écriture')} ${chaine.entrees >= 2 ? 'scellées' : 'scellée'}</b>.`;

    res.send(
      page(req, 'Tableau de bord',
        `${chaine.valide
          ? `<div class="bandeau b-ok">${ICONES.bouclier}<div><div class="t">Chaîne d'audit intègre</div>
               <div class="d">${pluriel(chaine.entrees, 'écriture')} ${chaine.entrees >= 2 ? 'scellées' : 'scellée'}, aucune rupture.</div></div>
               <a class="r" href="/coffre">Vérifier le coffre</a></div>`
          : bandeauErreur(`Rupture de la chaîne d'audit détectée (entrée n° ${chaine.rupture}). Consultez le journal.`)}

        <div class="colonnes">
          <div>
            <div class="bloc">
              <div class="bloc-tete"><h2>À traiter</h2><span class="c">${aTraiter.length}</span>
                <span class="d"><a href="/suivi?vue=a-traiter">Tout voir</a></span></div>
              ${aTraiter.length
                ? `<table><caption>Demandes en attente de validation ou d'exécution</caption>
                    <thead><tr><th scope="col" class="num">N°</th><th scope="col">Bénéficiaire</th>
                      <th scope="col">Accès demandé</th><th scope="col">Demandée</th>
                      <th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
                    <tbody>${aTraiter.map(ligne).join('')}</tbody></table>`
                : '<div class="vide">Aucune demande en attente. Le registre est à jour.</div>'}
              <div class="bloc-pied"><a href="/suivi">Voir les ${pluriel(s.habilitations, 'habilitation')} du registre</a></div>
            </div>

            <div class="bloc">
              <div class="bloc-tete"><h2>Accès actifs par application</h2>
                <span class="c">${pluriel(s.parApplication.length, 'application')}</span></div>
              <div style="padding:16px">${barres(s.parApplication.slice(0, 10).map((r) => ({ label: r.libelle, n: r.n })))}</div>
            </div>
          </div>

          <div>
            <div class="bloc">
              <div class="bloc-tete"><h2>Points de vigilance</h2></div>
              <ul class="vigilance">${points}</ul>
            </div>

            <div class="bloc">
              <div class="bloc-tete"><h2>Dernières écritures</h2><span class="c">${chaine.entrees} au total</span></div>
              <ul class="ecritures">${journal({ limite: 6 }).map((j) =>
                `<li><span class="h">${echap(j.horodatage.slice(0, 16).replace('T', ' '))}</span>
                   <span class="a"><b>${echap(j.acteur)}</b> ${libelleAction(j.action)}</span></li>`).join('')}</ul>
              <div class="bloc-pied"><a href="/audit">Tout le journal d'audit</a></div>
            </div>
          </div>
        </div>`,
        peut(u.role, 'export:audit') ? '<a class="btn btn-ghost" href="/export">Exporter le dossier de preuves</a>' : '',
        { sous }),
    );
  });
}
