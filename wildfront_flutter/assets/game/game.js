const THREE_MODULE_URLS = [
  'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
  'https://unpkg.com/three@0.170.0/build/three.module.js',
];

async function loadThreeJs() {
  let lastError;
  for (const url of THREE_MODULE_URLS) {
    try { return await import(url); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('Three.js CDN erişimi başarısız.');
}

loadThreeJs().then((THREE) => bootGame(THREE)).catch((error) => {
  console.error('Three.js could not be loaded:', error);
  document.getElementById('bootError')?.classList.remove('hidden');
});

function bootGame(THREE) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('world');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aaf9d);
  scene.fog = new THREE.FogExp2(0x9aaf9d, 0.0064);

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 500);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.55));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const hemi = new THREE.HemisphereLight(0xdbe9d5, 0x35452b, 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe5bb, 2.35);
  sun.position.set(-55, 85, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  const moon = new THREE.DirectionalLight(0x9fb8df, 0.28);
  moon.position.set(40, 55, -45);
  scene.add(moon);
  const skyDay = new THREE.Color(0x9aaf9d);
  const skyNight = new THREE.Color(0x111b28);
  const sunDay = new THREE.Color(0xffe5bb);
  const sunNight = new THREE.Color(0x9fb8df);
  const currentSky = new THREE.Color();

  const clock = new THREE.Clock();
  const keys = Object.create(null);
  const animals = [];
  const hitZones = [];
  const remotePlayers = new Map();
  const player = { x: 0, z: 7, yaw: 0, pitch: -0.02, speed: 0, score: 0, bag: 0, ammo: 5, reserve: 25, day: 1, crouch: false, sprint: false, stamina: 100, noise: 0, health: 100 };
  let wind = { x: 0.6, z: 0.3, strength: 2.2 };
  let active = false;
  let aiming = false;
  let reloading = false;
  let tracking = false;
  let muted = false;
  let lastFootstep = 0;
  let lastAnimalCall = 0;
  let lastStateSend = 0;
  let multiplayer = false;
  let socket = null;
  let socketHeartbeat = null;
  let ownPlayerId = null;
  let roomCode = '';
  let lastNetSend = 0;
  let lastNetState = '';
  let toastTimer = null;
  let fireTimer = 0;
  let lastShotTime = 0;
  let lookPointer = null;
  let joystickPointer = null;
  let joy = { x: 0, y: 0 };
  let lastMinimap = 0;
  let lastRangeUpdate = 0;
  let worldTime = 0;
  let weatherType = 'clear';
  let missionStats = { deer: 0, boar: 0, clean: 0, complete: false };
  let rosterCache = [];
  let rosterSignature = '';
  let chatLineCount = 0;

  // Licensed CC0 sound effects from SFXMint. Audio is streamed on demand so
  // the Android package stays compact; the game remains playable if a sound is offline.
  const SOUND_URLS = {
    forest: 'https://sfxmint.com/dl/ambience-forest-49.mp3',
    wind: 'https://sfxmint.com/dl/ambience-forest-52.mp3',
    bird: 'https://sfxmint.com/dl/animal-bird-24.mp3',
    deer: 'https://sfxmint.com/dl/deer-call-02.mp3',
    boar: 'https://sfxmint.com/dl/boar-grunt-02.mp3',
    shot: 'https://sfxmint.com/dl/sniper-shot-09.mp3',
    bolt: 'https://sfxmint.com/dl/sniper-shot-01.mp3',
    steps: 'https://sfxmint.com/dl/footsteps-grass-08.mp3',
    rain: 'https://sfxmint.com/dl/ambience-rain-65.mp3',
  };
  const soundInstances = new Set();
  const soundLoops = {};
  const sounds = {
    unlocked: false,
    unlock() {
      if (!this.unlocked) {
        this.unlocked = true;
        for (const name of ['forest', 'wind', 'steps', 'rain']) {
          const audio = new Audio(SOUND_URLS[name]);
          audio.preload = 'auto';
          audio.loop = name !== 'steps';
          audio.volume = name === 'forest' ? 0.30 : name === 'wind' ? 0.12 : name === 'rain' ? 0 : 0;
          audio.muted = muted;
          soundInstances.add(audio);
          soundLoops[name] = audio;
        }
      }
      this.startAmbience();
    },
    startAmbience() {
      for (const name of ['forest', 'wind']) {
        const audio = soundLoops[name];
        if (!audio || muted) continue;
        audio.play().catch(() => {});
      }
    },
    setWeather(type) {
      const rain = soundLoops.rain;
      const isRain = type === 'rain';
      if (rain) {
        rain.volume = muted || !isRain ? 0 : 0.24;
        if (isRain && !muted && rain.paused) rain.play().catch(() => {});
        else if (!isRain) rain.pause();
      }
    },
    footsteps(on, sprinting = false) {
      const audio = soundLoops.steps;
      if (!audio) return;
      audio.volume = muted || !on ? 0 : sprinting ? 0.34 : player.crouch ? 0.075 : 0.19;
      audio.playbackRate = sprinting ? 1.18 : player.crouch ? 0.68 : 0.93;
      if (on && !muted) audio.play().catch(() => {});
      else if (!on) audio.pause();
    },
    play(name, volume = 1, playbackRate = 1) {
      if (muted || !this.unlocked || !SOUND_URLS[name]) return;
      const audio = new Audio(SOUND_URLS[name]);
      audio.preload = 'auto';
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.playbackRate = Math.max(0.65, Math.min(1.5, playbackRate));
      soundInstances.add(audio);
      audio.addEventListener('ended', () => soundInstances.delete(audio), { once: true });
      audio.play().catch(() => soundInstances.delete(audio));
    },
    playAt(name, distance, base = 0.5) {
      const attenuation = 1 / (1 + Math.max(0, distance) * 0.035);
      this.play(name, base * attenuation, 0.88 + Math.random() * 0.22);
    },
    toggleMute() {
      muted = !muted;
      for (const audio of soundInstances) audio.muted = muted;
      if (!muted) this.startAmbience();
      return muted;
    },
    stop() {
      for (const audio of soundInstances) { audio.pause(); audio.currentTime = 0; }
    },
  };

  function terrainHeight(x, z) {
    return Math.sin(x * 0.035) * 1.45 + Math.cos(z * 0.029) * 1.2 + Math.sin((x + z) * 0.014) * 2.2 + Math.cos((x - z) * 0.021) * 0.8;
  }

  function makeGroundTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#66794f'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 19000; i++) {
      const shade = 38 + Math.floor(Math.random() * 46);
      ctx.fillStyle = `rgba(${shade},${shade + 17},${shade - 12},${0.08 + Math.random() * 0.18})`;
      const size = 1 + Math.random() * 4;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, size, size * (0.4 + Math.random()));
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(26, 26);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function makeGrassDetails() {
    const geometry = new THREE.ConeGeometry(0.095, 0.62, 4);
    const material = new THREE.MeshStandardMaterial({ color: 0x728b4c, roughness: 1 });
    const grass = new THREE.InstancedMesh(geometry, material, 950);
    const dummy = new THREE.Object3D();
    let index = 0;
    for (let i = 0; i < 950; i++) {
      const x = (Math.random() - 0.5) * 310;
      const z = (Math.random() - 0.5) * 310;
      if (Math.hypot(x, z) < 14) continue;
      dummy.position.set(x, terrainHeight(x, z) + 0.22, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.15, Math.random() * Math.PI, (Math.random() - 0.5) * 0.22);
      const scale = 0.55 + Math.random() * 1.15;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      grass.setMatrixAt(index++, dummy.matrix);
    }
    grass.count = index;
    grass.castShadow = false;
    grass.receiveShadow = true;
    scene.add(grass);
  }

  function makeTerrain() {
    const size = 360;
    const segments = 110;
    const positions = [];
    const indices = [];
    for (let iz = 0; iz <= segments; iz++) {
      for (let ix = 0; ix <= segments; ix++) {
        const x = (ix / segments - 0.5) * size;
        const z = (iz / segments - 0.5) * size;
        positions.push(x, terrainHeight(x, z), z);
      }
    }
    for (let iz = 0; iz < segments; iz++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = iz * (segments + 1) + ix;
        const b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const groundTexture = makeGroundTexture();
    const material = new THREE.MeshStandardMaterial({ map: groundTexture, color: 0x879b65, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(geometry, material);
    ground.receiveShadow = true;
    scene.add(ground);
    makeGrassDetails();

    const trailMat = new THREE.MeshStandardMaterial({ color: 0x847b5a, roughness: 1 });
    const points = [];
    for (let i = 0; i < 40; i++) {
      const z = -105 + i * 5.5;
      const x = Math.sin(i * 0.21) * 10 - 4;
      points.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.025, z));
    }
    const trail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 90, 1.05, 7, false), trailMat);
    trail.position.y = 0.015;
    scene.add(trail);
  }

  const treeMaterials = {
    bark: new THREE.MeshStandardMaterial({ color: 0x59412c, roughness: 1 }),
    leavesA: new THREE.MeshStandardMaterial({ color: 0x29452b, roughness: 1 }),
    leavesB: new THREE.MeshStandardMaterial({ color: 0x3d5c35, roughness: 1 }),
    leavesC: new THREE.MeshStandardMaterial({ color: 0x536c3c, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x646c5e, roughness: 1 }),
    shrub: new THREE.MeshStandardMaterial({ color: 0x314b2c, roughness: 1 }),
  };

  function makeForest() {
    // Instancing keeps the forest detailed while limiting draw calls on mid-range Android phones.
    const treeCount = 112;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.24, 0.39, 4.8, 7), treeMaterials.bark, treeCount,
    );
    const crownA = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.5, 5.4, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), treeCount,
    );
    const crownB = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.9, 4.1, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), treeCount,
    );
    const crownC = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1.55, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), treeCount,
    );
    const branch = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.045, 0.09, 1.4, 5), treeMaterials.bark, treeCount * 2,
    );
    const dummy = new THREE.Object3D();
    const palettes = [0x29452b, 0x3d5c35, 0x536c3c];
    const reusableColor = new THREE.Color();
    for (let i = 0; i < treeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 19 + Math.random() * 115;
      const x = Math.cos(angle) * radius + (Math.random() - 0.5) * 10;
      const z = Math.sin(angle) * radius + (Math.random() - 0.5) * 10;
      const y = terrainHeight(x, z);
      const scale = 0.68 + Math.random() * 0.68;
      const yaw = Math.random() * Math.PI * 2;
      dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(scale);
      dummy.position.set(x, y + 2.25 * scale, z); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, y + 5.25 * scale, z); dummy.scale.setScalar(scale); dummy.updateMatrix(); crownA.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x + 0.15 * scale, y + 7.2 * scale, z + 0.1 * scale); dummy.scale.setScalar(scale * 0.9); dummy.updateMatrix(); crownB.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x - 0.9 * scale, y + 4.2 * scale, z + 0.45 * scale); dummy.scale.set(scale, scale * 0.82, scale); dummy.updateMatrix(); crownC.setMatrixAt(i, dummy.matrix);
      reusableColor.setHex(palettes[Math.floor(Math.random() * palettes.length)]);
      crownA.setColorAt(i, reusableColor); crownB.setColorAt(i, reusableColor); crownC.setColorAt(i, reusableColor);
      for (const side of [-1, 1]) {
        const index = i * 2 + (side > 0 ? 1 : 0);
        dummy.position.set(x + side * 0.46 * scale, y + 2.65 * scale, z + 0.1 * scale);
        dummy.rotation.set(0, yaw, side * -0.78); dummy.scale.setScalar(scale); dummy.updateMatrix();
        branch.setMatrixAt(index, dummy.matrix);
      }
    }
    for (const mesh of [trunk, crownA, crownB, crownC, branch]) {
      mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    }
    for (const mesh of [trunk, crownA, crownB, crownC, branch]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const rockCount = 32;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), treeMaterials.rock, rockCount);
    for (let i = 0; i < rockCount; i++) {
      const x = (Math.random() - 0.5) * 220, z = (Math.random() - 0.5) * 220;
      const scale = 0.45 + Math.random() * 1.15;
      dummy.position.set(x, terrainHeight(x, z) + 0.35, z);
      dummy.rotation.set(Math.random(), Math.random(), Math.random());
      dummy.scale.set(scale, scale * 0.55, scale); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks);

    const bushCount = 55;
    const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), treeMaterials.shrub, bushCount);
    for (let i = 0; i < bushCount; i++) {
      const x = (Math.random() - 0.5) * 150, z = (Math.random() - 0.5) * 150;
      const scale = 0.9 + Math.random() * 1.3;
      dummy.position.set(x, terrainHeight(x, z) + 0.45, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(scale * 1.4, scale * 0.7, scale); dummy.updateMatrix(); bushes.setMatrixAt(i, dummy.matrix);
    }
    bushes.castShadow = true; scene.add(bushes);
  }

  function addEllipsoid(parent, color, pos, scale, material = null) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), material || new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    mesh.position.set(...pos);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function createAnimal(x, z, kind = 'deer', id = null) {
    const root = new THREE.Group();
    root.position.set(x, terrainHeight(x, z), z);
    const coat = kind === 'boar' ? 0x493a2c : (Math.random() > 0.5 ? 0x806047 : 0x99734d);
    const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x30281f, roughness: 1 });
    const body = addEllipsoid(root, coat, [0, 1.15, 0], kind === 'boar' ? [0.62, 0.55, 1.0] : [0.48, 0.62, 1.05], coatMat);
    const neck = addEllipsoid(root, coat, [0, 1.57, 0.66], kind === 'boar' ? [0.35, 0.38, 0.36] : [0.29, 0.62, 0.3], coatMat);
    neck.rotation.x = -0.34;
    const head = addEllipsoid(root, coat, [0, 2.02, 0.86], kind === 'boar' ? [0.25, 0.27, 0.37] : [0.24, 0.29, 0.38], coatMat);
    const snout = addEllipsoid(root, kind === 'boar' ? 0x655044 : 0x4c392b, [0, 1.98, 1.16], [0.13, 0.12, 0.18], darkMat);
    const legs = [];
    for (const sx of [-0.27, 0.27]) {
      for (const sz of [-0.62, 0.58]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx, 0.92, sz);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.88, 7), darkMat);
        leg.position.y = -0.44;
        leg.castShadow = true;
        pivot.add(leg);
        root.add(pivot);
        legs.push(pivot);
      }
    }
    if (kind === 'deer') {
      // Antlers are simple, stylised branches rather than a borrowed model.
      const antlerMat = new THREE.MeshStandardMaterial({ color: 0x4a382a, roughness: 1 });
      for (const side of [-1, 1]) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.48, 5), antlerMat);
        base.position.set(side * 0.14, 2.28, 0.78);
        base.rotation.z = side * -0.4;
        root.add(base);
        for (let k = 0; k < 3; k++) {
          const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.032, 0.31, 5), antlerMat);
          tine.position.set(side * (0.24 + k * 0.055), 2.47 + k * 0.035, 0.78);
          tine.rotation.z = side * (0.85 + k * 0.13);
          root.add(tine);
        }
      }
    } else {
      const earL = addEllipsoid(root, coat, [-0.18, 2.19, 0.75], [0.09, 0.19, 0.07], coatMat);
      const earR = addEllipsoid(root, coat, [0.18, 2.19, 0.75], [0.09, 0.19, 0.07], coatMat);
      earL.rotation.z = 0.4;
      earR.rotation.z = -0.4;
    }
    // A transparent body hit-volume makes aiming readable without gore.
    // Eye highlights and soft tail silhouette add readability at distance.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x18140f, roughness: 0.2 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMat);
      eye.position.set(side * 0.17, 2.05, 1.03); root.add(eye);
    }
    const tail = addEllipsoid(root, kind === 'boar' ? 0x30271e : 0xeadcc5, [0, 1.35, -0.97], [0.12, 0.17, 0.22], darkMat);
    tail.rotation.x = -0.25;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.set(0, 1.27, 0.06);
    hit.scale.set(0.95, 0.9, 1.45);
    root.add(hit);
    const animal = {
      root, legs, hit, kind, id: id || `local-${animals.length}-${Math.floor(Math.random() * 100000)}`, name: kind === 'boar' ? 'Yaban domuzu' : 'Kızıl geyik',
      alive: true, deadAt: 0, speed: 0.65 + Math.random() * 0.45,
      dir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
      turn: Math.random() * 4, walkPhase: Math.random() * 6,
    };
    const trackGroup = new THREE.Group();
    const trackMat = new THREE.MeshBasicMaterial({ color: 0x29271d, transparent: true, opacity: 0.42, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const mark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 5), trackMat);
      mark.scale.set(0.72, 0.10, 1.1);
      mark.position.set((i % 2 ? 0.2 : -0.2), 0.035, 1.3 + Math.floor(i / 2) * 1.3);
      trackGroup.add(mark);
    }
    trackGroup.visible = false; scene.add(trackGroup);
    animal.trackGroup = trackGroup; animal.targetX = x; animal.targetZ = z; animal.targetYaw = 0; animal.state = 'graze';
    animal.nextCallAt = 10 + Math.random() * 30;
    hit.userData.animal = animal;
    hitZones.push(hit);
    animals.push(animal);
    scene.add(root);
  }

  function populateWildlife() {
    // Stable IDs and starting positions allow a room to share successful hunts.
    const herd = [
      [-36, -48, 'deer'], [44, -58, 'deer'], [-66, 22, 'deer'],
      [58, 42, 'deer'], [12, 76, 'deer'], [-82, -54, 'deer'], [78, -18, 'boar'],
      [-118, 86, 'boar'], [112, 92, 'deer'], [-125, -112, 'deer'],
      [138, -64, 'boar'], [-12, -132, 'deer'],
    ];
    herd.forEach(([x, z, kind], index) => createAnimal(x, z, kind, `wildlife-${index}`));
  }

  function makeWeapon() {
    const weapon = new THREE.Group();
    const black = new THREE.MeshStandardMaterial({ color: 0x202522, metalness: 0.68, roughness: 0.34 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x68716c, metalness: 0.84, roughness: 0.24 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x543c2b, roughness: 0.72 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x171b18, roughness: 0.95 });
    function box(w, h, d, mat, p, rot = [0, 0, 0]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(...p); m.rotation.set(...rot); weapon.add(m); return m;
    }
    function cyl(r1, r2, len, mat, p, rot = [Math.PI / 2, 0, 0]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 12), mat);
      m.position.set(...p); m.rotation.set(...rot); weapon.add(m); return m;
    }
    box(0.15, 0.16, 0.62, wood, [-0.03, -0.04, 0.23], [-0.08, 0, 0]);
    box(0.16, 0.27, 0.2, wood, [-0.03, -0.15, -0.05], [-0.23, 0, 0]);
    box(0.14, 0.08, 0.52, black, [0, 0.045, -0.22]);
    cyl(0.032, 0.032, 0.96, steel, [0, 0.065, -0.83]);
    cyl(0.046, 0.035, 0.1, black, [0, 0.065, -1.32]);
    box(0.115, 0.15, 0.18, black, [0, -0.09, -0.28]);
    box(0.055, 0.18, 0.07, rubber, [0, -0.24, -0.17], [0.24, 0, 0]);
    cyl(0.055, 0.055, 0.24, black, [0, 0.17, -0.57]);
    cyl(0.038, 0.038, 0.19, steel, [0, 0.17, -0.57]);
    box(0.18, 0.055, 0.19, black, [0, 0.245, -0.57]);
    const flash = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.38, 8), new THREE.MeshBasicMaterial({ color: 0xffd47b, transparent: true, opacity: 0.9 }));
    flash.rotation.x = -Math.PI / 2;
    flash.position.set(0, 0.07, -1.52);
    flash.visible = false;
    weapon.add(flash);
    const flashLight = new THREE.PointLight(0xffbf67, 0, 6);
    flashLight.position.copy(flash.position);
    weapon.add(flashLight);
    weapon.position.set(0.42, -0.37, -0.64);
    weapon.rotation.set(-0.05, -0.05, -0.01);
    camera.add(weapon);
    scene.add(camera);
    return { weapon, flash, flashLight };
  }

  makeTerrain();
  makeForest();
  populateWildlife();
  camera.position.set(player.x, terrainHeight(player.x, player.z) + 1.67, player.z);
  const weaponFx = makeWeapon();

  function addRemotePlayer(id, name) {
    if (remotePlayers.has(id)) return remotePlayers.get(id);
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.72, 4, 8), new THREE.MeshStandardMaterial({ color: 0x9cc66b, roughness: 0.9 }));
    body.position.y = 0.82;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc8b08d }));
    head.position.y = 1.45; group.add(head);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256; labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d');
    ctx.fillStyle = 'rgba(10,18,11,.76)'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#d9edba'; ctx.font = 'bold 25px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(name || 'Avcı').slice(0, 16), 128, 41);
    const texture = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    label.position.y = 2.05; label.scale.set(2.2, 0.55, 1); group.add(label);
    scene.add(group);
    const record = { group, targetX: 0, targetZ: 0, targetYaw: 0, crouch: false, id, name };
    remotePlayers.set(id, record);
    return record;
  }

  function applySnapshot(players) {
    const keep = new Set();
    const allPlayers = Array.isArray(players) ? players : [];
    const self = allPlayers.find((p) => p && p.id === ownPlayerId);
    if (self) { player.score = Number(self.score) || 0; player.bag = Number(self.bag) || 0; player.health = Number(self.health) || player.health; }
    for (const p of allPlayers) {
      if (!p || p.id === ownPlayerId) continue;
      keep.add(p.id);
      const r = addRemotePlayer(p.id, p.name);
      r.targetX = Number(p.x) || 0;
      r.targetZ = Number(p.z) || 0;
      r.targetYaw = Number(p.yaw) || 0;
      r.crouch = !!p.crouch;
    }
    for (const [id, r] of remotePlayers) {
      if (!keep.has(id)) { scene.remove(r.group); remotePlayers.delete(id); }
    }
    const count = $('playerCount');
    if (count) count.textContent = `${remotePlayers.size + 1}/8`;
    updateTeamPanel(allPlayers);
  }

  function applyRemoteKill(animalId, playerName = 'Takım arkadaşın') {
    const animal = animals.find((item) => item.id === animalId && item.alive);
    if (!animal) return;
    animal.alive = false;
    animal.deadAt = worldTime;
    if (playerName !== 'Sen') showToast(`${playerName} · ${animal.name} avladı`, 2200);
  }

  function showToast(message, duration = 2100) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  function updateMissionUI() {
    const el = $('missionProgress');
    if (!el) return;
    const deerTarget = 2, cleanTarget = 1;
    el.textContent = `GEYİK ${Math.min(missionStats.deer, deerTarget)}/${deerTarget}  ·  TEMİZ ATIŞ ${Math.min(missionStats.clean, cleanTarget)}/${cleanTarget}`;
    const done = missionStats.deer >= deerTarget && missionStats.clean >= cleanTarget;
    missionStats.complete = done;
    $('missionCard')?.classList.toggle('complete', done);
  }

  function registerHarvest(kind, clean) {
    const wasComplete = missionStats.complete;
    if (kind === 'boar') missionStats.boar++;
    else missionStats.deer++;
    if (clean) missionStats.clean++;
    updateMissionUI();
    if (!wasComplete && missionStats.complete) showToast('SEFER GÖREVİ TAMAMLANDI · BONUS HEDEFE ULAŞTIN', 3200);
  }

  function updateTeamPanel(players) {
    const list = Array.isArray(players) ? players : [];
    rosterCache = list.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const signature = rosterCache.map((p) => `${p.id}:${p.name || ''}:${Number(p.score) || 0}:${Number(p.bag) || 0}`).join('|');
    const count = $('teamCount'); if (count) count.textContent = `${rosterCache.length}/8`;
    const host = $('teamRoster');
    // Snapshots arrive about 5.5 times per second. Do not rebuild the DOM on
    // every position update when the score table itself has not changed.
    if (!host || (signature === rosterSignature && host.childElementCount === rosterCache.length)) return;
    rosterSignature = signature;
    host.replaceChildren();
    rosterCache.forEach((p, index) => {
      const row = document.createElement('div'); row.className = 'roster-row';
      const name = document.createElement('span'); name.textContent = `${index + 1}. ${p.id === ownPlayerId ? 'Sen' : (p.name || 'Avcı')}`;
      const stats = document.createElement('strong'); stats.textContent = `${Number(p.score) || 0} P · ${Number(p.bag) || 0} AV`;
      row.append(name, stats); host.append(row);
    });
  }

  function appendChatMessage(name, message, mine = false) {
    const host = $('chatMessages'); if (!host) return;
    const row = document.createElement('div'); row.className = `chat-line${mine ? ' mine' : ''}`;
    const label = document.createElement('b'); label.textContent = `${name}: `;
    const body = document.createElement('span'); body.textContent = String(message || '').slice(0, 100);
    row.append(label, body); host.append(row); chatLineCount++;
    while (host.children.length > 30) host.firstElementChild.remove();
    host.scrollTop = host.scrollHeight;
  }

  function sendChat() {
    const input = $('chatInput');
    const message = input?.value.trim().slice(0, 100);
    if (!message || !multiplayer) return;
    sendNetwork('chat', { text: message });
    input.value = '';
    input.blur();
  }

  function updateHud() {
    $('scoreLabel').textContent = String(player.score).padStart(4, '0');
    $('healthLabel').textContent = `${Math.max(0, Math.round(player.health))}%`;
    $('healthBar').style.width = `${Math.max(0, Math.min(100, player.health))}%`;
    $('playerCount').textContent = multiplayer ? `${remotePlayers.size + 1}/8` : 'SOLO';
    $('bagLabel').textContent = String(player.bag);
    $('ammoLabel').textContent = String(player.ammo).padStart(2, '0');
    $('reserveLabel').textContent = String(player.reserve).padStart(2, '0');
    const staminaBar = $('staminaBar');
    if (staminaBar) staminaBar.style.width = `${Math.max(0, Math.min(100, player.stamina))}%`;
    const stance = $('stanceLabel');
    if (stance) stance.textContent = player.crouch ? 'SESSİZ' : player.sprintEffective ? 'KOŞU' : 'YÜRÜYÜŞ';
    $('windLabel').textContent = `${wind.x >= 0 ? '↗' : '↖'} ${wind.strength.toFixed(1)} m/s`;
    const weatherLabel = $('weatherLabel'); if (weatherLabel) weatherLabel.textContent = weatherType === 'rain' ? 'YAĞMUR' : weatherType === 'mist' ? 'SİS' : 'AÇIK';
    $('compassLabel').textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((player.yaw * 180 / Math.PI) % 360) + 360) % 360 / 45) % 8];
    $('roomLabel').textContent = multiplayer ? roomCode : 'TEK OYUNCU';
    $('teamToggleBtn')?.classList.toggle('hidden', !multiplayer);
    $('chatToggleBtn')?.classList.toggle('hidden', !multiplayer);
  }

  function startGame(isOnline) {
    multiplayer = !!isOnline;
    if (!isOnline) { player.score = 0; player.bag = 0; player.health = 100; player.ammo = 5; player.reserve = 25; rosterCache = []; weatherType = 'clear'; sounds.setWeather('clear'); updateHud(); }
    active = true;
    missionStats = { deer: 0, boar: 0, clean: 0, complete: false }; updateMissionUI();
    player.health = 100; player.stamina = 100; player.crouch = false; player.sprint = false; player.sprintEffective = false;
    sounds.unlock();
    $('startScreen').classList.add('hidden');
    $('lobbyScreen').classList.add('hidden');
    $('pauseScreen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('objectiveText').textContent = multiplayer ? 'Ekibinle aynı sahadasın. Sesini ve rüzgârı yönet.' : 'İzleri takip et. Rüzgârı ve hayvan davranışlarını oku.';
    updateHud();
    if (multiplayer) updateTeamPanel(rosterCache.length ? rosterCache : [{ id: ownPlayerId, name: 'Sen', score: player.score, bag: player.bag }]);
    showToast(multiplayer ? `ODA ${roomCode} · EKİP SAHADA` : 'Kuzey Ormanı · Sefer başladı', 2800);
  }

  function openPause() {
    if (!active) return;
    active = false; sounds.footsteps(false);
    $('pauseScreen').classList.remove('hidden');
  }
  function resumeGame() { active = true; $('pauseScreen').classList.add('hidden'); }

  function disconnect() {
    if (socketHeartbeat) {
      clearInterval(socketHeartbeat);
      socketHeartbeat = null;
    }
    if (socket) {
      try { socket.close(); } catch (_) { /* no-op */ }
      socket = null;
    }
    multiplayer = false;
    ownPlayerId = null;
    rosterCache = [];
    $('teamRoster')?.replaceChildren();
    $('teamPanel')?.classList.add('hidden'); $('chatPanel')?.classList.add('hidden');
    rosterSignature = '';
    for (const [, r] of remotePlayers) scene.remove(r.group);
    remotePlayers.clear();
  }

  function connectRoom() {
    sounds.unlock(); // User gesture unlocks WebView audio before the async socket handshake.
    const address = $('serverAddress').value.trim();
    const room = $('roomCode').value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
    const name = $('playerName').value.trim().slice(0, 16) || 'Avcı';
    const status = $('connectStatus');
    if (!/^wss?:\/\//i.test(address)) { status.textContent = 'Adres ws:// veya wss:// ile başlamalı.'; return; }
    if (!room) { status.textContent = 'Bir oda kodu gir.'; return; }
    disconnect();
    roomCode = room;
    status.textContent = 'Sunucuya bağlanılıyor… Render ücretsiz planda uyuyor olabilir; ilk açılış 60 saniye sürebilir.';
    $('joinBtn').disabled = true;
    $('hostBtn').disabled = true;
    try {
      socket = new WebSocket(address);
      const connectingSocket = socket;
      const timeout = setTimeout(() => {
        if (connectingSocket.readyState !== WebSocket.OPEN) {
          status.textContent = 'Bağlantı zaman aşımına uğradı. Sunucu adresini kontrol et.';
          $('joinBtn').disabled = false; $('hostBtn').disabled = false;
          try { connectingSocket.close(); } catch (_) { /* no-op */ }
        }
      }, 120000);
      socket.addEventListener('open', () => {
        if (socket !== connectingSocket) { try { connectingSocket.close(); } catch (_) {} return; }
        clearTimeout(timeout);
        status.textContent = 'Odaya giriş yapılıyor…';
        socket.send(JSON.stringify({ type: 'join', room, name }));
        if (socketHeartbeat) clearInterval(socketHeartbeat);
        // Send a real WebSocket message (not only a protocol ping) so Render Free
        // sees incoming traffic while the player remains connected.
        socketHeartbeat = setInterval(() => {
          if (connectingSocket.readyState === WebSocket.OPEN) {
            try { connectingSocket.send(JSON.stringify({ type: 'ping' })); } catch (_) { /* closing */ }
          }
        }, 25000);
      });
      socket.addEventListener('message', (event) => {
        if (socket !== connectingSocket) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.type === 'pong') {
          return;
        } else if (msg.type === 'welcome') {
          ownPlayerId = msg.id;
          player.score = 0; player.bag = 0; player.health = Number(msg.health ?? 100);
          player.ammo = Number(msg.ammo?.current ?? 5); player.reserve = Number(msg.ammo?.reserve ?? 25);
          applySnapshot([...(msg.players || []), { id: ownPlayerId, name, score: 0, bag: 0 }]);
          syncWildlifeSnapshot(msg.animals || []);
          if (msg.wind) wind = msg.wind;
          if (msg.worldTime != null) worldTime = Number(msg.worldTime) || 0;
          if (msg.weather) { weatherType = msg.weather; sounds.setWeather(weatherType); }
          status.textContent = `Bağlandı · ${msg.count || 1} oyuncu odada`;
          $('joinBtn').disabled = false; $('hostBtn').disabled = false;
          startGame(true);
        } else if (msg.type === 'snapshot') {
          applySnapshot(msg.players || []);
          syncWildlifeSnapshot(msg.animals || []);
          if (msg.wind) wind = msg.wind;
          if (msg.day) player.day = msg.day;
          if (msg.worldTime != null) worldTime = Number(msg.worldTime) || worldTime;
          if (msg.weather) { weatherType = msg.weather; sounds.setWeather(weatherType); }
        } else if (msg.type === 'player_joined') {
          if (msg.player && msg.player.id !== ownPlayerId) {
            const p = msg.player; const r = addRemotePlayer(p.id, p.name);
            r.targetX = p.x || 0; r.targetZ = p.z || 0;
            showToast(`${p.name || 'Bir avcı'} ekibe katıldı`);
          }
        } else if (msg.type === 'player_moved') {
          const p = msg.player;
          if (p && p.id !== ownPlayerId) {
            const r = addRemotePlayer(p.id, p.name);
            r.targetX = Number(p.x) || 0; r.targetZ = Number(p.z) || 0; r.targetYaw = Number(p.yaw) || 0;
          }
        } else if (msg.type === 'player_left') {
          const r = remotePlayers.get(msg.id);
          if (r) { scene.remove(r.group); remotePlayers.delete(msg.id); showToast(`${msg.name || 'Bir avcı'} ayrıldı`); }
        } else if (msg.type === 'shot_fired') {
          const p = msg.player;
          if (p && p.id !== ownPlayerId) {
            const distance = Math.hypot(p.x - player.x, p.z - player.z);
            sounds.playAt('shot', distance, 0.44);
            showToast(`${p.name || 'Takım arkadaşın'} ateş etti`, 900);
          }
        } else if (msg.type === 'animal_down') {
          applyRemoteKill(msg.animalId, msg.player?.id === ownPlayerId ? 'Sen' : (msg.player?.name || 'Takım arkadaşın'));
        } else if (msg.type === 'shot_result') {
          player.ammo = Number(msg.ammo ?? player.ammo);
          player.reserve = Number(msg.reserve ?? player.reserve);
          if (msg.hit) {
            player.score = Number(msg.score ?? player.score); player.bag = Number(msg.bag ?? player.bag);
            registerHarvest(msg.kind, !!msg.clean);
            $('objectiveText').textContent = `${msg.kind === 'boar' ? 'Yaban domuzu' : 'Kızıl geyik'} · ${msg.distance} m · ${msg.clean ? 'TEMİZ ATIŞ' : 'İSABET'}`;
            $('hitMarker').classList.add('show'); setTimeout(() => $('hitMarker').classList.remove('show'), 420);
            showToast(`İSABET · ${msg.distance} m · +${msg.points} PUAN`, 2400);
          } else if (msg.ok) showToast('Atış boşa gitti · Rüzgâr ve mesafeyi değerlendir', 1600);
          else if (msg.reason === 'empty') showToast('Şarjör boş · DOLDUR', 1500);
          else if (msg.reason === 'bolt') showToast('Sürgü hazır değil · Biraz bekle', 900);
          updateHud();
        } else if (msg.type === 'player_hit') {
          player.health = Number(msg.health ?? Math.max(0, player.health - 20));
          $('damageFlash').classList.add('show');
          setTimeout(() => $('damageFlash').classList.remove('show'), 380);
          sounds.play('boar', 0.8, 0.85);
          showToast('YABAN DOMUZU SALDIRDI · GÜVENLİ MESAFEYE ÇEKİL', 2200);
          updateHud();
        } else if (msg.type === 'player_respawn') {
          player.x = 0; player.z = 7; player.health = 100;
          player.score = Number(msg.score ?? player.score);
          showToast('SAHAYA GERİ DÖNDÜN · 50 PUAN CEZA', 2500);
          updateHud();
        } else if (msg.type === 'ammo_update') {
          player.ammo = Number(msg.ammo ?? player.ammo); player.reserve = Number(msg.reserve ?? player.reserve); updateHud();
        } else if (msg.type === 'call_result') {
          showToast(msg.ok ? `${msg.attracted} geyik çağrıyı duydu` : (msg.message || 'Çağrı başarısız'), 1800);
        } else if (msg.type === 'weather') {
          if (msg.wind) wind = msg.wind; if (msg.day) player.day = msg.day;
          weatherType = msg.weather || weatherType; sounds.setWeather(weatherType); updateHud();
        } else if (msg.type === 'player_call') {
          if (msg.player?.id !== ownPlayerId) {
            const distance = Math.hypot((Number(msg.player?.x) || 0) - player.x, (Number(msg.player?.z) || 0) - player.z);
            sounds.playAt('deer', distance, 0.36);
            showToast(`${msg.player?.name || 'Bir avcı'} geyik çağrısı yaptı`, 1500);
          }
        } else if (msg.type === 'chat') {
          const chatName = msg.player?.name || 'Avcı';
          appendChatMessage(chatName, msg.text, msg.player?.id === ownPlayerId);
          showToast(`${chatName}: ${msg.text}`, 1800);
        } else if (msg.type === 'error') {
          status.textContent = msg.message || 'Sunucu hatası.';
          $('joinBtn').disabled = false; $('hostBtn').disabled = false;
          try { connectingSocket.close(1000, 'room rejected'); } catch (_) { /* closing */ }
        }
      });
      socket.addEventListener('close', () => {
        if (socket !== connectingSocket) return;
        clearTimeout(timeout);
        if (socket === connectingSocket && socketHeartbeat) {
          clearInterval(socketHeartbeat);
          socketHeartbeat = null;
        }
        $('joinBtn').disabled = false; $('hostBtn').disabled = false;
        const wasOnline = multiplayer;
        multiplayer = false;
        if (wasOnline) {
          for (const [, remote] of remotePlayers) scene.remove(remote.group);
          remotePlayers.clear(); rosterCache = []; rosterSignature = '';
          $('teamPanel')?.classList.add('hidden'); $('chatPanel')?.classList.add('hidden');
          updateHud();
          showToast('Sunucu bağlantısı kesildi · Sefer çevrimdışı devam ediyor', 3200);
        }
      });
      socket.addEventListener('error', () => {
        if (socket !== connectingSocket) return;
        clearTimeout(timeout);
        status.textContent = 'Bağlantı kurulamadı. Render sunucusu henüz uyanıyor olabilir; 1 dakika sonra yeniden dene.';
        $('joinBtn').disabled = false; $('hostBtn').disabled = false;
      });
    } catch (error) {
      status.textContent = `Bağlantı hatası: ${error.message}`;
      $('joinBtn').disabled = false; $('hostBtn').disabled = false;
    }
  }

  function sendNetwork(type, extra = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !multiplayer) return;
    try { socket.send(JSON.stringify({ type, ...extra })); } catch (_) { /* connection may close mid-frame */ }
  }

  function fire() {
    if (!active || reloading) return;
    const now = performance.now();
    if (now - lastShotTime < 560) return;
    lastShotTime = now;
    if (player.ammo <= 0) { showToast('Şarjör boş · DOLDUR tuşuna bas'); return; }
    player.ammo--;
    updateHud();
    sounds.play('shot', 0.86);
    weaponFx.flash.visible = true;
    weaponFx.flashLight.intensity = 4.2;
    weaponFx.weapon.position.z = -0.59;
    weaponFx.weapon.rotation.x = -0.15;
    fireTimer = 0.11;

    if (multiplayer) {
      sendNetwork('shoot');
      return;
    }

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const drift = Math.min(0.035, wind.strength * 0.0035);
    direction.x += wind.x * drift;
    direction.z += wind.z * drift;
    direction.normalize();
    const ray = new THREE.Raycaster(camera.position, direction, 0, 145);
    const hits = ray.intersectObjects(hitZones, false);
    let hitAnimal = null;
    if (hits.length) {
      const candidate = hits[0].object.userData.animal;
      if (candidate && candidate.alive) hitAnimal = candidate;
    }
    if (hitAnimal) {
      const distance = camera.position.distanceTo(hits[0].point);
      hitAnimal.alive = false;
      hitAnimal.deadAt = worldTime;
      const clean = aiming && distance >= 24 && distance <= 110;
      const points = Math.round((hitAnimal.kind === 'boar' ? 95 : 75) + Math.min(distance, 120) * 0.72 + (clean ? 65 : 0));
      player.score += points;
      player.bag++;
      registerHarvest(hitAnimal.kind, clean);
      $('objectiveText').textContent = `${hitAnimal.name} · ${distance.toFixed(0)} m · ${clean ? 'TEMİZ ATIŞ' : 'İSABET'}`;
      $('hitMarker').classList.add('show');
      setTimeout(() => $('hitMarker').classList.remove('show'), 420);
      showToast(`${hitAnimal.name} · ${distance.toFixed(0)} m · +${points} PUAN`, 2600);
      updateHud();
    } else {
      showToast('Atış boşa gitti · Mesafeyi ve rüzgârı değerlendir', 1700);
      alarmLocalWildlife(92);
    }
  }

  function alarmLocalWildlife(radius = 92) {
    for (const a of animals) {
      if (!a.alive) continue;
      const dx = a.root.position.x - player.x, dz = a.root.position.z - player.z;
      if (Math.hypot(dx, dz) < radius) {
        a.dir.set(dx, 0, dz).normalize(); a.speed = a.kind === 'boar' ? 7.4 : 9.0;
        a.state = 'flee'; a.alertUntil = worldTime + 7;
      }
    }
  }

  function reload() {
    if (!active || reloading || player.ammo === 5 || player.reserve <= 0) return;
    reloading = true;
    sounds.play('bolt', 0.55);
    showToast('Sürgü kontrolü ve şarjör değişimi…', 1100);
    if (multiplayer) {
      sendNetwork('reload');
      // The authoritative server sends ammo_update; don't apply a second local reload.
      setTimeout(() => { reloading = false; }, 1550);
      return;
    }
    setTimeout(() => {
      const needed = 5 - player.ammo;
      const loaded = Math.min(needed, player.reserve);
      player.ammo += loaded;
      player.reserve -= loaded;
      reloading = false;
      updateHud();
      showToast('Tüfek hazır. Sessiz kal ve iz sür.', 1400);
    }, 1550);
  }

  function toggleCrouch() {
    if (!active) return;
    player.crouch = !player.crouch;
    if (player.crouch) player.sprint = false;
    $('crouchBtn')?.classList.toggle('selected', player.crouch);
    $('sprintBtn')?.classList.toggle('selected', player.sprint);
    showToast(player.crouch ? 'Çömeldin · Daha sessiz hareket ediyorsun' : 'Ayağa kalktın', 1300);
    updateHud();
  }

  function toggleSprint() {
    if (!active) return;
    player.sprint = !player.sprint;
    if (player.sprint) player.crouch = false;
    $('sprintBtn')?.classList.toggle('selected', player.sprint);
    $('crouchBtn')?.classList.toggle('selected', player.crouch);
    showToast(player.sprint ? 'Koşu · Hayvanlar seni daha uzaktan duyabilir' : 'Normal yürüyüş', 1400);
    updateHud();
  }

  function toggleTracking() {
    tracking = !tracking;
    $('trackBtn')?.classList.toggle('selected', tracking);
    for (const animal of animals) if (animal.trackGroup) animal.trackGroup.visible = tracking && animal.alive;
    showToast(tracking ? 'İz takibi açık · Yerdeki izleri takip et' : 'İz takibi kapalı', 1500);
  }

  function callWildlife() {
    if (!active) return;
    sounds.play('deer', 0.7);
    if (multiplayer) {
      sendNetwork('call');
    } else {
      let attracted = 0;
      for (const animal of animals) {
        if (!animal.alive || animal.kind !== 'deer') continue;
        const distance = Math.hypot(animal.root.position.x - player.x, animal.root.position.z - player.z);
        if (distance < 64 && animal.state !== 'flee') {
          animal.state = 'approach'; animal.callUntil = worldTime + 9;
          animal.targetX = player.x; animal.targetZ = player.z; attracted++;
        }
      }
      showToast(`${attracted} geyik çağrıyı duydu`, 1700);
    }
  }

  function syncWildlifeSnapshot(list) {
    const known = new Set();
    for (const data of list || []) {
      if (!data || !data.id) continue;
      known.add(data.id);
      let animal = animals.find((a) => a.id === data.id);
      if (!animal && !data.alive) continue; // Do not recreate a corpse removed after its fall animation.
      if (!animal) {
        createAnimal(Number(data.x) || 0, Number(data.z) || 0, data.kind === 'boar' ? 'boar' : 'deer', data.id);
        animal = animals[animals.length - 1];
      }
      animal.targetX = Number(data.x) || 0;
      animal.targetZ = Number(data.z) || 0;
      animal.targetYaw = Number(data.yaw) || 0;
      animal.state = data.state || animal.state;
      if (!data.alive && animal.alive) {
        animal.alive = false; animal.deadAt = worldTime;
        if (animal.trackGroup) animal.trackGroup.visible = false;
      } else if (data.alive && !animal.alive) {
        animal.alive = true; animal.removeReady = false; animal.root.rotation.set(0, 0, 0);
      }
    }
    for (const animal of animals) {
      if (animal.id.startsWith('wildlife-') && !known.has(animal.id)) continue;
    }
  }

  function movePlayer(dt) {
    const keyForward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const keySide = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let forward = keyForward - joy.y;
    let side = keySide + joy.x;
    const length = Math.hypot(forward, side);
    if (length > 1) { forward /= length; side /= length; }
    const sprintRequested = player.sprint || !!(keys.ShiftLeft || keys.ShiftRight);
    const sprinting = sprintRequested && player.stamina > 2 && !player.crouch && !aiming && length > 0.06;
    const speed = sprinting ? 7.0 : (player.crouch ? 1.9 : (aiming ? 2.5 : 4.1));
    player.speed = length > 0.06 ? speed : 0;
    if (sprinting && length > 0.06) player.stamina = Math.max(0, player.stamina - dt * 18);
    else player.stamina = Math.min(100, player.stamina + dt * (player.crouch ? 7 : 12));
    player.noise = length < 0.06 ? 0 : sprinting ? 1 : player.crouch ? 0.16 : 0.55;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    player.x += (sin * forward + cos * side) * speed * dt;
    player.z += (cos * forward - sin * side) * speed * dt;
    player.x = THREE.MathUtils.clamp(player.x, -155, 155);
    player.z = THREE.MathUtils.clamp(player.z, -155, 155);
    const isMoving = length > 0.06;
    sounds.footsteps(isMoving, sprinting);
    camera.position.set(player.x, terrainHeight(player.x, player.z) + (player.crouch ? 1.08 : 1.67), player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw + Math.PI;
    camera.rotation.x = player.pitch;
    const stanceLabel = $('stanceLabel');
    if (stanceLabel) stanceLabel.textContent = player.crouch ? 'SESSİZ' : sprinting ? 'KOŞU' : 'YÜRÜYÜŞ';
    if (sprinting !== player.sprintEffective) player.sprintEffective = sprinting;
    const bob = isMoving ? (sprinting ? 0.030 : player.crouch ? 0.008 : 0.015) : (aiming ? 0.0025 : 0.004);
    const phase = worldTime * (sprinting ? 13 : 7);
    weaponFx.weapon.position.x = 0.42 + Math.cos(phase * 0.5) * bob * 0.65;
    weaponFx.weapon.position.y = -0.37 + Math.abs(Math.sin(phase)) * bob;
  }

  function updateAnimals(dt) {
    for (const a of animals) {
      if (!a.alive) {
        const fall = Math.min(1, (worldTime - a.deadAt) * 1.35);
        a.root.rotation.z = -fall * 1.1;
        a.root.position.y = terrainHeight(a.root.position.x, a.root.position.z) + 0.05;
        if (fall >= 1 && worldTime - a.deadAt > 4.5) {
          scene.remove(a.root);
          if (a.trackGroup) scene.remove(a.trackGroup);
          const index = hitZones.indexOf(a.hit);
          if (index >= 0) hitZones.splice(index, 1);
          a.removeReady = true;
        }
        continue;
      }
      if (multiplayer) {
        a.root.position.x += (a.targetX - a.root.position.x) * Math.min(1, dt * 8);
        a.root.position.z += (a.targetZ - a.root.position.z) * Math.min(1, dt * 8);
        a.root.position.y = terrainHeight(a.root.position.x, a.root.position.z);
        a.root.rotation.y += (a.targetYaw - a.root.rotation.y) * Math.min(1, dt * 8);
      } else {
        const dx = a.root.position.x - player.x;
        const dz = a.root.position.z - player.z;
        const distance = Math.hypot(dx, dz);
        const detect = player.sprintEffective ? 36 : player.crouch ? 5.5 : (player.speed > 0 ? 19 : 11);
        if (distance < detect && a.state !== 'flee' && a.state !== 'approach') {
          if (a.kind === 'boar' && distance < 12 && !player.crouch) {
            a.state = 'charge'; a.dir.set(player.x - a.root.position.x, 0, player.z - a.root.position.z).normalize(); a.speed = 5.9;
          } else {
            a.state = 'alert'; a.alertUntil = worldTime + 1.0;
          }
        }
        if (a.state === 'alert' && worldTime >= (a.alertUntil || 0)) {
          a.dir.set(dx, 0, dz).normalize(); a.speed = a.kind === 'boar' ? 6.5 : 8.5; a.state = 'flee'; a.alertUntil = worldTime + 7;
        }
        if (a.state === 'approach') {
          const tx = a.targetX - a.root.position.x, tz = a.targetZ - a.root.position.z;
          if (Math.hypot(tx, tz) < 8 || worldTime > a.callUntil) a.state = 'graze';
          else { a.dir.set(tx, 0, tz).normalize(); a.speed = 1.55; }
        }
        if (a.state === 'charge') {
          a.dir.set(player.x - a.root.position.x, 0, player.z - a.root.position.z).normalize();
          a.speed = 6.6;
          if (!multiplayer && distance < 2.3 && worldTime > (a.lastAttackAt || 0)) {
            player.health = Math.max(0, player.health - 18);
            a.lastAttackAt = worldTime + 2.1;
            $('damageFlash').classList.add('show');
            setTimeout(() => $('damageFlash').classList.remove('show'), 380);
            sounds.play('boar', 0.8, 0.85);
            if (player.health <= 0) {
              player.x = 0; player.z = 7; player.health = 100; player.score = Math.max(0, player.score - 50);
              showToast('SAHAYA GERİ DÖNDÜN · 50 PUAN CEZA', 2400);
            } else showToast('YABAN DOMUZU SALDIRDI · UZAKLAŞ', 1700);
            updateHud();
          }
        }
        a.turn -= dt;
        if (a.turn <= 0 && (a.state === 'graze' || a.state === 'wander')) {
          a.dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.5).normalize();
          a.turn = 2.5 + Math.random() * 4;
          a.speed = 0.38 + Math.random() * 0.8;
          a.state = Math.random() < 0.55 ? 'graze' : 'wander';
        }
        a.root.position.x += a.dir.x * a.speed * dt;
        a.root.position.z += a.dir.z * a.speed * dt;
        a.root.position.x = THREE.MathUtils.clamp(a.root.position.x, -155, 155);
        a.root.position.z = THREE.MathUtils.clamp(a.root.position.z, -155, 155);
        a.root.position.y = terrainHeight(a.root.position.x, a.root.position.z);
        a.root.rotation.y = Math.atan2(a.dir.x, a.dir.z);
        if (a.state === 'flee' && worldTime > (a.alertUntil || 0)) a.state = 'wander';
      }
      a.walkPhase += dt * (a.speed > 2 ? 12 : 4);
      a.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(a.walkPhase + (i % 2) * Math.PI) * (a.speed > 2 ? 0.72 : 0.22); });
      if (a.trackGroup) {
        a.trackGroup.visible = tracking && a.alive && Math.hypot(a.root.position.x - player.x, a.root.position.z - player.z) < 82;
        a.trackGroup.position.set(a.root.position.x, terrainHeight(a.root.position.x, a.root.position.z) + 0.02, a.root.position.z);
        a.trackGroup.rotation.y = a.root.rotation.y + Math.PI;
      }
      if (worldTime > a.nextCallAt && Math.hypot(a.root.position.x - player.x, a.root.position.z - player.z) < 88) {
        sounds.playAt(a.kind === 'boar' ? 'boar' : 'deer', Math.hypot(a.root.position.x - player.x, a.root.position.z - player.z), 0.18);
        a.nextCallAt = worldTime + 24 + Math.random() * 36;
      }
    }
    for (let i = animals.length - 1; i >= 0; i--) {
      if (animals[i].removeReady) animals.splice(i, 1);
    }
    if (!multiplayer && animals.filter(a => a.alive).length < 3 && animals.length < 14) {
      const angle = Math.random() * Math.PI * 2; const radius = 65 + Math.random() * 35;
      createAnimal(player.x + Math.cos(angle) * radius, player.z + Math.sin(angle) * radius, Math.random() < 0.25 ? 'boar' : 'deer');
    }
  }

  function toggleAim() {
    if (!active) return;
    aiming = !aiming;
    if (aiming) player.sprint = false;
    camera.fov = aiming ? 43 : 72;
    camera.updateProjectionMatrix();
    $('aimBtn').style.background = aiming ? '#b3dc7a' : '#18251bc9';
    $('aimBtn').style.color = aiming ? '#14200f' : '#f5f6ed';
    $('aimBtn').classList.toggle('selected', aiming);
    $('rangeLabel')?.classList.toggle('hidden', !aiming);
  }

  function updateRangefinder() {
    const label = $('rangeLabel');
    if (!label) return;
    if (!aiming || !active) { label.classList.add('hidden'); return; }
    const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
    const ray = new THREE.Raycaster(camera.position, direction, 0, 160);
    const hits = ray.intersectObjects(hitZones, false);
    const target = hits.find((hit) => hit.object.userData.animal?.alive);
    if (!target) { label.textContent = 'HEDEF YOK'; label.classList.remove('hidden'); return; }
    const animal = target.object.userData.animal;
    const distance = camera.position.distanceTo(target.point);
    label.textContent = `${animal.name.toLocaleUpperCase('tr-TR')} · ${distance.toFixed(0)} M`;
    label.classList.remove('hidden');
  }

  function updateRemotePlayers(dt) {
    for (const [, r] of remotePlayers) {
      r.group.position.x += (r.targetX - r.group.position.x) * Math.min(1, dt * 9);
      r.group.position.z += (r.targetZ - r.group.position.z) * Math.min(1, dt * 9);
      r.group.position.y = terrainHeight(r.group.position.x, r.group.position.z);
      r.group.scale.y += ((r.crouch ? 0.72 : 1) - r.group.scale.y) * Math.min(1, dt * 8);
      r.group.rotation.y += (r.targetYaw - r.group.rotation.y) * Math.min(1, dt * 8);
    }
  }

  function updateNetwork(dt) {
    if (!multiplayer || !socket || socket.readyState !== WebSocket.OPEN) return;
    lastNetSend += dt;
    if (lastNetSend < 0.10) return;
    lastNetSend = 0;
    const state = `${player.x.toFixed(1)}|${player.z.toFixed(1)}|${player.yaw.toFixed(2)}|${player.pitch.toFixed(2)}|${player.crouch}|${!!player.sprintEffective}|${aiming}`;
    if (state === lastNetState && performance.now() - lastStateSend < 950) return;
    lastStateSend = performance.now();
    lastNetState = state;
    sendNetwork('move', { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, crouch: player.crouch, sprint: !!player.sprintEffective, aiming });
  }

  function drawMinimap() {
    const map = $('minimap'); const ctx = map.getContext('2d');
    ctx.clearRect(0, 0, map.width, map.height);
    ctx.fillStyle = 'rgba(20,34,20,.84)'; ctx.fillRect(0, 0, map.width, map.height);
    ctx.strokeStyle = 'rgba(196,220,165,.16)'; ctx.lineWidth = 1;
    for (let x = 0; x <= map.width; x += 26) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, map.height); ctx.stroke(); }
    for (let y = 0; y <= map.height; y += 23) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(map.width, y); ctx.stroke(); }
    const centerX = map.width / 2, centerY = map.height / 2;
    ctx.fillStyle = '#b3dc7a'; ctx.beginPath(); ctx.arc(centerX, centerY, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b3dc7a'; ctx.beginPath(); ctx.moveTo(centerX, centerY); ctx.lineTo(centerX + Math.sin(player.yaw) * 12, centerY - Math.cos(player.yaw) * 12); ctx.stroke();
    for (const a of animals) {
      if (!a.alive) continue;
      const dx = a.root.position.x - player.x, dz = a.root.position.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (!tracking && distance > 18) continue;
      const mx = centerX + dx * 0.75, my = centerY + dz * 0.52;
      if (mx < 2 || mx > map.width - 2 || my < 2 || my > map.height - 2) continue;
      ctx.fillStyle = '#e7d0a5'; ctx.beginPath(); ctx.arc(mx, my, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    for (const [, r] of remotePlayers) {
      const mx = centerX + (r.group.position.x - player.x) * 0.75;
      const my = centerY + (r.group.position.z - player.z) * 0.52;
      ctx.fillStyle = '#70b9ea'; ctx.fillRect(mx - 2, my - 2, 4, 4);
    }
  }

  function updateEnvironment(dt) {
    worldTime += dt;
    const cycle = ((worldTime / 420) + 0.18) % 1;
    const angle = cycle * Math.PI * 2 - Math.PI / 2;
    const sunHeight = Math.sin(angle);
    const daylight = THREE.MathUtils.clamp((sunHeight + 0.16) / 0.9, 0, 1);
    const twilight = 1 - daylight;
    sun.position.set(Math.cos(angle) * 70, Math.max(-18, sunHeight * 92), Math.sin(angle) * 70);
    sun.intensity = 0.12 + daylight * 2.18;
    sun.color.copy(sunNight).lerp(sunDay, daylight);
    sun.castShadow = daylight > 0.18;
    moon.position.set(-sun.position.x, 38, -sun.position.z);
    moon.intensity = 0.08 + twilight * 0.35;
    hemi.intensity = 0.36 + daylight * 1.12;
    currentSky.copy(skyNight).lerp(skyDay, Math.max(0.16, daylight));
    scene.background.copy(currentSky);
    scene.fog.color.copy(currentSky);
    scene.fog.density = weatherType === 'mist' ? 0.013 : weatherType === 'rain' ? 0.0085 : 0.0064;
    sounds.setWeather(weatherType);

    if (!multiplayer && Math.floor(worldTime / 150) !== player.day - 1) {
      player.day = Math.floor(worldTime / 150) + 1;
      wind.x = (Math.random() - 0.5) * 2;
      wind.z = (Math.random() - 0.5) * 2;
      wind.strength = 1 + Math.random() * 4.2;
      updateHud();
    }
    if (!multiplayer && worldTime - lastAnimalCall > 28 + Math.random() * 30) {
      sounds.play('bird', 0.22, 0.85 + Math.random() * 0.35); lastAnimalCall = worldTime;
    }
    const time = $('timeLabel');
    if (time) {
      const minutes = Math.floor(cycle * 24 * 60);
      time.textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }
    updateRain(dt);
  }

  const rainCount = 420;
  const rainPositions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 46;
    rainPositions[i * 3 + 1] = Math.random() * 30;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 46;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainPoints = new THREE.Points(rainGeometry, new THREE.PointsMaterial({ color: 0xcbd8df, size: 0.075, transparent: true, opacity: 0.4, depthWrite: false }));
  rainPoints.visible = false; scene.add(rainPoints);
  function updateRain(dt) {
    const raining = weatherType === 'rain';
    rainPoints.visible = raining;
    if (!raining) return;
    rainPoints.position.set(player.x, terrainHeight(player.x, player.z), player.z);
    for (let i = 0; i < rainCount; i++) {
      const k = i * 3;
      rainPositions[k + 1] -= dt * (18 + (i % 9) * 1.8);
      rainPositions[k] += wind.x * wind.strength * dt * 0.38;
      rainPositions[k + 2] += wind.z * wind.strength * dt * 0.38;
      if (rainPositions[k + 1] < 0) {
        rainPositions[k] = (Math.random() - 0.5) * 46;
        rainPositions[k + 1] = 25 + Math.random() * 10;
        rainPositions[k + 2] = (Math.random() - 0.5) * 46;
      }
    }
    rainGeometry.attributes.position.needsUpdate = true;
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (active) {
      movePlayer(dt);
      updateAnimals(dt);
      updateRemotePlayers(dt);
      updateNetwork(dt);
      updateEnvironment(dt);
      if (performance.now() - lastRangeUpdate > 160) { updateRangefinder(); lastRangeUpdate = performance.now(); }
      if (performance.now() - lastMinimap > 220) { drawMinimap(); lastMinimap = performance.now(); }
    }
    if (fireTimer > 0) {
      fireTimer -= dt;
      if (fireTimer <= 0) {
        weaponFx.flash.visible = false;
        weaponFx.flashLight.intensity = 0;
        weaponFx.weapon.position.z = -0.64;
        weaponFx.weapon.rotation.x = -0.05;
      }
    }
    renderer.render(scene, camera);
  }
  animate();

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.55));
  }
  addEventListener('resize', resize);

  addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code === 'KeyR') reload();
    if (event.code === 'KeyF') toggleAim();
    if (event.code === 'KeyC') toggleCrouch();
    if (event.code === 'ShiftLeft' && !player.crouch) player.sprint = true;
    if (event.code === 'KeyT') toggleTracking();
    if (event.code === 'KeyV') callWildlife();
    if (event.code === 'Escape') openPause();
    if (event.code === 'Space') { event.preventDefault(); fire(); }
  });
  addEventListener('keyup', (event) => { keys[event.code] = false; if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') player.sprint = false; });

  canvas.addEventListener('pointerdown', (event) => {
    if (!active || event.button > 0) return;
    lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* unsupported */ }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!lookPointer || lookPointer.id !== event.pointerId || !active) return;
    const dx = event.clientX - lookPointer.x;
    const dy = event.clientY - lookPointer.y;
    const sensitivity = event.pointerType === 'mouse' ? 0.0024 : 0.0042;
    player.yaw -= dx * sensitivity;
    player.pitch = THREE.MathUtils.clamp(player.pitch - dy * sensitivity, -1.08, 0.78);
    lookPointer.x = event.clientX; lookPointer.y = event.clientY;
  });
  const endLook = (event) => { if (lookPointer && lookPointer.id === event.pointerId) lookPointer = null; };
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);

  const stickBase = $('stickBase'); const stickKnob = $('stickKnob');
  stickBase.addEventListener('pointerdown', (event) => {
    if (!active) return;
    joystickPointer = event.pointerId;
    try { stickBase.setPointerCapture(event.pointerId); } catch (_) { /* unsupported */ }
    updateStick(event);
  });
  stickBase.addEventListener('pointermove', (event) => { if (joystickPointer === event.pointerId) updateStick(event); });
  function updateStick(event) {
    const rect = stickBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = event.clientX - cx, dy = event.clientY - cy;
    const max = rect.width * 0.31; const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joy.x = dx / max; joy.y = dy / max;
    stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function resetStick(event) {
    if (joystickPointer !== event.pointerId) return;
    joystickPointer = null; joy = { x: 0, y: 0 }; stickKnob.style.transform = 'translate(0,0)';
  }
  stickBase.addEventListener('pointerup', resetStick);
  stickBase.addEventListener('pointercancel', resetStick);

  $('soloBtn').addEventListener('click', () => startGame(false));
  $('multiBtn').addEventListener('click', () => $('lobbyScreen').classList.remove('hidden'));
  $('backLobbyBtn').addEventListener('click', () => $('lobbyScreen').classList.add('hidden'));
  $('joinBtn').addEventListener('click', connectRoom);
  $('hostBtn').addEventListener('click', () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = ''; for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    $('roomCode').value = code;
    connectRoom();
  });
  $('fireBtn').addEventListener('pointerdown', (event) => { event.preventDefault(); fire(); });
  $('reloadBtn').addEventListener('pointerdown', (event) => { event.preventDefault(); reload(); });
  $('aimBtn').addEventListener('pointerdown', (event) => { event.preventDefault(); toggleAim(); });
  $('crouchBtn')?.addEventListener('pointerdown', (event) => { event.preventDefault(); toggleCrouch(); });
  $('sprintBtn')?.addEventListener('pointerdown', (event) => { event.preventDefault(); toggleSprint(); });
  $('callBtn')?.addEventListener('pointerdown', (event) => { event.preventDefault(); callWildlife(); });
  $('trackBtn')?.addEventListener('click', toggleTracking);
  $('teamToggleBtn')?.addEventListener('click', () => {
    $('teamPanel')?.classList.toggle('hidden');
    if (!$('teamPanel')?.classList.contains('hidden')) updateTeamPanel(rosterCache);
  });
  $('chatToggleBtn')?.addEventListener('click', () => $('chatPanel')?.classList.toggle('hidden'));
  $('chatSendBtn')?.addEventListener('click', sendChat);
  $('chatInput')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); sendChat(); } });
  $('soundBtn')?.addEventListener('click', () => { const state = sounds.toggleMute(); $('soundBtn').textContent = state ? '♫̸' : '♫'; $('soundBtn').classList.toggle('muted', state); });
  $('pauseBtn').addEventListener('click', openPause);
  $('resumeBtn').addEventListener('click', resumeGame);
  $('exitBtn').addEventListener('click', () => {
    active = false; disconnect(); sounds.stop(); aiming = false; camera.fov = 72; camera.updateProjectionMatrix();
    $('hud').classList.add('hidden'); $('pauseScreen').classList.add('hidden'); $('startScreen').classList.remove('hidden');
  });

  updateHud();
}
