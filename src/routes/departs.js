// Départs détectés : confirmation par un référent ou l'administrateur, sources annuaire et fichier RH.

import { config } from '../config.js';
import { exigerAuth, exigerDroit, peut } from '../roles.js';
import {
  departsAConfirmer, confirmerDepart, ecarterDepart, detecterDepuisFichierRh, detecterDepuisAnnuaire,
} from '../departs.js';
import { notifierFermetures } from '../entretien.js';
import { echap, ICONES, page, pageErreur, bandeauOk, pluriel, dateFr } from '../ui.js';
import { upload, nombre } from './outils.js';

export function monter(app, { verifierCsrf }) {
  app.get('/departs', exigerAuth, exigerDroit('habilitation:suivre'), (req, res) => {
    const u = req.session.utilisateur;
    const peutAgir = peut(u.role, 'habilitation:revoquer');
    const liste = departsAConfirmer();
    const message = String(req.query.ok ?? '').slice(0, 200);
    const ligne = (d) => `<tr>
        <td><span class="nom">${echap(`${d.nom} ${d.prenom}`.trim())}</span><span class="mat">${echap(d.matricule)}</span>
          <span class="sous"><a href="/recherche?q=${encodeURIComponent(d.matricule)}">${pluriel(d.acces_ouverts, 'accès', '')} ${d.acces_ouverts >= 2 ? 'ouverts' : 'ouvert'}</a></span></td>
        <td>${echap(d.motif)}<span class="sous">${d.source === 'annuaire' ? 'Annuaire' : 'Fichier RH'}, le ${echap(dateFr(d.detecte_le))}</span></td>
        <td class="acts">${peutAgir
          ? `<form method="post" action="/departs/${d.id}/confirmer"><button class="btn btn-primary btn-petit">Faire fermer ses accès</button></form>
             <form method="post" action="/departs/${d.id}/ecarter" class="ligne-motif" style="margin-top:6px">
               <input name="motif" required maxlength="300" placeholder="Pourquoi l'écarter ?" aria-label="Écarter la détection de ${echap(d.nom)}, motif obligatoire">
               <button class="btn btn-petit">Écarter</button></form>`
          : ''}</td></tr>`;
    res.send(
      page(req, 'Départs détectés',
        `${message ? bandeauOk(message) : ''}
        <p class="aide">Ces agents gardent des accès ouverts alors que l'annuaire ou les ressources humaines les disent partis.
          Rien ne se ferme seul : confirmez pour demander la fermeture de tous leurs accès aux référents, ou écartez la détection.</p>
        <div class="bloc">${liste.length
          ? `<table><caption>Départs détectés à confirmer</caption><thead><tr><th scope="col">Agent</th><th scope="col">Pourquoi</th><th scope="col"><span class="sr">Décision</span></th></tr></thead>
              <tbody>${liste.map(ligne).join('')}</tbody></table>`
          : '<div class="vide" style="margin:16px">Aucun départ à confirmer.</div>'}</div>
        ${peut(u.role, 'admin:gerer')
          ? `<div class="deux-col">
              <form method="post" action="/departs/fichier-rh" enctype="multipart/form-data" class="carte">
                <h2 style="margin:0 0 6px;font-size:15px">Comparer avec un fichier RH</h2>
                <p class="aide">Un export du logiciel de paie ou de gestion du personnel, enregistré en CSV, avec au moins une colonne « Matricule ».</p>
                <label>Ce fichier contient</label>
                <div class="radios">
                  <label class="radio"><input type="radio" name="mode" value="sorties" checked> les agents sortis</label>
                  <label class="radio"><input type="radio" name="mode" value="presents"> tous les agents présents</label>
                </div>
                <label for="fichier-rh">Fichier CSV</label>
                <input id="fichier-rh" type="file" name="fichier" required accept=".csv,.txt">
                <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.televerser}Comparer</button></div>
              </form>
              <div class="carte">
                <h2 style="margin:0 0 6px;font-size:15px">Interroger l'annuaire</h2>
                ${config.authMode === 'ldap' && config.ldap.bindDN
                  ? `<p class="aide">Chaque jour, le serveur signale les agents dont le compte est désactivé dans l'Active Directory.
                      Le matricule doit figurer dans l'attribut employeeNumber ou employeeID.</p>
                     <form method="post" action="/departs/annuaire"><button class="btn">Lancer maintenant</button></form>`
                  : "<p class=\"aide\">Disponible avec l'authentification par l'annuaire et un compte de service (LDAP_BIND_DN).</p>"}
              </div>
            </div>`
          : ''}`),
    );
  });

  app.post('/departs/:id/confirmer', exigerAuth, exigerDroit('habilitation:revoquer'), async (req, res) => {
    const u = req.session.utilisateur;
    let bilan;
    try {
      bilan = confirmerDepart(u.login, nombre(req.params.id), { demandeur: `${u.matricule ? `${u.matricule} ` : ''}${u.nom}`.trim() });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Confirmation impossible', e.message, '/departs'));
    }
    const nom = `${bilan.agent.nom} ${bilan.agent.prenom}`.trim();
    await notifierFermetures(bilan.habilitations, { sujet: `Départ confirmé : ${nom}`, intro: `Le départ de ${nom} a été confirmé. Ses accès sont à fermer.` });
    res.redirect(`/departs?ok=${encodeURIComponent(`${pluriel(bilan.fermeturesDemandees, 'fermeture')} ${bilan.fermeturesDemandees >= 2 ? 'demandées' : 'demandée'} pour ${nom}.`)}`);
  });

  app.post('/departs/:id/ecarter', exigerAuth, exigerDroit('habilitation:revoquer'), (req, res) => {
    try {
      ecarterDepart(req.session.utilisateur.login, nombre(req.params.id), { motif: req.body.motif });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Impossible d’écarter', e.message, '/departs'));
    }
    res.redirect('/departs?ok=D%C3%A9tection%20%C3%A9cart%C3%A9e.');
  });

  const uploadCsv = (req, res, next) => upload.single('fichier')(req, res, (err) => (err ? res.status(400).send(pageErreur(req, 'Fichier refusé', err.message, '/departs')) : next()));
  app.post('/departs/fichier-rh', exigerAuth, exigerDroit('admin:gerer'), uploadCsv, verifierCsrf, (req, res) => {
    if (!req.file) return res.status(400).send(pageErreur(req, 'Fichier manquant', 'Aucun fichier reçu.', '/departs'));
    let bilan;
    try {
      bilan = detecterDepuisFichierRh(req.session.utilisateur.login, req.file.buffer, { mode: req.body.mode === 'presents' ? 'presents' : 'sorties' });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Comparaison impossible', e.message, '/departs'));
    }
    res.redirect(`/departs?ok=${encodeURIComponent(`${pluriel(bilan.lignes, 'ligne')} ${bilan.lignes >= 2 ? 'lues' : 'lue'}, ${bilan.nouveaux} ${bilan.nouveaux >= 2 ? 'nouveaux départs détectés' : 'nouveau départ détecté'}.`)}`);
  });

  app.post('/departs/annuaire', exigerAuth, exigerDroit('admin:gerer'), async (req, res) => {
    let bilan;
    try {
      bilan = await detecterDepuisAnnuaire(req.session.utilisateur.login);
    } catch (e) {
      return res.status(502).send(pageErreur(req, 'Annuaire injoignable', e.message, '/departs'));
    }
    res.redirect(`/departs?ok=${encodeURIComponent(`${pluriel(bilan.agents, 'agent')} ${bilan.agents >= 2 ? 'vérifiés' : 'vérifié'}, ${bilan.nouveaux} ${bilan.nouveaux >= 2 ? 'nouveaux départs détectés' : 'nouveau départ détecté'}.`)}`);
  });
}
