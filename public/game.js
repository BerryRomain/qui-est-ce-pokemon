(function () {
  "use strict";

  var socket = io();

  // ---------- Références écrans ----------
  var screens = {
    home: document.getElementById("screen-home"),
    create: document.getElementById("screen-create"),
    join: document.getElementById("screen-join"),
    waiting: document.getElementById("screen-waiting"),
    pick: document.getElementById("screen-pick"),
    game: document.getElementById("screen-game"),
    victory: document.getElementById("screen-victory"),
  };
  var modalRoot = document.getElementById("modalRoot");
  var connectionBanner = document.getElementById("connectionBanner");

  function showOnly(name) {
    Object.keys(screens).forEach(function (k) {
      if (k === name) screens[k].classList.remove("hidden");
      else screens[k].classList.add("hidden");
    });
  }

  function spriteUrl(id) {
    return (
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/" +
      id +
      ".png"
    );
  }

  function criesUrl(id) {
    return (
      "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/" +
      id +
      ".ogg"
    );
  }

  // ---------- Mini Pokédex : traductions & couleurs ----------
  var TYPE_FR = {
    normal: "Normal", fire: "Feu", water: "Eau", electric: "Électrik",
    grass: "Plante", ice: "Glace", fighting: "Combat", poison: "Poison",
    ground: "Sol", flying: "Vol", psychic: "Psy", bug: "Insecte",
    rock: "Roche", ghost: "Spectre", dragon: "Dragon", dark: "Ténèbres",
    steel: "Acier", fairy: "Fée",
  };
  var TYPE_COLORS = {
    normal: "#A8A878", fire: "#F08030", water: "#6890F0", electric: "#F8D030",
    grass: "#78C850", ice: "#98D8D8", fighting: "#C03028", poison: "#A040A0",
    ground: "#E0C068", flying: "#A890F0", psychic: "#F85888", bug: "#A8B820",
    rock: "#B8A038", ghost: "#705898", dragon: "#7038F8", dark: "#705848",
    steel: "#B8B8D0", fairy: "#EE99AC",
  };
  var EGG_GROUP_FR = {
    monster: "Monstrueux",
    "water1": "Groupe Aquatique 1",
    "water2": "Groupe Aquatique 2",
    "water3": "Groupe Aquatique 3",
    bug: "Insectoïde",
    flying: "Aérien",
    ground: "Terrestre",
    field: "Terrestre",
    fairy: "Féerique",
    plant: "Végétal",
    grass: "Végétal",
    humanlike: "Humanoïde",
    "human-like": "Humanoïde",
    mineral: "Minéral",
    indeterminate: "Amorphe",
    amorphous: "Amorphe",
    ditto: "Métamorph",
    dragon: "Draconique",
    "no-eggs": "Aucun (indéterminé)",
    undiscovered: "Aucun (indéterminé)",
  };
  var COLOR_FR = {
    black: "Noir", blue: "Bleu", brown: "Marron", gray: "Gris", grey: "Gris",
    green: "Vert", pink: "Rose", purple: "Violet", red: "Rouge",
    white: "Blanc", yellow: "Jaune",
  };

  var pokedexCache = {};

  function fetchPokedexData(id) {
    if (pokedexCache[id]) return Promise.resolve(pokedexCache[id]);
    var pokeUrl = "https://pokeapi.co/api/v2/pokemon/" + id + "/";
    var speciesUrl = "https://pokeapi.co/api/v2/pokemon-species/" + id + "/";
    return Promise.all([
      fetch(pokeUrl).then(function (r) {
        if (!r.ok) throw new Error("pokemon fetch failed");
        return r.json();
      }),
      fetch(speciesUrl).then(function (r) {
        if (!r.ok) throw new Error("species fetch failed");
        return r.json();
      }),
    ]).then(function (results) {
      var p = results[0],
        s = results[1];
      var genus = "";
      (s.genera || []).forEach(function (g) {
        if (g.language && g.language.name === "fr") genus = g.genus;
      });
      var eggGroups = (s.egg_groups || []).map(function (eg) {
        return EGG_GROUP_FR[eg.name] || eg.name;
      });
      var colorName = s.color ? COLOR_FR[s.color.name] || s.color.name : "-";
      var types = (p.types || [])
        .slice()
        .sort(function (a, b) {
          return a.slot - b.slot;
        })
        .map(function (t) {
          return t.type.name;
        });
      var data = {
        id: id,
        height: typeof p.height === "number" ? p.height / 10 : null,
        weight: typeof p.weight === "number" ? p.weight / 10 : null,
        types: types,
        genus: genus,
        eggGroups: eggGroups,
        color: colorName,
        captureRate: typeof s.capture_rate === "number" ? s.capture_rate : null,
        genderRate: typeof s.gender_rate === "number" ? s.gender_rate : null,
      };
      pokedexCache[id] = data;
      return data;
    });
  }

  function genderStatHtml(genderRate) {
    if (genderRate === null) return "Inconnu";
    if (genderRate === -1) return "Asexué (sans genre)";
    var femalePct = Math.round((genderRate / 8) * 100);
    var malePct = 100 - femalePct;
    return (
      "<div>♂ " + malePct + "% &nbsp;/&nbsp; ♀ " + femalePct + "%</div>" +
      "<div class='gender-bar'>" +
      "<span class='male-part' style='flex:" + malePct + "'></span>" +
      "<span class='female-part' style='flex:" + femalePct + "'></span>" +
      "</div>"
    );
  }

  function renderPokedexBox(box, poke, data) {
    var numberStr = "#" + String(poke.id).padStart(4, "0");
    var typesHtml = data.types
      .map(function (t) {
        var color = TYPE_COLORS[t] || "#888";
        var label = TYPE_FR[t] || t;
        return "<span class='type-badge' style='background:" + color + "'>" + label + "</span>";
      })
      .join("");

    var genusDisplay = data.genus || "";
    if (genusDisplay && !/^pok[ée]mon\b/i.test(genusDisplay)) {
      genusDisplay = "Pokémon " + genusDisplay;
    }

    box.innerHTML =
      "<button type='button' class='pokedex-close-btn' id='pokedexCloseBtn' aria-label='Fermer'>&times;</button>" +
      "<div class='pokedex-header'>" +
      "<img src='" + spriteUrl(poke.id) + "' alt='" + poke.name + "'>" +
      "<div>" +
      "<div class='pokedex-number'>" + numberStr + "</div>" +
      "<div class='pokedex-name'>" + poke.name + "</div>" +
      "<div class='pokedex-types'>" + typesHtml + "</div>" +
      (genusDisplay ? "<div class='pokedex-category'>" + genusDisplay + "</div>" : "") +
      "</div>" +
      "</div>" +
      "<div class='pokedex-stats'>" +
      "<div class='pokedex-stat'><span class='stat-label'>Taille</span><span class='stat-value'>" +
      (data.height != null ? data.height.toFixed(1) + " m" : "-") +
      "</span></div>" +
      "<div class='pokedex-stat'><span class='stat-label'>Poids</span><span class='stat-value'>" +
      (data.weight != null ? data.weight.toFixed(1) + " kg" : "-") +
      "</span></div>" +
      "<div class='pokedex-stat'><span class='stat-label'>Couleur</span><span class='stat-value'>" +
      data.color +
      "</span></div>" +
      "<div class='pokedex-stat'><span class='stat-label'>Taux de capture</span><span class='stat-value'>" +
      (data.captureRate != null ? data.captureRate : "-") +
      "</span></div>" +
      "<div class='pokedex-stat wide'><span class='stat-label'>Groupe(s) d'œufs</span><span class='stat-value'>" +
      (data.eggGroups.length ? data.eggGroups.join(", ") : "-") +
      "</span></div>" +
      "<div class='pokedex-stat wide'><span class='stat-label'>Répartition des genres</span><span class='stat-value'>" +
      genderStatHtml(data.genderRate) +
      "</span></div>" +
      "</div>" +
      "<div class='pokedex-cry'>" +
      "<span class='cry-label'>Cri officiel</span>" +
      "<audio controls preload='none' src='" + criesUrl(poke.id) + "'>Ton navigateur ne supporte pas la lecture audio.</audio>" +
      "</div>";

    var closeBtn = document.getElementById("pokedexCloseBtn");
    if (closeBtn) {
      closeBtn.onclick = function () {
        modalRoot.innerHTML = "";
      };
    }
  }

  function openPokedexModal(poke) {
    modalRoot.innerHTML = "";
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    var box = document.createElement("div");
    box.className = "modal-box pokedex-box";
    box.innerHTML = "<div class='pokedex-loading'>Chargement de la fiche Pokédex...</div>";
    overlay.appendChild(box);
    modalRoot.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) modalRoot.innerHTML = "";
    });

    fetchPokedexData(poke.id)
      .then(function (data) {
        renderPokedexBox(box, poke, data);
      })
      .catch(function () {
        box.innerHTML =
          "<div class='pokedex-loading'>Impossible de charger les informations du Pokédex pour le moment.</div>" +
          "<div class='modal-actions'><button type='button' class='btn btn-grey' id='pokedexCloseErrBtn'>Fermer</button></div>";
        var closeBtn = document.getElementById("pokedexCloseErrBtn");
        if (closeBtn) {
          closeBtn.onclick = function () {
            modalRoot.innerHTML = "";
          };
        }
      });
  }

  var GRID_MODE_INFO = {
    normal: { label: "Grille normale", desc: "48 Pokémon tirés au hasard" },
    mega: { label: "Méga grille", desc: "Tous les Pokémon des générations choisies" },
  };

  // ---------- État local ----------
  var myPlayerNum = null;
  var roomCode = null;
  var isHost = false;
  var availableGenerations = []; // [{id,count}]
  var selectedGenerations = [1];
  var selectedGridMode = "normal";
  var gamePokemons = [];
  var localFlipped = {}; // id -> bool (mémo personnel, pas partagé)
  var myPickedSecret = null;
  var currentPlayer = 1;
  var guessMode = false;

  // ---------- Accueil ----------
  document.getElementById("btnGoCreate").addEventListener("click", function () {
    document.getElementById("createError").textContent = "";
    showOnly("create");
  });
  document.getElementById("btnGoJoin").addEventListener("click", function () {
    document.getElementById("joinError").textContent = "";
    showOnly("join");
  });
  document.getElementById("backFromCreate").addEventListener("click", function () {
    showOnly("home");
  });
  document.getElementById("backFromJoin").addEventListener("click", function () {
    showOnly("home");
  });
  document.getElementById("backFromWaiting").addEventListener("click", function () {
    socket.emit("leave_room");
    resetLocalState();
    showOnly("home");
  });

  function resetLocalState() {
    myPlayerNum = null;
    roomCode = null;
    isHost = false;
    gamePokemons = [];
    localFlipped = {};
    myPickedSecret = null;
    currentPlayer = 1;
    guessMode = false;
  }

  function resetRoundState() {
    gamePokemons = [];
    localFlipped = {};
    myPickedSecret = null;
    currentPlayer = 1;
    guessMode = false;
  }

  // ---------- Création de lobby ----------
  document.getElementById("btnCreateSubmit").addEventListener("click", function () {
    var name = document.getElementById("createName").value.trim();
    if (!name) name = "Joueur 1";
    socket.emit("create_room", { name: name });
  });

  socket.on("room_created", function (data) {
    myPlayerNum = data.playerNum;
    roomCode = data.code;
    isHost = true;
    renderWaitingRoom(data.room);
    showOnly("waiting");
    loadGenerationsIfNeeded();
  });

  // ---------- Rejoindre un lobby ----------
  document.getElementById("btnJoinSubmit").addEventListener("click", function () {
    var code = document.getElementById("joinCode").value.trim().toUpperCase();
    var name = document.getElementById("joinName").value.trim();
    if (!code) {
      document.getElementById("joinError").textContent = "Merci d'entrer un code de lobby.";
      return;
    }
    if (!name) name = "Joueur 2";
    socket.emit("join_room", { code: code, name: name });
  });

  socket.on("room_joined", function (data) {
    myPlayerNum = data.playerNum;
    roomCode = data.code;
    isHost = data.playerNum === 1;
    renderWaitingRoom(data.room);
    showOnly("waiting");
  });

  socket.on("error_message", function (data) {
    var msg = data.message || "Une erreur est survenue.";
    if (!screens.create.classList.contains("hidden")) {
      document.getElementById("createError").textContent = msg;
    } else if (!screens.join.classList.contains("hidden")) {
      document.getElementById("joinError").textContent = msg;
    } else {
      document.getElementById("waitingError").textContent = msg;
    }
  });

  // ---------- Salle d'attente ----------
  function loadGenerationsIfNeeded() {
    if (availableGenerations.length) {
      buildGenGrid();
      return;
    }
    fetch("/api/generations")
      .then(function (r) {
        return r.json();
      })
      .then(function (list) {
        availableGenerations = list;
        buildGenGrid();
      })
      .catch(function () {
        document.getElementById("waitingError").textContent =
          "Impossible de charger la liste des générations.";
      });
  }

  function buildGenGrid() {
    var grid = document.getElementById("genGrid");
    grid.innerHTML = "";
    availableGenerations.forEach(function (g) {
      var label = document.createElement("label");
      label.className = "gen-option" + (selectedGenerations.indexOf(g.id) !== -1 ? " checked" : "");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selectedGenerations.indexOf(g.id) !== -1;
      input.addEventListener("change", function () {
        toggleGeneration(g.id, input.checked);
        label.classList.toggle("checked", input.checked);
      });
      var span = document.createElement("span");
      span.innerHTML =
        '<span class="gen-label">Génération ' +
        g.id +
        "</span>" +
        '<span class="gen-count">' +
        g.count +
        " Pokémon</span>";
      label.appendChild(input);
      label.appendChild(span);
      grid.appendChild(label);
    });
  }

  function toggleGeneration(genId, checked) {
    var idx = selectedGenerations.indexOf(genId);
    if (checked && idx === -1) selectedGenerations.push(genId);
    if (!checked && idx !== -1) selectedGenerations.splice(idx, 1);
    if (selectedGenerations.length === 0) {
      // Toujours au moins une génération sélectionnée
      selectedGenerations.push(genId);
      buildGenGrid();
      return;
    }
    socket.emit("set_generations", { code: roomCode, generations: selectedGenerations });
  }

  function buildGridModePicker() {
    var container = document.getElementById("gridModeOptions");
    container.innerHTML = "";
    Object.keys(GRID_MODE_INFO).forEach(function (modeKey) {
      var info = GRID_MODE_INFO[modeKey];
      var label = document.createElement("label");
      label.className = "grid-mode-option" + (selectedGridMode === modeKey ? " checked" : "");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "gridModeChoice";
      input.value = modeKey;
      input.checked = selectedGridMode === modeKey;
      input.addEventListener("change", function () {
        if (input.checked) toggleGridMode(modeKey);
      });
      var span = document.createElement("span");
      span.innerHTML =
        '<span class="gm-label">' +
        info.label +
        "</span>" +
        '<span class="gm-desc">' +
        info.desc +
        "</span>";
      label.appendChild(input);
      label.appendChild(span);
      container.appendChild(label);
    });
  }

  function toggleGridMode(modeKey) {
    selectedGridMode = modeKey;
    document.querySelectorAll(".grid-mode-option").forEach(function (el) {
      var input = el.querySelector("input");
      el.classList.toggle("checked", input.value === modeKey);
    });
    socket.emit("set_grid_mode", { code: roomCode, gridMode: modeKey });
  }

  function renderWaitingRoom(room) {
    document.getElementById("roomCodeDisplay").textContent = room.code;
    roomCode = room.code;
    if (room.generations) selectedGenerations = room.generations.slice();
    if (room.gridMode) selectedGridMode = room.gridMode;

    var statusEl = document.getElementById("playersStatus");
    statusEl.innerHTML = "";
    [1, 2].forEach(function (n) {
      var p = room.players[n];
      var slot = document.createElement("div");
      slot.className = "player-slot" + (p && p.connected ? " connected" : "") + (!p ? " empty" : "");
      slot.innerHTML =
        '<span class="role pixel">' +
        (n === 1 ? "HÔTE" : "INVITÉ") +
        "</span>" +
        '<div class="pname"><span class="status-dot"></span>' +
        (p ? p.name : "En attente...") +
        "</div>";
      statusEl.appendChild(slot);
    });

    var hostPicker = document.getElementById("hostGenPicker");
    var hostGridModePicker = document.getElementById("hostGridModePicker");
    var guestInfo = document.getElementById("guestGenInfo");
    var startBtn = document.getElementById("btnStartGame");
    var waitMsg = document.getElementById("waitingForHostMsg");

    if (isHost) {
      hostPicker.classList.remove("hidden");
      hostGridModePicker.classList.remove("hidden");
      guestInfo.classList.add("hidden");
      buildGenGrid();
      buildGridModePicker();
      var bothHere = room.players[1] && room.players[1].connected && room.players[2] && room.players[2].connected;
      startBtn.classList.remove("hidden");
      startBtn.disabled = !bothHere;
      waitMsg.classList.add("hidden");
    } else {
      hostPicker.classList.add("hidden");
      hostGridModePicker.classList.add("hidden");
      guestInfo.classList.remove("hidden");
      var gridModeInfo = GRID_MODE_INFO[room.gridMode] || GRID_MODE_INFO.normal;
      guestInfo.innerHTML =
        "Générations choisies par l'hôte : " +
        room.generations
          .map(function (g) {
            return '<span class="tag">Gen ' + g + "</span>";
          })
          .join(" ") +
        '<br><span class="tag">' + gridModeInfo.label + "</span>";
      startBtn.classList.add("hidden");
      waitMsg.classList.remove("hidden");
    }
  }

  document.getElementById("btnStartGame").addEventListener("click", function () {
    socket.emit("start_game", { code: roomCode });
  });

  document.getElementById("btnCopyCode").addEventListener("click", function () {
    var code = document.getElementById("roomCodeDisplay").textContent;
    var shareUrl = window.location.origin + "/?join=" + code;
    var text = code + " — " + shareUrl;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        var btn = document.getElementById("btnCopyCode");
        var old = btn.textContent;
        btn.textContent = "Copié !";
        setTimeout(function () {
          btn.textContent = old;
        }, 1500);
      });
    }
  });

  socket.on("players_update", function (room) {
    if (screens.waiting.classList.contains("hidden") === false) {
      renderWaitingRoom(room);
    }
    // Statut replay pendant l'écran victoire
    if (screens.victory.classList.contains("hidden") === false) {
      updateReplayStatus(room);
    }
  });

  // Après un vote de revanche unanime, le serveur renvoie tout le monde
  // dans la salle d'attente pour permettre de modifier les paramètres.
  socket.on("return_to_lobby", function (room) {
    resetRoundState();
    renderWaitingRoom(room);
    showOnly("waiting");
  });

  // ---------- Phase de choix du secret ----------
  socket.on("game_started", function (data) {
    gamePokemons = data.gamePokemons;
    localFlipped = {};
    myPickedSecret = null;
    renderPickScreen();
    showOnly("pick");
  });

  function renderPickScreen() {
    document.getElementById("pickWaitMsg").classList.add("hidden");
    var randomBtn = document.getElementById("btnRandomPick");
    if (randomBtn) randomBtn.disabled = false;
    var grid = document.getElementById("pickGrid");
    grid.innerHTML = "";
    gamePokemons.forEach(function (poke) {
      var card = buildCardMarkup(poke, "pick-hover", true);
      card.addEventListener("click", function () {
        openPickConfirmModal(poke);
      });
      grid.appendChild(card);
    });
  }

  function lockPickScreenAfterChoice() {
    document.getElementById("pickGrid").querySelectorAll(".card").forEach(function (c) {
      c.classList.add("picked-locked");
    });
    document.getElementById("pickWaitMsg").classList.remove("hidden");
    var randomBtn = document.getElementById("btnRandomPick");
    if (randomBtn) randomBtn.disabled = true;
  }

  function confirmSecretPick(poke) {
    myPickedSecret = poke;
    socket.emit("pick_secret", { code: roomCode, pokemonId: poke.id });
    lockPickScreenAfterChoice();
  }

  function openPickConfirmModal(poke) {
    modalRoot.innerHTML = "";
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    var box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML =
      "<h3>Confirmer ce choix ?</h3>" +
      "<img src='" + spriteUrl(poke.id) + "' alt='" + poke.name + "'>" +
      "<p><strong>" + poke.name + "</strong> sera le Pokémon que ton adversaire devra deviner.</p>";
    var actions = document.createElement("div");
    actions.className = "modal-actions";
    var yesBtn = document.createElement("button");
    yesBtn.className = "btn btn-green";
    yesBtn.textContent = "Confirmer";
    var noBtn = document.createElement("button");
    noBtn.className = "btn btn-grey";
    noBtn.textContent = "Choisir un autre";
    actions.appendChild(yesBtn);
    actions.appendChild(noBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    modalRoot.appendChild(overlay);

    noBtn.onclick = function () {
      modalRoot.innerHTML = "";
    };
    yesBtn.onclick = function () {
      modalRoot.innerHTML = "";
      confirmSecretPick(poke);
    };
  }

  var btnRandomPick = document.getElementById("btnRandomPick");
  if (btnRandomPick) {
    btnRandomPick.addEventListener("click", function () {
      if (myPickedSecret || !gamePokemons.length) return;
      var randomIndex = Math.floor(Math.random() * gamePokemons.length);
      var poke = gamePokemons[randomIndex];
      confirmSecretPick(poke);
    });
  }

  // ---------- Partie principale ----------
  socket.on("game_ready", function (data) {
    currentPlayer = data.currentPlayer;
    guessMode = data.guessMode;
    localFlipped = {};
    renderGameScreen();
    showOnly("game");
  });

  function buildCardMarkup(pokeData, extraClass, faceUpForced) {
    var card = document.createElement("div");
    card.className = "card" + (extraClass ? " " + extraClass : "");
    card.dataset.id = pokeData.id;

    var inner = document.createElement("div");
    inner.className = "card-inner";

    var front = document.createElement("div");
    front.className = "card-face card-front";
    var img = document.createElement("img");
    img.src = spriteUrl(pokeData.id);
    img.alt = pokeData.name;
    var pname = document.createElement("div");
    pname.className = "pname";
    pname.textContent = pokeData.name;
    front.appendChild(img);
    front.appendChild(pname);

    var back = document.createElement("div");
    back.className = "card-face card-back";

    inner.appendChild(front);
    inner.appendChild(back);
    card.appendChild(inner);

    var infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "info-btn";
    infoBtn.textContent = "i";
    infoBtn.setAttribute("aria-label", "Voir la fiche Pokédex de " + pokeData.name);
    infoBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      openPokedexModal(pokeData);
    });
    // Bouton positionné en dehors de la carte à effet 3D (card-inner) afin de
    // rester lisible et cliquable quelle que soit la face affichée.
    card.appendChild(infoBtn);

    if (faceUpForced === false) card.classList.add("flipped");
    return card;
  }

  function renderGameScreen() {
    document.getElementById("ownSecretImg").src = myPickedSecret ? spriteUrl(myPickedSecret.id) : "";
    document.getElementById("ownSecretName").textContent = myPickedSecret ? myPickedSecret.name : "-";

    var myTurn = currentPlayer === myPlayerNum;
    document.getElementById("turnPlayerName").textContent = myTurn ? "Toi" : "L'adversaire";
    document.getElementById("turnSub").textContent = guessMode
      ? myTurn
        ? "Clique sur le Pokémon que tu devines"
        : "L'adversaire est en train de deviner..."
      : "Pose tes questions à voix haute";

    var banner = document.getElementById("guessBanner");
    banner.classList.toggle("show", guessMode && myTurn);

    var notTurnBanner = document.getElementById("notYourTurnBanner");
    notTurnBanner.classList.toggle("show", !myTurn);

    document.getElementById("btnCancelGuess").classList.toggle("hidden", !(guessMode && myTurn));
    document.getElementById("btnGuess").disabled = !myTurn || guessMode;
    document.getElementById("btnPass").disabled = !myTurn;

    var grid = document.getElementById("mainGrid");
    grid.innerHTML = "";
    gamePokemons.forEach(function (poke) {
      var flipped = !!localFlipped[poke.id];
      var extra = guessMode && myTurn ? "guessable" : "";
      var card = buildCardMarkup(poke, extra, !flipped);
      card.addEventListener("click", function () {
        onMainCardClick(poke, card);
      });
      grid.appendChild(card);
    });
  }

  function onMainCardClick(poke, cardEl) {
    if (guessMode && currentPlayer === myPlayerNum) {
      socket.emit("guess", { code: roomCode, pokemonId: poke.id });
      return;
    }
    if (guessMode) return; // pas ton tour, on ne peut pas deviner
    localFlipped[poke.id] = !localFlipped[poke.id];
    cardEl.classList.toggle("flipped");
  }

  document.getElementById("btnGuess").addEventListener("click", function () {
    if (currentPlayer !== myPlayerNum) return;
    socket.emit("toggle_guess_mode", { code: roomCode, guessMode: true });
  });
  document.getElementById("btnCancelGuess").addEventListener("click", function () {
    socket.emit("toggle_guess_mode", { code: roomCode, guessMode: false });
  });
  document.getElementById("btnPass").addEventListener("click", function () {
    if (currentPlayer !== myPlayerNum) return;
    socket.emit("pass_turn", { code: roomCode });
  });

  socket.on("turn_update", function (data) {
    currentPlayer = data.currentPlayer;
    guessMode = data.guessMode;
    renderGameScreen();
  });

  socket.on("wrong_guess", function (data) {
    if (data.by !== myPlayerNum) {
      // Petite notification passive pour l'autre joueur
      return;
    }
    modalRoot.innerHTML = "";
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    var box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML =
      "<h3>Raté !</h3>" +
      "<img src='" + spriteUrl(data.pokemonId) + "' alt='" + data.name + "'>" +
      "<p><strong>" + data.name + "</strong> n'est pas le bon Pokémon. Ton tour est terminé.</p>";
    var actions = document.createElement("div");
    actions.className = "modal-actions";
    var okBtn = document.createElement("button");
    okBtn.className = "btn btn-red";
    okBtn.textContent = "D'accord";
    actions.appendChild(okBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    modalRoot.appendChild(overlay);
    okBtn.onclick = function () {
      modalRoot.innerHTML = "";
    };
  });

  // ---------- Victoire ----------
  socket.on("victory", function (data) {
    var iWon = data.winner === myPlayerNum;
    document.getElementById("victoryTitle").textContent = iWon
      ? "TU AS GAGNÉ !"
      : data.winnerName + " GAGNE !";
    document.getElementById("victoryText").textContent = iWon
      ? "Bravo, tu as deviné le Pokémon secret de l'adversaire !"
      : data.winnerName + " a deviné correctement ton Pokémon secret.";
    document.getElementById("victorySecretImg").src = spriteUrl(data.secretFound.id);
    document.getElementById("victorySecretName").textContent = data.secretFound.name;
    var replayBtn = document.getElementById("btnReplay");
    replayBtn.disabled = false;
    document.getElementById("replayStatus").textContent = "En attente des deux joueurs...";
    showOnly("victory");
  });

  document.getElementById("btnReplay").addEventListener("click", function () {
    document.getElementById("btnReplay").disabled = true;
    socket.emit("replay_vote", { code: roomCode });
  });

  function updateReplayStatus(room) {
    var status = document.getElementById("replayStatus");
    var p1 = room.players[1],
      p2 = room.players[2];
    var c1 = p1 && p1.replayReady;
    var c2 = p2 && p2.replayReady;
    if (c1 && c2) {
      status.textContent = "Les deux joueurs sont prêts, retour à la salle d'attente...";
    } else if (c1 || c2) {
      var readyName = c1 ? p1.name : p2.name;
      status.textContent = readyName + " est prêt(e). En attente de l'autre joueur...";
    } else {
      status.textContent = "En attente des deux joueurs...";
    }
  }

  // ---------- Reconnexion / resynchronisation ----------
  socket.on("resync", function (data) {
    selectedGenerations = data.generations.slice();
    if (data.gridMode) selectedGridMode = data.gridMode;
    gamePokemons = data.gamePokemons || [];
    currentPlayer = data.currentPlayer;
    guessMode = data.guessMode;
    myPickedSecret = data.mySecret || null;

    if (data.status === "picking") {
      if (myPickedSecret) {
        renderPickScreen();
        lockPickScreenAfterChoice();
      } else {
        renderPickScreen();
      }
      showOnly("pick");
    } else if (data.status === "playing") {
      localFlipped = {};
      renderGameScreen();
      showOnly("game");
    } else if (data.status === "victory") {
      var iWon = data.winner === myPlayerNum;
      document.getElementById("victoryTitle").textContent = iWon ? "TU AS GAGNÉ !" : "Partie terminée";
      document.getElementById("victorySecretImg").src = spriteUrl(data.secretFound.id);
      document.getElementById("victorySecretName").textContent = data.secretFound.name;
      showOnly("victory");
    }
  });

  socket.on("disconnect", function () {
    connectionBanner.classList.add("show");
  });
  socket.on("connect", function () {
    connectionBanner.classList.remove("show");
  });

  // ---------- Pré-remplissage du code via ?join=XXXX ----------
  (function prefillJoinCode() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("join");
    if (code) {
      document.getElementById("joinCode").value = code.toUpperCase();
      showOnly("join");
    } else {
      showOnly("home");
    }
  })();
})();
