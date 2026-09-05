'use strict';

/**
 * Processus principal : fenetre, stockage local, et cablage des modules.
 *
 * Le jeu n'est jamais installe dans le dossier du launcher : il vit dans
 * %APPDATA%/EpicfightSide/jeu, pour survivre a une desinstallation ou une mise a jour
 * du launcher, et ne jamais melanger nos fichiers a ceux du joueur.
 */
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const auth = require('./auth');
const ping = require('./ping');
const pack = require('./pack');
const installateur = require('./installateur');
const lancement = require('./lancement');
const maj = require('./maj');

const DOSSIER = path.join(app.getPath('appData'), 'EpicfightSide');
const RACINE_JEU = path.join(DOSSIER, 'jeu');
const REGLAGES = path.join(DOSSIER, 'reglages.json');
const SESSION = path.join(DOSSIER, 'session.bin');

let fenetre = null;
let compte = null;          // { pseudo, uuid, jeton, peau }
let jeu = null;             // processus du jeu en cours

// ---------------------------------------------------------------- stockage

const lireJson = (f, defaut) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return defaut; }
};
const ecrireJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 1));
};

/**
 * Le jeton de rafraichissement est chiffre par Windows (DPAPI, via safeStorage) : un
 * fichier copie sur une autre machine ou un autre compte est illisible. Si le chiffrement
 * n'est pas disponible, on prefere ne rien garder plutot que d'ecrire un jeton en clair.
 */
function garderSession(rafraichir) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  if (!rafraichir || !safeStorage.isEncryptionAvailable()) {
    try { fs.unlinkSync(SESSION); } catch { /* rien a effacer */ }
    return;
  }
  fs.writeFileSync(SESSION, safeStorage.encryptString(rafraichir));
}

function relireSession() {
  if (!fs.existsSync(SESSION) || !safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(fs.readFileSync(SESSION)); } catch { return null; }
}

const dire = (donnees) => fenetre && !fenetre.isDestroyed()
  && fenetre.webContents.send('progression', donnees);

/**
 * Ecrit la sortie du jeu dans EpicfightSide/jeu.log.
 *
 * Elle etait jusqu'ici envoyee a l'interface sous l'etape "journal", que celle-ci
 * ignore - donc perdue. Quand Minecraft meurt avant d'avoir ouvert son propre
 * latest.log, c'est pourtant le SEUL endroit ou la cause apparait. Un plantage a
 * coute plusieurs allers-retours pour cette raison :
 *   ResolutionException: Modules minecraft and _1._20._1 export package ...
 * n'existait nulle part sur le disque.
 *
 * Le fichier est remis a zero a chaque lancement : on veut la derniere partie, pas
 * un historique qui grossit sans fin.
 */
let fluxJeu = null;
function ouvrirJournalJeu() {
  try {
    fs.mkdirSync(DOSSIER, { recursive: true });
    if (fluxJeu) fluxJeu.end();
    fluxJeu = fs.createWriteStream(path.join(DOSSIER, 'jeu.log'), { flags: 'w' });
  } catch { fluxJeu = null; }
}
function journaliserJeu(texte) {
  try { if (fluxJeu) fluxJeu.write(texte); } catch { /* jamais bloquant */ }
}

// ---------------------------------------------------------------- fenetre

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1180, height: 700, minWidth: 1000, minHeight: 620,
    frame: false, show: false, backgroundColor: '#0A0A0A',
    title: config.NOM,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,      // la page n'atteint jamais Node
      nodeIntegration: false,
      sandbox: false,              // requis par safeStorage cote preload
    },
  });

  fenetre.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  fenetre.once('ready-to-show', () => fenetre.show());

  // aucun lien n'ouvre une fenetre interne : tout part dans le navigateur du joueur
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------- IPC

ipcMain.handle('fenetre:reduire', () => fenetre && fenetre.minimize());
ipcMain.handle('fenetre:fermer', () => fenetre && fenetre.close());

ipcMain.handle('app:config', () => ({
  nom: config.NOM,
  serveur: `${config.SERVEUR.hote}:${config.SERVEUR.port}`,
  minecraft: config.MINECRAFT,
  forge: config.FORGE,
  // (plus de liens externes : les documents sont embarques)
  actualites: config.ACTUALITES,
  version: app.getVersion(),
}));

ipcMain.handle('app:dossier', () => RACINE_JEU);

ipcMain.handle('maj:etat', () => maj.etat());
ipcMain.handle('maj:installer', () => maj.installer());
ipcMain.handle('app:ouvrirDossier', () => {
  fs.mkdirSync(RACINE_JEU, { recursive: true });
  return shell.openPath(RACINE_JEU);
});
ipcMain.handle('app:ouvrirLien', (_e, url) =>
  (/^https:\/\//.test(url) ? shell.openExternal(url) : null));

ipcMain.handle('reglages:lire', () => lireJson(REGLAGES, { ram: config.RAM.max, rejoindre: true }));
ipcMain.handle('reglages:ecrire', (_e, r) => {
  ecrireJson(REGLAGES, { ...lireJson(REGLAGES, {}), ...r });
  return true;
});

ipcMain.handle('compte:actuel', () => compte);

ipcMain.handle('compte:connexion', async () => {
  try {
    compte = await auth.connecter(fenetre);
    garderSession(compte.rafraichir);
    return { ok: true, compte };
  } catch (e) {
    return { ok: false, erreur: e.message };
  }
});

ipcMain.handle('compte:deconnexion', () => {
  compte = null;
  garderSession(null);
  return true;
});

ipcMain.handle('serveur:etat', async () => {
  try {
    const r = await ping.interroger(config.SERVEUR.hote, config.SERVEUR.port);
    return { enLigne: true, ...r };
  } catch (e) {
    return { enLigne: false, erreur: e.message };
  }
});

ipcMain.handle('pack:verifier', async () => {
  try {
    const m = await pack.lireManifeste();
    const plan = pack.comparer(m, RACINE_JEU);
    return { ok: true, version: m.version, aJour: !plan.aFaire.length && !plan.aSupprimer.length,
             fichiers: plan.aFaire.length, octets: plan.octets };
  } catch (e) {
    return { ok: false, erreur: e.message };
  }
});

ipcMain.handle('pack:reglages', async () => {
  try { return { ok: true, poses: await pack.reappliquerReglages(RACINE_JEU, dire) }; }
  catch (e) { return { ok: false, erreur: e.message }; }
});

/**
 * Le bouton unique : installe ce qui manque, met le pack a jour, puis lance.
 * Chaque etape est idempotente, donc un second clic apres une coupure reprend ou ca s'est
 * arrete au lieu de tout refaire.
 */
ipcMain.handle('jeu:lancer', async () => {
  if (!compte) return { ok: false, erreur: 'Connecte-toi d\'abord.' };
  if (jeu) return { ok: false, erreur: 'Le jeu est déjà lancé.' };

  try {
    fs.mkdirSync(RACINE_JEU, { recursive: true });
    const reglages = lireJson(REGLAGES, { ram: config.RAM.max, rejoindre: true });

    dire({ etape: 'java', detail: 'vérification' });
    const java = await installateur.installerJava(RACINE_JEU, dire);

    dire({ etape: 'minecraft', detail: 'vérification' });
    const { assetIndex } = await installateur.installerMinecraft(RACINE_JEU, dire);

    dire({ etape: 'forge', detail: 'vérification' });
    const idForge = await installateur.installerForge(RACINE_JEU, java, dire);

    dire({ etape: 'pack', detail: 'vérification' });
    const r = await pack.synchroniser(RACINE_JEU, dire);

    dire({ etape: 'lancement', detail: 'démarrage du jeu' });
    ouvrirJournalJeu();
    jeu = lancement.lancer({
      racine: RACINE_JEU, java, idForge, compte, assetIndex,
      ram: reglages.ram || config.RAM.max,
      rejoindre: reglages.rejoindre !== false,
      onSortie: (t) => {
        journaliserJeu(t);
        dire({ etape: 'journal', ligne: t.trimEnd() });
      },
    });

    jeu.on('exit', (code) => {
      jeu = null;
      dire({ etape: 'termine', code });
    });

    return { ok: true, pack: r };
  } catch (e) {
    jeu = null;
    return { ok: false, erreur: e.message };
  }
});

// ---------------------------------------------------------------- cycle de vie

// Une seule instance : deux launchers ecrivant dans le meme dossier de jeu se marcheraient
// dessus pendant une mise a jour.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); }
  });

  app.whenReady().then(async () => {
    creerFenetre();

    // Mise a jour du launcher : lancee apres la fenetre pour que l'interface puisse
    // recevoir les evenements, et jamais bloquante - une panne ici n'empeche pas de jouer.
    maj.preparer(dire);

    // reconnexion silencieuse : le joueur ne repasse par Microsoft que si le jeton a expire
    const rafraichir = relireSession();
    if (rafraichir) {
      try {
        compte = await auth.reconnecter(rafraichir);
        garderSession(compte.rafraichir);
        dire({ etape: 'session', compte });
      } catch {
        garderSession(null);
      }
    }
  });

  app.on('window-all-closed', () => app.quit());
}
