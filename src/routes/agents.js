// Recherche d'un agent et de ses accès.

import { exigerAuth, exigerDroit } from '../roles.js';
import { rechercherAgents, libelleUfs } from '../habilitations.js';
import { echap, ICONES, page, tag } from '../ui.js';

export function monter(app) {
  app.get('/recherche', exigerAuth, exigerDroit('habilitation:lire'), (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    let resultats;
    if (q.trim()) {
      const agents = rechercherAgents(q);
      resultats = agents.length
        ? agents.map((a) => `<div class="groupe-agent">
              <div class="entete-a"><h3>${echap(a.nom)} ${echap(a.prenom)}</h3><span class="matricule micro">${echap(a.matricule)}</span></div>
              <table><caption>Accès déjà détenus par cet agent</caption><thead><tr><th scope="col">Application</th><th scope="col">Profil</th><th scope="col">UF</th><th scope="col">Statut</th><th scope="col">Demande</th><th scope="col">Réalisation</th><th scope="col">Preuves</th><th scope="col"></th></tr></thead>
              <tbody>${a.habilitations.map((h) => `<tr>
                <td>${echap(h.app_libelle)}</td><td>${echap(h.role)}</td>
                <td class="mono">${echap(libelleUfs(h) || '-')}</td>
                <td>${tag(h.statut)}</td><td class="mono">${echap(h.date_demande ?? '')}</td>
                <td class="mono">${echap(h.date_realisation ?? '')}</td>
                <td class="mono">${h.nb_preuves}</td>
                <td><a href="/habilitations/${h.id}">Ouvrir</a></td></tr>`).join('')
                || '<tr><td colspan="8" style="color:var(--encre-3)">Aucune habilitation.</td></tr>'}</tbody></table>
            </div>`).join('')
        : `<div class="vide">Aucun agent ne correspond à « ${echap(q)} ».</div>`;
    } else {
      resultats = '<div class="vide">Saisissez un matricule, un nom ou un prénom.</div>';
    }
    res.send(
      page(req, 'Rechercher un agent',
        `<form method="get" class="carte" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:240px"><label for="q">Matricule, nom ou prénom</label>
            <input id="q" name="q" value="${echap(q)}" autofocus placeholder="ex. E12345 ou Durand"></div>
          <button class="btn btn-primary" type="submit">${ICONES.loupe}Rechercher</button>
        </form><section>${resultats}</section>`),
    );
  });
}
