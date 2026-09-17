/** Banjo-Kazooie map setup (asset 0x71c + map ID). All coordinates are world units. */

export interface BanjoNode {
  position: [number, number, number];
  category: number;
  kind: number;
  selector: number;
  actorId: number;
  markerId: number;
  yaw: number; // degrees
  scale: number; // multiplier
  linkId: number;
}

export interface BanjoProp {
  kind: 'model' | 'sprite';
  position: [number, number, number];
  assetId: number;
  yaw: number; // degrees, model props only
  roll: number; // degrees, model props only
  scale: number; // multiplier
  frame: number; // sprite props only
  mirror: boolean; // sprite props only
  rgbReduction: [number, number, number]; // sprite props only
}

export interface BanjoCameraNode {
  index: number;
  type: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export interface BanjoLight {
  position: [number, number, number];
  radius: [number, number];
  rgb: [number, number, number];
}

export interface BanjoSetup {
  nodes: BanjoNode[];
  props: BanjoProp[];
  cameras: BanjoCameraNode[];
  lights: BanjoLight[];
  cubeMin: [number, number, number];
  cubeMax: [number, number, number];
}

class Reader {
  readonly view: DataView;
  offset = 0;
  private pending: number | undefined;

  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private take(size: number): number {
    if (this.pending !== undefined) throw new Error(`Banjo setup pending tag at ${this.offset}`);
    if (this.offset + size > this.data.byteLength) throw new Error(`Banjo setup truncated at ${this.offset}`);
    const at = this.offset;
    this.offset += size;
    return at;
  }

  /** Game file_isNextByteExpected: a failed match leaves the tag pending. */
  expect(tag: number): boolean {
    if (this.pending === undefined) this.pending = this.data[this.take(1)];
    if (this.pending !== tag) return false;
    this.pending = undefined;
    return true;
  }

  u8(): number { return this.data[this.take(1)]; }
  u16(): number { return this.view.getUint16(this.take(2)); }
  s16(): number { return this.view.getInt16(this.take(2)); }
  u32(): number { return this.view.getUint32(this.take(4)); }
  s32(): number { return this.view.getInt32(this.take(4)); }
  f32(): number { return this.view.getFloat32(this.take(4)); }
  vecS16(): [number, number, number] { return [this.s16(), this.s16(), this.s16()]; }
  vecS32(): [number, number, number] { return [this.s32(), this.s32(), this.s32()]; }
  vecF32(): [number, number, number] { return [this.f32(), this.f32(), this.f32()]; }
  skip(size: number): void { this.take(size); }
  fail(context: string): never { throw new Error(`Banjo setup ${context}: unexpected tag ${this.pending} at ${this.offset - 1}`); }
}

function readNode(r: Reader): BanjoNode {
  const position = r.vecS16();
  const selectorCategory = r.u16();
  const actorId = r.u16();
  const markerId = r.u8();
  r.skip(1);
  const yawAndScale = r.u32();
  const linkAndFlags = r.u32();
  const percent = yawAndScale & 0x7fffff;
  return {
    position,
    selector: selectorCategory >>> 7,
    category: (selectorCategory >>> 1) & 0x3f,
    kind: selectorCategory & 1,
    actorId, markerId,
    yaw: yawAndScale >>> 23,
    scale: (percent || 100) / 100,
    linkId: (linkAndFlags >>> 8) & 0xfff,
  };
}

function readProp(r: Reader): BanjoProp | undefined {
  const appearance = r.u32();
  const position = r.vecS16();
  const flags = r.u16();
  // Bit 0 is a third, actor-like record class, not a static model or sprite.
  if (flags & 1) return undefined;
  if (flags & 2) {
    const modelId = (appearance >>> 16) >>> 4;
    const percent = (flags >>> 8) & 0xff;
    return {
      kind: 'model', position, assetId: modelId + 0x2d1,
      yaw: ((appearance >>> 8) & 0xff) * 2,
      roll: (appearance & 0xff) * 2,
      scale: (percent || 100) / 100,
      frame: 0, mirror: false, rgbReduction: [0, 0, 0],
    };
  }
  const percent = (appearance >>> 2) & 0xff;
  return {
    kind: 'sprite', position, assetId: (appearance >>> 20) + 0x572,
    yaw: 0, roll: 0, scale: (percent || 100) / 100,
    frame: flags >>> 11,
    mirror: ((appearance >>> 1) & 1) !== 0,
    rgbReduction: [(appearance >>> 16) & 7, (appearance >>> 13) & 7, (appearance >>> 10) & 7],
  };
}

function readCubeBody(r: Reader, out: BanjoSetup): void {
  if (r.expect(0x0a)) {
    const count = r.u8();
    if (!r.expect(0x0b) && count) r.fail('node list');
    for (let i = 0; i < count; i++) out.nodes.push(readNode(r));
  } else if (r.expect(0x06)) {
    const count = r.u8();
    if (!r.expect(0x07) && count) r.fail('auxiliary list');
    r.skip(count * 12);
  }
  if (r.expect(0x08)) {
    const count = r.u8();
    if (!r.expect(0x09) && count) r.fail('prop list');
    for (let i = 0; i < count; i++) {
      const prop = readProp(r);
      if (prop) out.props.push(prop);
    }
  }
}

function readGrid(r: Reader, out: BanjoSetup): void {
  if (!r.expect(1)) r.fail('grid bounds');
  out.cubeMin = r.vecS32();
  out.cubeMax = r.vecS32();
  const min = out.cubeMin, max = out.cubeMax;
  const count = (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
  if (count < 0 || count > 100_000) throw new Error(`Banjo setup invalid cube count ${count}`);
  for (let cube = 0; cube < count; cube++) {
    while (!r.expect(1)) {
      if (r.expect(0)) r.skip(24);
      else if (r.expect(2)) r.skip(12);
      else if (r.expect(3)) readCubeBody(r, out);
      else r.fail('cube');
    }
  }
  if (!r.expect(0)) r.fail('grid terminator');
}

function readCameras(r: Reader, out: BanjoSetup): void {
  while (!r.expect(0)) {
    if (!r.expect(1)) r.fail('camera node');
    const index = r.s16();
    if (!r.expect(2)) r.fail('camera type');
    const type = r.u8();
    const camera: BanjoCameraNode = { index, type };
    if (type > 4) throw new Error(`Banjo setup unknown camera type ${type}`);
    if (type === 0) {
      out.cameras.push(camera);
      continue;
    }
    while (!r.expect(0)) {
      if (r.expect(1)) {
        if (type === 4) r.skip(4);
        else camera.position = r.vecF32();
      } else if (r.expect(2) && type !== 4) {
        if (type === 2) camera.rotation = r.vecF32();
        else r.skip(8);
      } else if (r.expect(3) && (type === 1 || type === 3)) r.skip(8);
      else if (r.expect(6) && type === 3) r.skip(8);
      else if (r.expect(4) && (type === 1 || type === 3)) camera.rotation = r.vecF32();
      else if (r.expect(5) && (type === 1 || type === 3)) r.skip(4);
      else r.fail('camera field');
    }
    out.cameras.push(camera);
  }
}

function readLights(r: Reader, out: BanjoSetup): void {
  while (!r.expect(0)) {
    if (!r.expect(1) || !r.expect(2)) r.fail('light position');
    const position = r.vecF32();
    if (!r.expect(3)) r.fail('light radius');
    const radius: [number, number] = [r.f32(), r.f32()];
    if (!r.expect(4)) r.fail('light color');
    out.lights.push({ position, radius, rgb: r.vecS32() });
  }
}

export function parseBanjoSetup(data: Uint8Array): BanjoSetup {
  const r = new Reader(data);
  const out: BanjoSetup = {
    nodes: [], props: [], cameras: [], lights: [], cubeMin: [0, 0, 0], cubeMax: [0, 0, 0],
  };
  while (!r.expect(0)) {
    if (r.expect(2)) continue;
    if (r.expect(1)) readGrid(r, out);
    else if (r.expect(3)) readCameras(r, out);
    else if (r.expect(4)) readLights(r, out);
    else r.fail('top level');
  }
  if (r.offset !== data.byteLength) throw new Error(`Banjo setup has ${data.byteLength - r.offset} trailing bytes`);
  return out;
}

// USA V1.0 ActorInfo registration call order, from decoded core2 and the 13 overlays.
// Each pair is actor ID, model/sprite asset ID. Zero models intentionally shadow later entries.
const actorRegistrations: Record<string, string> = {
  core2: [
    '66:0 6a:0 4:353 e:354 7:3c6 12:364 34d:49e 28b:0 5e:3bb 5f:3bc 60:3c0 61:3c1 62:3c2',
    '46:35f 5a:35e 188:0 65:366 47:361 50:363 51:6d6 52:36d 4a:0 4b:0 d:0 11f:0 14f:0',
    '3ad:0 4c:0 4d:0 58:0 2c:367 4e:7de 4f:7de 6c:0 49:36e f3:0 108:3bf 2d:41a 1e5:0',
    'e7:704 e6:372 b:489 e4:48a 129:580 370:6d1 1ff:580 200:6d1 37a:387 12c:388 3ba:0 351:0 68:3b0',
    '17:3bf 26:0 2a:3c7 29:2d2 2ae:0 2af:0 2b0:0 2b1:0 2b2:0 2b3:0 316:0 317:0 376:0',
    '25d:50c 25e:50d 383:526 2e4:55a 2d9:3b4 2da:3b5 195:532 196:532 197:532 23d:4dd 242:0 373:0 125:378',
    '126:379 354:0 3a0:504 1db:54c 19c:56c 1dc:54d 1dd:54e 1de:55c 1e0:46c 19b:56d 2b5:472 2b4:565 1df:55d',
    '368:301 36b:302 36a:303 369:304 36c:305 204:4dc 206:4dc 208:4dc 20b:4dc 237:4dc 239:4dc 25b:4dc 257:4dc',
    '256:4dc a2:3ad 2f4:46e 2f5:46f 2f6:3bb 2f7:3bb 2f8:3bb 2f9:3bb bc:45c bd:45e 1e7:0 28a:432 30f:4fd',
    '289:431 28f:431 a:36b 5:350 13b:401 ca:3cb c7:3c9 3c2:3c9 163:3ca 134:3ed 37d:504 56:3ec 34e:4cc',
    '350:49d 34f:4c7 1cc:430 67:358 f2:566 f5:38f 29f:482 380:51b 124:377 1ed:47f 1ef:480 1f1:481',
  ].join(' '),
  CC: [
    '43:890 28c:435 28d:436 28e:437 3c:429 44:309 45:30a 101:891 102:893 3d:43a 3e:43a 3f:43a 40:43a',
    '41:43a 42:43a 290:43a 291:43a 292:43a 293:43a 294:43a 295:43a',
  ].join(' '),
  MMM: [
    '109:3cd 10a:3ce 10b:3cf 10c:3d0 10d:3d1 1fe:43e 114:3d3 cb:3cc 191:50b 2e8:4c0 2e9:4c1 2ea:4c2 265:4da',
    '1fd:43d 39:55e 25:3ae 3a:88c 351:0 37f:519 381:521 382:522 384:527 385:528 386:529 387:52a 388:52b',
    '3c1:564',
  ].join(' '),
  GV: [
    '1e4:434 147:3e8 12e:3e0 12f:3e3 130:3e4 131:3e0 135:3e0 132:3df 122:3e7 11a:33d 244:33d 11b:3dd 11d:3e1',
    '123:3dc 119:3dc 120:376 118:371 11e:3e5 285:3e6 286:3e6 287:3e6 288:402 11c:3de 121:3e6 1f7:422 1f8:423',
    '1f9:424 37c:0 245:515 319:0 31d:56b 6d:3d8 140:3ff 143:3d9 142:3db 1f5:3d9 13f:400 144:3d7 145:438',
    '146:3e2 243:514',
  ].join(' '),
  TTC: [
    '10e:3d2 13e:3d6 117:3d5 115:370 1e:51a 151:3d4 152:3d4 153:3d4 53:3e9 54:3eb 55:3ea f4:42c 25c:50a',
    '2e2:3bd 2df:3be 2e0:3b6 2e1:3b7 31e:3a9 69:351',
  ].join(' '),
  MM: [
    '9:7d7 c5:3c8 6:3c5 8:35c 14:2d2 11:0 59:2e6 57:2eb f:35d',
  ].join(' '),
  BGS: [
    '1fa:425 133:375 5b:380 ed:381 ee:382 ef:383 f0:384 c:7d8 e8:3ee e9:3ef ea:3f0 eb:3f1 ec:3f2',
    '136:0 137:385 138:0 139:3f6 13a:373 27a:3f8 27b:3f9 27c:3f9 27d:3f9 27e:3f9 27f:3f9 280:3f9 f1:30d',
    'f6:397 14e:3f5 1fb:3f5',
  ].join(' '),
  RBB: [
    '296:43b 172:402 173:402 174:402 297:43c 175:403 176:404 177:406 17e:406 17f:407 180:408 178:40c 179:40d',
    '17a:40e 17b:409 17c:40a 17d:40b 1bb:40f 1bc:410 1bd:411 1be:412 1bf:413 1c0:414 1c1:415 1c2:416 1c3:416',
    '1c4:416 1c5:0 1c6:419 1c7:41b 1c8:41c 1c9:41d 1cb:0 1ca:41e 281:428 282:428 283:428 284:428 2ad:0',
    '2a4:48c 30d:48c 2a5:0 31b:0 31c:0 21d:493 21c:492 266:4ba 267:4bb 263:4db 264:4de 23f:4e2 18f:42f',
  ].join(' '),
  FP: [
    '116:421 160:38a 161:38b 162:38b c8:38a 1ea:44c 1eb:44d 1ec:44e 332:448 333:449 334:44a 335:44b 336:442',
    '337:496 15f:488 338:486 339:426 33a:47f 33b:480 33c:481 181:352 182:352 1f3:494 1f4:495 33d:38a 33e:49c',
    '33f:494 353:402 340:4d2 1e6:0 355:4e5 356:4e6 357:4e7 358:4e8 229:4c3 3b0:56a 22b:4c4 22c:4c5 22d:4c6',
    '22e:4c6 22f:4c6 35d:4e9 35e:4ec 35f:4ea 360:4eb 253:512 254:513 3ae:55b',
  ].join(' '),
  SM: [
    '16f:42d 16e:0 167:0 166:4ed 165:4ef 164:4ee 36f:4ed 36e:4ef 36d:4ee 12b:387 3b9:0 3bd:0 198:530',
    '199:52f 19a:337 3ca:47b',
  ].join(' '),
  cutscenes: [
    '8e:355 8f:3b1 90:3bb 91:3bb 92:35a 93:3a6 94:3a7 95:3bb 96:3bb 97:3bb 98:3bb 99:3aa 9a:3ab',
    '9b:354 9c:369 9d:353 9e:53d 9f:3bb a0:34d a1:3ac a3:3bb a4:433 a5:3ed a6:398 a7:473 a8:474',
    'a9:454 aa:453 ab:452 ac:451 ad:3ca ae:450 af:44f b0:387 b1:388 b2:347 b4:35b b5:456 b6:457',
    'b7:3bb b8:458 b9:459 ba:3bb bb:45b be:3bb bf:3bb c0:460 c1:467 c2:468 c3:469 2ed:340 2ee:46a',
    '2ef:35b 2f0:341 2f1:46b 2f2:340 2f3:46d 2fa:46a 2fb:532 2fc:3c6 2fd:3b0 2fe:3bb 2ff:461 300:479 301:370',
    '302:47b 303:3bb 304:3bb 305:3bb 306:3bb 307:3bb 308:3bb 309:3bb 30a:3bb 183:0 1e8:439 341:45d 342:45f',
  ].join(' '),
  lair: [
    '230:4bf 231:4d5 213:4a8 203:491 215:4a4 216:4a5 218:4a6 23a:4d9 259:507 25a:508 21a:4ac 21b:4ad 20d:4a1',
    '23e:4e1 258:511 214:4ab 217:4a9 219:4aa 221:4b5 222:4b2 223:4b0 23c:4b8 20e:4a2 20f:4b4 210:4ae 211:4a3',
    '212:4a7 226:4bc 228:4be 234:4d6 235:4d7 236:4d8 21e:4b1 21f:4b6 220:4b7 224:4af 225:4b3 227:4bd 23b:4df',
    '2db:450 255:509 1e1:517 3b7:48b 3bc:538 348:539 377:0 3bb:54b 246:534 247:48a 248:540 249:2dd 1d5:54f',
    '1d6:54f 1d7:54f 1d8:547 1d9:548 1da:549 2e5:550 367:54a 3bf:561 3c0:562 3c3:0 3c4:55f 3c7:560 3c6:34c',
    '3c9:0 3c5:53d 3c8:35b 2e3:563 2d8:3b2',
  ].join(' '),
  fight: [
    '389:541 38a:6c7 38b:53d 3a5:3bc 3a6:3c2 3a7:3c1 3a8:3bb 3a1:545 3a2:543 3a9:544 3aa:6c9 3ab:546 39f:48a',
    '3ac:551 3af:3bf',
  ].join(' '),
  CCW: [
    '298:444 29a:445 299:443 29b:446 29c:446 29d:447 30b:4e3 29e:3e0 2a0:483 2a1:484 2a2:485 2a3:487 30e:487',
    '30c:4e4 1e3:52e 16d:52e 16b:52e 169:52e 1e2:4f5 16c:4f6 16a:4f7 168:4f8 2a6:502 2a7:503 2a8:502 310:501',
    '311:462 312:463 313:464 314:502 315:48d 2a9:48e 2aa:48f 2ab:48f 31a:48f 2ac:490 1e9:440 37e:506 25f:4fc',
    '260:4f9 261:4fa 262:4fb 375:52c 374:0 2e7:518 2e6:533 318:0 233:3b3 2de:531 2dd:53e 2dc:53f',
  ].join(' '),
};

const overlayMaps: Record<string, string> = {
  SM: '1 8c 91',
  MM: '2 c e',
  TTC: '5 6 7 a 8f',
  CC: 'b 21 22 23',
  BGS: 'd 10 11 47',
  GV: '12 13 14 15 16 1a 92',
  MMM: '1b 1c 1d 24 25 26 28 29 2a 2b 2c 2d 2e 2f 30 8d',
  cutscenes: '1e 1f 20 7b 7c 7d 7e 81 82 83 84 85 86 87 88 89 8a 94 95 96 97 98 99',
  FP: '27 41 48 53 7f',
  RBB: '31 34 35 36 37 38 39 3a 3b 3c 3d 3e 3f 8b',
  CCW: '40 43 44 45 46 4a 4b 4c 4d 5a 5b 5c 5e 5f 60 61 62 63 64 65 66 67 68',
  lair: '69 6a 6b 6c 6d 6e 6f 70 71 72 74 75 76 77 78 79 7a 80 8e 93',
  fight: '90',
};

const modelByActor = new Map<string, Map<number, number>>();
for (const [segment, pairs] of Object.entries(actorRegistrations)) {
  const actors = new Map<number, number>();
  for (const pair of pairs.split(' ')) {
    const [actor, asset] = pair.split(':').map((value) => parseInt(value, 16));
    actors.set(actor, asset);
  }
  modelByActor.set(segment, actors);
}
const overlayByMap = new Map<number, string>();
for (const [segment, maps] of Object.entries(overlayMaps)) {
  for (const map of maps.split(' ')) overlayByMap.set(parseInt(map, 16), segment);
}

/** Registered asset for a kind-zero category-six actor. Zero means an invisible controller. */
export function resolveActorModel(mapId: number, actorId: number): number | undefined {
  const core = modelByActor.get('core2')?.get(actorId);
  if (core !== undefined) return core;
  const overlay = overlayByMap.get(mapId);
  return overlay ? modelByActor.get(overlay)?.get(actorId) : undefined;
}
