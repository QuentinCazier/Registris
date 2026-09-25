// Sessions web en base SQLite : elles survivent à un redémarrage et ne s'accumulent pas en mémoire.

import session from 'express-session';

import { ouvrirDb } from './db.js';

const DUREE_PAR_DEFAUT = 8 * 3600 * 1000;

export class MagasinSessions extends session.Store {
  constructor({ purgeMs = 3600 * 1000 } = {}) {
    super();
    this.purger();
    if (purgeMs > 0) this.minuterie = setInterval(() => this.purger(), purgeMs).unref();
  }

  static expiration(s) {
    const t = s?.cookie?.expires ? new Date(s.cookie.expires).getTime() : NaN;
    return Number.isFinite(t) ? t : Date.now() + (s?.cookie?.maxAge ?? DUREE_PAR_DEFAUT);
  }

  get(sid, cb) {
    try {
      const r = ouvrirDb().prepare('SELECT donnees, expire FROM sessions WHERE sid = ?').get(sid);
      if (!r) return cb(null, null);
      if (r.expire <= Date.now()) return this.destroy(sid, () => cb(null, null));
      return cb(null, JSON.parse(r.donnees));
    } catch (e) {
      return cb(e);
    }
  }

  /** @param {(erreur?: any) => void} [cb] */
  set(sid, s, cb = () => {}) {
    try {
      ouvrirDb()
        .prepare('INSERT OR REPLACE INTO sessions (sid, expire, donnees) VALUES (?, ?, ?)')
        .run(sid, MagasinSessions.expiration(s), JSON.stringify(s));
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  /** @param {(erreur?: any) => void} [cb] */
  touch(sid, s, cb = () => {}) {
    try {
      ouvrirDb().prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(MagasinSessions.expiration(s), sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  /** @param {(erreur?: any) => void} [cb] */
  destroy(sid, cb = () => {}) {
    try {
      ouvrirDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  length(cb) {
    try {
      cb(null, ouvrirDb().prepare('SELECT COUNT(*) n FROM sessions').get().n);
    } catch (e) {
      cb(e);
    }
  }

  purger(maintenant = Date.now()) {
    return ouvrirDb().prepare('DELETE FROM sessions WHERE expire <= ?').run(maintenant).changes;
  }

  fermer() {
    if (this.minuterie) clearInterval(this.minuterie);
  }
}
