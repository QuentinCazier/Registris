// Ce que Registris ajoute aux objets d'Express, de la session et du serveur HTTP.

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    csrf?: string;
    utilisateur?: any;
  }
}

declare global {
  namespace Express {
    interface Request {
      nonce?: string;
      compteurs?: Record<string, number>;
      jeton?: { id: number, nom: string };
    }
  }
}

declare module 'http' {
  interface Server {
    protocole?: string;
  }
}
