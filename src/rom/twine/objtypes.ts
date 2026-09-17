// 007: The World Is Not Enough (N64, NO7E): classification of the 203 spawn cases (mesh sub-header type byte +0x1E,
// switch at 0x80042E98 over jump table 0x800D3950, default 0x80043BC0). See obj/NOTES.md for the evidence of each row.
//
// layer:  where the viewer puts the record
//   world      static geometry: the default handler creates no object (s3 = 0); drawn from the level's node DLs
//   helper     static, but no display list is ever built (Courier RDRAM: 0 of 58 nodes) -> invisible planes
//   door       moving world parts spawned by 0x800592D0 (object class 11), drawn with the record's own mesh
//   spin       0x8005AB98 (class 12): record mesh spun about axis x/y/z/xyz
//   prop       other objects that take the record mesh (0x80044670 / node pointer)
//   pickup     type 93 (class 36): record mesh = the item
//   character  types 14/17 (0x80079CB4, class 1) and generators (0x80081134, class 43)
//   vehicle    overlay-scripted meshes (level-specific overlays)
//   mp         multiplayer game-mode objects (overlay 17) and MP pickup spawn points
//   start      player starts / MP respawn points (no mesh; model 420 placeholder)
//   env        environment / sky / fog records (handled by env/NOTES.md)
//   light      44-byte light sources linked into the room at the position (no object)
//   glow       type 114 light glow sprite (class 80)
//   emitter    no mesh; effects/sounds/paths (semantics hypothesis)
//   marker     no mesh; script positions (model 420 placeholder)
//   unused     not present in any level record
export type ObjLayer = 'world' | 'helper' | 'door' | 'spin' | 'prop' | 'pickup' | 'character' | 'vehicle' | 'mp' | 'start' |
  'env' | 'light' | 'glow' | 'emitter' | 'marker' | 'unused';

export interface TypeInfo {
  layer: ObjLayer;
  name: string;
  cls?: string; // object class id(s) at object+0x78 (u16 +120), from RDRAM or the handler's `sh N,120(obj)`
  mesh: 'level' | 'record' | 'character' | 'none' | 'sky';
  evidence: string; // V = verified (how), H = hypothesis
}

const T: Record<number, TypeInfo> = {};
const set = (types: number[], info: TypeInfo) => { for (const t of types) T[t] = info; };

// --- static (default handler 0x80043BC0: no object; the flags tail is skipped because s3 == 0)
const DEFAULT = [12, 13, 16, 18, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 32, 33, 34, 39, 40, 48, 49, 50, 51, 52, 53, 60, 61, 62, 63,
  64, 66, 67, 68, 69, 70, 71, 72, 73, 79, 80, 81, 82, 83, 85, 87, 101, 103, 104, 115, 116, 117, 118, 119, 120, 127, 128, 132, 133,
  134, 135, 136, 137, 138, 139, 140, 151, 153, 154, 155, 156, 157, 158, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183,
  184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200];
set(DEFAULT, { layer: 'world', name: 'static geometry', mesh: 'level', evidence: 'V disasm: jump table -> 0x80043BC0, s3 stays 0' });
T[20] = { ...T[20], name: 'static geometry, draw mode 5 (I texture, blend)' };
for (const [t, m] of [[50, 12], [51, 4], [52, 5], [53, 6], [85, 9], [117, 12], [118, 4], [119, 5], [120, 6], [128, 5], [151, 10], [199, 15]])
  T[t] = { ...T[t], name: `static geometry, draw mode ${m} (translucent)` };
for (const t of [115, 116, 117, 118, 119, 120]) T[t] = { ...T[t], name: T[t].name + ', vertex scale 64' };
set([30, 31, 104], { layer: 'helper', name: 'invisible helper plane (no display list)', mesh: 'none',
  evidence: 'V RDRAM (Courier): node+0 DL pointer is 0 for all 32/9/17 records; types with DLs are 100% built' });
set([13, 16], { layer: 'unused', name: 'actor placeholder type (model 420 only)', mesh: 'none', evidence: 'V data: only in model 420; preload treats 13..17 as actors' });

// --- moving parts: 0x800592D0(kind, pos, rot, rec, n24, rec+3, rec+4), object class 11, 80-byte data, kind at data+74
const kinds: [number[], number, string][] = [
  [[3], 0, ''], [[4], 1, ''], [[5], 2, ''], [[7], 3, 'Courier: 14 safety-deposit box doors (x=27.3)'], [[1], 6, ''], [[2], 7, ''],
  [[65], 9, ''], [[54, 161, 163, 165, 167, 169], 10, 'Courier: doors (RAM class 11 at record pos/yaw)'],
  [[55, 162, 164, 166, 168, 170], 11, 'Courier: doors (RAM class 11 at record pos/yaw)'], [[56], 12, ''], [[57], 13, ''],
  [[6], 14, ''], [[8], 15, ''], [[74], 18, ''], [[150], 19, ''], [[159, 160, 171, 172], 20, ''],
];
for (const [types, kind, note] of kinds)
  set(types, { layer: 'door', name: `door / moving part, kind ${kind}${types[0] >= 159 ? ' (door sound 356/406/407/408/428)' : ''}${note ? ' - ' + note : ''}`,
    cls: '11', mesh: 'record', evidence: 'V disasm (kind const before 0x80042FDC) + RDRAM class 11 at record pos/angle' });
set([58], { layer: 'door', name: 'door / moving part, kind 4 (16 if rec+2E & 0x8000)', cls: '11', mesh: 'record', evidence: 'V disasm 0x80042EFC' });
set([59], { layer: 'door', name: 'door / moving part, kind 5 (17 if rec+2E & 0x8000) - Courier: 4 teller shutters', cls: '11', mesh: 'record', evidence: 'V disasm 0x80042ECC + RDRAM class 11' });
T[0] = { layer: 'door', name: 'special moving part (0x8005AFE8, n24 path)', cls: '63', mesh: 'record', evidence: 'V disasm (class 63, 0x80044670); meaning H' };
T[94] = { layer: 'prop', name: 'object 0x80087580 (n24 list)', cls: '48/59', mesh: 'record', evidence: 'V disasm; meaning H' };
T[96] = { layer: 'unused', name: 'object 0x80018630', cls: '61', mesh: 'record', evidence: 'V disasm; not in levels' };
set([9, 10, 11, 112], { layer: 'spin', name: 'spinning object, axis mask 1/2/4/7 (x/y/z/xyz), speeds rec+2D, rec+2F', cls: '12', mesh: 'record',
  evidence: 'V disasm 0x800430B8 (a3 = 1/2/4/7) + RDRAM Courier type 10 class 12 yaw 6213 vs record 11 (turning)' });

// --- characters
set([14, 17], { layer: 'character', name: 'character (rec+38 char type, +3A weapon, +34 AI mode, +2E/+30/+32 spawn % per difficulty)',
  cls: '1 (43 for generators: rec+34 in 2,3,28,29,30,50)', mesh: 'character',
  evidence: 'V disasm 0x80043158 (+34 switch 0x800D3C80) -> 0x80079CB4 / 0x80081134; RDRAM class 1 at record pos/yaw' });
T[15] = { layer: 'unused', name: 'character variant (0x80079CB4 with flag 2)', cls: '1', mesh: 'character', evidence: 'V disasm; not in levels' };
T[19] = { layer: 'vehicle', name: 'Cold Reception: parachute squad (model 322), spawns characters', cls: '46', mesh: 'record', evidence: 'V overlay03 0x80118250 (class 46, jal 0x80079CB4); name H from model' };

// --- starts / MP
T[35] = { layer: 'start', name: 'player 1 start (campaign: 3 copies, rec+40 = difficulty)', mesh: 'none', evidence: 'V disasm 0x80064A18/0x80064264 (env/NOTES)' };
set([36, 37, 38], { layer: 'start', name: 'player 2-4 start', mesh: 'none', evidence: 'V disasm 0x800433C0 -> 0x80064264' });
T[44] = { layer: 'start', name: 'MP respawn point (rec+2E != 0: team modes 2/3 only)', mesh: 'none', evidence: 'V disasm 0x800433C0 (mode byte 0x801002A0)' };
set([90, 126], { layer: 'mp', name: 'MP pickup spawn point: 10 item words rec+2C..+3A,+3E,+40 picked by weapon set 0x801002A2 (0x1000 = none)', mesh: 'record',
  evidence: 'V disasm 0x8005F960; item kind/id nibble split H' });
T[91] = { layer: 'mp', name: 'MP game-mode object (1 per arena, model 244)', cls: '41', mesh: 'record', evidence: 'V overlay17 0x80119C2C; role H' };
T[99] = { layer: 'mp', name: 'MP game-mode object x3 (rec+2C 1..3: Golden Gun parts?)', cls: '31/65', mesh: 'record', evidence: 'V overlay17 0x8011A098; role H (menu text: 3 parts)' };
T[100] = { layer: 'mp', name: 'MP team object x2 (rec+2C team: briefcase?)', cls: '66', mesh: 'record', evidence: 'V overlay17 0x8011BD1C; role H' };
T[102] = { layer: 'mp', name: 'MP team object x2 (rec+2C team: flag base?)', cls: '69', mesh: 'record', evidence: 'V overlay17 0x8011C16C; role H' };

// --- props / usable objects
set([45, 47, 142, 144], { layer: 'prop', name: 'usable object (0x8005DC2C; rec+2C link id, +2E item model, e.g. Courier deposit box -> 478 glasses)',
  cls: '17 (45) / 18 (47) / 95 (142)', mesh: 'record', evidence: 'V disasm + RDRAM classes at record pos; "usable" H' });
set([46, 143], { layer: 'prop', name: 'object 0x8005D9C0 (gets node pointer)', cls: '16 (46)', mesh: 'record', evidence: 'V disasm + RDRAM class 16; meaning H' });
set([75, 76], { layer: 'prop', name: 'security camera (model 158), sweeps yaw', cls: '27', mesh: 'record', evidence: 'V disasm 0x800319B0 + RDRAM class 27 at record pos, yaw differs (moving)' });
set([28, 29], { layer: 'prop', name: 'object 0x8005AD00 (53 / 54)', mesh: 'record', evidence: 'V disasm; meaning H' });
T[95] = { layer: 'unused', name: 'object 0x8005E258', cls: '60', mesh: 'record', evidence: 'V disasm; not in levels' };
T[113] = { layer: 'unused', name: 'object 0x8003239C', cls: '79', mesh: 'record', evidence: 'V disasm; not in levels' };
T[124] = { layer: 'prop', name: 'object 0x80061DC4', cls: '82', mesh: 'record', evidence: 'V disasm; meaning H' };
T[125] = { layer: 'prop', name: 'object 0x80061ADC (draw mode 5)', cls: '83', mesh: 'record', evidence: 'V disasm; meaning H' };
T[131] = { layer: 'prop', name: 'object 0x80017C64 (spawn chance rec+2E/+30/+32)', cls: '90', mesh: 'record', evidence: 'V disasm (jal 0x80017490)' };
T[141] = { layer: 'prop', name: 'object 0x8006201C (n24 list)', cls: '91', mesh: 'record', evidence: 'V disasm; meaning H' };
T[93] = { layer: 'pickup', name: 'pickup: rec+2C 0 ammo / 1 item (16-byte table 0x800C4470) / 2 weapon?, +2E index; mesh = the item', cls: '36', mesh: 'record',
  evidence: 'V disasm 0x8005E68C + RDRAM class 36 at record pos/angles; Courier items 1/2/3/28 = models 397/195/261/186 = table 0x800C4470 +A' };

// --- vehicles / scripted (level overlays)
T[92] = { layer: 'vehicle', name: 'Midnight Departure: aircraft (model 352)', cls: '42', mesh: 'record', evidence: 'V overlay02 0x801182B8; name H' };
T[97] = { layer: 'vehicle', name: 'City of Walkways II: helicopter (model 359)', cls: '62', mesh: 'record', evidence: 'V overlay05 0x80118E94; name H' };
T[152] = { layer: 'vehicle', name: 'City of Walkways II: helicopter (model 277)', cls: '31/62/103', mesh: 'record', evidence: 'V overlay05 0x801178D0; name H' };
T[149] = { layer: 'vehicle', name: 'Thames Chase: boat (model 248)', cls: '98', mesh: 'record', evidence: 'V overlay13 0x80117BBC; name H' };
T[129] = { layer: 'vehicle', name: 'Underground Uprising: scripted object (level node)', cls: '88', mesh: 'record', evidence: 'V overlay14 0x80117998' };
T[130] = { layer: 'vehicle', name: 'Underground Uprising: scripted object (model 155)', cls: '89', mesh: 'record', evidence: 'V overlay14 0x80118258' };
set([88, 89], { layer: 'marker', name: 'Cold Reception: script point (overlay03 stores ids, no object)', mesh: 'none', evidence: 'V overlay03 0x80119D4C/0x80119D90 (17/9 instructions, no alloc)' });

// --- environment
set([41, 42], { layer: 'env', name: 'environment (fog, far, light floor); 41 also sky mesh', mesh: 'sky', evidence: 'V disasm 0x800437E8 (env/NOTES)' });
T[42] = { ...T[42], mesh: 'none' };
set([43, 121, 122], { layer: 'env', name: 'second sky layer', mesh: 'sky', evidence: 'V disasm 0x8004392C' });
T[105] = { layer: 'env', name: 'underwater fog set', mesh: 'none', evidence: 'V disasm 0x80043778' };
set([145, 146, 147, 148], { layer: 'env', name: 'fog/light transition controller (trigger rec+40)', cls: '100', mesh: 'none', evidence: 'V disasm 0x80073634' });
T[86] = { layer: 'env', name: 'front-end controller (level 36)', cls: '37', mesh: 'none', evidence: 'V disasm 0x800271A4' };
set([77, 78], { layer: 'light', name: 'light source (44-byte record in room +32 list: pos, dir*255, rgb rec+2C/+2E/+30, rec+32)', mesh: 'none',
  evidence: 'V disasm 0x800435A8 (0x8003EA68 room lookup, alloc 44 tag 16)' });
T[114] = { layer: 'glow', name: 'light glow sprite', cls: '80', mesh: 'record', evidence: 'V disasm 0x8005B39C + RDRAM class 80 at record pos' };

// --- no-mesh helpers
set([98, 123], { layer: 'emitter', name: 'emitter 0x800632AC (kind 64 / 81)', mesh: 'none', evidence: 'V disasm; meaning H' });
T[106] = { layer: 'emitter', name: 'object 0x8005CF40 (rec+2C, n24 path)', cls: '10', mesh: 'none', evidence: 'V disasm; meaning H' };
set([107, 108, 109], { layer: 'emitter', name: 'effect 0x80061048 (71/72/73)', mesh: 'none', evidence: 'V disasm; meaning H' });
T[110] = { layer: 'emitter', name: 'object 0x80060C50', mesh: 'none', evidence: 'V disasm; meaning H' };
T[111] = { layer: 'emitter', name: 'object 0x8005D3D0 (rec+2D)', cls: '75', mesh: 'none', evidence: 'V disasm; meaning H' };
T[84] = { layer: 'emitter', name: 'object 0x80076708 (rec+2D, +2F, +4)', cls: '24', mesh: 'none', evidence: 'V disasm; meaning H' };
T[201] = { layer: 'marker', name: 'script/AI point (id rec+2C, model 420 placeholder)', cls: '106', mesh: 'none', evidence: 'V disasm 0x800750B0 + RDRAM class 106, +124 = rec+2C' };
T[202] = { layer: 'marker', name: 'cutscene point (rec+2C)', cls: '108', mesh: 'none', evidence: 'V disasm 0x80062BC4' };

export function typeInfo(t: number): TypeInfo {
  return T[t] ?? { layer: 'world', name: t >= 203 ? 'static geometry (type >= 203 -> default)' : 'unclassified', mesh: 'level', evidence: 'V disasm: default handler' };
}
export const TYPE_TABLE = T;
