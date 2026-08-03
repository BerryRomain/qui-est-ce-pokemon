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
  var roomPlayersCache = null;
  var selectedCreateMode = "quiestce";
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

  function resetLocalState() {
    myPlayerNum = null;
    roomCode = null;
    isHost = false;
    roomMode = "quiestce";
    gamePokemons = [];
    localFlipped = {};
    myPickedSecret = null;
    currentPlayer = 1;
    guessMode = false;
    resetDcState();
  }

  function resetRoundState() {
    gamePokemons = [];
    localFlipped = {};
    myPickedSecret = null;
    currentPlayer = 1;
    guessMode = false;
    resetDcState();
  }

  // ---------- Sélection du mode de jeu (écran Créer) ----------
  function setCreateMode(m) {
    selectedCreateMode = m;
    document.getElementById("modeCardQuiestce").classList.toggle("checked", m === "quiestce");
    document.getElementById("modeCardDemicercle").classList.toggle("checked", m === "demicercle");
  }
  document.getElementById("modeCardQuiestce").addEventListener("click", function () {
    setCreateMode("quiestce");
  });
  document.getElementById("modeCardDemicercle").addEventListener("click", function () {
    setCreateMode("demicercle");
  });

  // ---------- Création de lobby ----------
  document.getElementById("btnCreateSubmit").addEventListener("click", function () {
    var name = document.getElementById("createName").value.trim();
    if (!name) name = "Joueur 1";
    socket.emit("create_room", { name: name, mode: selectedCreateMode });
  });

  socket.on("room_created", function (data) {
    myPlayerNum = data.playerNum;
    roomCode = data.code;
    isHost = true;
    roomMode = data.room.mode || "quiestce";
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
    roomMode = data.room.mode || "quiestce";
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
    roomPlayersCache = room.players;
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
    var dcHintHost = document.getElementById("dcModeHintHost");
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
      } else {
        hostGridModePicker.classList.remove("hidden");
        dcHintHost.classList.add("hidden");
        buildGridModePicker();
      }
      var bothHere = room.players[1] && room.players[1].connected && room.players[2] && room.players[2].connected;
      startBtn.classList.remove("hidden");
      startBtn.disabled = !bothHere;
      startBtn.textContent = roomMode === "demicercle" ? "Démarrer le Demi-Cercle" : "Démarrer la partie";
      waitMsg.classList.add("hidden");
    } else {
      hostPicker.classList.add("hidden");
      hostGridModePicker.classList.add("hidden");
      dcHintHost.classList.add("hidden");
      guestInfo.classList.remove("hidden");
      var gridModeInfo = GRID_MODE_INFO[room.gridMode] || GRID_MODE_INFO.normal;
      var modeTag = '<span class="tag">' + (roomMode === "demicercle" ? "Mode Demi-Cercle" : "Mode Qui est-ce ?") + "</span><br>";
      guestInfo.innerHTML =
        modeTag +
        "Générations choisies par l'hôte : " +
        room.generations
          .map(function (g) {
            return '<span class="tag">Gen ' + g + "</span>";
          })
          .join(" ") +
        (roomMode === "demicercle" ? "" : '<br><span class="tag">' + gridModeInfo.label + "</span>");
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
    front.appendChild(img);
    front.appendChild(pname);

    var back = document.createElement("div");
    back.className = "card-face card-back";

    inner.appendChild(front);
    inner.appendChild(back);
    card.appendChild(inner);

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
    myDot.className = "dc-dot dc-dot-mine hidden";
    myNeedle.className = "dc-needle dc-needle-mine hidden";
    otherDot.className = "dc-dot dc-dot-other hidden";
    otherNeedle.className = "dc-needle dc-needle-other hidden";
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

  // ---------- Reconnexion / resynchronisation ----------
  socket.on("resync", function (data) {
    roomMode = data.mode || "quiestce";
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