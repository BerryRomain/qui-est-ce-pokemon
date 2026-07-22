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

  // ---------- État local ----------
  var myPlayerNum = null;
  var roomCode = null;
  var isHost = false;
  var availableGenerations = []; // [{id,count}]
  var selectedGenerations = [1];
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

  function renderWaitingRoom(room) {
    document.getElementById("roomCodeDisplay").textContent = room.code;
    roomCode = room.code;
    if (room.generations) selectedGenerations = room.generations.slice();

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
    var guestInfo = document.getElementById("guestGenInfo");
    var startBtn = document.getElementById("btnStartGame");
    var waitMsg = document.getElementById("waitingForHostMsg");

    if (isHost) {
      hostPicker.classList.remove("hidden");
      guestInfo.classList.add("hidden");
      buildGenGrid();
      var bothHere = room.players[1] && room.players[1].connected && room.players[2] && room.players[2].connected;
      startBtn.classList.remove("hidden");
      startBtn.disabled = !bothHere;
      waitMsg.classList.add("hidden");
    } else {
      hostPicker.classList.add("hidden");
      guestInfo.classList.remove("hidden");
      guestInfo.innerHTML =
        "Générations choisies par l'hôte : " +
        room.generations
          .map(function (g) {
            return '<span class="tag">Gen ' + g + "</span>";
          })
          .join(" ");
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
      myPickedSecret = poke;
      socket.emit("pick_secret", { code: roomCode, pokemonId: poke.id });
      document.getElementById("pickGrid").querySelectorAll(".card").forEach(function (c) {
        c.classList.add("picked-locked");
      });
      document.getElementById("pickWaitMsg").classList.remove("hidden");
    };
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
      status.textContent = "Les deux joueurs sont prêts, nouvelle partie en cours...";
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
    gamePokemons = data.gamePokemons || [];
    currentPlayer = data.currentPlayer;
    guessMode = data.guessMode;
    myPickedSecret = data.mySecret || null;

    if (data.status === "picking") {
      if (myPickedSecret) {
        renderPickScreen();
        document.getElementById("pickGrid").querySelectorAll(".card").forEach(function (c) {
          c.classList.add("picked-locked");
        });
        document.getElementById("pickWaitMsg").classList.remove("hidden");
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
