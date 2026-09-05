'use strict';

/**
 * Pont entre la fenetre et le processus principal.
 *
 * L'interface n'a acces ni a Node, ni au systeme de fichiers, ni au reseau : elle ne peut
 * appeler que les fonctions listees ici. C'est ce qui fait qu'une page compromise ne peut
 * rien faire d'autre que ce que ce fichier autorise.
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoquer = (canal, ...args) => ipcRenderer.invoke(canal, ...args);

contextBridge.exposeInMainWorld('launcher', {
  // --- fenetre
  reduire: () => invoquer('fenetre:reduire'),
  fermer: () => invoquer('fenetre:fermer'),

  // --- compte
  compte: () => invoquer('compte:actuel'),
  connexion: () => invoquer('compte:connexion'),
  deconnexion: () => invoquer('compte:deconnexion'),

  // --- serveur
  etatServeur: () => invoquer('serveur:etat'),

  // --- contenu editorial (actualites, guide) mis a jour sans reinstaller
  contenu: () => invoquer('app:contenu'),

  // --- pack et jeu
  config: () => invoquer('app:config'),
  verifier: () => invoquer('pack:verifier'),
  jouer: (options) => invoquer('jeu:lancer', options),
  reglagesParDefaut: () => invoquer('pack:reglages'),
  dossierJeu: () => invoquer('app:dossier'),
  ouvrirDossier: () => invoquer('app:ouvrirDossier'),
  ouvrirLien: (url) => invoquer('app:ouvrirLien', url),

  // --- mise a jour du launcher lui-meme (pas du modpack)
  majEtat: () => invoquer('maj:etat'),
  majInstaller: () => invoquer('maj:installer'),

  // --- preferences locales
  lireReglages: () => invoquer('reglages:lire'),
  ecrireReglages: (r) => invoquer('reglages:ecrire', r),

  /** Progression de l'installation et du lancement. Rend une fonction de desabonnement. */
  surProgression: (rappel) => {
    const ecouteur = (_e, donnees) => rappel(donnees);
    ipcRenderer.on('progression', ecouteur);
    return () => ipcRenderer.removeListener('progression', ecouteur);
  },
});
