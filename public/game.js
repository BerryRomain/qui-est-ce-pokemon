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
    demicercle: document.getElementById("screen-demicercle"),
    demicercleVictory: document.getElementById("screen-demicercle-victory"),
    devinmon: document.getElementById("screen-devinmon"),
    devinmonVictory: document.getElementById("screen-devinmon-victory"),
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

  var GRID_MODE_INFO = {
    normal: { label: "Grille normale", desc: "48 Pokémon tirés au hasard" },
    mega: { label: "Méga grille", desc: "Tous les Pokémon des générations choisies" },
  };

  // ---------- État local ----------
  var myPlayerNum = null;
  var roomCode = null;
  var isHost = false;
  var roomMode = "quiestce";
  var roomMaxPlayers = 2;
  var roomPlayersCache = null;
  var selectedCreateMode = "quiestce";
  var selectedDevinmonPlayerCount = 2;
  var availableGenerations = []; // [{id,count}]
  var selectedGenerations = [1];
  var selectedGridMode = "normal";
  var gamePokemons = [];
  var localFlipped = {}; // id -> bool (mémo personnel, pas partagé)
  var myPickedSecret = null;
  var currentPlayer = 1;
  var guessMode = false;

  // ---------- État local Mode Demi-Cercle ----------
  var dcState = {
    role: null,
    phase: null,
    round: 0,
    totalRounds: 10,
    master: null,
    guesser: null,
    pokemon: null,
    masterPosition: null,
    guesserPosition: 50,
    myLocalPosition: 50,
    scores: { 1: 0, 2: 0 },
    lastRoundScore: null,
    draggableEnabled: false,
  };

  // ---------- État local Mode Devin'Mon ----------
  var dmState = {
    round: 0,
    totalRounds: 0,
    currentGuide: null,
    isGuide: false,
    secret: null,
    clues: [],
    statuses: {},
    guessLog: [],
    totals: {},
    roundPoints: null,
    roundOver: false,
    myStatus: null,
    currentTour: 0,
    canSubmitClue: false,
    pendingGuessers: [],
    myHasGuessedThisTour: false,
  };

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

  function resetDcState() {
    dcState.role = null;
    dcState.phase = null;
    dcState.round = 0;
    dcState.master = null;
    dcState.guesser = null;
    dcState.pokemon = null;
    dcState.masterPosition = null;
    dcState.guesserPosition = 50;
    dcState.myLocalPosition = 50;
    dcState.scores = { 1: 0, 2: 0 };
    dcState.lastRoundScore = null;
    dcState.draggableEnabled = false;
  }

  function resetDmState() {
    dmState.round = 0;
    dmState.totalRounds = 0;
    dmState.currentGuide = null;
    dmState.isGuide = false;
    dmState.secret = null;
    dmState.clues = [];
    dmState.statuses = {};
    dmState.guessLog = [];
    dmState.totals = {};
    dmState.roundPoints = null;
    dmState.roundOver = false;
    dmState.myStatus = null;
    dmState.currentTour = 0;
    dmState.canSubmitClue = false;
    dmState.pendingGuessers = [];
    dmState.myHasGuessedThisTour = false;
  }

  function resetLocalState() {
    myPlayerNum = null;
    roomCode = null;
    isHost = false;
    roomMode = "quiestce";
    roomMaxPlayers = 2;
    gamePokemons = [];
    localFlipped = {};
    myPickedSecret = null;
    currentPlayer = 1;
    guessMode = false;
    resetDcState();
    resetDmState();
  }

  function resetRoundState() {
    gamePokemons = [];
    localFlipped = {};
    myPickedSecret = null;
    currentPlayer = 1;
    guessMode = false;
    resetDcState();
    resetDmState();
  }

  // ---------- Sélection du mode de jeu (écran Créer) ----------
  function setCreateMode(m) {
    selectedCreateMode = m;
    document.getElementById("modeCardQuiestce").classList.toggle("checked", m === "quiestce");
    document.getElementById("modeCardDemicercle").classList.toggle("checked", m === "demicercle");
    document.getElementById("modeCardDevinmon").classList.toggle("checked", m === "devinmon");
    var picker = document.getElementById("devinmonPlayerCountPicker");
    if (m === "devinmon") {
      picker.classList.remove("hidden");
      buildDevinmonPlayerCountPicker();
    } else {
      picker.classList.add("hidden");
    }
  }
  document.getElementById("modeCardQuiestce").addEventListener("click", function () {
    setCreateMode("quiestce");
  });
  document.getElementById("modeCardDemicercle").addEventListener("click", function () {
    setCreateMode("demicercle");
  });
  document.getElementById("modeCardDevinmon").addEventListener("click", function () {
    setCreateMode("devinmon");
  });

  function buildDevinmonPlayerCountPicker() {
    var container = document.getElementById("devinmonPlayerCountOptions");
    container.innerHTML = "";
    for (var n = 2; n <= 6; n++) {
      (function (count) {
        var label = document.createElement("label");
        label.className = "grid-mode-option" + (selectedDevinmonPlayerCount === count ? " checked" : "");
        var input = document.createElement("input");
        input.type = "radio";
        input.name = "devinmonPlayerCount";
        input.value = count;
        input.checked = selectedDevinmonPlayerCount === count;
        input.addEventListener("change", function () {
          if (input.checked) {
            selectedDevinmonPlayerCount = count;
            buildDevinmonPlayerCountPicker();
          }
        });
        var span = document.createElement("span");
        span.innerHTML =
          '<span class="gm-label">' + count + " joueurs</span>" +
          '<span class="gm-desc">' + (count * 2) + " manches au total</span>";
        label.appendChild(input);
        label.appendChild(span);
        container.appendChild(label);
      })(n);
    }
  }

  // ---------- Création de lobby ----------
  document.getElementById("btnCreateSubmit").addEventListener("click", function () {
    var name = document.getElementById("createName").value.trim();
    if (!name) name = "Joueur 1";
    var payload = { name: name, mode: selectedCreateMode };
    if (selectedCreateMode === "devinmon") payload.maxPlayers = selectedDevinmonPlayerCount;
    socket.emit("create_room", payload);
  });

  socket.on("room_created", function (data) {
    myPlayerNum = data.playerNum;
    roomCode = data.code;
    isHost = true;
    roomMode = data.room.mode || "quiestce";
    roomMaxPlayers = data.room.maxPlayers || 2;
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
    if (!name) name = "Joueur";
    socket.emit("join_room", { code: code, name: name });
  });

  socket.on("room_joined", function (data) {
    myPlayerNum = data.playerNum;
    roomCode = data.code;
    isHost = data.playerNum === 1;
    roomMode = data.room.mode || "quiestce";
    roomMaxPlayers = data.room.maxPlayers || 2;
    renderWaitingRoom(data.room);
    showOnly("waiting");
    loadGenerationsIfNeeded();
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
    roomMode = room.mode || "quiestce";
    roomMaxPlayers = room.maxPlayers || 2;
    roomPlayersCache = room.players;
    if (room.generations) selectedGenerations = room.generations.slice();
    if (room.gridMode) selectedGridMode = room.gridMode;

    var statusEl = document.getElementById("playersStatus");
    statusEl.innerHTML = "";
    var connectedCount = 0;
    var filledCount = 0;
    for (var n = 1; n <= roomMaxPlayers; n++) {
      (function (num) {
        var p = room.players[num];
        if (p) filledCount++;
        if (p && p.connected) connectedCount++;
        var slot = document.createElement("div");
        slot.className = "player-slot" + (p && p.connected ? " connected" : "") + (!p ? " empty" : "");
        slot.innerHTML =
          '<span class="role pixel">' +
          (num === 1 ? "HÔTE" : "JOUEUR " + num) +
          "</span>" +
          '<div class="pname"><span class="status-dot"></span>' +
          (p ? p.name : "En attente...") +
          "</div>";
        statusEl.appendChild(slot);
      })(n);
    }

    var hostPicker = document.getElementById("hostGenPicker");
    var hostGridModePicker = document.getElementById("hostGridModePicker");
    var dcHintHost = document.getElementById("dcModeHintHost");
    var dmHintHost = document.getElementById("dmModeHintHost");
    var guestInfo = document.getElementById("guestGenInfo");
    var startBtn = document.getElementById("btnStartGame");
    var waitMsg = document.getElementById("waitingForHostMsg");

    if (isHost) {
      hostPicker.classList.remove("hidden");
      guestInfo.classList.add("hidden");
      buildGenGrid();
      if (roomMode === "demicercle") {
        hostGridModePicker.classList.add("hidden");
        dcHintHost.classList.remove("hidden");
        dmHintHost.classList.add("hidden");
      } else if (roomMode === "devinmon") {
        hostGridModePicker.classList.add("hidden");
        dcHintHost.classList.add("hidden");
        dmHintHost.classList.remove("hidden");
      } else {
        hostGridModePicker.classList.remove("hidden");
        dcHintHost.classList.add("hidden");
        dmHintHost.classList.add("hidden");
        buildGridModePicker();
      }
      var canStart = filledCount >= 2 && connectedCount === filledCount;
      startBtn.classList.remove("hidden");
      startBtn.disabled = !canStart;
      startBtn.textContent =
        roomMode === "demicercle"
          ? "Démarrer le Demi-Cercle"
          : roomMode === "devinmon"
          ? "Démarrer le Devin'Mon"
          : "Démarrer la partie";
      waitMsg.classList.add("hidden");
    } else {
      hostPicker.classList.add("hidden");
      hostGridModePicker.classList.add("hidden");
      dcHintHost.classList.add("hidden");
      dmHintHost.classList.add("hidden");
      guestInfo.classList.remove("hidden");
      var gridModeInfo = GRID_MODE_INFO[room.gridMode] || GRID_MODE_INFO.normal;
      var modeLabel =
        roomMode === "demicercle" ? "Mode Demi-Cercle" : roomMode === "devinmon" ? "Mode Devin'Mon" : "Mode Qui est-ce ?";
      var modeTag = '<span class="tag">' + modeLabel + "</span><br>";
      guestInfo.innerHTML =
        modeTag +
        "Générations choisies par l'hôte : " +
        room.generations
          .map(function (g) {
            return '<span class="tag">Gen ' + g + "</span>";
          })
          .join(" ") +
        (roomMode === "quiestce" ? '<br><span class="tag">' + gridModeInfo.label + "</span>" : "");
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
    roomPlayersCache = room.players;
    roomMaxPlayers = room.maxPlayers || roomMaxPlayers;
    if (screens.waiting.classList.contains("hidden") === false) {
      renderWaitingRoom(room);
    }
    // Statut replay pendant l'écran victoire
    if (screens.victory.classList.contains("hidden") === false) {
      updateReplayStatus(room);
    }
    if (screens.demicercleVictory.classList.contains("hidden") === false) {
      updateDcReplayStatus(room);
    }
    if (screens.devinmonVictory.classList.contains("hidden") === false) {
      updateDmReplayStatus(room);
    }
  });

  // Après un vote de revanche unanime, le serveur renvoie tout le monde
  // dans la salle d'attente pour permettre de modifier les paramètres.
  socket.on("return_to_lobby", function (room) {
    resetRoundState();
    renderWaitingRoom(room);
    showOnly("waiting");
  });

  // ---------- Phase de choix du secret (mode Qui est-ce ?) ----------
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

  // ---------- Partie principale (mode Qui est-ce ?) ----------
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
    var infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "card-info-btn";
    infoBtn.setAttribute("aria-label", "Informations sur " + pokeData.name);
    infoBtn.textContent = "i";
    infoBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openPokemonInfoModal(pokeData.id, pokeData.name);
    });

    front.appendChild(img);
    front.appendChild(pname);
    front.appendChild(infoBtn);

    var back = document.createElement("div");
    back.className = "card-face card-back";

    inner.appendChild(front);
    inner.appendChild(back);
    card.appendChild(inner);

    if (faceUpForced === false) card.classList.add("flipped");
    return card;
  }

  // ---------- Bulle d'info Pokédex (modal détaillée par Pokémon) ----------
  var TYPE_FR = {
    normal: "Normal", fighting: "Combat", flying: "Vol", poison: "Poison",
    ground: "Sol", rock: "Roche", bug: "Insecte", ghost: "Spectre",
    steel: "Acier", fire: "Feu", water: "Eau", grass: "Plante",
    electric: "Électrik", psychic: "Psy", ice: "Glace", dragon: "Dragon",
    dark: "Ténèbres", fairy: "Fée",
  };
  var COLOR_FR = {
    black: "Noir", blue: "Bleu", brown: "Marron", gray: "Gris",
    green: "Vert", pink: "Rose", purple: "Violet", red: "Rouge",
    white: "Blanc", yellow: "Jaune",
  };
  var EGG_GROUP_FR = {
    monster: "Monstre", "water1": "Eau 1", "water2": "Eau 2", "water3": "Eau 3",
    bug: "Insecte", flying: "Vol", ground: "Sol", fairy: "Fée",
    plant: "Végétal", humanshape: "Humanoïde", mineral: "Minéral",
    indeterminate: "Indéterminé", dragon: "Dragon", "no-eggs": "Aucun (ne se reproduit pas)",
    ditto: "Ditto",
  };

  var pokemonInfoCache = {};

  function closeInfoModal() {
    document.getElementById("modalRoot").innerHTML = "";
  }

  function openPokemonInfoModal(id, frName) {
    var modalRoot = document.getElementById("modalRoot");
    modalRoot.innerHTML =
      '<div class="modal-overlay" id="infoModalOverlay">' +
      '<div class="modal-box info-modal-box">' +
      '<button type="button" class="info-modal-close" id="infoModalClose">&times;</button>' +
      '<div class="info-modal-loading">Chargement...</div>' +
      "</div></div>";
    document.getElementById("infoModalOverlay").addEventListener("click", function (e) {
      if (e.target.id === "infoModalOverlay") closeInfoModal();
    });
    document.getElementById("infoModalClose").addEventListener("click", closeInfoModal);

    if (pokemonInfoCache[id]) {
      renderInfoModal(pokemonInfoCache[id], frName);
      return;
    }

    Promise.all([
      fetch("https://pokeapi.co/api/v2/pokemon/" + id).then(function (r) {
        return r.json();
      }),
      fetch("https://pokeapi.co/api/v2/pokemon-species/" + id).then(function (r) {
        return r.json();
      }),
    ])
      .then(function (results) {
        var data = { pokemon: results[0], species: results[1] };
        pokemonInfoCache[id] = data;
        renderInfoModal(data, frName);
      })
      .catch(function () {
        var box = document.querySelector(".info-modal-box");
        if (box) {
          var loading = box.querySelector(".info-modal-loading");
          if (loading) loading.textContent = "Impossible de charger les informations pour le moment.";
        }
      });
  }

  function renderInfoModal(data, frName) {
    var box = document.querySelector(".info-modal-box");
    if (!box) return;
    var pokemon = data.pokemon;
    var species = data.species;

    var genusEntry = (species.genera || []).find(function (g) {
      return g.language && g.language.name === "fr";
    });
    var genus = genusEntry ? genusEntry.genus : "";

    var typesHtml = pokemon.types
      .map(function (t) {
        var key = t.type.name;
        return '<span class="type-badge type-' + key + '">' + (TYPE_FR[key] || key) + "</span>";
      })
      .join("");

    var heightM = (pokemon.height / 10).toFixed(1).replace(".0", "") + " m";
    var weightKg = (pokemon.weight / 10).toFixed(1).replace(".0", "") + " kg";
    var colorName = COLOR_FR[species.color ? species.color.name : ""] || (species.color ? species.color.name : "-");
    var captureRate = species.capture_rate;
    var eggGroups = (species.egg_groups || [])
      .map(function (g) {
        return EGG_GROUP_FR[g.name] || g.name;
      })
      .join(", ") || "-";

    var genderHtml;
    if (species.gender_rate === -1) {
      genderHtml = '<div class="gender-none">Asexué (sans genre)</div>';
    } else {
      var femalePct = (species.gender_rate / 8) * 100;
      var malePct = 100 - femalePct;
      genderHtml =
        '<div class="gender-labels"><span>&#9794; ' +
        malePct.toFixed(0) +
        "% / </span><span>&#9792; " +
        femalePct.toFixed(0) +
        "%</span></div>" +
        '<div class="gender-bar"><div class="gender-bar-male" style="width:' +
        malePct +
        '%"></div><div class="gender-bar-female" style="width:' +
        femalePct +
        '%"></div></div>';
    }

    var cryUrl =
      pokemon.cries && (pokemon.cries.latest || pokemon.cries.legacy)
        ? pokemon.cries.latest || pokemon.cries.legacy
        : null;

    var idPadded = "#" + String(pokemon.id).padStart(4, "0");

    box.innerHTML =
      '<button type="button" class="info-modal-close" id="infoModalClose">&times;</button>' +
      '<div class="info-modal-header">' +
      '<img class="info-modal-sprite" src="' + spriteUrl(pokemon.id) + '" alt="' + frName + '">' +
      '<div><div class="info-modal-num">' + idPadded + "</div>" +
      '<h3 class="info-modal-name">' + frName + "</h3>" +
      '<div class="info-modal-types">' + typesHtml + "</div>" +
      (genus ? '<div class="info-modal-genus">' + genus + "</div>" : "") +
      "</div></div>" +
      '<div class="info-modal-grid">' +
      '<div class="info-box"><span class="info-box-label">Taille</span><span class="info-box-value">' + heightM + "</span></div>" +
      '<div class="info-box"><span class="info-box-label">Poids</span><span class="info-box-value">' + weightKg + "</span></div>" +
      "</div>" +
      '<div class="info-modal-grid">' +
      '<div class="info-box"><span class="info-box-label">Couleur</span><span class="info-box-value">' + colorName + "</span></div>" +
      '<div class="info-box"><span class="info-box-label">Taux de capture</span><span class="info-box-value">' + captureRate + "</span></div>" +
      "</div>" +
      '<div class="info-box info-box-wide"><span class="info-box-label">Groupe(s) d\'œufs</span><span class="info-box-value">' + eggGroups + "</span></div>" +
      '<div class="info-box info-box-wide"><span class="info-box-label">Répartition des genres</span>' + genderHtml + "</div>" +
      (cryUrl
        ? '<div class="info-box info-box-wide"><span class="info-box-label">Cri officiel</span><audio controls src="' + cryUrl + '" class="info-cry-audio"></audio></div>'
        : "");

    document.getElementById("infoModalClose").addEventListener("click", closeInfoModal);
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

  // ---------- Victoire (mode Qui est-ce ?) ----------
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

  function updateDcReplayStatus(room) {
    var status = document.getElementById("dcReplayStatus");
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

  function updateDmReplayStatus(room) {
    var status = document.getElementById("dmReplayStatus");
    var readyNames = [];
    var totalOccupied = 0;
    for (var n = 1; n <= (room.maxPlayers || roomMaxPlayers); n++) {
      var p = room.players[n];
      if (!p) continue;
      totalOccupied++;
      if (p.replayReady) readyNames.push(p.name);
    }
    if (readyNames.length === totalOccupied) {
      status.textContent = "Tout le monde est prêt, retour à la salle d'attente...";
    } else if (readyNames.length > 0) {
      status.textContent = readyNames.join(", ") + " prêt(s). En attente des autres joueurs (" + readyNames.length + "/" + totalOccupied + ")...";
    } else {
      status.textContent = "En attente de tous les joueurs...";
    }
  }

  // =====================================================================
  // ============ MODE DEMI-CERCLE (inspiré de Wavelength) ==============
  // =====================================================================

  var DC_CENTER = { x: 160, y: 178 };
  var DC_RADIUS = 150;
  var DC_ZONES_DEF = [
    { half: 18, cls: "dc-zone-2" },
    { half: 10, cls: "dc-zone-3" },
    { half: 4, cls: "dc-zone-4" },
  ];

  function dcPointAt(p, r) {
    var angle = Math.PI * (1 - p / 100);
    return {
      x: DC_CENTER.x + r * Math.cos(angle),
      y: DC_CENTER.y - r * Math.sin(angle),
    };
  }

  function dcSetDotPosition(dotEl, needleEl, position) {
    var pt = dcPointAt(position, DC_RADIUS);
    dotEl.setAttribute("cx", pt.x);
    dotEl.setAttribute("cy", pt.y);
    needleEl.setAttribute("x1", DC_CENTER.x);
    needleEl.setAttribute("y1", DC_CENTER.y);
    needleEl.setAttribute("x2", pt.x);
    needleEl.setAttribute("y2", pt.y);
  }

  function dcArcPath(p1, p2, r) {
    var a = dcPointAt(Math.max(0, p1), r);
    var b = dcPointAt(Math.min(100, p2), r);
    return "M " + a.x + " " + a.y + " A " + r + " " + r + " 0 0 1 " + b.x + " " + b.y;
  }

  function dcDrawTrack() {
    var left = dcPointAt(0, DC_RADIUS);
    var top = dcPointAt(50, DC_RADIUS);
    var right = dcPointAt(100, DC_RADIUS);
    var d =
      "M " + left.x + " " + left.y +
      " A " + DC_RADIUS + " " + DC_RADIUS + " 0 0 1 " + top.x + " " + top.y +
      " A " + DC_RADIUS + " " + DC_RADIUS + " 0 0 1 " + right.x + " " + right.y;
    document.getElementById("dcTrack").setAttribute("d", d);
  }
  dcDrawTrack();

  function dcDrawZones(masterPosition) {
    var zonesG = document.getElementById("dcZones");
    zonesG.innerHTML = "";
    DC_ZONES_DEF.forEach(function (z) {
      var p1 = masterPosition - z.half;
      var p2 = masterPosition + z.half;
      if (p2 <= 0 || p1 >= 100) return;
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", dcArcPath(p1, p2, DC_RADIUS));
      path.setAttribute("class", "dc-zone " + z.cls);
      zonesG.appendChild(path);
    });
  }

  // ---------- Interaction (glisser-déposer sur le demi-cercle) ----------
  var dcSvgEl = document.getElementById("dcSvg");
  var dcDragActive = false;

  function dcPositionFromEvent(evt) {
    var rect = dcSvgEl.getBoundingClientRect();
    var viewBoxW = 320,
      viewBoxH = 190;
    var scaleX = viewBoxW / rect.width;
    var scaleY = viewBoxH / rect.height;
    var clientX = evt.clientX !== undefined ? evt.clientX : evt.touches && evt.touches[0].clientX;
    var clientY = evt.clientY !== undefined ? evt.clientY : evt.touches && evt.touches[0].clientY;
    var x = (clientX - rect.left) * scaleX;
    var y = (clientY - rect.top) * scaleY;
    var dx = x - DC_CENTER.x;
    var dy = DC_CENTER.y - y;

    var angleDeg;
    if (dy >= 0) {
      angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0..180
    } else {
      angleDeg = dx >= 0 ? 0 : 180;
    }
    if (angleDeg < 0) angleDeg = 0;
    if (angleDeg > 180) angleDeg = 180;
    var position = 100 - (angleDeg / 180) * 100;
    return Math.max(0, Math.min(100, position));
  }

  var dcMoveThrottleTimer = null;
  var dcPendingMove = null;
  function dcThrottledEmitMove(pos) {
    dcPendingMove = pos;
    if (dcMoveThrottleTimer) return;
    dcMoveThrottleTimer = setTimeout(function () {
      dcMoveThrottleTimer = null;
      if (dcPendingMove !== null) {
        socket.emit("demicercle_guesser_move", { code: roomCode, position: dcPendingMove });
        dcPendingMove = null;
      }
    }, 60);
  }

  function dcHandlePointerMove(evt) {
    if (!dcDragActive) return;
    var pos = dcPositionFromEvent(evt);
    dcState.myLocalPosition = pos;
    var myDot = document.getElementById("dcMyDot");
    var myNeedle = document.getElementById("dcMyNeedle");
    dcSetDotPosition(myDot, myNeedle, pos);
    if (dcState.role === "guesser" && dcState.phase === "guessing") {
      dcThrottledEmitMove(pos);
    }
  }
  function dcHandlePointerDown(evt) {
    if (!dcState.draggableEnabled) return;
    dcDragActive = true;
    dcHandlePointerMove(evt);
    evt.preventDefault();
  }
  function dcHandlePointerUp() {
    dcDragActive = false;
  }
  dcSvgEl.addEventListener("pointerdown", dcHandlePointerDown);
  window.addEventListener("pointermove", dcHandlePointerMove);
  window.addEventListener("pointerup", dcHandlePointerUp);

  function dcSetDraggable(enabled) {
    dcState.draggableEnabled = enabled;
  }

  // ---------- Rendu de l'écran Demi-Cercle ----------
  function renderDcScreen() {
    document.getElementById("dcRoundNum").textContent = dcState.round;
    document.getElementById("dcTotalRounds").textContent = dcState.totalRounds;

    var p1Name = roomPlayersCache && roomPlayersCache[1] ? roomPlayersCache[1].name : "Joueur 1";
    var p2Name = roomPlayersCache && roomPlayersCache[2] ? roomPlayersCache[2].name : "Joueur 2";
    document.getElementById("dcScoreP1Name").textContent = p1Name;
    document.getElementById("dcScoreP2Name").textContent = p2Name;
    document.getElementById("dcScoreP1").textContent = dcState.scores[1] || 0;
    document.getElementById("dcScoreP2").textContent = dcState.scores[2] || 0;

    var isMaster = dcState.role === "master";
    var roleBadge = document.getElementById("dcRoleBadge");
    roleBadge.textContent = isMaster ? "Tu es le Maître du round 🤫" : "Tu es le Devineur 🔎";
    roleBadge.className = "dc-role-badge " + (isMaster ? "dc-role-master" : "dc-role-guesser");

    var pokePanel = document.getElementById("dcPokemonPanel");
    var hiddenMsg = document.getElementById("dcPokemonHiddenMsg");
    if (dcState.pokemon) {
      pokePanel.classList.remove("hidden");
      hiddenMsg.classList.add("hidden");
      document.getElementById("dcPokemonImg").src = spriteUrl(dcState.pokemon.id);
      document.getElementById("dcPokemonName").textContent = dcState.pokemon.name;
    } else {
      pokePanel.classList.add("hidden");
      hiddenMsg.classList.remove("hidden");
      hiddenMsg.textContent = "Le Maître du round choisit sa position secrète, patiente un instant...";
    }

    var myDot = document.getElementById("dcMyDot");
    var myNeedle = document.getElementById("dcMyNeedle");
    var otherDot = document.getElementById("dcOtherDot");
    var otherNeedle = document.getElementById("dcOtherNeedle");
    var revealPanel = document.getElementById("dcRevealPanel");
    var zonesG = document.getElementById("dcZones");
    var btnValidateMaster = document.getElementById("btnDcValidateMaster");
    var btnValidateGuesser = document.getElementById("btnDcValidateGuesser");
    var btnContinue = document.getElementById("btnDcContinue");
    var waitMsg = document.getElementById("dcWaitMsg");

    // Réinitialisation propre avant d'appliquer l'état de la phase
    myDot.setAttribute("class", "dc-dot dc-dot-mine hidden");
    myNeedle.setAttribute("class", "dc-needle dc-needle-mine hidden");
    otherDot.setAttribute("class", "dc-dot dc-dot-other hidden");
    otherNeedle.setAttribute("class", "dc-needle dc-needle-other hidden");
    btnValidateMaster.classList.add("hidden");
    btnValidateGuesser.classList.add("hidden");
    btnContinue.classList.add("hidden");
    waitMsg.classList.add("hidden");
    revealPanel.classList.add("hidden");
    zonesG.innerHTML = "";
    dcSetDraggable(false);

    if (dcState.phase === "master_placing") {
      if (isMaster) {
        myDot.classList.remove("hidden");
        myNeedle.classList.remove("hidden");
        dcSetDotPosition(myDot, myNeedle, dcState.myLocalPosition);
        dcSetDraggable(true);
        btnValidateMaster.classList.remove("hidden");
      } else {
        waitMsg.classList.remove("hidden");
        waitMsg.textContent = "Le Maître du round choisit sa position secrète...";
      }
    } else if (dcState.phase === "guessing") {
      if (isMaster) {
        myDot.classList.remove("hidden");
        myNeedle.classList.remove("hidden");
        myDot.classList.add("dc-dot-locked");
        dcSetDotPosition(myDot, myNeedle, dcState.masterPosition);
        otherDot.classList.remove("hidden");
        otherNeedle.classList.remove("hidden");
        dcSetDotPosition(otherDot, otherNeedle, dcState.guesserPosition);
        waitMsg.classList.remove("hidden");
        waitMsg.textContent = "Le Devineur réfléchit, débattez à l'oral !";
      } else {
        myDot.classList.remove("hidden");
        myNeedle.classList.remove("hidden");
        dcSetDotPosition(myDot, myNeedle, dcState.myLocalPosition);
        dcSetDraggable(true);
        btnValidateGuesser.classList.remove("hidden");
      }
    } else if (dcState.phase === "revealed") {
      dcDrawZones(dcState.masterPosition);

      otherDot.classList.remove("hidden");
      otherNeedle.classList.remove("hidden");
      otherDot.classList.add("dc-dot-master-reveal");
      dcSetDotPosition(otherDot, otherNeedle, dcState.masterPosition);

      myDot.classList.remove("hidden");
      myNeedle.classList.remove("hidden");
      myDot.classList.add("dc-dot-guesser-reveal");
      dcSetDotPosition(myDot, myNeedle, dcState.guesserPosition);

      revealPanel.classList.remove("hidden");
      var pts = dcState.lastRoundScore || 0;
      document.getElementById("dcRevealPoints").textContent = "+" + pts + (pts > 1 ? " points" : " point");
      var guesserName = dcState.guesser === 1 ? p1Name : p2Name;
      document.getElementById("dcRevealDetail").textContent =
        guesserName + " marque " + pts + " point(s) sur ce round.";
      btnContinue.classList.remove("hidden");
    }
  }

  function applyDcRoundData(data) {
    dcState.role = data.role;
    dcState.phase = data.phase;
    dcState.round = data.round;
    dcState.totalRounds = data.totalRounds;
    dcState.master = data.master;
    dcState.guesser = data.guesser;
    dcState.pokemon = data.pokemon;
    dcState.masterPosition = data.masterPosition;
    dcState.guesserPosition = data.guesserPosition;
    dcState.scores = data.scores;
    dcState.lastRoundScore = data.lastRoundScore;
    if (dcState.role === "master" && dcState.phase === "master_placing") {
      dcState.myLocalPosition = 50;
    } else if (dcState.role === "guesser" && dcState.phase === "guessing") {
      dcState.myLocalPosition = data.guesserPosition;
    }
    renderDcScreen();
  }

  socket.on("demicercle_round_start", function (data) {
    document.getElementById("btnDcContinue").disabled = false;
    applyDcRoundData(data);
    showOnly("demicercle");
  });

  socket.on("demicercle_guesser_move_update", function (data) {
    if (dcState.role !== "master" || dcState.phase !== "guessing") return;
    dcState.guesserPosition = data.position;
    var otherDot = document.getElementById("dcOtherDot");
    var otherNeedle = document.getElementById("dcOtherNeedle");
    if (!otherDot.classList.contains("hidden")) {
      dcSetDotPosition(otherDot, otherNeedle, data.position);
    }
  });

  socket.on("demicercle_continue_status", function (data) {
    var mine = data.continueReady[myPlayerNum];
    if (!mine) return;
    var waitMsg = document.getElementById("dcWaitMsg");
    waitMsg.classList.remove("hidden");
    waitMsg.textContent = "En attente que l'autre joueur clique sur Continuer...";
    document.getElementById("btnDcContinue").classList.add("hidden");
  });

  socket.on("demicercle_game_over", function (data) {
    var iWon = data.winner === myPlayerNum;
    var title, text;
    if (data.winner === null) {
      title = "ÉGALITÉ !";
      text = "Vous avez fini à égalité, beau duel !";
    } else if (iWon) {
      title = "TU AS GAGNÉ !";
      text = "Bravo, tu as le meilleur total de points sur les 10 rounds !";
    } else {
      title = data.winnerName + " GAGNE !";
      text = data.winnerName + " a remporté le plus grand nombre de points.";
    }
    document.getElementById("dcVictoryTitle").textContent = title;
    document.getElementById("dcVictoryText").textContent = text;

    var p1Name = roomPlayersCache && roomPlayersCache[1] ? roomPlayersCache[1].name : "Joueur 1";
    var p2Name = roomPlayersCache && roomPlayersCache[2] ? roomPlayersCache[2].name : "Joueur 2";
    var scoresEl = document.getElementById("dcFinalScores");
    scoresEl.innerHTML =
      '<div class="dc-final-score-box"><span>' + p1Name + "</span><strong>" + (data.scores[1] || 0) + "</strong></div>" +
      '<div class="dc-final-score-box"><span>' + p2Name + "</span><strong>" + (data.scores[2] || 0) + "</strong></div>";

    document.getElementById("btnDcReplay").disabled = false;
    document.getElementById("dcReplayStatus").textContent = "En attente des deux joueurs...";
    showOnly("demicercleVictory");
  });

  document.getElementById("btnDcValidateMaster").addEventListener("click", function () {
    socket.emit("demicercle_master_submit", { code: roomCode, position: dcState.myLocalPosition });
    dcSetDraggable(false);
  });
  document.getElementById("btnDcValidateGuesser").addEventListener("click", function () {
    socket.emit("demicercle_guesser_submit", { code: roomCode, position: dcState.myLocalPosition });
    dcSetDraggable(false);
  });
  document.getElementById("btnDcContinue").addEventListener("click", function () {
    document.getElementById("btnDcContinue").disabled = true;
    socket.emit("demicercle_continue", { code: roomCode });
  });
  document.getElementById("btnDcReplay").addEventListener("click", function () {
    document.getElementById("btnDcReplay").disabled = true;
    socket.emit("replay_vote", { code: roomCode });
  });

  // =====================================================================
  // ========================= MODE DEVIN'MON ============================
  // =====================================================================

  function dmPlayerName(playerNum) {
    var p = roomPlayersCache && roomPlayersCache[playerNum];
    return p ? p.name : "Joueur " + playerNum;
  }

  function renderDmScreen() {
    document.getElementById("dmRoundNum").textContent = dmState.round;
    document.getElementById("dmTotalRounds").textContent = dmState.totalRounds;

    var roleBadge = document.getElementById("dmRoleBadge");
    if (dmState.isGuide) {
      roleBadge.textContent = "Tu es le Guide 🧭";
      roleBadge.className = "dm-role-badge";
    } else {
      roleBadge.textContent = "Devine avant les autres : " + dmPlayerName(dmState.currentGuide) + " est le Guide";
      roleBadge.className = "dm-role-badge dm-role-guessing";
    }

    // Tableau des scores cumulés (le plus bas gagne)
    var scoreboard = document.getElementById("dmScoreboard");
    scoreboard.innerHTML = "";
    var nums = Object.keys(dmState.totals).map(Number).sort(function (a, b) {
      return a - b;
    });
    nums.forEach(function (n) {
      var box = document.createElement("div");
      var extra = "";
      if (n === dmState.currentGuide) extra += " dm-score-guide";
      if (dmState.statuses[n] === "found") extra += " dm-score-found";
      if (dmState.statuses[n] === "abandoned") extra += " dm-score-abandoned";
      box.className = "dm-score-box" + extra;
      box.innerHTML =
        '<span class="dm-score-name">' + dmPlayerName(n) + (n === myPlayerNum ? " (toi)" : "") + "</span>" +
        '<span class="dm-score-val">' + (dmState.totals[n] || 0) + "</span>";
      scoreboard.appendChild(box);
    });

    // Panneaux Guide / Devineur
    var guidePanel = document.getElementById("dmGuidePanel");
    var guesserPanel = document.getElementById("dmGuesserPanel");
    var foundMsg = document.getElementById("dmFoundMsg");
    var abandonedMsg = document.getElementById("dmAbandonedMsg");
    guidePanel.classList.add("hidden");
    guesserPanel.classList.add("hidden");
    foundMsg.classList.add("hidden");
    abandonedMsg.classList.add("hidden");

    var guideWaitMsg = document.getElementById("dmGuideWaitMsg");
    var guesserWaitMsg = document.getElementById("dmGuesserWaitMsg");
    if (guideWaitMsg) guideWaitMsg.classList.add("hidden");
    if (guesserWaitMsg) guesserWaitMsg.classList.add("hidden");

    if (!dmState.roundOver) {
      if (dmState.isGuide) {
        guidePanel.classList.remove("hidden");
        document.getElementById("dmSecretImg").src = dmState.secret ? spriteUrl(dmState.secret.id) : "";
        document.getElementById("dmSecretName").textContent = dmState.secret ? dmState.secret.name : "-";
        var clueInput = document.getElementById("dmClueInput");
        var clueBtn = document.getElementById("btnDmSubmitClue");
        if (dmState.canSubmitClue) {
          clueInput.disabled = false;
          clueBtn.disabled = false;
          if (guideWaitMsg) guideWaitMsg.classList.add("hidden");
        } else {
          clueInput.disabled = true;
          clueBtn.disabled = true;
          if (guideWaitMsg) {
            var names = dmState.pendingGuessers && dmState.pendingGuessers.length
              ? dmState.pendingGuessers.join(", ")
              : "";
            guideWaitMsg.textContent = names
              ? "En attente de la proposition de : " + names + "..."
              : "En attente des propositions des devineurs...";
            guideWaitMsg.classList.remove("hidden");
          }
        }
      } else if (dmState.myStatus === "found") {
        foundMsg.classList.remove("hidden");
      } else if (dmState.myStatus === "abandoned") {
        abandonedMsg.classList.remove("hidden");
      } else {
        guesserPanel.classList.remove("hidden");
        var guessInput = document.getElementById("dmGuessInput");
        var canGuessNow = dmState.currentTour > 0 && !dmState.myHasGuessedThisTour;
        guessInput.disabled = !canGuessNow;
        document.getElementById("btnDmSubmitGuess").disabled = !canGuessNow;
        // Abandonner reste toujours possible (ce n'est pas une proposition qui spam le Guide).
        document.getElementById("btnDmAbandon").disabled = false;
        if (!canGuessNow && guesserWaitMsg) {
          guesserWaitMsg.textContent =
            dmState.currentTour === 0
              ? "En attente du premier indice du Guide..."
              : "Proposition envoyée, en attente du prochain indice...";
          guesserWaitMsg.classList.remove("hidden");
        }
      }
    }

    // Indices cumulatifs
    var cluesList = document.getElementById("dmCluesList");
    var noClueMsg = document.getElementById("dmNoClueMsg");
    cluesList.innerHTML = "";
    if (dmState.clues.length === 0) {
      noClueMsg.classList.remove("hidden");
    } else {
      noClueMsg.classList.add("hidden");
      dmState.clues.forEach(function (clue) {
        var li = document.createElement("li");
        li.textContent = clue;
        cluesList.appendChild(li);
      });
    }

    // Feed des propositions en direct
    var feedList = document.getElementById("dmFeedList");
    var noFeedMsg = document.getElementById("dmNoFeedMsg");
    feedList.innerHTML = "";
    if (dmState.guessLog.length === 0) {
      noFeedMsg.classList.remove("hidden");
    } else {
      noFeedMsg.classList.add("hidden");
      dmState.guessLog
        .slice()
        .reverse()
        .forEach(function (entry) {
          var item = document.createElement("div");
          var extra = entry.correct ? " dm-feed-correct" : entry.abandoned ? " dm-feed-abandoned" : "";
          item.className = "dm-feed-item" + extra;
          var nameClass = entry.correct ? "dm-name-found" : entry.abandoned ? "dm-name-abandoned" : "dm-feed-name";
          var label = entry.correct ? "Victoire !" : entry.abandoned ? "a abandonné la manche" : "&laquo; " + entry.text + " &raquo;";
          var tourLabel = entry.tour
            ? '<span class="dm-feed-tour">indice n&deg;' + entry.tour + "</span>"
            : "";
          item.innerHTML =
            '<span class="' + nameClass + '">' + entry.name + "</span>" +
            tourLabel +
            "<span>" + label + "</span>";
          feedList.appendChild(item);
        });
    }

    // Panneau de révélation en fin de manche
    var revealPanel = document.getElementById("dmRevealPanel");
    if (dmState.roundOver) {
      revealPanel.classList.remove("hidden");
      document.getElementById("dmRevealImg").src = dmState.secret ? spriteUrl(dmState.secret.id) : "";
      document.getElementById("dmRevealName").textContent = dmState.secret ? dmState.secret.name : "-";
      var pointsEl = document.getElementById("dmRoundPoints");
      pointsEl.innerHTML = "";
      nums.forEach(function (n) {
        if (n === dmState.currentGuide) return;
        var pts = dmState.roundPoints ? dmState.roundPoints[n] : undefined;
        var box = document.createElement("div");
        box.className = "dm-round-point-box";
        box.textContent = dmPlayerName(n) + " : +" + (pts === undefined ? 0 : pts) + (pts === 1 ? " point" : " points");
        pointsEl.appendChild(box);
      });
      document.getElementById("dmWaitMsg").classList.add("hidden");
      document.getElementById("btnDmContinue").classList.remove("hidden");
      document.getElementById("btnDmContinue").disabled = false;
    } else {
      revealPanel.classList.add("hidden");
    }
  }

  function applyDmStateData(data) {
    dmState.round = data.round;
    dmState.totalRounds = data.totalRounds;
    dmState.currentGuide = data.currentGuide;
    dmState.isGuide = data.isGuide;
    dmState.secret = data.secret;
    dmState.clues = data.clues || [];
    dmState.statuses = data.statuses || {};
    dmState.guessLog = data.guessLog || [];
    dmState.totals = data.totals || {};
    dmState.roundPoints = data.roundPoints;
    dmState.roundOver = !!data.roundOver;
    dmState.myStatus = data.myStatus;
    dmState.currentTour = data.currentTour || 0;
    dmState.canSubmitClue = !!data.canSubmitClue;
    dmState.pendingGuessers = data.pendingGuessers || [];
    dmState.myHasGuessedThisTour = !!data.myHasGuessedThisTour;
    renderDmScreen();
  }

  socket.on("devinmon_state", function (data) {
    applyDmStateData(data);
    showOnly("devinmon");
  });

  document.getElementById("btnDmSubmitClue").addEventListener("click", function () {
    if (!dmState.canSubmitClue) return;
    var input = document.getElementById("dmClueInput");
    var text = input.value.trim();
    if (!text) return;
    socket.emit("devinmon_submit_clue", { code: roomCode, text: text });
    input.value = "";
  });
  document.getElementById("dmClueInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("btnDmSubmitClue").click();
  });

  document.getElementById("btnDmSubmitGuess").addEventListener("click", function () {
    if (dmState.currentTour === 0 || dmState.myHasGuessedThisTour) return;
    var input = document.getElementById("dmGuessInput");
    var text = input.value.trim();
    if (!text) return;
    socket.emit("devinmon_submit_guess", { code: roomCode, text: text });
    input.value = "";
  });
  document.getElementById("dmGuessInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("btnDmSubmitGuess").click();
  });
  document.getElementById("btnDmAbandon").addEventListener("click", function () {
    socket.emit("devinmon_abandon", { code: roomCode });
  });

  document.getElementById("btnDmContinue").addEventListener("click", function () {
    document.getElementById("btnDmContinue").disabled = true;
    socket.emit("devinmon_continue", { code: roomCode });
  });

  socket.on("devinmon_continue_status", function (data) {
    if (!data.continueReady[myPlayerNum]) return;
    var waitMsg = document.getElementById("dmWaitMsg");
    waitMsg.classList.remove("hidden");
    waitMsg.textContent = "En attente que les autres joueurs cliquent sur Manche suivante...";
    document.getElementById("btnDmContinue").classList.add("hidden");
  });

  socket.on("devinmon_game_over", function (data) {
    roomPlayersCache = data.players;
    var nums = Object.keys(data.totals).map(Number);
    nums.sort(function (a, b) {
      return (data.totals[a] || 0) - (data.totals[b] || 0);
    });
    var lowestScore = nums.length ? data.totals[nums[0]] : 0;
    var winners = nums.filter(function (n) {
      return data.totals[n] === lowestScore;
    });
    var title;
    if (winners.length > 1) {
      title = "ÉGALITÉ !";
    } else if (winners[0] === myPlayerNum) {
      title = "TU AS GAGNÉ !";
    } else {
      title = dmPlayerName(winners[0]) + " GAGNE !";
    }
    document.getElementById("dmVictoryTitle").textContent = title;

    var scoresEl = document.getElementById("dmFinalScores");
    scoresEl.innerHTML = "";
    nums.forEach(function (n, idx) {
      var row = document.createElement("div");
      row.className = "dm-final-score-row" + (data.totals[n] === lowestScore ? " dm-final-winner" : "");
      row.innerHTML =
        '<span class="dm-final-rank">#' + (idx + 1) + "</span>" +
        '<span class="dm-final-name">' + dmPlayerName(n) + (n === myPlayerNum ? " (toi)" : "") + "</span>" +
        '<span class="dm-final-total">' + (data.totals[n] || 0) + "</span>";
      scoresEl.appendChild(row);
    });

    document.getElementById("btnDmReplay").disabled = false;
    document.getElementById("dmReplayStatus").textContent = "En attente de tous les joueurs...";
    showOnly("devinmonVictory");
  });

  document.getElementById("btnDmReplay").addEventListener("click", function () {
    document.getElementById("btnDmReplay").disabled = true;
    socket.emit("replay_vote", { code: roomCode });
  });

  // ---------- Reconnexion / resynchronisation ----------
  socket.on("resync", function (data) {
    roomMode = data.mode || "quiestce";
    roomMaxPlayers = data.maxPlayers || roomMaxPlayers;
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
    } else if (data.status === "demicercle" && data.demiCercle) {
      applyDcRoundData(data.demiCercle);
      showOnly("demicercle");
    } else if (data.status === "demicercle_over") {
      var dc = data.demiCercle || { scores: { 1: 0, 2: 0 } };
      var p1Name = roomPlayersCache && roomPlayersCache[1] ? roomPlayersCache[1].name : "Joueur 1";
      var p2Name = roomPlayersCache && roomPlayersCache[2] ? roomPlayersCache[2].name : "Joueur 2";
      document.getElementById("dcVictoryTitle").textContent = "FIN DE LA PARTIE";
      document.getElementById("dcVictoryText").textContent = "La partie est terminée.";
      document.getElementById("dcFinalScores").innerHTML =
        '<div class="dc-final-score-box"><span>' + p1Name + "</span><strong>" + (dc.scores[1] || 0) + "</strong></div>" +
        '<div class="dc-final-score-box"><span>' + p2Name + "</span><strong>" + (dc.scores[2] || 0) + "</strong></div>";
      showOnly("demicercleVictory");
    } else if (data.status === "devinmon" && data.devinmon) {
      applyDmStateData(data.devinmon);
      showOnly("devinmon");
    } else if (data.status === "devinmon_over") {
      var dm = data.devinmon || { totals: {} };
      var nums = Object.keys(dm.totals).map(Number).sort(function (a, b) {
        return (dm.totals[a] || 0) - (dm.totals[b] || 0);
      });
      document.getElementById("dmVictoryTitle").textContent = "FIN DE LA PARTIE";
      var scoresEl = document.getElementById("dmFinalScores");
      scoresEl.innerHTML = "";
      var lowest = nums.length ? dm.totals[nums[0]] : 0;
      nums.forEach(function (n, idx) {
        var row = document.createElement("div");
        row.className = "dm-final-score-row" + (dm.totals[n] === lowest ? " dm-final-winner" : "");
        row.innerHTML =
          '<span class="dm-final-rank">#' + (idx + 1) + "</span>" +
          '<span class="dm-final-name">' + dmPlayerName(n) + (n === myPlayerNum ? " (toi)" : "") + "</span>" +
          '<span class="dm-final-total">' + (dm.totals[n] || 0) + "</span>";
        scoresEl.appendChild(row);
      });
      showOnly("devinmonVictory");
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
