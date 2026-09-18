import type { CruisnCatalog } from './catalog';

export const CRUISN_COURSES = [
  'Golden Gate Park', 'San Francisco', 'US 101', 'Redwood Forest',
  'Beverly Hills', 'LA Freeway', 'Death Valley', 'Arizona',
  'Grand Canyon', 'Iowa', 'Chicago', 'Indiana', 'Appalachia', 'Washington DC',
] as const;

export interface CruisnChild {
  assetID: number;
  flags: number;
  runtimePtr: number;
  scene?: CruisnScene;
}

export interface CruisnPlacement {
  flags: number;
  childIndex: number;
  drawFlags: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  child: CruisnChild;
}

export interface CruisnScene {
  assetID: number;
  childListID: number;
  placementListID: number;
  reserved: number;
  children: CruisnChild[];
  placements: CruisnPlacement[];
}

export function parseCourse(catalog: CruisnCatalog, index: number): CruisnScene {
  if (!Number.isInteger(index) || index < 0 || index >= CRUISN_COURSES.length)
    throw new Error(`Cruis'n USA course ${index} is out of range`);
  const cache = new Map<number, CruisnScene>();
  const visiting = new Set<number>();
  function parseScene(assetID: number): CruisnScene {
    const known = cache.get(assetID);
    if (known) return known;
    if (visiting.has(assetID)) throw new Error(`Cruis'n USA scene cycle at asset ${assetID}`);
    visiting.add(assetID);
    const header = catalog.asset(assetID);
    if (header.length !== 20) throw new Error(`Cruis'n USA scene ${assetID} has invalid header length`);
    const h = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const childListID = h.getUint32(0);
    const childCount = h.getUint32(4);
    const placementListID = h.getUint32(8);
    const placementCount = h.getUint32(12);
    const reserved = h.getUint32(16);
    const childBytes = catalog.asset(childListID);
    const placementBytes = catalog.asset(placementListID);
    if (childBytes.length !== childCount * 12 || placementBytes.length !== placementCount * 20)
      throw new Error(`Cruis'n USA scene ${assetID} list length mismatch`);
    const cv = new DataView(childBytes.buffer, childBytes.byteOffset, childBytes.byteLength);
    const pv = new DataView(placementBytes.buffer, placementBytes.byteOffset, placementBytes.byteLength);
    const children: CruisnChild[] = [];
    const placements: CruisnPlacement[] = [];
    for (let i = 0; i < childCount; i++) {
      const p = i * 12;
      children.push({ assetID: cv.getUint32(p), flags: cv.getUint32(p + 4), runtimePtr: cv.getUint32(p + 8) });
    }
    for (let i = 0; i < placementCount; i++) {
      const p = i * 20;
      const childIndex = pv.getUint8(p + 1);
      const child = children[childIndex];
      if (!child) throw new Error(`Cruis'n USA scene ${assetID} placement ${i} has invalid child index`);
      placements.push({
        flags: pv.getUint8(p), childIndex, drawFlags: pv.getUint16(p + 2),
        x: pv.getInt32(p + 4), y: pv.getInt32(p + 8), z: pv.getInt32(p + 12),
        yaw: pv.getUint32(p + 16), child,
      });
    }
    const scene = { assetID, childListID, placementListID, reserved, children, placements };
    cache.set(assetID, scene);
    for (const child of children) if (child.flags & 1) child.scene = parseScene(child.assetID);
    visiting.delete(assetID);
    return scene;
  }
  return parseScene(0x9b8 + index * 3);
}
