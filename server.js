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
const GAME_MODES = ["quiestce", "demicercle", "devinmon"];
const DEMI_CERCLE_ROUNDS = 10;
const DEVINMON_MIN_PLAYERS = 2;
const DEVINMON_MAX_PLAYERS = 6;

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

io.on("connection", (socket) => {
  socket.on("create_room", ({ name, mode, maxPlayers }) => {
    const code = makeRoomCode();
    const cleanMode = GAME_MODES.indexOf(mode) !== -1 ? mode : "quiestce";
    let cap = 2;
    if (cleanMode === "devinmon") {
      cap = Math.round(Number(maxPlayers)) || 2;
      cap = Math.max(DEVINMON_MIN_PLAYERS, Math.min(DEVINMON_MAX_PLAYERS, cap));
    }
    const room = {
      code,
      mode: cleanMode,
      generations: [1],
      gridMode: "normal",
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
      room.status === "devinmon_over"
    ) {
      socket.emit("resync", buildResyncPayload(room, playerNum));
    }
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
      room.status !== "devinmon_over"
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
        room.players[n].replayReady = false;
      });
      room.demiCercle = null;
      room.devinmon = null;
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
  };
}

function buildResyncPayload(room, forPlayerNum) {
  const me = room.players[forPlayerNum];
  const payload = {
    status: room.status,
    mode: room.mode,
    generations: room.generations,
    gridMode: room.gridMode,
    maxPlayers: room.maxPlayers,
    gamePokemons: room.gamePokemons,
    currentPlayer: room.currentPlayer,
    guessMode: room.guessMode,
    players: publicPlayers(room),
    mySecret: me ? me.secret : null,
    winner: room.winner,
    secretFound: room.secretFound,
    demiCercle: null,
    devinmon: null,
  };
  if (room.mode === "demicercle" && room.demiCercle) {
    payload.demiCercle = demiCerclePayloadFor(room, forPlayerNum);
  }
  if (room.mode === "devinmon" && room.devinmon) {
    payload.devinmon = devinmonPayloadFor(room, forPlayerNum);
  }
  return payload;
}

server.listen(PORT, () => {
  console.log("Serveur Qui est-ce ? Pokémon Édition lancé sur le port " + PORT);
});