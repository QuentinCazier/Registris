// Absences des référents : un suppléant reçoit leur périmètre pendant la période.

import { exigerAuth, exigerDroit, peut } from '../roles.js';
import { suppleantsPossibles, creerSuppleance, supprimerSuppleance, listerSuppleances, titulairesSupplees } from '../suppleances.js';
import { nomsActeurs } from '../administration.js';
import { echap, page, pageErreur, bandeauOk, dateFr } from '../ui.js';
import { nombre } from './outils.js';

export function monter(app) {
  app.get('/absences', exigerAuth, exigerDroit('habilitation:valider'), (req, res) => {
    const u = req.session.utilisateur;
    const admin = peut(u.role, 'admin:gerer');
    const nomDe = nomsActeurs();
    const liste = listerSuppleances(admin ? {} : { login: u.login });
    const remplace = titulairesSupplees(u.login);
    const options = (exclure) => suppleantsPossibles(exclure).map((p) => `<option value="${echap(p.login)}">${echap(p.nom)}</option>`).join('');
    const jour = new Date().toISOString().slice(0, 10);
    const ligne = (s) => `<tr>
        <td>${echap(nomDe(s.titulaire))}</td><td>${echap(nomDe(s.suppleant))}</td>
        <td>du ${echap(dateFr(s.du))} au ${echap(dateFr(s.au))}${s.du <= jour ? ' <span class="puce p-fait">en cours</span>' : ''}</td>
        <td class="acts">${admin || s.titulaire === u.login.toLowerCase()
          ? `<form method="post" action="/absences/${s.id}/supprimer" data-confirmer="Annuler cette suppléance ?"><button class="btn btn-petit">Annuler<span class="sr"> la suppléance de ${echap(nomDe(s.titulaire))}</span></button></form>` : ''}</td></tr>`;
    res.send(
      page(req, 'Absences',
        `${req.query.ok ? bandeauOk('Suppléance enregistrée.') : ''}
        ${remplace.length ? bandeauOk(`Vous remplacez ${remplace.map((r) => `${nomDe(r.titulaire)} jusqu'au ${dateFr(r.au)}`).join(', ')} : ses demandes apparaissent dans « À traiter ».`) : ''}
        <p class="aide">Pendant votre absence, un autre référent traite les demandes de vos applications. La suppléance s'arrête d'elle-même à la date de fin.</p>
        <div class="deux-col">
          <form method="post" action="/absences" class="carte">
            <h2 style="margin:0 0 8px;font-size:15px">Déclarer une absence</h2>
            ${admin
              ? `<label for="titulaire">Référent absent</label><select id="titulaire" name="titulaire" required>
                   <option value="${echap(u.login)}">${echap(u.nom)} (moi)</option>${options(u.login)}</select>`
              : `<input type="hidden" name="titulaire" value="${echap(u.login)}">`}
            <label for="suppleant">Suppléant</label>
            <select id="suppleant" name="suppleant" required><option value="">Choisir</option>${options(admin ? '' : u.login)}</select>
            <div class="grille2">
              <div><label for="du">Du</label><input id="du" name="du" type="date" required value="${jour}" min="${jour}"></div>
              <div><label for="au">Au</label><input id="au" name="au" type="date" required min="${jour}"></div>
            </div>
            <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
          </form>
          <section style="margin-top:0"><h2>${admin ? 'Suppléances en cours et à venir' : 'Mes suppléances'}</h2>
            ${liste.length
              ? `<div class="bloc"><table><caption>Suppléances en cours et à venir</caption><thead><tr><th scope="col">Absent</th><th scope="col">Suppléant</th><th scope="col">Période</th><th scope="col"><span class="sr">Action</span></th></tr></thead>
                  <tbody>${liste.map(ligne).join('')}</tbody></table></div>`
              : '<div class="vide">Aucune suppléance prévue.</div>'}
          </section>
        </div>`),
    );
  });

  app.post('/absences', exigerAuth, exigerDroit('habilitation:valider'), (req, res) => {
    const u = req.session.utilisateur;
    const titulaire = peut(u.role, 'admin:gerer') ? String(req.body.titulaire ?? u.login) : u.login;
    try {
      creerSuppleance(u.login, { titulaire, suppleant: req.body.suppleant, du: req.body.du, au: req.body.au });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Suppléance non enregistrée', e.message, '/absences'));
    }
    res.redirect('/absences?ok=1');
  });

  app.post('/absences/:id/supprimer', exigerAuth, exigerDroit('habilitation:valider'), (req, res) => {
    const u = req.session.utilisateur;
    try {
      supprimerSuppleance(u.login, nombre(req.params.id), { parQui: peut(u.role, 'admin:gerer') ? null : u.login });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Annulation impossible', e.message, '/absences'));
    }
    res.redirect('/absences');
  });
}
