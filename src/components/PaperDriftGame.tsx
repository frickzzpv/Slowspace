'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import * as Tone from 'tone'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Joystick } from 'react-joystick-component';
import { useMobile } from '@/hooks/use-mobile';

interface GameStats {
  score: number
  distance: number
  combo: number
  gravityState: 'up' | 'down'
}

interface PaperPlane {
  mesh: THREE.Mesh
  body: CANNON.Body
}

interface DynamicObstacle {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  initialPosition: THREE.Vector3;
  dynamicType?: string;
}

interface Room {
  mesh: THREE.Group
  bodies: CANNON.Body[]
  dynamicObstacles: DynamicObstacle[]
  position: number
  type: string
}

interface CollectibleRing {
  mesh: THREE.Mesh
  body: CANNON.Body
  collected: boolean
}

interface PowerUp {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  type: 'shield';
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
}

export default function PaperDriftGame() {
  const isMobile = useMobile();
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gameStarted, setGameStarted] = useState(false)
  const [isGameOver, setIsGameOver] = useState(false)
  const [highScore, setHighScore] = useState(0);
  const [planeColor, setPlaneColor] = useState(0xffffff);
  const [hasShield, setHasShield] = useState(false);
  const [isInvulnerable, setIsInvulnerable] = useState(false);
  const [textures, setTextures] = useState<{ [key: string]: THREE.Texture | null }>({
    wall: null,
    obstacle: null,
  });
  const [gameStats, setGameStats] = useState<GameStats>({
    score: 0,
    distance: 0,
    combo: 0,
    gravityState: 'down'
  })

  // Game state refs
  const gameRefs = useRef({
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    renderer: null as THREE.WebGLRenderer | null,
    world: null as CANNON.World | null,
    effectComposer: null as EffectComposer | null,
    paperPlane: null as PaperPlane | null,
    gravityDirection: 1, // 1 for down, -1 for up
    gravityTransition: 0, // 0-1 for smooth transition
    isTransitioning: false,
    keys: {
      left: false,
      right: false
    },
    rooms: [] as Room[],
    collectibles: [] as CollectibleRing[],
    powerUps: [] as PowerUp[],
    nextRoomPosition: 0,
    rng: null as (() => number) | null,
    roomTemplates: [] as any[],
    // Object pools for performance
    meshPool: [] as THREE.Mesh[],
    geometryPool: [] as THREE.BufferGeometry[],
    materialPool: [] as THREE.Material[],
    bodyPool: [] as CANNON.Body[],
    particles: [] as Particle[],
    lastFrameTime: 0,
    frameCount: 0,
    fps: 0,
    gameLoopId: null as number | null,
    sounds: {
      flip: null as Tone.Synth | null,
      collect: null as Tone.Synth | null,
      crash: null as Tone.NoiseSynth | null,
      music: null as Tone.Pattern | null,
    }
  })

  const createParticles = useCallback((position: THREE.Vector3, count: number, color: THREE.ColorRepresentation) => {
    const refs = gameRefs.current;
    if (!refs.scene) return;

    for (let i = 0; i < count; i++) {
      const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2,
        transparent: true,
        opacity: 1
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      );

      refs.particles.push({ mesh, velocity, lifetime: 1 });
      refs.scene.add(mesh);
    }
  }, []);

  const handleGameOver = useCallback(() => {
    if (isInvulnerable) return;

    if (hasShield) {
      setHasShield(false);
      setIsInvulnerable(true);
      // Play shield break sound?
      setTimeout(() => setIsInvulnerable(false), 2000); // 2 seconds of invulnerability
      return;
    }

    if (gameRefs.current.sounds.crash) gameRefs.current.sounds.crash.triggerAttackRelease("8n");
    if (gameRefs.current.paperPlane) {
      createParticles(gameRefs.current.paperPlane.mesh.position, 20, 0xffffff);
    }
    setIsGameOver(true)
    const storedHighScore = localStorage.getItem('paperDriftHighScore') || '0';
    if (gameStats.score > parseInt(storedHighScore)) {
      localStorage.setItem('paperDriftHighScore', gameStats.score.toString());
      setHighScore(gameStats.score);
    }
  }, [gameStats.score, createParticles, hasShield, isInvulnerable])

  useEffect(() => {
    const storedHighScore = localStorage.getItem('paperDriftHighScore') || '0';
    setHighScore(parseInt(storedHighScore));
  }, []);

  const generateRandomNumber = useCallback((min: number, max: number) => {
    return Math.random() * (max - min) + min
  }, [])

  // Object pooling functions for performance
  const getPooledGeometry = useCallback((type: string, ...params: any[]) => {
    const refs = gameRefs.current
    for (let i = 0; i < refs.geometryPool.length; i++) {
      const geom = refs.geometryPool[i]
      if (!geom.userData.inUse) {
        geom.userData.inUse = true
        return geom
      }
    }

    // Create new geometry if none available in pool
    let newGeometry: THREE.BufferGeometry
    switch (type) {
      case 'plane':
        newGeometry = new THREE.PlaneGeometry(...params)
        break
      case 'box':
        newGeometry = new THREE.BoxGeometry(...params)
        break
      case 'torus':
        newGeometry = new THREE.TorusGeometry(...params)
        break
      case 'cone':
        newGeometry = new THREE.ConeGeometry(...params)
        break
      default:
        newGeometry = new THREE.BoxGeometry(...params)
    }
    newGeometry.userData = { inUse: true }
    refs.geometryPool.push(newGeometry)
    return newGeometry
  }, [])

  const releaseGeometry = useCallback((geometry: THREE.BufferGeometry) => {
    geometry.userData.inUse = false
  }, [])

  const getPooledMaterial = useCallback((color: number, transparent = false, opacity = 1) => {
    const refs = gameRefs.current
    for (let i = 0; i < refs.materialPool.length; i++) {
      const mat = refs.materialPool[i]
      if (!mat.userData.inUse &&
          (mat as THREE.MeshStandardMaterial).color.getHex() === color &&
          mat.transparent === transparent &&
          mat.opacity === opacity) {
        mat.userData.inUse = true
        return mat
      }
    }

    // Create new material if none available
    const newMaterial = new THREE.MeshStandardMaterial({
      color,
      transparent,
      opacity,
      roughness: 0.8,
      metalness: 0.2
    })
    newMaterial.userData = { inUse: true }
    refs.materialPool.push(newMaterial)
    return newMaterial
  }, [])

  const releaseMaterial = useCallback((material: THREE.Material) => {
    material.userData.inUse = false
  }, [])

  const createRoomTemplate = useCallback((type: string) => {
    const templates = {
      office: {
        width: 20,
        height: 20,
        depth: 30,
        color: 0xF5F5DC,
        obstacles: [
          { type: 'desk', position: [0, 0, 0], size: [3, 1, 2] },
          { type: 'shelf', position: [-8, 0, -5], size: [1, 6, 3] },
          { type: 'shelf', position: [8, 0, -5], size: [1, 6, 3] }
        ]
      },
      warehouse: {
        width: 25,
        height: 25,
        depth: 40,
        color: 0xD3D3D3,
        obstacles: [
          { type: 'crate', position: [-6, 0, -10], size: [2, 2, 2] },
          { type: 'crate', position: [6, 0, -10], size: [2, 2, 2] },
          { type: 'crate', position: [0, 0, -15], size: [3, 3, 3] },
          { type: 'sliding_door', position: [0, 0, -25], size: [8, 8, 0.5], isDynamic: true }
        ]
      },
      lab: {
        width: 18,
        height: 18,
        depth: 25,
        color: 0xE6E6FA,
        obstacles: [
          { type: 'table', position: [0, 0, -5], size: [4, 1, 2] },
          { type: 'machine', position: [-7, 0, -10], size: [2, 4, 2] },
          { type: 'machine', position: [7, 0, -10], size: [2, 4, 2] }
        ]
      },
      library: {
        width: 22,
        height: 22,
        depth: 35,
        color: 0xD2B48C,
        obstacles: [
          { type: 'bookshelf', position: [-9, 0, -10], size: [2, 8, 4] },
          { type: 'bookshelf', position: [9, 0, -10], size: [2, 8, 4] },
          { type: 'reading_table', position: [0, -3, -15], size: [6, 1, 3] }
        ]
      },
      kitchen: {
        width: 20,
        height: 20,
        depth: 30,
        color: 0xF5F5F5,
        obstacles: [
          { type: 'countertop', position: [-8, -2, -10], size: [4, 2, 15] },
          { type: 'kitchen_island', position: [0, -2, 0], size: [6, 2, 6] },
          { type: 'spinning_fan', position: [0, 8, -20], size: [10, 0.5, 1], isDynamic: true, dynamicType: 'fan' }
        ]
      }
    }

    return templates[type as keyof typeof templates] || templates.office
  }, [])

  const createRoom = useCallback((position: number, type: string = 'office') => {
    const refs = gameRefs.current
    if (!refs.scene || !refs.world) return null

    const template = createRoomTemplate(type)
    const roomGroup = new THREE.Group()
    const bodies: CANNON.Body[] = []
    const dynamicObstacles: DynamicObstacle[] = []

    // Create floor
    const floorGeometry = new THREE.PlaneGeometry(template.width, template.depth)
    const floorMaterial = new THREE.MeshStandardMaterial({ map: textures.wall, roughness: 0.9, metalness: 0.1 })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -template.height / 2
    floor.position.z = position
    floor.receiveShadow = true
    roomGroup.add(floor)

    const floorShape = new CANNON.Box(new CANNON.Vec3(template.width / 2, 0.1, template.depth / 2))
    const floorBody = new CANNON.Body({
      mass: 0,
      shape: floorShape,
      position: new CANNON.Vec3(0, -template.height / 2, position)
    })
    refs.world.addBody(floorBody)
    bodies.push(floorBody)

    // Create ceiling
    const ceilingGeometry = new THREE.PlaneGeometry(template.width, template.depth)
    const ceilingMaterial = new THREE.MeshStandardMaterial({ map: textures.wall, roughness: 0.9, metalness: 0.1 })
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial)
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.y = template.height / 2
    ceiling.position.z = position
    ceiling.receiveShadow = true
    roomGroup.add(ceiling)

    const ceilingShape = new CANNON.Box(new CANNON.Vec3(template.width / 2, 0.1, template.depth / 2))
    const ceilingBody = new CANNON.Body({
      mass: 0,
      shape: ceilingShape,
      position: new CANNON.Vec3(0, template.height / 2, position)
    })
    refs.world.addBody(ceilingBody)
    bodies.push(ceilingBody)

    // Create walls
    const wallMaterial = new THREE.MeshStandardMaterial({ map: textures.wall, roughness: 0.9, metalness: 0.1 })

    // Left wall
    const leftWallGeometry = new THREE.PlaneGeometry(template.depth, template.height)
    const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial)
    leftWall.rotation.y = Math.PI / 2
    leftWall.position.x = -template.width / 2
    leftWall.position.z = position
    leftWall.receiveShadow = true
    roomGroup.add(leftWall)

    const leftWallShape = new CANNON.Box(new CANNON.Vec3(0.1, template.height / 2, template.depth / 2))
    const leftWallBody = new CANNON.Body({
      mass: 0,
      shape: leftWallShape,
      position: new CANNON.Vec3(-template.width / 2, 0, position)
    })
    refs.world.addBody(leftWallBody)
    bodies.push(leftWallBody)

    // Right wall
    const rightWallGeometry = new THREE.PlaneGeometry(template.depth, template.height)
    const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial)
    rightWall.rotation.y = -Math.PI / 2
    rightWall.position.x = template.width / 2
    rightWall.position.z = position
    rightWall.receiveShadow = true
    roomGroup.add(rightWall)

    const rightWallShape = new CANNON.Box(new CANNON.Vec3(0.1, template.height / 2, template.depth / 2))
    const rightWallBody = new CANNON.Body({
      mass: 0,
      shape: rightWallShape,
      position: new CANNON.Vec3(template.width / 2, 0, position)
    })
    refs.world.addBody(rightWallBody)
    bodies.push(rightWallBody)

    // Add obstacles
    template.obstacles.forEach((obstacle: any) => {
      const obstacleGeometry = new THREE.BoxGeometry(...obstacle.size)
      const obstacleMaterial = new THREE.MeshStandardMaterial({ map: textures.obstacle, roughness: 0.7, metalness: 0.2 })
      const obstacleMesh = new THREE.Mesh(obstacleGeometry, obstacleMaterial)
      obstacleMesh.position.set(...obstacle.position)
      obstacleMesh.position.z += position
      obstacleMesh.castShadow = true
      obstacleMesh.receiveShadow = true
      roomGroup.add(obstacleMesh)

      const obstacleShape = new CANNON.Box(new CANNON.Vec3(
        obstacle.size[0] / 2,
        obstacle.size[1] / 2,
        obstacle.size[2] / 2
      ))
      const obstacleBody = new CANNON.Body({
        mass: obstacle.isDynamic ? 1 : 0, // Dynamic obstacles need mass to be moved by forces if needed, but we'll move them kinematically
        type: obstacle.isDynamic ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC,
        shape: obstacleShape,
        position: new CANNON.Vec3(
          obstacle.position[0],
          obstacle.position[1],
          obstacle.position[2] + position
        )
      })
      refs.world.addBody(obstacleBody)

      if (obstacle.isDynamic) {
        dynamicObstacles.push({
          mesh: obstacleMesh,
          body: obstacleBody,
          initialPosition: obstacleMesh.position.clone(),
          dynamicType: obstacle.dynamicType
        });
      } else {
        bodies.push(obstacleBody)
      }
    })

    // Add collectible rings
    if (Math.random() > 0.3) { // 70% chance of having a ring
      const ringGeometry = new THREE.TorusGeometry(1, 0.2, 8, 16)
      const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0xFFD700,
        emissive: 0xFFD700,
        emissiveIntensity: 1,
        transparent: true,
        opacity: 0.8,
        metalness: 0.8,
        roughness: 0.2
      })
      const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial)
      ringMesh.position.set(
        generateRandomNumber(-template.width / 3, template.width / 3),
        generateRandomNumber(-template.height / 3, template.height / 3),
        position + generateRandomNumber(-template.depth / 3, template.depth / 3)
      )
      roomGroup.add(ringMesh)

      // Add physics trigger for ring (non-colliding)
      const ringShape = new CANNON.Sphere(1.5)
      const ringBody = new CANNON.Body({
        mass: 0,
        shape: ringShape,
        collisionFilterGroup: 2, // Different collision group
        collisionFilterMask: 1, // Only collide with plane
        position: new CANNON.Vec3(
          ringMesh.position.x,
          ringMesh.position.y,
          ringMesh.position.z
        )
      })
      refs.world.addBody(ringBody)

      refs.collectibles.push({
        mesh: ringMesh,
        body: ringBody,
        collected: false
      })
    }

    // Add shield power-up
    if (Math.random() < 0.15) { // 15% chance
      const shieldGeometry = new THREE.IcosahedronGeometry(0.7);
      const shieldMaterial = new THREE.MeshStandardMaterial({
        color: 0x00FFFF,
        emissive: 0x00FFFF,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.8
      });
      const shieldMesh = new THREE.Mesh(shieldGeometry, shieldMaterial);
      shieldMesh.position.set(
        generateRandomNumber(-template.width / 4, template.width / 4),
        generateRandomNumber(-template.height / 4, template.height / 4),
        position + generateRandomNumber(-template.depth / 4, template.depth / 4)
      );
      roomGroup.add(shieldMesh);

      const shieldShape = new CANNON.Sphere(1);
      const shieldBody = new CANNON.Body({
        mass: 0,
        shape: shieldShape,
        isTrigger: true, // Make it a trigger so it doesn't cause collisions
        position: new CANNON.Vec3(shieldMesh.position.x, shieldMesh.position.y, shieldMesh.position.z)
      });
      refs.world.addBody(shieldBody);

      refs.powerUps.push({
        mesh: shieldMesh,
        body: shieldBody,
        type: 'shield'
      });
    }

    refs.scene.add(roomGroup)

    return {
      mesh: roomGroup,
      bodies,
      dynamicObstacles,
      position,
      type
    }
  }, [createRoomTemplate, generateRandomNumber, textures])

  const updateRooms = useCallback(() => {
    const refs = gameRefs.current
    if (!refs.paperPlane || !refs.scene || !refs.world) return

    const planeZ = refs.paperPlane.body.position.z

    // Remove rooms that are far behind the plane
    refs.rooms = refs.rooms.filter(room => {
      if (room.position < planeZ - 50) {
        // Remove room from scene
        refs.scene!.remove(room.mesh)
        // Remove physics bodies
        room.bodies.forEach(body => {
          refs.world!.removeBody(body)
        })
        return false
      }
      return true
    })

    // Add new rooms ahead of the plane
    while (refs.nextRoomPosition < planeZ + 100) {
      const roomTypes = ['office', 'warehouse', 'lab', 'library', 'kitchen']
      const randomType = roomTypes[Math.floor(Math.random() * roomTypes.length)]
      const newRoom = createRoom(refs.nextRoomPosition, randomType)
      if (newRoom) {
        refs.rooms.push(newRoom)
      }
      refs.nextRoomPosition += 30 // Room spacing
    }
  }, [createRoom])

  const checkCollectibles = useCallback(() => {
    const refs = gameRefs.current
    if (!refs.paperPlane) return

    refs.collectibles.forEach(collectible => {
      if (!collectible.collected) {
        const distance = refs.paperPlane!.body.position.distanceTo(collectible.body.position)
        if (distance < 2) {
          if (refs.sounds.collect) refs.sounds.collect.triggerAttackRelease("C5", "8n");
          createParticles(collectible.mesh.position, 10, 0xFFD700);
          collectible.collected = true
          refs.scene!.remove(collectible.mesh)
          refs.world!.removeBody(collectible.body)

          // Update score
          setGameStats(prev => ({
            ...prev,
            score: prev.score + 100,
            combo: prev.combo + 1
          }))
        }
      }
    })

    // Remove collected collectibles from array
    refs.collectibles = refs.collectibles.filter(c => !c.collected)
  }, [createParticles])

  const checkPowerUps = useCallback(() => {
    const refs = gameRefs.current;
    if (!refs.paperPlane) return;

    for (let i = refs.powerUps.length - 1; i >= 0; i--) {
      const powerUp = refs.powerUps[i];
      const distance = refs.paperPlane.body.position.distanceTo(powerUp.body.position);
      if (distance < 1.5) {
        if (powerUp.type === 'shield') {
          setHasShield(true);
          // Optional: play a sound
        }
        refs.scene?.remove(powerUp.mesh);
        refs.world?.removeBody(powerUp.body);
        refs.powerUps.splice(i, 1);
      }
    }
  }, []);

  const applyAerodynamicForces = useCallback((planeBody: CANNON.Body, deltaTime: number) => {
    const velocity = planeBody.velocity
    const speed = velocity.length()

    // Add a forward propulsion force that increases with distance
    const basePropulsion = 1; // Base forward force
    const difficultyMultiplier = 1 + Math.floor(gameStats.distance / 100) * 0.1; // Increases by 10% every 100m
    const propulsionForce = new CANNON.Vec3(0, 0, -basePropulsion * difficultyMultiplier);
    planeBody.applyForce(propulsionForce, planeBody.position);

    if (speed > 0.1) {
      // Calculate lift force (perpendicular to velocity)
      const liftDirection = new CANNON.Vec3(0, 1, 0)
      const liftMagnitude = speed * speed * 0.02 * gameRefs.current.gravityDirection
      const liftForce = liftDirection.scale(liftMagnitude)

      // Apply lift
      planeBody.applyForce(liftForce, planeBody.position)

      // Apply drag (opposite to velocity) - increased drag to compensate for propulsion
      const dragMagnitude = speed * speed * 0.015
      const dragForce = velocity.scale(-dragMagnitude / speed)
      planeBody.applyForce(dragForce, planeBody.position)

      // Apply steering forces
      if (gameRefs.current.keys.left) {
        planeBody.applyTorque(new CANNON.Vec3(0, 0, 0.3))
      }
      if (gameRefs.current.keys.right) {
        planeBody.applyTorque(new CANNON.Vec3(0, 0, -0.3))
      }
    }
  }, [gameStats.distance])

  const flipGravity = useCallback(() => {
    const refs = gameRefs.current
    if (!refs.isTransitioning && refs.world) {
      if (refs.sounds.flip) refs.sounds.flip.triggerAttackRelease("C3", "8n", Tone.now());
      refs.isTransitioning = true
      refs.gravityDirection *= -1
      refs.gravityTransition = 0

      setGameStats(prev => ({
        ...prev,
        gravityState: prev.gravityState === 'down' ? 'up' : 'down'
      }))
    }
  }, [])

  useEffect(() => {
    if (!canvasRef.current || !gameStarted) return

    const initGame = async () => {
      if (gameRefs.current.scene) return; // Prevent re-initialization
      const refs = gameRefs.current

      // Load textures
      const textureLoader = new THREE.TextureLoader()
      const wallTexture = await textureLoader.loadAsync('https://cc0-textures.com/thumbs/st/american_oak_1-4K.png');
      const obstacleTexture = await textureLoader.loadAsync('https://cc0-textures.com/thumbs/th/brown_planks_08.png');

      wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
      obstacleTexture.wrapS = obstacleTexture.wrapT = THREE.RepeatWrapping;

      setTextures({
        wall: wallTexture,
        obstacle: obstacleTexture,
      });

      // Initialize Three.js scene
      refs.scene = new THREE.Scene()
      refs.scene.fog = new THREE.Fog(0x87CEEB, 10, 100)

      // Initialize sounds
      refs.sounds.flip = new Tone.Synth().toDestination();
      refs.sounds.collect = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 1 } }).toDestination();
      refs.sounds.crash = new Tone.NoiseSynth().toDestination();

      // Initialize music
      const musicSynth = new Tone.FMSynth({
        harmonicity: 3,
        modulationIndex: 10,
        envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1 },
        modulationEnvelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1 }
      }).toDestination();
      const reverb = new Tone.Reverb(4).toDestination();
      musicSynth.connect(reverb);

      refs.sounds.music = new Tone.Pattern((time, note) => {
        musicSynth.triggerAttackRelease(note, '8n', time);
      }, ['C3', 'E3', 'G3', 'B3'], "randomWalk");
      refs.sounds.music.interval = '4n';
      Tone.Transport.bpm.value = 90;


      // Initialize camera
      refs.camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
      )
      refs.camera.position.set(0, 5, 10)

      // Initialize renderer
      refs.renderer = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        antialias: true
      })
      refs.renderer.setSize(window.innerWidth, window.innerHeight)
      refs.renderer.shadowMap.enabled = true
      refs.renderer.shadowMap.type = THREE.PCFSoftShadowMap

      // Post-processing
      refs.effectComposer = new EffectComposer(refs.renderer);
      refs.effectComposer.addPass(new RenderPass(refs.scene, refs.camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
      bloomPass.threshold = 0;
      bloomPass.strength = 1.2;
      bloomPass.radius = 0;
      refs.effectComposer.addPass(bloomPass);


      // Initialize physics world
      refs.world = new CANNON.World()
      refs.world.gravity.set(0, -9.82, 0)
      refs.world.broadphase = new CANNON.NaiveBroadphase()
      refs.world.solver.iterations = 10

      // Lighting
      const hemisphereLight = new THREE.HemisphereLight(0xB1E1FF, 0xB97A20, 0.8)
      refs.scene.add(hemisphereLight)

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5)
      directionalLight.position.set(10, 20, 5)
      directionalLight.castShadow = true
      directionalLight.shadow.mapSize.width = 1024
      directionalLight.shadow.mapSize.height = 1024
      directionalLight.shadow.camera.near = 0.5
      directionalLight.shadow.camera.far = 50
      directionalLight.shadow.camera.left = -25
      directionalLight.shadow.camera.right = 25
      directionalLight.shadow.camera.top = 25
      directionalLight.shadow.camera.bottom = -25
      refs.scene.add(directionalLight)

      // Create paper plane
      const createPaperPlane = () => {
        // Paper plane geometry
        const geometry = new THREE.ConeGeometry(0.5, 2, 8)
        const material = new THREE.MeshStandardMaterial({
          color: planeColor,
          transparent: true,
          opacity: 0.9,
          roughness: 0.5,
          metalness: 0.5
        })
        const planeMesh = new THREE.Mesh(geometry, material)
        planeMesh.rotation.z = Math.PI / 2
        planeMesh.castShadow = true
        refs.scene!.add(planeMesh)

        // Physics body for paper plane
        const planeShape = new CANNON.Box(new CANNON.Vec3(1, 0.1, 0.5))
        const planeBody = new CANNON.Body({
          mass: 0.1,
          shape: planeShape,
          position: new CANNON.Vec3(0, 5, 0),
          collisionFilterGroup: 1,
          collisionFilterMask: 0xFFFF,
          material: new CANNON.Material({
            friction: 0.1,
            restitution: 0.1
          })
        })
        planeBody.addEventListener('collide', handleGameOver)
        refs.world!.addBody(planeBody)

        return { mesh: planeMesh, body: planeBody }
      }

      refs.paperPlane = createPaperPlane()

      // Create initial rooms
      for (let i = 0; i < 5; i++) {
        const roomTypes = ['office', 'warehouse', 'lab']
        const randomType = roomTypes[Math.floor(Math.random() * roomTypes.length)]
        const room = createRoom(i * 30, randomType)
        if (room) {
          refs.rooms.push(room)
        }
      }
      refs.nextRoomPosition = 5 * 30

      // Input handlers
      const handleKeyDown = (event: KeyboardEvent) => {
        switch(event.code) {
          case 'Space':
          case 'ArrowUp':
            event.preventDefault()
            flipGravity()
            break
          case 'ArrowLeft':
          case 'KeyA':
            refs.keys.left = true
            break
          case 'ArrowRight':
          case 'KeyD':
            refs.keys.right = true
            break
        }
      }

      const handleKeyUp = (event: KeyboardEvent) => {
        switch(event.code) {
          case 'ArrowLeft':
          case 'KeyA':
            refs.keys.left = false
            break
          case 'ArrowRight':
          case 'KeyD':
            refs.keys.right = false
            break
        }
      }

      const handleClick = () => {
        flipGravity()
      }

      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('keyup', handleKeyUp)
      window.addEventListener('click', handleClick)

      // Handle window resize
      const handleResize = () => {
        if (refs.camera && refs.renderer && refs.effectComposer) {
          refs.camera.aspect = window.innerWidth / window.innerHeight
          refs.camera.updateProjectionMatrix()
          refs.renderer.setSize(window.innerWidth, window.innerHeight)
          refs.effectComposer.setSize(window.innerWidth, window.innerHeight)
        }
      }
      window.addEventListener('resize', handleResize)

      // Game loop
      let lastTime = 0
      const gameLoop = (time: number) => {
        const deltaTime = Math.min((time - lastTime) / 1000, 0.1)
        lastTime = time

        // FPS tracking
        refs.frameCount++
        if (time - refs.lastFrameTime >= 1000) {
          refs.fps = Math.round(refs.frameCount * 1000 / (time - refs.lastFrameTime))
          refs.frameCount = 0
          refs.lastFrameTime = time
        }

        if (deltaTime > 0 && refs.world && refs.paperPlane && refs.camera && refs.scene && refs.renderer) {
          // Handle gravity transition
          if (refs.isTransitioning) {
            refs.gravityTransition += deltaTime * 3 // 300ms transition
            if (refs.gravityTransition >= 1) {
              refs.gravityTransition = 1
              refs.isTransitioning = false
            }

            // Smooth gravity interpolation
            const targetGravity = -9.82 * refs.gravityDirection
            const currentGravity = refs.world.gravity.y
            const newGravity = currentGravity + (targetGravity - currentGravity) * refs.gravityTransition
            refs.world.gravity.set(0, newGravity, 0)
          }

          // Apply aerodynamic forces
          applyAerodynamicForces(refs.paperPlane.body, deltaTime)

          // Update physics
          refs.world.step(1/60, deltaTime, 3)

          // Sync physics with rendering
          refs.paperPlane.mesh.position.copy(refs.paperPlane.body.position as unknown as THREE.Vector3)
          refs.paperPlane.mesh.quaternion.copy(refs.paperPlane.body.quaternion as unknown as THREE.Quaternion)

          // Shield visual effect
          const planeMaterial = refs.paperPlane.mesh.material as THREE.MeshStandardMaterial;
          if (hasShield || isInvulnerable) {
            planeMaterial.opacity = 0.6;
            planeMaterial.emissive.set(0x00FFFF);
            planeMaterial.emissiveIntensity = isInvulnerable ? 2 : 1;
          } else {
            planeMaterial.opacity = 0.9;
            planeMaterial.emissive.set(planeColor);
            planeMaterial.emissiveIntensity = 0;
          }


          // Update camera to follow plane
          refs.camera.position.lerp(
            new THREE.Vector3(
              refs.paperPlane.body.position.x,
              refs.paperPlane.body.position.y + 5,
              refs.paperPlane.body.position.z + 10
            ),
            0.05
          )
          refs.camera.lookAt(refs.paperPlane.body.position)

          // Update rooms and collectibles
          updateRooms()
          checkCollectibles()
          checkPowerUps()

          // Animate dynamic obstacles
          refs.rooms.forEach(room => {
            room.dynamicObstacles.forEach(obstacle => {
              if (obstacle.dynamicType === 'fan') {
                // Spinning fan
                obstacle.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Date.now() * 0.002);
                obstacle.mesh.quaternion.copy(obstacle.body.quaternion as unknown as THREE.Quaternion);
              } else {
                // Sliding door
                const time = Date.now() * 0.001;
                const newX = obstacle.initialPosition.x + Math.sin(time) * 5; // Move 5 units left/right
                obstacle.body.position.x = newX;
                obstacle.mesh.position.x = newX;
              }
            })
          })

          // Update particles
          for (let i = refs.particles.length - 1; i >= 0; i--) {
            const particle = refs.particles[i];
            particle.lifetime -= deltaTime;
            if (particle.lifetime <= 0) {
              refs.scene?.remove(particle.mesh);
              particle.mesh.geometry.dispose();
              (particle.mesh.material as THREE.Material).dispose();
              refs.particles.splice(i, 1);
            } else {
              particle.mesh.position.add(particle.velocity.clone().multiplyScalar(deltaTime));
              (particle.mesh.material as THREE.MeshStandardMaterial).opacity = particle.lifetime;
            }
          }

          // Update game stats
          setGameStats(prev => ({
            ...prev,
            distance: Math.max(prev.distance, Math.abs(refs.paperPlane!.body.position.z))
          }))
        }

        if (refs.effectComposer) {
          refs.effectComposer.render()
        }
        refs.gameLoopId = requestAnimationFrame(gameLoop)
      }

      refs.gameLoopId = requestAnimationFrame(gameLoop)

      // Cleanup
      return () => {
        if(refs.gameLoopId) cancelAnimationFrame(refs.gameLoopId)

        Tone.Transport.stop();
        Tone.Transport.cancel();
        if (refs.sounds.music) {
          refs.sounds.music.dispose();
        }

        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('keyup', handleKeyUp)
        window.removeEventListener('click', handleClick)
        window.removeEventListener('resize', handleResize)
        if (refs.renderer) {
          refs.renderer.dispose()
        }
      }
    }

    initGame()
  }, [gameStarted, applyAerodynamicForces, flipGravity, updateRooms, checkCollectibles, checkPowerUps, createRoom, handleGameOver, isGameOver, createParticles, planeColor, hasShield, isInvulnerable])

  const resetGame = () => {
    window.location.reload();
  }

  const handleStartGame = () => {
    Tone.start().then(() => {
      const refs = gameRefs.current;
      if (refs.sounds.music) {
        Tone.Transport.start();
        refs.sounds.music.start(0);
      }
    });
    setGameStarted(true)
  }

  const handleJoystickMove = (e: any) => {
    const refs = gameRefs.current;
    if (e.x > 0.5) {
      refs.keys.right = true;
      refs.keys.left = false;
    } else if (e.x < -0.5) {
      refs.keys.left = true;
      refs.keys.right = false;
    } else {
      refs.keys.left = false;
      refs.keys.right = false;
    }
  }

  const handleJoystickStop = () => {
    const refs = gameRefs.current;
    refs.keys.left = false;
    refs.keys.right = false;
  }

  if (!gameStarted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
        <div className="text-center space-y-6">
          <h1 className="text-6xl font-bold tracking-tighter">Paper Drift: Gravity Flip</h1>
          <p className="text-xl text-white/80 max-w-2xl">
            Control a paper plane through endless rooms. Flip gravity to navigate obstacles and collect rings.
          </p>
          <div className="inline-block bg-white/10 p-4 rounded-lg border border-white/20 backdrop-blur-sm">
            <h2 className="text-2xl font-semibold mb-2">Controls</h2>
            <div className="space-y-1 text-white/90">
              <p>🖱️ Click/Tap or Space: Flip Gravity</p>
              <p>⬅️➡️ Arrow Keys or A/D: Steer</p>
            </div>
          </div>
          <div className="inline-block bg-white/10 p-4 rounded-lg border border-white/20 backdrop-blur-sm">
            <h2 className="text-2xl font-semibold mb-2">Plane Color</h2>
            <div className="flex justify-center gap-x-2">
              <button onClick={() => setPlaneColor(0xffffff)} className="w-8 h-8 rounded-full bg-white border-2 border-white/50"></button>
              <button onClick={() => setPlaneColor(0xff0000)} className="w-8 h-8 rounded-full bg-red-500 border-2 border-white/50"></button>
              <button onClick={() => setPlaneColor(0x00ff00)} className="w-8 h-8 rounded-full bg-green-500 border-2 border-white/50"></button>
              <button onClick={() => setPlaneColor(0x0000ff)} className="w-8 h-8 rounded-full bg-blue-500 border-2 border-white/50"></button>
            </div>
          </div>
          <div>
            <button
              onClick={handleStartGame}
              className="px-10 py-4 bg-white/90 text-gray-900 font-bold text-xl rounded-lg hover:bg-white transition-all scale-100 hover:scale-105"
            >
              Start Game
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-screen">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
      />

      {/* HUD */}
      <div className="absolute top-4 left-4 text-white font-bold text-lg [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
        <div className="space-y-1">
          <div>Score: {gameStats.score}</div>
          <div>Distance: {Math.floor(gameStats.distance)}m</div>
          <div>Combo: x{gameStats.combo}</div>
          <div>Gravity: {gameStats.gravityState === 'down' ? '⬇️' : '⬆️'}</div>
          {hasShield && <div>Shield: 🛡️</div>}
          <div className="text-xs opacity-75">FPS: {gameRefs.current.fps}</div>
        </div>
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-4 left-4 text-white font-semibold text-sm [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
        Click/Space: Flip Gravity | Arrows: Steer
      </div>

      {/* Gravity flip button for mobile */}
      <button
        onClick={flipGravity}
        className="absolute bottom-4 right-4 bg-white/20 backdrop-blur-sm border border-white/30 text-white p-4 rounded-full font-bold text-lg hover:bg-white/30 transition-all"
      >
        Flip
      </button>

      {isMobile && !isGameOver && (
        <div className="absolute bottom-10 left-10">
          <Joystick
            size={100}
            baseColor="rgba(255, 255, 255, 0.2)"
            stickColor="rgba(255, 255, 255, 0.5)"
            move={handleJoystickMove}
            stop={handleJoystickStop}
          />
        </div>
      )}

      {isGameOver && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white text-center">
          <h2 className="text-6xl font-bold mb-4 [text-shadow:0_4px_8px_rgba(0,0,0,0.5)]">Game Over</h2>
          <div className="bg-white/10 p-6 rounded-lg border border-white/20 space-y-4">
            <div className="text-2xl">
              <p className="text-white/80">Score</p>
              <p className="font-bold text-4xl">{gameStats.score}</p>
            </div>
            <div className="text-2xl">
              <p className="text-white/80">High Score</p>
              <p className="font-bold text-4xl">{highScore}</p>
            </div>
          </div>
          <button
            onClick={resetGame}
            className="mt-8 px-10 py-4 bg-white/90 text-gray-900 font-bold text-xl rounded-lg hover:bg-white transition-all scale-100 hover:scale-105"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  )
}