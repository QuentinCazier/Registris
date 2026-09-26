// Couche de présentation : style, icônes, gabarit et composants, rendus côté serveur.

import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { peut, LIBELLES_ROLE } from './roles.js';
import { LIB_STATUT } from './habilitations.js';

export const echap = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Sans l'échappement du `<`, une donnée contenant </script> fermerait la balise.
export const jsonInline = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONES = {
  cle: svg('<circle cx="8.5" cy="14.5" r="4.5"/><path d="M11.5 11.5 20 3"/><path d="M16.5 6.5l2.5 2.5"/><path d="M14 9l2.5 2.5"/>'),
  grille: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
  boite: svg('<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>'),
  loupe: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  liste: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  coffre: svg('<path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path d="M12 3v11"/><path d="M8 10l4 4 4-4"/>'),
  journal: svg('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="3.6" cy="6" r="1.1"/><circle cx="3.6" cy="12" r="1.1"/><circle cx="3.6" cy="18" r="1.1"/>'),
  apps: svg('<path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z"/><path d="M3 12l9 4.5 9-4.5"/>'),
  users: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.6 19c0-3 2.4-5 5.4-5s5.4 2 5.4 5"/><path d="M16.2 5.6a3 3 0 0 1 0 5.8"/><path d="M20.4 19c0-2.2-1.3-3.9-3.2-4.6"/>'),
  batiment: svg('<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 21V9h4a1 1 0 0 1 1 1v11"/><path d="M8 8h3M8 12h3M8 16h3"/><path d="M3 21h18"/>'),
  routage: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/>'),
  pack: svg('<path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5"/><path d="M12 12v9"/>'),
  colonnes: svg('<rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="9.5" y="4" width="5" height="11" rx="1.2"/><rect x="16" y="4" width="5" height="14" rx="1.2"/>'),
  bouclier: svg('<path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>'),
  uf: svg('<path d="M4 20V9l8-5 8 5v11"/><path d="M4 20h16"/><path d="M9 20v-6h6v6"/>'),
  reglages: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/>'),
  alerte: svg('<path d="M12 8.5v5"/><circle cx="12" cy="16.8" r=".9" fill="currentColor"/><path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  revue: svg('<path d="M9 4.5h6a1 1 0 0 1 1 1v1H8v-1a1 1 0 0 1 1-1z"/><path d="M8 6H6.5A1.5 1.5 0 0 0 5 7.5v12A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 6H16"/><path d="m8.8 13.4 2 2 4.4-4.6"/>'),
  televerser: svg('<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  sortie: svg('<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>'),
};

// --- Couleur de l'établissement ---------------------------------------------------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const composantes = (hex) => {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const enHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const melanger = (hex, vers, part) => enHex(composantes(hex).map((c, i) => c + (vers[i] - c) * part));

// Luminance relative au sens WCAG.
export function luminance(hex) {
  const [r, v, b] = composantes(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * v + 0.0722 * b;
}

// Rapport de contraste, de 1 à 21.
export const contraste = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Toute la palette est dérivée de la seule couleur configurée.
export function couleursEtablissement(accent = config.couleurAccent) {
  const base = HEX.test(accent) ? accent : '#12558f';
  const surAccent = contraste(base, '#ffffff') >= 4.5 ? '#ffffff' : '#111418';

  // Pour les liens, la couleur est foncée juste assez pour rester lisible.
  let accentTexte = base;
  for (let part = 0; contraste(accentTexte, '#ffffff') < 4.5 && part < 0.95; part += 0.05) {
    accentTexte = melanger(base, [0, 0, 0], part);
  }

  return {
    accent: base,
    accentSombre: melanger(base, [0, 0, 0], 0.22),
    accentClair: melanger(base, [255, 255, 255], 0.9),
    accentTexte,
    surAccent,
  };
}

const variablesCouleur = () => {
  const c = couleursEtablissement();
  return `:root{--accent:${c.accent};--accent-2:${c.accentSombre};--accent-clair:${c.accentClair};--accent-texte:${c.accentTexte};--sur-accent:${c.surAccent}}`;
};

// --- Ressources de marque ---------------------------------------------------------

const trouverAsset = (noms) => {
  for (const n of noms) {
    try {
      if (fs.existsSync(path.join(config.publicDir, n))) return n;
    } catch {
      /* ignore */
    }
  }
  return null;
};
const versionAsset = (nom) => {
  try {
    return nom ? `?v=${Math.floor(fs.statSync(path.join(config.publicDir, nom)).mtimeMs)}` : '';
  } catch {
    return '';
  }
};

// Grand format, pour la page de connexion.
export function glyphe() {
  const logo = trouverAsset(['logo.svg', 'logo.png', 'logo.webp']);
  return logo ? `<img src="/${logo}${versionAsset(logo)}" alt="${echap(config.nom)}">` : ICONES.cle;
}

// Un logo chargé de détails devient illisible à 26 px : `marque.svg` prime.
export function marqueBarre() {
  const m = trouverAsset(['marque.svg', 'marque.png', 'logo.svg', 'logo.png', 'logo.webp']);
  return m ? `<img src="/${m}${versionAsset(m)}" alt="" width="26" height="26">` : ICONES.cle;
}

function liensTete() {
  const favicon = trouverAsset(['favicon.ico', 'favicon.png', 'marque.svg', 'logo.png']);
  const apple = trouverAsset(['apple-touch-icon.png', 'logo.png']);
  let h = `<meta name="theme-color" content="${echap(couleursEtablissement().accent)}">`;
  if (favicon) {
    const t = favicon.endsWith('.svg') ? ' type="image/svg+xml"' : '';
    h += `<link rel="icon"${t} href="/${favicon}${versionAsset(favicon)}">`;
  }
  if (apple) h += `<link rel="apple-touch-icon" href="/${apple}${versionAsset(apple)}">`;
  return h;
}

export const STYLE = `
@font-face{font-family:"Registris Sans";src:url("/polices/atkinson-sans.woff2") format("woff2-variations");font-weight:200 700;font-display:swap}
@font-face{font-family:"Registris Mono";src:url("/polices/atkinson-mono.woff2") format("woff2-variations");font-weight:200 700;font-display:swap}

:root{
  --sans:"Registris Sans",system-ui,"Segoe UI",Roboto,sans-serif;
  --mono:"Registris Mono",ui-monospace,Consolas,"Liberation Mono",monospace;
  --fond:#f7f8fa; --blanc:#fff; --gris:#eef1f4; --gris-2:#fafbfc;
  --encre:#111418; --encre-2:#535c66; --encre-3:#6b7480;
  --filet:#e3e7eb; --filet-fort:#c9d1d9;
  --accent:#12558f; --accent-2:#0e4373; --accent-clair:#e9f1f8; --accent-texte:#12558f; --sur-accent:#fff;
  --attente:#8a5a00; --attente-fond:#fdf6e8; --attente-filet:#f0dfba;
  --fait:#136b4c; --fait-fond:#e9f5ef; --fait-filet:#c6e4d6; --clos:#6b7280;
  --anomalie:#a8352a; --anomalie-fond:#fcedeb; --anomalie-filet:#f0c8c2;
  --ombre:0 1px 2px rgba(17,20,24,.05);
}
*{box-sizing:border-box}
body{margin:0;background:var(--fond);color:var(--encre);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
a{color:var(--accent-texte);text-decoration:none}
a:hover{text-decoration:underline}
.mono,code{font-family:var(--mono);font-feature-settings:"tnum" 1}
.micro{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--encre-3);font-weight:700}
.sr{position:absolute;left:-9999px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.evitement{position:absolute;left:-9999px;top:0;z-index:20;background:var(--blanc);padding:10px 14px;border-radius:0 0 8px 0}
.evitement:focus{left:0}

/* Barre haute */
.haut{background:var(--blanc);border-bottom:1px solid var(--filet);position:sticky;top:0;z-index:5}
.haut .r1{display:flex;align-items:center;gap:18px;padding:0 22px;height:56px;background:var(--accent)}
.logo{display:flex;align-items:center;gap:9px;font-size:15.5px;letter-spacing:-.01em;color:var(--sur-accent);flex:none}
.logo:hover{text-decoration:none}
.logo .chip{display:inline-flex;border-radius:7px;padding:3px;background:var(--blanc)}
.logo .chip img,.logo .chip svg{width:26px;height:26px;display:block;color:var(--accent)}
.logo .marque-nom{font-weight:700}
.logo .et{font-weight:400;font-size:12.5px;opacity:.78;border-left:1px solid currentColor;padding-left:11px;margin-left:3px}
.rech{flex:1;max-width:470px;position:relative;margin:0}
.rech input{width:100%;font:inherit;font-size:13.5px;padding:8px 12px 8px 35px;border:1px solid rgba(255,255,255,.32);border-radius:7px;background:rgba(255,255,255,.15);color:var(--sur-accent)}
.rech input::placeholder{color:var(--sur-accent);opacity:.72}
.rech input:focus{background:var(--blanc);color:var(--encre);border-color:var(--blanc);outline:none}
.rech input:focus::placeholder{color:var(--encre-3)}
.rech svg{position:absolute;left:11px;top:9px;width:16px;height:16px;color:var(--sur-accent);opacity:.8;pointer-events:none}
.rech input:focus + svg{color:var(--encre-3);opacity:1}
.haut .droite{margin-left:auto;display:flex;align-items:center;gap:13px;flex:none}
.haut .qui{text-align:right;line-height:1.25;color:var(--sur-accent)}
.haut .qui b{display:block;font-size:13px;font-weight:600}
.haut .qui span{font-size:11.5px;opacity:.75}
.pastille{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.2);color:var(--sur-accent);display:grid;place-items:center;font-size:12px;font-weight:700}
.haut .sortie{color:var(--sur-accent);opacity:.82;font-size:12.5px}
.haut .r1 .btn-p{background:var(--blanc);color:var(--accent);border-color:var(--blanc)}
.haut .r1 .btn-p:hover{background:var(--gris)}
.haut .r2{display:flex;gap:2px;padding:0 22px;overflow-x:auto;overflow-y:hidden}
.haut .r2 a{display:flex;align-items:center;gap:7px;padding:9px 12px;font-size:13.5px;color:var(--encre-2);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.haut .r2 a svg{width:16px;height:16px;color:var(--encre-3)}
.haut .r2 a:hover{color:var(--encre);text-decoration:none}
.haut .r2 a.actif{color:var(--accent-texte);font-weight:600;border-bottom-color:var(--accent)}
.haut .r2 a.actif svg{color:var(--accent)}
.haut .r2 .n{font-size:11px;font-weight:700;background:var(--gris);color:var(--encre-2);border-radius:20px;padding:1px 7px;font-feature-settings:"tnum" 1}
.haut .r2 a.actif .n{background:var(--accent-clair);color:var(--accent-texte)}
.sous-nav{display:flex;gap:4px;padding:9px 22px;background:var(--gris-2);border-top:1px solid var(--filet);overflow-x:auto;overflow-y:hidden}
.sous-nav a{padding:5px 11px;font-size:13px;color:var(--encre-2);border-radius:20px;white-space:nowrap}
.sous-nav a:hover{background:var(--gris);text-decoration:none}
.sous-nav a.actif{background:var(--accent);color:var(--sur-accent);font-weight:600}

/* Page */
.page{max-width:1320px;margin:0 auto;padding:24px 22px 56px}
.page.large{max-width:1600px}
.page-tete{display:flex;align-items:flex-start;gap:20px;margin-bottom:20px;flex-wrap:wrap}
.page-tete h1{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
.page-tete .sous{font-size:13px;color:var(--encre-2)}
.page-tete .sous b{font-weight:600;color:var(--encre);font-feature-settings:"tnum" 1}
.page-tete .a{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.page-tete .a form{display:inline}
section{margin-bottom:22px}
section > h2{font-size:15px;font-weight:700;margin:26px 0 10px;letter-spacing:-.01em}

/* Boutons. Hauteur de cible conforme au critère 24 px de WCAG 2.2. */
.btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:13px;font-weight:600;padding:8px 14px;min-height:34px;border:1px solid var(--filet-fort);background:var(--blanc);color:var(--encre);border-radius:7px;cursor:pointer;line-height:1.2;box-shadow:var(--ombre);text-decoration:none}
.btn:hover{background:var(--gris-2);border-color:#b8c2cc;text-decoration:none}
.btn svg{width:15px;height:15px}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--sur-accent)}
.btn-primary:hover{background:var(--accent-2);border-color:var(--accent-2)}
.btn-ghost{background:var(--blanc)}
.btn-danger{color:var(--anomalie);border-color:var(--anomalie-filet)}
.btn-danger:hover{background:var(--anomalie-fond)}
.btn-petit{padding:5px 11px;min-height:28px;font-size:12.5px;box-shadow:none}
.btn:disabled{opacity:.45;cursor:not-allowed}

/* Blocs */
.bloc,.carte{background:var(--blanc);border:1px solid var(--filet);border-radius:10px;box-shadow:var(--ombre);margin-bottom:18px}
.bloc{overflow:hidden}
.carte{padding:18px 20px}
.bloc-tete{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--filet);flex-wrap:wrap}
.bloc-tete h2{font-size:14px;font-weight:700;margin:0;letter-spacing:-.01em}
.bloc-tete .c{font-size:12px;color:var(--encre-3);font-feature-settings:"tnum" 1}
.bloc-tete .d{margin-left:auto;font-size:12.5px;display:flex;align-items:center;gap:10px}
.bloc-pied{padding:10px 16px;border-top:1px solid var(--filet);font-size:12.5px;color:var(--encre-2);background:var(--gris-2)}
.colonnes{display:grid;grid-template-columns:minmax(0,1.85fr) minmax(0,1fr);gap:18px;align-items:start}
.deux-col{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;align-items:start}

/* Tableaux */
table{width:100%;border-collapse:collapse;background:var(--blanc)}
caption{position:absolute;left:-9999px}
thead th{text-align:left;padding:8px 14px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--encre-3);font-weight:700;background:var(--gris-2);border-bottom:1px solid var(--filet);white-space:nowrap}
tbody td{padding:10px 14px;border-bottom:1px solid var(--filet);font-size:13.5px;vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--gris-2)}
td.num,th.num{font-family:var(--mono);font-size:12.5px;color:var(--encre-2);width:1%;white-space:nowrap}
td.acts{width:1%;white-space:nowrap;text-align:right}
td.acts form{display:inline}
td .sous{display:block;font-size:12px;color:var(--encre-3);margin-top:1px}
.nom{font-weight:700;white-space:nowrap}
.matricule,.mat{font-family:var(--mono);font-size:11.5px;color:var(--encre-3);white-space:nowrap}
.mat{margin-left:7px}

/* Statuts : une pastille et un mot, jamais la couleur seule */
.tag{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;white-space:nowrap}
.tag::before{content:"";width:7px;height:7px;border-radius:2px;flex:none;background:var(--c,var(--encre-3))}
.t-demandee{--c:var(--attente);color:var(--attente)}
.t-validee{--c:var(--accent);color:var(--accent-texte)}
.t-executee{--c:var(--fait);color:var(--fait)}
.t-revoquee{--c:var(--clos);color:var(--clos)}
.t-refusee{--c:var(--clos);color:var(--clos)}
.t-refusee::before{border-radius:50%}
.r-admin{--c:#5a3c86;color:#5a3c86}
.r-referent{--c:var(--accent);color:var(--accent-texte)}
.r-controleur{--c:var(--fait);color:var(--fait)}
.r-utilisateur{--c:var(--encre-3);color:var(--encre-2)}
.puce{display:inline-block;font-size:11.5px;font-weight:600;border-radius:5px;padding:2px 7px;border:1px solid}
.p-attente{color:var(--attente);background:var(--attente-fond);border-color:var(--attente-filet)}
.p-fait{color:var(--fait);background:var(--fait-fond);border-color:var(--fait-filet)}
.p-neutre{color:var(--encre-2);background:var(--gris);border-color:var(--filet)}
.p-anomalie{color:var(--anomalie);background:var(--anomalie-fond);border-color:var(--anomalie-filet)}
.p-fermeture{color:var(--anomalie);background:var(--anomalie-fond);border-color:var(--anomalie-filet)}
.assigne{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--encre-2)}
.assigne b{font-weight:600}
.aide{font-size:12.5px;color:var(--encre-3);margin:-4px 0 12px}

/* Indicateurs : quelques chiffres, puis les tableaux qui les expliquent */
.chiffres{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:22px}
.chiffre{background:var(--blanc);border:1px solid var(--filet);border-radius:10px;padding:14px 16px;box-shadow:var(--ombre)}
.chiffre .t{font-size:12.5px;color:var(--encre-2);font-weight:600}
.chiffre .v{font-size:24px;font-weight:700;letter-spacing:-.02em;margin:4px 0 2px;font-feature-settings:"tnum" 1}
.chiffre .d{font-size:12px;color:var(--encre-3)}
.chiffre.alerte{border-color:var(--anomalie-filet);background:var(--anomalie-fond)}
.chiffre.alerte .v{color:var(--anomalie)}

/* Rapprochement */
a.chiffre{display:block;color:inherit;text-decoration:none}
a.chiffre:hover{border-color:var(--filet-fort);text-decoration:none}
td.acts.rapp{white-space:normal;width:auto;min-width:280px}
td.acts.rapp .revue-actions{flex-wrap:wrap;justify-content:flex-start}
td.acts.rapp .ligne-motif input{width:150px}
details.bloc > summary{list-style:none}
details.bloc > summary::-webkit-details-marker{display:none}
details.bloc > summary h2::before{content:"▸ ";color:var(--encre-3)}
details.bloc[open] > summary h2::before{content:"▾ "}

/* Bibliothèque de logiciels */
.biblio-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:1px;background:var(--filet)}
.biblio-item{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--blanc);cursor:pointer}
.biblio-item:hover{background:var(--gris-2)}
.biblio-item.deja{cursor:default;color:var(--encre-3)}
.biblio-item input{margin:0;width:16px;height:16px;flex:none}
.biblio-item .puce{flex:none}
.biblio-item .ico{width:28px;height:28px;border-radius:7px;overflow:hidden;flex:none;border:1px solid var(--filet)}
.biblio-item .n{font-size:13.5px;font-weight:600;line-height:1.25}
.biblio-item .n .e{display:block;font-size:11.5px;font-weight:400;color:var(--encre-3)}
.biblio-item:has(input:checked){background:var(--accent-clair)}

/* Sélection multiple au catalogue */
.choix{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:6px 10px;min-height:28px;border:1px solid var(--filet-fort);border-radius:7px;cursor:pointer;background:var(--blanc)}
.choix:hover{background:var(--gris-2)}
.choix input{margin:0;width:15px;height:15px;min-height:0;padding:0}
.choix:has(input:checked){border-color:var(--accent);background:var(--accent-clair);color:var(--accent-texte)}
.barre-choix{position:sticky;bottom:0;display:flex;align-items:center;gap:14px;justify-content:flex-end;padding:12px 16px;margin-top:16px;background:var(--blanc);border:1px solid var(--filet);border-radius:10px;box-shadow:0 -2px 10px rgba(17,20,24,.06)}
.barre-choix span{font-size:13px;color:var(--encre-2)}
.lignes-app{display:grid;gap:10px;margin-bottom:14px}
.ligne-app{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--filet);border-radius:8px;background:var(--gris-2)}
.ligne-app .qui{display:flex;align-items:center;gap:9px;font-weight:600;font-size:13.5px}
.ligne-app .qui .ico{width:26px;height:26px;border-radius:6px;overflow:hidden;display:grid;place-items:center;background:var(--blanc);border:1px solid var(--filet);flex:none}
.ligne-app .qui .ico img{width:100%;height:100%;object-fit:contain}
.ligne-app input{margin:0}

.revue-actions{display:flex;gap:6px;align-items:center;justify-content:flex-end}
.decision-prise{white-space:nowrap}
.revue-actions input{width:170px;min-height:28px;padding:4px 8px;font-size:12.5px}

/* Bandeaux */
.bandeau{display:flex;align-items:center;gap:11px;padding:12px 16px;border-radius:10px;border:1px solid var(--filet);background:var(--blanc);box-shadow:var(--ombre);margin-bottom:18px;font-size:13.5px}
.bandeau svg{width:18px;height:18px;flex:none}
.bandeau .t{font-weight:700}
.bandeau .d{font-size:12.5px;color:var(--encre-2)}
.bandeau .r{margin-left:auto;font-size:12.5px;flex:none}
.b-ok{border-color:var(--fait-filet);background:var(--fait-fond)}
.b-ok svg{color:var(--fait)}
.b-ok .t{color:#0f5940}
.b-warn{border-color:var(--attente-filet);background:var(--attente-fond)}
.b-warn svg{color:var(--attente)}
.b-warn .t{color:#6f4f10}
.b-err{border-color:var(--anomalie-filet);background:var(--anomalie-fond)}
.b-err svg{color:var(--anomalie)}
.b-err .t{color:var(--anomalie)}

/* Listes de travail */
.vigilance{list-style:none;margin:0;padding:0}
.vigilance li{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--filet);font-size:13px}
.vigilance li:last-child{border-bottom:0}
.vigilance .ic{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;flex:none;background:var(--attente-fond);color:var(--attente);font-family:var(--mono);font-size:12.5px;font-weight:700}
.vigilance .ic.ok{background:var(--gris);color:var(--encre-3)}
.vigilance p{margin:0;color:var(--encre-2)}
.vigilance a{display:inline-block;margin-top:3px;font-size:12.5px;font-weight:600}
.ecritures{list-style:none;margin:0;padding:0}
.ecritures li{display:flex;gap:12px;align-items:baseline;padding:9px 16px;border-bottom:1px solid var(--filet);font-size:12.5px}
.ecritures li:last-child{border-bottom:0}
.ecritures .h{font-size:12px;color:var(--encre-3);white-space:nowrap;font-feature-settings:"tnum" 1}
.ecritures .a{color:var(--encre-2)}
.ecritures .a b{font-weight:700;color:var(--encre)}

/* Onglets et filtres */
.onglets{display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap}
.onglets a{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;font-size:13px;font-weight:600;color:var(--encre-2);background:var(--blanc);border:1px solid var(--filet);border-radius:20px}
.onglets a:hover{border-color:var(--filet-fort);text-decoration:none}
.onglets a.actif{background:var(--accent);border-color:var(--accent);color:var(--sur-accent)}
.onglets a .c{font-size:11px;opacity:.75;font-feature-settings:"tnum" 1}
.filtres{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px}
.filtres > div{min-width:170px}
.filtres label{margin:0 0 4px}

/* Formulaires */
label{display:block;font-weight:600;font-size:13px;margin:14px 0 6px;color:var(--encre)}
label:first-child{margin-top:0}
label .opt{font-weight:400;color:var(--encre-3)}
input,select,textarea{width:100%;font:inherit;font-size:13.5px;padding:8px 11px;min-height:34px;color:var(--encre);background:var(--blanc);border:1px solid var(--filet-fort);border-radius:7px}
input[type=file]{padding:6px 9px}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-clair)}
input[readonly]{background:var(--gris-2);color:var(--encre-2)}
textarea{min-height:92px;resize:vertical}
.champ-aide{font-size:12.5px;color:var(--encre-3);margin-top:5px}
.grille2{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
.radios{display:flex;gap:10px;flex-wrap:wrap}
.radio{display:inline-flex;align-items:center;gap:8px;margin:0;font-weight:500;cursor:pointer;border:1px solid var(--filet-fort);border-radius:7px;padding:8px 12px;background:var(--blanc)}
.radio input{width:auto;min-height:0;margin:0}
form .actions{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
.actions-ligne{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 18px;align-items:center}
.actions-ligne form{display:inline}

/* Fiche */
.paires{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.paires .item{padding:12px 16px;border-bottom:1px solid var(--filet);border-right:1px solid var(--filet)}
.paires .item:nth-child(3n){border-right:0}
.paires .item .micro{display:block;margin-bottom:3px}
.paires .item .val{font-size:13.5px}
.piece{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--filet);font-size:13px;flex-wrap:wrap}
.piece:last-child{border-bottom:0}
.piece .ic{width:32px;height:32px;border-radius:7px;background:var(--gris);color:var(--encre-2);display:grid;place-items:center;flex:none}
.piece .ic svg{width:16px;height:16px}
.piece .f{font-weight:600}
.piece .m{font-size:12px;color:var(--encre-3)}
.piece .d{margin-left:auto;display:flex;align-items:center;gap:14px;flex:none}
.depot{display:flex;align-items:center;gap:11px;padding:13px 16px;border-top:1px dashed var(--filet-fort);font-size:12.5px;color:var(--encre-3)}
.depot svg{width:17px;height:17px;flex:none}
code.hash{font-family:var(--mono);font-size:11.5px;color:var(--encre-2);background:var(--gris);padding:2px 6px;border-radius:4px}

/* Chaîne des écritures */
.fil{list-style:none;margin:0;padding:8px 0;position:relative}
.fil::before{content:"";position:absolute;left:27px;top:20px;bottom:20px;width:1.5px;background:var(--filet)}
.fil li{position:relative;padding:8px 16px 8px 46px;font-size:13px}
.fil li::after{content:"";position:absolute;left:23px;top:13px;width:9px;height:9px;border-radius:50%;background:var(--blanc);border:2px solid var(--accent)}
.fil .e b{font-weight:700}
.fil .q{font-size:12px;color:var(--encre-3);margin-left:8px;font-feature-settings:"tnum" 1}
.fil .emp{display:block;font-family:var(--mono);font-size:11px;color:var(--encre-3);margin-top:2px}
.histo{margin:0;padding:0;list-style:none}
.histo li{display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid var(--filet);font-size:13px}
.histo li:last-child{border-bottom:0}
.histo .q{font-family:var(--mono);font-size:11.5px;color:var(--encre-3)}

/* Applications */
.cat-tabs{display:flex;gap:4px;margin-bottom:18px;flex-wrap:wrap}
.cat-tabs a{padding:6px 12px;font-size:13px;font-weight:600;color:var(--encre-2);background:var(--blanc);border:1px solid var(--filet);border-radius:20px}
.cat-tabs a:hover{border-color:var(--filet-fort);text-decoration:none}
.cat-tabs a.actif{background:var(--accent);border-color:var(--accent);color:var(--sur-accent)}
.cat-compte{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-left:6px;padding:0 5px;border-radius:9px;font-size:11px;font-weight:700;background:var(--accent-clair);color:var(--accent-texte)}
.cat-tabs a.actif .cat-compte{background:var(--blanc);color:var(--accent-texte)}
.cat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.srv{display:flex;flex-direction:column;background:var(--blanc);border:1px solid var(--filet);border-radius:10px;padding:16px;box-shadow:var(--ombre)}
.srv:hover{border-color:var(--filet-fort)}
.ico{width:44px;height:44px;border-radius:9px;background:var(--gris);display:grid;place-items:center;overflow:hidden;border:1px solid var(--filet)}
.ico img{width:100%;height:100%;object-fit:contain}
.ico .ph{font-family:var(--mono);font-weight:700;font-size:13px;color:hsl(var(--t,210) 58% 28%);background:hsl(var(--t,210) 46% 94%);width:100%;height:100%;display:grid;place-items:center;letter-spacing:.02em}
.ico svg{width:21px;height:21px;color:var(--accent-texte)}
.srv .ico{margin-bottom:12px}
.srv .n{font-weight:700;font-size:14px;line-height:1.3;margin-bottom:3px}
.srv .c{font-size:12px;color:var(--encre-3);margin-bottom:14px}
.srv .b{margin-top:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
/* Catalogue : la carte entière se coche */
.srv-choix{position:relative;cursor:pointer;margin:0;font-weight:400;transition:border-color .12s,background .12s}
.srv-choix input{position:absolute;top:14px;right:14px;width:20px;height:20px;min-height:0;padding:0;margin:0;accent-color:var(--accent)}
.srv-choix .n,.srv-choix .c,.srv-choix .etat{display:block}
.srv-choix .ico{margin-bottom:12px}
.srv-choix .etat{margin-top:auto;padding-top:10px;font-size:12.5px;font-weight:600;color:var(--encre-3)}
.srv-choix .etat .oui{display:none}
.srv-choix:has(input:checked){border-color:var(--accent);background:var(--accent-clair);box-shadow:0 0 0 1px var(--accent)}
.srv-choix:has(input:checked) .etat{color:var(--accent-texte)}
.srv-choix:has(input:checked) .etat .oui{display:inline}
.srv-choix:has(input:checked) .etat .non{display:none}
.srv-choix:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.recherche-catalogue{max-width:520px;margin:0 0 14px}
.recherche-catalogue input{font-size:14.5px;padding:10px 13px}
.aucun-resultat{margin-top:6px}
.barre-choix .indice{color:var(--encre-3)}
/* Sélecteur d'UF : une liste à cocher filtrable, pas un Ctrl+clic */
.liste-ufs{max-height:210px;overflow:auto;border:1px solid var(--filet-fort);border-radius:7px;background:var(--blanc);margin-top:6px}
.liste-ufs label{display:flex;align-items:center;gap:9px;margin:0;padding:7px 11px;font-weight:400;font-size:13.5px;border-bottom:1px solid var(--filet);cursor:pointer}
.liste-ufs label:last-child{border-bottom:0}
.liste-ufs label:hover{background:var(--gris-2)}
.liste-ufs input{width:16px;height:16px;min-height:0;padding:0;margin:0;flex:none}
.liste-ufs label:has(input:checked){background:var(--accent-clair)}
.liste-ufs .code{font-variant-numeric:tabular-nums;color:var(--encre-2);min-width:44px}
details.facultatif{margin-top:16px;border:1px solid var(--filet);border-radius:8px;background:var(--gris-2)}
details.facultatif>summary{cursor:pointer;padding:10px 13px;font-weight:600;font-size:13px}
details.facultatif>div{padding:0 13px 13px}
.profil-autre{margin-top:8px}
/* Mise en route */
.etapes{list-style:none;margin:0;padding:0}
.etapes li{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--filet);font-size:13.5px}
.etapes li:last-child{border-bottom:0}
.etapes .num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;flex:none;font-size:12.5px;font-weight:700;background:var(--accent-clair);color:var(--accent-texte)}
.etapes li.fait .num{background:var(--fait-fond);color:var(--fait)}
.etapes li.fait .t{color:var(--encre-2);text-decoration:line-through;text-decoration-color:var(--filet-fort)}
.etapes .t{font-weight:600}
.etapes .d{font-size:12.5px;color:var(--encre-3)}
.etapes a.btn{margin-left:auto;flex:none}
/* Aide */
.aide-roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.aide-roles h2{font-size:16px;margin:0 0 4px}
.aide-roles .pour{font-size:12.5px;color:var(--encre-3);margin:0 0 12px}
.aide-roles ol{margin:0;padding-left:20px}
.aide-roles li{margin:0 0 9px;font-size:13.5px}
.aide-roles .carte.moi{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.haut .aide-lien{color:var(--sur-accent);opacity:.82;font-size:12.5px}
.srv-tete{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.srv-tete h2{letter-spacing:-.015em;font-size:17px;margin:0}
.srv-tete .c{font-size:12.5px;color:var(--encre-3);margin-top:2px}
.raccourcis{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-bottom:24px}
.rac{display:flex;align-items:center;gap:14px;background:var(--blanc);border:1px solid var(--filet);border-radius:10px;padding:16px 18px;box-shadow:var(--ombre);color:var(--encre)}
.rac:hover{border-color:var(--accent);text-decoration:none}
.rac .ic{width:42px;height:42px;border-radius:9px;background:var(--accent-clair);color:var(--accent-texte);display:grid;place-items:center;flex:none}
.rac .ic svg{width:21px;height:21px}
.rac .t{font-weight:700;font-size:14.5px;display:block}
.rac .d{font-size:12.5px;color:var(--encre-3);margin-top:2px;display:block}
.aide{font-size:13.5px;color:var(--encre-2);margin:0 0 16px;max-width:76ch}
.vide{border:1px dashed var(--filet-fort);border-radius:10px;padding:26px;text-align:center;color:var(--encre-3);background:var(--gris-2);font-size:13.5px}
.barres{display:flex;flex-direction:column;gap:9px}
.bl{display:grid;grid-template-columns:170px 1fr 46px;align-items:center;gap:10px;font-size:13px}
.bl-l{color:var(--encre-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bl-t{height:10px;background:var(--gris);border-radius:20px;overflow:hidden}
.bl-f{height:100%;background:var(--accent);border-radius:20px;min-width:3px}
.bl-n{font-family:var(--mono);text-align:right}
.groupe-agent{margin-bottom:22px}
.groupe-agent .entete-a{display:flex;align-items:baseline;gap:12px;margin:0 0 9px}
.groupe-agent .entete-a h3{letter-spacing:-.015em;font-size:15.5px;font-weight:700;margin:0}

/* Boîte de traitement : la file à gauche, le dossier à droite, sans changer de page */
.page.plein{max-width:none;padding:0}
.boite{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);height:calc(100vh - 97px)}
.boite.sans-sous-nav{height:calc(100vh - 97px)}
.file{border-right:1px solid var(--filet);background:var(--blanc);display:flex;flex-direction:column;min-height:0}
.file-tete{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--filet)}
.file-tete h2{font-size:14px;font-weight:700;margin:0}
.file-tete .c{font-size:12px;color:var(--encre-3)}
.file-tete .tri{margin-left:auto;font-size:12.5px;color:var(--encre-3)}
.file-filtres{display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--filet);background:var(--gris)}
.file-filtres a{font-size:12.5px;padding:4px 10px;border-radius:6px;color:var(--encre-2);min-height:26px;display:inline-flex;align-items:center}
.file-filtres a:hover{background:var(--gris-2);text-decoration:none}
.file-filtres a.actif{background:var(--surface);color:var(--accent-texte);font-weight:600;box-shadow:0 0 0 1px var(--filet)}
.file-corps{overflow:auto;min-height:0}
.file-item{display:block;padding:12px 16px;border-bottom:1px solid var(--filet);color:inherit;border-left:3px solid transparent}
.file-item:hover{background:var(--gris-2);text-decoration:none}
.file-item.sel{background:var(--accent-clair);border-left-color:var(--accent)}
.file-item .l1{display:flex;align-items:baseline;gap:8px}
.file-item .qui{font-weight:700;font-size:13.5px}
.file-item .no{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--encre-3)}
.file-item .l2{font-size:13px;color:var(--encre-2);margin-top:2px}
.file-item .l3{display:flex;align-items:center;gap:9px;margin-top:8px;flex-wrap:wrap}
.file-item .age{font-size:11.5px;color:var(--encre-3);margin-left:auto;font-family:var(--mono)}
.file-item .a-qui{font-size:11.5px;color:var(--encre-3)}

/* Une action qui doit être motivée porte son champ avec elle */
.ligne-motif{display:flex;gap:6px;align-items:center}
.ligne-motif input{width:190px;min-height:32px;padding:5px 9px;font-size:12.5px;margin:0}
.assignation{display:flex;gap:6px;align-items:center}
.assignation select{min-height:32px;padding:4px 8px;font-size:12.5px;margin:0;max-width:190px}
.dossier{overflow:auto;min-height:0;padding:22px 26px 40px}
.dossier .page-tete{padding-bottom:16px;border-bottom:1px solid var(--filet);margin-bottom:18px}
.dossier .bloc:last-child{margin-bottom:0}
.boite-vide{grid-column:1 / -1;display:grid;place-items:center;text-align:center;color:var(--encre-3);padding:40px}
.boite-vide .t{font-size:16px;font-weight:700;color:var(--encre);margin:0 0 6px;letter-spacing:0}

@media (max-width:1080px){.cat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:900px){.boite{grid-template-columns:1fr;height:auto}.file{border-right:0;border-bottom:1px solid var(--filet)}.file-corps{max-height:340px}.dossier{padding:18px 14px 40px}}
@media (max-width:900px){
  .haut .r1{height:auto;flex-wrap:wrap;padding:10px 14px;gap:10px}
  .rech{order:3;flex-basis:100%;max-width:none}
  .haut .r2,.sous-nav{padding-inline:14px}
  .colonnes,.deux-col,.grille2{grid-template-columns:1fr}
  .paires{grid-template-columns:1fr 1fr}
  .page{padding:18px 14px 48px}
  .bloc{overflow-x:auto}
  .histo li{grid-template-columns:1fr;gap:2px}
}
@media (max-width:640px){
  .cat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .haut .r2{flex-wrap:wrap;overflow:visible;padding-block:4px}
  .haut .r2 a{padding:7px 10px}
  .haut .r2 a.actif{border-bottom-color:transparent;background:var(--accent-clair);border-radius:7px}
  .sous-nav{flex-wrap:wrap;overflow:visible}
  .etapes li{flex-wrap:wrap}
  .etapes a.btn{margin-left:38px}
  .paires{grid-template-columns:1fr}
  .haut .qui{display:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
/* Le dossier de preuve finit souvent sur papier ou en PDF chez l'auditeur. */
.impr{display:none}
@media print{
  .haut,.page-tete .a,.depot,.evitement,.onglets,.filtres,.bloc-pied a,.bloc-tete .d,.file,form,.btn,td.acts,.pas-impr{display:none}
  body{background:#fff;font-size:11pt}
  .page{max-width:none;padding:0}
  .impr{display:block;border-bottom:1.5px solid #111418;padding-bottom:8px;margin-bottom:16px}
  .impr .t{font-size:10pt;letter-spacing:.06em;text-transform:uppercase;color:#444}
  .impr .d{font-size:9.5pt;color:#444;margin-top:2px}
  .bloc,.carte{box-shadow:none;break-inside:avoid;border-color:#bbb}
  .bloc-tete{background:#f2f2f2}
  .fil::before{background:#bbb}
  .tag::before{border:1px solid #444}
  a{color:#111418;text-decoration:none}
  .empreinte-courte{display:none}
  .empreinte-complete{display:inline!important;word-break:break-all}
  .dossier{overflow:visible;padding:0}
  .boite{display:block;height:auto}
  .aide-roles{display:block}
  .aide-roles section{break-after:page;border:0}
}
.empreinte-complete{display:none}
`;

// --- Navigation -------------------------------------------------------------------

const SECTIONS = [
  { cle: 'accueil', href: '/', libelle: 'Tableau de bord', icone: 'grille' },
  { cle: 'traiter', href: '/traiter', libelle: 'À traiter', icone: 'boite', droit: 'habilitation:suivre', compteur: 'aTraiter' },
  { cle: 'registre', href: '/suivi', libelle: 'Registre', icone: 'liste', droit: 'habilitation:suivre', compteur: 'registre' },
  { cle: 'miennes', href: '/mes-demandes', libelle: 'Mes demandes', icone: 'colonnes' },
  {
    cle: 'approbations', href: '/approbations', libelle: 'Accords à donner', icone: 'revue', compteur: 'approbations',
    visible: (role, c, section) => (c.approbations ?? 0) > 0 || section === 'approbations',
  },
  { cle: 'depart', href: '/depart', libelle: 'Signaler un départ', icone: 'sortie', droit: 'habilitation:creer' },
  { cle: 'agents', href: '/recherche', libelle: 'Agents', icone: 'users', droit: 'habilitation:lire' },
  {
    cle: 'departs', href: '/departs', libelle: 'Départs détectés', icone: 'alerte', droit: 'habilitation:suivre', compteur: 'departs',
    visible: (role, c, section) => (c.departs ?? 0) > 0 || section === 'departs',
  },
  // Visible pour qui pilote ou contrôle, sinon seulement quand une campagne attend l'utilisateur.
  {
    cle: 'revues', href: '/revues', libelle: 'Revue périodique', icone: 'revue',
    droit: 'habilitation:suivre', compteur: 'revue',
    visible: (role, c) => peut(role, 'audit:lire') || (c.revue ?? 0) > 0,
  },
  { cle: 'audit', href: '/export', libelle: 'Preuves et audit', icone: 'bouclier', droit: 'audit:lire' },
  { cle: 'admin', href: '/admin/applications', libelle: 'Administration', icone: 'reglages', droit: 'admin:gerer' },
];

const SOUS_SECTIONS = {
  audit: [
    { href: '/export', libelle: 'Dossier de preuves', droit: 'export:audit' },
    { href: '/coffre', libelle: 'Intégrité du coffre', droit: 'audit:lire' },
    { href: '/audit', libelle: "Journal d'audit", droit: 'audit:lire' },
    { href: '/indicateurs', libelle: 'Indicateurs', droit: 'audit:lire' },
    { href: '/rapprochements', libelle: 'Rapprochements', droit: 'habilitation:suivre' },
  ],
  admin: [
    { href: '/admin/applications', libelle: 'Applications' },
    { href: '/admin/import', libelle: 'Importer un tableur' },
    { href: '/admin/bibliotheque', libelle: 'Bibliothèque' },
    { href: '/admin/categories', libelle: 'Catégories' },
    { href: '/admin/packs', libelle: 'Packs nouvel arrivant' },
    { href: '/admin/ufs', libelle: 'Unités fonctionnelles' },
    { href: '/admin/sites', libelle: 'Sites' },
    { href: '/admin/utilisateurs', libelle: 'Comptes et référents' },
    { href: '/admin/routage', libelle: 'Notifications' },
    { href: '/admin/api', libelle: 'API' },
    { href: '/admin/configuration', libelle: 'Configuration' },
  ],
};

export function sectionCourante(chemin, vue = '') {
  if (chemin === '/') return 'accueil';
  if (chemin === '/traiter' || chemin.startsWith('/traiter/')) return 'traiter';
  if (chemin.startsWith('/revues')) return 'revues';
  if (chemin.startsWith('/admin')) return 'admin';
  if (['/export', '/coffre', '/audit', '/indicateurs', '/rapprochements'].some((p) => chemin === p || chemin.startsWith(`${p}/`))) return 'audit';
  if (chemin === '/suivi') return vue === 'a-traiter' ? 'traiter' : 'registre';
  if (chemin.startsWith('/habilitations') || chemin.startsWith('/packs')) return 'registre';
  if (chemin === '/mes-demandes') return 'miennes';
  if (chemin === '/depart') return 'depart';
  if (chemin.startsWith('/departs')) return 'departs';
  if (chemin.startsWith('/approbations')) return 'approbations';
  if (chemin.startsWith('/recherche')) return 'agents';
  return '';
}

function navigation(role, section, compteurs = {}) {
  return SECTIONS.filter((s) => (!s.droit || peut(role, s.droit)) && (!s.visible || s.visible(role, compteurs, section)))
    .map((s) => {
      const n = s.compteur ? compteurs[s.compteur] : null;
      const badge = n ? `<span class="n">${n}</span>` : '';
      return `<a href="${s.href}"${section === s.cle ? ' class="actif" aria-current="page"' : ''}>${ICONES[s.icone]}<span>${s.libelle}</span>${badge}</a>`;
    })
    .join('');
}

function sousNavigation(role, section, chemin) {
  const liens = SOUS_SECTIONS[section];
  if (!liens) return '';
  const html = liens
    .filter((l) => !l.droit || peut(role, l.droit))
    .map((l) => `<a href="${l.href}"${chemin === l.href || chemin.startsWith(`${l.href}/`) ? ' class="actif" aria-current="page"' : ''}>${l.libelle}</a>`)
    .join('');
  return html ? `<div class="sous-nav">${html}</div>` : '';
}

// --- Gabarit ----------------------------------------------------------------------

// `opts.large` : pleine largeur. `opts.sous` : ligne de contexte sous le titre.
export function page(req, titre, corps, actions = '', opts = {}) {
  const u = req.session?.utilisateur;
  const role = u?.role;
  const section = sectionCourante(req.path, String(req.query?.vue ?? ''));
  const compteurs = req.compteurs ?? {};
  const recherche = peut(role, 'habilitation:lire')
    ? `<form class="rech" method="get" action="/recherche" role="search">
         <label class="sr" for="q-global">Rechercher un agent</label>
         <input id="q-global" type="search" name="q" placeholder="Agent, matricule, application" value="${echap(req.query?.q ?? '')}">
         ${ICONES.loupe}
       </form>`
    : '';
  const nouvelle = peut(role, 'habilitation:creer')
    ? `<a class="btn btn-primary" href="/habilitations/nouvelle">${ICONES.plus}Nouvelle demande</a>`
    : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
${liensTete()}
<title>${echap(titre)} · ${echap(config.nom)}</title>
<style>${STYLE}${variablesCouleur()}</style></head>
<body>
<a class="evitement" href="#contenu">Aller au contenu</a>
<header class="haut">
  <div class="r1">
    <a class="logo" href="/">
      <span class="chip">${marqueBarre()}</span>
      <span class="marque-nom">${echap(config.nom)}</span>
      ${config.etablissement ? `<span class="et">${echap(config.etablissement)}</span>` : ''}
    </a>
    ${recherche}
    <div class="droite">
      ${nouvelle}
      <div class="qui"><b>${echap(u?.nom ?? '')}</b><span>${LIBELLES_ROLE[role] ?? ''}</span></div>
      <span class="pastille" aria-hidden="true">${echap(initiales(u?.nom))}</span>
      ${peut(role, 'habilitation:valider') ? `<a class="aide-lien" href="/absences"${req.path === '/absences' ? ' aria-current="page"' : ''}>Absences</a>` : ''}
      <a class="aide-lien" href="/aide"${req.path === '/aide' ? ' aria-current="page"' : ''}>Aide</a>
      <a class="sortie" href="/deconnexion">Déconnexion</a>
    </div>
  </div>
  <nav class="r2" aria-label="Navigation principale">${navigation(role, section, compteurs)}</nav>
  ${sousNavigation(role, section, req.path)}
</header>
<main id="contenu" class="page${opts.large ? ' large' : ''}${opts.plein ? ' plein' : ''}">
  ${u?.secours ? `<div class="bandeau b-warn">${ICONES.alerte}<span>Connecté avec un compte local de secours : l'annuaire était injoignable.</span></div>` : ''}
  ${opts.plein ? '' : `<div class="page-tete">
    <div><h1>${echap(titre)}</h1>${opts.sous ? `<div class="sous">${opts.sous}</div>` : ''}</div>
    ${actions ? `<div class="a">${actions}</div>` : ''}
  </div>`}
  ${corps}
</main>
<script nonce="${echap(req.nonce ?? '')}">document.addEventListener('submit',function(e){var f=e.target;if(f&&f.dataset&&f.dataset.confirmer&&!window.confirm(f.dataset.confirmer)){e.preventDefault();}});</script>
</body></html>`;
}

export function pageConnexion(req, { erreur = '' } = {}) {
  const c = couleursEtablissement();
  const styleLogin = `
    body{display:grid;place-items:center;min-height:100vh;background:var(--fond);padding:24px}
    .boite-connexion{width:100%;max-width:400px}
    .tete{text-align:center;margin-bottom:22px}
    .tete .mk{display:block;margin:0 auto 14px}
    .tete .mk svg{width:56px;height:56px;color:var(--accent)}
    .tete .mk img{height:112px;width:auto;max-width:280px;border-radius:20px;display:block;margin:0 auto}
    .tete h1{font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-.02em}
    .tete p{color:var(--encre-2);font-size:13.5px;margin:0}
    .panneau{background:var(--blanc);border:1px solid var(--filet);border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(17,20,24,.08),0 8px 24px -12px rgba(17,20,24,.18);position:relative;overflow:hidden}
    .panneau .filet{position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent)}
    .panneau .btn{width:100%;justify-content:center;margin-top:20px}
    .mode{margin-top:15px;text-align:center;font-size:12px;color:var(--encre-3)}
    .mode b{font-family:var(--mono);color:var(--encre-2);font-weight:500}`;
  const bandeau = erreur
    ? `<div class="bandeau b-err" role="alert">${ICONES.alerte}<span>${echap(erreur)}</span></div>`
    : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
${liensTete()}
<title>Connexion · ${echap(config.nom)}</title>
<style>${STYLE}:root{--accent:${c.accent};--accent-2:${c.accentSombre};--accent-clair:${c.accentClair};--accent-texte:${c.accentTexte};--sur-accent:${c.surAccent}}${styleLogin}</style></head>
<body><div class="boite-connexion">
  <div class="tete"><span class="mk">${glyphe()}</span>
    <h1>${echap(config.nom)}</h1>
    <p>${echap(config.etablissement || "Registre des habilitations et coffre à preuves d'audit")}</p></div>
  <div class="panneau"><div class="filet"></div>${bandeau}
    <form method="post" action="/connexion">
      <label for="login">Identifiant${config.authMode === 'ldap' ? ' (compte Windows)' : ''}</label>
      <input id="login" name="login" autocomplete="username" autofocus required>
      <label for="mdp">Mot de passe</label>
      <input id="mdp" name="motDePasse" type="password" autocomplete="current-password" required>
      <button class="btn btn-primary" type="submit">Se connecter</button>
    </form>
    <div class="mode">Authentification : <b>${echap(config.authMode === 'ldap' ? 'annuaire (LDAP)' : 'comptes locaux')}</b></div>
  </div>
</div></body></html>`;
}

// --- Petits composants ------------------------------------------------------------

export const pluriel = (n, singulier, terminaison = 's') =>
  `${n} ${singulier}${Math.abs(Number(n)) >= 2 ? terminaison : ''}`;

export function joursDepuis(dateIso, maintenant = new Date()) {
  const d = String(dateIso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;
  return Math.floor((Date.parse(`${maintenant.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
}

// Dans une file de traitement, ce qui compte n'est pas la date mais l'attente.
export function depuis(dateIso, maintenant = new Date()) {
  const d = String(dateIso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const jours = Math.floor((Date.parse(`${maintenant.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  if (jours < 31) return `il y a ${pluriel(jours, 'jour')}`;
  if (jours < 365) return `il y a ${pluriel(Math.round(jours / 30), 'mois', '')}`;
  return `il y a ${pluriel(Math.round(jours / 365), 'an')}`;
}

// Le journal stocke des codes ; un auditeur doit lire une phrase.
export const LIB_ACTION = {
  'habilitation:creer': 'a déposé une demande',
  'habilitation:valider': 'a validé la demande',
  'habilitation:executer': "a ouvert l'accès dans l'application",
  'habilitation:revoquer': "a révoqué l'accès",
  'habilitation:refuser': 'a refusé la demande',
  'habilitation:assigner': 'a confié la demande',
  'habilitation:profil': 'a précisé le profil demandé',
  'habilitation:echeance': 'a modifié la date de fin de l’accès',
  'entretien:echeances': 'a demandé la fermeture des accès temporaires échus',
  'habilitation:desassigner': 'a rendu la demande à la file',
  'retrait:demander': 'a demandé la fermeture de l’accès',
  'retrait:refuser': 'a refusé la fermeture',
  'preuve:ajouter': 'a joint une pièce justificative',
  'preuve:consulter': 'a téléchargé une pièce',
  'export:audit': 'a exporté un dossier de preuves',
  'audit:controler': 'a lancé un contrôle complet de la chaîne',
  'relance:envoyer': 'a relancé les demandes en attente',
  'registre:exporter': 'a exporté le registre',
  'indicateurs:exporter': 'a exporté les indicateurs',
  'rapprochement:deposer': "a déposé l'extraction d'une application",
  'rapprochement:analyser': "a rapproché l'extraction du registre",
  'rapprochement:suite': 'a traité un écart de rapprochement',
  'rapprochement:exporter': 'a exporté un rapprochement',
  'rapprochement:telecharger': "a téléchargé l'extraction d'un rapprochement",
  'revue:ouvrir': 'a ouvert une campagne de revue',
  'revue:maintenir': 'a maintenu l’accès après revue',
  'revue:retirer': 'a retiré l’accès après revue',
  'revue:cloturer': 'a clôturé la campagne de revue',
  'revue:exporter': 'a exporté le rapport de revue',
  'pack:appliquer': 'a appliqué un pack nouvel arrivant',
  'pack:creer': 'a créé un pack',
  'pack:modifier': 'a modifié un pack',
  'pack:supprimer': 'a supprimé un pack',
  'pack:element-ajouter': 'a ajouté un accès à un pack',
  'pack:element-retirer': "a retiré un accès d'un pack",
  'application:creer': 'a ajouté une application',
  'application:modifier': 'a modifié une application',
  'application:supprimer': 'a supprimé une application',
  'categorie:creer': 'a créé une catégorie',
  'categorie:supprimer': 'a supprimé une catégorie',
  'uf:creer': 'a créé une unité fonctionnelle',
  'uf:supprimer': 'a supprimé une unité fonctionnelle',
  'site:creer': 'a créé un site',
  'site:supprimer': 'a supprimé un site',
  'utilisateur:creer': 'a créé un compte',
  'utilisateur:modifier': 'a modifié un compte',
  'utilisateur:supprimer': 'a supprimé un compte',
  'referent:perimetre': "a modifié le périmètre d'un référent",
  'parametre:maj': 'a modifié un paramètre',
  'sauvegarde:creee': 'a créé une sauvegarde',
  'import:applications': 'a importé des applications',
  'depart:detecter': 'a recherché les départs non signalés',
  'depart:confirmer': 'a confirmé un départ détecté',
  'depart:ecarter': 'a écarté un départ détecté',
  'accord:donner': 'a donné son accord de cadre',
  'accord:refuser': 'a refusé son accord de cadre',
  'accord:hors-outil': "a enregistré l'accord du cadre obtenu hors de l'outil",
  'uf:responsables': "a désigné les responsables d'une UF",
  'suppleance:creer': 'a organisé une suppléance',
  'suppleance:supprimer': 'a annulé une suppléance',
  'api:jeton-creer': "a créé un jeton d'API",
  'api:jeton-revoquer': "a révoqué un jeton d'API",
  'conservation:purger': 'a appliqué les durées de conservation',
  'application:accord-cadre': "a changé l'exigence d'accord du cadre",
  'import:ufs': 'a importé des unités fonctionnelles',
  'auth:succes': "s'est connecté",
  'auth:echec': 'a échoué à se connecter',
  'auth:bloque': 'a été bloqué après plusieurs échecs',
  'auth:sans-role': "s'est authentifié sans rôle attribué",
  'auth:annuaire-injoignable': "n'a pas pu être vérifié, annuaire injoignable",
  'auth:deconnexion': "s'est déconnecté",
};

export const libelleAction = (action) =>
  `<span title="${echap(action)}">${echap(LIB_ACTION[action] ?? action)}</span>`;

export const tag = (statut) => `<span class="tag t-${echap(statut)}">${echap(LIB_STATUT[statut] ?? statut)}</span>`;

// 2026-09-25 devient 25/09/2026 : la forme que tout le monde lit sans effort.
export const dateFr = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

// Où en est la demande, dit comme on le dirait au guichet.
export function etapeLisible(h, { motifRefus = '', nomDe = (l) => l } = {}) {
  const app = h.app_libelle ?? "l'application";
  if (h.statut === 'demandee') {
    return h.assigne_a ? `En cours d'examen par ${nomDe(h.assigne_a)}` : `En attente de validation par le référent ${app}`;
  }
  if (h.statut === 'validee') return `Validée, en attente d'ouverture dans ${app}`;
  if (h.statut === 'executee') return h.retrait_demande_le ? 'Accès ouvert, fermeture demandée' : 'Accès ouvert';
  if (h.statut === 'revoquee') return 'Accès fermé';
  if (h.statut === 'refusee') return motifRefus ? `Refusée : ${motifRefus}` : 'Refusée';
  return LIB_STATUT[h.statut] ?? h.statut;
}
export const tagRole = (role) => `<span class="tag r-${echap(role)}">${echap(LIBELLES_ROLE[role] ?? role)}</span>`;
// Faute de logo, un monogramme dont la teinte est tirée du code.
export const teinteCode = (code) => {
  const s = String(code ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

export const logoApp = (a) =>
  a.logo
    ? `<img src="/logos/${encodeURIComponent(a.logo)}" alt="">`
    : `<span class="ph" style="--t:${teinteCode(a.code)}">${echap(String(a.code ?? '?').slice(0, 3))}</span>`;
export const initiales = (nom) =>
  String(nom ?? '').trim().split(/\s+/).slice(0, 2).map((m) => m[0]?.toUpperCase() ?? '').join('') || '?';
export const item = (label, val) => `<div class="item"><span class="micro">${label}</span><span class="val">${val}</span></div>`;
export const bandeauErreur = (msg) => `<div class="bandeau b-err" role="alert">${ICONES.alerte}<span>${echap(msg)}</span></div>`;
export const bandeauOk = (msg) => `<div class="bandeau b-ok">${ICONES.bouclier}<span>${echap(msg)}</span></div>`;
export const bandeauAlerte = (msg, lien = '') =>
  `<div class="bandeau b-warn">${ICONES.alerte}<span>${echap(msg)}</span>${lien ? `<span class="r">${lien}</span>` : ''}</div>`;

// items = [{ label, n }]
export const barres = (items) => {
  const max = Math.max(1, ...items.map((x) => x.n));
  return `<div class="barres">${
    items
      .map(
        (x) => `<div class="bl"><div class="bl-l" title="${echap(x.label)}">${echap(x.label)}</div>
        <div class="bl-t"><div class="bl-f" style="width:${Math.round((x.n / max) * 100)}%"></div></div>
        <div class="bl-n">${x.n}</div></div>`,
      )
      .join('') || '<span style="color:var(--encre-3)">Aucune donnée.</span>'
  }</div>`;
};

export function pageErreur(req, titre, message, retour = '/') {
  return page(req, titre, `${bandeauErreur(message)}<a class="btn btn-ghost" href="${echap(retour)}">Retour</a>`);
}
