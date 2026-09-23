// Rôles et permissions.

export const ROLES = ['admin', 'referent', 'controleur', 'utilisateur'];

export const LIBELLES_ROLE = {
  admin: 'Administrateur',
  referent: 'Référent applicatif',
  controleur: 'Contrôleur',
  utilisateur: 'Utilisateur',
};

// action -> rôles autorisés ; le référent est en outre limité à ses applications.
const PERMISSIONS = {
  // Lire le registre entier, c'est voir qui détient quel accès : pas un agent.
  'habilitation:lire': ['admin', 'controleur', 'referent'],
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

export function peut(role, action) {
  if (!Object.hasOwn(PERMISSIONS, action)) return false;
  return PERMISSIONS[action].includes(role);
}

export function exigerAuth(req, res, next) {
  if (!req.session?.utilisateur) return res.redirect('/connexion');
  next();
}

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

// Un périmètre 'ALL' vaut toutes les applications : cas d'un LDAP sans périmètre fin.
export function referentGereApplication(utilisateur, applicationId) {
  if (!utilisateur) return false;
  if (utilisateur.role === 'admin') return true;
  if (utilisateur.role !== 'referent') return false;
  const portee = utilisateur.referentApps;
  if (portee === 'ALL') return true;
  return Array.isArray(portee) && portee.map(Number).includes(Number(applicationId));
}

// Nom du groupe (CN) tiré d'un DN, sinon la valeur telle quelle, en minuscules.
const nomDeGroupe = (g) => {
  const s = String(g ?? '').trim();
  const m = /^cn=([^,]+)/i.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
};

// mapping = nom exact (CN) ou DN de groupe par rôle, insensible à la casse ; le rôle le plus élevé gagne.
export function roleDepuisGroupes(groupes, mapping) {
  const noms = new Set();
  for (const g of groupes) {
    noms.add(String(g ?? '').trim().toLowerCase());
    noms.add(nomDeGroupe(g));
  }
  const possede = (voulu) => Boolean(voulu) && (noms.has(voulu.trim().toLowerCase()) || noms.has(nomDeGroupe(voulu)));
  if (possede(mapping.admin)) return 'admin';
  if (possede(mapping.controleur)) return 'controleur';
  if (possede(mapping.referent)) return 'referent';
  if (possede(mapping.utilisateur)) return 'utilisateur';
  return null;
}
