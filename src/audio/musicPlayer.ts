// Web Audio playback of decoded game music: one AudioContext (created on first user interaction), loop regions
// via AudioBufferSourceNode.loopStart/loopEnd, advance-to-next for songs without loop points, and a small cache.
import type { DecodedMusic } from '../rom';

export interface PlayerTrack {
  gameId: string;
  index: number;
  name: string;
}

export type PlayerStatus = 'idle' | 'rendering' | 'playing' | 'paused' | 'error';

export interface PlayerState {
  status: PlayerStatus;
  track: PlayerTrack | null;
  duration: number; // seconds
  loop: { start: number; end: number } | null; // seconds
  error: string | null;
}

export const IDLE_STATE: PlayerState = { status: 'idle', track: null, duration: 0, loop: null, error: null };

type Decoder = (gameId: string, index: number) => Promise<DecodedMusic>;

interface CachedSong {
  buffer: AudioBuffer;
  loop: { start: number; end: number } | null;
  bytes: number;
}

const CACHE_MAX_SONGS = 4;
const CACHE_MAX_BYTES = 160 * 1024 * 1024; // decoded songs are large (a 4.5 min stereo song is ~48 MB)

export class MusicPlayer {
  state: PlayerState = IDLE_STATE;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private song: CachedSong | null = null;
  private startedAt = 0; // context time at which buffer offset 0 would have played
  private pausedAt = 0; // buffer offset (seconds) while paused
  private volume = 0.7;
  private request = 0;
  private readonly cache = new Map<string, CachedSong>();
  private readonly decode: Decoder;
  private readonly onState: (s: PlayerState) => void;
  private readonly onEnded: () => void;

  constructor(decode: Decoder, onState: (s: PlayerState) => void, onEnded: () => void) {
    this.decode = decode;
    this.onState = onState;
    this.onEnded = onEnded;
  }

  /** The AudioContext, created lazily. Call from a user-interaction handler (autoplay policy). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
  }

  /** Play a track from the start (decoding it in the worker unless cached). Must be triggered by user input. */
  async play(track: PlayerTrack): Promise<void> {
    const ctx = this.ensureContext();
    const req = ++this.request;
    this.stopSource();
    const key = `${track.gameId}:${track.index}`;
    let song = this.cache.get(key);
    if (!song) {
      this.setState({ status: 'rendering', track, duration: 0, loop: null, error: null });
      try {
        const decoded = await this.decode(track.gameId, track.index);
        if (req !== this.request) return;
        song = toSong(ctx, decoded);
        this.remember(key, song);
      } catch (e) {
        if (req !== this.request) return;
        this.song = null;
        this.setState({ status: 'error', track, duration: 0, loop: null, error: e instanceof Error ? e.message : String(e) });
        return;
      }
    } else {
      // Refresh LRU order.
      this.cache.delete(key);
      this.cache.set(key, song);
    }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (req !== this.request) return;
    this.song = song;
    this.startSource(0);
    this.setState({ status: 'playing', track, duration: song.buffer.duration, loop: song.loop, error: null });
  }

  pause() {
    if (this.state.status !== 'playing' || !this.song) return;
    this.pausedAt = this.position();
    this.stopSource();
    this.setState({ ...this.state, status: 'paused' });
  }

  resume() {
    if (this.state.status !== 'paused' || !this.song) return;
    this.ensureContext();
    void this.ctx?.resume().catch(() => {});
    this.startSource(this.pausedAt);
    this.setState({ ...this.state, status: 'playing' });
  }

  /** Jump to a position (seconds) in the current song. */
  seek(seconds: number) {
    if (!this.song) return;
    const offset = Math.max(0, Math.min(seconds, this.song.buffer.duration - 0.01));
    if (this.state.status === 'playing') {
      this.stopSource();
      this.startSource(offset);
    } else if (this.state.status === 'paused') {
      this.pausedAt = offset;
    }
  }

  stop() {
    this.request++;
    this.stopSource();
    this.song = null;
    this.pausedAt = 0;
    this.setState(IDLE_STATE);
  }

  /** Current position in the song (seconds), following the loop region once playback has entered it. */
  position(): number {
    const song = this.song;
    if (!song) return 0;
    if (this.state.status === 'paused') return this.pausedAt;
    if (this.state.status !== 'playing' || !this.ctx) return 0;
    const t = this.ctx.currentTime - this.startedAt;
    const loop = song.loop;
    if (loop && t >= loop.end) return loop.start + ((t - loop.start) % (loop.end - loop.start));
    return Math.min(t, song.buffer.duration);
  }

  dispose() {
    this.stop();
    this.cache.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.gain = null;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private startSource(offset: number) {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song || !this.gain) return;
    const src = ctx.createBufferSource();
    src.buffer = song.buffer;
    if (song.loop) {
      src.loop = true;
      src.loopStart = song.loop.start;
      src.loopEnd = song.loop.end;
    }
    src.connect(this.gain);
    src.onended = () => {
      // Only a song that played to its end (not one we stopped) advances the playlist.
      if (this.source !== src) return;
      this.source = null;
      this.song = null;
      this.setState({ ...this.state, status: 'idle' });
      this.onEnded();
    };
    src.start(0, offset);
    this.source = src;
    this.startedAt = ctx.currentTime - offset;
  }

  private stopSource() {
    const src = this.source;
    this.source = null;
    if (!src) return;
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* not started */
    }
    src.disconnect();
  }

  private remember(key: string, song: CachedSong) {
    this.cache.set(key, song);
    let total = [...this.cache.values()].reduce((n, s) => n + s.bytes, 0);
    for (const [k, s] of this.cache) {
      if (this.cache.size <= 1 || (this.cache.size <= CACHE_MAX_SONGS && total <= CACHE_MAX_BYTES)) break;
      if (k === key) continue;
      this.cache.delete(k);
      total -= s.bytes;
    }
  }

  private setState(s: PlayerState) {
    this.state = s;
    this.onState(s);
  }
}

function toSong(ctx: AudioContext, m: DecodedMusic): CachedSong {
  const channels = m.channels.length > 0 ? m.channels : [new Float32Array(1)];
  const length = Math.max(1, ...channels.map((c) => c.length));
  const buffer = ctx.createBuffer(channels.length, length, m.sampleRate);
  channels.forEach((c, i) => buffer.getChannelData(i).set(c));
  const hasLoop = m.loopStart !== undefined || m.loopEnd !== undefined;
  let loop: CachedSong['loop'] = null;
  if (hasLoop) {
    const start = Math.max(0, (m.loopStart ?? 0) / m.sampleRate);
    const end = Math.min(buffer.duration, (m.loopEnd ?? length) / m.sampleRate);
    if (end - start > 0.05) loop = { start, end };
  }
  return { buffer, loop, bytes: length * channels.length * 4 };
}
