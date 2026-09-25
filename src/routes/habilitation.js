// Fiche d'une habilitation et ses actions.

import fs from 'node:fs';

import { config } from '../config.js';
import { exigerAuth, exigerDroit, peut, referentGereApplication } from '../roles.js';
import {
  habilitationParId, changerStatut, libelleUfs, assigner, demanderRetrait, refuserRetrait,
  modifierProfil, profilsProposes, PROFIL_A_PRECISER,
} from '../habilitations.js';
import { emailUtilisateur, traitantsPossibles, nomsActeurs } from '../administration.js';
import { getRoutage } from '../parametres.js';
import {
  ajouterPreuve, preuveParId, cheminPreuve, verifierIntegrite, EXTENSIONS_ACCEPTEES,
} from '../preuves.js';
import { historique, tracer } from '../audit.js';
import { notifier } from '../mailer.js';
import { echap, ICONES, page, pageErreur, tag, item, bandeauAlerte, libelleAction, depuis, dateFr } from '../ui.js';
import { upload, cheminSur, nombre, peutConsulter } from './outils.js';

// Le référent fixe le profil avant d'ouvrir l'accès ; ouvert d'office quand l'agent ne le connaissait pas.
export function formulaireProfil(h, retour) {
  if (!['demandee', 'validee'].includes(h.statut)) return '';
  const aPreciser = h.role === PROFIL_A_PRECISER;
  const profils = profilsProposes(h.application_id);
  const form = `<form method="post" action="/habilitations/${h.id}/profil" class="ligne-motif" style="flex-wrap:wrap">
      <input type="hidden" name="retour" value="${echap(retour)}">
      <label class="sr" for="profil-${h.id}">Profil à accorder</label>
      <input id="profil-${h.id}" name="role" required maxlength="200" list="profils-${h.id}" value="${aPreciser ? '' : echap(h.role)}" placeholder="Profil à accorder" style="width:260px">
      <datalist id="profils-${h.id}">${profils.map((p) => `<option value="${echap(p)}"></option>`).join('')}</datalist>
      <button class="btn${aPreciser ? ' btn-primary' : ''}">Enregistrer le profil</button></form>`;
  return aPreciser
    ? `<div class="bandeau b-warn">${ICONES.alerte}<div><div class="t">Profil à préciser</div>
        <div class="d">L'agent ne connaissait pas le nom du profil. Choisissez-le avant de valider.</div>${form}</div></div>`
    : `<details class="facultatif pas-impr" style="margin:0 0 18px"><summary>Modifier le profil demandé</summary><div>${form}</div></details>`;
}

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
    const revocation = h.statut === 'executee' && !h.retrait_demande_le && peutAgir('habilitation:revoquer')
      ? `<form method="post" action="/habilitations/${h.id}/revoquer" class="carte" style="margin-top:14px;max-width:560px">
          <label for="motif">Fermer cet accès <span class="opt">(motif conservé dans l'historique)</span></label>
          <input id="motif" name="motif" maxlength="300" placeholder="ex. départ de l'agent le 31/12">
          <div class="actions"><button class="btn btn-danger" type="submit">Fermer l'accès</button></div></form>` : '';

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
            ${item('Le', echap(dateFr(h.retrait_demande_le)))}
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
    const nomDe = nomsActeurs();
    const preuves = h.preuves.length
      ? h.preuves.map((p) => {
          const v = verifierIntegrite(p);
          return `<div class="piece">
            <span class="ic">${ICONES.routage}</span>
            <div>
              <div class="f">${echap(p.nom_origine)}</div>
              <div class="m">Jointe le ${echap(dateFr(p.cree_le))} par ${echap(nomDe(p.ajoutee_par))}<span class="empreinte-complete"> · SHA-256 ${echap(p.sha256)}</span></div>
            </div>
            <div class="d">
              ${v.intacte ? '<span class="tag t-executee" title="Le fichier est identique à celui qui a été joint">vérifiée</span>' : '<span class="tag t-revoquee">modifiée depuis le dépôt</span>'}
              <a class="btn btn-petit" href="/preuves/${p.id}">Télécharger<span class="sr"> ${echap(p.nom_origine)}</span></a>
            </div></div>`;
        }).join('')
      : '<div class="vide" style="margin:16px">Aucune pièce jointe. Joignez le mail de demande, la validation du responsable ou une capture.</div>';
    const ecritures = historique('habilitation', h.id);
    const histo = ecritures.map((j) => {
      const d = j.details ? JSON.parse(j.details) : {};
      const extra = d.motif ? ` · motif : ${echap(d.motif)}` : j.action === 'habilitation:profil' ? ` · ${echap(d.vers ?? '')}` : d.nom ? ` · ${echap(d.nom)}` : '';
      return `<li><span class="e"><b>${echap(nomDe(j.acteur))}</b> ${libelleAction(j.action)}${extra}
        <span class="q">${echap(dateFr(j.horodatage))} à ${echap(j.horodatage.slice(11, 16))}</span></span></li>`;
    }).join('');
    const sansPiece = !h.preuves.length && ['validee', 'executee'].includes(h.statut);
    res.send(
      page(req, `Habilitation n° ${h.id}`,
        `<div class="impr"><div class="t">Registre des habilitations${config.etablissement ? ` · ${echap(config.etablissement)}` : ''}</div>
          <div class="d">Dossier de preuve imprimé le ${new Date().toISOString().slice(0, 10)} · pièces vérifiées par empreinte SHA-256</div></div>
        ${sansPiece ? bandeauAlerte("Aucune pièce justificative : en audit, rien ne prouverait que cet accès a été demandé et validé.") : ''}
        <div class="bloc">
          <div class="bloc-tete">
            <h2>${echap(h.nom)} ${echap(h.prenom)}, ${echap(h.app_libelle)}</h2>
            <span class="c">${echap(h.app_code)}</span>
            <span class="d">${tag(h.statut)}</span>
          </div>
          <div class="paires">
            ${item('Bénéficiaire', `${echap(h.nom)} ${echap(h.prenom)}`)}
            ${item('Matricule', `<span class="mono">${echap(h.matricule)}</span>`)}
            ${item(h.statut === 'executee' || h.statut === 'revoquee' ? 'Profil accordé' : 'Profil demandé', echap(h.role))}
            ${item('Application', `${echap(h.app_libelle)} <span class="mono" style="color:var(--encre-3)">${echap(h.app_code)}</span>`)}
            ${item('Unité fonctionnelle', echap(libelleUfs(h) || '-'))}
            ${item('Site', echap(h.site_nom ?? '-'))}
            ${item('Demandeur', `${echap(h.demandeur ?? '-')}${h.pour_autrui ? '' : ' (pour lui-même)'}`)}
            ${item('Demandée le', echap(dateFr(h.date_demande) || '-'))}
            ${item('Validée le', echap(dateFr(h.date_validation) || '-'))}
            ${item('Ouverte le', echap(dateFr(h.date_realisation) || '-'))}
            ${item('Fermée le', echap(dateFr(h.date_revocation) || '-'))}
            ${item('Pièces justificatives', String(h.preuves.length))}
            ${h.assigne_a ? item('Prise en charge par', `<span class="assigne"><b>${echap(nomDe(h.assigne_a))}</b></span>`) : ''}
          </div>
          ${h.commentaire ? `<div class="bloc-pied" style="white-space:pre-wrap">${echap(h.commentaire)}</div>` : ''}
        </div>
        ${fermetureEnCours}
        ${peutAgir('habilitation:valider') ? formulaireProfil(h, `/habilitations/${h.id}`) : ''}
        ${actions ? `<div class="actions-ligne">${actions}</div>` : ''}
        ${refus}
        ${demandeFermeture}

        <div class="bloc">
          <div class="bloc-tete"><h2>Pièces justificatives</h2><span class="c">${h.preuves.length}</span></div>
          ${preuves}
          ${peut(u.role, 'preuve:ajouter') && h.statut !== 'revoquee'
            ? `<form method="post" action="/habilitations/${h.id}/preuves" enctype="multipart/form-data" style="padding:14px 16px;border-top:1px dashed var(--filet-fort)">
                 <label for="preuve">Joindre une pièce <span class="opt">(mail, PDF ou capture, ${Math.round(config.tailleMaxPreuve / 1048576)} Mo maximum)</span></label>
                 <input id="preuve" type="file" name="preuve" required accept="${EXTENSIONS_ACCEPTEES.join(',')}">
                 <div class="actions"><button class="btn" type="submit">${ICONES.televerser}Joindre</button></div></form>` : ''}
        </div>

        <div class="bloc">
          <div class="bloc-tete"><h2>Historique</h2><span class="c">${ecritures.length}</span>
            ${peut(u.role, 'audit:lire') ? '<span class="d"><a href="/coffre">Vérifier les pièces</a></span>' : ''}</div>
          <ul class="fil">${histo || '<li>Aucune opération.</li>'}</ul>
          <div class="bloc-pied">Cet historique ne peut pas être modifié après coup.</div>
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

  app.post('/habilitations/:id/profil', exigerAuth, exigerDroit('habilitation:valider'), (req, res) => {
    const u = req.session.utilisateur;
    const h = habilitationParId(nombre(req.params.id));
    if (!h) return res.status(404).send(pageErreur(req, 'Introuvable', 'Habilitation introuvable.'));
    if (!referentGereApplication(u, h.application_id)) {
      return res.status(403).send(pageErreur(req, 'Accès refusé', `Vous n'êtes pas référent de l'application « ${h.app_libelle} ».`, `/habilitations/${h.id}`));
    }
    try {
      modifierProfil(u.login, h.id, req.body.role);
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Profil non enregistré', e.message, `/habilitations/${h.id}`));
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
