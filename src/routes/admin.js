// Administration.

import { config } from '../config.js';
import { exigerAuth, exigerDroit, LIBELLES_ROLE, ROLES } from '../roles.js';
import { listerApplications, applicationParId, listerUfs, listerSites } from '../habilitations.js';
import {
  listerCategories, creerCategorie, supprimerCategorie, creerApplication, modifierApplication,
  supprimerApplication, enregistrerLogo, creerUf, supprimerUf, creerSite, supprimerSite,
  listerUtilisateurs, utilisateurParLogin, creerUtilisateur, modifierUtilisateur, supprimerUtilisateur,
  perimetresReferents, definirPerimetreReferent, listerComptesAnnuaire, etatBibliotheque, ajouterDepuisBibliotheque,
  listerPacks, packParId, creerPack, modifierPack, supprimerPack, ajouterElementPack, retirerElementPack,
} from '../administration.js';
import { getRoutage, setRoutage } from '../parametres.js';
import { VERSION_BIBLIOTHEQUE } from '../logiciels.js';
import { echap, ICONES, page, pageErreur, tagRole, logoApp, bandeauOk, pluriel } from '../ui.js';
import { upload, nombre } from './outils.js';

export function monter(app, { verifierCsrf }) {
  const admin = exigerDroit('admin:gerer');
  const acteur = (req) => req.session.utilisateur.login;
  const erreur400 = (req, res, titre, e, retour) => res.status(400).send(pageErreur(req, titre, e.message, retour));

  app.get('/admin/applications', exigerAuth, admin, (req, res) => {
    const cats = listerCategories({ tous: true });
    const optCat = (sel) => `<option value="">Sans catégorie</option>${cats.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${echap(c.libelle)}</option>`).join('')}`;
    const lignes = listerApplications().map((a) => `<tr>
        <td><span class="ico" style="width:34px;height:34px">${logoApp(a)}</span></td>
        <td class="mono">${echap(a.code)}</td>
        <td>${echap(a.libelle)}${a.actif === 0 ? ' <span class="micro">(inactive)</span>' : ''}</td>
        <td>${echap(a.cat_libelle ?? '-')}</td>
        <td><div class="actions-ligne" style="margin:0">
          <a class="btn btn-ghost btn-petit" href="/admin/applications/${a.id}/modifier">Modifier</a>
          <form method="post" action="/admin/applications/${a.id}/supprimer" data-confirmer="Supprimer cette application ?"><button class="btn btn-danger btn-petit">Supprimer</button></form>
        </div></td></tr>`).join('');
    res.send(
      page(req, 'Applications',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Catalogue</h2>
            <table><caption>Catalogue des applications</caption><thead><tr><th scope="col"></th><th scope="col">Code</th><th scope="col">Libellé</th><th scope="col">Catégorie</th><th scope="col"></th></tr></thead>
              <tbody>${lignes || '<tr><td colspan="5" style="color:var(--encre-3)">Aucune application.</td></tr>'}</tbody></table>
          </section>
          <section style="margin-top:0"><h2>Ajouter une application</h2>
            <form method="post" action="/admin/applications" enctype="multipart/form-data" class="carte">
              <label for="code">Code <span class="opt">(unique, ex. GAM, DPI)</span></label><input id="code" name="code" required maxlength="40" pattern="[A-Za-z0-9_.\\-]{2,40}">
              <label for="libelle">Libellé</label><input id="libelle" name="libelle" required maxlength="120" placeholder="ex. Gestion administrative des malades">
              <label for="categorieId">Catégorie</label><select id="categorieId" name="categorieId">${optCat(null)}</select>
              <label for="logo">Logo <span class="opt">(png, jpg, svg, webp, 2 Mo max, facultatif)</span></label><input id="logo" type="file" name="logo" accept=".png,.jpg,.jpeg,.svg,.webp,.gif">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div>
            </form>
          </section>
        </div>`),
    );
  });
  const uploadLogo = (req, res, next) => upload.single('logo')(req, res, (err) => (err ? erreur400(req, res, 'Logo refusé', err, '/admin/applications') : next()));
  app.post('/admin/applications', exigerAuth, admin, uploadLogo, verifierCsrf, (req, res) => {
    try {
      const logo = req.file ? enregistrerLogo({ tampon: req.file.buffer, nom: req.file.originalname }) : null;
      creerApplication(acteur(req), { code: req.body.code, libelle: req.body.libelle, categorieId: nombre(req.body.categorieId), logo });
    } catch (e) {
      return erreur400(req, res, 'Application non créée', e, '/admin/applications');
    }
    res.redirect('/admin/applications');
  });
  app.get('/admin/applications/:id/modifier', exigerAuth, admin, (req, res) => {
    const a = applicationParId(nombre(req.params.id));
    if (!a) return res.status(404).send(pageErreur(req, 'Introuvable', 'Application introuvable.', '/admin/applications'));
    const cats = listerCategories({ tous: true });
    res.send(
      page(req, `Modifier ${a.code}`,
        `<form method="post" action="/admin/applications/${a.id}/modifier" enctype="multipart/form-data" class="carte" style="max-width:560px">
          <div class="srv-tete"><span class="ico">${logoApp(a)}</span><div><h2>${echap(a.code)}</h2></div></div>
          <label for="libelle">Libellé</label><input id="libelle" name="libelle" value="${echap(a.libelle)}" required maxlength="120">
          <label for="categorieId">Catégorie</label><select id="categorieId" name="categorieId"><option value="">Sans catégorie</option>${cats.map((c) => `<option value="${c.id}" ${c.id === a.categorie_id ? 'selected' : ''}>${echap(c.libelle)}</option>`).join('')}</select>
          <label class="radio" style="margin-top:14px"><input type="checkbox" name="actif" value="1" ${a.actif !== 0 ? 'checked' : ''}> Active (proposée au catalogue)</label>
          <label for="logo">Remplacer le logo <span class="opt">(facultatif)</span></label><input id="logo" type="file" name="logo" accept=".png,.jpg,.jpeg,.svg,.webp,.gif">
          <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button><a class="btn btn-ghost" href="/admin/applications">Annuler</a></div>
        </form>`),
    );
  });
  app.post('/admin/applications/:id/modifier', exigerAuth, admin, uploadLogo, verifierCsrf, (req, res) => {
    try {
      const logo = req.file ? enregistrerLogo({ tampon: req.file.buffer, nom: req.file.originalname }) : undefined;
      modifierApplication(acteur(req), nombre(req.params.id), {
        libelle: req.body.libelle, categorieId: req.body.categorieId === '' ? '' : nombre(req.body.categorieId), logo, actif: req.body.actif === '1',
      });
    } catch (e) {
      return erreur400(req, res, 'Modification refusée', e, `/admin/applications/${nombre(req.params.id)}/modifier`);
    }
    res.redirect('/admin/applications');
  });
  app.post('/admin/applications/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerApplication(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/applications');
    }
    res.redirect('/admin/applications');
  });

  app.get('/admin/categories', exigerAuth, admin, (req, res) => {
    const lignes = listerCategories({ tous: true }).map((c) => `<tr><td class="mono">${c.ordre}</td><td>${echap(c.libelle)}</td>
        <td><form method="post" action="/admin/categories/${c.id}/supprimer" data-confirmer="Supprimer cette catégorie ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Catégories',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Catégories du catalogue</h2>
            <table><caption>Catégories du catalogue</caption><thead><tr><th scope="col">Ordre</th><th scope="col">Libellé</th><th scope="col"></th></tr></thead><tbody>${lignes || '<tr><td colspan="3" style="color:var(--encre-3)">Aucune catégorie.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Ajouter</h2>
            <form method="post" action="/admin/categories" class="carte">
              <label for="libelle">Libellé</label><input id="libelle" name="libelle" required maxlength="80" placeholder="ex. Applications médicales">
              <label for="ordre">Ordre d'affichage</label><input id="ordre" name="ordre" type="number" min="0" value="0">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form></section>
        </div>`),
    );
  });
  app.post('/admin/categories', exigerAuth, admin, (req, res) => {
    try {
      creerCategorie(acteur(req), { libelle: req.body.libelle, ordre: req.body.ordre });
    } catch (e) {
      return erreur400(req, res, 'Catégorie non créée', e, '/admin/categories');
    }
    res.redirect('/admin/categories');
  });
  app.post('/admin/categories/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerCategorie(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/categories');
    }
    res.redirect('/admin/categories');
  });

  app.get('/admin/ufs', exigerAuth, admin, (req, res) => {
    const lignes = listerUfs().map((f) => `<tr><td class="mono">${echap(f.code)}</td><td>${echap(f.libelle)}</td>
        <td><form method="post" action="/admin/ufs/${f.id}/supprimer" data-confirmer="Supprimer cette UF ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Unités fonctionnelles',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Référentiel des UF</h2>
            <table><caption>Référentiel des unités fonctionnelles</caption><thead><tr><th scope="col">Code</th><th scope="col">Libellé</th><th scope="col"></th></tr></thead><tbody>${lignes || '<tr><td colspan="3" style="color:var(--encre-3)">Aucune UF. Les demandes peuvent toujours saisir des UF en texte libre.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Ajouter une UF</h2>
            <form method="post" action="/admin/ufs" class="carte">
              <label for="code">Code</label><input id="code" name="code" required maxlength="20" placeholder="ex. 1101">
              <label for="libelle">Libellé</label><input id="libelle" name="libelle" required maxlength="120" placeholder="ex. Médecine polyvalente">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form>
            <p class="champ-aide" style="margin-top:12px">Pour un import en masse, utilisez la ligne de commande : <code>registris ufs fichier.csv</code>.</p></section>
        </div>`),
    );
  });
  app.post('/admin/ufs', exigerAuth, admin, (req, res) => {
    try {
      creerUf(acteur(req), { code: req.body.code, libelle: req.body.libelle });
    } catch (e) {
      return erreur400(req, res, 'UF non créée', e, '/admin/ufs');
    }
    res.redirect('/admin/ufs');
  });
  app.post('/admin/ufs/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerUf(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/ufs');
    }
    res.redirect('/admin/ufs');
  });

  app.get('/admin/sites', exigerAuth, admin, (req, res) => {
    const lignes = listerSites({ tous: true }).map((s) => `<tr><td>${echap(s.nom)}</td>
        <td><form method="post" action="/admin/sites/${s.id}/supprimer" data-confirmer="Supprimer ce site ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Sites',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Sites de l'établissement</h2>
            <table><caption>Sites de l'établissement</caption><thead><tr><th scope="col">Site</th><th scope="col"></th></tr></thead><tbody>${lignes || '<tr><td colspan="2" style="color:var(--encre-3)">Aucun site.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Ajouter un site</h2>
            <form method="post" action="/admin/sites" class="carte">
              <label for="nom">Nom</label><input id="nom" name="nom" required maxlength="120" placeholder="ex. Hôpital Nord">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form></section>
        </div>`),
    );
  });
  app.post('/admin/sites', exigerAuth, admin, (req, res) => {
    try {
      creerSite(acteur(req), req.body.nom);
    } catch (e) {
      return erreur400(req, res, 'Site non créé', e, '/admin/sites');
    }
    res.redirect('/admin/sites');
  });
  app.post('/admin/sites/:id/supprimer', exigerAuth, admin, (req, res) => {
    try {
      supprimerSite(acteur(req), nombre(req.params.id));
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/sites');
    }
    res.redirect('/admin/sites');
  });

  // La bibliothèque : on part d'une liste à cocher, pas d'une page blanche.
  app.get('/admin/bibliotheque', exigerAuth, admin, (req, res) => {
    const ajoutees = nombre(req.query.ajoutees);
    const fonctions = etatBibliotheque();
    const restants = fonctions.reduce((n, f) => n + f.produits.filter((p) => !p.present).length, 0);

    const bloc = (f) => {
      const lignes = f.produits.map((p) => `
        <label class="biblio-item${p.present ? ' deja' : ''}">
          ${p.present
            ? `<span class="puce p-fait">au catalogue</span>`
            : `<input type="checkbox" name="codes" value="${echap(p.code)}">`}
          <span class="ico">${logoApp({ code: p.code })}</span>
          <span class="n">${echap(p.nom)}${p.editeur ? `<span class="e">${echap(p.editeur)}</span>` : ''}</span>
        </label>`).join('');
      return `<div class="bloc">
        <div class="bloc-tete"><h2>${echap(f.libelle)}</h2>
          <span class="c">${pluriel(f.produits.filter((p) => !p.present).length, 'à ajouter')}</span></div>
        <div class="bloc-pied" style="border-top:0;border-bottom:1px solid var(--filet);background:var(--blanc)">${echap(f.description)}</div>
        <div class="biblio-grille">${lignes}</div>
      </div>`;
    };

    res.send(
      page(req, 'Bibliothèque de logiciels',
        `${ajoutees ? bandeauOk(`${pluriel(ajoutees, 'application')} ${ajoutees >= 2 ? 'ajoutées' : 'ajoutée'} au catalogue.`) : ''}
        <div class="aide" style="max-width:760px">Cochez les logiciels de l'établissement : ils entrent au catalogue,
          rangés dans leur fonction. Ce qui manque s'ajoute ensuite à la main depuis
          <a href="/admin/applications">Applications</a>. Les logos ne sont pas fournis, ce sont des marques :
          déposez le vôtre sur chaque application, sinon l'outil affiche un monogramme.</div>
        ${restants
          ? `<form method="post" action="/admin/bibliotheque">
              ${fonctions.map(bloc).join('')}
              <div class="barre-choix">
                <span>Version de la liste : ${echap(VERSION_BIBLIOTHEQUE)}</span>
                <button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter au catalogue</button>
              </div>
            </form>`
          : `${bandeauOk('Tous les logiciels de la bibliothèque sont déjà au catalogue.')}
             ${fonctions.map(bloc).join('')}`}`,
        '', { sous: 'Une liste indicative, à compléter par vos propres applications' }),
    );
  });

  app.post('/admin/bibliotheque', exigerAuth, admin, (req, res) => {
    let bilan;
    try {
      bilan = ajouterDepuisBibliotheque(req.session.utilisateur.login, [].concat(req.body.codes ?? []));
    } catch (e) {
      return erreur400(req, res, 'Ajout impossible', e, '/admin/bibliotheque');
    }
    res.redirect(`/admin/bibliotheque?ajoutees=${bilan.ajoutees.length}`);
  });

  // Comptes locaux et périmètre des référents.
  app.get('/admin/utilisateurs', exigerAuth, admin, (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    const roleF = ROLES.includes(req.query.role) ? req.query.role : '';
    const comptes = listerUtilisateurs({ q, role: roleF });
    const apps = listerApplications();
    const optionsApp = (sel = []) => apps.map((a) => `<option value="${a.id}" ${sel.includes(a.id) ? 'selected' : ''}>${echap(a.libelle)}</option>`).join('');
    const optionsRole = ROLES.map((r) => `<option value="${r}">${LIBELLES_ROLE[r]}</option>`).join('');
    const lignes = comptes.map((c) => `<tr>
        <td>${echap(c.nom)}${c.actif === 0 ? ' <span class="micro">(inactif)</span>' : ''}<div class="mono" style="color:var(--encre-3);font-size:11.5px">${echap(c.login)}</div></td>
        <td class="mono">${echap(c.matricule ?? '-')}</td><td>${tagRole(c.role)}</td>
        <td>${c.applications.length ? echap(c.applications.map((a) => a.libelle).join(', ')) : '-'}</td>
        <td><div class="actions-ligne" style="margin:0">
          <a class="btn btn-ghost btn-petit" href="/admin/utilisateurs/${encodeURIComponent(c.login)}/modifier">Modifier</a>
          ${c.login !== req.session.utilisateur.login ? `<form method="post" action="/admin/utilisateurs/${encodeURIComponent(c.login)}/supprimer" data-confirmer="Supprimer ce compte ?"><button class="btn btn-danger btn-petit">Supprimer</button></form>` : ''}
        </div></td></tr>`).join('');
    const vus = listerComptesAnnuaire();
    const perims = [...perimetresReferents()]
      .filter(([login]) => !comptes.some((c) => c.login.toLowerCase() === login) && !vus.some((c) => c.login === login));
    const ligneAnnuaire = (c) => `<tr><td class="mono">${echap(c.login)}</td>
        <td>${echap(c.nom)}${c.email ? `<div class="mono" style="color:var(--encre-3);font-size:11.5px">${echap(c.email)}</div>` : ''}</td>
        <td>${tagRole(c.role)}</td><td class="mono">${echap(String(c.vu_le).slice(0, 16))}</td>
        <td>${c.applications.length ? echap(c.applications.map((a) => a.libelle).join(', ')) : c.role === 'referent' ? '<span class="puce p-attente">toutes</span>' : '-'}</td>
        <td>${c.applications.length ? `<form method="post" action="/admin/referents"><input type="hidden" name="login" value="${echap(c.login)}"><button class="btn btn-danger btn-petit">Retirer le périmètre</button></form>` : ''}</td></tr>`;
    const lignePerimetre = ([login, liste]) => `<tr><td class="mono">${echap(login)}</td><td><span class="micro">jamais connecté</span></td><td>-</td><td>-</td>
        <td>${echap(liste.map((a) => a.libelle).join(', '))}</td>
        <td><form method="post" action="/admin/referents"><input type="hidden" name="login" value="${echap(login)}"><button class="btn btn-danger btn-petit">Retirer</button></form></td></tr>`;
    const modeLdap = config.authMode === 'ldap';
    res.send(
      page(req, 'Comptes et référents',
        `${modeLdap ? '<div class="bandeau b-ok"><span>Mode annuaire (LDAP) : les comptes et les rôles viennent des groupes de l\'Active Directory. Les comptes locaux ci-dessous ne servent qu\'en secours.</span></div>' : ''}
        <form method="get" class="filtres"><div><label for="q">Recherche</label><input id="q" name="q" value="${echap(q)}" placeholder="nom, identifiant, matricule"></div>
          <div><label for="role">Rôle</label><select id="role" name="role"><option value="">Tous</option>${ROLES.map((r) => `<option value="${r}" ${r === roleF ? 'selected' : ''}>${LIBELLES_ROLE[r]}</option>`).join('')}</select></div>
          <button class="btn btn-ghost" type="submit">Filtrer</button></form>
        <section style="margin-top:0"><h2>Comptes locaux (${comptes.length})</h2>
          <table><caption>Comptes locaux et rôles</caption><thead><tr><th scope="col">Nom / identifiant</th><th scope="col">Matricule</th><th scope="col">Rôle</th><th scope="col">Périmètre référent</th><th scope="col"></th></tr></thead>
            <tbody>${lignes || '<tr><td colspan="5" style="color:var(--encre-3)">Aucun compte.</td></tr>'}</tbody></table></section>
        <div class="deux-col">
          <section><h2>Créer un compte local</h2>
            <form method="post" action="/admin/utilisateurs" class="carte">
              <div class="grille2"><div><label for="login">Identifiant</label><input id="login" name="login" required maxlength="100"></div>
                <div><label for="nom">Nom complet</label><input id="nom" name="nom" required maxlength="120"></div>
                <div><label for="matricule">Matricule</label><input id="matricule" name="matricule" maxlength="40"></div>
                <div><label for="email">Courriel</label><input id="email" name="email" type="email" maxlength="200"></div></div>
              <label for="c-role">Rôle</label><select id="c-role" name="role" required>${optionsRole}</select>
              <label for="c-apps">Applications <span class="opt">(si référent)</span></label><select id="c-apps" name="applicationIds" multiple size="4">${optionsApp()}</select>
              <label for="mdp">Mot de passe <span class="opt">(12 caractères minimum)</span></label><input id="mdp" name="motDePasse" type="password" required minlength="12" autocomplete="new-password">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Créer</button></div></form></section>
          <section><h2>Périmètre d'un référent de l'annuaire</h2>
            <p class="aide">En mode LDAP, un référent sans périmètre déclaré couvre toutes les applications. Restreignez-le ici par son identifiant Windows. Les comptes de l'annuaire apparaissent ci-dessous après leur première connexion.</p>
            <form method="post" action="/admin/referents" class="carte">
              <label for="r-login">Identifiant annuaire</label><input id="r-login" name="login" required maxlength="100" placeholder="ex. jdupont">
              <label for="r-apps">Applications du périmètre</label><select id="r-apps" name="applicationIds" multiple size="5">${optionsApp()}</select>
              <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer le périmètre</button></div></form>
            ${vus.length || perims.length ? `<table style="margin-top:14px"><caption>Comptes de l'annuaire et périmètres déclarés</caption>
              <thead><tr><th scope="col">Identifiant</th><th scope="col">Nom</th><th scope="col">Rôle</th><th scope="col">Vu le</th><th scope="col">Applications</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
              <tbody>${vus.map(ligneAnnuaire).join('')}${perims.map(lignePerimetre).join('')}</tbody></table>` : ''}
          </section>
        </div>`, '', { large: true }),
    );
  });
  app.post('/admin/utilisateurs', exigerAuth, admin, (req, res) => {
    const b = req.body;
    try {
      creerUtilisateur(acteur(req), {
        login: b.login, nom: b.nom, role: b.role, motDePasse: b.motDePasse, matricule: b.matricule, email: b.email,
        applicationIds: [].concat(b.applicationIds ?? []).map(nombre).filter(Boolean),
      });
    } catch (e) {
      return erreur400(req, res, 'Compte non créé', e, '/admin/utilisateurs');
    }
    res.redirect('/admin/utilisateurs');
  });
  app.post('/admin/referents', exigerAuth, admin, (req, res) => {
    try {
      definirPerimetreReferent(acteur(req), req.body.login, [].concat(req.body.applicationIds ?? []).map(nombre).filter(Boolean));
    } catch (e) {
      return erreur400(req, res, 'Périmètre non enregistré', e, '/admin/utilisateurs');
    }
    res.redirect('/admin/utilisateurs');
  });
  app.get('/admin/utilisateurs/:login/modifier', exigerAuth, admin, (req, res) => {
    const c = utilisateurParLogin(req.params.login);
    if (!c) return res.status(404).send(pageErreur(req, 'Introuvable', 'Compte introuvable.', '/admin/utilisateurs'));
    const apps = listerApplications();
    res.send(
      page(req, `Modifier ${c.login}`,
        `<form method="post" action="/admin/utilisateurs/${encodeURIComponent(c.login)}/modifier" class="carte" style="max-width:560px">
          <label>Identifiant</label><input value="${echap(c.login)}" readonly>
          <div class="grille2"><div><label for="nom">Nom complet</label><input id="nom" name="nom" value="${echap(c.nom)}" required maxlength="120"></div>
            <div><label for="matricule">Matricule</label><input id="matricule" name="matricule" value="${echap(c.matricule ?? '')}" maxlength="40"></div></div>
          <label for="email">Courriel</label><input id="email" name="email" type="email" value="${echap(c.email ?? '')}" maxlength="200">
          <label for="role">Rôle</label><select id="role" name="role" required>${ROLES.map((r) => `<option value="${r}" ${r === c.role ? 'selected' : ''}>${LIBELLES_ROLE[r]}</option>`).join('')}</select>
          <label for="apps">Applications <span class="opt">(si référent)</span></label>
          <select id="apps" name="applicationIds" multiple size="5">${apps.map((a) => `<option value="${a.id}" ${c.applicationIds.includes(a.id) ? 'selected' : ''}>${echap(a.libelle)}</option>`).join('')}</select>
          <label class="radio" style="margin-top:14px"><input type="checkbox" name="actif" value="1" ${c.actif ? 'checked' : ''}> Compte actif</label>
          <label for="mdp">Nouveau mot de passe <span class="opt">(vide : inchangé)</span></label><input id="mdp" name="motDePasse" type="password" minlength="12" autocomplete="new-password">
          <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button><a class="btn btn-ghost" href="/admin/utilisateurs">Annuler</a></div>
        </form>`),
    );
  });
  app.post('/admin/utilisateurs/:login/modifier', exigerAuth, admin, (req, res) => {
    const b = req.body;
    try {
      modifierUtilisateur(acteur(req), req.params.login, {
        nom: b.nom, role: b.role, motDePasse: b.motDePasse, matricule: b.matricule, email: b.email, actif: b.actif === '1',
        applicationIds: [].concat(b.applicationIds ?? []).map(nombre).filter(Boolean),
      });
    } catch (e) {
      return erreur400(req, res, 'Modification refusée', e, `/admin/utilisateurs/${encodeURIComponent(req.params.login)}/modifier`);
    }
    res.redirect('/admin/utilisateurs');
  });
  app.post('/admin/utilisateurs/:login/supprimer', exigerAuth, admin, (req, res) => {
    if (req.params.login === req.session.utilisateur.login) return erreur400(req, res, 'Suppression refusée', new Error('Vous ne pouvez pas supprimer votre propre compte.'), '/admin/utilisateurs');
    try {
      supprimerUtilisateur(acteur(req), req.params.login);
    } catch (e) {
      return erreur400(req, res, 'Suppression refusée', e, '/admin/utilisateurs');
    }
    res.redirect('/admin/utilisateurs');
  });

  // Packs : administration.
  app.get('/admin/packs', exigerAuth, admin, (req, res) => {
    const lignes = listerPacks({ tous: true }).map((p) => `<tr><td><a href="/admin/packs/${p.id}">${echap(p.nom)}</a>${p.actif ? '' : ' <span class="micro">(inactif)</span>'}</td>
        <td>${echap(p.description ?? '')}</td><td class="mono">${p.nb}</td>
        <td><form method="post" action="/admin/packs/${p.id}/supprimer" data-confirmer="Supprimer ce pack ?"><button class="btn btn-danger btn-petit">Supprimer</button></form></td></tr>`).join('');
    res.send(
      page(req, 'Packs nouvel arrivant',
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Packs</h2>
            <table><caption>Packs nouvel arrivant</caption><thead><tr><th scope="col">Nom</th><th scope="col">Description</th><th scope="col">Accès</th><th scope="col"></th></tr></thead><tbody>${lignes || '<tr><td colspan="4" style="color:var(--encre-3)">Aucun pack.</td></tr>'}</tbody></table></section>
          <section style="margin-top:0"><h2>Créer un pack</h2>
            <form method="post" action="/admin/packs" class="carte">
              <label for="nom">Nom</label><input id="nom" name="nom" required maxlength="80" placeholder="ex. Secrétaire médicale">
              <label for="description">Description</label><input id="description" name="description" maxlength="200">
              <label for="destinataire">Courriel notifié à chaque application du pack <span class="opt">(facultatif)</span></label><input id="destinataire" name="destinataire" type="email" maxlength="200">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Créer</button></div></form></section>
        </div>`),
    );
  });
  app.post('/admin/packs', exigerAuth, admin, (req, res) => {
    try {
      const id = creerPack(acteur(req), req.body);
      return res.redirect(`/admin/packs/${id}`);
    } catch (e) {
      return erreur400(req, res, 'Pack non créé', e, '/admin/packs');
    }
  });
  app.get('/admin/packs/:id', exigerAuth, admin, (req, res) => {
    const p = packParId(nombre(req.params.id));
    if (!p) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pack introuvable.', '/admin/packs'));
    const optionsApp = listerApplications({ actives: true }).map((a) => `<option value="${a.id}">${echap(a.libelle)}</option>`).join('');
    res.send(
      page(req, `Pack : ${p.nom}`,
        `<section style="margin-top:0"><h2>Paramètres</h2>
          <form method="post" action="/admin/packs/${p.id}/modifier" class="carte" style="max-width:600px">
            <div class="grille2"><div><label for="nom">Nom</label><input id="nom" name="nom" value="${echap(p.nom)}" required maxlength="80"></div>
              <div><label for="destinataire">Courriel notifié</label><input id="destinataire" name="destinataire" type="email" value="${echap(p.destinataire ?? '')}" maxlength="200"></div></div>
            <label for="description">Description</label><input id="description" name="description" value="${echap(p.description ?? '')}" maxlength="200">
            <label class="radio" style="margin-top:14px"><input type="checkbox" name="actif" value="1" ${p.actif ? 'checked' : ''}> Pack actif</label>
            <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form></section>
        <div class="deux-col">
          <section><h2>Accès du pack</h2>
            <table><caption>Accès contenus dans ce pack</caption><thead><tr><th scope="col">Application</th><th scope="col">Profil par défaut</th><th scope="col"></th></tr></thead><tbody>${p.elements.map((e) =>
              `<tr><td>${echap(e.app_libelle)} <span class="mono" style="color:var(--encre-3)">${echap(e.app_code)}</span></td><td>${echap(e.role || '-')}</td>
               <td><form method="post" action="/admin/packs/${p.id}/elements/${e.application_id}/retirer"><button class="btn btn-danger btn-petit">Retirer</button></form></td></tr>`).join('')
              || '<tr><td colspan="3" style="color:var(--encre-3)">Aucun accès. Ajoutez-en à droite.</td></tr>'}</tbody></table></section>
          <section><h2>Ajouter un accès</h2>
            <form method="post" action="/admin/packs/${p.id}/elements" class="carte">
              <label for="applicationId">Application</label><select id="applicationId" name="applicationId" required>${optionsApp}</select>
              <label for="role">Profil par défaut</label><input id="role" name="role" maxlength="200" placeholder="ex. Gestionnaire">
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.plus}Ajouter</button></div></form></section>
        </div>`,
        `<a class="btn btn-ghost" href="/admin/packs">Retour</a>`),
    );
  });
  app.post('/admin/packs/:id/modifier', exigerAuth, admin, (req, res) => {
    try {
      modifierPack(acteur(req), nombre(req.params.id), { ...req.body, actif: req.body.actif === '1' });
    } catch (e) {
      return erreur400(req, res, 'Modification refusée', e, `/admin/packs/${nombre(req.params.id)}`);
    }
    res.redirect(`/admin/packs/${nombre(req.params.id)}`);
  });
  app.post('/admin/packs/:id/supprimer', exigerAuth, admin, (req, res) => {
    supprimerPack(acteur(req), nombre(req.params.id));
    res.redirect('/admin/packs');
  });
  app.post('/admin/packs/:id/elements', exigerAuth, admin, (req, res) => {
    try {
      ajouterElementPack(acteur(req), nombre(req.params.id), nombre(req.body.applicationId), req.body.role);
    } catch (e) {
      return erreur400(req, res, 'Ajout refusé', e, `/admin/packs/${nombre(req.params.id)}`);
    }
    res.redirect(`/admin/packs/${nombre(req.params.id)}`);
  });
  app.post('/admin/packs/:id/elements/:appId/retirer', exigerAuth, admin, (req, res) => {
    retirerElementPack(acteur(req), nombre(req.params.id), nombre(req.params.appId));
    res.redirect(`/admin/packs/${nombre(req.params.id)}`);
  });

  // Notifications : adresse destinataire des nouvelles demandes, par catégorie.
  app.get('/admin/routage', exigerAuth, admin, (req, res) => {
    const cats = listerCategories({ tous: true });
    res.send(
      page(req, 'Notifications',
        `<div class="carte" style="max-width:640px">
          <p class="aide">À chaque nouvelle demande, un courriel part à l'adresse de la catégorie concernée (équipe qui ouvre les droits).
            ${config.smtp.actif ? '' : '<b>Envoi désactivé</b> : renseignez SMTP_HOST dans la configuration pour l\'activer.'}</p>
          <form method="post" action="/admin/routage">
            ${cats.map((c) => `<label for="cat-${c.id}">${echap(c.libelle)}</label><input id="cat-${c.id}" name="cat__${c.id}" type="email" value="${echap(getRoutage(c.id))}" maxlength="200" placeholder="equipe@etablissement.fr">`).join('')
              || '<p style="color:var(--encre-3)">Aucune catégorie déclarée.</p>'}
            <div class="actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
          </form></div>`),
    );
  });
  app.post('/admin/routage', exigerAuth, admin, (req, res) => {
    for (const c of listerCategories({ tous: true })) setRoutage(acteur(req), c.id, req.body[`cat__${c.id}`] ?? '');
    res.redirect('/admin/routage');
  });
}
