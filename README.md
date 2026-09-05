# Epicfight Side — Launcher

Launcher de bureau du serveur **Epicfight Side**. Il authentifie le joueur chez Microsoft,
installe et met à jour le modpack, puis lance Minecraft avec Forge — sans passer par un
launcher tiers.

Electron, sans dépendance à l'exécution hors Electron lui-même.

## Ce qu'il fait

- **Connexion Microsoft** en OAuth, dans une fenêtre du système. Le jeton de rafraîchissement
  est chiffré par `safeStorage` (DPAPI sous Windows) et ne quitte jamais la machine.
- **Installation du pack** par manifeste : chaque fichier porte sa taille et son `sha1`, et
  seul ce qui a changé est retéléchargé. Une mise à jour de quelques mods ne coûte donc pas
  1,4 Go.
- **Installation de Java, de Minecraft et de Forge** si besoin, dans son propre dossier
  (`%APPDATA%/EpicfightSide/jeu`) — l'installation officielle de Minecraft n'est pas touchée.
- **État du serveur** interrogé en Server List Ping natif, sans service tiers.
- **Guide du boss et liste des touches** lus directement dans le launcher.

## Développement

    npm install
    npm start

## Construire l'installateur

    npm run dist

Produit `release/Epicfight-Side-Installateur-<version>.exe` (NSIS, installation par
utilisateur, dossier modifiable).

## Publier une mise à jour du pack

    npm run manifeste     # calcule les sha1 et écrit distribution/manifeste.json
    npm run oublis        # filet de sécurité : signale ce qui manquerait au pack

Puis publier `manifeste.json` et les fichiers en Release GitHub. Le launcher lit l'URL
définie par `MANIFESTE_URL` dans `electron/config.js`.

## Structure

    electron/          processus principal : authentification, pack, lancement du jeu
      config.js        LE seul fichier à modifier quand le serveur ou le pack évoluent
      auth.js          OAuth Microsoft puis Xbox Live puis Minecraft
      pack.js          téléchargement différentiel par manifeste
      lancement.js     construit le classpath et les arguments de la JVM
      preload.js       la seule surface exposée à la page, par contextBridge
    renderer/          l'interface
      documents/       guide du boss et liste des touches, en HTML local
      assets/          logo, icônes, polices embarquées
    outils/            génération du manifeste et vérification des oublis

## À savoir avant de publier ce dépôt

- `AZURE_CLIENT_ID` vaut `00000000441cc96b`, l'identifiant **public** de la Xbox Game Bar.
  Ce n'est pas un secret, mais ce n'est pas une application enregistrée à ton nom : pour être
  en règle, enregistrer la sienne sur `portal.azure.com` et demander à Mojang l'accès à
  l'API Minecraft.
- Le dépôt est public : **https://github.com/Mouyouu/epicfight-side-launcher**.
  `MANIFESTE_URL` et la clé `base` du manifeste y pointent déjà. Le manifeste doit être
  publié en asset d'une Release, sinon `releases/latest/download/` ne résout rien.
- L'adresse du serveur de jeu (`SERVEUR` dans `electron/config.js`) est visible ici, comme
  dans tout launcher qui s'y connecte. C'est un choix assumé, pas un oubli.
- Le pack (`distribution/`) est exclu du dépôt : 1,4 Go n'ont rien à faire dans un git.

## Sécurité

Aucun identifiant n'est stocké en clair, et le launcher n'envoie rien à un service tiers :
les seules adresses contactées sont celles de Microsoft, de Mojang, du dépôt de
distribution et du serveur de jeu.
