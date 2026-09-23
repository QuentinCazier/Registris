import test from 'node:test';
import assert from 'node:assert/strict';

import './_env.js';

const { analyserDotEnv } = await import('../src/config.js');

test('.env : commentaires ignorés, guillemets retirés, signe égal conservé dans la valeur', () => {
  const texte = [
    '# commentaire', 'A=1', 'B="deux mots"', "C='trois'", 'D=a=b', 'E=', '', 'SANS_EGAL', '  F = espaces  ',
  ].join('\n');
  assert.deepEqual(analyserDotEnv(texte), { A: '1', B: 'deux mots', C: 'trois', D: 'a=b', E: '', F: 'espaces' });
});

test(".env : un guillemet seul n'est pas retiré", () => {
  assert.deepEqual(analyserDotEnv('A="ouvert\nB=ferme"'), { A: '"ouvert', B: 'ferme"' });
});
