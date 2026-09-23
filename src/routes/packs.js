// Packs « nouvel arrivant ».

import { exigerAuth, exigerDroit } from '../roles.js';
import { listerUfs, listerSites, appliquerPack } from '../habilitations.js';
import { listerPacks, packParId } from '../administration.js';
import { notifier } from '../mailer.js';
import { echap, ICONES, page, pageErreur, tag, bandeauOk, pluriel } from '../ui.js';
import { nombre } from './outils.js';

export function monter(app) {
  app.get('/packs', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const packs = listerPacks();
    res.send(
      page(req, 'Nouvel arrivant',
        `<p class="aide">Un pack regroupe les accès habituels d'un poste. Toutes les demandes sont déposées d'un coup pour l'agent qui arrive.</p>
        ${packs.length ? `<div class="cat-grid">${packs.map((p) => `<div class="srv"><span class="ico">${ICONES.pack}</span>
            <div class="n">${echap(p.nom)}</div><div class="c">${p.nb} accès${p.description ? ' · ' + echap(p.description) : ''}</div>
            <div class="b"><a class="btn btn-primary btn-petit" href="/packs/${p.id}/appliquer">Préparer les accès</a></div></div>`).join('')}</div>`
          : '<div class="vide">Aucun pack défini. Un administrateur peut en créer dans Administration, Packs nouvel arrivant.</div>'}`),
    );
  });

  app.get('/packs/:id/appliquer', exigerAuth, exigerDroit('habilitation:creer'), (req, res) => {
    const p = packParId(nombre(req.params.id));
    if (!p || !p.actif) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pack introuvable.', '/packs'));
    const sites = listerSites().map((s) => `<option value="${s.id}">${echap(s.nom)}</option>`).join('');
    const ufs = listerUfs().map((f) => `<option value="${f.id}">${echap(f.code)} · ${echap(f.libelle)}</option>`).join('');
    res.send(
      page(req, `Pack : ${p.nom}`,
        `<div class="deux-col">
          <section style="margin-top:0"><h2>Accès inclus (${p.elements.length})</h2>
            <div class="carte"><ul style="margin:0;padding-left:18px;line-height:1.9">${p.elements.map((e) => `<li>${echap(e.app_libelle)} <span style="color:var(--encre-3)">· ${echap(e.role || p.nom)}</span></li>`).join('') || '<li>Aucun élément.</li>'}</ul></div>
          </section>
          <section style="margin-top:0"><h2>Bénéficiaire</h2>
            <form method="post" action="/packs/${p.id}/appliquer" class="carte">
              <div class="grille2">
                <div><label for="matricule">Matricule</label><input id="matricule" name="matricule" required maxlength="40"></div>
                <div><label for="email">Courriel <span class="opt">(facultatif)</span></label><input id="email" name="email" type="email" maxlength="200"></div>
                <div><label for="nom">Nom</label><input id="nom" name="nom" required maxlength="100"></div>
                <div><label for="prenom">Prénom</label><input id="prenom" name="prenom" maxlength="100"></div>
              </div>
              <div class="grille2">
                <div><label for="ufIds">UF <span class="opt">(référentiel)</span></label><select id="ufIds" name="ufIds" multiple size="4">${ufs || '<option disabled>Aucune UF déclarée</option>'}</select></div>
                <div><label for="uf_libre">Autres UF</label><input id="uf_libre" name="uf_libre" maxlength="200">
                  <label for="siteId">Site</label><select id="siteId" name="siteId"><option value="">Non précisé</option>${sites}</select></div>
              </div>
              <div class="actions"><button class="btn btn-primary" type="submit">${ICONES.pack}Déposer les ${p.elements.length} demandes</button>
                <a class="btn btn-ghost" href="/packs">Annuler</a></div>
            </form>
          </section>
        </div>
        <script nonce="${req.nonce}">(function(){var mat=document.getElementById('matricule'),nom=document.getElementById('nom'),prenom=document.getElementById('prenom'),mail=document.getElementById('email');
          mat.addEventListener('blur',function(){if(!mat.value)return;fetch('/api/agent?matricule='+encodeURIComponent(mat.value)).then(function(r){return r.json();})
            .then(function(d){if(d&&d.trouve){if(!nom.value)nom.value=d.nom||'';if(!prenom.value)prenom.value=d.prenom||'';if(!mail.value)mail.value=d.email||'';}}).catch(function(){});});})();</script>`),
    );
  });

  app.post('/packs/:id/appliquer', exigerAuth, exigerDroit('habilitation:creer'), async (req, res) => {
    const p = packParId(nombre(req.params.id));
    if (!p || !p.actif) return res.status(404).send(pageErreur(req, 'Introuvable', 'Pack introuvable.', '/packs'));
    const b = req.body;
    const u = req.session.utilisateur;
    let creees;
    try {
      creees = appliquerPack(u.login, p, {
        agent: { matricule: b.matricule, nom: b.nom, prenom: b.prenom, email: b.email },
        siteId: nombre(b.siteId) || null,
        ufIds: [].concat(b.ufIds ?? []).map(nombre).filter(Boolean),
        ufLibre: b.uf_libre,
        demandeur: `${u.matricule ? u.matricule + ' ' : ''}${u.nom}`.trim(),
      });
    } catch (e) {
      return res.status(400).send(pageErreur(req, 'Pack non appliqué', e.message, `/packs/${p.id}/appliquer`));
    }
    const resume = `Pack « ${p.nom} » appliqué pour ${b.nom} ${b.prenom ?? ''} (matricule ${b.matricule}) par ${u.nom} : ${creees.map((h) => h.app_libelle).join(', ')}.`;
    await notifier({ to: [...new Set([p.destinataire, b.email].filter(Boolean))], sujet: `Nouvel arrivant : pack ${p.nom}`, texte: resume });
    res.send(
      page(req, 'Demandes déposées',
        `${bandeauOk(`${pluriel(creees.length, 'demande')} ${creees.length >= 2 ? 'déposées' : 'déposée'} pour ${b.nom} ${b.prenom ?? ''} via le pack « ${p.nom} ».`)}
        <table><caption>Demandes déposées</caption><thead><tr><th scope="col">N°</th><th scope="col">Application</th><th scope="col">Profil</th><th scope="col">Statut</th><th scope="col"></th></tr></thead><tbody>${creees.map((h) =>
          `<tr><td class="mono">${h.id}</td><td>${echap(h.app_libelle)}</td><td>${echap(h.role)}</td><td>${tag(h.statut)}</td><td><a href="/habilitations/${h.id}">Ouvrir</a></td></tr>`).join('')}</tbody></table>`,
        `<a class="btn btn-ghost" href="/packs">Retour aux packs</a>`),
    );
  });
}
