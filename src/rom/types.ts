// Render-ready level data shared by all supported games.

export type LevelKind = 'race' | 'battle' | 'stunt' | 'obstacle' | 'adventure' | 'campaign' | 'hub' | 'bonus' | 'boss' | 'other';

export interface LevelInfo {
  index: number;
  name: string;
  kind: LevelKind;
  // Sub-heading within the kind's group (e.g. the world or planet), shared by consecutive levels.
  group?: string;
  // An alternate setup selected from the parent level's View panel; omitted from the sidebar.
  setupParent?: number;
}

export type WrapMode = 'repeat' | 'mirror' | 'clamp';
export type BlendMode = 'opaque' | 'cutout' | 'blend';

export interface Texture {
  width: number;
  height: number;
  rgba: Uint8Array;
  wrapS: WrapMode;
  wrapT: WrapMode;
  format: string; // e.g. "CI4/RGBA16", for diagnostics
  source?: string; // where the texels come from (image/palette addresses), for bug reports
}

// Loader-specific identity for bug reports (record indices, names, file offsets as hex strings).
export type DebugInfo = Record<string, string | number>;

export interface Batch {
  texture: number; // index into Level.textures, -1 for untextured
  blend: BlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  // The game draws this batch with back-face culling (front faces wind counter-clockwise,
  // the OpenGL convention).
  cullBack: boolean;
  // Always cull back faces even when the diagnostic culling toggle is off. Use only for
  // authored paired front/back surfaces whose facing selects different visible artwork.
  forceCullBack?: boolean;
  // Coplanar decal over other geometry (the RDP's decal depth mode): draw after the
  // surfaces it lies on, with a depth offset towards the camera.
  decal?: boolean;
  // Non-indexed triangles: 3 positions / 2 uvs / 4 colors per vertex.
  positions: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  // Full-bright vertex colours for geometry whose N64 display list enables RSP lighting. Vertices drawn without
  // lighting keep their normal colour. Omitted when a batch has no lit vertices.
  unlitColors?: Uint8Array;
  // Colours for Level.lighting.presets, in the same order. Only present when the batch has lit vertices.
  lightingColors?: Uint8Array[];
  // Per triangle: the address of the display-list command that drew it (in the loader's buffer, see
  // Mesh.info), for bug reports.
  triSource?: Uint32Array;
  // A second texture the game combines with `texture` (the RDP combiner's TEXEL1, e.g. Zelda 64's detail
  // textures and light maps). The sampled texel, before it is multiplied by the vertex colour, is
  //   texBlend 'lerp':     mix(texture(uvs), texture1(uvs1), texMix) in colour and alpha
  //   texBlend 'multiply': rgb = texture(uvs).rgb x texture1(uvs1).rgb, alpha = texture(uvs).a
  // Renderers without two-texture support draw `texture` alone.
  texture1?: number; // index into Level.textures
  uvs1?: Float32Array; // 2 per vertex, like uvs
  texBlend?: 'lerp' | 'multiply';
  texMix?: number; // 0..1, for 'lerp'
}

export interface Mesh {
  name: string;
  radius: number;
  batches: Batch[];
  info?: DebugInfo;
}

export interface Instance {
  name: string;
  mesh: number; // index into Level.meshes, -1 when no object of that name exists
  matrix: Float32Array; // 4x4 column-major, object -> world
  billboard?: 'y'; // rotate about world Y each frame so the local front faces the camera
  animated?: boolean; // scripted object, shown at the start of its motion path
  noFog?: boolean; // the game draws this instance without fog, even when the level has fog
  info?: DebugInfo;
}

// N64 RSP fog as the game sets it (gSPFogFactor / G_SETFOGCOLOR). Per vertex the RSP
// computes fog = clamp((zndc * multiplier + offset) / 255, 0, 1), where zndc is the
// perspective depth in [-1, 1] of the game's projection with the given near/far planes:
// zndc = (far + near) / (far - near) - 2 * far * near / ((far - near) * d) for view depth d.
// The fragment colour is mixed towards `color` by fog.
export interface Fog {
  color: [number, number, number]; // 0..255
  multiplier: number;
  offset: number;
  near: number; // world units
  far: number; // world units
}

// A sky mesh in Level.meshes, drawn around the camera (camera translation ignored),
// before the level, without depth or fog. Positions are relative to the camera.
export interface MeshSky {
  name: string;
  kind?: 'mesh';
  mesh: number;
  // The game draws this sky without alpha blending; omitted skies use the viewer's
  // usual blended sky pass.
  opaque?: boolean;
}

// A screen-space cylindrical panorama, drawn before the level without depth or fog.
// `yawPhase` is the panorama turn at screen centre when camera yaw is zero;
// `yawSign` maps the viewer's yaw onto panorama turns. `top` is calculated in
// logical pixels as trunc(sin(pitch) * sinScale + bias * biasScale) + offset,
// then clamped. The upper texture contains one complete turn; the lower texture
// is one horizontally repeating panel.
export interface PanoramaSky {
  name: string;
  kind: 'panorama';
  upperTexture: number;
  lowerTexture: number;
  tint: [number, number, number]; // multiplies both textures, 0..255
  logicalViewport: [number, number];
  period: number;
  panelScreen: [number, number];
  upperSource: [number, number]; // source texels per upper panel; panels are stitched horizontally in the texture
  lowerSource: [number, number]; // source texels in the horizontally repeating lower panel
  yawSign: -1 | 1;
  yawPhase: number; // turns
  // Optional solid fill from the top of the logical viewport through
  // max(0, calculated top + overlap), drawn before the panorama panels.
  fillAbove?: { color: [number, number, number]; overlap: number };
  top: {
    sinScale: number;
    bias: number;
    biasScale: number;
    offset: number;
    min: number;
    max: number;
  };
}

export type Sky = MeshSky | PanoramaSky;

// A horizontal textured plane at a fixed world height that the game projects to the screen before the level
// (GoldenEye's cloud layer and Frigate's water): drawn first, without depth or fog, over the whole view where the
// plane is visible (clouds above the eye, water below); the rest of the screen keeps the clear colour.
// For a view ray with direction d, w = min(1, 2|d.y| / |d.xz|) (0 at the horizon, 1 from about 27 degrees up or down),
// shade = horizon + color x (1 - horizon / 255) x w, and the texel comes from the plane hit point (x, z) / uvScale.
//   'clouds': out = horizon + (shade - horizon) x texel   (combine (SHADE - ENV) x TEXEL0 + ENV)
//   'water':  out = texel x shade
export interface SkyPlane {
  combine: 'clouds' | 'water';
  height: number; // world Y
  texture: number; // index into Level.textures, repeating
  uvScale: number; // world units per texture repeat, along x and z
  color: [number, number, number]; // plane colour, 0..255
  horizon: [number, number, number]; // colour at the horizon (the environment colour), 0..255
  horizonOffset?: number; // the game casts the ray for screen row y through row y + offset (pixels of its 240-line screen)
}

// A 2D picture the game draws across the whole screen before the level (no depth, no fog).
// The texture window [u0, u1] x [v0, v1] (0..1 across the texture) spans the screen
// left to right and top to bottom.
export interface Backdrop {
  texture: number; // index into Level.textures
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  tint?: [number, number, number]; // multiplies the texture, 0..255
  // Set when the picture is a prerendered view of the level from a fixed game camera (Zelda 64's prerendered
  // backgrounds): its width / height. While it is shown, the viewer keeps this aspect for the 3D view (letterbox or
  // pillarbox) so the picture and the level geometry keep the same proportions at the game's camera.
  aspect?: number;
}

// A camera the game itself uses for the level, as a starting view.
export interface CameraView {
  eye: [number, number, number];
  target: [number, number, number];
  fovY?: number; // degrees
}

// A named group of instances the UI can show or hide (tile layers, objects, collision, markers).
export interface LevelLayer {
  name: string; // e.g. "far (wrd_1_1_1_enkei)", "main", "objects"
  kind: 'background' | 'main' | 'foreground' | 'objects' | 'collision' | 'markers';
  instances: number[]; // indices into Level.instances
  depth?: number; // the game's depth value, for display
  parallax?: number; // scroll factor relative to the main plane, for display
  visibleByDefault?: boolean; // default true
  // An overlay the game makes see-through while the player is behind it (e.g. a hut's roof and walls): the
  // viewer fades it out while the pointer is over it.
  fadeOnHover?: boolean;
  // Layers with the same group are listed together under a collapsible heading with a toggle for the whole group
  // (e.g. "rooms" for one layer per room).
  group?: string;
}

// Camera for side-scrolling games: a fixed-lens camera looking down -Z at the plane Z = 0, without
// rotation. The lens must not be re-framed: the game's parallax depends on it.
export interface SideView {
  fovY: number; // degrees
  distance: number; // eye distance from the Z = 0 plane
  start: [number, number]; // eye X, Y at level start
  bounds: { min: [number, number]; max: [number, number] }; // pan limits for the eye
}

// A labelled point, for objects without decoded art.
export interface Marker {
  label: string; // e.g. "4199 atamaheiho"
  position: [number, number, number];
  layer?: number; // index into Level.layers (its visibility toggle applies)
  info?: DebugInfo;
}

export interface Level {
  info: LevelInfo;
  layers?: LevelLayer[];
  sideView?: SideView;
  markers?: Marker[];
  pixelArt?: boolean; // default to nearest texture filtering
  fog?: Fog; // absent when the game shows no fog
  // Mutually exclusive scene lighting choices. Batch.lightingColors holds the corresponding baked colours.
  lighting?: { presets: string[]; default: number };
  // Alternate scene headers represented as choices within this level rather than duplicate sidebar entries.
  setups?: { options: { name: string; level: number }[]; current: number };
  // Skies the game chooses between (at random, for Rush 1), if it builds them itself.
  skies?: Sky[];
  skyPlanes?: SkyPlane[]; // drawn in order (water first, then clouds)
  // Colour the game clears the screen to (0..255), when it clears it.
  clearColor?: [number, number, number];
  backdrop?: Backdrop;
  camera?: CameraView;
  id: string;
  textures: Texture[];
  meshes: Mesh[];
  instances: Instance[];
  // Meshes of the level file that no instance references (sky, scripted objects).
  unplaced: number[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

// A piece of the game's soundtrack.
export interface MusicTrack {
  index: number;
  name: string; // as the game names it (e.g. in an audio/jukebox menu), else "Track N"
}

// Decoded PCM, -1..1 per channel.
export interface DecodedMusic {
  sampleRate: number;
  channels: Float32Array[];
  // Loop region in samples, if the game loops the piece.
  loopStart?: number;
  loopEnd?: number;
}

// Optional static data that belongs to a game but is intentionally not bundled with the viewer. The worker supplies
// the bytes from the deployed site; command-line checks supply the same committed asset from public/.
export type StaticAssetLoader = (path: string) => Promise<Uint8Array>;

// A loaded ROM of one supported game.
export interface Game {
  id: 'rush2049' | 'rush1' | 'bm64' | 'bm64sa' | 'bmhero' | 'battletanx' | 'battletanxga' | 'gex64' | 'gex3' | 'yoshistory' | 'sf64' | 'goldeneye' | 'perfectdark' | 'oot' | 'mm' | 'oot-alpha' | 'pilotwings64' | 'pokemonsnap' | 'offroadchallenge' | 'airboarder64' | 'bugslife' | 'spiderman' | 'mk64' | 'shadows' | 'twine' | 'banjokazooie' | 'marioparty' | 'stuntracer64' | 'cruisnusa' | 'vigilante8' | 'zelda-source';
  title: string;
  levels: LevelInfo[];
  prepare?(loadAsset: StaticAssetLoader): Promise<void>;
  loadLevel(index: number): Level;
  music?: MusicTrack[];
  decodeMusic?(index: number): DecodedMusic;
}
