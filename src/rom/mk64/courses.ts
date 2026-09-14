// Per-course draw recipes, transcribed from decomp src/racing/render_courses.c (render_<course>, func_8029122C,
// course_generate_collision_mesh, course_update_water, render_course_credits) with array addresses located in the
// US ROM by lv/proto/scan.ts (arrays_us.txt). Addresses are segmented: 0x06 course data, 0x07 unpacked packed lists,
// 0x09 offsets file. Production static views use each course's whole-course credits root; the camera/path recipes are
// retained as format evidence, to expose genuinely camera-dependent extras, and for explicit diagnostic race mode.

export type W = [number, number];
// Render-state words (F3DEX 0.95 GBI, fs/tools/gbiconst.c)
export const G = {
  CC_SHADE: [0xfcffffff, 0xfffe793c] as W,
  CC_MODULATEIA: [0xfc121824, 0xff33ffff] as W, // = MODULATERGBA
  CC_MODULATEI: [0xfc127e24, 0xfffff9fc] as W,
  CC_MODULATEIDECALA: [0xfc127e24, 0xfffff3f9] as W, // = MODULATERGBDECALA
  CC_DECALRGBA: [0xfcffffff, 0xfffcf279] as W,
  CC_MODULATERGB_PASS2: [0xfc127fff, 0xfffff838] as W, // fog courses (2 cycle)
  CC_MODULATEI_PASS2: [0xfc127fff, 0xfffff838] as W,
  CC_DECALRGBA_PASS2: [0xfcffffff, 0xfffcf238] as W,
  RM_OPA: [0xb900031d, 0x00552078] as W, // G_RM_AA_ZB_OPA_SURF
  RM_TEX_EDGE: [0xb900031d, 0x00553078] as W,
  RM_XLU_SURF: [0xb900031d, 0x005049d8] as W,
  RM_XLU_INTER: [0xb900031d, 0x004045d8] as W, // G_RM_AA_ZB_XLU_INTER, G_RM_NOOP2
  RM_FOG_OPA: [0xb900031d, 0xc8112078] as W, // G_RM_FOG_SHADE_A, G_RM_AA_ZB_OPA_SURF2
  RM_FOG_TEX_EDGE: [0xb900031d, 0xc8113078] as W,
  CULL_ON: [0xb7000000, 0x2000] as W,
  CULL_OFF: [0xb6000000, 0x2000] as W,
  TEX_ON: [0xbb000001, 0xffffffff] as W,
  TEX_OFF: [0xbb000000, 0x00010001] as W,
  PRIM_YELLOW: [0xfa000000, 0xffff00ff] as W,
};

// One drawing step: state words, then display lists (every entry of a section table when `table` is given).
export interface Step {
  state?: W[];
  dls?: number[];
  table?: { addr: number; count: number }; // Gfx* array, 4 entries per path section (S, E, N, W camera direction)
  note?: string; // game condition, for the spec
  translate?: [number, number, number]; // render_set_position(T) before the lists
  cameraPlane?: boolean; // translated to (camera x, y, camera z) every frame
}

export interface CourseDef {
  id: number;
  credits?: number; // render_course_credits' whole-course list (segment 6)
  sectionTables: { addr: number; count: number }[];
  trackSections?: { addr: number; count: number }; // TrackSections (collision)
  collisionLists?: { dl: number; surface: number }[]; // generate_collision_mesh_with_default_section_id (battle) / defaults
  opaque: Step[]; // render_<course>
  translucent: Step[]; // func_8029122C (drawn after the karts and objects)
  vertexColours?: { dl: number; alpha: number; rgb?: [number, number, number] }[]; // find_vtx_and_set_colours
  tileScroll?: number[]; // find_and_set_tile_size targets (course_update_water): scrolling textures
  fog?: { color: [number, number, number]; near: number; far: number };
  nullifiedGuardrails?: number[];
  endingList?: number; // a list in the ending code segment (RAM 0x80280000 = ROM ending start), copied from the ROM
  // Optional static-viewer presentation for a material whose retail-authored UV basis changes independently on
  // each face. This is not a decoder correction: it replaces those face-local orientations with one course-space
  // X/Z basis, retaining the measured authored texel density.
  planarPresentation?: { textureSource: number; worldPeriod: number; note: string }[];
}

const T = (addr: number, count: number) => ({ addr, count });

export const COURSE_DEFS: CourseDef[] = [
  { id: 0, credits: 0x06009348, sectionTables: [T(0x090001f0, 68)], trackSections: T(0x06009650, 53),
    collisionLists: [{ dl: 0x07001140, surface: -1 }, { dl: 0x070008e8, surface: -1 }],
    opaque: [
      { state: [G.CC_SHADE, G.RM_OPA], dls: [0x07003050], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATEIA, G.RM_OPA, G.TEX_ON], dls: [0x070008e8, 0x07001140], note: 'func_802911C4 (1P: 8E8, else 2D68) / func_80291198 by path section and direction' },
      { state: [G.CC_MODULATEIA, G.RM_OPA], dls: [0x07003508, 0x07003240, 0x070014a0] },
      { table: T(0x090001f0, 68) },
      { state: [G.CC_MODULATEIDECALA, G.RM_TEX_EDGE, G.CULL_OFF], dls: [0x07000450, 0x07000240] },
      { state: [G.CULL_ON], dls: [0x070000e0, 0x07000160] },
    ], translucent: [] },
  { id: 1, credits: 0x060071b8, sectionTables: [T(0x09000150, 96)], trackSections: T(0x060072d0, 71),
    fog: { color: [255, 255, 255], near: 0x3e3, far: 0x3e8 },
    nullifiedGuardrails: [0x07000000, 0x07000098, 0x07000178, 0x07000280, 0x070003c8, 0x07000340],
    opaque: [
      { state: [G.CC_SHADE, G.RM_OPA], dls: [0x07004608], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATERGB_PASS2, G.RM_FOG_OPA, G.TEX_ON], dls: [0x07005a70, 0x07000828, 0x070008e0, 0x07005868], note: 'G_FOG on, fog colour (255,255,255), gSPFogPosition(995, 1000)' },
      { table: T(0x09000150, 96) },
      { state: [G.CULL_OFF, G.RM_FOG_TEX_EDGE, G.CC_DECALRGBA_PASS2], dls: [0x07000448, 0x070005d8] },
      { state: [G.CULL_ON], dls: [0x07000718] },
    ], translucent: [] },
  { id: 2, credits: 0x06009148, sectionTables: [T(0x090001d0, 108)], trackSections: T(0x060093d8, 37),
    vertexColours: [{ dl: 0x07001350, alpha: 0x32 }],
    planarPresentation: [{ textureSource: 0x3dc10, worldPeriod: 337.65,
      note: 'viewer-normalized Bowser lava: retail face-local UV orientations, single X/Z basis at the median authored 337.65-unit repeat period' }],
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x07006a80], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATEIA, G.RM_OPA], table: T(0x090001d0, 108) },
      { state: [G.CC_MODULATEIA, G.RM_TEX_EDGE], dls: [0x07000248] },
    ],
    translucent: [{ dls: [0x06009228], note: '1P only, path sections 6-9 (camera yaw 0xA000-0xE000 in 9); state left from the objects' }] },
  { id: 3, credits: 0x0600b308, sectionTables: [T(0x09000170, 100)], trackSections: T(0x0600b458, 49),
    vertexColours: [{ dl: 0x07000878, alpha: 128 }],
    tileScroll: [0x0600b278],
    fog: { color: [0, 0, 0], near: 995, far: 1000 },
    opaque: [
      { state: [G.TEX_ON, G.CC_DECALRGBA], dls: [0x07007228] },
      { state: [G.CULL_ON, G.TEX_ON, G.CC_MODULATEIA, G.RM_OPA], dls: [0x07005cd0, 0x07004e60, 0x070069b0] },
      { table: T(0x09000170, 100) },
      { state: [G.CULL_ON, G.CC_MODULATEIA, G.RM_TEX_EDGE], dls: [0x07000580, 0x07000060, 0x07000540] },
      { dls: [0x07006310], note: 'only when camera y < -20' },
      { dls: [0x0600b278], translate: [0, -82, 0], cameraPlane: true, note: 'T(camera x, -82, camera z)' },
    ],
    translucent: [{ state: [G.TEX_ON, G.RM_XLU_INTER, G.CC_MODULATEIA], dls: [0x07000878] }] },
  { id: 4, credits: 0x06018020, sectionTables: [T(0x060183f0, 124)], trackSections: T(0x06018240, 54),
    opaque: [{ state: [G.CC_MODULATEI, G.RM_OPA], table: T(0x060183f0, 124) }], translucent: [] },
  { id: 5, credits: 0x060076a0, sectionTables: [T(0x06007890, 68)], trackSections: T(0x060079a0, 48),
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x070065e0], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATEIA, G.RM_OPA], table: T(0x06007890, 68) },
    ], translucent: [] },
  { id: 6, credits: 0x06018d68, sectionTables: [T(0x06019328, 148), T(0x06019578, 148)], trackSections: T(0x06018fd8, 106),
    vertexColours: [{ dl: 0x0700ade0, alpha: 150 }, { dl: 0x0700a540, alpha: 150 }, { dl: 0x07009e70, alpha: 150 }, { dl: 0x07000358, alpha: 150 }],
    tileScroll: [0x07009d58, 0x07009cd0, 0x070002e8],
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x07009cc0], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATEIA, G.RM_OPA], dls: [0x07009688] },
      { table: T(0x06019328, 148) },
      { state: [G.CULL_OFF, G.CC_MODULATEIDECALA, G.RM_TEX_EDGE], dls: [0x070002c0] },
      { state: [G.CULL_ON] },
    ],
    translucent: [
      { state: [G.TEX_ON, G.RM_XLU_INTER, G.CC_MODULATEIA, G.CULL_OFF], dls: [0x07009e70], note: 'path sections 22, 23, 29, 30, 31, 37' },
      { state: [G.CULL_ON, G.RM_XLU_INTER, G.CC_MODULATEIA, G.CULL_OFF], table: T(0x06019578, 148), translate: [0, 0, 0], note: 'T(0, water level, 0): D_8015F8E4 oscillates 0 .. -20 by 0.1 per frame' },
    ] },
  { id: 7, credits: 0x0600d8e8, sectionTables: [T(0x090002c0, 132)], trackSections: T(0x0600dc28, 119),
    tileScroll: [0x0700a6a8, 0x0700a648],
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x0700b030], note: 'only when func_80290C20(camera)' },
      { state: [G.CULL_ON, G.CC_MODULATEIA, G.RM_OPA], dls: [0x0700a648] },
      { table: T(0x090002c0, 132) },
      { dls: [0x070011a8] },
      { state: [G.CC_MODULATEIDECALA, G.RM_TEX_EDGE, G.CULL_OFF], dls: [0x070008a0] },
      { state: [G.CULL_ON] },
    ], translucent: [] },
  { id: 8, credits: 0x0600fd40, sectionTables: [T(0x09000290, 120)], trackSections: T(0x0600ff28, 113),
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x07009ec0], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATEIA, G.RM_OPA], table: T(0x09000290, 120) },
      { state: [G.CC_MODULATEIDECALA, G.RM_TEX_EDGE], dls: [0x070000e0, 0x07000068] },
    ], translucent: [] },
  { id: 9, credits: 0x06014088, sectionTables: [T(0x090001d0, 92)], trackSections: T(0x060144b8, 77),
    opaque: [
      { state: [G.TEX_ON, G.CC_MODULATEI, G.RM_OPA], dls: [0x07004df8, 0x07005640] },
      { table: T(0x090001d0, 92) },
      { dls: [0x06013ff8], note: 'by path section and direction' },
      { state: [G.CC_MODULATEI, G.RM_OPA], dls: [0x07005410, 0x06014060], note: 'by path section and direction' },
      { state: [G.CC_MODULATEIDECALA, G.RM_TEX_EDGE], dls: [0x070010c0] },
    ], translucent: [] },
  { id: 10, credits: 0x06023930, sectionTables: [T(0x060239a0, 80)], trackSections: T(0x06023b68, 23),
    fog: { color: [43, 13, 4], near: 993, far: 1000 },
    opaque: [
      { state: [G.TEX_ON, G.CC_MODULATEI_PASS2, G.RM_FOG_OPA], table: T(0x060239a0, 80), note: 'G_FOG, fog colour (43, 13, 4), gSPFogPosition(993, 1000)' },
      { state: [G.RM_FOG_TEX_EDGE, G.CC_DECALRGBA_PASS2], dls: [0x07000000, 0x07000068, 0x070000d8] },
    ], translucent: [] },
  { id: 11, credits: 0x06022e00, sectionTables: [T(0x090001a0, 80)], trackSections: T(0x06023070, 102),
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x070071c8], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATEI, G.RM_OPA], table: T(0x090001a0, 80) },
      { dls: [0x07001ed8, 0x07001b18, 0x07008330] },
      { state: [G.CULL_OFF, G.CC_MODULATEIDECALA, G.RM_TEX_EDGE], dls: [0x07000998, 0x07000270] },
      { state: [G.CULL_ON] },
    ], translucent: [] },
  { id: 12, credits: 0x06009ae8, sectionTables: [T(0x090000b0, 72), T(0x090001d0, 72)], trackSections: T(0x06009c20, 24),
    vertexColours: [{ dl: 0x07001eb8, alpha: 180 }, { dl: 0x07002308, alpha: 150 }],
    opaque: [{ state: [G.TEX_ON, G.CC_MODULATEI, G.RM_OPA], table: T(0x090000b0, 72) }],
    translucent: [
      { state: [G.TEX_ON, G.CC_MODULATEIA], table: T(0x090001d0, 72), note: 'render mode left from the objects' },
      { state: [G.CC_SHADE, G.RM_OPA], dls: [0x07002b48], note: 'only when func_80290C20(camera) and player above the ice' },
    ] },
  { id: 13, credits: 0x06016220, sectionTables: [T(0x060164b8, 48)], trackSections: T(0x06016440, 15),
    vertexColours: [{ dl: 0x07002068, alpha: 150 }, { dl: 0x07001e18, alpha: 150 }, { dl: 0x07001318, alpha: 255, rgb: [255, 255, 0] }, { dl: 0x07001fb8, alpha: 150 }],
    opaque: [{ state: [G.TEX_ON, G.CC_MODULATEIA, G.RM_OPA] }],
    translucent: [{ state: [G.CULL_OFF], table: T(0x060164b8, 48), note: 'render state from the lists' }] },
  { id: 14, credits: 0x0600ca78, sectionTables: [T(0x09000150, 108)], trackSections: T(0x0600cc38, 32),
    vertexColours: [0x07000c50, 0x07000bd8, 0x07000b60, 0x07000ae8, 0x07000cc8, 0x07000d50, 0x07000dd0, 0x07000e48].map((dl) => ({ dl, alpha: 100 })),
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x0700a0c8], note: 'only when func_80290C20(camera)' },
      { state: [G.CC_MODULATEIA, G.RM_OPA], table: T(0x09000150, 108) },
      { dls: [0x0700a228] },
      { state: [G.CC_MODULATEIDECALA, G.RM_TEX_EDGE, G.CULL_OFF], dls: [0x07000a88] },
      { state: [G.CULL_ON] },
    ],
    translucent: [{ state: [G.TEX_ON, G.CULL_OFF, G.CC_MODULATEIDECALA, G.RM_XLU_SURF, G.PRIM_YELLOW], dls: [0x07000ec0] }] },
  { id: 15, sectionTables: [], collisionLists: [{ dl: 0x070015c0, surface: 1 }],
    opaque: [{ state: [G.TEX_ON], dls: [0x070015c0] }], translucent: [] },
  { id: 16, sectionTables: [], collisionLists: [{ dl: 0x07001110, surface: 1 }, { dl: 0x07000258, surface: 1 }],
    opaque: [
      { state: [G.TEX_ON], dls: [0x07000fe8, 0x07000c60, 0x07000b70, 0x070006b8, 0x07000570] },
      { state: [G.CULL_OFF], dls: [0x070010c8] },
      { state: [G.CULL_ON], dls: [0x07000258] },
    ], translucent: [] },
  { id: 17, sectionTables: [], collisionLists: [{ dl: 0x07000738, surface: 1 }],
    opaque: [{ state: [G.TEX_ON, G.CULL_OFF], dls: [0x07000738] }, { state: [G.CULL_ON] }], translucent: [] },
  { id: 18, credits: 0x06013c30, sectionTables: [T(0x06013d20, 104)], trackSections: T(0x06014338, 115),
    vertexColours: [{ dl: 0x07003fa8, alpha: 120 }],
    tileScroll: [0x07003dd0, 0x07003e40, 0x07003eb0, 0x07003f30, 0x070036a8, 0x07009880],
    opaque: [
      { state: [G.CULL_OFF, G.TEX_OFF, G.CC_SHADE, G.RM_OPA], dls: [0x070092d8], note: 'only when func_80290C20(camera)' },
      { state: [G.TEX_ON, G.CC_MODULATEIDECALA, G.RM_TEX_EDGE], table: T(0x06013d20, 104) },
      { state: [G.CULL_ON] },
    ],
    translucent: [
      { state: [G.TEX_ON, G.CC_MODULATEIA, G.RM_XLU_INTER], dls: [0x07003e40, 0x07003eb0, 0x07003dd0, 0x07003f30], note: 'by path section and direction' },
      { state: [G.CC_MODULATEIDECALA], dls: [0x070036a8], note: 'path sections 21-24' },
    ] },
  { id: 19, sectionTables: [],
    collisionLists: [0x07001018, 0x07000450, 0x07000ac0, 0x07000b58, 0x07000230].map((dl) => ({ dl, surface: 6 })),
    opaque: [
      { state: [G.TEX_ON, G.CC_SHADE, G.RM_OPA], dls: [0x07000de8], note: 'only when func_80290C20(camera)' },
      { dls: [0x07000450, 0x07000ac0, 0x07000d20, 0x07000230] },
    ], translucent: [] },
  // 20: award ceremony. load_ceremony_cutscene loads Royal Raceway (7) and draws D_80284F70, a list in the ending
  // segment calling 35 Royal Raceway packed lists (Peach's castle surroundings), with MODULATEIA / AA_ZB_OPA_SURF.
  { id: 20, sectionTables: [], endingList: 0x80284f70, opaque: [{ state: [G.CULL_ON] }], translucent: [] },
];
