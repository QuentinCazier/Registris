// Dépôt des demandes : simple, multiple, et départ d'un agent.

import { config } from '../config.js';
import { exigerAuth, exigerDroit, peut } from '../roles.js';
import {
  listerApplications, applicationParId, listerUfs, listerSites, agentParMatricule, creerHabilitation,
  listerDemandesDe, creerDemandeMultiple, signalerDepart, profilsProposes, PROFIL_A_PRECISER,
  motifsRefus, ufsRecentes, suggererAgents,
} from '../habilitations.js';
import { listerCategories, nomsActeurs } from '../administration.js';
import { getRoutage } from '../parametres.js';
import { ajouterPreuve, valider as validerPiece, EXTENSIONS_ACCEPTEES } from '../preuves.js';
import { notifier } from '../mailer.js';
import {
  echap, jsonInline, ICONES, page, pageErreur, tag, logoApp, item, bandeauOk, bandeauAlerte, pluriel,
  dateFr, etapeLisible,
} from '../ui.js';
import { upload, nombre } from './outils.js';
import { annuaire } from '../annuaire.js';

// Profil choisi dans la liste, « je ne sais pas », ou saisi librement.
export function profilSaisi(b, suffixe = '') {
  const direct = String(b[`role${suffixe}`] ?? '').trim();
  if (direct) return direct;
  const choix = String(b[`role_choix${suffixe}`] ?? '').trim();
  const autre = String(b[`role_autre${suffixe}`] ?? '').trim();
  if (choix === '__inconnu') return PROFIL_A_PRECISER;
  if (choix === '__autre' || !choix) return autre;
  return choix;
}

// Tableau des demandes d'un agent, avec l'étape en clair.
export function tableauDemandes(demandes, { legende = 'Demandes déposées' } = {}) {
  const motifs = motifsRefus(demandes.filter((h) => h.statut === 'refusee').map((h) => h.id));
  const nomDe = nomsActeurs();
  return `<div class="bloc"><table><caption>${echap(legende)}</caption><thead><tr><th scope="col">Application</th><th scope="col">Profil</th><th scope="col">Pour</th><th scope="col">Où en est la demande</th><th scope="col">Déposée le</th><th scope="col"><span class="sr">Détail</span></th></tr></thead>
    <tbody>${demandes.map((h) => `<tr><td>${echap(h.app_libelle)}</td><td>${echap(h.role)}</td>
      <td>${echap(`${h.prenom ?? ''} ${h.nom}`.trim())}</td>
      <td><span class="tag t-${echap(h.statut)}" style="white-space:normal">${echap(etapeLisible(h, { motifRefus: motifs.get(h.id) ?? '', nomDe }))}</span></td>
      <td>${echap(dateFr(h.date_demande))}</td>
      <td><a href="/habilitations/${h.id}">Voir<span class="sr"> la demande n° ${h.id}</span></a></td></tr>`).join('')}</tbody></table></div>`;
}

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
    // Un seul formulaire pour toutes les catégories : une case cochée survit au changement d'onglet.
    const tabs = cats.map((c) => `<a href="/habilitations/nouvelle?cat=${c.id}" data-cat="${c.id}" class="${c.id === courante ? 'actif' : ''}"${c.id === courante ? ' aria-current="true"' : ''}>${echap(c.libelle)}<span class="cat-compte" data-compte="${c.id}" hidden></span></a>`).join('');
    const carte = (a) => `<label class="srv srv-choix" data-cherche="${echap(`${a.libelle} ${a.code} ${a.cat_libelle ?? ''}`)}">
          <input type="checkbox" name="apps" value="${a.id}" data-libelle="${echap(a.libelle)}">
          <span class="ico">${logoApp(a)}</span>
          <span class="n">${echap(a.libelle)}</span>
          ${a.code.toLowerCase() !== a.libelle.toLowerCase() ? `<span class="c">${echap(a.code)}</span>` : ''}
          <span class="etat"><span class="non">Cocher pour choisir</span><span class="oui">Choisie</span></span>
        </label>`;
    const panneaux = cats.map((c) => `<div class="cat-grid" id="cat-${c.id}" data-panneau="${c.id}"${c.id === courante ? '' : ' hidden'}>${apps
      .filter((a) => (c.id === 0 ? !a.categorie_id : a.categorie_id === c.id)).map(carte).join('')}</div>`).join('');
    res.send(
      page(req, 'Nouvelle demande',
        apps.length
          ? `<p class="aide">Choisissez une ou plusieurs applications, puis continuez : une seule saisie suffit pour toutes.</p>
             <div class="recherche-catalogue" id="bloc-recherche" hidden>
               <label for="cherche-app">Rechercher une application</label>
               <input id="cherche-app" type="search" autocomplete="off" placeholder="ex. paie, dossier patient, messagerie">
             </div>
             ${cats.length > 1 ? `<nav class="cat-tabs" aria-label="Catégories d'applications">${tabs}</nav>` : ''}
             <form method="get" action="/habilitations/nouvelle/multiple" id="choix-apps">
               ${panneaux}
               <div class="vide aucun-resultat" id="aucun-resultat" hidden>Aucune application ne correspond. Essayez un autre mot, ou parcourez les catégories.</div>
               <div class="barre-choix" id="barre-choix">
                 <span id="compte-choix" aria-live="polite"><span class="indice">Aucune application choisie.</span></span>
                 <button class="btn btn-primary" type="submit" id="continuer">Continuer</button>
               </div>
             </form>
             <script nonce="${req.nonce}">(function(){
               var f=document.getElementById('choix-apps'),c=document.getElementById('compte-choix'),
                   go=document.getElementById('continuer'),q=document.getElementById('cherche-app'),
                   vide=document.getElementById('aucun-resultat'),nav=document.querySelector('.cat-tabs'),
                   onglets=document.querySelectorAll('.cat-tabs a[data-cat]'),
                   panneaux=f.querySelectorAll('[data-panneau]'),courant=${jsonInline(String(courante ?? ''))};
               document.getElementById('bloc-recherche').hidden=false;
               function afficher(id){
                 courant=id;
                 panneaux.forEach(function(p){p.hidden=p.getAttribute('data-panneau')!==id;});
                 onglets.forEach(function(o){var actif=o.getAttribute('data-cat')===id;
                   o.classList.toggle('actif',actif);if(actif)o.setAttribute('aria-current','true');else o.removeAttribute('aria-current');});
                 try{history.replaceState(null,'','/habilitations/nouvelle?cat='+encodeURIComponent(id));}catch(e){}
               }
               onglets.forEach(function(o){o.addEventListener('click',function(e){e.preventDefault();q.value='';filtrer();afficher(o.getAttribute('data-cat'));});});
               function simple(s){return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();}
               function filtrer(){
                 var t=simple(q.value.trim()),n=0;
                 f.querySelectorAll('.srv-choix').forEach(function(l){
                   var ok=!t||simple(l.getAttribute('data-cherche')).indexOf(t)>=0;l.hidden=!ok;if(ok)n++;});
                 if(t){panneaux.forEach(function(p){p.hidden=!p.querySelector('.srv-choix:not([hidden])');});if(nav)nav.hidden=true;vide.hidden=n>0;}
                 else{vide.hidden=true;if(nav)nav.hidden=false;afficher(courant);}
               }
               q.addEventListener('input',filtrer);
               function maj(){
                 var coches=f.querySelectorAll('input[name=apps]:checked'),noms=[];
                 coches.forEach(function(i){noms.push(i.getAttribute('data-libelle'));});
                 go.disabled=coches.length===0;
                 c.textContent=coches.length?(coches.length+(coches.length>1?' applications choisies : ':' application choisie : ')+noms.join(', ')):'Aucune application choisie.';
                 panneaux.forEach(function(p){
                   var n=p.querySelectorAll('input[name=apps]:checked').length,
                       badge=document.querySelector('.cat-compte[data-compte="'+p.getAttribute('data-panneau')+'"]');
                   if(badge){badge.hidden=n===0;badge.textContent=n;}
                 });
               }
               f.addEventListener('change',maj);maj();})();</script>`
          : '<div class="vide">Aucune application au catalogue. Un administrateur doit d\'abord en déclarer.</div>'),
    );
  });

  const optionsSites = () => listerSites().map((s) => `<option value="${s.id}">${echap(s.nom)}</option>`).join('');

  const champProfil = (a, suffixe, { etiquetteVisible = true } = {}) => {
    const profils = profilsProposes(a.id);
    const id = `role-choix${suffixe}`;
    return `<label for="${id}"${etiquetteVisible ? '' : ' class="sr"'}>Profil demandé sur ${echap(a.libelle)}</label>
      <select id="${id}" name="role_choix${suffixe}" data-profil required>
        <option value="">Choisir un profil</option>
        ${profils.map((p) => `<option value="${echap(p)}">${echap(p)}</option>`).join('')}
        <option value="__inconnu">Je ne sais pas, le référent choisira</option>
        <option value="__autre">Autre profil, à préciser</option>
      </select>
      <label class="sr" for="role-autre${suffixe}">Autre profil sur ${echap(a.libelle)}</label>
      <input class="profil-autre" id="role-autre${suffixe}" name="role_autre${suffixe}" maxlength="200" placeholder="Nom du profil, ex. Lecture seule" data-autre>`;
  };

  const champsBeneficiaire = (u) => `
    <label>Pour qui ?</label>
    <div class="radios">
      <label class="radio"><input type="radio" name="pour_autrui" value="0" checked> Pour moi</label>
      <label class="radio"><input type="radio" name="pour_autrui" value="1"> Pour un autre agent</label>
    </div>
    <div class="grille2">
      <div><label for="matricule">Matricule du bénéficiaire</label><input id="matricule" name="matricule" value="${echap(u.matricule || '')}" required readonly maxlength="40" list="agents-trouves" autocomplete="off" aria-describedby="qui-benef">
        <datalist id="agents-trouves"></datalist>
        <div id="qui-benef" class="champ-aide" aria-live="polite"></div></div>
      <div><label for="email">Courriel du bénéficiaire <span class="opt">(pour être prévenu)</span></label><input id="email" name="email" type="email" value="${echap(u.email || '')}" readonly maxlength="200"></div>
    </div>
    <div id="benef" class="grille2" hidden>
      <div><label for="nom">Nom</label><input id="nom" name="nom" maxlength="100"></div>
      <div><label for="prenom">Prénom</label><input id="prenom" name="prenom" maxlength="100"></div>
    </div>`;

  const champsContexte = (u) => {
    const recentes = new Set(ufsRecentes(u.matricule));
    const ufs = listerUfs();
    const sites = optionsSites();
    return `
    ${ufs.length
      ? `<label for="uf-filtre">Service concerné <span class="opt">(une ou plusieurs unités fonctionnelles)</span></label>
         <input id="uf-filtre" type="search" autocomplete="off" placeholder="Rechercher un service ou un code d'UF" hidden>
         <div class="liste-ufs" id="liste-ufs" role="group" aria-label="Unités fonctionnelles">
           ${ufs.map((f) => `<label data-cherche="${echap(`${f.code} ${f.libelle}`)}"><input type="checkbox" name="ufIds" value="${f.id}"${recentes.has(f.id) ? ' checked' : ''}><span class="code">${echap(f.code)}</span> ${echap(f.libelle)}</label>`).join('')}
         </div>`
      : ''}
    <div class="grille2">
      <div><label for="uf_libre">${ufs.length ? 'Service absent de la liste' : 'Service'} <span class="opt">(facultatif)</span></label><input id="uf_libre" name="uf_libre" maxlength="200" placeholder="ex. 1101, Urgences"></div>
      <div>${sites ? `<label for="siteId">Site</label><select id="siteId" name="siteId"><option value="">Non précisé</option>${sites}</select>` : ''}</div>
    </div>
    <label for="commentaire">Motif, contexte <span class="opt">(facultatif)</span></label>
    <textarea id="commentaire" name="commentaire" maxlength="2000" placeholder="Prise de poste, remplacement, changement de service…"></textarea>
    <details class="facultatif">
      <summary>Joindre une pièce justificative <span class="opt">(facultatif)</span></summary>
      <div>
        <label for="piece">Le mail de demande ou une capture d'écran</label>
        <input id="piece" type="file" name="preuve" accept="${EXTENSIONS_ACCEPTEES.join(',')}" aria-describedby="piece-aide">
        <div id="piece-aide" class="champ-aide">Formats .msg, .eml, .pdf, .png ou .jpg, ${Math.round(config.tailleMaxPreuve / 1048576)} Mo maximum.
          Sans pièce, le référent la joindra lui-même.</div>
      </div>
    </details>`;
  };

  // Bénéficiaire, services et profils : le comportement commun aux deux formulaires.
  const scriptFormulaire = (req, u) => `<script nonce="${req.nonce}">(function(){
      var SELF=${jsonInline({ matricule: u.matricule || '', email: u.email || '', nom: u.nom || '' })},
          benef=document.getElementById('benef'),mat=document.getElementById('matricule'),qui=document.getElementById('qui-benef'),
          mail=document.getElementById('email'),nom=document.getElementById('nom'),prenom=document.getElementById('prenom'),
          liste=document.getElementById('agents-trouves'),filtre=document.getElementById('uf-filtre'),ufs=document.getElementById('liste-ufs');
      var ufsDeMoi=ufs?[].slice.call(ufs.querySelectorAll('input:checked')):[];
      function autre(){return document.querySelector('input[name=pour_autrui]:checked').value==='1';}
      function maj(){var a=autre();benef.hidden=!a;mat.readOnly=!a;mail.readOnly=!a;nom.required=a;qui.textContent=a?'Tapez son nom ou son matricule, puis choisissez-le dans la liste.':'';
        ufsDeMoi.forEach(function(c){c.checked=!a;});
        if(!a){mat.value=SELF.matricule;mail.value=SELF.email;nom.value='';prenom.value='';}
        else{if(mat.value===SELF.matricule)mat.value='';if(mail.value===SELF.email)mail.value='';}}
      document.querySelectorAll('input[name=pour_autrui]').forEach(function(r){r.addEventListener('change',maj);});
      mat.addEventListener('input',function(){if(!autre()||mat.value.length<2)return;
        fetch('/api/agents?q='+encodeURIComponent(mat.value)).then(function(r){return r.json();}).then(function(d){
          liste.innerHTML='';(d.agents||[]).forEach(function(x){var o=document.createElement('option');o.value=x.matricule;o.label=x.nom+' '+x.prenom+' ('+x.matricule+')';liste.appendChild(o);});}).catch(function(){});});
      mat.addEventListener('change',function(){if(!autre()||!mat.value)return;
        fetch('/api/agent?ufs=1&matricule='+encodeURIComponent(mat.value)).then(function(r){return r.json();})
          .then(function(d){if(d&&d.trouve){nom.value=d.nom||'';prenom.value=d.prenom||'';if(!mail.value)mail.value=d.email||'';qui.textContent='Agent : '+(d.prenom||'')+' '+(d.nom||'');
            if(ufs&&d.ufIds&&!ufs.querySelector('input:checked'))d.ufIds.forEach(function(id){var c=ufs.querySelector('input[value="'+id+'"]');if(c)c.checked=true;});}
            else{qui.textContent='Agent inconnu du registre : indiquez son nom et son prénom.';}})
          .catch(function(){});});
      if(ufs){filtre.hidden=false;filtre.addEventListener('input',function(){var t=filtre.value.trim().toLowerCase();
        ufs.querySelectorAll('label').forEach(function(l){l.hidden=t&&l.getAttribute('data-cherche').toLowerCase().indexOf(t)<0;});});}
      document.querySelectorAll('select[data-profil]').forEach(function(s){
        var champ=document.getElementById(s.id.replace('role-choix','role-autre'));
        function montrer(){var a=s.value==='__autre';champ.hidden=!a;champ.required=a;}
        s.addEventListener('change',montrer);montrer();});
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
        <div>${champProfil(a, `_${a.id}`, { etiquetteVisible: false })}</div>
        <input type="hidden" name="apps" value="${a.id}">
      </div>`).join('');

    res.send(
      page(req, 'Nouvelle demande',
        `<form method="post" action="/habilitations/multiple" enctype="multipart/form-data" class="carte" style="max-width:760px">
          <h2 style="margin:0 0 4px;font-size:15px">${pluriel(choisies.length, 'application')} ${choisies.length >= 2 ? 'sélectionnées' : 'sélectionnée'}</h2>
          <div class="aide">Choisissez le profil voulu sur chacune. Si vous ne le connaissez pas, le référent choisira.</div>
          <div class="lignes-app">${lignes}</div>
          ${champsBeneficiaire(u)}${champsContexte(u)}
          <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Envoyer ${pluriel(choisies.length, 'demande')}</button>
            <a class="btn btn-ghost" href="/habilitations/nouvelle">Retour au catalogue</a></div>
        </form>
        ${scriptFormulaire(req, u)}`),
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
        lignes: ids.map((id) => ({ applicationId: id, role: profilSaisi(b, `_${id}`) })),
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
          <div><h2>${echap(a.libelle)}</h2><div class="c">${echap(a.cat_libelle ?? '')}</div></div></div>
        <form method="post" action="/habilitations" enctype="multipart/form-data" class="carte" style="max-width:680px">
          <input type="hidden" name="applicationId" value="${a.id}">
          ${champProfil(a, '')}
          ${champsBeneficiaire(u)}
          ${champsContexte(u)}
          <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Envoyer la demande</button>
            <a class="btn btn-ghost" href="/habilitations/nouvelle?cat=${a.categorie_id ?? 0}">Retour au catalogue</a></div>
        </form>
        ${scriptFormulaire(req, u)}`),
    );
  });

  // Le registre d'abord, puis l'annuaire si un compte de service le permet.
  app.get('/api/agent', exigerAuth, exigerDroit('habilitation:creer'), async (req, res) => {
    const m = String(req.query.matricule ?? '').slice(0, 40);
    const avecUfs = (r) => (req.query.ufs === '1' ? { ...r, ufIds: ufsRecentes(m) } : r);
    const a = agentParMatricule(m);
    if (a) return res.json(avecUfs({ trouve: true, nom: a.nom, prenom: a.prenom, email: a.email ?? '', source: 'registre' }));
    if (config.authMode === 'ldap' && config.ldap.bindDN) {
      try {
        const p = await annuaire.chercherAgent(m);
        if (p) return res.json(avecUfs({ trouve: true, nom: p.nom, prenom: p.prenom, email: p.email, source: 'annuaire' }));
      } catch (e) {
        console.error(`[${config.nom}] recherche d'un agent dans l'annuaire : ${e.message}`);
      }
    }
    return res.json({ trouve: false });
  });

  // Retrouver un collègue par son nom : identité seulement, jamais ses accès.
  app.get('/api/agents', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    res.json({ agents: suggererAgents(String(req.query.q ?? '').slice(0, 60)) });
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
        role: profilSaisi(b),
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

  // --- Départ d'un agent : ouvert à tout agent, qui désigne un collègue sans lire le registre ----
  app.get('/depart', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const u = req.session.utilisateur;
    res.send(
      page(req, 'Signaler un départ',
        `<form method="post" action="/depart" class="carte" style="max-width:620px">
          <div class="aide">Désignez l'agent qui part. Chaque référent reçoit une demande de fermeture pour
            l'accès qui le concerne. Les accès restent ouverts jusqu'à ce que le référent les ferme.</div>
          <div class="grille2">
            <div><label for="matricule">Agent qui part <span class="opt">(nom ou matricule)</span></label>
              <input id="matricule" name="matricule" required maxlength="40" autocomplete="off" list="agents-trouves"
                     aria-describedby="qui-agent" placeholder="ex. Durand ou E12345">
              <datalist id="agents-trouves"></datalist></div>
            <div><label for="date_depart">Date du départ <span class="opt">(facultatif)</span></label>
              <input id="date_depart" name="date_depart" type="date"></div>
          </div>
          <div id="qui-agent" class="aide" aria-live="polite">Tapez son nom, puis choisissez-le dans la liste.</div>
          <label for="motif">Motif</label>
          <input id="motif" name="motif" required maxlength="300" placeholder="Départ en retraite, mutation, fin de contrat…">
          <div class="actions"><button class="btn btn-primary" type="submit">Demander la fermeture de ses accès</button>
            <a class="btn btn-ghost" href="/">Annuler</a></div>
        </form>
        <script nonce="${req.nonce}">(function(){
          var mat=document.getElementById('matricule'),qui=document.getElementById('qui-agent'),liste=document.getElementById('agents-trouves');
          mat.addEventListener('input',function(){if(mat.value.length<2)return;
            fetch('/api/agents?q='+encodeURIComponent(mat.value)).then(function(r){return r.json();}).then(function(d){
              liste.innerHTML='';(d.agents||[]).forEach(function(x){var o=document.createElement('option');o.value=x.matricule;o.label=x.nom+' '+x.prenom+' ('+x.matricule+')';liste.appendChild(o);});}).catch(function(){});});
          mat.addEventListener('change',function(){
            if(!mat.value){qui.textContent='';return;}
            fetch('/api/agent?matricule='+encodeURIComponent(mat.value)).then(function(r){return r.json();})
              .then(function(d){qui.textContent=d&&d.trouve?('Agent : '+(d.prenom||'')+' '+d.nom):'Aucun agent trouvé : choisissez un nom dans la liste.';})
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
            ${item('Agent', `${echap(nom)} <span class="mat">${echap(bilan.agent.matricule)}</span>`)}
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
    const deposees = nombre(req.query.depose);
    res.send(
      page(req, 'Mes demandes',
        `${deposees ? bandeauOk(`${pluriel(deposees, 'demande')} ${deposees >= 2 ? 'envoyées' : 'envoyée'}. Vous serez prévenu par courriel à chaque étape.`) : ''}
        ${demandes.length
          ? tableauDemandes(demandes)
          : '<div class="vide">Vous n\'avez pas encore déposé de demande.</div>'}`,
        peut(req.session.utilisateur.role, 'habilitation:creer') ? `<a class="btn btn-primary" href="/habilitations/nouvelle">${ICONES.plus}Nouvelle demande</a>` : ''),
    );
  });
}
