// Aide : une fiche par rôle, lisible à l'écran et imprimable pour les cadres.

import { config } from '../config.js';
import { exigerAuth, LIBELLES_ROLE } from '../roles.js';
import { echap, page } from '../ui.js';

const FICHES = [
  {
    role: 'utilisateur',
    titre: 'Agent',
    pour: "Tout agent qui demande un accès, pour lui ou pour un collègue.",
    etapes: [
      "Cliquez sur « Nouvelle demande », en haut à droite.",
      "Cochez une ou plusieurs applications. La recherche retrouve une application par son nom.",
      "Cliquez sur « Continuer », puis choisissez le profil voulu. Si vous ne le connaissez pas, choisissez « Je ne sais pas » : le référent choisira.",
      "Pour un collègue, choisissez « Pour un autre agent » et tapez son nom.",
      "Envoyez. Vous êtes prévenu par courriel à chaque étape, et « Mes demandes » dit où en est chacune.",
      "Un collègue quitte le service ? « Signaler un départ » fait fermer tous ses accès.",
    ],
  },
  {
    role: 'referent',
    titre: 'Référent applicatif',
    pour: "La personne qui ouvre et ferme les droits dans une application.",
    etapes: [
      "« À traiter » liste les demandes qui vous attendent, les plus anciennes d'abord.",
      "Ouvrez une demande. Si le profil est « à préciser », choisissez-le d'abord.",
      "Validez, ou refusez avec un motif : l'agent le lira.",
      "Ouvrez l'accès dans l'application, puis cliquez sur « Marquer l'accès ouvert ».",
      "Joignez le mail de demande ou la validation du cadre : c'est la preuve présentée en audit.",
      "Une fermeture est demandée ? Fermez le compte dans l'application, puis cliquez sur « Fermer l'accès ».",
    ],
  },
  {
    role: 'controleur',
    titre: 'Contrôleur, auditeur',
    pour: "Contrôle interne, commissaire aux comptes, DPO : lecture seule.",
    etapes: [
      "« Registre » liste tous les accès, filtrables et exportables en tableur.",
      "« Preuves et audit » produit le dossier de preuves en une archive, avec un manifeste d'empreintes.",
      "« Journal d'audit » montre qui a fait quoi et quand. Toute modification après coup y serait signalée.",
      "« Revue périodique » suit la campagne où chaque référent confirme ou retire les accès.",
    ],
  },
  {
    role: 'admin',
    titre: 'Administrateur',
    pour: "La DSI ou la personne qui paramètre l'outil.",
    etapes: [
      "Suivez la « Mise en route » du tableau de bord : catégories, applications, référents, services, courriels.",
      "« Importer un tableur » déclare d'un coup les applications, leurs référents, leurs profils et les unités fonctionnelles.",
      "Dans chaque application, listez les profils proposés aux agents.",
      "« Comptes et référents » rattache chaque référent à ses applications.",
      "Les sauvegardes, l'ancrage et les relances se planifient côté serveur : voir le guide de déploiement.",
    ],
  },
];

export function monter(app) {
  app.get('/aide', exigerAuth, (req, res) => {
    const role = req.session.utilisateur.role;
    const fiches = [...FICHES].sort((a, b) => (b.role === role) - (a.role === role));
    res.send(
      page(req, 'Aide',
        `<div class="impr"><div class="t">${echap(config.nom)}${config.etablissement ? ` · ${echap(config.etablissement)}` : ''}</div>
          <div class="d">Fiches d'aide par rôle</div></div>
        <p class="aide">Votre rôle : <b>${echap(LIBELLES_ROLE[role] ?? role)}</b>. Votre fiche est la première. Chaque fiche tient sur une page à l'impression.</p>
        <div class="aide-roles">${fiches.map((f) => `<section class="carte${f.role === role ? ' moi' : ''}" aria-labelledby="aide-${f.role}" style="margin:0">
            <h2 id="aide-${f.role}">${echap(f.titre)}</h2>
            <p class="pour">${echap(f.pour)}</p>
            <ol>${f.etapes.map((e) => `<li>${echap(e)}</li>`).join('')}</ol>
          </section>`).join('')}</div>`,
        '<button class="btn btn-ghost" type="button" id="imprimer">Imprimer</button>'
          + `<script nonce="${req.nonce}">document.getElementById('imprimer').addEventListener('click',function(){window.print();});</script>`),
    );
  });
}
