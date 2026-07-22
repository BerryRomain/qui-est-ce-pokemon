# Qui est-ce ? Pokémon Édition — Multijoueur en ligne

Jeu "Qui est-ce ?" sur le thème Pokémon, jouable en ligne à deux grâce à un
système de lobby avec code à partager. L'hôte choisit les générations de
Pokémon qui apparaissent sur la grille (Génération 1 à 9 disponibles).

## Structure du projet

```
qui-est-ce-pokemon/
├── server.js              # Serveur Express + Socket.io (logique de jeu, lobbies)
├── package.json
├── render.yaml             # Config de déploiement Render (optionnel, déploiement en 1 clic)
├── data/
│   └── pokemon_by_gen.json # Pokémon (id + nom FR) classés par génération 1 à 9
└── public/
    ├── index.html           # Les écrans (accueil, créer/rejoindre, salle d'attente, jeu...)
    ├── style.css
    └── game.js               # Logique client (Socket.io)
```

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrez http://localhost:3000 dans deux onglets (ou deux appareils sur le
même réseau via votre IP locale) pour tester à deux.

## Déployer sur Render

### Option A — via le fichier render.yaml (recommandé)

1. Créez un dépôt GitHub avec tout ce dossier (`git init`, `git add .`,
   `git commit -m "init"`, puis poussez-le sur GitHub).
2. Sur [render.com](https://render.com), cliquez sur **New +** →
   **Blueprint**, puis sélectionnez votre dépôt. Render détecte
   automatiquement `render.yaml` et configure le service.
3. Cliquez sur **Apply** — Render installe les dépendances (`npm install`) et
   démarre le serveur (`npm start`).
4. Une fois déployé, Render vous donne une URL du type
   `https://qui-est-ce-pokemon.onrender.com`. C'est ce lien que vous partagez
   à votre ami.

### Option B — manuellement

1. Poussez le projet sur GitHub (comme ci-dessus).
2. Sur Render : **New +** → **Web Service** → connectez votre dépôt.
3. Renseignez :
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (suffisant pour jouer à deux)
4. Déployez. Render fournit l'URL publique.

> ℹ️ Le plan gratuit de Render met le service en veille après une période
> d'inactivité : le premier chargement après une pause peut prendre
> quelques dizaines de secondes le temps que le serveur redémarre. Rien à
> configurer, c'est normal.

## Comment jouer

1. Un joueur ouvre le lien Render et clique sur **Créer un lobby**, entre
   son nom → il devient l'hôte et reçoit un **code à 4 caractères**.
2. L'hôte sélectionne les générations de Pokémon voulues (une ou plusieurs)
   dans la salle d'attente.
3. Il partage le code (bouton **Copier**, qui copie aussi un lien direct
   `?join=CODE`) à son ami.
4. L'ami clique sur **Rejoindre un lobby**, entre le code + son nom.
5. Quand les deux joueurs sont connectés, l'hôte clique sur
   **Démarrer la partie**.
6. Chacun choisit en secret, sur son propre écran, le Pokémon que l'autre
   devra deviner.
7. La partie se joue en tours : on pose ses questions à voix haute (par
   appel vidéo/téléphone par exemple), on clique sur les Pokémon pour les
   éliminer sur sa propre grille (privé, ça n'affecte pas l'écran de l'autre),
   puis on utilise **Deviner** quand on pense connaître la réponse.

## Générations disponibles

Le fichier `data/pokemon_by_gen.json` contient déjà les 9 générations
(1 à 9, soit les 1025 Pokémon, noms officiels en français) :

| Génération | Nombre de Pokémon |
|---|---|
| 1 (Kanto)   | 151 |
| 2 (Johto)   | 100 |
| 3 (Hoenn)   | 135 |
| 4 (Sinnoh)  | 107 |
| 5 (Unys)    | 156 |
| 6 (Kalos)   | 72  |
| 7 (Alola)   | 88  |
| 8 (Galar)   | 96  |
| 9 (Paldea)  | 120 |

Toutes les générations parues à ce jour sont donc déjà incluses et
sélectionnables par l'hôte. Si de nouvelles générations sortent à l'avenir,
il suffira de régénérer `pokemon_by_gen.json` avec les nouvelles données
(même structure : `{"<num_génération>": [{"id":..., "name":...}, ...]}`) —
le reste de l'application (sélecteur, grille, etc.) s'adapte automatiquement
car la liste des générations est lue dynamiquement depuis ce fichier.
