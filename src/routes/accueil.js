// Tableau de bord : le travail qui attend, pas des compteurs décoratifs.

import { config } from '../config.js';
import { exigerAuth, peut, referentGereApplication } from '../roles.js';
import { listerApplications, statistiques, listerHabilitations, listerDemandesDe, compterHabilitations } from '../habilitations.js';
import { perimetresReferents, nomsActeurs, etatMiseEnRoute } from '../administration.js';
import { journal, etatChaine } from '../audit.js';
import { enCours } from '../revues.js';
import { demandesEnRetard } from '../relances.js';
import { echap, ICONES, page, tag, bandeauErreur, barres, libelleAction, pluriel, dateFr } from '../ui.js';
import { perimetreRevue } from './outils.js';
import { tableauDemandes } from './demandes.js';
import { demandesAApprouver } from '../accords.js';
import { departsAConfirmer } from '../departs.js';
import { titulairesSupplees } from '../suppleances.js';

// Liste des étapes de mise en service, tant qu'il en reste une.
export function blocMiseEnRoute() {
  const m = etatMiseEnRoute();
  if (m.faites === m.total) return '';
  return `<div class="bloc">
    <div class="bloc-tete"><h2>Mise en route</h2><span class="c">${m.faites} sur ${m.total} faites</span></div>
    <ol class="etapes">${m.etapes.map((e, i) => `<li class="${e.fait ? 'fait' : ''}">
      <span class="num" aria-hidden="true">${e.fait ? '✓' : i + 1}</span>
      <div><div class="t">${echap(e.titre)}${e.fait ? '<span class="sr"> (fait)</span>' : ''}</div><div class="d">${echap(e.detail)}</div></div>
      ${e.fait ? '' : `<a class="btn btn-petit" href="${e.lien}">Y aller<span class="sr"> : ${echap(e.titre)}</span></a>`}</li>`).join('')}</ol></div>`;
}

export function monter(app) {
  app.get('/', exigerAuth, (req, res) => {
    const u = req.session.utilisateur;
    if (!peut(u.role, 'habilitation:suivre')) {
      const rac = (href, icone, titre, desc) =>
        `<a class="rac" href="${href}"><span class="ic">${ICONES[icone]}</span>
          <span><span class="t">${titre}</span><span class="d">${desc}</span></span></a>`;
      const miennes = listerDemandesDe(u.login);
      const aApprouver = demandesAApprouver(u.login).length;
      return res.send(
        page(req, 'Accueil',
          `${aApprouver ? `<div class="bandeau b-warn">${ICONES.alerte}<div><div class="t">${pluriel(aApprouver, 'demande')} ${aApprouver >= 2 ? 'attendent' : 'attend'} votre accord</div>
             <div class="d">Vous êtes responsable d'une unité fonctionnelle concernée.</div></div><a class="r" href="/approbations">Donner mon accord</a></div>` : ''}
          <div class="raccourcis">
            ${peut(u.role, 'habilitation:creer') ? rac('/habilitations/nouvelle', 'plus', 'Demander un accès', 'Pour vous ou pour un collègue') : ''}
            ${rac('/mes-demandes', 'liste', 'Mes demandes', 'Voir où en sont vos demandes')}
            ${peut(u.role, 'habilitation:creer') ? rac('/depart', 'sortie', 'Signaler un départ', "Faire fermer les accès d'un collègue qui part") : ''}
          </div>
          <section><h2>Mes dernières demandes</h2>
            ${miennes.length
              ? `${tableauDemandes(miennes.slice(0, 5), { legende: 'Vos dernières demandes' })}
                 ${miennes.length > 5 ? `<p><a href="/mes-demandes">Voir les ${miennes.length} demandes</a></p>` : ''}`
              : "<div class=\"vide\">Aucune demande pour l'instant. Commencez par « Demander un accès ».</div>"}
          </section>`),
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
      const fermeture = Boolean(h.retrait_demande_le);
      const actions = fermeture
        ? agir('revoquer', "Fermer l'accès", 'habilitation:revoquer')
        : h.statut === 'demandee'
          ? agir('valider', 'Valider', 'habilitation:valider') + agir('executer', 'Marquer ouvert', 'habilitation:executer')
          : agir('executer', 'Marquer ouvert', 'habilitation:executer');
      return `<tr>
        <td class="num"><a href="/habilitations/${h.id}">${h.id}</a></td>
        <td><span class="nom">${echap(benef)}</span><span class="mat">${echap(h.matricule)}</span></td>
        <td>${echap(h.app_libelle)}<span class="sous">${echap(h.role)}</span></td>
        <td class="num">${echap(dateFr(fermeture ? h.retrait_demande_le : h.date_demande))}</td>
        <td>${fermeture ? '<span class="puce p-fermeture">fermeture demandée</span>' : tag(h.statut)}${h.nb_preuves === 0 && h.statut === 'validee' ? ' <span class="puce p-attente">sans pièce</span>' : ''}</td>
        <td class="acts">${actions || `<a class="btn btn-petit" href="/habilitations/${h.id}">Ouvrir</a>`}</td>
      </tr>`;
    };

    const dansUneSemaine = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const campagne = enCours();
    const avecReferent = new Set([...perimetresReferents().values()].flat().map((a) => a.id));
    const sansReferent = listerApplications().filter((a) => !avecReferent.has(a.id)).length;

    // Ce qui cloche passe devant ce qui va bien : les points réglés ferment la liste.
    const points = [
      {
        n: s.sansPreuve,
        texte: (n) => `${pluriel(n, 'accès', '')} ${n >= 2 ? 'accordés' : 'accordé'} sans pièce justificative.`,
        lien: '/suivi?sans_preuve=1',
        libelle: 'Les voir et joindre les preuves',
      },
      {
        n: compterHabilitations({ finAvant: dansUneSemaine, applicationIds: perimetreRevue(u) }),
        texte: (n) => `${pluriel(n, 'accès', '')} ${n >= 2 ? 'temporaires arrivent' : 'temporaire arrive'} à échéance dans les 7 jours.`,
        lien: '/suivi?temp=1&tri=fin&sens=asc',
        libelle: 'Les voir',
      },
      {
        n: departsAConfirmer().length,
        texte: (n) => `${pluriel(n, 'départ')} ${n >= 2 ? 'détectés' : 'détecté'} par l'annuaire ou les RH : des accès restent ouverts.`,
        lien: '/departs',
        libelle: 'Les confirmer',
      },
      {
        n: req.compteurs?.approbations ?? 0,
        texte: (n) => `${pluriel(n, 'demande')} ${n >= 2 ? 'attendent' : 'attend'} votre accord de cadre.`,
        lien: '/approbations',
        libelle: 'Donner mon accord',
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
            texte: (n) => `${pluriel(n, 'accès', '')} ${n >= 2 ? 'restent' : 'reste'} à revoir dans la campagne « ${echap(campagne.libelle)} »${campagne.echeance ? `, à finir avant le ${echap(dateFr(campagne.echeance))}` : ''}.`,
            lien: `/revues/${campagne.id}`,
            libelle: 'Traiter ma part de la revue',
          }]
        : []),
    ]
      .filter((p) => (!p.droit || peut(u.role, p.droit)) && p.n > 0)
      .map((p) => `<li><span class="ic">${p.n}</span><div><p>${p.texte(p.n)}</p><a href="${p.lien}">${p.libelle}</a></div></li>`)
      .join('') || '<li><span class="ic ok">0</span><div><p>Rien à signaler : aucune alerte en cours.</p></div></li>';

    const ouverts = s.parStatut.executee ?? 0;
    const sous = `Registre ${config.etablissement ? `du ${echap(config.etablissement)} : ` : ': '}<b>${pluriel(s.habilitations, 'demande')}</b> ${s.habilitations >= 2 ? 'enregistrées' : 'enregistrée'}, dont <b>${pluriel(ouverts, 'accès', '')} ${ouverts >= 2 ? 'ouverts' : 'ouvert'}</b>, `
      + `pour <b>${pluriel(s.agents, 'agent')}</b>, avec <b>${pluriel(s.preuves, 'pièce')}</b> ${s.preuves >= 2 ? 'justificatives' : 'justificative'}.`;
    const nomDe = nomsActeurs();
    const voitAudit = peut(u.role, 'audit:lire');

    res.send(
      page(req, 'Tableau de bord',
        `${peut(u.role, 'admin:gerer') ? blocMiseEnRoute() : ''}
        ${titulairesSupplees(u.login).map((t) => `<div class="bandeau b-ok">${ICONES.users}<span>Vous remplacez ${echap(nomDe(t.titulaire))} jusqu'au ${echap(dateFr(t.au))} : ses demandes sont dans « À traiter ».</span></div>`).join('')}
        ${!voitAudit ? '' : chaine.valide
          ? `<div class="bandeau b-ok">${ICONES.bouclier}<div><div class="t">Journal d'audit vérifié</div>
               <div class="d">Aucune modification après coup sur les ${pluriel(chaine.entrees, 'opération')} ${chaine.entrees >= 2 ? 'enregistrées' : 'enregistrée'}.</div></div>
               <a class="r" href="/coffre">Vérifier les pièces</a></div>`
          : bandeauErreur(`Le journal d'audit a été modifié après coup (entrée n° ${chaine.rupture}). Consultez le journal.`)}

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
              <div class="bloc-tete"><h2>Activité récente</h2></div>
              <ul class="ecritures">${journal({ limite: 6 }).map((j) =>
                `<li><span class="h">${echap(dateFr(j.horodatage))} ${echap(j.horodatage.slice(11, 16))}</span>
                   <span class="a"><b>${echap(nomDe(j.acteur))}</b> ${libelleAction(j.action)}</span></li>`).join('')}</ul>
              ${voitAudit ? "<div class=\"bloc-pied\"><a href=\"/audit\">Tout le journal d'audit</a></div>" : ''}
            </div>
          </div>
        </div>`,
        peut(u.role, 'export:audit') ? '<a class="btn btn-ghost" href="/export">Exporter le dossier de preuves</a>' : '',
        { sous }),
    );
  });
}
