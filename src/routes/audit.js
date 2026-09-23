// Audit : dossier de preuves, coffre, journal.

import { exigerAuth, exigerDroit } from '../roles.js';
import { auditerCoffre } from '../preuves.js';
import { genererDossierZip, analyserMatricules } from '../export-audit.js';
import {
  journal, etatChaine, verifierChaine, verifierAncrages, tracer, dernierControle, enregistrerControle,
} from '../audit.js';
import { echap, ICONES, page, pageErreur, bandeauErreur, bandeauOk, libelleAction, pluriel } from '../ui.js';

export function monter(app) {
  app.get('/export', exigerAuth, exigerDroit('export:audit'), (req, res) => {
    res.send(
      page(req, 'Dossier de preuves',
        `<div class="carte" style="max-width:680px">
          <p class="aide">Collez la liste des matricules échantillonnés par l'auditeur. Vous obtenez un ZIP contenant
            une synthèse imprimable, un tableau CSV, le manifeste des empreintes et toutes les pièces classées par matricule.</p>
          <form method="post" action="/export">
            <label for="matricules">Matricules <span class="opt">(un par ligne, ou séparés par virgule ou espace)</span></label>
            <textarea id="matricules" name="matricules" rows="8" required class="mono" placeholder="E12345&#10;E22222&#10;E33333"></textarea>
            <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.coffre}Générer le dossier ZIP</button></div>
          </form>
        </div>`),
    );
  });
  app.post('/export', exigerAuth, exigerDroit('export:audit'), (req, res) => {
    const matricules = analyserMatricules(req.body.matricules);
    if (!matricules.length || matricules.length > 500) {
      return res.status(400).send(pageErreur(req, 'Export impossible', 'Saisissez entre 1 et 500 matricules.', '/export'));
    }
    const nom = `dossier-preuves-habilitations-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    genererDossierZip(req.session.utilisateur.login, matricules.join('\n'), res);
  });

  app.get('/coffre', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const r = auditerCoffre();
    res.send(
      page(req, 'Intégrité du coffre',
        `${r.anomalies.length ? bandeauErreur(`${pluriel(r.anomalies.length, 'pièce')} ${r.anomalies.length >= 2 ? 'altérées ou manquantes' : 'altérée ou manquante'} sur ${r.total}.`) : bandeauOk(`${r.total} pièce(s) vérifiée(s), toutes intègres.`)}
        ${r.anomalies.length ? `<table><caption>Pièces du coffre et état de leur empreinte</caption><thead><tr><th scope="col">Habilitation</th><th scope="col">Fichier</th><th scope="col">Empreinte attendue</th><th scope="col">Constat</th></tr></thead><tbody>${r.anomalies.map((p) =>
          `<tr><td><a href="/habilitations/${p.habilitation_id}">n°${p.habilitation_id}</a></td><td>${echap(p.nom_origine)}</td><td><code class="hash">${p.sha256.slice(0, 20)}…</code></td><td>${echap(p.raison)}</td></tr>`).join('')}</tbody></table>` : ''}
        <p class="champ-aide">Chaque pièce est ré-empreintée (SHA-256) et comparée à l'empreinte enregistrée lors du dépôt.</p>`),
    );
  });

  app.get('/audit', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    const chaine = etatChaine();
    const controle = dernierControle();
    const ancr = verifierAncrages();
    const bandeauAncrage = !ancr.valide
      ? bandeauErreur(`${pluriel(ancr.anomalies.length, 'anomalie')} d'ancrage : ${ancr.anomalies.map((a) => a.raison).join(' ; ')}`)
      : ancr.dernier
        ? bandeauOk(`Dernier ancrage le ${echap(ancr.dernier.horodatage.slice(0, 19).replace('T', ' '))} UTC (${pluriel(ancr.ancrages, 'ancrage')}, tous cohérents avec la chaîne).`)
        : `<p class="champ-aide">Aucun ancrage enregistré : lancez <code>registris ancrer</code> régulièrement pour déposer l'empreinte de tête hors de la base.</p>`;
    const lignes = journal({ limite: 300, q }).map((j) =>
      `<tr><td class="mono">${echap(j.horodatage.slice(0, 19).replace('T', ' '))}</td><td>${echap(j.acteur)}</td>
        <td>${libelleAction(j.action)}<div class="mono" style="font-size:11px;color:var(--encre-3)">${echap(j.action)}</div></td>
        <td class="mono">${j.entite === 'habilitation' && j.entite_id ? `<a href="/habilitations/${j.entite_id}">habilitation n°${j.entite_id}</a>` : echap(`${j.entite ?? ''} ${j.entite_id ?? ''}`)}</td>
        <td style="font-size:12px;color:var(--encre-2)">${echap(j.details ?? '')}</td></tr>`).join('');
    res.send(
      page(req, "Journal d'audit",
        `${chaine.valide
          ? bandeauOk(`Chaîne d'audit intègre : ${pluriel(chaine.entrees, 'entrée')} ${chaine.entrees >= 2 ? 'scellées' : 'scellée'}.`
              + (chaine.complet ? ' Contrôle complet.'
                : controle ? ` Reprise du contrôle complet du ${controle.verifie_le.slice(0, 10)}, ${pluriel(chaine.nouvelles ?? 0, 'écriture')} depuis.` : ''))
          : bandeauErreur(`Rupture détectée à l'entrée n°${chaine.rupture} (${chaine.raison}). Le journal a été altéré après coup.`)}
        <form method="post" action="/audit/controle" class="ligne-motif" style="margin:10px 0 16px">
          <input type="hidden" name="q" value="${echap(q)}">
          <span class="champ-aide" style="margin:0">${chaine.complet
            ? "Aucun contrôle complet n'est enregistré : cette page recalcule donc tout le journal à chaque affichage."
            : 'La page repart du dernier contrôle complet pour rester rapide sur un gros journal.'}
            À planifier avec <code>registris verifier</code>.</span>
          <button class="btn btn-petit">Contrôle complet maintenant</button>
        </form>
        ${bandeauAncrage}
        <form method="get" class="filtres"><div style="flex:1"><label for="q">Filtrer</label><input id="q" name="q" value="${echap(q)}" placeholder="acteur, action, matricule…"></div>
          <button class="btn btn-ghost" type="submit">Filtrer</button></form>
        <table><caption>Journal d'audit, des plus récentes aux plus anciennes</caption><thead><tr><th scope="col">Horodatage (UTC)</th><th scope="col">Acteur</th><th scope="col">Action</th><th scope="col">Cible</th><th scope="col">Détail</th></tr></thead>
          <tbody>${lignes || '<tr><td colspan="5" style="color:var(--encre-3)">Aucune entrée.</td></tr>'}</tbody></table>
        <p class="champ-aide">300 dernières entrées. Chaque entrée scelle la précédente par son empreinte : rien ne peut être modifié ou supprimé discrètement.</p>`,
        '', { large: true }),
    );
  });

  app.post('/audit/controle', exigerAuth, exigerDroit('audit:lire'), (req, res) => {
    const resultat = verifierChaine();
    enregistrerControle(req.session.utilisateur.login, resultat);
    tracer(req.session.utilisateur.login, 'audit:controler', {
      details: { valide: resultat.valide, entrees: resultat.entrees ?? 0, ...(resultat.valide ? {} : { rupture: resultat.rupture }) },
    });
    const q = String(req.body.q ?? '').slice(0, 100);
    res.redirect(q ? `/audit?q=${encodeURIComponent(q)}` : '/audit');
  });
}
