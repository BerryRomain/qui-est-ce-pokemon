"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const GRID_SIZE = 48;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans caractères ambigus (0,O,1,I)
const ROOM_TTL_MS = 1000 * 60 * 60 * 4; // 4h d'inactivité -> nettoyage
const GRID_MODES = ["normal", "mega"];
const GAME_MODES = ["quiestce", "demicercle", "devinmon", "pictionary", "pokedextarget"];
const DEMI_CERCLE_ROUNDS = 10;
const DEVINMON_MIN_PLAYERS = 2;
const DEVINMON_MAX_PLAYERS = 6;
const PICTIONARY_MIN_PLAYERS = 2;
const PICTIONARY_MAX_PLAYERS = 6;
const POKEDEXTARGET_MIN_PLAYERS = 2;
const POKEDEXTARGET_MAX_PLAYERS = 6;
const POKEDEXTARGET_SUB_MODES = ["number", "image"];
// Points attribués selon le rang de découverte (1er à trouver, 2e, etc.)
const PICTIONARY_RANK_POINTS = [100, 80, 65, 55, 45, 35];
const PICTIONARY_MIN_POINTS = 20;
// Points bonus gagnés par le dessinateur pour chaque joueur qui trouve son dessin
const PICTIONARY_DRAWER_POINTS_PER_FINDER = 20;

// Zones de score du mode Demi-Cercle : distance max (sur une échelle 0-100)
// pour obtenir 4, 3 ou 2 points ; au-delà -> 0 point.
const DEMI_CERCLE_ZONES = [
  { max: 4, points: 4 },
  { max: 10, points: 3 },
  { max: 18, points: 2 },
];

function computeDemiCercleScore(diff) {
  for (let i = 0; i < DEMI_CERCLE_ZONES.length; i++) {
    if (diff <= DEMI_CERCLE_ZONES[i].max) return DEMI_CERCLE_ZONES[i].points;
  }
  return 0;
}

// ---------- Chargement des données Pokémon par génération ----------
const POKEMON_BY_GEN = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "pokemon_by_gen.json"), "utf8")
);
const AVAILABLE_GENERATIONS = Object.keys(POKEMON_BY_GEN)
  .map(Number)
  .sort((a, b) => a - b);

// Bornes globales du Pokédex national (toutes générations confondues), utilisées
// pour valider les propositions numériques du mode Pokédex Target - sous-mode "image".
const ALL_POKEDEX_IDS = [];
AVAILABLE_GENERATIONS.forEach((g) => {
  POKEMON_BY_GEN[String(g)].forEach((p) => ALL_POKEDEX_IDS.push(p.id));
});
const POKEDEX_MIN_ID = Math.min(...ALL_POKEDEX_IDS);
const POKEDEX_MAX_ID = Math.max(...ALL_POKEDEX_IDS);

function spriteUrl(id) {
  return (
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/" +
    id +
    ".png"
  );
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPool(generations) {
  const pool = [];
  generations.forEach((g) => {
    const list = POKEMON_BY_GEN[String(g)];
    if (list) pool.push(...list);
  });
  return pool;
}

// mode "normal" -> grille limitée à GRID_SIZE Pokémon tirés au hasard
// mode "mega"   -> grille contenant l'intégralité des Pokémon des générations choisies
function pickGrid(generations, mode) {
  const pool = buildPool(generations);
  const shuffled = shuffle(pool);
  if (mode === "mega") {
    return shuffled;
  }
  const size = Math.min(GRID_SIZE, shuffled.length);
  return shuffle(shuffled.slice(0, size));
}

function makeRoomCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function randomStartingPlayer() {
  return Math.random() < 0.5 ? 1 : 2;
}

// Normalise un nom pour comparer les propositions du mode Devin'Mon
// (insensible à la casse, aux accents et à la ponctuation/espaces).
function normalizeName(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// ---------- État des rooms en mémoire ----------
// rooms: Map<code, room>
// room = {
//   code, mode:'quiestce'|'demicercle'|'devinmon', generations:[1], gridMode:'normal'|'mega',
//   maxPlayers: 2..6, status:'lobby'|'picking'|'playing'|'victory'|'demicercle'|'demicercle_over'|'devinmon'|'devinmon_over',
//   players: { 1:{socketId,name,connected,secret,replayReady}, 2:{...}, ... jusqu'à maxPlayers },
//   gamePokemons: [{id,name}], currentPlayer:1, guessMode:false,
//   winner:null, secretFound:null,
//   demiCercle: {...} | null,
//   devinmon: {...} | null,
//   pictionary: {...} | null,
//   lastActivity: Date.now()
// }
const rooms = new Map();
const socketToRoom = new Map(); // socketId -> {code, playerNum}

function publicPlayers(room) {
  const out = {};
  for (let n = 1; n <= room.maxPlayers; n++) {
    const p = room.players[n];
    out[n] = p
      ? { name: p.name, connected: p.connected, hasPicked: !!p.secret, replayReady: !!p.replayReady }
      : null;
  }
  return out;
}

function roomSummary(room) {
  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    generations: room.generations,
    gridMode: room.gridMode,
    pdtSubMode: room.pdtSubMode || "number",
    maxPlayers: room.maxPlayers,
    players: publicPlayers(room),
  };
}

function otherPlayerNum(n) {
  return n === 1 ? 2 : 1;
}

// Retourne la liste des numéros de joueur ayant un slot occupé (connecté ou non).
function occupiedPlayerNums(room) {
  const out = [];
  for (let n = 1; n <= room.maxPlayers; n++) {
    if (room.players[n]) out.push(n);
  }
  return out;
}

// Retourne la liste des numéros de joueur actuellement connectés.
function connectedPlayerNums(room) {
  const out = [];
  for (let n = 1; n <= room.maxPlayers; n++) {
    if (room.players[n] && room.players[n].connected) out.push(n);
  }
  return out;
}

function touch(room) {
  room.lastActivity = Date.now();
}

function cleanupOldRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}
setInterval(cleanupOldRooms, 1000 * 60 * 15);

// ---------- Serveur ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// Endpoint utilitaire pour que le client sache quelles générations existent
app.get("/api/generations", (req, res) => {
  const meta = AVAILABLE_GENERATIONS.map((g) => ({
    id: g,
    count: POKEMON_BY_GEN[String(g)].length,
  }));
  res.json(meta);
});

// ---------- Fonctions Mode Demi-Cercle ----------
function startDemiCercleRound(room) {
  const dc = room.demiCercle;
  dc.round += 1;
  dc.guesser = dc.round % 2 === 1 ? 1 : 2;
  dc.master = otherPlayerNum(dc.guesser);

  const pool = buildPool(room.generations).filter((p) => dc.usedIds.indexOf(p.id) === -1);
  const shuffled = shuffle(pool.length ? pool : buildPool(room.generations));
  const poke = shuffled[0];
  dc.usedIds.push(poke.id);
  dc.pokemon = poke;
  dc.masterPosition = null;
  dc.guesserPosition = 50;
  dc.phase = "master_placing";
  dc.continueReady = { 1: false, 2: false };
  dc.lastRoundScore = null;
}

// Construit le payload adapté au rôle du joueur (masque ce qui doit rester secret)
function demiCerclePayloadFor(room, playerNum) {
  const dc = room.demiCercle;
  const role = dc.master === playerNum ? "master" : "guesser";
  const showPokemon = role === "master" || dc.phase === "guessing" || dc.phase === "revealed";
  const showMasterPosition = role === "master" || dc.phase === "revealed";
  return {
    round: dc.round,
    totalRounds: dc.totalRounds,
    master: dc.master,
    guesser: dc.guesser,
    role: role,
    phase: dc.phase,
    scores: dc.scores,
    pokemon: showPokemon ? dc.pokemon : null,
    masterPosition: showMasterPosition ? dc.masterPosition : null,
    guesserPosition: dc.guesserPosition,
    lastRoundScore: dc.lastRoundScore,
  };
}

function emitDemiCercleRoundToRoom(room) {
  [1, 2].forEach((n) => {
    const p = room.players[n];
    if (p && p.socketId) {
      io.to(p.socketId).emit("demicercle_round_start", demiCerclePayloadFor(room, n));
    }
  });
}

// ---------- Fonctions Mode Devin'Mon ----------

// Construit l'ordre des Guides : chaque joueur guide exactement 2 fois,
// en évitant autant que possible deux tours consécutifs pour le même joueur.
function buildDevinmonGuideOrder(playerNums) {
  const pool = [];
  playerNums.forEach((n) => {
    pool.push(n);
    pool.push(n);
  });
  let order = shuffle(pool);
  let attempts = 0;
  function hasConsecutiveDuplicate(arr) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1]) return true;
    }
    return false;
  }
  while (attempts < 200 && hasConsecutiveDuplicate(order) && playerNums.length > 1) {
    order = shuffle(pool);
    attempts++;
  }
  return order;
}

function startDevinmonRound(room) {
  const dc = room.devinmon;
  dc.round += 1;
  dc.currentGuide = dc.guideOrder[dc.round - 1];

  const pool = buildPool(room.generations).filter((p) => dc.usedIds.indexOf(p.id) === -1);
  const source = pool.length ? pool : buildPool(room.generations);
  const poke = shuffle(source)[0];
  dc.usedIds.push(poke.id);
  dc.secret = poke;
  dc.clues = [];
  dc.guessLog = [];
  dc.statuses = {};
  dc.roundPoints = {};
  // currentTour = nombre d'indices donnés jusqu'ici (0 = aucun indice encore,
  // les devineurs doivent attendre le premier indice du Guide avant de pouvoir jouer).
  dc.currentTour = 0;
  dc.lastGuessTour = {};
  dc.participants.forEach((n) => {
    dc.statuses[n] = n === dc.currentGuide ? "guiding" : "guessing";
    dc.lastGuessTour[n] = 0;
  });
  dc.continueReady = {};
  dc.roundOver = false;
}

// Retourne les numéros de joueurs encore en train de deviner qui n'ont pas
// encore proposé de Pokémon pour le tour d'indice en cours.
function devinmonPendingGuessers(room) {
  const dc = room.devinmon;
  return dc.participants.filter(
    (n) => dc.statuses[n] === "guessing" && dc.lastGuessTour[n] !== dc.currentTour
  );
}

function devinmonPayloadFor(room, playerNum) {
  const dc = room.devinmon;
  const isGuide = dc.currentGuide === playerNum;
  const pendingGuessers = devinmonPendingGuessers(room).map((n) =>
    room.players[n] ? room.players[n].name : "Joueur " + n
  );
  const tourComplete = pendingGuessers.length === 0;
  const guessLog = isGuide || dc.roundOver || tourComplete
    ? dc.guessLog
    : dc.guessLog.filter((entry) => entry.tour < dc.currentTour);
  return {
    round: dc.round,
    totalRounds: dc.totalRounds,
    currentGuide: dc.currentGuide,
    isGuide: isGuide,
    secret: isGuide || dc.roundOver ? dc.secret : null,
    clues: dc.clues,
    statuses: dc.statuses,
    guessLog: guessLog,
    guessLogHidden: !isGuide && !dc.roundOver && !tourComplete,
    totals: dc.totals,
    roundPoints: dc.roundOver ? dc.roundPoints : null,
    roundOver: dc.roundOver,
    myStatus: dc.statuses[playerNum] || null,
    currentTour: dc.currentTour,
    canSubmitClue: !dc.roundOver && isGuide && pendingGuessers.length === 0,
    pendingGuessers: pendingGuessers,
    myHasGuessedThisTour: dc.lastGuessTour[playerNum] === dc.currentTour,
  };
}

function emitDevinmonStateToRoom(room) {
  const dc = room.devinmon;
  dc.participants.forEach((n) => {
    const p = room.players[n];
    if (p && p.socketId) {
      io.to(p.socketId).emit("devinmon_state", devinmonPayloadFor(room, n));
    }
  });
}

// Vérifie si la manche est terminée (tous les Devineurs ont trouvé ou abandonné)
// et attribue le malus final aux joueurs ayant abandonné le cas échéant.
function checkDevinmonRoundEnd(room) {
  const dc = room.devinmon;
  const allResolved = dc.participants.every((n) => {
    if (n === dc.currentGuide) return true;
    return dc.statuses[n] === "found" || dc.statuses[n] === "abandoned";
  });
  if (!allResolved) return;

  dc.participants.forEach((n) => {
    if (n === dc.currentGuide) return;
    if (dc.statuses[n] === "abandoned" && dc.roundPoints[n] === undefined) {
      const pts = Math.max(1, dc.clues.length);
      dc.roundPoints[n] = pts;
      dc.totals[n] = (dc.totals[n] || 0) + pts;
    }
  });
  dc.roundOver = true;
}

// ---------- Fonctions Mode Dessine-moi un Pokémon (Pictionary) ----------

// Construit l'ordre des Dessinateurs : chaque joueur dessine exactement 2
// fois, en évitant autant que possible deux tours consécutifs pour le même
// joueur. Réutilise le même principe que le mode Devin'Mon.
function buildPictionaryDrawOrder(playerNums) {
  return buildDevinmonGuideOrder(playerNums);
}

function startPictionaryRound(room) {
  const pc = room.pictionary;
  pc.round += 1;
  pc.currentDrawer = pc.drawOrder[pc.round - 1];

  const pool = buildPool(room.generations).filter((p) => pc.usedIds.indexOf(p.id) === -1);
  const source = pool.length ? pool : buildPool(room.generations);
  const poke = shuffle(source)[0];
  pc.usedIds.push(poke.id);
  pc.secret = poke;
  pc.actions = [];
  pc.foundOrder = [];
  pc.statuses = {};
  pc.roundPoints = {};
  pc.chat = [];
  pc.participants.forEach((n) => {
    pc.statuses[n] = n === pc.currentDrawer ? "drawing" : "guessing";
  });
  pc.continueReady = {};
  pc.roundOver = false;
}

function pictionaryPayloadFor(room, playerNum) {
  const pc = room.pictionary;
  const isDrawer = pc.currentDrawer === playerNum;
  const guessersCount = pc.participants.length - 1;
  return {
    round: pc.round,
    totalRounds: pc.totalRounds,
    currentDrawer: pc.currentDrawer,
    isDrawer: isDrawer,
    secret: isDrawer || pc.roundOver ? pc.secret : null,
    actions: pc.actions,
    statuses: pc.statuses,
    totals: pc.totals,
    roundPoints: pc.roundOver ? pc.roundPoints : null,
    roundOver: pc.roundOver,
    myStatus: pc.statuses[playerNum] || null,
    chat: pc.chat,
    foundCount: pc.foundOrder.length,
    guessersCount: guessersCount,
  };
}

function emitPictionaryStateToRoom(room) {
  const pc = room.pictionary;
  pc.participants.forEach((n) => {
    const p = room.players[n];
    if (p && p.socketId) {
      io.to(p.socketId).emit("pictionary_state", pictionaryPayloadFor(room, n));
    }
  });
}

// Vérifie si tous les Devineurs ont trouvé le Pokémon secret ; si oui,
// attribue les points bonus au Dessinateur et clôture la manche.
function checkPictionaryRoundEnd(room) {
  const pc = room.pictionary;
  const guessers = pc.participants.filter((n) => n !== pc.currentDrawer);
  const allFound = guessers.every((n) => pc.statuses[n] === "found");
  if (!allFound) return;

  const bonus = guessers.length * PICTIONARY_DRAWER_POINTS_PER_FINDER;
  pc.roundPoints[pc.currentDrawer] = bonus;
  pc.totals[pc.currentDrawer] = (pc.totals[pc.currentDrawer] || 0) + bonus;
  pc.roundOver = true;
  pc.chat.push({
    type: "system",
    text: "Tout le monde a trouvé ! Le Pokémon secret était " + pc.secret.name + ".",
  });
}

// ---------- Fonctions Mode Pokédex Target ----------

function startPdtRound(room) {
  const dc = room.pokedextarget;
  dc.round += 1;

  const pool = buildPool(room.generations).filter((p) => dc.usedIds.indexOf(p.id) === -1);
  const source = pool.length ? pool : buildPool(room.generations);
  const poke = shuffle(source)[0];
  dc.usedIds.push(poke.id);
  dc.secret = poke;
  dc.answers = {};
  dc.submitted = {};
  dc.participants.forEach((n) => (dc.submitted[n] = false));
  dc.continueReady = {};
  dc.roundOver = false;
}

// Construit le payload envoyé à un joueur donné : la cible (numéro ou image+nom)
// est identique pour tous les joueurs, mais l'état de soumission est individuel.
// Les réponses des autres joueurs ne sont jamais envoyées avant que tout le
// monde ait soumis, pour éviter qu'un joueur ne déduise le numéro secret via
// la proposition (et l'écart) d'un autre joueur avant d'avoir répondu lui-même.
function pdtPayloadFor(room, playerNum) {
  const dc = room.pokedextarget;
  const submittedCount = dc.participants.filter((n) => dc.submitted[n]).length;
  const payload = {
    round: dc.round,
    totalRounds: dc.totalRounds,
    subMode: dc.subMode,
    totals: dc.totals,
    roundOver: dc.roundOver,
    mySubmitted: !!dc.submitted[playerNum],
    submittedCount: submittedCount,
    participantsCount: dc.participants.length,
    maxDexNumber: POKEDEX_MAX_ID,
    minDexNumber: POKEDEX_MIN_ID,
    pool: dc.subMode === "number" ? dc.pool : null,
    target: null,
    results: null,
  };
  if (!dc.roundOver) {
    payload.target =
      dc.subMode === "number"
        ? { number: dc.secret.id }
        : { pokemon: { id: dc.secret.id, name: dc.secret.name } };
  } else {
    payload.results = {
      secret: { id: dc.secret.id, name: dc.secret.name },
      answers: dc.participants.map((n) => {
        const a = dc.answers[n] || null;
        return {
          playerNum: n,
          name: room.players[n] ? room.players[n].name : "Joueur " + n,
          guessPokemon: a && a.guessPokemon ? a.guessPokemon : null,
          guessNumber: a ? a.guessNumber : null,
          diff: a ? a.diff : null,
          points: a ? a.points : null,
        };
      }),
    };
  }
  return payload;
}

function emitPdtStateToRoom(room) {
  const dc = room.pokedextarget;
  dc.participants.forEach((n) => {
    const p = room.players[n];
    if (p && p.socketId) {
      io.to(p.socketId).emit("pokedextarget_state", pdtPayloadFor(room, n));
    }
  });
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name, mode, maxPlayers }) => {
    const code = makeRoomCode();
    const cleanMode = GAME_MODES.indexOf(mode) !== -1 ? mode : "quiestce";
    let cap = 2;
    if (cleanMode === "devinmon") {
      cap = Math.round(Number(maxPlayers)) || 2;
      cap = Math.max(DEVINMON_MIN_PLAYERS, Math.min(DEVINMON_MAX_PLAYERS, cap));
    } else if (cleanMode === "pictionary") {
      cap = Math.round(Number(maxPlayers)) || 2;
      cap = Math.max(PICTIONARY_MIN_PLAYERS, Math.min(PICTIONARY_MAX_PLAYERS, cap));
    } else if (cleanMode === "pokedextarget") {
      cap = Math.round(Number(maxPlayers)) || 2;
      cap = Math.max(POKEDEXTARGET_MIN_PLAYERS, Math.min(POKEDEXTARGET_MAX_PLAYERS, cap));
    }
    const room = {
      code,
      mode: cleanMode,
      generations: [1],
      gridMode: "normal",
      pdtSubMode: "number",
      maxPlayers: cap,
      status: "lobby",
      players: {
        1: { socketId: socket.id, name: (name || "Joueur 1").slice(0, 16), connected: true, secret: null, replayReady: false },
      },
      gamePokemons: [],
      currentPlayer: 1,
      guessMode: false,
      winner: null,
      secretFound: null,
      demiCercle: null,
      devinmon: null,
      pictionary: null,
      pokedextarget: null,
      lastActivity: Date.now(),
    };
    for (let n = 2; n <= cap; n++) room.players[n] = null;
    rooms.set(code, room);
    socket.join(code);
    socketToRoom.set(socket.id, { code, playerNum: 1 });
    socket.emit("room_created", { code, playerNum: 1, room: roomSummary(room) });
  });

  socket.on("join_room", ({ code, name }) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("error_message", { message: "Ce code de lobby n'existe pas." });
      return;
    }
    let playerNum = null;
    for (let n = 2; n <= room.maxPlayers; n++) {
      if (!room.players[n] || room.players[n].connected === false) {
        playerNum = n;
        break;
      }
    }
    if (playerNum === null) {
      if (room.players[1] && !room.players[1].connected) {
        playerNum = 1;
      } else {
        socket.emit("error_message", { message: "Ce lobby est déjà complet." });
        return;
      }
    }

    room.players[playerNum] = {
      socketId: socket.id,
      name: (name || "Joueur " + playerNum).slice(0, 16),
      connected: true,
      secret: room.players[playerNum] ? room.players[playerNum].secret : null,
      replayReady: false,
    };
    touch(room);
    socket.join(code);
    socketToRoom.set(socket.id, { code, playerNum });

    socket.emit("room_joined", { code, playerNum, room: roomSummary(room) });
    io.to(code).emit("players_update", roomSummary(room));

    // Si une partie était déjà en cours et qu'un joueur revient, on le remet à niveau
    if (
      room.status === "picking" ||
      room.status === "playing" ||
      room.status === "victory" ||
      room.status === "demicercle" ||
      room.status === "demicercle_over" ||
      room.status === "devinmon" ||
      room.status === "devinmon_over" ||
      room.status === "pictionary" ||
      room.status === "pictionary_over" ||
      room.status === "pokedextarget" ||
      room.status === "pokedextarget_over"
    ) {
      socket.emit("resync", buildResyncPayload(room, playerNum));
    }
  });

  socket.on("set_pdt_submode", ({ code, subMode }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || info.playerNum !== 1) return; // seul l'hôte choisit
    if (POKEDEXTARGET_SUB_MODES.indexOf(subMode) === -1) return;
    room.pdtSubMode = subMode;
    touch(room);
    io.to(code).emit("players_update", roomSummary(room));
  });

  socket.on("set_generations", ({ code, generations }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || info.playerNum !== 1) return; // seul l'hôte choisit
    const clean = (generations || [])
      .map(Number)
      .filter((g) => AVAILABLE_GENERATIONS.includes(g));
    if (clean.length === 0) return;
    room.generations = clean;
    touch(room);
    io.to(code).emit("players_update", roomSummary(room));
  });

  socket.on("set_grid_mode", ({ code, gridMode }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || info.playerNum !== 1) return; // seul l'hôte choisit
    if (!GRID_MODES.includes(gridMode)) return;
    room.gridMode = gridMode;
    touch(room);
    io.to(code).emit("players_update", roomSummary(room));
  });

  socket.on("start_game", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || info.playerNum !== 1) return;

    const connected = connectedPlayerNums(room);
    if (connected.length < 2) {
      socket.emit("error_message", { message: "Il faut au moins deux joueurs pour commencer." });
      return;
    }

    // ---- Branche Mode Devin'Mon ----
    if (room.mode === "devinmon") {
      const pool = buildPool(room.generations);
      const totalRounds = connected.length * 2;
      if (pool.length < totalRounds) {
        socket.emit("error_message", {
          message: "Sélectionne plus de générations (au moins " + totalRounds + " Pokémon nécessaires).",
        });
        return;
      }
      room.status = "devinmon";
      occupiedPlayerNums(room).forEach((n) => (room.players[n].replayReady = false));
      room.devinmon = {
        totalRounds: totalRounds,
        round: 0,
        participants: connected.slice(),
        guideOrder: buildDevinmonGuideOrder(connected),
        currentGuide: null,
        secret: null,
        clues: [],
        statuses: {},
        guessLog: [],
        roundPoints: {},
        totals: {},
        continueReady: {},
        usedIds: [],
        roundOver: false,
      };
      connected.forEach((n) => (room.devinmon.totals[n] = 0));
      startDevinmonRound(room);
      touch(room);
      emitDevinmonStateToRoom(room);
      return;
    }

    // ---- Branche Mode Dessine-moi un Pokémon (Pictionary) ----
    if (room.mode === "pictionary") {
      const pool = buildPool(room.generations);
      const totalRounds = connected.length * 2;
      if (pool.length < totalRounds) {
        socket.emit("error_message", {
          message: "Sélectionne plus de générations (au moins " + totalRounds + " Pokémon nécessaires).",
        });
        return;
      }
      room.status = "pictionary";
      occupiedPlayerNums(room).forEach((n) => (room.players[n].replayReady = false));
      room.pictionary = {
        totalRounds: totalRounds,
        round: 0,
        participants: connected.slice(),
        drawOrder: buildPictionaryDrawOrder(connected),
        currentDrawer: null,
        secret: null,
        actions: [],
        foundOrder: [],
        statuses: {},
        roundPoints: {},
        totals: {},
        chat: [],
        continueReady: {},
        usedIds: [],
        roundOver: false,
      };
      connected.forEach((n) => (room.pictionary.totals[n] = 0));
      startPictionaryRound(room);
      touch(room);
      emitPictionaryStateToRoom(room);
      return;
    }

    // ---- Branche Mode Pokédex Target ----
    if (room.mode === "pokedextarget") {
      const pool = buildPool(room.generations);
      const totalRounds = connected.length * 2;
      if (pool.length < totalRounds) {
        socket.emit("error_message", {
          message: "Sélectionne plus de générations (au moins " + totalRounds + " Pokémon nécessaires).",
        });
        return;
      }
      room.status = "pokedextarget";
      occupiedPlayerNums(room).forEach((n) => (room.players[n].replayReady = false));
      room.pokedextarget = {
        totalRounds: totalRounds,
        round: 0,
        participants: connected.slice(),
        subMode: room.pdtSubMode === "image" ? "image" : "number",
        pool: shuffle(pool).sort((a, b) => a.name.localeCompare(b.name, "fr")),
        secret: null,
        answers: {},
        submitted: {},
        totals: {},
        continueReady: {},
        usedIds: [],
        roundOver: false,
      };
      connected.forEach((n) => (room.pokedextarget.totals[n] = 0));
      startPdtRound(room);
      touch(room);
      emitPdtStateToRoom(room);
      return;
    }

    if (!room.players[1] || !room.players[2]) {
      socket.emit("error_message", { message: "Il faut deux joueurs pour commencer." });
      return;
    }

    // ---- Branche Mode Demi-Cercle ----
    if (room.mode === "demicercle") {
      const pool = buildPool(room.generations);
      if (pool.length < DEMI_CERCLE_ROUNDS) {
        socket.emit("error_message", {
          message: "Sélectionne plus de générations (au moins " + DEMI_CERCLE_ROUNDS + " Pokémon nécessaires).",
        });
        return;
      }
      room.status = "demicercle";
      room.players[1].replayReady = false;
      room.players[2].replayReady = false;
      room.demiCercle = {
        round: 0,
        totalRounds: DEMI_CERCLE_ROUNDS,
        guesser: null,
        master: null,
        pokemon: null,
        masterPosition: null,
        guesserPosition: 50,
        phase: null,
        scores: { 1: 0, 2: 0 },
        continueReady: { 1: false, 2: false },
        usedIds: [],
        lastRoundScore: null,
      };
      startDemiCercleRound(room);
      touch(room);
      emitDemiCercleRoundToRoom(room);
      return;
    }

    // ---- Branche Mode Qui est-ce ? (existant) ----
    const grid = pickGrid(room.generations, room.gridMode);
    if (grid.length < 4) {
      socket.emit("error_message", { message: "Pas assez de Pokémon dans les générations choisies." });
      return;
    }
    room.gamePokemons = grid;
    room.players[1].secret = null;
    room.players[2].secret = null;
    room.players[1].flipped = {};
    room.players[2].flipped = {};
    room.players[1].replayReady = false;
    room.players[2].replayReady = false;
    room.status = "picking";
    room.currentPlayer = randomStartingPlayer();
    room.guessMode = false;
    room.winner = null;
    room.secretFound = null;
    touch(room);
    io.to(code).emit("game_started", {
      gamePokemons: room.gamePokemons,
      players: publicPlayers(room),
    });
  });

  socket.on("pick_secret", ({ code, pokemonId }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "picking") return;
    const poke = room.gamePokemons.find((p) => p.id === pokemonId);
    if (!poke) return;
    room.players[info.playerNum].secret = poke;
    touch(room);

    io.to(code).emit("players_update", roomSummary(room));

    const p1 = room.players[1],
      p2 = room.players[2];
    if (p1 && p2 && p1.secret && p2.secret) {
      room.status = "playing";
      room.guessMode = false;
      io.to(code).emit("game_ready", buildGameStatePayload(room));
    }
  });

  // ---------- Synchronisation en direct de la grille personnelle ----------
  // Chaque joueur retourne ses propres cartes en local (mémo perso, ça ne
  // révèle jamais le secret). On répercute juste l'état "case retournée ou
  // pas" au socket de l'adversaire pour qu'il puisse le consulter en mode
  // spectateur strictement passif (lecture seule, aucune action possible).
  socket.on("flip_card", ({ code, pokemonId, flipped }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "playing") return;
    const me = room.players[info.playerNum];
    if (!me) return;
    if (!me.flipped) me.flipped = {};
    if (flipped) me.flipped[pokemonId] = true;
    else delete me.flipped[pokemonId];
    touch(room);
    const opponent = room.players[otherPlayerNum(info.playerNum)];
    if (opponent && opponent.socketId) {
      io.to(opponent.socketId).emit("opponent_flip_update", {
        pokemonId: pokemonId,
        flipped: !!flipped,
      });
    }
  });

  socket.on("toggle_guess_mode", ({ code, guessMode }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "playing") return;
    if (room.currentPlayer !== info.playerNum) return;
    room.guessMode = !!guessMode;
    touch(room);
    io.to(code).emit("turn_update", { currentPlayer: room.currentPlayer, guessMode: room.guessMode });
  });

  socket.on("pass_turn", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "playing") return;
    if (room.currentPlayer !== info.playerNum) return;
    room.currentPlayer = otherPlayerNum(room.currentPlayer);
    room.guessMode = false;
    touch(room);
    io.to(code).emit("turn_update", { currentPlayer: room.currentPlayer, guessMode: room.guessMode });
  });

  socket.on("guess", ({ code, pokemonId }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "playing") return;
    if (room.currentPlayer !== info.playerNum) return;

    const guesser = info.playerNum;
    const opponent = otherPlayerNum(guesser);
    const target = room.players[opponent].secret;
    const poke = room.gamePokemons.find((p) => p.id === pokemonId);
    if (!poke || !target) return;

    room.guessMode = false;
    touch(room);

    if (target.id === poke.id) {
      room.status = "victory";
      room.winner = guesser;
      room.secretFound = target;
      room.players[1].replayReady = false;
      room.players[2].replayReady = false;
      io.to(code).emit("victory", {
        winner: guesser,
        winnerName: room.players[guesser].name,
        secretFound: target,
      });
    } else {
      io.to(code).emit("wrong_guess", { pokemonId: poke.id, name: poke.name, by: guesser });
      room.currentPlayer = otherPlayerNum(guesser);
      room.guessMode = false;
      io.to(code).emit("turn_update", { currentPlayer: room.currentPlayer, guessMode: room.guessMode });
    }
  });

  // ---------- Mode Demi-Cercle : le Maître fixe sa position secrète ----------
  socket.on("demicercle_master_submit", ({ code, position }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "demicercle") return;
    const dc = room.demiCercle;
    if (!dc || dc.phase !== "master_placing" || dc.master !== info.playerNum) return;
    const pos = Number(position);
    if (isNaN(pos)) return;
    dc.masterPosition = Math.max(0, Math.min(100, pos));
    dc.phase = "guessing";
    dc.guesserPosition = 50;
    touch(room);
    emitDemiCercleRoundToRoom(room);
  });

  // ---------- Mode Demi-Cercle : le Devineur déplace sa barre en direct ----------
  socket.on("demicercle_guesser_move", ({ code, position }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "demicercle") return;
    const dc = room.demiCercle;
    if (!dc || dc.phase !== "guessing" || dc.guesser !== info.playerNum) return;
    const pos = Number(position);
    if (isNaN(pos)) return;
    dc.guesserPosition = Math.max(0, Math.min(100, pos));
    touch(room);
    const masterEntry = room.players[dc.master];
    if (masterEntry && masterEntry.socketId) {
      io.to(masterEntry.socketId).emit("demicercle_guesser_move_update", { position: dc.guesserPosition });
    }
  });

  // ---------- Mode Demi-Cercle : le Devineur valide sa réponse finale ----------
  socket.on("demicercle_guesser_submit", ({ code, position }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "demicercle") return;
    const dc = room.demiCercle;
    if (!dc || dc.phase !== "guessing" || dc.guesser !== info.playerNum) return;
    const pos = Number(position);
    if (isNaN(pos)) return;
    dc.guesserPosition = Math.max(0, Math.min(100, pos));
    const diff = Math.abs(dc.masterPosition - dc.guesserPosition);
    const points = computeDemiCercleScore(diff);
    dc.scores[dc.guesser] += points;
    dc.lastRoundScore = points;
    dc.phase = "revealed";
    dc.continueReady = { 1: false, 2: false };
    touch(room);
    emitDemiCercleRoundToRoom(room);
  });

  // ---------- Mode Demi-Cercle : passage au round suivant ----------
  socket.on("demicercle_continue", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "demicercle") return;
    const dc = room.demiCercle;
    if (!dc || dc.phase !== "revealed") return;
    dc.continueReady[info.playerNum] = true;
    touch(room);

    if (dc.continueReady[1] && dc.continueReady[2]) {
      if (dc.round >= dc.totalRounds) {
        room.status = "demicercle_over";
        let winner = null;
        if (dc.scores[1] > dc.scores[2]) winner = 1;
        else if (dc.scores[2] > dc.scores[1]) winner = 2;
        io.to(code).emit("demicercle_game_over", {
          scores: dc.scores,
          winner: winner,
          winnerName: winner ? room.players[winner].name : null,
        });
      } else {
        startDemiCercleRound(room);
        emitDemiCercleRoundToRoom(room);
      }
    } else {
      io.to(code).emit("demicercle_continue_status", { continueReady: dc.continueReady });
    }
  });

  // ---------- Mode Devin'Mon : le Guide ajoute un indice ----------
  socket.on("devinmon_submit_clue", ({ code, text }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "devinmon") return;
    const dc = room.devinmon;
    if (!dc || dc.roundOver || dc.currentGuide !== info.playerNum) return;
    if (devinmonPendingGuessers(room).length > 0) return; // il manque des propositions pour ce tour
    const clean = (text || "").toString().trim().slice(0, 140);
    if (!clean) return;
    dc.clues.push(clean);
    dc.currentTour += 1; // ouvre un nouveau tour de propositions
    touch(room);
    emitDevinmonStateToRoom(room);
  });

  // ---------- Mode Devin'Mon : un Devineur propose une réponse ----------
  socket.on("devinmon_submit_guess", ({ code, text }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "devinmon") return;
    const dc = room.devinmon;
    if (!dc || dc.roundOver) return;
    const playerNum = info.playerNum;
    if (dc.statuses[playerNum] !== "guessing") return;
    if (dc.currentTour === 0) return; // le Guide n'a encore rien envoyé, on bloque les propositions
    if (dc.lastGuessTour[playerNum] === dc.currentTour) return; // déjà proposé pour ce tour
    const clean = (text || "").toString().trim();
    if (!clean || !dc.secret) return;

    const tour = dc.currentTour;
    dc.lastGuessTour[playerNum] = tour;

    const correct = normalizeName(clean) === normalizeName(dc.secret.name);
    const playerName = room.players[playerNum] ? room.players[playerNum].name : "Joueur";

    if (correct) {
      dc.statuses[playerNum] = "found";
      const pts = Math.max(1, dc.clues.length);
      dc.roundPoints[playerNum] = pts;
      dc.totals[playerNum] = (dc.totals[playerNum] || 0) + pts;
      dc.guessLog.push({ playerNum, name: playerName, text: null, correct: true, tour });
    } else {
      dc.guessLog.push({ playerNum, name: playerName, text: clean, correct: false, tour });
    }
    touch(room);
    checkDevinmonRoundEnd(room);
    emitDevinmonStateToRoom(room);
  });

  // ---------- Mode Devin'Mon : un Devineur abandonne la manche ----------
  socket.on("devinmon_abandon", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "devinmon") return;
    const dc = room.devinmon;
    if (!dc || dc.roundOver) return;
    const playerNum = info.playerNum;
    if (dc.statuses[playerNum] !== "guessing") return;
    dc.statuses[playerNum] = "abandoned";
    const playerName = room.players[playerNum] ? room.players[playerNum].name : "Joueur";
    dc.guessLog.push({ playerNum, name: playerName, text: null, correct: false, abandoned: true, tour: dc.currentTour });
    touch(room);
    checkDevinmonRoundEnd(room);
    emitDevinmonStateToRoom(room);
  });

  // ---------- Mode Devin'Mon : passage à la manche suivante ----------
  socket.on("devinmon_continue", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "devinmon") return;
    const dc = room.devinmon;
    if (!dc || !dc.roundOver) return;
    dc.continueReady[info.playerNum] = true;
    touch(room);

    const allReady = dc.participants.every((n) => dc.continueReady[n]);
    if (allReady) {
      if (dc.round >= dc.totalRounds) {
        room.status = "devinmon_over";
        io.to(code).emit("devinmon_game_over", { totals: dc.totals, players: publicPlayers(room) });
      } else {
        startDevinmonRound(room);
        emitDevinmonStateToRoom(room);
      }
    } else {
      io.to(code).emit("devinmon_continue_status", { continueReady: dc.continueReady });
    }
  });

  // =====================================================================
  // ==================== MODE POKÉDEX TARGET ============================
  // =====================================================================

  // ---------- Un joueur envoie sa proposition pour la manche en cours ----------
  socket.on("pokedextarget_submit_guess", ({ code, guessPokemonId, guessNumber }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pokedextarget") return;
    const dc = room.pokedextarget;
    if (!dc || dc.roundOver) return;
    const playerNum = info.playerNum;
    if (dc.participants.indexOf(playerNum) === -1) return;
    if (dc.submitted[playerNum]) return;

    let entry = null;
    if (dc.subMode === "number") {
      const pid = Number(guessPokemonId);
      const candidate = dc.pool.find((p) => p.id === pid);
      if (!candidate) return;
      const diff = Math.abs(candidate.id - dc.secret.id);
      entry = { guessPokemon: { id: candidate.id, name: candidate.name }, guessNumber: null, diff: diff, points: diff };
    } else {
      let num = Math.round(Number(guessNumber));
      if (isNaN(num)) return;
      num = Math.max(POKEDEX_MIN_ID, Math.min(POKEDEX_MAX_ID, num));
      const diff = Math.abs(num - dc.secret.id);
      entry = { guessPokemon: null, guessNumber: num, diff: diff, points: diff };
    }

    dc.answers[playerNum] = entry;
    dc.submitted[playerNum] = true;
    touch(room);

    const allSubmitted = dc.participants.every((n) => dc.submitted[n]);
    if (allSubmitted) {
      dc.participants.forEach((n) => {
        const a = dc.answers[n];
        dc.totals[n] = (dc.totals[n] || 0) + (a ? a.points : 0);
      });
      dc.roundOver = true;
    }
    emitPdtStateToRoom(room);
  });

  // ---------- Passage à la manche suivante (vote unanime) ----------
  socket.on("pokedextarget_continue", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pokedextarget") return;
    const dc = room.pokedextarget;
    if (!dc || !dc.roundOver) return;
    dc.continueReady[info.playerNum] = true;
    touch(room);

    const allReady = dc.participants.every((n) => dc.continueReady[n]);
    if (allReady) {
      if (dc.round >= dc.totalRounds) {
        room.status = "pokedextarget_over";
        io.to(code).emit("pokedextarget_game_over", { totals: dc.totals, players: publicPlayers(room) });
      } else {
        startPdtRound(room);
        emitPdtStateToRoom(room);
      }
    } else {
      io.to(code).emit("pokedextarget_continue_status", { continueReady: dc.continueReady });
    }
  });

  // =====================================================================
  // ============ MODE DESSINE-MOI UN POKÉMON (Pictionary) ==============
  // =====================================================================

  // ---------- Point de tracé en direct (uniquement pour affichage fluide
  // chez les autres joueurs ; n'est jamais stocké côté serveur) ----------
  socket.on("pictionary_live_point", ({ code, x, y, color, size, newStroke }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pictionary") return;
    const pc = room.pictionary;
    if (!pc || pc.roundOver || pc.currentDrawer !== info.playerNum) return;
    if (typeof x !== "number" || typeof y !== "number") return;
    touch(room);
    socket.to(code).emit("pictionary_live_point", {
      x: x,
      y: y,
      color: color,
      size: size,
      newStroke: !!newStroke,
    });
  });

  // ---------- Fin d'un trait de crayon : on le stocke pour la resync ----------
  socket.on("pictionary_stroke_end", ({ code, stroke }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pictionary") return;
    const pc = room.pictionary;
    if (!pc || pc.roundOver || pc.currentDrawer !== info.playerNum) return;
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) return;
    const clean = {
      type: "stroke",
      color: (stroke.color || "#000000").toString().slice(0, 16),
      size: Math.max(1, Math.min(60, Number(stroke.size) || 6)),
      points: stroke.points
        .filter((pt) => Array.isArray(pt) && pt.length === 2)
        .map((pt) => [Number(pt[0]) || 0, Number(pt[1]) || 0])
        .slice(0, 3000),
    };
    pc.actions.push(clean);
    touch(room);
  });

  // ---------- Seau de remplissage ----------
  socket.on("pictionary_fill", ({ code, x, y, color }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pictionary") return;
    const pc = room.pictionary;
    if (!pc || pc.roundOver || pc.currentDrawer !== info.playerNum) return;
    if (typeof x !== "number" || typeof y !== "number") return;
    const clean = { type: "fill", x: x, y: y, color: (color || "#000000").toString().slice(0, 16) };
    pc.actions.push(clean);
    touch(room);
    socket.to(code).emit("pictionary_fill_apply", clean);
  });

  // ---------- Annuler le dernier trait/action ----------
  socket.on("pictionary_undo", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pictionary") return;
    const pc = room.pictionary;
    if (!pc || pc.roundOver || pc.currentDrawer !== info.playerNum) return;
    pc.actions.pop();
    touch(room);
    io.to(code).emit("pictionary_actions_sync", { actions: pc.actions });
  });

  // ---------- Tout effacer ----------
  socket.on("pictionary_clear", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pictionary") return;
    const pc = room.pictionary;
    if (!pc || pc.roundOver || pc.currentDrawer !== info.playerNum) return;
    pc.actions = [];
    touch(room);
    io.to(code).emit("pictionary_actions_sync", { actions: pc.actions });
  });

  // ---------- Un joueur envoie une proposition (ou un message de chat) ----------
  socket.on("pictionary_chat_guess", ({ code, text }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pictionary") return;
    const pc = room.pictionary;
    if (!pc || pc.roundOver) return;
    const playerNum = info.playerNum;
    const playerName = room.players[playerNum] ? room.players[playerNum].name : "Joueur";
    const clean = (text || "").toString().trim().slice(0, 100);
    if (!clean) return;

    // Le Dessinateur ou un joueur ayant déjà trouvé peut discuter, mais ça
    // ne compte jamais comme une nouvelle proposition de réponse.
    if (playerNum === pc.currentDrawer || pc.statuses[playerNum] === "found") {
      pc.chat.push({ type: "chat", playerNum: playerNum, name: playerName, text: clean });
      touch(room);
      emitPictionaryStateToRoom(room);
      return;
    }

    const correct = pc.secret && normalizeName(clean) === normalizeName(pc.secret.name);
    if (correct) {
      pc.statuses[playerNum] = "found";
      pc.foundOrder.push(playerNum);
      const rank = pc.foundOrder.length;
      const basePoints = PICTIONARY_RANK_POINTS[Math.min(rank - 1, PICTIONARY_RANK_POINTS.length - 1)];
      const pts = Math.max(PICTIONARY_MIN_POINTS, basePoints);
      pc.roundPoints[playerNum] = pts;
      pc.totals[playerNum] = (pc.totals[playerNum] || 0) + pts;
      pc.chat.push({ type: "found", playerNum: playerNum, name: playerName });
      touch(room);
      checkPictionaryRoundEnd(room);
    } else {
      pc.chat.push({ type: "chat", playerNum: playerNum, name: playerName, text: clean });
      touch(room);
    }
    emitPictionaryStateToRoom(room);
  });

  // ---------- Passage à la manche suivante (vote unanime) ----------
  socket.on("pictionary_continue", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "pictionary") return;
    const pc = room.pictionary;
    if (!pc || !pc.roundOver) return;
    pc.continueReady[info.playerNum] = true;
    touch(room);

    const allReady = pc.participants.every((n) => pc.continueReady[n]);
    if (allReady) {
      if (pc.round >= pc.totalRounds) {
        room.status = "pictionary_over";
        io.to(code).emit("pictionary_game_over", { totals: pc.totals, players: publicPlayers(room) });
      } else {
        startPictionaryRound(room);
        emitPictionaryStateToRoom(room);
      }
    } else {
      io.to(code).emit("pictionary_continue_status", { continueReady: pc.continueReady });
    }
  });

  // Vote de revanche : une fois tous les joueurs prêts, on ne relance pas
  // directement la partie. On renvoie tout le monde en salle d'attente pour
  // permettre à l'hôte de modifier générations / mode de grille avant de
  // cliquer à nouveau sur "Démarrer la partie".
  socket.on("replay_vote", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info) return;
    if (
      room.status !== "victory" &&
      room.status !== "demicercle_over" &&
      room.status !== "devinmon_over" &&
      room.status !== "pictionary_over" &&
      room.status !== "pokedextarget_over"
    )
      return;
    room.players[info.playerNum].replayReady = true;
    touch(room);
    io.to(code).emit("players_update", roomSummary(room));

    const occupied = occupiedPlayerNums(room);
    const allReady = occupied.every((n) => room.players[n].replayReady);
    if (allReady) {
      room.gamePokemons = [];
      occupied.forEach((n) => {
        room.players[n].secret = null;
        room.players[n].flipped = {};
        room.players[n].replayReady = false;
      });
      room.demiCercle = null;
      room.devinmon = null;
      room.pictionary = null;
      room.pokedextarget = null;
      room.status = "lobby";
      room.currentPlayer = 1;
      room.guessMode = false;
      room.winner = null;
      room.secretFound = null;
      touch(room);
      io.to(code).emit("return_to_lobby", roomSummary(room));
    }
  });

  socket.on("leave_room", () => cleanupSocket(socket));
  socket.on("disconnect", () => cleanupSocket(socket));

  function cleanupSocket(sock) {
    const info = socketToRoom.get(sock.id);
    if (!info) return;
    const room = rooms.get(info.code);
    socketToRoom.delete(sock.id);
    if (!room) return;
    const p = room.players[info.playerNum];
    if (p && p.socketId === sock.id) {
      p.connected = false;
    }
    touch(room);
    io.to(info.code).emit("players_update", roomSummary(room));

    // Si tous les joueurs sont partis, on supprime la room après un délai
    const bothGone = occupiedPlayerNums(room).every((n) => !room.players[n].connected);
    if (bothGone) {
      setTimeout(() => {
        const r = rooms.get(info.code);
        if (!r) return;
        const stillGone = occupiedPlayerNums(r).every((n) => !r.players[n].connected);
        if (stillGone) rooms.delete(info.code);
      }, 1000 * 60 * 10);
    }
  }
});

function buildGameStatePayload(room) {
  return {
    currentPlayer: room.currentPlayer,
    guessMode: room.guessMode,
    players: publicPlayers(room),
    gamePokemons: room.gamePokemons,
    opponentFlipped: {},
  };
}

function buildResyncPayload(room, forPlayerNum) {
  const me = room.players[forPlayerNum];
  const opponent =
    room.mode === "quiestce" ? room.players[otherPlayerNum(forPlayerNum)] : null;
  const payload = {
    status: room.status,
    mode: room.mode,
    generations: room.generations,
    gridMode: room.gridMode,
    pdtSubMode: room.pdtSubMode || "number",
    maxPlayers: room.maxPlayers,
    gamePokemons: room.gamePokemons,
    currentPlayer: room.currentPlayer,
    guessMode: room.guessMode,
    players: publicPlayers(room),
    mySecret: me ? me.secret : null,
    winner: room.winner,
    secretFound: room.secretFound,
    opponentFlipped: opponent && opponent.flipped ? opponent.flipped : {},
    demiCercle: null,
    devinmon: null,
    pictionary: null,
    pokedextarget: null,
  };
  if (room.mode === "demicercle" && room.demiCercle) {
    payload.demiCercle = demiCerclePayloadFor(room, forPlayerNum);
  }
  if (room.mode === "devinmon" && room.devinmon) {
    payload.devinmon = devinmonPayloadFor(room, forPlayerNum);
  }
  if (room.mode === "pictionary" && room.pictionary) {
    payload.pictionary = pictionaryPayloadFor(room, forPlayerNum);
  }
  if (room.mode === "pokedextarget" && room.pokedextarget) {
    payload.pokedextarget = pdtPayloadFor(room, forPlayerNum);
  }
  return payload;
}

server.listen(PORT, () => {
  console.log("Serveur Qui est-ce ? Pokémon Édition lancé sur le port " + PORT);
});