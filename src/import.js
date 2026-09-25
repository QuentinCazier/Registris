// Import du catalogue et des unités fonctionnelles depuis un tableur enregistré en CSV.

import { ouvrirDb, transaction } from './db.js';
import { tracer } from './audit.js';
import { creerApplication, creerCategorie, modifierApplication, normaliserProfils } from './administration.js';
import { decoder, lireCsv } from './rapprochements.js';
import { definirResponsablesUf } from './accords.js';

const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export const MODELE_APPLICATIONS = [
  ['Code', 'Libellé', 'Catégorie', 'Référents', 'Profils', 'Accord du cadre'],
  ['GAM', 'Gestion administrative des malades', 'Gestion administrative', 'jdupont, mmartin', 'Admissions, Facturation, Consultation', 'non'],
  ['DPI', 'Dossier patient informatisé', 'Dossier patient et soins', 'pdurand', 'Soignant, Médecin, Secrétaire médicale', 'oui'],
];
export const MODELE_UFS = [
  ['Code', 'Libellé', 'Cadres'],
  ['1101', 'Médecine polyvalente', 'cadre.medecine'],
  ['2401', 'Urgences', 'cadre.urgences, cadre.nuit'],
];
const OUI = /^(oui|o|yes|y|1|x|vrai|true)$/i;

// Colonnes reconnues par leur en-tête ; sans en-tête, dans l'ordre du modèle.
function colonnes(lignes, attendues) {
  const entete = lignes[0].map(sansAccents);
  const index = {};
  for (const [cle, motifs] of Object.entries(attendues)) {
    const i = entete.findIndex((n) => motifs.some((m) => m.test(n)));
    if (i >= 0) index[cle] = i;
  }
  if (Object.keys(index).length) return { index, donnees: lignes.slice(1), decalage: 2 };
  return { index: Object.fromEntries(Object.keys(attendues).map((c, i) => [c, i])), donnees: lignes, decalage: 1 };
}

const liste = (v) => String(v ?? '').split(/[,|\n]/).map((x) => x.trim()).filter(Boolean);

export function importerApplications(acteur, tampon) {
  const { lignes } = lireCsv(decoder(tampon));
  if (!lignes.length) throw new Error('Le fichier est vide.');
  const { index, donnees, decalage } = colonnes(lignes, {
    code: [/^code/], libelle: [/libelle/, /^nom/, /application/], categorie: [/categ/, /famille/, /domaine/],
    referents: [/referent/], profils: [/profil/, /role/, /droit/], accord: [/accord/, /cadre/, /approbation/],
  });
  if (index.code === undefined) throw new Error('Colonne « Code » introuvable.');
  const db = ouvrirDb();
  const bilan = { creees: 0, modifiees: 0, referents: 0, erreurs: [] };
  const cellule = (l, cle) => (index[cle] === undefined ? '' : String(l[index[cle]] ?? '').trim());
  transaction(() => {
    donnees.forEach((l, i) => {
      const numero = i + decalage;
      try {
        const code = cellule(l, 'code').toUpperCase();
        if (!code) throw new Error('code vide');
        const libelle = cellule(l, 'libelle');
        const nomCat = cellule(l, 'categorie');
        let categorieId = null;
        if (nomCat) {
          const cat = db.prepare('SELECT id FROM categories WHERE libelle = ? COLLATE NOCASE').get(nomCat);
          categorieId = cat ? cat.id : creerCategorie(acteur, { libelle: nomCat });
        }
        const profils = liste(cellule(l, 'profils')).join('\n');
        const existante = db.prepare('SELECT id FROM applications WHERE code = ?').get(code);
        let id;
        if (existante) {
          id = existante.id;
          modifierApplication(acteur, id, {
            libelle: libelle || undefined,
            categorieId: categorieId ?? undefined,
            profils: profils ? normaliserProfils(profils) : undefined,
            accordCadre: cellule(l, 'accord') ? OUI.test(cellule(l, 'accord')) : undefined,
          });
          bilan.modifiees += 1;
        } else {
          if (!libelle) throw new Error(`libellé manquant pour ${code}`);
          id = creerApplication(acteur, { code, libelle, categorieId, profils });
          if (OUI.test(cellule(l, 'accord'))) modifierApplication(acteur, id, { accordCadre: true });
          bilan.creees += 1;
        }
        const lien = db.prepare('INSERT OR IGNORE INTO referent_applications (login, application_id) VALUES (?, ?)');
        for (const login of liste(cellule(l, 'referents'))) {
          if (!/^[\w.@\\-]{1,100}$/.test(login)) throw new Error(`identifiant de référent invalide : ${login}`);
          bilan.referents += lien.run(login.toLowerCase(), id).changes;
        }
      } catch (e) {
        bilan.erreurs.push({ ligne: numero, message: e.message });
      }
    });
    tracer(acteur, 'import:applications', { details: { creees: bilan.creees, modifiees: bilan.modifiees, referents: bilan.referents, erreurs: bilan.erreurs.length } });
  });
  return bilan;
}

export function importerUfs(acteur, tampon) {
  const { lignes } = lireCsv(decoder(tampon));
  if (!lignes.length) throw new Error('Le fichier est vide.');
  const { index, donnees, decalage } = colonnes(lignes, { code: [/^code/, /^uf$/, /numero/], libelle: [/libelle/, /^nom/, /intitule/], cadres: [/cadre/, /responsable/] });
  if (index.code === undefined || index.libelle === undefined) throw new Error('Colonnes « Code » et « Libellé » introuvables.');
  const db = ouvrirDb();
  const bilan = { creees: 0, modifiees: 0, erreurs: [] };
  transaction(() => {
    donnees.forEach((l, i) => {
      const code = String(l[index.code] ?? '').trim();
      const libelle = String(l[index.libelle] ?? '').trim();
      if (!code || !libelle) {
        bilan.erreurs.push({ ligne: i + decalage, message: 'code ou libellé vide' });
        return;
      }
      const r = db.prepare('UPDATE ufs SET libelle = ? WHERE code = ? AND libelle <> ?').run(libelle, code, libelle);
      if (r.changes) bilan.modifiees += 1;
      else if (!db.prepare('SELECT 1 FROM ufs WHERE code = ?').get(code)) {
        db.prepare('INSERT INTO ufs (code, libelle) VALUES (?, ?)').run(code, libelle);
        bilan.creees += 1;
      }
      const cadres = index.cadres === undefined ? '' : String(l[index.cadres] ?? '').trim();
      if (cadres) {
        try {
          definirResponsablesUf(acteur, db.prepare('SELECT id FROM ufs WHERE code = ?').get(code).id, cadres);
        } catch (e) {
          bilan.erreurs.push({ ligne: i + decalage, message: e.message });
        }
      }
    });
    tracer(acteur, 'import:ufs', { details: { creees: bilan.creees, modifiees: bilan.modifiees, erreurs: bilan.erreurs.length } });
  });
  return bilan;
}
