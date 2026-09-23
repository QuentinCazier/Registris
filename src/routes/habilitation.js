// Fiche d'une habilitation et ses actions.

import fs from 'node:fs';

import { config } from '../config.js';
import { exigerAuth, exigerDroit, peut, referentGereApplication } from '../roles.js';
import {
  habilitationParId, changerStatut, libelleUfs, assigner, demanderRetrait, refuserRetrait,
} from '../habilitations.js';
import { emailUtilisateur, traitantsPossibles } from '../administration.js';
import { getRoutage } from '../parametres.js';
import {
  ajouterPreuve, preuveParId, cheminPreuve, verifierIntegrite, EXTENSIONS_ACCEPTEES,
} from '../preuves.js';
import { historique, tracer } from '../audit.js';
import { notifier } from '../mailer.js';
import { echap, ICONES, page, pageErreur, tag, item, bandeauAlerte, libelleAction, depuis } from '../ui.js';
import { upload, cheminSur, nombre, peutConsulter } from './outils.js';

export function monter(app, { verifierCsrf }) {
  app.get('/habilitations/:id', exigerAuth, (req, res) => {
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    const u = req.session.utilisateur;
    if (!peutConsulter(u, h)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', 'Cette habilitation ne vous concerne pas.', '/mes-demandes'));
    }
    const peutAgir = (droit) => peut(u.role, droit) && referentGereApplication(u, h.application_id);
    const bouton = (action, label, droit, classe = 'btn-ghost') => peutAgir(droit)
      ? `<form method="post" action="/habilitations/${h.id}/${action}"><button class="btn ${classe}">${label}</button></form>` : '';
    const actions = [
      h.statut === 'demandee' ? bouton('valider', 'Valider', 'habilitation:valider', 'btn-primary') : '',
      ['demandee', 'validee'].includes(h.statut) ? bouton('executer', 'Marquer exécutée', 'habilitation:executer', h.statut === 'validee' ? 'btn-primary' : 'btn-ghost') : '',
    ].join('');
    const revocation = h.statut !== 'revoquee' && h.statut !== 'refusee' && peutAgir('habilitation:revoquer')
      ? `<form method="post" action="/habilitations/${h.id}/revoquer" class="carte" style="margin-top:14px;max-width:560px">
          <label for="motif">Révoquer cette habilitation <span class="opt">(motif conservé au journal)</span></label>
          <input id="motif" name="motif" maxlength="300" placeholder="ex. départ de l'agent le 31/12">
          <div class="actions"><button class="btn btn-danger" type="submit">Révoquer</button></div></form>` : '';

    // Le refus ferme une demande sans créer d'accès : il doit être motivé.
    const refus = ['demandee', 'validee'].includes(h.statut) && peutAgir('habilitation:valider')
      ? `<form method="post" action="/habilitations/${h.id}/refuser" class="carte" style="margin-top:14px;max-width:560px">
          <label for="motif-refus">Refuser la demande <span class="opt">(motif communiqué au demandeur)</span></label>
          <input id="motif-refus" name="motif" required maxlength="300" placeholder="ex. profil non justifié par la fonction">
          <div class="actions"><button class="btn" type="submit">Refuser</button></div></form>` : '';

    // Tout agent peut demander la fermeture ; seul le référent l'exécute.
    const demandeFermeture = h.statut === 'executee' && !h.retrait_demande_le && peut(u.role, 'habilitation:creer')
      ? `<form method="post" action="/habilitations/${h.id}/retrait" class="carte" style="margin-top:14px;max-width:560px">
          <label for="motif-retrait">Demander la fermeture de cet accès</label>
          <div class="aide">L'accès reste ouvert jusqu'à ce qu'un référent de ${echap(h.app_libelle)} l'ait fermé.</div>
          <input id="motif-retrait" name="motif" required maxlength="300" placeholder="ex. départ le 31/12, mutation au bloc">
          <div class="actions"><button class="btn" type="submit">Demander la fermeture</button></div></form>` : '';

    const fermetureEnCours = h.retrait_demande_le
      ? `<div class="bloc" style="margin-top:14px">
          <div class="bloc-tete"><h2>Fermeture demandée</h2>
            <span class="d">${echap(depuis(h.retrait_demande_le.slice(0, 10)))}</span></div>
          <div class="paires">
            ${item('Demandée par', echap(h.retrait_demande_par ?? '-'))}
            ${item('Le', `<span class="mono">${echap(h.retrait_demande_le.slice(0, 10))}</span>`)}
          </div>
          <div class="bloc-pied" style="white-space:pre-wrap">Motif : ${echap(h.retrait_motif ?? '')}</div>
          ${peutAgir('habilitation:revoquer')
            ? `<div class="bloc-pied" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                ${bouton('revoquer', "Fermer l'accès", 'habilitation:revoquer', 'btn-primary')}
                <form method="post" action="/habilitations/${h.id}/retrait/refuser" class="ligne-motif">
                  <input type="text" name="motif" required maxlength="300" placeholder="Motif du refus"
                         aria-label="Refuser la fermeture, motif obligatoire">
                  <button class="btn">Refuser la fermeture</button></form>
              </div>`
            : `<div class="bloc-pied">En attente d'un référent de ${echap(h.app_libelle)}.</div>`}
        </div>`
      : '';
    const preuves = h.preuves.length
      ? h.preuves.map((p) => {
          const v = verifierIntegrite(p);
          return `<div class="piece">
            <span class="ic">${ICONES.routage}</span>
            <div>
              <div class="f">${echap(p.nom_origine)}</div>
              <div class="m">${echap(p.type)} · déposée le ${echap(p.cree_le.slice(0, 16).replace('T', ' '))} par ${echap(p.ajoutee_par ?? '')} · <span class="empreinte-courte" title="${echap(p.sha256)}">${echap(p.sha256.slice(0, 20))}</span><span class="empreinte-complete">SHA-256 ${echap(p.sha256)}</span></div>
            </div>
            <div class="d">
              ${v.intacte ? '<span class="tag t-executee">intègre</span>' : '<span class="tag t-revoquee">altérée</span>'}
              <a class="btn btn-petit" href="/preuves/${p.id}">Télécharger</a>
            </div></div>`;
        }).join('')
      : '<div class="vide" style="margin:16px">Aucune preuve jointe. Joignez le mail de demande, la validation du responsable ou une capture.</div>';
    const ecritures = historique('habilitation', h.id);
    const histo = ecritures.map((j) => {
      const d = j.details ? JSON.parse(j.details) : {};
      const extra = d.motif ? ` · motif : ${echap(d.motif)}` : d.nom ? ` · ${echap(d.nom)}` : '';
      return `<li><span class="e"><b>${echap(j.acteur)}</b> ${libelleAction(j.action)}${extra}
        <span class="q">${echap(j.horodatage.slice(0, 19).replace('T', ' '))}</span></span></li>`;
    }).join('');
    const sansPiece = !h.preuves.length && ['validee', 'executee'].includes(h.statut);
    res.send(
      page(req, `Habilitation n° ${h.id}`,
        `<div class="impr"><div class="t">Registre des habilitations${config.etablissement ? ` · ${echap(config.etablissement)}` : ''}</div>
          <div class="d">Dossier de preuve imprimé le ${new Date().toISOString().slice(0, 10)} · pièces vérifiées par empreinte SHA-256</div></div>
        ${sansPiece ? bandeauAlerte("Aucune pièce justificative au coffre : cette habilitation ne serait pas opposable à un auditeur.") : ''}
        <div class="bloc">
          <div class="bloc-tete">
            <h2>${echap(h.nom)} ${echap(h.prenom)}, ${echap(h.app_libelle)}</h2>
            <span class="c">${echap(h.app_code)}</span>
            <span class="d">${tag(h.statut)}</span>
          </div>
          <div class="paires">
            ${item('Bénéficiaire', `${echap(h.nom)} ${echap(h.prenom)}`)}
            ${item('Matricule', `<span class="mono">${echap(h.matricule)}</span>`)}
            ${item('Profil accordé', echap(h.role))}
            ${item('Application', `${echap(h.app_libelle)} <span class="mono" style="color:var(--encre-3)">${echap(h.app_code)}</span>`)}
            ${item('Unité fonctionnelle', `<span class="mono">${echap(libelleUfs(h) || '-')}</span>`)}
            ${item('Site', echap(h.site_nom ?? '-'))}
            ${item('Demandeur', `${echap(h.demandeur ?? '-')}${h.pour_autrui ? '' : ' (pour lui-même)'}`)}
            ${item('Date de demande', `<span class="mono">${echap(h.date_demande ?? '-')}</span>`)}
            ${item('Date de validation', `<span class="mono">${echap(h.date_validation ?? '-')}</span>`)}
            ${item('Date de réalisation', `<span class="mono">${echap(h.date_realisation ?? '-')}</span>`)}
            ${item('Date de révocation', `<span class="mono">${echap(h.date_revocation ?? '-')}</span>`)}
            ${item('Pièces au coffre', String(h.preuves.length))}
            ${h.assigne_a ? item('Prise en charge', `<span class="assigne"><b>${echap(h.assigne_a)}</b></span>`) : ''}
          </div>
          ${h.commentaire ? `<div class="bloc-pied" style="white-space:pre-wrap">${echap(h.commentaire)}</div>` : ''}
        </div>
        ${fermetureEnCours}
        ${actions ? `<div class="actions-ligne">${actions}</div>` : ''}
        ${refus}
        ${demandeFermeture}

        <div class="bloc">
          <div class="bloc-tete"><h2>Pièces au coffre</h2><span class="c">${h.preuves.length}</span></div>
          ${preuves}
          ${peut(u.role, 'preuve:ajouter') && h.statut !== 'revoquee'
            ? `<form method="post" action="/habilitations/${h.id}/preuves" enctype="multipart/form-data" style="padding:14px 16px;border-top:1px dashed var(--filet-fort)">
                 <label for="preuve">Joindre une pièce <span class="opt">(${EXTENSIONS_ACCEPTEES.join(', ')} · ${Math.round(config.tailleMaxPreuve / 1048576)} Mo maximum)</span></label>
                 <input id="preuve" type="file" name="preuve" required accept="${EXTENSIONS_ACCEPTEES.join(',')}">
                 <div class="actions"><button class="btn" type="submit">${ICONES.televerser}Déposer au coffre</button></div></form>` : ''}
        </div>

        <div class="bloc">
          <div class="bloc-tete"><h2>Écritures scellées</h2><span class="c">${ecritures.length}</span>
            <span class="d"><a href="/coffre">Vérifier l'intégrité</a></span></div>
          <ul class="fil">${histo || '<li>Aucune écriture.</li>'}</ul>
          <div class="bloc-pied">Chaque écriture porte l'empreinte de la précédente : toute modification a posteriori rompt la chaîne et devient visible.</div>
        </div>
        ${revocation}`,
        `<a class="btn btn-ghost" href="/recherche?q=${encodeURIComponent(h.matricule)}">Tous les accès de l'agent</a>`),
    );
  });

  // Prendre en charge. Déclarée avant la route générique, qui capterait l'action.
  app.post('/habilitations/:id/assigner', exigerAuth, exigerDroit('habilitation:valider'), (req, res) => {
    const u = req.session.utilisateur;
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    if (!referentGereApplication(u, h.application_id)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', `Vous n'êtes pas référent de l'application « ${h.app_libelle} ».`, `/habilitations/${h.id}`));
    }
    const voulu = req.body.login === 'moi' ? u.login : String(req.body.login ?? '').trim();
    const permis = new Set(traitantsPossibles(h.application_id).map((t) => t.login));
    if (voulu && !permis.has(voulu) && voulu !== u.login) {
      return res.status(400).send(pageErreur(req, 'Assignation impossible', "Cette personne ne peut pas traiter cette application.", `/habilitations/${h.id}`));
    }
    try {
      assigner(u.login, h.id, voulu);
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Assignation impossible', e.message, `/habilitations/${h.id}`));
    }
    if (voulu && voulu !== u.login) {
      notifier({
        to: emailUtilisateur(voulu),
        sujet: `Demande à traiter : ${h.app_libelle}`,
        texte: `La demande n°${h.id} « ${h.role} » sur ${h.app_libelle} pour ${h.nom} ${h.prenom} vous a été assignée par ${u.nom}.`,
      });
    }
    res.redirect(cheminSur(req.body.retour, `/habilitations/${h.id}`));
  });

  // Demander la fermeture : ouverte à tout agent, exécutée par le seul référent.
  app.post('/habilitations/:id/retrait', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const u = req.session.utilisateur;
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    let maj;
    try {
      maj = demanderRetrait(u.login, h.id, {
        motif: req.body.motif,
        demandeur: `${u.matricule ? `${u.matricule} ` : ''}${u.nom}`.trim(),
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Demande impossible', e.message, `/habilitations/${h.id}`));
    }
    notifier({
      to: getRoutage(h.app_cat_id),
      sujet: `Fermeture demandée : ${h.app_libelle}`,
      texte: `${maj.retrait_demande_par} demande la fermeture de l'accès n°${h.id} « ${h.role} » sur ${h.app_libelle} `
        + `pour ${h.nom} ${h.prenom} (matricule ${h.matricule}). Motif : ${maj.retrait_motif}

`
        + `L'accès reste ouvert tant qu'un référent ne l'a pas fermé.`,
    });
    res.redirect(cheminSur(req.body.retour, `/habilitations/${h.id}`));
  });

  app.post('/habilitations/:id/retrait/refuser', exigerAuth, exigerDroit('habilitation:revoquer'), (req, res) => {
    const u = req.session.utilisateur;
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    if (!referentGereApplication(u, h.application_id)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', `Vous n'êtes pas référent de l'application « ${h.app_libelle} ».`, `/habilitations/${h.id}`));
    }
    const demandeePar = h.retrait_demande_par;
    try {
      refuserRetrait(u.login, h.id, { motif: req.body.motif });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Action impossible', e.message, `/habilitations/${h.id}`));
    }
    notifier({
      to: emailUtilisateur(h.cree_par),
      sujet: `Fermeture refusée : ${h.app_libelle}`,
      texte: `La fermeture de l'accès n°${h.id} sur ${h.app_libelle}, demandée par ${demandeePar}, a été refusée par ${u.nom}. `
        + `Motif : ${String(req.body.motif ?? '').trim()}`,
    });
    res.redirect(cheminSur(req.body.retour, `/habilitations/${h.id}`));
  });

  app.post('/habilitations/:id/:action', exigerAuth, (req, res, next) => {
    const droits = {
      valider: 'habilitation:valider', executer: 'habilitation:executer',
      revoquer: 'habilitation:revoquer', refuser: 'habilitation:valider',
    };
    const action = req.params.action;
    if (action === 'preuves') return next();
    const u = req.session.utilisateur;
    const droit = droits[action];
    if (!droit || !peut(u.role, droit)) return res.status(403).send(pageErreur(req, 'Accès refusé', 'Votre rôle ne permet pas cette action.'));
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    if (!referentGereApplication(u, h.application_id)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', `Vous n'êtes pas référent de l'application « ${h.app_libelle} ».`, `/habilitations/${h.id}`));
    }
    let maj;
    try {
      maj = changerStatut(u.login, h.id, action, { motif: req.body.motif });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Action impossible', e.message, `/habilitations/${h.id}`));
    }
    const MESSAGES = {
      valider: { sujet: 'Demande validée', texte: 'a été validée' },
      executer: { sujet: 'Accès ouvert', texte: "a été exécutée : l'accès est ouvert" },
      revoquer: { sujet: 'Habilitation révoquée', texte: 'a été révoquée' },
      refuser: { sujet: 'Demande refusée', texte: 'a été refusée' },
    };
    const m = MESSAGES[action];
    notifier({
      to: [...new Set([maj.email, emailUtilisateur(maj.cree_par)].filter(Boolean))],
      sujet: `${m.sujet} : ${maj.app_libelle}`,
      texte: `L'habilitation n°${maj.id} « ${maj.role} » sur ${maj.app_libelle} pour ${maj.nom} ${maj.prenom} ${m.texte}.`
        + `${String(req.body.motif ?? '').trim() ? `

Motif : ${String(req.body.motif).trim()}` : ''}`,
    });
    res.redirect(cheminSur(req.body.retour, `/habilitations/${h.id}`));
  });

  app.post('/habilitations/:id/preuves', exigerAuth, exigerDroit('preuve:ajouter'), (req, res, next) => {
    upload.single('preuve')(req, res, (err) => {
      if (err) return res.status(400).send(pageErreur(req, 'Pièce refusée', err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux.' : err.message, `/habilitations/${nombre(req.params.id)}`));
      next();
    });
  }, verifierCsrf, (req, res) => {
    const id = nombre(req.params.id);
    if (!req.file) return res.status(400).send(pageErreur(req, 'Pièce refusée', 'Aucun fichier reçu.', `/habilitations/${id}`));
    try {
      ajouterPreuve(req.session.utilisateur.login, id, { tampon: req.file.buffer, nom: req.file.originalname });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Pièce refusée', e.message, `/habilitations/${id}`));
    }
    res.redirect(cheminSur(req.body.retour, `/habilitations/${id}`));
  });

  app.get('/preuves/:id', exigerAuth, exigerDroit('preuve:lire'), (req, res) => {
    const p = preuveParId(nombre(req.params.id));
    if (!p || !fs.existsSync(cheminPreuve(p))) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pièce introuvable.'));
    const h = habilitationParId(p.habilitation_id);
    if (!h || !peutConsulter(req.session.utilisateur, h)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', 'Cette pièce ne vous concerne pas.', '/mes-demandes'));
    }
    tracer(req.session.utilisateur.login, 'preuve:consulter', { entite: 'habilitation', entiteId: p.habilitation_id, details: { preuve: p.id } });
    res.download(cheminPreuve(p), p.nom_origine);
  });
}
