// Indicateurs de délai, pour la DSI et pour l'auditeur.

import { config } from '../config.js';
import { exigerAuth, exigerDroit } from '../roles.js';
import { tracer } from '../audit.js';
import { fichierCsv } from '../csv.js';
import {
  depuisMois, synthese, delaisOuverture, delaisFermeture, enAttente, parApplication, volumesParMois,
} from '../indicateurs.js';
import { echap, page, pluriel } from '../ui.js';

const PERIODES = { 3: '3 derniers mois', 6: '6 derniers mois', 12: '12 derniers mois' };

const lirePeriode = (req) => (Object.hasOwn(PERIODES, String(req.query.periode)) ? Number(req.query.periode) : 6);

// Un délai se lit en jours, avec une décimale tant qu'elle a un sens.
export function jours(n) {
  if (n === null || n === undefined) return '-';
  if (n < 1) return "moins d'un jour";
  if (n < 10) return `${n.toFixed(1).replace('.', ',')} j`;
  return `${Math.round(n)} j`;
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libelleMois = (cle) => `${MOIS[Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}`;

function calculer(periode) {
  const depuis = depuisMois(periode);
  const ouverture = delaisOuverture({ depuis });
  const fermeture = delaisFermeture({ depuis });
  return {
    depuis,
    ouverture: { global: synthese(ouverture.map((d) => d.jours)), parApp: parApplication(ouverture) },
    fermeture: { global: synthese(fermeture.map((d) => d.jours)), parApp: parApplication(fermeture) },
  };
}

export function monter(app) {
  app.get('/indicateurs', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const periode = lirePeriode(req);
    const r = calculer(periode);
    const attente = enAttente();
    const volumes = volumesParMois();

    const onglets = Object.entries(PERIODES)
      .map(([n, libelle]) => `<a href="/indicateurs?periode=${n}"${Number(n) === periode ? ' class="actif" aria-current="true"' : ''}>${libelle}</a>`)
      .join('');

    const chiffre = (titre, valeur, detail, alerte = false) => `
      <div class="chiffre${alerte ? ' alerte' : ''}">
        <div class="t">${titre}</div><div class="v">${valeur}</div><div class="d">${detail}</div>
      </div>`;

    const tableau = (bloc, legende, vide) => (bloc.parApp.length
      ? `<table><caption>${legende}</caption>
          <thead><tr><th scope="col">Application</th><th scope="col" class="num">Accès</th>
            <th scope="col" class="num">Médiane</th><th scope="col" class="num">9 sur 10 en moins de</th>
            <th scope="col" class="num">Le plus long</th></tr></thead>
          <tbody>${bloc.parApp.map((a) => `<tr><td>${echap(a.libelle)}</td><td class="num">${a.n}</td>
            <td class="num">${jours(a.mediane)}</td><td class="num">${jours(a.p90)}</td>
            <td class="num">${jours(a.max)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="vide">${vide}</div>`);

    const seuil = config.relanceJours;
    const fermeturesEnRetard = (attente.fermetures.plusAncienne ?? 0) >= seuil;

    res.send(
      page(req, 'Indicateurs',
        `<div class="onglets">${onglets}</div>

        <section aria-labelledby="t-maintenant">
          <h2 id="t-maintenant">En ce moment</h2>
          <div class="chiffres">
            ${chiffre('Demandes en attente', String(attente.ouvertures.n),
              attente.ouvertures.n ? `la plus ancienne depuis ${jours(attente.ouvertures.plusAncienne)}` : 'aucune')}
            ${chiffre('Accès à fermer, encore ouverts', String(attente.fermetures.n),
              attente.fermetures.n ? `signalé il y a ${jours(attente.fermetures.plusAncienne)}` : 'aucun',
              fermeturesEnRetard)}
            ${chiffre("Délai d'ouverture médian", jours(r.ouverture.global.mediane),
              `${pluriel(r.ouverture.global.n, 'accès ouvert')}, ${PERIODES[periode]}`)}
            ${chiffre('Délai de fermeture médian', jours(r.fermeture.global.mediane),
              `${pluriel(r.fermeture.global.n, 'fermeture')} après signalement`)}
          </div>
        </section>

        <div class="bloc">
          <div class="bloc-tete"><h2>Du dépôt de la demande à l'ouverture de l'accès</h2>
            <span class="c">${pluriel(r.ouverture.global.n, 'accès', '')}</span></div>
          ${tableau(r.ouverture, "Délai d'ouverture par application", 'Aucun accès ouvert sur la période.')}
        </div>

        <div class="bloc">
          <div class="bloc-tete"><h2>Du signalement d'un départ à la fermeture réelle</h2>
            <span class="c">${pluriel(r.fermeture.global.n, 'fermeture')}</span></div>
          ${tableau(r.fermeture, 'Délai de fermeture par application', 'Aucune fermeture après signalement sur la période.')}
          <div class="bloc-pied">Le délai qui intéresse un contrôle : tout ce temps, l'accès d'un agent parti
            restait ouvert. Il est lu dans le journal scellé, pas dans une colonne modifiable.</div>
        </div>

        <div class="bloc">
          <div class="bloc-tete"><h2>Volumes des douze derniers mois</h2></div>
          <table><caption>Volumes mensuels</caption>
            <thead><tr><th scope="col">Mois</th><th scope="col" class="num">Déposées</th>
              <th scope="col" class="num">Ouvertes</th><th scope="col" class="num">Refusées</th>
              <th scope="col" class="num">Fermées</th></tr></thead>
            <tbody>${volumes.map((v) => `<tr><td>${libelleMois(v.mois)}</td><td class="num">${v.deposees}</td>
              <td class="num">${v.ouvertes}</td><td class="num">${v.refusees}</td>
              <td class="num">${v.fermees}</td></tr>`).join('')}</tbody></table>
        </div>

        <p class="champ-aide">Médiane et « 9 sur 10 » plutôt que moyenne : une seule demande oubliée
          plusieurs mois suffit à fausser une moyenne, alors que ces deux chiffres disent ce qu'attend
          réellement un agent.</p>`,
        `<a class="btn" href="/indicateurs.csv?periode=${periode}">Exporter en CSV</a>`,
        { sous: `${PERIODES[periode]}, depuis le ${r.depuis}` }),
    );
  });

  app.get('/indicateurs.csv', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const periode = lirePeriode(req);
    const r = calculer(periode);
    // Virgule décimale : le fichier est au format d'un Excel français, point-virgule compris.
    const decimal = (n) => (n === null ? '' : n.toFixed(1).replace('.', ','));
    const ligne = (indicateur, a) => [indicateur, a.libelle, a.n, decimal(a.mediane), decimal(a.p90), decimal(a.max)];
    const corps = fichierCsv([
      ['indicateur', 'application', 'acces', 'mediane_jours', 'neuf_sur_dix_jours', 'max_jours'],
      ...r.ouverture.parApp.map((a) => ligne('ouverture', a)),
      ...r.fermeture.parApp.map((a) => ligne('fermeture_apres_signalement', a)),
    ]);
    tracer(req.session.utilisateur.login, 'indicateurs:exporter', { details: { periode, depuis: r.depuis } });
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="indicateurs-${periode}-mois-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(corps);
  });
}
