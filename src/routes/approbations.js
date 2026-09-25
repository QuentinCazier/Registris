// Accords à donner : le cadre de l'UF approuve ou refuse, avant que le référent n'agisse.

import { exigerAuth, referentGereApplication } from '../roles.js';
import { demandesAApprouver, statuerAccord } from '../accords.js';
import { libelleUfs, habilitationParId } from '../habilitations.js';
import { emailUtilisateur } from '../administration.js';
import { getRoutage } from '../parametres.js';
import { notifier } from '../mailer.js';
import { echap, page, pageErreur, bandeauOk, dateFr } from '../ui.js';
import { nombre, cheminSur } from './outils.js';

export function monter(app) {
  app.get('/approbations', exigerAuth, (req, res) => {
    const u = req.session.utilisateur;
    const liste = demandesAApprouver(u.login);
    const message = String(req.query.ok ?? '').slice(0, 200);
    const carte = (h) => {
      const complet = habilitationParId(h.id);
      return `<div class="carte">
        <h2 style="margin:0 0 4px;font-size:15px">${echap(`${h.prenom} ${h.nom}`.trim())} <span class="mat">${echap(h.matricule)}</span></h2>
        <p class="aide" style="margin-bottom:8px">demande <b>${echap(h.role)}</b> sur <b>${echap(h.app_libelle)}</b>,
          service ${echap(libelleUfs(complet) || '-')}${h.date_fin ? `, jusqu'au ${echap(dateFr(h.date_fin))}` : ''}.
          Déposée le ${echap(dateFr(h.date_demande))} par ${echap(h.demandeur ?? '-')}.</p>
        ${h.commentaire ? `<p class="aide" style="white-space:pre-wrap">« ${echap(h.commentaire)} »</p>` : ''}
        <div class="actions-ligne" style="margin:0">
          <form method="post" action="/approbations/${h.id}"><input type="hidden" name="decision" value="accorder">
            <button class="btn btn-primary">Donner mon accord<span class="sr"> pour ${echap(h.nom)}</span></button></form>
          <form method="post" action="/approbations/${h.id}" class="ligne-motif"><input type="hidden" name="decision" value="refuser">
            <input name="motif" required maxlength="300" placeholder="Motif du refus" aria-label="Refuser la demande de ${echap(h.nom)}, motif obligatoire">
            <button class="btn">Refuser</button></form>
        </div></div>`;
    };
    res.send(
      page(req, 'Accords à donner',
        `${message ? bandeauOk(message) : ''}
        <p class="aide">Vous êtes responsable d'une unité fonctionnelle : ces demandes d'accès attendent votre accord avant que le référent ne les traite.</p>
        ${liste.length ? liste.map(carte).join('') : '<div class="vide">Aucune demande n’attend votre accord.</div>'}`),
    );
  });

  app.post('/approbations/:id', exigerAuth, async (req, res) => {
    const u = req.session.utilisateur;
    const decision = req.body.decision === 'refuser' ? 'refuser' : 'accorder';
    const horsOutil = req.body.hors_outil === '1';
    const retour = cheminSur(req.body.retour, '/approbations');
    let h;
    try {
      const cible = habilitationParId(nombre(req.params.id));
      if (horsOutil && (!cible || !referentGereApplication(u, cible.application_id))) throw new Error('Réservé au référent de l’application.');
      h = statuerAccord(u.login, nombre(req.params.id), { decision, motif: req.body.motif, horsOutil });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Décision impossible', e.message, retour));
    }
    const destinataires = [...new Set([h.email, emailUtilisateur(h.cree_par)].filter(Boolean))];
    if (decision === 'refuser') {
      await notifier({ to: destinataires, sujet: `Demande refusée par le cadre : ${h.app_libelle}`, texte: `La demande n°${h.id} « ${h.role} » sur ${h.app_libelle} pour ${h.nom} ${h.prenom} a été refusée par ${u.nom}.\n\nMotif : ${String(req.body.motif ?? '').trim()}` });
    } else {
      await notifier({ to: getRoutage(h.app_cat_id), sujet: `Accord du cadre donné : ${h.app_libelle}`, texte: `${u.nom} a donné son accord à la demande n°${h.id} « ${h.role} » sur ${h.app_libelle} pour ${h.nom} ${h.prenom}. Elle peut être traitée.` });
    }
    res.redirect(retour === '/approbations' ? `/approbations?ok=${encodeURIComponent(decision === 'refuser' ? 'Demande refusée.' : 'Accord enregistré.')}` : retour);
  });
}
