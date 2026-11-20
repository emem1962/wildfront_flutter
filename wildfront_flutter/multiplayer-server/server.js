'use strict';

// WILDFRONT 3D — authoritative, low-bandwidth room server for Render Free.
// The server owns wildlife movement, hits, scoring, ammo and team state.

const http = require('node:http');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3000);
const MAX_ROOM_SIZE = 8;
const MAX_CONNECTIONS = 40;
const MAX_MESSAGE_BYTES = 8 * 1024;
const SNAPSHOT_MS = 180; // ~5.5 Hz — intentionally modest for Render Free CPU.
const TICK_MS = 100;
const ROOM_EMPTY_TTL_MS = 60_000;
const rooms = new Map();
const clients = new Map();

function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
}
function cleanText(value, max = 16, fallback = 'Avcı') {
  const text = String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  return text || fallback;
}
function terrainHeight(x, z) {
  return Math.sin(x * 0.035) * 1.45 + Math.cos(z * 0.029) * 1.2 +
    Math.sin((x + z) * 0.014) * 2.2 + Math.cos((x - z) * 0.021) * 0.8;
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function roomAnimals(roomCode) {
  const random = seededRandom([...roomCode].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0x5f3759df));
  const spawns = [
    [-36, -48, 'deer'], [44, -58, 'deer'], [-66, 22, 'deer'],
    [58, 42, 'deer'], [12, 76, 'deer'], [-82, -54, 'deer'],
    [78, -18, 'boar'], [-118, 86, 'boar'], [112, 92, 'deer'],
    [-125, -112, 'deer'], [138, -64, 'boar'], [-12, -132, 'deer'],
  ];
  return new Map(spawns.map(([x, z, kind], i) => [
    `wildlife-${i}`,
    {
      id: `wildlife-${i}`, kind, x, z, yaw: random() * Math.PI * 2,
      state: 'graze', alive: true, speed: 0.35 + random() * 0.35,
      turnAt: Date.now() + 1200 + random() * 4500,
      alertUntil: 0, callTarget: null, callUntil: 0,
      walkPhase: random() * Math.PI * 2,
    },
  ]));
}
function createRoom(code) {
  const room = {
    code,
    players: new Map(),
    animals: roomAnimals(code),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    lastSnapshotAt: 0,
    wind: { x: 0.42, z: -0.28, strength: 2.1 },
    nextWindAt: Date.now() + 75_000,
    day: 1,
    weather: 'clear',
    emptySince: null,
  };
  rooms.set(code, room);
  return room;
}
function jsonSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(payload)); } catch (_) { /* socket is closing */ }
  }
}
function broadcast(room, payload, except = null) {
  for (const player of room.players.values()) {
    if (player.ws !== except) jsonSend(player.ws, payload);
  }
}
function publicPlayer(player) {
  return {
    id: player.id, name: player.name, x: player.x, z: player.z,
    yaw: player.yaw, pitch: player.pitch, crouch: player.crouch,
    sprint: player.sprint, score: player.score, bag: player.bag, health: player.health,
    deer: player.deer || 0, boar: player.boar || 0, cleanShots: player.cleanShots || 0, shots: player.shots || 0,
  };
}
function publicAnimals(room) {
  return Array.from(room.animals.values()).map((a) => ({
    id: a.id, kind: a.kind, x: Number(a.x.toFixed(2)), z: Number(a.z.toFixed(2)),
    yaw: Number(a.yaw.toFixed(3)), state: a.state, alive: a.alive,
  }));
}
function snapshot(room) {
  return {
    type: 'snapshot',
    players: Array.from(room.players.values()).map(publicPlayer),
    animals: publicAnimals(room),
    wind: room.wind,
    day: room.day,
    weather: room.weather,
    worldTime: (Date.now() - room.createdAt) / 1000,
    at: Date.now(),
  };
}
function detach(ws) {
  const player = clients.get(ws);
  if (!player) return;
  const room = rooms.get(player.room);
  if (room) {
    room.players.delete(player.id);
    room.lastActiveAt = Date.now();
    broadcast(room, { type: 'player_left', id: player.id, name: player.name });
    if (room.players.size === 0) room.emptySince = Date.now();
  }
  clients.delete(ws);
}
function nearestPlayer(animal, room) {
  let best = null;
  let bestDistance = Infinity;
  for (const player of room.players.values()) {
    const distance = Math.hypot(player.x - animal.x, player.z - animal.z);
    if (distance < bestDistance) { best = player; bestDistance = distance; }
  }
  return best ? { player: best, distance: bestDistance } : null;
}
function turnAway(animal, player) {
  const dx = animal.x - player.x;
  const dz = animal.z - player.z;
  animal.yaw = Math.atan2(dx, dz);
  animal.state = 'flee';
  animal.speed = animal.kind === 'boar' ? 7.4 : 9.2;
  animal.alertUntil = Date.now() + 7000;
  animal.callTarget = null;
}
function alarmWildlife(room, player, radius = 92) {
  for (const animal of room.animals.values()) {
    if (!animal.alive) continue;
    if (Math.hypot(animal.x - player.x, animal.z - player.z) < radius) turnAway(animal, player);
  }
}
function updateAnimal(room, animal, dt, now) {
  if (!animal.alive) {
    if (animal.respawnAt && now >= animal.respawnAt) {
      // Return the animal to a quiet area away from the current hunting party.
      let spawnX = 0, spawnZ = 0;
      for (let attempt = 0; attempt < 12; attempt++) {
        spawnX = (Math.random() - 0.5) * 270;
        spawnZ = (Math.random() - 0.5) * 270;
        const nearest = nearestPlayer({ x: spawnX, z: spawnZ }, room);
        if (!nearest || nearest.distance > 72) break;
      }
      animal.x = spawnX; animal.z = spawnZ; animal.yaw = Math.random() * Math.PI * 2;
      animal.alive = true; animal.state = 'graze'; animal.speed = 0.35 + Math.random() * 0.45;
      animal.turnAt = now + 1800 + Math.random() * 4500; animal.alertUntil = 0;
      animal.callTarget = null; animal.callUntil = 0; animal.respawnAt = 0;
    }
    return;
  }
  const nearest = nearestPlayer(animal, room);
  if (nearest) {
    const { player, distance } = nearest;
    const detectionRadius = player.sprint ? 38 : (player.crouch ? 5.5 : (player.moving ? 22 : 13));
    if (distance < detectionRadius && animal.state !== 'flee' && animal.state !== 'charge') {
      if (animal.kind === 'boar' && distance < 13 && !player.crouch) {
        animal.state = 'charge';
        animal.alertUntil = now + 3500;
      } else {
        animal.state = 'alert';
        animal.alertUntil = now + 1100;
        animal.yaw = Math.atan2(player.x - animal.x, player.z - animal.z);
      }
    }
    if (animal.state === 'charge' && distance > 18) animal.state = 'flee';
    if (animal.state === 'charge' && distance < 2.7 && now - (animal.lastAttackAt || 0) > 2400) {
      animal.lastAttackAt = now;
      player.health = Math.max(0, player.health - 22);
      jsonSend(player.ws, { type: 'player_hit', health: player.health, animal: animal.kind });
      if (player.health <= 0) {
        player.x = 0; player.z = 7; player.health = 100;
        player.score = Math.max(0, player.score - 50);
        jsonSend(player.ws, { type: 'player_respawn', health: 100, score: player.score, penalty: 50 });
      }
    }
  }

  if (animal.state === 'alert' && now >= animal.alertUntil) {
    if (nearest && nearest.distance < 34) turnAway(animal, nearest.player);
    else animal.state = 'wander';
  }
  if (animal.state === 'approach') {
    const target = room.players.get(animal.callTarget);
    if (!target || now > animal.callUntil || nearest?.distance < 7) {
      animal.state = 'graze'; animal.callTarget = null;
    } else {
      animal.yaw = Math.atan2(target.x - animal.x, target.z - animal.z);
      animal.speed = 1.65;
    }
  }
  if (animal.state === 'charge' && nearest) {
    animal.yaw = Math.atan2(nearest.player.x - animal.x, nearest.player.z - animal.z);
    animal.speed = 7.1;
  } else if (animal.state === 'flee') {
    if (now > animal.alertUntil) animal.state = 'wander';
    animal.speed = Math.max(animal.speed, animal.kind === 'boar' ? 6.5 : 8.1);
  } else if (animal.state === 'graze' || animal.state === 'wander') {
    if (now > animal.turnAt) {
      animal.yaw += (Math.random() - 0.5) * 1.9;
      animal.turnAt = now + 2300 + Math.random() * 4800;
      animal.state = Math.random() < 0.46 ? 'graze' : 'wander';
      animal.speed = animal.state === 'graze' ? 0.35 : 1.25;
    }
  }

  const speed = animal.state === 'flee' ? animal.speed :
    animal.state === 'charge' ? 7.1 : animal.state === 'approach' ? 1.65 : animal.speed;
  animal.x += Math.sin(animal.yaw) * speed * dt;
  animal.z += Math.cos(animal.yaw) * speed * dt;
  animal.x = clamp(animal.x, -155, 155);
  animal.z = clamp(animal.z, -155, 155);
  if (animal.x <= -154 || animal.x >= 154 || animal.z <= -154 || animal.z >= 154) {
    animal.yaw += Math.PI * (0.7 + Math.random() * 0.6);
  }
  animal.speed = speed;
}
function raySphere(origin, direction, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const t = -b - Math.sqrt(discriminant);
  return t > 0 ? t : null;
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({
      ok: true,
      service: 'wildfront-multiplayer',
      protocol: 'websocket',
      rooms: rooms.size,
      connectedPlayers: clients.size,
      maxRoomSize: MAX_ROOM_SIZE,
      serverTime: new Date().toISOString(),
    }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});
const wss = new WebSocket.Server({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });

wss.on('connection', (ws) => {
  if (clients.size >= MAX_CONNECTIONS) {
    jsonSend(ws, { type: 'error', message: 'Sunucu şu anda dolu. Daha sonra tekrar dene.' });
    ws.close(1013, 'Server busy');
    return;
  }
  ws.isAlive = true;
  ws.lastClientMessageAt = Date.now();
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    ws.lastClientMessageAt = Date.now();
    let message;
    try { message = JSON.parse(raw.toString('utf8')); }
    catch (_) { jsonSend(ws, { type: 'error', message: 'Geçersiz mesaj biçimi.' }); return; }
    if (!message || typeof message !== 'object' || raw.length > MAX_MESSAGE_BYTES) return;

    if (message.type === 'ping') {
      jsonSend(ws, { type: 'pong', at: Date.now() });
      return;
    }

    if (message.type === 'join') {
      if (clients.has(ws)) return;
      const roomCode = cleanText(message.room, 8, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!roomCode) { jsonSend(ws, { type: 'error', message: 'Oda kodu geçersiz.' }); return; }
      const room = rooms.get(roomCode) || createRoom(roomCode);
      if (room.players.size >= MAX_ROOM_SIZE) {
        jsonSend(ws, { type: 'error', message: 'Oda dolu. En fazla 8 avcı katılabilir.' });
        return;
      }
      const player = {
        id: crypto.randomUUID(), name: cleanText(message.name, 16), room: roomCode, ws,
        x: 0, z: 7, yaw: 0, pitch: -0.02, crouch: false, sprint: false,
        aiming: false, moving: false, ammo: 5, reserve: 25, score: 0, bag: 0, health: 100,
        deer: 0, boar: 0, cleanShots: 0,
        lastMoveAt: Date.now(), lastShotAt: 0, lastReloadAt: 0, shots: 0,
      };
      room.players.set(player.id, player);
      room.emptySince = null;
      room.lastActiveAt = Date.now();
      clients.set(ws, player);
      jsonSend(ws, {
        type: 'welcome', id: player.id, room: roomCode, count: room.players.size,
        players: Array.from(room.players.values()).filter((p) => p.id !== player.id).map(publicPlayer),
        animals: publicAnimals(room), wind: room.wind, day: room.day, weather: room.weather,
        worldTime: (Date.now() - room.createdAt) / 1000,
        ammo: { current: player.ammo, reserve: player.reserve },
      });
      broadcast(room, { type: 'player_joined', player: publicPlayer(player) }, ws);
      console.log(`[${roomCode}] ${player.name} joined (${room.players.size}/${MAX_ROOM_SIZE})`);
      return;
    }

    const player = clients.get(ws);
    if (!player) { jsonSend(ws, { type: 'error', message: 'Önce bir odaya katılmalısın.' }); return; }
    const room = rooms.get(player.room);
    if (!room) { jsonSend(ws, { type: 'error', message: 'Oda oturumu bulunamadı.' }); return; }
    room.lastActiveAt = Date.now();

    if (message.type === 'move') {
      const now = Date.now();
      const elapsed = Math.max(0.06, Math.min(0.8, (now - player.lastMoveAt) / 1000));
      const nextX = clamp(message.x, -155, 155);
      const nextZ = clamp(message.z, -155, 155);
      const distance = Math.hypot(nextX - player.x, nextZ - player.z);
      const maxSpeed = message.sprint ? 7.5 : message.crouch ? 2.0 : 4.7;
      const allowed = maxSpeed * elapsed + 0.9;
      if (distance > allowed) {
        const ratio = allowed / distance;
        player.x += (nextX - player.x) * ratio;
        player.z += (nextZ - player.z) * ratio;
      } else {
        player.x = nextX;
        player.z = nextZ;
      }
      player.yaw = clamp(message.yaw, -Math.PI * 100, Math.PI * 100);
      player.pitch = clamp(message.pitch, -1.15, 0.85);
      player.crouch = !!message.crouch;
      player.sprint = !!message.sprint;
      player.aiming = !!message.aiming;
      player.moving = distance > 0.04;
      player.lastMoveAt = now;
      return;
    }

    if (message.type === 'shoot') {
      const now = Date.now();
      if (now - player.lastShotAt < 600) {
        jsonSend(ws, { type: 'shot_result', ok: false, reason: 'bolt', ammo: player.ammo, reserve: player.reserve });
        return;
      }
      if (player.ammo < 1) {
        jsonSend(ws, { type: 'shot_result', ok: false, reason: 'empty', ammo: player.ammo, reserve: player.reserve });
        return;
      }
      player.lastShotAt = now;
      player.ammo -= 1;
      player.shots += 1;
      const cp = Math.cos(player.pitch);
      let direction = {
        x: Math.sin(player.yaw) * cp,
        y: Math.sin(player.pitch),
        z: Math.cos(player.yaw) * cp,
      };
      const windDrift = room.wind.strength * 0.00075;
      direction.x += room.wind.x * windDrift;
      direction.z += room.wind.z * windDrift;
      const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
      direction = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
      const origin = {
        x: player.x,
        y: terrainHeight(player.x, player.z) + (player.crouch ? 1.06 : 1.66),
        z: player.z,
      };
      let best = null;
      let bestDistance = Infinity;
      for (const animal of room.animals.values()) {
        if (!animal.alive) continue;
        const center = { x: animal.x, y: terrainHeight(animal.x, animal.z) + (animal.kind === 'boar' ? 1.05 : 1.28), z: animal.z };
        const radius = animal.kind === 'boar' ? 1.05 : 1.18;
        const hitDistance = raySphere(origin, direction, center, radius);
        if (hitDistance !== null && hitDistance < bestDistance && hitDistance <= 145) {
          best = animal;
          bestDistance = hitDistance;
        }
      }
      broadcast(room, { type: 'shot_fired', player: publicPlayer(player) }, ws);
      alarmWildlife(room, player, 92);
      if (best) {
        best.alive = false;
        best.state = 'down';
        best.respawnAt = Date.now() + 45_000;
        const clean = player.aiming && bestDistance >= 24 && bestDistance <= 110;
        const points = Math.round((best.kind === 'boar' ? 95 : 75) + Math.min(bestDistance, 120) * 0.72 + (clean ? 65 : 0));
        player.score += points;
        player.bag += 1;
        if (best.kind === 'boar') player.boar += 1; else player.deer += 1;
        if (clean) player.cleanShots += 1;
        const result = {
          type: 'animal_down', animalId: best.id, kind: best.kind,
          distance: Number(bestDistance.toFixed(1)), points, clean,
          player: { id: player.id, name: player.name },
        };
        broadcast(room, result);
        jsonSend(ws, { ...result, type: 'shot_result', ok: true, hit: true, ammo: player.ammo, reserve: player.reserve, score: player.score, bag: player.bag });
      } else {
        jsonSend(ws, { type: 'shot_result', ok: true, hit: false, ammo: player.ammo, reserve: player.reserve, score: player.score, bag: player.bag });
      }
      return;
    }

    if (message.type === 'reload') {
      const now = Date.now();
      if (now - player.lastReloadAt < 1800) return;
      player.lastReloadAt = now;
      const loaded = Math.min(5 - player.ammo, player.reserve);
      player.ammo += loaded;
      player.reserve -= loaded;
      jsonSend(ws, { type: 'ammo_update', ammo: player.ammo, reserve: player.reserve });
      return;
    }

    if (message.type === 'call') {
      const now = Date.now();
      const cooldown = player.lastCallAt || 0;
      if (now - cooldown < 12_000) {
        jsonSend(ws, { type: 'call_result', ok: false, message: 'Çağrı için biraz bekle.' });
        return;
      }
      player.lastCallAt = now;
      let attracted = 0;
      for (const animal of room.animals.values()) {
        if (!animal.alive || animal.kind !== 'deer') continue;
        const distance = Math.hypot(animal.x - player.x, animal.z - player.z);
        if (distance < 64 && animal.state !== 'flee') {
          animal.state = 'approach';
          animal.callTarget = player.id;
          animal.callUntil = now + 9000;
          attracted += 1;
        }
      }
      broadcast(room, { type: 'player_call', player: { id: player.id, name: player.name, x: player.x, z: player.z } }, ws);
      jsonSend(ws, { type: 'call_result', ok: true, attracted });
      return;
    }

    if (message.type === 'chat') {
      const text = cleanText(message.text, 100, '');
      if (text) broadcast(room, { type: 'chat', player: { id: player.id, name: player.name }, text });
      return;
    }
  });

  ws.on('close', () => detach(ws));
  ws.on('error', () => detach(ws));
});

const tick = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.size === 0) {
      if (room.emptySince && now - room.emptySince > ROOM_EMPTY_TTL_MS) rooms.delete(code);
      continue;
    }
    if (now >= room.nextWindAt) {
      const angle = Math.random() * Math.PI * 2;
      room.wind = { x: Math.cos(angle), z: Math.sin(angle), strength: 0.7 + Math.random() * 4.8 };
      room.nextWindAt = now + 55_000 + Math.random() * 35_000;
      room.day = room.day >= 4 ? 1 : room.day + 1;
      const types = ['clear', 'clear', 'mist', 'rain'];
      room.weather = types[Math.floor(Math.random() * types.length)];
      broadcast(room, { type: 'weather', wind: room.wind, day: room.day, weather: room.weather });
    }
    for (const animal of room.animals.values()) updateAnimal(room, animal, TICK_MS / 1000, now);
    if (now - room.lastSnapshotAt >= SNAPSHOT_MS) {
      broadcast(room, snapshot(room));
      room.lastSnapshotAt = now;
    }
  }
}, TICK_MS);

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive || Date.now() - ws.lastClientMessageAt > 75_000) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) { ws.terminate(); }
  }
}, 30_000);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Wildfront authoritative multiplayer listening on 0.0.0.0:${PORT}`);
  console.log(`Limits: ${MAX_ROOM_SIZE} players/room, ${MAX_CONNECTIONS} server connections`);
});

function shutdown() {
  clearInterval(tick);
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'Server restarting');
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
