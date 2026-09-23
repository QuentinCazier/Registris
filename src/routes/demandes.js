// Dépôt des demandes : simple, multiple, et départ d'un agent.

import { config } from '../config.js';
import { exigerAuth, exigerDroit, peut } from '../roles.js';
import {
  listerApplications, applicationParId, listerUfs, listerSites, agentParMatricule, creerHabilitation,
  listerDemandesDe, creerDemandeMultiple, signalerDepart,
} from '../habilitations.js';
import { listerCategories } from '../administration.js';
import { getRoutage } from '../parametres.js';
import { ajouterPreuve, valider as validerPiece, EXTENSIONS_ACCEPTEES } from '../preuves.js';
import { notifier } from '../mailer.js';
import {
  echap, jsonInline, ICONES, page, pageErreur, tag, logoApp, item, bandeauOk, bandeauAlerte, pluriel,
} from '../ui.js';
import { upload, nombre } from './outils.js';
import { annuaire } from '../annuaire.js';

export function monter(app, { verifierCsrf }) {
  // --- Nouvelle demande : catalogue puis formulaire -----------------------------------------------
  const uploadPiece = (req, res, next) => upload.single('preuve')(req, res, (err) => (err
    ? res.status(400).send(pageErreur(req, 'Pièce refusée',
        err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux.' : err.message, '/habilitations/nouvelle'))
    : next()));

  app.get('/habilitations/nouvelle', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const apps = listerApplications({ actives: true });
    const cats = listerCategories().filter((c) => apps.some((a) => a.categorie_id === c.id));
    const sansCat = apps.filter((a) => !a.categorie_id);
    if (sansCat.length) cats.push({ id: 0, libelle: 'Autres' });
    const courante = cats.some((c) => String(c.id) === String(req.query.cat)) ? Number(req.query.cat) : cats[0]?.id;
    const tabs = cats.map((c) => `<a href="/habilitations/nouvelle?cat=${c.id}" class="${c.id === courante ? 'actif' : ''}">${echap(c.libelle)}</a>`).join('');
    const cartes = apps
      .filter((a) => (courante === 0 ? !a.categorie_id : a.categorie_id === courante))
      .map((a) => `<div class="srv"><span class="ico">${logoApp(a)}</span>
          <div class="n">${echap(a.libelle)}</div><div class="c mono">${echap(a.code)}</div>
          <div class="b">
            <label class="choix"><input type="checkbox" name="apps" value="${a.id}"> Ajouter</label>
            <a class="btn btn-petit" href="/habilitations/nouvelle/${a.id}">Seule</a>
          </div></div>`)
      .join('');
    res.send(
      page(req, 'Nouvelle demande',
        apps.length
          ? `${cats.length > 1 ? `<div class="cat-tabs">${tabs}</div>` : ''}
             <form method="get" action="/habilitations/nouvelle/multiple" id="choix-apps">
               <div class="cat-grid">${cartes}</div>
               <div class="barre-choix" id="barre-choix" hidden>
                 <span id="compte-choix" aria-live="polite"></span>
                 <button class="btn btn-primary" type="submit">${ICONES.plus}Demander ces accès</button>
               </div>
             </form>
             <script nonce="${req.nonce}">(function(){
               var f=document.getElementById('choix-apps'),b=document.getElementById('barre-choix'),
                   c=document.getElementById('compte-choix');
               function maj(){var n=f.querySelectorAll('input[name=apps]:checked').length;
                 b.hidden=n===0;c.textContent=n+(n>1?' applications sélectionnées':' application sélectionnée');}
               f.addEventListener('change',maj);maj();})();</script>`
          : '<div class="vide">Aucune application au catalogue. Un administrateur doit d\'abord en déclarer.</div>'),
    );
  });

  const optionsUfSites = () => ({
    sites: listerSites().map((s) => `<option value="${s.id}">${echap(s.nom)}</option>`).join(''),
    ufs: listerUfs().map((f) => `<option value="${f.id}">${echap(f.code)} · ${echap(f.libelle)}</option>`).join(''),
  });

  const champsBeneficiaire = (u) => `
    <label>Pour qui ?</label>
    <div class="radios">
      <label class="radio"><input type="radio" name="pour_autrui" value="0" checked> Pour moi</label>
      <label class="radio"><input type="radio" name="pour_autrui" value="1"> Pour un autre agent</label>
    </div>
    <div class="grille2">
      <div><label for="matricule">Matricule du bénéficiaire</label><input id="matricule" name="matricule" value="${echap(u.matricule || '')}" required readonly maxlength="40"></div>
      <div><label for="email">Courriel du bénéficiaire <span class="opt">(notifications)</span></label><input id="email" name="email" type="email" value="${echap(u.email || '')}" readonly maxlength="200"></div>
    </div>
    <div id="benef" class="grille2" hidden>
      <div><label for="nom">Nom</label><input id="nom" name="nom" maxlength="100"></div>
      <div><label for="prenom">Prénom</label><input id="prenom" name="prenom" maxlength="100"></div>
    </div>`;

  const champsContexte = ({ ufs, sites }) => `
    <div class="grille2">
      <div><label for="ufIds">UF concernées <span class="opt">(référentiel, plusieurs possibles)</span></label>
        <select id="ufIds" name="ufIds" multiple size="5">${ufs || '<option disabled>Aucune UF déclarée</option>'}</select></div>
      <div><label for="uf_libre">Autres UF <span class="opt">(saisie libre)</span></label><input id="uf_libre" name="uf_libre" maxlength="200" placeholder="ex. 1101, Urgences">
        <label for="siteId">Site</label><select id="siteId" name="siteId"><option value="">Non précisé</option>${sites}</select></div>
    </div>
    <label for="commentaire">Motif, contexte <span class="opt">(facultatif)</span></label>
    <textarea id="commentaire" name="commentaire" maxlength="2000" placeholder="Prise de poste, remplacement, changement de service…"></textarea>
    <label for="piece">Pièce justificative <span class="opt">(le mail de demande, ou une capture d'écran)</span></label>
    <input id="piece" type="file" name="preuve" accept="${EXTENSIONS_ACCEPTEES.join(',')}" aria-describedby="piece-aide">
    <div id="piece-aide" class="aide">Le mail au format .msg ou .eml, ou la capture en .png ou .jpg, au choix.
      Elle part au coffre avec la demande, ${Math.round(config.tailleMaxPreuve / 1048576)} Mo maximum.</div>`;

  // Saisie du bénéficiaire, partagée par les deux formulaires.
  const scriptBeneficiaire = (req, u) => `<script nonce="${req.nonce}">(function(){
      var SELF=${jsonInline({ matricule: u.matricule || '', email: u.email || '', nom: u.nom || '' })},
          benef=document.getElementById('benef'),mat=document.getElementById('matricule'),
          mail=document.getElementById('email'),nom=document.getElementById('nom'),prenom=document.getElementById('prenom');
      function autre(){return document.querySelector('input[name=pour_autrui]:checked').value==='1';}
      function maj(){var a=autre();benef.hidden=!a;mat.readOnly=!a;mail.readOnly=!a;nom.required=a;
        if(!a){mat.value=SELF.matricule;mail.value=SELF.email;nom.value='';prenom.value='';}
        else{if(mat.value===SELF.matricule)mat.value='';if(mail.value===SELF.email)mail.value='';}}
      document.querySelectorAll('input[name=pour_autrui]').forEach(function(r){r.addEventListener('change',maj);});
      mat.addEventListener('blur',function(){if(!autre()||!mat.value)return;
        fetch('/api/agent?matricule='+encodeURIComponent(mat.value)).then(function(r){return r.json();})
          .then(function(d){if(d&&d.trouve){if(!nom.value)nom.value=d.nom||'';if(!prenom.value)prenom.value=d.prenom||'';if(!mail.value)mail.value=d.email||'';}})
          .catch(function(){});});
      maj();})();</script>`;

  // Plusieurs applications, un profil par ligne, autant d'habilitations créées.
  app.get('/habilitations/nouvelle/multiple', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const u = req.session.utilisateur;
    const ids = [...new Set([].concat(req.query.apps ?? []).map(nombre).filter(Boolean))];
    const choisies = ids.map((id) => applicationParId(id)).filter((a) => a && a.actif !== 0);
    if (!choisies.length) return res.redirect('/habilitations/nouvelle');
    if (choisies.length === 1) return res.redirect(`/habilitations/nouvelle/${choisies[0].id}`);

    const lignes = choisies.map((a) => `
      <div class="ligne-app">
        <span class="qui"><span class="ico">${logoApp(a)}</span>${echap(a.libelle)}</span>
        <div>
          <label class="sr" for="role-${a.id}">Profil demandé sur ${echap(a.libelle)}</label>
          <input id="role-${a.id}" name="role_${a.id}" required maxlength="200"
                 placeholder="Profil demandé sur ${echap(a.code)}">
        </div>
        <input type="hidden" name="apps" value="${a.id}">
      </div>`).join('');

    res.send(
      page(req, 'Nouvelle demande',
        `<form method="post" action="/habilitations/multiple" enctype="multipart/form-data" class="carte" style="max-width:760px">
          <h2 style="margin:0 0 4px;font-size:15px">${pluriel(choisies.length, 'application')} ${choisies.length >= 2 ? 'sélectionnées' : 'sélectionnée'}</h2>
          <div class="aide">Chaque accès suivra ensuite son propre chemin : le référent de chaque application
            valide le sien. Ce qui est groupé, c'est votre demande.</div>
          <div class="lignes-app">${lignes}</div>
          ${champsBeneficiaire(u)}${champsContexte(optionsUfSites())}
          <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Déposer ${pluriel(choisies.length, 'demande')}</button>
            <a class="btn btn-ghost" href="/habilitations/nouvelle">Retour au catalogue</a></div>
        </form>
        ${scriptBeneficiaire(req, u)}`),
    );
  });

  app.post('/habilitations/multiple', exigerAuth, exigerDroit('habilitation:creer'), uploadPiece, verifierCsrf, async (req, res) => {
    const b = req.body;
    const u = req.session.utilisateur;
    const ids = [...new Set([].concat(b.apps ?? []).map(nombre).filter(Boolean))];
    const retour = `/habilitations/nouvelle/multiple?${ids.map((i) => `apps=${i}`).join('&')}`;
    if (req.file) {
      try {
        validerPiece({ tampon: req.file.buffer, nom: req.file.originalname });
      } catch (e) {
        return res.status(400).send(pageErreur(req, 'Pièce refusée', e.message, retour));
      }
    }

    const pourAutrui = b.pour_autrui === '1';
    const agent = pourAutrui
      ? { matricule: b.matricule, nom: b.nom, prenom: b.prenom, email: b.email }
      : { matricule: u.matricule || b.matricule, nom: u.nom, prenom: '', email: u.email || b.email };

    let creees;
    try {
      creees = creerDemandeMultiple(u.login, {
        lignes: ids.map((id) => ({ applicationId: id, role: b[`role_${id}`] })),
        agent,
        ufIds: [].concat(b.ufIds ?? []).map(nombre).filter(Boolean),
        ufLibre: b.uf_libre,
        siteId: nombre(b.siteId) || null,
        demandeur: `${u.matricule ? `${u.matricule} ` : ''}${u.nom}`.trim(),
        commentaire: b.commentaire,
        pourAutrui,
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Demande refusée', e.message, retour));
    }

    // Chaque accès porte sa propre pièce.
    if (req.file) {
      for (const h of creees) ajouterPreuve(u.login, h.id, { tampon: req.file.buffer, nom: req.file.originalname });
    }

    const resume = creees
      .map((h) => `- ${h.app_libelle} : « ${h.role} » (demande n°${h.id})`)
      .join('\n');
    const entete = `${pluriel(creees.length, 'demande')} pour ${creees[0].nom} ${creees[0].prenom} (matricule ${creees[0].matricule}), `
      + `déposée${creees.length >= 2 ? 's' : ''} par ${creees[0].demandeur} :`;
    await Promise.all([
      ...new Set(creees.map((h) => getRoutage(h.app_cat_id)).filter(Boolean)),
    ].map((to) => notifier({ to, sujet: 'Nouvelles demandes d\'habilitation', texte: `${entete}\n${resume}` })));
    await notifier({ to: creees[0].email, sujet: 'Demandes enregistrées', texte: `${entete}\n${resume}` });

    res.redirect(`/mes-demandes?depose=${creees.length}`);
  });

  app.get('/habilitations/nouvelle/:appId', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const a = applicationParId(nombre(req.params.appId));
    if (!a || a.actif === 0) return res.status(404).send(pageErreur(req, 'Introuvable', 'Application introuvable ou désactivée.', '/habilitations/nouvelle'));
    const u = req.session.utilisateur;
    res.send(
      page(req, 'Nouvelle demande',
        `<div class="srv-tete"><span class="ico">${logoApp(a)}</span>
          <div><h2>${echap(a.libelle)}</h2><div class="c">${echap(a.cat_libelle ?? '')} · ${echap(a.code)}</div></div></div>
        <form method="post" action="/habilitations" enctype="multipart/form-data" class="carte" style="max-width:680px">
          <input type="hidden" name="applicationId" value="${a.id}">
          ${champsBeneficiaire(u)}
          <label for="role">Profil ou droit demandé</label>
          <input id="role" name="role" required maxlength="200" placeholder="ex. Gestionnaire admissions, Lecture seule, Prescripteur…">
          ${champsContexte(optionsUfSites())}
          <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Déposer la demande</button>
            <a class="btn btn-ghost" href="/habilitations/nouvelle?cat=${a.categorie_id ?? 0}">Retour au catalogue</a></div>
        </form>
        ${scriptBeneficiaire(req, u)}`),
    );
  });

  // Le registre d'abord, puis l'annuaire si un compte de service le permet.
  app.get('/api/agent', exigerAuth, exigerDroit('habilitation:creer'), async (req, res) => {
    const m = String(req.query.matricule ?? '').slice(0, 40);
    const a = agentParMatricule(m);
    if (a) return res.json({ trouve: true, nom: a.nom, prenom: a.prenom, email: a.email ?? '', source: 'registre' });
    if (config.authMode === 'ldap' && config.ldap.bindDN) {
      try {
        const p = await annuaire.chercherAgent(m);
        if (p) return res.json({ trouve: true, nom: p.nom, prenom: p.prenom, email: p.email, source: 'annuaire' });
      } catch (e) {
        console.error(`[${config.nom}] recherche d'un agent dans l'annuaire : ${e.message}`);
      }
    }
    return res.json({ trouve: false });
  });

  app.post('/habilitations', exigerAuth, exigerDroit('habilitation:creer'), uploadPiece, verifierCsrf, async (req, res) => {
    const b = req.body;
    const u = req.session.utilisateur;
    const pourAutrui = b.pour_autrui === '1';
    const retourForm = `/habilitations/nouvelle/${nombre(b.applicationId) || ''}`;

    // La pièce est contrôlée avant toute écriture.
    if (req.file) {
      try {
        validerPiece({ tampon: req.file.buffer, nom: req.file.originalname });
      } catch (e) {
        return res.status(400).send(pageErreur(req, 'Pièce refusée', e.message, retourForm));
      }
    }
    const agent = pourAutrui
      ? { matricule: b.matricule, nom: b.nom, prenom: b.prenom, email: b.email }
      : { matricule: u.matricule || b.matricule, nom: u.nom, prenom: '', email: u.email || b.email };
    let h;
    try {
      h = creerHabilitation(u.login, {
        agent,
        applicationId: nombre(b.applicationId),
        role: b.role,
        ufIds: [].concat(b.ufIds ?? []).map(nombre).filter(Boolean),
        ufLibre: b.uf_libre,
        siteId: nombre(b.siteId) || null,
        demandeur: `${u.matricule ? u.matricule + ' ' : ''}${u.nom}`.trim(),
        commentaire: b.commentaire,
        pourAutrui,
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Demande refusée', e.message, retourForm));
    }
    if (req.file) ajouterPreuve(u.login, h.id, { tampon: req.file.buffer, nom: req.file.originalname });
    const resume = `Demande n°${h.id} : « ${h.role} » sur ${h.app_libelle} pour ${h.nom} ${h.prenom} (matricule ${h.matricule}), déposée par ${h.demandeur}.`;
    await Promise.all([
      notifier({ to: getRoutage(h.app_cat_id), sujet: `Nouvelle demande d'habilitation : ${h.app_libelle}`, texte: resume }),
      notifier({ to: h.email, sujet: `Demande enregistrée : ${h.app_libelle}`, texte: resume }),
    ]);
    res.redirect(`/habilitations/${h.id}`);
  });

  // --- Départ d'un agent : ouvert à tout agent, qui désigne un matricule sans lire le registre ----
  app.get('/depart', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const u = req.session.utilisateur;
    res.send(
      page(req, 'Signaler un départ',
        `<form method="post" action="/depart" class="carte" style="max-width:620px">
          <div class="aide">Indiquez le matricule de l'agent qui part. L'outil ouvre une demande de
            fermeture sur chacun de ses accès encore ouverts, et chaque référent d'application reçoit
            la sienne. Les accès ne se ferment pas tout seuls : ils restent ouverts jusqu'à ce que le
            référent ait agi dans son application.</div>
          <div class="grille2">
            <div><label for="matricule">Matricule de l'agent</label>
              <input id="matricule" name="matricule" required maxlength="40" autocomplete="off"
                     aria-describedby="qui-agent"></div>
            <div><label for="date_depart">Date du départ <span class="opt">(facultatif)</span></label>
              <input id="date_depart" name="date_depart" type="date"></div>
          </div>
          <div id="qui-agent" class="aide" aria-live="polite"></div>
          <label for="motif">Motif</label>
          <input id="motif" name="motif" required maxlength="300" placeholder="Départ en retraite, mutation, fin de contrat…">
          <div class="actions"><button class="btn btn-primary" type="submit">Demander la fermeture de ses accès</button>
            <a class="btn btn-ghost" href="/">Annuler</a></div>
        </form>
        <script nonce="${req.nonce}">(function(){
          var mat=document.getElementById('matricule'),qui=document.getElementById('qui-agent');
          mat.addEventListener('blur',function(){
            if(!mat.value){qui.textContent='';return;}
            fetch('/api/agent?matricule='+encodeURIComponent(mat.value)).then(function(r){return r.json();})
              .then(function(d){qui.textContent=d&&d.trouve?('Agent : '+d.nom+' '+(d.prenom||'')):'Aucun agent de ce matricule au registre.';})
              .catch(function(){});});})();</script>`,
        '', { sous: `Connecté comme ${echap(u.nom)}` }),
    );
  });

  app.post('/depart', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const u = req.session.utilisateur;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date_depart ?? '')) ? req.body.date_depart : '';
    const motif = `${String(req.body.motif ?? '').trim()}${date ? ` (départ le ${date})` : ''}`;
    let bilan;
    try {
      bilan = signalerDepart(u.login, {
        matricule: req.body.matricule,
        motif,
        demandeur: `${u.matricule ? `${u.matricule} ` : ''}${u.nom}`.trim(),
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Signalement impossible', e.message, '/depart'));
    }

    const nom = `${bilan.agent.nom} ${bilan.agent.prenom}`.trim();

    // Une alerte par adresse de routage, avec les accès qui la concernent.
    const parAdresse = new Map();
    for (const h of bilan.habilitations) {
      const to = getRoutage(h.app_cat_id);
      if (!to) continue;
      if (!parAdresse.has(to)) parAdresse.set(to, []);
      parAdresse.get(to).push(h);
    }
    for (const [to, acces] of parAdresse) {
      notifier({
        to,
        sujet: `Départ signalé : ${nom}`,
        texte: `${pluriel(acces.length, 'accès')} de ${nom} (matricule ${bilan.agent.matricule}) ${acces.length >= 2 ? 'sont' : 'est'} à fermer.\n`
          + `Motif : ${motif}\n\n`
          + acces.map((h) => `- ${h.app_libelle} : « ${h.role} » (n°${h.id})`).join('\n')
          + `\n\nIls apparaissent dans la file de traitement. L'accès reste ouvert tant qu'il n'a pas été fermé dans l'application.`,
      });
    }

    // Un décompte, pas la liste : le demandeur n'a pas à apprendre qui détient quoi.
    res.send(
      page(req, 'Départ signalé',
        `${bilan.fermeturesDemandees
          ? bandeauOk(`${pluriel(bilan.fermeturesDemandees, 'demande')} de fermeture ${bilan.fermeturesDemandees >= 2 ? 'ouvertes' : 'ouverte'} pour ${echap(nom)}.`)
          : bandeauAlerte(`Aucun accès ouvert à fermer pour ${echap(nom)}.`)}
        <div class="carte" style="max-width:620px">
          <div class="paires">
            ${item('Agent', `${echap(nom)} <span class="mono">(${echap(bilan.agent.matricule)})</span>`)}
            ${item('Fermetures demandées', String(bilan.fermeturesDemandees))}
            ${bilan.dejaDemandes ? item('Déjà demandées avant ce signalement', String(bilan.dejaDemandes)) : ''}
            ${item('Motif', echap(motif))}
          </div>
          <div class="bloc-pied" style="border-radius:0 0 10px 10px">Les accès restent ouverts jusqu'à ce que chaque
            référent ait fermé le sien dans son application. Vous serez averti à chaque fermeture.</div>
        </div>
        <div class="actions"><a class="btn" href="/depart">Signaler un autre départ</a>
          <a class="btn btn-ghost" href="/">Retour au tableau de bord</a></div>`),
    );
  });

  // --- Mes demandes -----------------------------------------------------------------------------
  app.get('/mes-demandes', exigerAuth, (req, res) => {
    const demandes = listerDemandesDe(req.session.utilisateur.login);
    res.send(
      page(req, 'Mes demandes',
        demandes.length
          ? `<table><caption>Demandes déposées</caption><thead><tr><th scope="col">N°</th><th scope="col">Application</th><th scope="col">Profil</th><th scope="col">Bénéficiaire</th><th scope="col">Statut</th><th scope="col">Date</th><th scope="col"></th></tr></thead>
            <tbody>${demandes.map((h) => `<tr><td class="mono">${h.id}</td><td>${echap(h.app_libelle)}</td><td>${echap(h.role)}</td>
              <td>${echap(h.nom)} ${echap(h.prenom)} <span class="mono">(${echap(h.matricule)})</span></td>
              <td>${tag(h.statut)}</td><td class="mono">${echap(h.date_demande ?? '')}</td>
              <td><a href="/habilitations/${h.id}">Ouvrir</a></td></tr>`).join('')}</tbody></table>`
          : '<div class="vide">Vous n\'avez pas encore déposé de demande.</div>',
        peut(req.session.utilisateur.role, 'habilitation:creer') ? `<a class="btn btn-primary" href="/habilitations/nouvelle">${ICONES.plus}Nouvelle demande</a>` : ''),
    );
  });
}
