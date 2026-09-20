import type { DlLighting } from '../displaylist';
import type { Batch, CameraView, Instance, Level, LevelInfo, LevelLayer, Mesh, Texture } from '../types';
import { buildObject, combineObjectAndTextures, decodeTextureRecord, parseObjectDirectory, parseTextureBank, type ObjectRecord, type TextureSet } from './banks';
import { GloverFs } from './fs';
import { parseLandscape } from './landscape';

const LEVEL_NAMES = [
  'The Castle — Part 1','The Castle — Part 2','The Castle — Part 3','The Castle — Part 4','The Castle — Part 5','The Castle — Part 6','The Castle — Part 7','The Castle — Part 8',
  'The Castle — Cave','Assault Course','Atlantis — Level 1','Atlantis — Level 2','Atlantis — Level 3','Atlantis — Boss','Atlantis — Bonus',
  'Carnival — Level 1','Carnival — Level 2','Carnival — Level 3','Carnival — Boss','Carnival — Bonus',
  'Pirates — Level 1','Pirates — Level 2','Pirates — Level 3','Pirates — Boss','Pirates — Bonus',
  'Prehistoric — Level 1','Prehistoric — Level 2','Prehistoric — Level 3','Prehistoric — Boss','Prehistoric — Bonus',
  'Fortress of Fear — Level 1','Fortress of Fear — Level 2','Fortress of Fear — Level 3','Fortress of Fear — Boss','Fortress of Fear — Bonus',
  'Out of This World — Level 1','Out of This World — Level 2','Out of This World — Level 3','Out of This World — Boss (Stage 1)',
  'Out of This World — Boss Interlude','Out of This World — Boss (Stage 2)','Out of This World — Bonus','Way Room','Presentation','Title Fly-through','Fly-through 2','Intro','Ending',
];
const GROUPS = [
  ...Array(10).fill('The Castle'), ...Array(5).fill('Atlantis'), ...Array(5).fill('Carnival'), ...Array(5).fill('Pirates'),
  ...Array(5).fill('Prehistoric'), ...Array(5).fill('Fortress of Fear'), ...Array(7).fill('Out of This World'), ...Array(6).fill('Other'),
];
const kindOf = (i: number): LevelInfo['kind'] => i < 9 ? 'hub' : i >= 10 && i <= 41
  ? (i % 5 === 3 || i === 38 || i === 39 || i === 40 ? 'boss' : i % 5 === 4 || i === 41 ? 'bonus' : 'adventure') : 'other';
export const GLOVER_LEVELS: LevelInfo[] = LEVEL_NAMES.map((name, index) => ({ name, index, kind: kindOf(index), group: GROUPS[index] }));

const ENEMIES = ['X','X','X','X','X','X','X','bovva','cannon','samtex','mallet','generalw','lionfish','chester','keg','reggie','swish','thrice','robes','fumble','mike','raptor','crumpet','tracey','yoofow','opec','cymon','sucker','bugle','dennis','chuck','hubchicken1','frankie2','kloset','willy','joff','cancer','kirk','robot','evilrobot','spank','babyspk2','evilglove','dibber','brundle','malcom','spotty','gordon','sidney','weevil','chopstik','butterfly','spider','bat','frog','dragfly','boxthing','bug','nmefrog'];
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i << 24;
    for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    table[i] = value >>> 0;
  }
  return table;
})();
const crc = (text: string) => {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = ((value << 8) ^ CRC_TABLE[((value >>> 24) ^ text.charCodeAt(i)) & 0xff]) >>> 0;
  return value;
};
const HOOP_ID = crc('hoop.ndo');

type Quat = [number, number, number, number];
const qmul = (a: Quat, b: Quat): Quat => [
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2],
];
const axisQuat = (axis: number, angle: number): Quat => {
  const q: Quat = [0,0,0,Math.cos(angle / 2)];
  q[axis] = Math.sin(angle / 2);
  return q;
};
const eulerQuat = (e: number[]): Quat => {
  let q: Quat = [0,0,0,1];
  for (const axis of [1,2,0]) if (e[axis]) q = qmul(q, axisQuat(axis, e[axis]));
  return q;
};
const matrix = (t: number[], q: Quat, s: number[]) => {
  const [x,y,z,w] = q;
  const m = new Float32Array([
    1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0, 2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,
    2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0, t[0],t[1],t[2],1,
  ]);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
  return m;
};

interface Placement {
  kind: 'background'|'main'|'object'|'platform'|'water'|'enemy'|'start';
  id: number; label: string; position: number[]; rotation: Quat; scale: number[]; command: number; animated?: boolean;
  info?: Record<string, string | number>;
}

function adjustedFog(c: number[]): [number, number, number] {
  const f = c.map(v => v / 255);
  return [Math.min(255, Math.trunc(c[0] / (1 + .086 * (1 - f[0])))), Math.min(255, Math.trunc(c[1] * (1 + .04 * (1 - f[1])))), Math.min(255, Math.trunc(c[2] / (1 + .06 * (1 - f[2]))))];
}

const archiveCache = new WeakMap<Uint8Array, GloverFs>();
const archive = (rom: Uint8Array) => {
  let fs = archiveCache.get(rom);
  if (!fs) { fs = new GloverFs(rom); archiveCache.set(rom, fs); }
  return fs;
};

export function loadGloverLevel(rom: Uint8Array, index: number): Level {
  const info = GLOVER_LEVELS[index];
  if (!info) throw new RangeError(`Glover level ${index} is absent`);
  const fs = archive(rom);
  const bankIds = fs.banksFor(index);
  const textureFiles = bankIds.textures.map(id => fs.textureBank(id));
  const objectFiles = bankIds.objects.map(id => fs.objectBank(id));
  const sets = objectFiles.map(file => ({ file, set: combineObjectAndTextures(file.bytes, textureFiles.map(t => t.bytes), file.id), records: parseObjectDirectory(file.bytes), patched: new Set<number>() }));
  const lookup = new Map<number, { set: TextureSet; record: ObjectRecord; patched: Set<number>; bank: string }>();
  for (const entry of sets) for (const record of entry.records) if (!lookup.has(record.id)) lookup.set(record.id, { set: entry.set, record, patched: entry.patched, bank: entry.file.name });

  const landscape = fs.landscape(index);
  const dv = new DataView(landscape.buffer, landscape.byteOffset, landscape.byteLength);
  const f32 = (o: number) => dv.getFloat32(o), u16 = (o: number) => dv.getUint16(o), u32 = (o: number) => dv.getUint32(o);
  const name8 = (o: number) => { let s = ''; for (let i = 0; i < 8 && landscape[o + i]; i++) s += String.fromCharCode(landscape[o + i]); return s; };
  const placements: Placement[] = [];
  const garibs: { position: number[]; type: number; flag: number; command: number }[] = [];
  let actor: Placement | null = null;
  let platform: (Placement & { positioned?: boolean }) | null = null;
  let fog: { on: boolean; color: number[]; min: number; far: number } | null = null;
  const lights: { color: [number,number,number]; a: number; b: number }[] = [];
  let ambient: [number,number,number] = [110,110,110];
  let backdropId = 0;
  for (const command of parseLandscape(landscape)) {
    const o = command.offset;
    switch (command.op) {
      case 0x91: case 0x92: case 0xbc:
        actor = { kind: command.op === 0x91 ? 'background' : command.op === 0x92 ? 'main' : 'object', id: u32(o), label: name8(o + 4),
          position: [f32(o + 12),f32(o + 16),f32(o + 20)], rotation: [0,0,0,1], scale: [1,1,1], command: o - 2 };
        placements.push(actor); break;
      case 0x93: if (actor) actor.rotation = eulerQuat([f32(o),f32(o+4),f32(o+8)]); break;
      case 0x94: if (actor) actor.scale = [f32(o),f32(o+4),f32(o+8)]; break;
      case 0x62: case 0x5d: {
        const id = command.op === 0x62 ? u32(o) : 0;
        const firstHoop = id === HOOP_ID && !placements.some(p => p.kind === 'start');
        platform = { kind: firstHoop ? 'start' : 'platform', id, label: command.op === 0x62 ? name8(o + 4) : 'model-less platform',
          position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], command: o - 2, animated: !firstHoop };
        placements.push(platform); break;
      }
      case 0xa6: if (platform && !platform.positioned) { platform.position = [f32(o),f32(o+4),f32(o+8)]; platform.positioned = true; } break;
      case 0x6b: if (platform && !platform.positioned) { platform.position = [f32(o+2),f32(o+6),f32(o+10)]; platform.positioned = true; } break;
      case 0x79: if (platform) platform.scale = [f32(o),f32(o+4),f32(o+8)]; break;
      case 0x7f: if (platform && u16(o) < 3) { platform.rotation = axisQuat(u16(o), f32(o + 2)); platform.info = { spinAxis: u16(o), spinAngle: f32(o + 2), spinSpeed: f32(o + 6) }; } break;
      case 0xa0: placements.push({ kind: 'water', id: u32(o+38), label: name8(o+42), position: [f32(o+50),f32(o+54),f32(o+58)], rotation: [0,0,0,1], scale: [1,1,1], command: o-2 }); break;
      case 0x83: {
        const type = u16(o), yaw = f32(o + 16), scale = fs.view.getFloat32(0xf0de8 + type * 12);
        const label = ENEMIES[type] ?? `enemy ${type}`;
        placements.push({ kind: 'enemy', id: crc(`${label}.ndo`), label, position: [f32(o+4),f32(o+8),f32(o+12)],
          rotation: yaw === -1 ? [0,0,0,1] : axisQuat(1, yaw), scale: [scale,scale,scale], command: o-2, animated: true, info: { enemyType: type, flag: u16(o+2), yaw } });
        actor = null; platform = null; break;
      }
      case 0x86: garibs.push({ position: [f32(o),f32(o+4),f32(o+8)], type: u16(o+12), flag: u16(o+14), command: o-2 }); break;
      case 0x97: lights.push({ color: [u16(o),u16(o+2),u16(o+4)], a: f32(o+6), b: f32(o+10) }); break;
      case 0x98: ambient = [u16(o),u16(o+2),u16(o+4)]; break;
      case 0x99: backdropId = u32(o); break;
      case 0xa5: fog = { on: landscape[o] !== 0, color: [landscape[o+1],landscape[o+2],landscape[o+3]], min: u16(o+4), far: u16(o+6) }; break;
    }
  }

  const lighting: DlLighting = { ambient, lights: lights.length ? lights.map(l => ({ color: l.color, dir: [Math.cos(l.a)*Math.sin(l.b),-Math.sin(l.a),Math.cos(l.a)*Math.cos(l.b)] })) : [{ color: [160,160,220], dir: [0,.707,.707] }] };
  const textures: Texture[] = [];
  const meshes: Mesh[] = [];
  const textureKeys = new Map<string, number>();
  const missingTextures = new Set<number>();
  const meshIds = new Map<number, number>();
  const roots = new Map<number, { bytes: Uint8Array; mesh: number }>();
  const meshFor = (id: number, label: string) => {
    if (!id) return -1;
    const cached = meshIds.get(id);
    if (cached !== undefined) return cached;
    const found = lookup.get(id);
    if (!found) { meshIds.set(id, -1); return -1; }
    const built = buildObject(found.set, found.record, label || `0x${id.toString(16)}`, { textures, textureKeys, lighting, missingTextures, patched: found.patched });
    built.mesh.info = { ...built.mesh.info, objectBankName: found.bank };
    const mesh = meshes.push(built.mesh) - 1;
    roots.set(id, { bytes: built.bytes, mesh: built.rootMesh });
    meshIds.set(id, mesh);
    return mesh;
  };

  const instances: Instance[] = [];
  const byLayer: Record<string, number[]> = {};
  const add = (layer: string, instance: Instance) => (byLayer[layer] ??= []).push(instances.push(instance) - 1);
  const layerName: Record<Placement['kind'], string> = { background:'background',main:'main',object:'objects',platform:'platforms',water:'water',enemy:'enemies',start:'start hoop' };
  for (const p of placements) add(layerName[p.kind], { name: p.label || `0x${p.id.toString(16)}`, mesh: meshFor(p.id, p.label), matrix: matrix(p.position,p.rotation,p.scale),
    animated: p.animated, info: { kind:p.kind, objectId:`0x${p.id.toString(16)}`, landscapeCommand:`0x${p.command.toString(16)}`, ...p.info } });

  const textureRecord = (id: number) => {
    for (const file of textureFiles) {
      const record = parseTextureBank(file.bytes).find(r => r.id === id);
      if (record) return { file, record };
    }
    return null;
  };
  const spriteMeshes = new Map<number,number>();
  const spriteFor = (type: number) => {
    const cached = spriteMeshes.get(type); if (cached !== undefined) return cached;
    const stem = type === 2 ? 'marble' : 'acard00';
    const hit = textureRecord(crc(`${stem}01.bmp`));
    const texture = hit ? textures.push({ ...decodeTextureRecord(hit.file.bytes, hit.record), wrapS:'clamp', wrapT:'clamp', source:`${stem}01.bmp` }) - 1 : -1;
    const h = 15, quad = (x: number,z: number) => [-h*x,-h,-h*z,h*x,-h,h*z,h*x,h,h*z, -h*x,-h,-h*z,h*x,h,h*z,-h*x,h,-h*z];
    const uv = [0,1,1,1,1,0, 0,1,1,0,0,0];
    const batch: Batch = { texture, blend:'cutout', depthTest:true, depthWrite:true, cullBack:false, positions:new Float32Array([...quad(1,0),...quad(0,1)]), uvs:new Float32Array([...uv,...uv]), colors:new Uint8Array(48).fill(255) };
    const mesh = meshes.push({ name:`garib ${stem}`,radius:22,batches:[batch],info:{ garibType:type,frame:`${stem}01.bmp` } })-1;
    spriteMeshes.set(type,mesh); return mesh;
  };
  for (const g of garibs) add('pickups', { name:`garib type ${g.type}`, mesh:spriteFor(g.type), matrix:matrix(g.position,[0,0,0,1],[1,1,1]), info:{ kind:'garib',type:g.type,flag:g.flag,landscapeCommand:`0x${g.command.toString(16)}` } });

  // Collision uses the root face list of collidable land actors and platforms.
  const collisionPositions: number[] = [], collisionColors: number[] = [], collisionSources: number[] = [];
  for (const p of placements) {
    if (p.kind !== 'main' && p.kind !== 'platform' && p.kind !== 'start') continue;
    const root = roots.get(p.id); if (!root || !root.mesh) continue;
    const rdv = new DataView(root.bytes.buffer,root.bytes.byteOffset,root.bytes.byteLength);
    const faces = rdv.getInt16(root.mesh), verts = rdv.getInt16(root.mesh+2), vp = rdv.getUint32(root.mesh+4)&0xffffff, fp = rdv.getUint32(root.mesh+8)&0xffffff;
    if (faces <= 0 || !vp || !fp) continue;
    const m = matrix(p.position,p.rotation,p.scale);
    const point = (v: number): [number,number,number] => { const x=rdv.getFloat32(vp+v*12),y=rdv.getFloat32(vp+v*12+4),z=rdv.getFloat32(vp+v*12+8); return [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]]; };
    for (let f=0;f<faces;f++) {
      const ids=[rdv.getUint16(fp+f*6),rdv.getUint16(fp+f*6+2),rdv.getUint16(fp+f*6+4)]; if(ids.some(v=>v>=verts)) continue;
      const [a,b,c]=ids.map(point), nx=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]), ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]), nz=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      const up=ny/(Math.hypot(nx,ny,nz)||1), color=up>.7?[60,200,60,140]:up<-.7?[200,60,200,140]:[220,160,40,140];
      collisionPositions.push(...a,...b,...c); for(let k=0;k<3;k++) collisionColors.push(...color); collisionSources.push(root.mesh+f*6);
    }
  }
  if (collisionPositions.length) {
    const mesh=meshes.push({name:'collision',radius:1e6,batches:[{texture:-1,blend:'blend',depthTest:true,depthWrite:false,cullBack:false,positions:new Float32Array(collisionPositions),uvs:new Float32Array(collisionPositions.length/3*2),colors:new Uint8Array(collisionColors),triSource:new Uint32Array(collisionSources)}]})-1;
    add('collision',{name:'collision',mesh,matrix:matrix([0,0,0],[0,0,0,1],[1,1,1]),info:{source:'root face lists'}});
  }

  const layers: LevelLayer[] = Object.entries(byLayer).map(([name, indices]) => ({ name, kind:name==='collision'?'collision':name==='main'?'main':name==='background'?'background':'objects', instances:indices, ...((name==='collision'||name==='start hoop')?{visibleByDefault:false}:{}) }));
  const min: [number,number,number]=[Infinity,Infinity,Infinity], max: [number,number,number]=[-Infinity,-Infinity,-Infinity];
  for (const instance of instances) {
    if (instance.mesh < 0 || meshes[instance.mesh].name === 'collision') continue;
    for (const batch of meshes[instance.mesh].batches) for(let i=0;i<batch.positions.length;i+=3) {
      const m=instance.matrix,x=batch.positions[i],y=batch.positions[i+1],z=batch.positions[i+2], p=[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
      for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
    }
  }
  if (!Number.isFinite(min[0])) { min.fill(-1); max.fill(1); }
  const start=placements.find(p=>p.kind==='start');
  let camera: CameraView|undefined;
  if(start){let dx=(min[0]+max[0])/2-start.position[0],dz=(min[2]+max[2])/2-start.position[2],len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;camera={eye:[start.position[0]-dx*130,start.position[1]+20,start.position[2]-dz*130],target:[start.position[0],start.position[1]-20,start.position[2]],fovY:45};}
  const clearColor = adjustedFog(fog?.color ?? [0,0,0]);
  let backdrop: Level['backdrop'];
  if(backdropId){const hit=textureRecord(backdropId);if(hit){const texture=textures.push({...decodeTextureRecord(hit.file.bytes,hit.record),wrapS:'repeat',wrapT:'clamp'})-1;backdrop={texture,u0:0,v0:0,u1:1,v1:1};}}
  return {
    info,id:fs.levelRecord(index).name,textures,meshes,instances,layers,unplaced:[],bounds:{min,max},clearColor,
    ...(fog?.on?{fog:{color:clearColor,multiplier:128000/(1000-fog.min),offset:(500-fog.min)*256/(1000-fog.min),near:6,far:fog.far}}:{}),
    ...(camera?{camera}:{}),...(backdrop?{backdrop}:{}),
  };
}
