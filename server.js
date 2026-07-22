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

function pickGrid(generations) {
  const pool = buildPool(generations);
  const shuffled = shuffle(pool);
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

// ---------- État des rooms en mémoire ----------
// rooms: Map<code, room>
// room = {
//   code, generations:[1], status:'lobby'|'picking'|'playing'|'victory',
//   players: { 1:{socketId,name,connected,secret,replayReady}, 2:{...} },
//   gamePokemons: [{id,name}], currentPlayer:1, guessMode:false,
//   winner:null, secretFound:null, lastActivity: Date.now()
// }
const rooms = new Map();
const socketToRoom = new Map(); // socketId -> {code, playerNum}

function publicPlayers(room) {
  const out = {};
  [1, 2].forEach((n) => {
    const p = room.players[n];
    out[n] = p ? { name: p.name, connected: p.connected, hasPicked: !!p.secret, replayReady: !!p.replayReady } : null;
  });
  return out;
}

function roomSummary(room) {
  return {
    code: room.code,
    status: room.status,
    generations: room.generations,
    players: publicPlayers(room),
  };
}

function otherPlayerNum(n) {
  return n === 1 ? 2 : 1;
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

io.on("connection", (socket) => {
  socket.on("create_room", ({ name }) => {
    const code = makeRoomCode();
    const room = {
      code,
      generations: [1],
      status: "lobby",
      players: {
        1: { socketId: socket.id, name: (name || "Joueur 1").slice(0, 16), connected: true, secret: null, replayReady: false },
        2: null,
      },
      gamePokemons: [],
      currentPlayer: 1,
      guessMode: false,
      winner: null,
      secretFound: null,
      lastActivity: Date.now(),
    };
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
    if (room.players[2] && room.players[2].connected === false && room.players[2].socketId === null) {
      playerNum = 2;
    } else if (!room.players[2]) {
      playerNum = 2;
    } else if (room.players[1] && !room.players[1].connected) {
      playerNum = 1;
    } else {
      socket.emit("error_message", { message: "Ce lobby est déjà complet." });
      return;
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
    if (room.status === "picking" || room.status === "playing" || room.status === "victory") {
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

  socket.on("start_game", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || info.playerNum !== 1) return;
    if (!room.players[1] || !room.players[2]) {
      socket.emit("error_message", { message: "Il faut deux joueurs pour commencer." });
      return;
    }
    const grid = pickGrid(room.generations);
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
    room.currentPlayer = 1;
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
      room.currentPlayer = 1;
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

  socket.on("replay_vote", ({ code }) => {
    const room = rooms.get(code);
    const info = socketToRoom.get(socket.id);
    if (!room || !info || room.status !== "victory") return;
    room.players[info.playerNum].replayReady = true;
    touch(room);
    io.to(code).emit("players_update", roomSummary(room));

    const p1 = room.players[1],
      p2 = room.players[2];
    if (p1 && p2 && p1.replayReady && p2.replayReady) {
      const grid = pickGrid(room.generations);
      room.gamePokemons = grid;
      room.players[1].secret = null;
      room.players[2].secret = null;
      room.players[1].replayReady = false;
      room.players[2].replayReady = false;
      room.status = "picking";
      room.currentPlayer = 1;
      room.guessMode = false;
      room.winner = null;
      room.secretFound = null;
      io.to(code).emit("game_started", {
        gamePokemons: room.gamePokemons,
        players: publicPlayers(room),
      });
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

    // Si les deux joueurs sont partis, on supprime la room après un délai
    const bothGone =
      (!room.players[1] || !room.players[1].connected) &&
      (!room.players[2] || !room.players[2].connected);
    if (bothGone) {
      setTimeout(() => {
        const r = rooms.get(info.code);
        if (!r) return;
        const stillGone =
          (!r.players[1] || !r.players[1].connected) &&
          (!r.players[2] || !r.players[2].connected);
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
  return {
    status: room.status,
    generations: room.generations,
    gamePokemons: room.gamePokemons,
    currentPlayer: room.currentPlayer,
    guessMode: room.guessMode,
    players: publicPlayers(room),
    mySecret: me ? me.secret : null,
    winner: room.winner,
    secretFound: room.secretFound,
  };
}

server.listen(PORT, () => {
  console.log("Serveur Qui est-ce ? Pokémon Édition lancé sur le port " + PORT);
});
