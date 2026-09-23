// Écriture CSV partagée par les exports ; une cellule qui commence par un signe de calcul est neutralisée.

const DEBUT_DE_FORMULE = /^[=+\-@\t\r]/;

export function champCsv(valeur) {
  let s = String(valeur ?? '');
  if (DEBUT_DE_FORMULE.test(s)) s = `'${s}`;
  return /[";\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const ligneCsv = (cellules) => cellules.map(champCsv).join(';');

// BOM et CRLF : Excel ouvre alors le fichier sans étape d'import.
export const fichierCsv = (lignes) => `﻿${lignes.map(ligneCsv).join('\r\n')}\r\n`;
