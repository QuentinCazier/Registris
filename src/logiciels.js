// Bibliothèque indicative des logiciels rencontrés en établissement de santé, rangés par fonction.
// Sans logos (ce sont des marques) et sans prétention à l'exhaustivité : elle se corrige par contribution.

export const VERSION_BIBLIOTHEQUE = '2026-09';

export const BIBLIOTHEQUE = Object.freeze([
  {
    code: 'IDENTITE',
    libelle: 'Identité, mouvements et facturation',
    description: "Le cœur administratif : identité du patient, venues, mouvements, facturation et recouvrement.",
    produits: [
      { code: 'SILLAGE', nom: 'Sillage', editeur: 'SIB' },
      { code: 'DXCARE', nom: 'DxCare', editeur: 'Dedalus' },
      { code: 'ORBIS', nom: 'Orbis', editeur: 'Dedalus' },
      { code: 'CROSSWAY', nom: 'Crossway', editeur: 'Maincare' },
      { code: 'HOPITAL-MANAGER', nom: 'Hôpital Manager', editeur: 'Softway Medical' },
      { code: 'EASILY', nom: 'Easily' },
      { code: 'MILLENIUM', nom: 'Millenium', editeur: 'Oracle Health' },
    ],
  },
  {
    code: 'DPI',
    libelle: 'Dossier patient informatisé',
    description: "Le dossier de soins : observations, prescriptions, comptes rendus. Souvent la même suite que l'administratif.",
    produits: [
      { code: 'SILLAGE-DPI', nom: 'Sillage, dossier de soins', editeur: 'SIB' },
      { code: 'DXCARE-DPI', nom: 'DxCare, dossier de soins', editeur: 'Dedalus' },
      { code: 'ORBIS-DPI', nom: 'Orbis, dossier de soins', editeur: 'Dedalus' },
      { code: 'EASILY-DPI', nom: 'Easily, dossier de soins' },
      { code: 'MEDIBOARD', nom: 'Mediboard', editeur: 'logiciel libre' },
    ],
  },
  {
    code: 'PHARMACIE',
    libelle: 'Prescription et pharmacie',
    description: 'Circuit du médicament : prescription, dispensation, gestion des stocks de la PUI.',
    produits: [
      { code: 'PHARMA', nom: 'Pharma', editeur: 'Computer Engineering' },
      { code: 'COPILOTE', nom: 'Copilote' },
      { code: 'PHEDRA', nom: 'Phedra' },
    ],
  },
  {
    code: 'IMAGERIE',
    libelle: 'Imagerie : RIS et PACS',
    description: "Demandes d'examens, comptes rendus, stockage et diffusion des images.",
    produits: [
      { code: 'XPLORE', nom: 'Xplore', editeur: 'EDL' },
      { code: 'TELEMIS', nom: 'Telemis' },
      { code: 'CARESTREAM', nom: 'Carestream' },
      { code: 'SYNGO', nom: 'Syngo', editeur: 'Siemens Healthineers' },
      { code: 'AGFA-EI', nom: 'Enterprise Imaging', editeur: 'Agfa' },
    ],
  },
  {
    code: 'LABORATOIRE',
    libelle: 'Laboratoire',
    description: "Système de gestion de laboratoire : demandes, automates, validation biologique, résultats.",
    produits: [
      { code: 'GLIMS', nom: 'GLIMS', editeur: 'Clinisys' },
      { code: 'MOLIS', nom: 'Molis', editeur: 'Clinisys' },
      { code: 'TDNEXLABS', nom: 'TDNexLabs', editeur: 'Technidata' },
      { code: 'DXLAB', nom: 'DxLab', editeur: 'Dedalus' },
    ],
  },
  {
    code: 'BLOC-URGENCES',
    libelle: 'Bloc opératoire et urgences',
    description: "Programmation du bloc et passage aux urgences. Souvent des modules du dossier patient plutôt que des produits à part.",
    produits: [
      { code: 'RESURGENCES', nom: 'Résurgences' },
      { code: 'OPESIM', nom: 'Module bloc du dossier patient' },
    ],
  },
  {
    code: 'GEF',
    libelle: 'Gestion économique et financière',
    description: 'Achats, commandes, liquidation, comptabilité, immobilisations.',
    produits: [
      { code: 'CPAGE-GEF', nom: 'CPage-i, gestion financière', editeur: 'GIP CPage' },
      { code: 'MAGH2', nom: 'Magh2', editeur: 'SIB' },
    ],
  },
  {
    code: 'RH',
    libelle: 'Ressources humaines et temps de travail',
    description: 'Paie, carrière, plannings, gestion du temps.',
    produits: [
      { code: 'CPAGE-RH', nom: 'CPage-i, ressources humaines', editeur: 'GIP CPage' },
      { code: 'AGIRH', nom: 'AGIRH' },
      { code: 'OCTIME', nom: 'Octime', editeur: 'Octime' },
      { code: 'E-TEMPTATION', nom: 'e-Temptation', editeur: 'Horoquartz' },
      { code: 'CHRONOS', nom: 'Chronos' },
    ],
  },
  {
    code: 'PILOTAGE',
    libelle: 'Pilotage, PMSI et décisionnel',
    description: "Codage, transmission des données d'activité, tableaux de bord de gestion.",
    produits: [
      { code: 'EPMSI', nom: 'e-PMSI', editeur: 'ATIH' },
      { code: 'PMSI-PILOT', nom: 'Outil de codage et de contrôle PMSI' },
      { code: 'DECISIONNEL', nom: "Entrepôt décisionnel de l'établissement" },
    ],
  },
  {
    code: 'DOCUMENTAIRE',
    libelle: 'Documentation, qualité et gestion des risques',
    description: 'Gestion documentaire, procédures, événements indésirables, démarche qualité.',
    produits: [
      { code: 'ENNOV', nom: 'Ennov', editeur: 'Ennov' },
      { code: 'AGEVAL', nom: 'AGEVAL' },
      { code: 'BLUEKANGO', nom: 'BlueKanGo' },
    ],
  },
  {
    code: 'SOCLE',
    libelle: 'Socle technique et accès',
    description: "Ce qui n'est pas un logiciel métier mais donne quand même des droits, et qu'un audit regarde en premier.",
    produits: [
      { code: 'AD', nom: 'Annuaire Active Directory' },
      { code: 'VPN', nom: 'Accès distant (VPN)' },
      { code: 'MESSAGERIE', nom: 'Messagerie interne' },
      { code: 'MSSANTE', nom: 'MSSanté' },
      { code: 'GED-BUREAUTIQUE', nom: 'Partages de fichiers' },
    ],
  },
]);

export const fonctionParCode = (code) => BIBLIOTHEQUE.find((f) => f.code === code) ?? null;

// Aplatit la bibliothèque : chaque produit porte la fonction dont il relève.
export function produits() {
  return BIBLIOTHEQUE.flatMap((f) => f.produits.map((p) => ({ ...p, fonction: f.code, fonctionLibelle: f.libelle })));
}

export const produitParCode = (code) => produits().find((p) => p.code === code) ?? null;
