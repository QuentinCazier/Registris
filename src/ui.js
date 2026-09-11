/**
 * Couche de présentation : feuille de style, icônes, gabarit de page et petits
 * composants. Rendu HTML côté serveur, sans framework. Thème clair, barre latérale
 * sombre, accessible au clavier.
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { peut, LIBELLES_ROLE } from './roles.js';
import { LIB_STATUT } from './habilitations.js';

export const echap = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Sérialise un objet en littéral JS sûr à inliner dans un <script>. */
export const jsonInline = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONES = {
  cle: svg('<circle cx="8.5" cy="14.5" r="4.5"/><path d="M11.5 11.5 20 3"/><path d="M16.5 6.5l2.5 2.5"/><path d="M14 9l2.5 2.5"/>'),
  grille: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  loupe: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  liste: svg('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  coffre: svg('<path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path d="M12 3v11"/><path d="M8 10l4 4 4-4"/>'),
  journal: svg('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="3.6" cy="6" r="1.1"/><circle cx="3.6" cy="12" r="1.1"/><circle cx="3.6" cy="18" r="1.1"/>'),
  apps: svg('<path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z"/><path d="M3 12l9 4.5 9-4.5"/>'),
  users: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.6 19c0-3 2.4-5 5.4-5s5.4 2 5.4 5"/><path d="M16.2 5.6a3 3 0 0 1 0 5.8"/><path d="M20.4 19c0-2.2-1.3-3.9-3.2-4.6"/>'),
  batiment: svg('<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 21V9h4a1 1 0 0 1 1 1v11"/><path d="M8 8h3M8 12h3M8 16h3"/><path d="M3 21h18"/>'),
  routage: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/>'),
  pack: svg('<path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5"/><path d="M12 12v9"/>'),
  colonnes: svg('<rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="9.5" y="4" width="5" height="11" rx="1.2"/><rect x="16" y="4" width="5" height="14" rx="1.2"/>'),
  bouclier: svg('<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  uf: svg('<path d="M4 20V9l8-5 8 5v11"/><path d="M4 20h16"/><path d="M9 20v-6h6v6"/>'),
};

// Ressources de marque : tout fichier déposé dans public/ prime sur le pictogramme.
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

export function glyphe() {
  const logo = trouverAsset(['logo.svg', 'logo.png', 'logo.webp']);
  return logo ? `<img src="/${logo}${versionAsset(logo)}" alt="${echap(config.nom)}">` : ICONES.cle;
}

function liensTete() {
  const favicon = trouverAsset(['favicon.ico', 'favicon.png', 'logo.png']);
  const apple = trouverAsset(['apple-touch-icon.png', 'logo.png']);
  let h = `<meta name="theme-color" content="${config.themeColor}">`;
  if (favicon) {
    const t = favicon.endsWith('.svg') ? ' type="image/svg+xml"' : '';
    h += `<link rel="icon"${t} href="/${favicon}${versionAsset(favicon)}">`;
  }
  if (apple) h += `<link rel="apple-touch-icon" href="/${apple}${versionAsset(apple)}">`;
  return h;
}

export const STYLE = `
:root{
  --sans:"Segoe UI Variable Display","Segoe UI",-apple-system,system-ui,"Inter",Roboto,Arial,sans-serif;
  --mono:"Cascadia Mono","Consolas",ui-monospace,"SF Mono","Liberation Mono",monospace;
  --paper:#f6f8fa; --surface:#ffffff; --surface-2:#f3f6f8; --surface-3:#eaeff3;
  --border:#e4e9ee; --border-strong:#cfd8e0;
  --ink:#101a24; --ink-2:#55616d; --ink-3:#88939e;
  --accent:#1b4977; --accent-ink:#153a5f; --accent-soft:#e6edf5; --accent-bd:#b9cce0;
  --demande:#9a6a00; --demande-bg:#fbf2dd; --demande-bd:#ecd9a8;
  --valide:#1f6fd6; --valide-bg:#e7f0fd; --valide-bd:#c5dbf6;
  --execute:#0e8f5d; --execute-bg:#e3f5ec; --execute-bd:#bce7d2;
  --revoque:#c0392b; --revoque-bg:#fbeae8; --revoque-bd:#f1c9c3;
  --shadow:0 1px 2px rgba(16,30,45,.04),0 6px 16px -8px rgba(16,30,45,.10);
}
*{box-sizing:border-box}
body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--paper);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--accent-ink);text-decoration:none}
a:hover{text-decoration:underline}
.mono{font-family:var(--mono);font-feature-settings:"tnum" 1}
.micro{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);font-weight:700}
.sr{position:absolute;left:-9999px}

.app{display:grid;grid-template-columns:242px 1fr;min-height:100vh}
.barre{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#0f1c33,#1a2e50);
  border-right:1px solid #0a142b;padding:18px 14px;overflow:hidden;--sb-txt:#aab6c8;--sb-mut:#6b7790;--sb-hover:rgba(255,255,255,.08)}
.barre a{color:var(--sb-txt)}
.nav-zone{flex:1 1 auto;min-height:0;overflow-y:auto;margin:0 -4px;padding:0 4px 2px;scrollbar-width:thin}
.util{padding:2px 8px 14px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,.08)}
.util b{display:block;font-size:14px;font-weight:650;line-height:1.2;color:#f2f6f8}
.util .role{font-size:12px;color:var(--sb-mut)}
.util .out{display:inline-block;margin-top:9px;font-size:12.5px;color:#86bedd}
.nav-sec{margin:15px 10px 6px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--sb-mut);font-weight:700}
.nav a{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:9px;color:var(--sb-txt);font-weight:550;font-size:14px;position:relative}
.nav a svg{width:18px;height:18px;flex:none;color:var(--sb-mut)}
.nav a:hover{background:var(--sb-hover);color:#fff;text-decoration:none}
.nav a.actif{background:rgba(59,120,170,.36);color:#fff;font-weight:650}
.nav a.actif svg{color:#8cc3e6}
.nav a.actif::before{content:"";position:absolute;left:-14px;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:#4d9ccb}
.bas{margin-top:auto;border-top:1px solid rgba(255,255,255,.08);padding-top:16px;text-align:center}
.bas .mk-bas img{max-height:72px;max-width:180px;width:auto;height:auto;border-radius:12px;display:block;margin:0 auto;background:#fff;padding:8px}
.bas .mk-bas svg{width:30px;height:30px;color:#8cc3e6}
.bas .nomapp{display:block;font-size:11px;letter-spacing:.04em;color:var(--sb-mut);margin-top:8px}

.principal{min-width:0}
.page{max-width:1180px;margin:0 auto;padding:26px 30px 64px}
.page.large{max-width:1520px}
.entete{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:0 0 24px;padding-bottom:14px;border-bottom:1px solid var(--border)}
.entete h1{font-size:26px;font-weight:690;margin:0;letter-spacing:-.022em}
.entete > div{display:flex;gap:10px;flex-wrap:wrap}
section{margin-top:32px}
section>h2{font-size:16.5px;font-weight:670;margin:0 0 13px;letter-spacing:-.012em}
.carte{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px 24px;box-shadow:var(--shadow)}
.carte+.carte{margin-top:16px}
.tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:14px}
.tuile{display:block;color:inherit;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:15px 18px;box-shadow:var(--shadow)}
a.tuile:hover{border-color:var(--accent-bd);text-decoration:none}
.tuile.alerte{border-color:var(--demande-bd);background:var(--demande-bg)}
.tuile.alerte .v{color:var(--demande)}
.tuile .v{font-family:var(--mono);font-size:29px;font-weight:600;line-height:1;color:var(--ink)}
.tuile .l{margin-top:9px}

table{width:100%;border-collapse:separate;border-spacing:0;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
thead th{background:var(--surface-2);text-align:left;padding:9px 14px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);font-weight:700;border-bottom:1px solid var(--border)}
tbody td{padding:11px 14px;border-bottom:1px solid var(--border);font-size:13.5px;vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--surface-2)}
td .mono,.matricule{font-family:var(--mono);font-size:12.5px}
.tag{display:inline-block;padding:2px 9px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border:1px solid}
.t-demandee{color:var(--demande);background:var(--demande-bg);border-color:var(--demande-bd)}
.t-validee{color:var(--valide);background:var(--valide-bg);border-color:var(--valide-bd)}
.t-executee{color:var(--execute);background:var(--execute-bg);border-color:var(--execute-bd)}
.t-revoquee{color:var(--revoque);background:var(--revoque-bg);border-color:var(--revoque-bd)}
.r-admin{color:#5a3c86;background:#efe9f5;border-color:#d8c9e8}
.r-referent{color:var(--valide);background:var(--valide-bg);border-color:var(--valide-bd)}
.r-controleur{color:var(--execute);background:var(--execute-bg);border-color:var(--execute-bd)}
.r-utilisateur{color:var(--ink-2);background:var(--surface-3);border-color:var(--border-strong)}

.btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-weight:600;font-size:13.5px;padding:9px 15px;border-radius:9px;border:1px solid transparent;cursor:pointer;line-height:1;text-decoration:none}
.btn svg{width:16px;height:16px}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn-primary:hover{background:var(--accent-ink);text-decoration:none}
.btn-ghost{background:var(--surface);color:var(--ink);border-color:var(--border-strong)}
.btn-ghost:hover{background:var(--surface-2);text-decoration:none}
.btn-danger{background:var(--surface);color:var(--revoque);border-color:var(--revoque-bd)}
.btn-danger:hover{background:var(--revoque-bg);text-decoration:none}
.btn-petit{padding:6px 11px;font-size:12.5px}
.btn:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

label{display:block;font-weight:600;font-size:13px;margin:14px 0 6px;color:var(--ink)}
label:first-child{margin-top:0}
label .opt{font-weight:400;color:var(--ink-3)}
input,select,textarea{width:100%;font:inherit;font-size:14px;padding:9px 11px;color:var(--ink);background:var(--surface);border:1px solid var(--border-strong);border-radius:9px}
input[type=file]{padding:7px 9px}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
input[readonly]{background:var(--surface-2);color:var(--ink-2)}
textarea{min-height:92px;resize:vertical}
.champ-aide{font-size:12.5px;color:var(--ink-3);margin-top:5px}
.grille2{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
.radios{display:flex;gap:10px;flex-wrap:wrap}
.radio{display:inline-flex;align-items:center;gap:8px;margin:0;font-weight:500;cursor:pointer;border:1px solid var(--border-strong);border-radius:9px;padding:9px 13px;background:var(--surface)}
.radio input{width:auto;margin:0}
form .actions{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
.actions-ligne{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 18px;align-items:center}
.actions-ligne form{display:inline}
.filtres{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px}
.filtres > div{min-width:160px}
.filtres label{margin-top:0}

.fiche-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0 28px}
.fiche-meta .item{padding:10px 0;border-bottom:1px solid var(--border)}
.fiche-meta .item .micro{display:block;margin-bottom:4px}
.fiche-meta .item .val{font-size:14px}
.vide{border:1px dashed var(--border-strong);border-radius:12px;padding:28px;text-align:center;color:var(--ink-3);background:var(--surface-2);font-size:13.5px}
.bandeau{display:flex;align-items:center;gap:9px;padding:11px 15px;border-radius:7px;font-size:13.5px;font-weight:550;margin-bottom:20px;border:1px solid}
.b-ok{color:var(--execute);background:var(--execute-bg);border-color:var(--execute-bd)}
.b-err{color:var(--revoque);background:var(--revoque-bg);border-color:var(--revoque-bd)}
.b-warn{color:var(--demande);background:var(--demande-bg);border-color:var(--demande-bd)}
.groupe-agent{margin-bottom:24px}
.groupe-agent .entete-a{display:flex;align-items:baseline;gap:12px;margin:0 0 9px}
.groupe-agent .entete-a h3{letter-spacing:-.015em;font-size:16px;font-weight:600;margin:0}
code.hash{font-family:var(--mono);font-size:12px;color:var(--ink-2);background:var(--surface-3);padding:2px 6px;border-radius:4px}
.deux-col{display:grid;grid-template-columns:1.1fr .9fr;gap:22px;align-items:start}
.histo{margin:0;padding:0;list-style:none}
.histo li{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}
.histo li:last-child{border-bottom:0}
.histo .q{font-family:var(--mono);font-size:12px;color:var(--ink-2)}

.board{display:flex;gap:14px;overflow-x:auto;padding:2px 0 12px}
.col{flex:1 1 0;min-width:230px;display:flex;flex-direction:column}
.col-head{display:flex;align-items:center;gap:8px;padding:11px 4px 10px;border-top:3px solid var(--cc,var(--border-strong));margin-bottom:11px}
.col-head .t{font-weight:700;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-2)}
.col-head .n{font-weight:700;font-size:11.5px;color:#fff;background:var(--cc,var(--ink-3));border-radius:20px;padding:1px 8px;margin-left:auto}
.col-body{display:flex;flex-direction:column;gap:10px}
.ticket{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px 14px;box-shadow:var(--shadow)}
.ticket .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}
.ticket .id{font-weight:700;font-size:13px;color:var(--ink)}
.ticket .date{font-size:11px;color:var(--ink-3)}
.ticket .titre{font-weight:600;font-size:13.5px;line-height:1.35;margin:0 0 9px;color:var(--ink);display:block}
.ticket .who{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2)}
.av{width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent-ink);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}
.ticket .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px;padding-top:11px;border-top:1px solid var(--border)}
.ticket .acts form{display:inline}
.col-vide{border:1px dashed var(--border-strong);border-radius:12px;padding:26px 14px;text-align:center;color:var(--ink-3);font-size:12.5px;background:var(--surface-2)}
.barres{display:flex;flex-direction:column;gap:9px}
.bl{display:grid;grid-template-columns:150px 1fr 46px;align-items:center;gap:10px;font-size:13px}
.bl-l{color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bl-t{height:12px;background:var(--surface-3);border-radius:20px;overflow:hidden}
.bl-f{height:100%;background:var(--accent);border-radius:20px;min-width:3px}
.bl-n{font-family:var(--mono);text-align:right}

.cat-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:22px;overflow-x:auto}
.cat-tabs a{flex:1 1 auto;text-align:center;padding:10px;font-size:13px;font-weight:550;color:var(--ink-2);border-bottom:2.5px solid transparent;margin-bottom:-1px;white-space:nowrap}
.cat-tabs a:hover{color:var(--ink);text-decoration:none}
.cat-tabs a.actif{color:var(--accent-ink);border-bottom-color:var(--accent);font-weight:650}
.cat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media(max-width:1080px){.cat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:640px){.cat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.srv{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:17px;box-shadow:var(--shadow)}
.srv:hover{border-color:var(--accent-bd)}
.ico{width:46px;height:46px;border-radius:11px;background:var(--surface-3);display:grid;place-items:center;overflow:hidden;border:1px solid var(--border)}
.ico img{width:100%;height:100%;object-fit:contain}
.ico .ph{font-family:var(--mono);font-weight:700;color:var(--accent);font-size:13px}
.ico svg{width:22px;height:22px;color:var(--accent)}
.srv .ico{margin-bottom:12px}
.srv .n{font-weight:600;font-size:14.5px;line-height:1.3;margin-bottom:3px}
.srv .c{font-size:12px;color:var(--ink-3);margin-bottom:14px}
.srv .b{margin-top:auto}
.srv-tete{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.srv-tete h2{letter-spacing:-.015em;font-size:18px;margin:0}
.srv-tete .c{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.raccourcis{display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:14px;margin-bottom:30px}
.rac{display:flex;align-items:center;gap:15px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px 20px;box-shadow:var(--shadow);color:var(--ink)}
.rac:hover{border-color:var(--accent);text-decoration:none}
.rac .ic{width:44px;height:44px;border-radius:10px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;flex:none}
.rac .ic svg{width:22px;height:22px}
.rac .t{font-weight:650;font-size:15px;display:block}
.rac .d{font-size:12.5px;color:var(--ink-3);margin-top:2px;display:block}
.aide{font-size:13.5px;color:var(--ink-2);margin:0 0 16px}

@media (max-width:820px){
  .app{grid-template-columns:1fr}
  .barre{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 14px;overflow:visible}
  .util{border:0;margin:0;padding:0 8px 0 4px;order:1}
  .bas{margin:0 0 0 auto;border:0;padding:0;order:2}
  .bas .mk-bas img{max-height:40px;padding:5px}
  .bas .nomapp{display:none}
  .nav-zone{flex:none;width:100%;order:3;overflow:visible;margin:0;padding:0}
  .nav-sec{display:none}
  .nav{display:flex;flex-wrap:wrap;gap:3px;width:100%}
  .deux-col,.grille2{grid-template-columns:1fr}
  .page{padding:18px}
  .histo li{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/** Sections de menu, filtrées par droit. */
function navigation(role, chemin) {
  const HREFS = new Set([
    '/', '/recherche', '/habilitations/nouvelle', '/packs', '/mes-demandes', '/suivi',
    '/export', '/audit', '/coffre',
    '/admin/applications', '/admin/categories', '/admin/packs', '/admin/ufs', '/admin/sites',
    '/admin/utilisateurs', '/admin/routage',
  ]);
  const actif = (href) => {
    if (chemin === href) return 'actif';
    if (href === '/') return '';
    return chemin.startsWith(href + '/') && !HREFS.has(chemin) ? 'actif' : '';
  };
  const lien = (href, icone, txt, droit) =>
    !droit || peut(role, droit)
      ? `<a href="${href}" class="${actif(href)}">${ICONES[icone]}<span>${txt}</span></a>`
      : '';
  const section = (titre, liens) => {
    const l = liens.filter(Boolean).join('');
    return l ? `<div class="nav-sec">${titre}</div><nav class="nav">${l}</nav>` : '';
  };
  return [
    section('Registre', [
      lien('/', 'grille', 'Tableau de bord'),
      lien('/recherche', 'loupe', 'Rechercher un agent', 'habilitation:lire'),
      lien('/habilitations/nouvelle', 'plus', 'Nouvelle demande', 'habilitation:creer'),
      lien('/packs', 'pack', 'Nouvel arrivant', 'habilitation:creer'),
      lien('/mes-demandes', 'liste', 'Mes demandes'),
      lien('/suivi', 'colonnes', 'Suivi des demandes', 'habilitation:suivre'),
    ]),
    section('Audit', [
      lien('/export', 'coffre', 'Dossier de preuves', 'export:audit'),
      lien('/coffre', 'bouclier', 'Intégrité du coffre', 'audit:lire'),
      lien('/audit', 'journal', "Journal d'audit", 'audit:lire'),
    ]),
    section('Administration', [
      lien('/admin/applications', 'apps', 'Applications', 'admin:gerer'),
      lien('/admin/categories', 'grille', 'Catégories', 'admin:gerer'),
      lien('/admin/packs', 'pack', 'Packs nouvel arrivant', 'admin:gerer'),
      lien('/admin/ufs', 'uf', 'Unités fonctionnelles', 'admin:gerer'),
      lien('/admin/sites', 'batiment', 'Sites', 'admin:gerer'),
      lien('/admin/utilisateurs', 'users', 'Comptes et référents', 'admin:gerer'),
      lien('/admin/routage', 'routage', 'Notifications', 'admin:gerer'),
    ]),
  ].join('');
}

/** Gabarit de page. `opts.large` : pleine largeur. */
export function page(req, titre, corps, actions = '', opts = {}) {
  const u = req.session?.utilisateur;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
${liensTete()}
<title>${echap(titre)} · ${echap(config.nom)}</title>
<style>${STYLE}</style></head>
<body><div class="app">
  <aside class="barre">
    <div class="util">
      <b>${echap(u?.nom ?? '')}</b>
      <span class="role">${LIBELLES_ROLE[u?.role] ?? ''}</span>
      <a class="out" href="/deconnexion">Déconnexion</a>
    </div>
    <div class="nav-zone">${navigation(u?.role, req.path)}</div>
    <div class="bas">
      <a class="mk-bas" href="/" aria-label="${echap(config.nom)}">${glyphe()}</a>
      <span class="nomapp">${echap(config.etablissement || config.nom)}</span>
    </div>
  </aside>
  <div class="principal"><main class="page${opts.large ? ' large' : ''}">
    <div class="entete"><h1>${echap(titre)}</h1><div>${actions}</div></div>
    ${corps}
  </main></div>
</div>
<script nonce="${echap(req.nonce ?? '')}">document.addEventListener('submit',function(e){var f=e.target;if(f&&f.dataset&&f.dataset.confirmer&&!window.confirm(f.dataset.confirmer)){e.preventDefault();}});</script>
</body></html>`;
}

export function pageConnexion(req, { erreur = '' } = {}) {
  const styleLogin = `
    body{display:grid;place-items:center;min-height:100vh;background:#f6f8fa;padding:24px}
    .boite{width:100%;max-width:382px}
    .tete{text-align:center;margin-bottom:24px}
    .tete .mk{display:block;margin:0 auto 14px;color:var(--accent)}
    .tete .mk svg{width:56px;height:56px}
    .tete .mk img{height:120px;width:auto;max-width:300px;border-radius:22px;display:block;margin:0 auto}
    .tete h1{font-size:22px;margin:0 0 4px;letter-spacing:-.02em}
    .tete p{color:var(--ink-2);font-size:14px;margin:0}
    .panneau{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:26px;box-shadow:0 2px 10px rgba(29,34,41,.07);position:relative;overflow:hidden}
    .panneau .filet{position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent)}
    .panneau .btn{width:100%;justify-content:center;margin-top:22px}
    .mode{margin-top:16px;text-align:center;font-size:12px;color:var(--ink-3)}
    .mode b{font-family:var(--mono);color:var(--ink-2)}`;
  const bandeau = erreur ? `<div class="bandeau b-err" role="alert"><span>${echap(erreur)}</span></div>` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
${liensTete()}
<title>Connexion · ${echap(config.nom)}</title>
<style>${STYLE}${styleLogin}</style></head>
<body><div class="boite">
  <div class="tete"><span class="mk">${glyphe()}</span>
    <h1>${echap(config.nom)}</h1>
    <p>${echap(config.etablissement || "Registre des habilitations et preuves d'audit")}</p></div>
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

export const tag = (statut) => `<span class="tag t-${echap(statut)}">${echap(LIB_STATUT[statut] ?? statut)}</span>`;
export const tagRole = (role) => `<span class="tag r-${echap(role)}">${echap(LIBELLES_ROLE[role] ?? role)}</span>`;
export const logoApp = (a) =>
  a.logo
    ? `<img src="/logos/${encodeURIComponent(a.logo)}" alt="">`
    : `<span class="ph">${echap(String(a.code ?? '?').slice(0, 3))}</span>`;
export const initiales = (nom) =>
  String(nom ?? '').trim().split(/\s+/).slice(0, 2).map((m) => m[0]?.toUpperCase() ?? '').join('') || '?';
export const item = (label, val) => `<div class="item"><span class="micro">${label}</span><span class="val">${val}</span></div>`;
export const bandeauErreur = (msg) => `<div class="bandeau b-err" role="alert"><span>${echap(msg)}</span></div>`;
export const bandeauOk = (msg) => `<div class="bandeau b-ok"><span>${echap(msg)}</span></div>`;

/** Barres horizontales. items = [{ label, n }]. */
export const barres = (items) => {
  const max = Math.max(1, ...items.map((x) => x.n));
  return `<div class="barres">${
    items
      .map(
        (x) => `<div class="bl"><div class="bl-l" title="${echap(x.label)}">${echap(x.label)}</div>
        <div class="bl-t"><div class="bl-f" style="width:${Math.round((x.n / max) * 100)}%"></div></div>
        <div class="bl-n">${x.n}</div></div>`,
      )
      .join('') || '<span style="color:var(--ink-3)">Aucune donnée.</span>'
  }</div>`;
};

/** Board par colonnes. colonnes = [{ titre, couleur, cartes: [html] }]. */
export const tableauColonnes = (colonnes) =>
  `<div class="board">${colonnes
    .map(
      (c) => `<div class="col">
        <div class="col-head" style="--cc:${c.couleur}"><span class="t">${echap(c.titre)}</span><span class="n">${c.cartes.length}</span></div>
        <div class="col-body">${c.cartes.join('') || '<div class="col-vide">Aucune</div>'}</div>
      </div>`,
    )
    .join('')}</div>`;

/** Page d'erreur simple (400/404/500) dans le gabarit, avec lien de retour. */
export function pageErreur(req, titre, message, retour = '/') {
  return page(req, titre, `${bandeauErreur(message)}<a class="btn btn-ghost" href="${echap(retour)}">Retour</a>`);
}
