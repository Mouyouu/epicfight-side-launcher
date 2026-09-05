'use strict';

/**
 * Mise a jour du launcher lui-meme.
 *
 * A ne pas confondre avec pack.js, qui met a jour le MODPACK a partir du manifeste.
 * Ici il s'agit de l'application : quand une nouvelle version est publiee en Release
 * GitHub, le launcher la telecharge en fond et l'installe a la fermeture.
 *
 * POURQUOI A LA FERMETURE ET PAS TOUT DE SUITE
 * Remplacer l'executable pendant que le joueur s'en sert coupe sa session, et peut
 * couper une installation de pack en cours. On attend donc qu'il ferme de lui-meme.
 * C'est plus lent a arriver, mais ca ne casse jamais rien.
 *
 * CE QUI EST VOLONTAIREMENT DESACTIVE
 * autoInstallOnAppQuit reste a true (comportement voulu), mais autoDownload est mis a
 * false : on ne consomme pas la connexion du joueur sans le lui dire. Le telechargement
 * ne part qu'apres que l'interface a ete prevenue, et elle l'affiche.
 *
 * EN DEVELOPPEMENT
 * electron-updater refuse de fonctionner sur une application non empaquetee : il n'y a
 * pas de version installee a remplacer. On sort donc tout de suite, sans erreur, plutot
 * que de laisser une exception remonter au demarrage.
 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let etat = { disponible: false, version: null, telecharge: false, erreur: null };

/**
 * @param {(d: object) => void} dire  envoie un evenement a l'interface
 */
function preparer(dire) {
  if (!app.isPackaged) {
    etat.erreur = 'application non empaquetee : mise a jour inactive en developpement';
    return etat;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    etat = { disponible: true, version: info.version, telecharge: false, erreur: null };
    dire({ etape: 'maj', phase: 'disponible', version: info.version });
    // Le telechargement ne demarre qu'ici, une fois l'interface prevenue.
    autoUpdater.downloadUpdate().catch((e) => {
      etat.erreur = String(e && e.message ? e.message : e);
      dire({ etape: 'maj', phase: 'erreur', message: etat.erreur });
    });
  });

  autoUpdater.on('update-not-available', () => {
    dire({ etape: 'maj', phase: 'ajour' });
  });

  autoUpdater.on('download-progress', (p) => {
    dire({ etape: 'maj', phase: 'telechargement', pct: Math.round(p.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    etat.telecharge = true;
    dire({ etape: 'maj', phase: 'prete', version: info.version });
  });

  autoUpdater.on('error', (e) => {
    // Une mise a jour qui echoue ne doit jamais empecher de jouer : on le signale
    // et on continue. C'est aussi pourquoi rien de tout ceci n'est bloquant.
    etat.erreur = String(e && e.message ? e.message : e);
    dire({ etape: 'maj', phase: 'erreur', message: etat.erreur });
  });

  autoUpdater.checkForUpdates().catch((e) => {
    etat.erreur = String(e && e.message ? e.message : e);
    dire({ etape: 'maj', phase: 'erreur', message: etat.erreur });
  });

  return etat;
}

/** Applique maintenant : ferme le launcher et lance l'installateur. */
function installer() {
  if (!etat.telecharge) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

module.exports = { preparer, installer, etat: () => etat };
