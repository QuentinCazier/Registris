// Rapprochement : l'extraction d'une application, confrontée au registre.

import { exigerAuth, exigerDroit, peut, referentGereApplication } from '../roles.js';
import { listerApplications, applicationParId } from '../habilitations.js';
import { tracer } from '../audit.js';
import { fichierCsv } from '../csv.js';
import {
  CATEGORIES, deposer, rapprochementParId, contenu, apercu, listerRapprochements, analyser,
  bilanRapprochement, lignesRapprochement, ligneParId, donnerSuite, matriculesConnus, normaliserMatricule,
} from '../rapprochements.js';
import { echap, ICONES, page, pageErreur, bandeauOk, bandeauAlerte, item, pluriel, tag } from '../ui.js';
import { upload, nombre, perimetreRevue } from './outils.js';

// Constater relève du contrôle comme du référent ; corriger le registre, du seul référent.
const peutVoir = (u, appId) => peut(u.role, 'audit:lire') || (peut(u.role, 'habilitation:valider') && referentGereApplication(u, appId));
const peutAgir = (u, appId) => peut(u.role, 'habilitation:valider') && referentGereApplication(u, appId);

const ORDRE = ['revoque_present', 'non_declare', 'introuvable', 'en_cours_present'];
const EXPLICATION = {
  revoque_present: "Le registre dit l'accès fermé, l'application a toujours le compte. C'est l'écart le plus grave : la fermeture n'a jamais eu lieu.",
  non_declare: "Un compte existe dans l'application sans aucune habilitation au registre. Soit il est légitime et on le régularise, soit on le ferme.",
  introuvable: "Le registre tient l'accès pour ouvert, l'application ne connaît pas l'agent. Le registre doit suivre.",
  en_cours_present: "La demande est en cours au registre, mais le compte est déjà ouvert : il reste à l'enregistrer comme exécutée.",
};
const LIB_SUITE = {
  regularise: 'régularisé au registre',
  revoque: 'révoqué au registre',
  execute: 'enregistré comme exécuté',
  ferme_dans_app: "fermé dans l'application",
};

const choixColonne = (id, libelle, entete, valeur, requis = false) => `
  <div><label for="${id}">${libelle}${requis ? '' : ' <span class="opt">(facultatif)</span>'}</label>
    <select id="${id}" name="${id}"${requis ? ' required' : ''}>
      ${requis ? '' : '<option value="">Aucune</option>'}
      ${entete.map((t, i) => `<option value="${i}"${valeur === i ? ' selected' : ''}>${echap(t || `Colonne ${i + 1}`)}</option>`).join('')}
    </select></div>`;

export function monter(app, { verifierCsrf }) {
  const uploadExtraction = (req, res, next) => upload.single('extraction')(req, res, (err) => (err
    ? res.status(400).send(pageErreur(req, 'Fichier refusé', err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux.' : err.message, '/rapprochements'))
    : next()));

  const charger = (req, res) => {
    const r = rapprochementParId(nombre(req.params.id));
    if (!r) {
      res.status(404).send(pageErreur(req, 'Introuvable', 'Rapprochement introuvable.', '/rapprochements'));
      return null;
    }
    if (!peutVoir(req.session.utilisateur, r.application_id)) {
      res.status(403).send(pageErreur(req, 'Accès refusé', "Ce rapprochement porte sur une application hors de votre périmètre.", '/rapprochements'));
      return null;
    }
    return r;
  };

  app.get('/rapprochements', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const perimetre = perimetreRevue(u);
    const apps = listerApplications({ actives: true }).filter((a) => peutVoir(u, a.id));
    const liste = listerRapprochements({ applicationIds: perimetre });

    const lignes = liste.map((r) => `<tr>
        <td class="mono">${r.id}</td><td>${echap(r.app_libelle)}</td>
        <td>${echap(r.fichier)}</td>
        <td class="mono">${echap(String(r.analyse_le ?? r.cree_le).slice(0, 10))}</td>
        <td>${r.statut === 'termine'
          ? (r.ecarts ? `<span class="puce ${r.traites === r.ecarts ? 'p-fait' : 'p-anomalie'}">${r.traites}/${r.ecarts} ${r.ecarts >= 2 ? 'écarts traités' : 'écart traité'}</span>` : '<span class="puce p-fait">aucun écart</span>')
          : '<span class="puce p-attente">colonnes à indiquer</span>'}</td>
        <td class="acts"><a class="btn btn-petit" href="/rapprochements/${r.id}">Ouvrir</a></td></tr>`).join('');

    res.send(
      page(req, 'Rapprochements',
        `<div class="aide" style="max-width:760px">Déposez l'extraction des comptes d'une application : l'outil la confronte
          au registre et dit ce qui ne concorde pas. C'est la réponse à la question « et les accès que personne n'a
          déclarés ? ». La clé est le <b>matricule</b> : si le logiciel ne l'exporte pas, ajoutez-le dans le tableur
          avant le dépôt. L'extraction doit être <b>complète</b> : un compte absent du fichier est compté comme
          absent de l'application.</div>
        ${apps.length
          ? `<form method="post" action="/rapprochements" enctype="multipart/form-data" class="carte" style="max-width:760px">
              <div class="grille2">
                <div><label for="applicationId">Application</label>
                  <select id="applicationId" name="applicationId" required>
                    ${apps.map((a) => `<option value="${a.id}">${echap(a.libelle)}</option>`).join('')}</select></div>
                <div><label for="extraction">Extraction des comptes <span class="opt">(.csv ou .txt)</span></label>
                  <input id="extraction" type="file" name="extraction" required accept=".csv,.txt"></div>
              </div>
              <div class="aide">Point-virgule, virgule ou tabulation, UTF-8 ou ANSI : l'outil s'adapte. Le fichier est
                conservé avec son empreinte, comme pièce du constat.</div>
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.televerser}Déposer l'extraction</button></div>
            </form>`
          : '<div class="vide">Aucune application dans votre périmètre.</div>'}
        <div class="bloc">
          <div class="bloc-tete"><h2>Rapprochements</h2><span class="c">${liste.length}</span></div>
          ${liste.length
            ? `<table><caption>Rapprochements effectués</caption><thead><tr><th scope="col" class="num">N°</th>
                <th scope="col">Application</th><th scope="col">Fichier</th><th scope="col">Date</th>
                <th scope="col">État</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
                <tbody>${lignes}</tbody></table>`
            : '<div class="vide">Aucun rapprochement pour le moment.</div>'}
        </div>`),
    );
  });

  app.post('/rapprochements', exigerAuth, exigerDroit('habilitation:suivre'), uploadExtraction, verifierCsrf, (req, res) => {
    const u = req.session.utilisateur;
    const applicationId = nombre(req.body.applicationId);
    if (!applicationParId(applicationId)) {
      return res.status(400).send(pageErreur(req, 'Application manquante', "Choisissez l'application dont vous déposez l'extraction.", '/rapprochements'));
    }
    if (!peutVoir(u, applicationId)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', 'Application hors de votre périmètre.', '/rapprochements'));
    }
    if (!req.file) return res.status(400).send(pageErreur(req, 'Fichier manquant', "Joignez l'extraction des comptes.", '/rapprochements'));
    try {
      const id = deposer(u.login, { applicationId, tampon: req.file.buffer, nom: req.file.originalname });
      return res.redirect(`/rapprochements/${id}`);
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Extraction refusée', e.message, '/rapprochements'));
    }
  });

  app.get('/rapprochements/:id', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const r = charger(req, res);
    if (!r) return;
    const u = req.session.utilisateur;
    const bilan = bilanRapprochement(r.id);
    const configurer = r.statut === 'a_configurer' || (req.query.configurer === '1' && bilan.traites === 0);
    const entete = `${item('Application', echap(r.app_libelle))}
      ${item('Fichier', `${echap(r.fichier)} · <a href="/rapprochements/${r.id}/extraction">télécharger</a>`)}
      ${item('Déposé', `${echap(r.cree_le.slice(0, 16))} par ${echap(r.cree_par)}`)}
      ${item('Empreinte', `<span class="mono" title="${echap(r.empreinte)}">${echap(r.empreinte.slice(0, 20))}…</span>`)}`;

    if (configurer) {
      const a = apercu(r.id);
      const c = r.colonnes ?? {};
      return res.send(
        page(req, `Rapprochement n° ${r.id}`,
          `<div class="bloc"><div class="paires">${entete}${item('Lignes lues', String(a.total))}</div></div>
          <form method="post" action="/rapprochements/${r.id}/analyser" class="carte">
            <h2 style="margin:0 0 4px;font-size:15px">Quelle colonne contient quoi ?</h2>
            <div class="aide">L'outil a fait une proposition d'après les en-têtes. Vérifiez-la sur l'aperçu ci-dessous.
              Les matricules sont comparés sans tenir compte des zéros de tête. Si vous indiquez une colonne d'état,
              les comptes désactivés, bloqués ou suspendus sont comptés comme fermés.</div>
            <div class="grille2">
              ${choixColonne('matricule', 'Matricule', a.entete, c.matricule, true)}
              ${choixColonne('nom', 'Nom', a.entete, c.nom)}
              ${choixColonne('profil', 'Profil ou rôle', a.entete, c.profil)}
              ${choixColonne('statut', 'État du compte', a.entete, c.statut)}
            </div>
            <div class="actions"><button class="btn btn-primary" type="submit">Lancer le rapprochement</button></div>
          </form>
          <div class="bloc"><div class="bloc-tete"><h2>Aperçu de l'extraction</h2><span class="c">${Math.min(5, a.total)} sur ${a.total}</span></div>
            <div style="overflow-x:auto"><table><caption>Premières lignes de l'extraction</caption>
              <thead><tr>${a.entete.map((t, i) => `<th scope="col">${echap(t || `Colonne ${i + 1}`)}</th>`).join('')}</tr></thead>
              <tbody>${a.exemples.map((l) => `<tr>${a.entete.map((_, i) => `<td>${echap(l[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div></div>`,
          '', { sous: 'Étape 2 sur 2 : indiquer les colonnes' }),
      );
    }

    const agir = peutAgir(u, r.application_id);
    const connus = matriculesConnus();
    const formulaire = (l, suite, libelle, classe = 'btn btn-petit', champs = '') => `
      <form method="post" action="/rapprochements/${r.id}/lignes/${l.id}" class="ligne-motif">
        <input type="hidden" name="suite" value="${suite}">${champs}
        <button class="${classe}">${libelle}</button></form>`;
    const actions = (l) => {
      if (l.suite) return `<span class="puce p-fait">${LIB_SUITE[l.suite]}</span> <span class="micro">${echap(l.suite_par ?? '')}</span>`;
      if (!agir) return '<span class="micro">à traiter par le référent</span>';
      if (l.categorie === 'non_declare') {
        const connu = connus.has(normaliserMatricule(l.matricule));
        const [nom, ...prenom] = String(l.nom ?? '').split(/\s+/);
        return `<div class="revue-actions">
          ${formulaire(l, 'regularise', 'Régulariser', 'btn btn-petit btn-primary', `
            <input name="role" required maxlength="200" value="${echap(l.profil_application ?? '')}" placeholder="Profil ouvert" aria-label="Profil ouvert dans l'application">
            ${connu ? '' : `<input name="nom" required maxlength="100" value="${echap(nom ?? '')}" placeholder="Nom" aria-label="Nom de l'agent">
              <input name="prenom" maxlength="100" value="${echap(prenom.join(' '))}" placeholder="Prénom" aria-label="Prénom de l'agent">`}`)}
          ${formulaire(l, 'ferme_dans_app', "Fermé dans l'application")}</div>`;
      }
      if (l.categorie === 'revoque_present') return formulaire(l, 'ferme_dans_app', "Fermé dans l'application", 'btn btn-petit btn-primary');
      if (l.categorie === 'introuvable') return formulaire(l, 'revoque', 'Révoquer au registre', 'btn btn-petit btn-primary');
      if (l.categorie === 'en_cours_present') return formulaire(l, 'execute', 'Marquer exécutée', 'btn btn-petit btn-primary');
      return '';
    };
    const registre = (l) => (l.habilitation_id
      ? `<a href="/habilitations/${l.habilitation_id}">n° ${l.habilitation_id}</a> ${l.hab_statut ? tag(l.hab_statut) : ''}
         ${l.hab_role ? `<span class="sous">${echap(l.hab_role)}</span>` : ''}${l.date_revocation ? `<span class="sous">révoquée le ${echap(l.date_revocation)}</span>` : ''}`
      : '<span class="micro">aucune habilitation</span>');

    const bloc = (categorie) => {
      const ls = lignesRapprochement(r.id, { categorie });
      if (!ls.length) return '';
      const reste = ls.filter((l) => !l.suite).length;
      return `<div class="bloc" id="${categorie}">
        <div class="bloc-tete"><h2>${CATEGORIES[categorie].libelle}</h2><span class="c">${ls.length}</span>
          <span class="d">${reste ? `<span class="puce p-${CATEGORIES[categorie].gravite}">${pluriel(reste, 'à traiter', '')}</span>` : '<span class="puce p-fait">tout est traité</span>'}</span></div>
        <div class="bloc-pied" style="border-top:0;border-bottom:1px solid var(--filet);background:var(--blanc)">${EXPLICATION[categorie]}</div>
        <table><caption>${CATEGORIES[categorie].libelle}</caption>
          <thead><tr><th scope="col">Matricule</th><th scope="col">Agent</th><th scope="col">Profil dans l'application</th>
            <th scope="col">Registre</th><th scope="col"><span class="sr">Suite</span></th></tr></thead>
          <tbody>${ls.map((l) => `<tr><td class="mono">${echap(l.matricule)}</td><td>${echap(l.nom ?? '')}</td>
            <td>${echap(l.profil_application ?? '')}</td><td>${registre(l)}</td><td class="acts rapp">${actions(l)}</td></tr>`).join('')}</tbody>
        </table></div>`;
    };

    const concordants = lignesRapprochement(r.id, { categorie: 'concordant' });
    const chiffres = ORDRE.map((k) => `<a class="chiffre${bilan.parCategorie[k] && CATEGORIES[k].gravite === 'anomalie' ? ' alerte' : ''}" href="#${k}">
        <div class="t">${CATEGORIES[k].libelle}</div><div class="v">${bilan.parCategorie[k]}</div></a>`).join('')
      + `<div class="chiffre"><div class="t">Concordants</div><div class="v">${bilan.parCategorie.concordant}</div>
          <div class="d">${pluriel(r.comptes ?? 0, 'compte')} lus dans l'application</div></div>`;

    res.send(
      page(req, `Rapprochement n° ${r.id}`,
        `${bilan.ecarts
          ? (bilan.traites === bilan.ecarts ? bandeauOk(`Les ${bilan.ecarts} écarts ont été traités.`)
            : bandeauAlerte(`${pluriel(bilan.ecarts - bilan.traites, 'écart')} à traiter sur ${bilan.ecarts}.`))
          : bandeauOk("L'application et le registre concordent : aucun écart.")}
        <div class="chiffres">${chiffres}</div>
        ${ORDRE.map(bloc).join('')}
        ${concordants.length ? `<details class="bloc"><summary class="bloc-tete" style="cursor:pointer"><h2>Concordants</h2>
            <span class="c">${concordants.length}</span></summary>
          <table><caption>Comptes concordants</caption><thead><tr><th scope="col">Matricule</th><th scope="col">Agent</th>
            <th scope="col">Profil dans l'application</th><th scope="col">Registre</th></tr></thead>
            <tbody>${concordants.map((l) => `<tr><td class="mono">${echap(l.matricule)}</td><td>${echap(l.nom ?? '')}</td>
              <td>${echap(l.profil_application ?? '')}</td><td>${registre(l)}</td></tr>`).join('')}</tbody></table></details>` : ''}
        <div class="bloc"><div class="paires">${entete}${item('Analysé', echap(String(r.analyse_le ?? '').slice(0, 16)))}</div>
          ${bilan.traites === 0 ? `<div class="bloc-pied"><a href="/rapprochements/${r.id}?configurer=1">Corriger les colonnes et relancer</a>, tant qu'aucun écart n'a été traité.</div>` : ''}
        </div>`,
        `<a class="btn" href="/rapprochements/${r.id}/export.csv">Exporter en CSV</a>`,
        { sous: `${echap(r.app_libelle)}, extraction du ${echap(String(r.cree_le).slice(0, 10))}` }),
    );
  });

  app.post('/rapprochements/:id/analyser', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const r = charger(req, res);
    if (!r) return;
    try {
      analyser(req.session.utilisateur.login, r.id, {
        matricule: req.body.matricule, nom: req.body.nom, profil: req.body.profil, statut: req.body.statut,
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Rapprochement impossible', e.message, `/rapprochements/${r.id}`));
    }
    return res.redirect(`/rapprochements/${r.id}`);
  });

  app.post('/rapprochements/:id/lignes/:ligne', exigerAuth, exigerDroit('habilitation:valider'), (req, res) => {
    const r = charger(req, res);
    if (!r) return;
    const u = req.session.utilisateur;
    if (!peutAgir(u, r.application_id)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', `Seul un référent de ${r.app_libelle} corrige le registre.`, `/rapprochements/${r.id}`));
    }
    const ligne = ligneParId(nombre(req.params.ligne));
    if (!ligne || ligne.rapprochement_id !== r.id) {
      return res.status(404).send(pageErreur(req, 'Introuvable', 'Ligne introuvable.', `/rapprochements/${r.id}`));
    }
    try {
      donnerSuite(u.login, ligne.id, String(req.body.suite ?? ''), {
        nom: req.body.nom, prenom: req.body.prenom, role: req.body.role,
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Action impossible', e.message, `/rapprochements/${r.id}`));
    }
    return res.redirect(`/rapprochements/${r.id}#${ligne.categorie}`);
  });

  app.get('/rapprochements/:id/export.csv', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const r = charger(req, res);
    if (!r) return;
    const lignes = lignesRapprochement(r.id);
    const corps = fichierCsv([
      ['constat', 'matricule', 'agent', 'profil_application', 'habilitation', 'statut_registre', 'suite', 'suite_par', 'suite_le'],
      ...lignes.map((l) => [
        CATEGORIES[l.categorie].libelle, l.matricule, l.nom ?? '', l.profil_application ?? '',
        l.habilitation_id ?? '', l.hab_statut ?? '', l.suite ? LIB_SUITE[l.suite] : '', l.suite_par ?? '', l.suite_le ?? '',
      ]),
    ]);
    tracer(req.session.utilisateur.login, 'rapprochement:exporter', { entite: 'rapprochement', entiteId: r.id });
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="rapprochement-${r.id}-${r.app_code}.csv"`)
      .send(corps);
  });

  // L'extraction d'origine : la pièce qui fonde le constat, remise telle quelle.
  app.get('/rapprochements/:id/extraction', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const r = charger(req, res);
    if (!r) return;
    tracer(req.session.utilisateur.login, 'rapprochement:telecharger', { entite: 'rapprochement', entiteId: r.id });
    res.type('application/octet-stream')
      .set('Content-Disposition', `attachment; filename="${r.fichier.replace(/["\\\r\n]/g, '_')}"`)
      .send(Buffer.from(contenu(r.id)));
  });
}
