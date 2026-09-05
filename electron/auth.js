'use strict';

/**
 * Authentification Microsoft -> Xbox Live -> XSTS -> Minecraft.
 *
 * La page de connexion est celle de Microsoft, ouverte dans une fenetre a part : le
 * launcher ne voit jamais le mot de passe, il n'intercepte que le code de retour sur
 * l'URL de redirection. C'est la seule facon legitime de proceder - un launcher qui
 * affiche lui-meme un champ mot de passe vole des comptes.
 *
 * Le profil renvoye par api.minecraftservices.com contient deja le pseudo, l'UUID et
 * les textures du joueur : inutile de passer par un service d'avatars tiers.
 */
const { BrowserWindow, session } = require('electron');
const https = require('https');
const { AZURE_CLIENT_ID, REDIRECTION } = require('./config');

const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const XBL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFIL = 'https://api.minecraftservices.com/minecraft/profile';

/** POST/GET JSON minimal, sans dependance externe. */
function requete(url, { methode = 'GET', entetes = {}, corps = null } = {}) {
  return new Promise((resoudre, rejeter) => {
    const u = new URL(url);
    const donnees = corps == null ? null
      : (typeof corps === 'string' ? corps : JSON.stringify(corps));
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: methode,
      headers: {
        Accept: 'application/json',
        ...(donnees != null ? { 'Content-Length': Buffer.byteLength(donnees) } : {}),
        ...entetes,
      },
    }, (rep) => {
      let brut = '';
      rep.on('data', (c) => { brut += c; });
      rep.on('end', () => {
        let json = null;
        try { json = JSON.parse(brut); } catch { /* reponse non JSON */ }
        if (rep.statusCode >= 200 && rep.statusCode < 300) return resoudre(json);
        const message = (json && (json.error_description || json.errorMessage || json.error))
          || `HTTP ${rep.statusCode}`;
        rejeter(new Error(message));
      });
    });
    req.on('error', rejeter);
    if (donnees != null) req.write(donnees);
    req.end();
  });
}

/** Ouvre la vraie page Microsoft et rend le code d'autorisation. */
function demanderCode(parent) {
  return new Promise((resoudre, rejeter) => {
    const url = `${OAUTH}/authorize`
      + `?client_id=${AZURE_CLIENT_ID}`
      + `&response_type=code`
      + `&redirect_uri=${encodeURIComponent(REDIRECTION)}`
      + `&scope=${encodeURIComponent('XboxLive.signin offline_access')}`
      + `&prompt=select_account`;

    // Session isolee : la fenetre ne partage rien avec le reste du launcher et ne
    // conserve aucun cookie apres coup.
    const part = 'persist:connexion-' + Date.now();
    const fen = new BrowserWindow({
      parent, modal: true, width: 520, height: 700, show: false,
      autoHideMenuBar: true, title: 'Connexion Microsoft',
      webPreferences: { partition: part, nodeIntegration: false, contextIsolation: true },
    });
    fen.once('ready-to-show', () => fen.show());

    let fini = false;
    const traiter = (brut) => {
      let u;
      try { u = new URL(brut); } catch { return; }
      if (!brut.startsWith(REDIRECTION)) return;
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      fini = true;
      session.fromPartition(part).clearStorageData().catch(() => {});
      fen.destroy();
      if (code) resoudre(code);
      else rejeter(new Error(err || 'Connexion annulée'));
    };

    fen.webContents.on('will-redirect', (_e, u) => traiter(u));
    fen.webContents.on('will-navigate', (_e, u) => traiter(u));
    fen.on('closed', () => { if (!fini) rejeter(new Error('Fenêtre de connexion fermée')); });
    fen.loadURL(url);
  });
}

const form = (o) => new URLSearchParams(o).toString();
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

async function jetonsDepuisCode(code) {
  const r = await requete(`${OAUTH}/token`, {
    methode: 'POST', entetes: FORM,
    corps: form({
      client_id: AZURE_CLIENT_ID, code, grant_type: 'authorization_code',
      redirect_uri: REDIRECTION, scope: 'XboxLive.signin offline_access',
    }),
  });
  return { acces: r.access_token, rafraichir: r.refresh_token };
}

async function jetonsDepuisRafraichissement(rafraichir) {
  const r = await requete(`${OAUTH}/token`, {
    methode: 'POST', entetes: FORM,
    corps: form({
      client_id: AZURE_CLIENT_ID, refresh_token: rafraichir,
      grant_type: 'refresh_token', scope: 'XboxLive.signin offline_access',
    }),
  });
  return { acces: r.access_token, rafraichir: r.refresh_token || rafraichir };
}

/** Microsoft -> Xbox Live -> XSTS -> Minecraft -> profil. */
async function profilMinecraft(jetonMicrosoft) {
  const xbl = await requete(XBL, {
    methode: 'POST', entetes: { 'Content-Type': 'application/json' },
    corps: {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com',
                    RpsTicket: `d=${jetonMicrosoft}` },
      RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
    },
  });

  const xsts = await requete(XSTS, {
    methode: 'POST', entetes: { 'Content-Type': 'application/json' },
    corps: {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    },
  });

  const uhs = xsts.DisplayClaims.xui[0].uhs;
  const mc = await requete(MC_LOGIN, {
    methode: 'POST', entetes: { 'Content-Type': 'application/json' },
    corps: { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` },
  });

  const profil = await requete(MC_PROFIL, {
    entetes: { Authorization: `Bearer ${mc.access_token}` },
  });

  return {
    pseudo: profil.name,
    uuid: profil.id,
    jeton: mc.access_token,
    // Les textures viennent du profil officiel : pas de service d'avatars tiers.
    //
    // Le passage en https n'est pas cosmetique. Mojang renvoie ces adresses en HTTP
    // (verifie dans un textureRaw reel : "http://textures.minecraft.net/texture/..."),
    // alors que la politique de securite de la fenetre n'autorise que
    //   img-src 'self' data: https://textures.minecraft.net
    // L'image etait donc bloquee avant la moindre requete, silencieusement, et le
    // joueur ne voyait jamais sa tete. Le domaine sert le meme fichier en https.
    peau: ((profil.skins || []).find((s) => s.state === 'ACTIVE')?.url || null)
      ?.replace(/^http:\/\//, 'https://') || null,
  };
}

/** Connexion interactive complete. */
async function connecter(parent) {
  const code = await demanderCode(parent);
  const j = await jetonsDepuisCode(code);
  const p = await profilMinecraft(j.acces);
  return { ...p, rafraichir: j.rafraichir };
}

/** Reconnexion silencieuse au demarrage, si un jeton de rafraichissement est garde. */
async function reconnecter(rafraichir) {
  const j = await jetonsDepuisRafraichissement(rafraichir);
  const p = await profilMinecraft(j.acces);
  return { ...p, rafraichir: j.rafraichir };
}

module.exports = { connecter, reconnecter };
