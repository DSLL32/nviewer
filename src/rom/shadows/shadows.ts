import type { Game, Level } from '../types';
import { ShadowsArchive } from './archive';
import { shadowsGeometry } from './geometry';
import { shadowsMusic } from './music';
import { ShadowsSceneImage } from './scene';
import { ShadowsSceneTextures, ShadowsTextureArchive } from './texture';

export function openShadowsOfTheEmpire(rom: Uint8Array): Game {
  const archive = new ShadowsArchive(rom);
  const textureArchive = new ShadowsTextureArchive(archive.rom);
  const music = shadowsMusic(archive.rom);
  const levels: Game['levels'] = archive.scenes.map(({ index, name, kind }) => ({
    index, name, kind: kind === 'gameplay' ? 'adventure' : 'other',
    group: kind === 'cutscene' ? 'Cutscenes' : kind === 'menu' ? 'Menu' : undefined,
  }));
  return {
    id: 'shadows', title: `Star Wars: Shadows of the Empire (${archive.region} ${archive.revision ? `V1.${archive.revision}` : 'V1.0'})`,
    levels, music: music.tracks, decodeMusic: music.decode,
    loadLevel(index): Level {
      const info = levels[index];
      if (!info) throw new Error(`invalid Shadows scene ${index}`);
      const image = new ShadowsSceneImage(archive.loadScene(index));
      const textures = new ShadowsSceneTextures(image, textureArchive);
      return { id: `shadows-${index}`, info, textures: textures.textures, ...shadowsGeometry(image, textures) };
    },
  };
}
