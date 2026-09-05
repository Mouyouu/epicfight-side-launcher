'use strict';

/**
 * Les seuls reglages a modifier quand le serveur ou le pack evoluent.
 * Tout le reste du launcher se deduit de ce fichier ou du manifeste distant.
 */
module.exports = {
  // --- identite
  NOM: 'Epicfight Side',

  // --- serveur de jeu (interroge en Server List Ping natif, sans service tiers)
  SERVEUR: { hote: '91.197.6.112', port: 23818 },

  // --- versions
  MINECRAFT: '1.20.1',
  FORGE: '47.4.13',              // sans le prefixe "1.20.1-"

  // --- distribution du pack
  // Le manifeste liste chaque fichier avec sa taille et son sha1. Le launcher ne
  // retelecharge que ce qui a change : c'est ce qui rend les mises a jour legeres.
  //
  // TAG FIXE "pack", et surtout PAS releases/latest.
  // "latest" designe la derniere release du LAUNCHER. Le pack et le launcher
  // n'evoluent pas au meme rythme : publier la 1.0.1 du launcher faisait pointer
  // le manifeste vers une release qui ne le contenait pas, d'ou un 404 a
  // l'installation. Un tag dedie les separe une bonne fois.
  MANIFESTE_URL: 'https://github.com/Mouyouu/epicfight-side-launcher/releases/download/pack/manifeste.json',

  // --- contenu editorial, mis a jour sans reinstaller le launcher
  // Actualites et donnees du guide des boss. Meme tag fixe que le pack : un seul
  // endroit a mettre a jour. Seules des DONNEES sont telechargees ; le code du
  // guide reste embarque dans l'application (voir electron/contenu.js).
  CONTENU_BASE: 'https://github.com/Mouyouu/epicfight-side-launcher/releases/download/pack/',

  // --- le Discord du serveur, ouvert dans le navigateur du joueur
  DISCORD: 'https://discord.gg/ZrTkVQwqQd',

  // --- memoire allouee au jeu (Go)
  RAM: { min: 4, max: 8 },

  // --- OAuth Microsoft
  // 00000000441cc96b est l'identifiant public de la Xbox Game Bar. Il fonctionne, mais
  // pour etre en regle il faut enregistrer sa propre application sur portal.azure.com
  // et demander a Mojang l'acces a l'API Minecraft.
  AZURE_CLIENT_ID: '00000000441cc96b',
  REDIRECTION: 'https://login.live.com/oauth20_desktop.srf',

  // --- actualites affichees dans le panneau de droite
  // Trois entrees suffisent ; edite ce tableau quand tu publies une mise a jour.
  ACTUALITES: [
    { titre: 'Le Roi Déchu se réveille', date: '03/09/2026',
      couleur: 'linear-gradient(140deg,#305088,#202848)' },
    { titre: 'Les arènes gagnent quatre thèmes', date: '01/09/2026',
      couleur: 'linear-gradient(140deg,#388888,#1B3A3A)' },
    { titre: 'Nouvelles touches : garde et esquive dédiées', date: '30/08/2026',
      couleur: 'linear-gradient(140deg,#3A2E5A,#1A1428)' },
  ],
};

// Note : il y avait ici un bloc LIENS pointant vers deux pages en ligne. Il a ete
// retire parce qu'il ne servait plus a rien - le guide des boss et la liste des
// touches sont embarques dans renderer/documents/ et s'ouvrent hors ligne. Aucun
// element [data-lien] n'existait dans l'interface pour les declencher.
