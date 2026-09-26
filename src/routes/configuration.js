// Configuration en vigueur, secrets masqués, et contrôle de l'annuaire, de la messagerie et du certificat.

import { config } from '../config.js';
import { exigerAuth, exigerDroit } from '../roles.js';
import { verifierConfiguration } from '../verification.js';
import { echap, page } from '../ui.js';

const oui = (v) => (v ? 'oui' : 'non');
const secret = (v) => (v ? 'renseigné' : 'vide');

/** @returns {Array<[string, Array<Array<string>>]>} */
function sections() {
  const { ldap, smtp, tls } = config;
  return [
    ['Établissement', [
      ['Nom affiché', config.etablissement || '-', 'NOM_ETABLISSEMENT'],
      ['Couleur', config.couleurAccent, 'COULEUR_ACCENT'],
      ["Adresse de l'application", config.urlPublique || '-', 'APP_URL'],
    ]],
    ['Réseau et HTTPS', [
      ['Écoute', `${config.hote}:${config.port}`, 'HOTE, PORT'],
      ['HTTPS direct', tls.actif ? (tls.pfx ? `certificat PFX ${tls.pfx}` : `certificat ${tls.cert}`) : 'non, derrière un reverse-proxy', 'TLS_PFX ou TLS_CERT et TLS_KEY'],
      ['Cookie sécurisé', oui(config.secureCookie), 'SECURE_COOKIE'],
    ]],
    ['Authentification', [
      ['Mode', config.authMode === 'ldap' ? 'Active Directory' : 'comptes locaux', 'AUTH_MODE'],
      ...(config.authMode === 'ldap' ? [
        ['Serveur', ldap.url, 'LDAP_URL'],
        ['Base de recherche', ldap.searchBase, 'LDAP_SEARCH_BASE'],
        ['Compte de service', ldap.bindDN || 'aucun, bind direct', 'LDAP_BIND_DN'],
        ['Mot de passe du compte de service', secret(ldap.bindPassword), 'LDAP_BIND_PASSWORD'],
        ['Attribut de connexion', ldap.loginAttr, 'LDAP_LOGIN_ATTR'],
        ["Certificat de l'autorité", ldap.caCert || 'celui du système', 'LDAP_CA_CERT'],
        ['Groupes imbriqués', oui(ldap.groupesImbriques), 'LDAP_GROUPES_IMBRIQUES'],
        ['Groupe des administrateurs', ldap.groupes.admin || '-', 'LDAP_GROUPE_ADMIN'],
        ['Groupe des référents', ldap.groupes.referent || '-', 'LDAP_GROUPE_REFERENT'],
        ['Groupe des contrôleurs', ldap.groupes.controleur || '-', 'LDAP_GROUPE_CONTROLEUR'],
        ['Groupe des utilisateurs', ldap.groupes.utilisateur || '-', 'LDAP_GROUPE_UTILISATEUR'],
      ] : []),
    ]],
    ['Courriels', [
      ['Relais SMTP', smtp.actif ? `${smtp.host}:${smtp.port}${smtp.secure ? ', TLS' : ''}` : 'désactivé', 'SMTP_HOST, SMTP_PORT'],
      ['Expéditeur', smtp.from, 'SMTP_FROM'],
      ['Compte', smtp.user ? `${smtp.user}, mot de passe ${secret(smtp.password)}` : 'aucun', 'SMTP_USER'],
    ]],
    ['Fonctionnement', [
      ['Relance après', `${config.relanceJours} jours`, 'RELANCE_JOURS'],
      ['Entretien horaire par le serveur', oui(config.entretienAuto), 'ENTRETIEN_AUTO'],
      ['Conservation après clôture', `${config.conservationAnnees} ans`, 'CONSERVATION_ANNEES'],
      ['Base de données', config.dbPath, 'DB_PATH'],
      ['Pièces justificatives', config.preuvesDir, 'PREUVES_DIR'],
      ['Sauvegardes', config.sauvegardesDir, 'SAUVEGARDES_DIR'],
    ]],
  ];
}

const PASTILLE = { ok: 'p-fait', attention: 'p-attente', echec: 'p-anomalie' };
const MOT = { ok: 'correct', attention: 'à regarder', echec: 'en échec' };

export function monter(app) {
  app.get('/admin/configuration', exigerAuth, exigerDroit('admin:gerer'), async (req, res) => {
    const tester = req.query.tester === '1';
    const resultats = tester ? await verifierConfiguration() : [];
    const echecs = resultats.filter((r) => r.statut === 'echec').length;
    res.send(
      page(req, 'Configuration',
        `<p class="aide">Réglages lus au démarrage dans <b>${echap(config.fichierConfig || "les variables d'environnement")}</b>.
          Sous Windows, pour les changer, relancez l'installateur et choisissez « Modifier la configuration » : il réécrit le fichier et redémarre le service.
          Ailleurs, modifiez ce fichier puis redémarrez le service.</p>
        <div class="actions-ligne"><a class="btn btn-primary" href="/admin/configuration?tester=1">Tester l'annuaire, la messagerie et le certificat</a></div>
        ${tester
          ? `<div class="bloc"><div class="bloc-tete"><h2>Résultat des tests</h2><span class="c">${echecs ? `${echecs} en échec` : 'aucun échec'}</span></div>
              <table><caption>Résultat du contrôle de la configuration</caption><thead><tr><th scope="col">Domaine</th><th scope="col">Contrôle</th><th scope="col">État</th><th scope="col">Détail</th></tr></thead>
              <tbody>${resultats.map((r) => `<tr><td>${echap(r.domaine)}</td><td>${echap(r.etape)}</td>
                <td><span class="puce ${PASTILLE[r.statut]}">${MOT[r.statut]}</span></td><td>${echap(r.detail)}</td></tr>`).join('')}</tbody></table></div>`
          : ''}
        ${sections().map(([titre, lignes]) => `<div class="bloc"><div class="bloc-tete"><h2>${titre}</h2></div>
            <table><caption>${titre}</caption><thead><tr><th scope="col">Réglage</th><th scope="col">Valeur</th><th scope="col">Clé du fichier</th></tr></thead>
            <tbody>${lignes.map(([l, v, cle]) => `<tr><td>${echap(l)}</td><td>${echap(v)}</td><td><code>${echap(cle)}</code></td></tr>`).join('')}</tbody></table></div>`).join('')}`),
    );
  });
}
