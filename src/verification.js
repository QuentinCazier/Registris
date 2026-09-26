// Contrôle de la configuration sans compte utilisateur : lancé par l'installateur, la ligne de commande
// (« registris verifier-config ») et la page d'administration. Rien n'est écrit.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

import { config, verifierPourProduction, optionsTls } from './config.js';
import { annuaire } from './annuaire.js';
import { verifierSmtp } from './mailer.js';
import { expliquerErreurLdap } from './auth.js';

const LIBELLES = { admin: 'administrateurs', controleur: 'contrôleurs', referent: 'référents', utilisateur: 'utilisateurs' };
const dateFr = (d) => d.toISOString().slice(0, 10).split('-').reverse().join('/');

function certificatServeur() {
  const options = optionsTls();
  const contexte = tls.createSecureContext(options);
  const der = contexte.context.getCertificate();
  return der ? new crypto.X509Certificate(der) : null;
}

function inscriptible(dossier) {
  try {
    fs.mkdirSync(dossier, { recursive: true });
    const essai = path.join(dossier, `.essai-${process.pid}`);
    fs.writeFileSync(essai, 'x');
    fs.rmSync(essai);
    return true;
  } catch {
    return false;
  }
}

// [{ domaine, etape, statut: 'ok' | 'attention' | 'echec', detail }]
export async function verifierConfiguration() {
  const r = [];
  const noter = (domaine, etape, statut, detail = '') => r.push({ domaine, etape, statut, detail });

  try {
    const avertissements = verifierPourProduction({ production: false });
    noter('Général', 'Configuration lisible', 'ok', config.fichierConfig || 'variables d’environnement');
    for (const a of avertissements) noter('Général', 'Avertissement', 'attention', a);
  } catch (e) {
    noter('Général', 'Configuration', 'echec', e.message);
  }

  for (const [nom, dossier] of [['Base de données', path.dirname(config.dbPath)], ['Pièces justificatives', config.preuvesDir], ['Sauvegardes', config.sauvegardesDir]]) {
    noter('Données', nom, inscriptible(dossier) ? 'ok' : 'echec', dossier);
  }

  if (config.tls.actif) {
    try {
      const c = certificatServeur();
      const fin = c ? new Date(c.validTo) : null;
      const jours = fin ? Math.floor((fin.getTime() - Date.now()) / 86400000) : null;
      const sujet = c ? (c.subjectAltName || c.subject).replace(/\n/g, ', ') : '';
      noter('HTTPS', 'Certificat du serveur', jours !== null && jours < 0 ? 'echec' : jours !== null && jours < 30 ? 'attention' : 'ok',
        c ? `${sujet}, valable jusqu'au ${dateFr(fin)}${c.issuer === c.subject ? ' ; auto-signé : le navigateur avertira' : ''}` : 'lu');
    } catch (e) {
      noter('HTTPS', 'Certificat du serveur', 'echec', `illisible : ${e.message}`);
    }
  } else {
    noter('HTTPS', 'Certificat du serveur', 'attention', 'aucun : l’application doit être derrière un reverse-proxy HTTPS');
  }

  if (config.authMode === 'ldap') {
    if (!config.ldap.bindDN) {
      noter('Annuaire', 'Compte de service', 'attention', 'aucun (bind direct) : à tester avec « registris tester-ldap <identifiant> »');
    } else {
      try {
        const etat = await annuaire.verifierCompteService();
        noter('Annuaire', 'Connexion du compte de service', 'ok', `${config.ldap.url}, ${config.ldap.bindDN}`);
        noter('Annuaire', 'Base de recherche', etat.base ? 'ok' : 'echec', config.ldap.searchBase);
        for (const [role, trouve] of Object.entries(etat.groupes)) {
          const nom = config.ldap.groupes[role];
          noter('Annuaire', `Groupe des ${LIBELLES[role] ?? role}`, trouve ? 'ok' : 'echec', trouve ? nom : `« ${nom} » introuvable sous la base de recherche`);
        }
        if (!Object.values(config.ldap.groupes).some(Boolean)) noter('Annuaire', 'Groupes de rôles', 'echec', 'aucun groupe déclaré : personne ne pourrait se connecter');
      } catch (e) {
        const raison = expliquerErreurLdap(e.message);
        noter('Annuaire', 'Connexion du compte de service', 'echec', raison ? `${raison} pour ${config.ldap.bindDN}` : e.message);
      }
    }
  } else {
    noter('Annuaire', 'Authentification', 'attention', 'comptes locaux : pour démarrer ou tester, l’Active Directory est conseillé en production');
  }

  if (config.smtp.actif) {
    try {
      await verifierSmtp();
      noter('Courriels', 'Relais SMTP', 'ok', `${config.smtp.host}:${config.smtp.port}, expéditeur ${config.smtp.from}`);
    } catch (e) {
      noter('Courriels', 'Relais SMTP', 'echec', `${config.smtp.host}:${config.smtp.port} : ${e.message}`);
    }
  } else {
    noter('Courriels', 'Relais SMTP', 'attention', 'désactivé : aucune notification ne partira');
  }

  noter('Conservation', 'Durée', 'ok', `${config.conservationAnnees} an${config.conservationAnnees >= 2 ? 's' : ''} après la clôture du dernier accès`);
  return r;
}
