/**
 * Rôles et permissions.
 *
 *   admin        configure l'outil (catalogue, comptes, référentiels) et a tous les droits ;
 *   referent     référent d'une ou plusieurs applications : valide, exécute, révoque
 *                les habilitations de SON périmètre ;
 *   controleur   audit et lecture seule : journal, export du dossier de preuves ;
 *   utilisateur  agent standard : dépose des demandes, joint des preuves, suit les siennes.
 */

export const ROLES = ['admin', 'referent', 'controleur', 'utilisateur'];

export const LIBELLES_ROLE = {
  admin: 'Administrateur',
  referent: 'Référent applicatif',
  controleur: 'Contrôleur',
  utilisateur: 'Utilisateur',
};

// Matrice des permissions : action -> rôles autorisés. Pour le référent, le droit de
// valider / exécuter / révoquer est de plus restreint à ses applications
// (voir referentGereApplication).
const PERMISSIONS = {
  'habilitation:lire': ['admin', 'controleur', 'referent', 'utilisateur'],
  'habilitation:creer': ['admin', 'referent', 'utilisateur'],
  'habilitation:valider': ['admin', 'referent'],
  'habilitation:executer': ['admin', 'referent'],
  'habilitation:revoquer': ['admin', 'referent'],
  'habilitation:suivre': ['admin', 'referent', 'controleur'],
  'preuve:ajouter': ['admin', 'referent', 'utilisateur'],
  'preuve:lire': ['admin', 'controleur', 'referent', 'utilisateur'],
  'export:audit': ['admin', 'controleur'],
  'audit:lire': ['admin', 'controleur'],
  'admin:gerer': ['admin'],
};

export const ACTIONS = Object.freeze(Object.keys(PERMISSIONS));

/** Le rôle `role` a-t-il le droit d'effectuer `action` ? */
export function peut(role, action) {
  if (!Object.hasOwn(PERMISSIONS, action)) return false;
  return PERMISSIONS[action].includes(role);
}

/** Middleware Express : exige une session authentifiée. */
export function exigerAuth(req, res, next) {
  if (!req.session?.utilisateur) return res.redirect('/connexion');
  next();
}

/** Middleware Express : exige le droit d'effectuer `action`. */
export function exigerDroit(action) {
  return (req, res, next) => {
    const role = req.session?.utilisateur?.role;
    if (!role) return res.redirect('/connexion');
    if (!peut(role, action)) {
      return res.status(403).type('html').send(
        `<!doctype html><meta charset="utf-8"><title>403</title>
         <p>Accès refusé : votre rôle ne permet pas cette action.</p><p><a href="/">Retour</a></p>`,
      );
    }
    next();
  };
}

/**
 * Le référent gère-t-il cette application ? L'admin gère tout. Un référent dont le
 * périmètre vaut 'ALL' (cas LDAP sans périmètre fin) gère également tout.
 */
export function referentGereApplication(utilisateur, applicationId) {
  if (!utilisateur) return false;
  if (utilisateur.role === 'admin') return true;
  if (utilisateur.role !== 'referent') return false;
  const portee = utilisateur.referentApps;
  if (portee === 'ALL') return true;
  return Array.isArray(portee) && portee.map(Number).includes(Number(applicationId));
}

/**
 * Déduit le rôle à partir des groupes de l'annuaire. Premier correspondant gagne,
 * par priorité décroissante. `mapping` = { admin, controleur, referent, utilisateur }
 * (fragments de noms de groupes, comparaison insensible à la casse).
 */
export function roleDepuisGroupes(groupes, mapping) {
  const possede = (nom) =>
    Boolean(nom) && groupes.some((g) => String(g).toLowerCase().includes(nom.toLowerCase()));
  if (possede(mapping.admin)) return 'admin';
  if (possede(mapping.controleur)) return 'controleur';
  if (possede(mapping.referent)) return 'referent';
  if (possede(mapping.utilisateur)) return 'utilisateur';
  return null;
}
