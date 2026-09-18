import type { Game, LevelInfo } from '../types';
import { MarioPartyFs } from './fs';
import { buildMarioPartyBoard, marioPartyBoards } from './boards';
import { buildMarioPartyScene, marioPartyScenes } from './scenes';
import { decodeMarioPartyMusic, listMarioPartyMusic } from './music';

export function openMarioParty(rom: Uint8Array): Game {
  const fs = new MarioPartyFs(rom);
  const levels: LevelInfo[] = [
    ...marioPartyBoards,
    ...marioPartyScenes.map((info, index) => ({ ...info, index: marioPartyBoards.length + index })),
  ];
  return {
    id: 'marioparty',
    title: 'Mario Party',
    levels,
    loadLevel(index) {
      if (!Number.isInteger(index) || index < 0 || index >= levels.length) {
        throw new RangeError(`Mario Party level ${index} is absent`);
      }
      return index < marioPartyBoards.length
        ? buildMarioPartyBoard(fs, rom, index)
        : buildMarioPartyScene(fs, index - marioPartyBoards.length, index);
    },
    music: listMarioPartyMusic(rom),
    decodeMusic: (index) => decodeMarioPartyMusic(rom, index),
  };
}
