/**
 * Ce qui se vérifie mécaniquement dans le HTML et la feuille de style, sur les
 * pages réelles. Un audit RGAA reste nécessaire : le parcours au lecteur
 * d'écran, notamment, demande un contrôle humain.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PNG } from './_env.js';

const { initialiserSchema } = await import('../src/db.js');
const A = await import('../src/administration.js');
const H = await import('../src/habilitations.js');
const { creerApp } = await import('../src/serveur.js');
const { STYLE, couleursEtablissement, contraste } = await import('../src/ui.js');

initialiserSchema();
const cat = A.creerCategorie('test', { libelle: 'Gestion' });
const gam = A.creerApplication('test', { code: 'GAM', libelle: 'Gestion administrative', categorieId: cat });
const dpi = A.creerApplication('test', { code: 'DPI', libelle: 'Dossier patient', categorieId: cat });
const MDP = 'mot-de-passe-de-test';
A.creerUtilisateur('test', { login: 'admin', nom: 'Admin', role: 'admin', motDePasse: MDP });

// De quoi peupler la file : une ouverture à traiter, une fermeture demandée.
// Sans elle, la boîte de traitement s'auditerait vide, sans aucun de ses contrôles.
const ouverture = H.creerHabilitation('admin', {
  agent: { matricule: 'A1000', nom: 'Dupont', prenom: 'Louise' },
  applicationId: gam, role: 'Consultation', demandeur: 'admin',
});
const fermeture = H.creerHabilitation('admin', {
  agent: { matricule: 'A1001', nom: 'Martin', prenom: 'Paul' },
  applicationId: gam, role: 'Saisie', demandeur: 'admin',
});
H.changerStatut('admin', fermeture.id, 'executer');
H.demanderRetrait('admin', fermeture.id, { motif: 'Départ le 30 juin', demandeur: 'A1000 Louise Dupont' });

const serveur = creerApp().listen(0, '127.0.0.1');
await new Promise((r) => serveur.once('listening', r));
const BASE = `http://127.0.0.1:${serveur.address().port}`;
test.after(() => serveur.close());

let cookie = '';
const go = async (chemin) => {
  const r = await fetch(BASE + chemin, { redirect: 'manual', headers: { cookie } });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return r;
};
const connexion = await (await go('/connexion')).text();
await fetch(`${BASE}/connexion`, {
  method: 'POST',
  redirect: 'manual',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ login: 'admin', motDePasse: MDP, _csrf: connexion.match(/name="_csrf" value="([a-f0-9]+)"/)[1] }),
}).then((r) => {
  const sc = r.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
});

// Un échantillon représentatif : consultation, liste, formulaire, fiche, administration.
const PAGES = [
  '/', '/traiter', `/traiter/${ouverture.id}`, `/traiter/${fermeture.id}`,
  `/habilitations/${fermeture.id}`,
  '/suivi', '/recherche', '/mes-demandes', '/habilitations/nouvelle', '/depart',
  `/habilitations/nouvelle/multiple?apps=${gam}&apps=${dpi}`,
  `/habilitations/nouvelle/${gam}`, '/packs', '/export', '/coffre', '/audit', '/revues',
  '/admin/applications', '/admin/categories', '/admin/ufs', '/admin/sites',
  '/admin/utilisateurs', '/admin/routage', '/admin/import', '/aide', '/admin/packs', '/admin/bibliotheque', '/indicateurs', '/rapprochements',
];

const pages = new Map();
for (const chemin of PAGES) {
  const r = await go(chemin);
  assert.equal(r.status, 200, `${chemin} doit répondre 200`);
  pages.set(chemin, await r.text());
}
pages.set('/connexion (déconnecté)', connexion);

// On n'analyse que le contenu, pas le style ni les scripts.
const contenu = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');

test('chaque page déclare sa langue, son titre et un seul titre de niveau 1', () => {
  for (const [chemin, html] of pages) {
    assert.match(html, /<html lang="fr">/, `${chemin} : langue de la page`);
    const titre = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    assert.ok(titre.trim().length > 3, `${chemin} : titre de page explicite`);
    const h1 = contenu(html).match(/<h1[^>]*>/g) ?? [];
    assert.equal(h1.length, 1, `${chemin} : un seul h1`);
  }
});

test('la hiérarchie des titres ne saute pas de niveau', () => {
  for (const [chemin, html] of pages) {
    const niveaux = [...contenu(html).matchAll(/<h([1-6])[^>]*>/g)].map((m) => Number(m[1]));
    let precedent = 0;
    for (const n of niveaux) {
      if (precedent) assert.ok(n <= precedent + 1, `${chemin} : saut de h${precedent} à h${n}`);
      precedent = n;
    }
  }
});

test('chaque champ de formulaire porte une étiquette ou un intitulé accessible', () => {
  for (const [chemin, html] of pages) {
    const corps = contenu(html);
    const etiquettes = new Set([...corps.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
    // Une étiquette peut aussi englober son champ : <label>texte <input></label>.
    const englobants = [...corps.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].map((m) => [m.index, m.index + m[0].length]);
    const dansUneEtiquette = (i) => englobants.some(([debut, fin]) => i > debut && i < fin);

    for (const champ of corps.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      const attrs = champ[2];
      const type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? 'text';
      if (['hidden', 'submit', 'button'].includes(type)) continue;
      const id = attrs.match(/\bid="([^"]+)"/)?.[1];
      const nomme = (id && etiquettes.has(id))
        || /aria-label="[^"]+"/.test(attrs)
        || /aria-labelledby="/.test(attrs)
        || dansUneEtiquette(champ.index);
      assert.ok(nomme, `${chemin} : champ sans étiquette (${champ[0].slice(0, 90)})`);
    }
  }
});

test('chaque tableau de données porte une légende et des en-têtes déclarés', () => {
  for (const [chemin, html] of pages) {
    for (const tableau of contenu(html).matchAll(/<table[\s\S]*?<\/table>/g)) {
      const t = tableau[0];
      assert.match(t, /<caption>/, `${chemin} : tableau sans légende`);
      const entetes = t.match(/<th\b[^>]*>/g) ?? [];
      assert.ok(entetes.length > 0, `${chemin} : tableau sans en-tête`);
      for (const th of entetes) assert.match(th, /scope="(col|row)"/, `${chemin} : en-tête sans portée (${th})`);
    }
  }
});

test('chaque image porte un texte alternatif, chaque lien un intitulé', () => {
  for (const [chemin, html] of pages) {
    const corps = contenu(html);
    for (const img of corps.matchAll(/<img\b[^>]*>/g)) {
      assert.match(img[0], /\salt="/, `${chemin} : image sans alternative (${img[0]})`);
    }
    for (const lien of corps.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      const texte = lien[1].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
      const accessible = texte.length > 0 || /aria-label="[^"]+"/.test(lien[0]) || /title="[^"]+"/.test(lien[0]);
      assert.ok(accessible, `${chemin} : lien sans intitulé (${lien[0].slice(0, 90)})`);
    }
  }
});

test('un lien d’évitement ouvre chaque page authentifiée et vise le contenu', () => {
  for (const [chemin, html] of pages) {
    if (chemin.startsWith('/connexion')) continue;
    const corps = contenu(html);
    const premierLien = corps.match(/<a\b[^>]*>/);
    assert.match(premierLien?.[0] ?? '', /class="evitement"/, `${chemin} : le lien d'évitement doit venir en premier`);
    assert.match(corps, /<a class="evitement" href="#contenu">/);
    assert.match(corps, /id="contenu"/, `${chemin} : cible du lien d'évitement`);
    assert.match(corps, /<main\b/, `${chemin} : repère principal`);
    assert.match(corps, /<nav\b[^>]*aria-label="/, `${chemin} : navigation nommée`);
  }
});

test('la page courante est signalée autrement que par la couleur', () => {
  for (const [chemin, html] of pages) {
    if (chemin.startsWith('/connexion')) continue;
    assert.match(contenu(html), /aria-current="page"/, `${chemin} : élément de navigation courant signalé`);
  }
});

test('un statut n’est jamais porté par la seule couleur', () => {
  for (const [chemin, html] of pages) {
    for (const tag of contenu(html).matchAll(/<span class="tag[^"]*"[^>]*>([\s\S]*?)<\/span>/g)) {
      assert.ok(tag[1].replace(/<[^>]+>/g, '').trim().length > 0, `${chemin} : statut sans libellé`);
    }
  }
});

// Couleurs lues dans la feuille de style : le test ne peut pas diverger de la source.
const jeton = (nom) => {
  const v = STYLE.match(new RegExp(`--${nom}:\\s*(#[0-9a-f]{3,6})`, 'i'))?.[1];
  assert.ok(v, `jeton de couleur --${nom} introuvable dans la feuille de style`);
  return v;
};

test('contrastes de la palette : texte courant, texte secondaire, statuts, liens', () => {
  const blanc = '#ffffff';
  const fondClair = jeton('gris-2');
  const paires = [
    ['texte principal', jeton('encre'), blanc],
    ['texte secondaire', jeton('encre-2'), blanc],
    ['texte discret', jeton('encre-3'), blanc],
    ['texte discret sur fond de tableau', jeton('encre-3'), fondClair],
    ['statut en attente', jeton('attente'), blanc],
    ['statut actif', jeton('fait'), blanc],
    ['statut clos', jeton('clos'), blanc],
    ['anomalie', jeton('anomalie'), blanc],
    ['lien et accent', jeton('accent-texte'), blanc],
    ['texte sur fond en attente', jeton('attente'), jeton('attente-fond')],
    ['texte sur fond actif', jeton('fait'), jeton('fait-fond')],
    ['texte sur fond anomalie', jeton('anomalie'), jeton('anomalie-fond')],
  ];
  for (const [nom, avant, arriere] of paires) {
    const r = contraste(avant, arriere);
    assert.ok(r >= 4.5, `${nom} : contraste ${r.toFixed(2)} pour ${avant} sur ${arriere}, seuil 4.5`);
  }
});

test('couleur d’établissement : le texte reste lisible, quelle que soit la teinte choisie', () => {
  for (const teinte of ['#12558f', '#7a2f4f', '#1f6f8b', '#ffd400', '#9ee37d', '#000000', '#ffffff']) {
    const c = couleursEtablissement(teinte);
    assert.ok(contraste(c.accent, c.surAccent) >= 4.5, `texte posé sur ${teinte}`);
    assert.ok(contraste(c.accentTexte, '#ffffff') >= 4.5, `lien en ${teinte} sur fond blanc (obtenu : ${c.accentTexte})`);
  }
});

test('taille des cibles : les boutons tiennent la règle des 24 px', () => {
  for (const regle of ['.btn{', '.btn-petit{']) {
    const bloc = STYLE.slice(STYLE.indexOf(regle));
    const hauteur = Number(bloc.match(/min-height:(\d+)px/)?.[1] ?? 0);
    assert.ok(hauteur >= 24, `${regle} : hauteur minimale ${hauteur}px`);
  }
  assert.match(STYLE, /:focus-visible\{outline:2px solid/, 'la prise de focus reste visible');
});
