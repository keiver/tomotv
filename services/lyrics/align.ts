/**
 * Known lyrics fitted to the words the device heard in the song (native LyricsListener).
 * The lyric supplies the words, the hearing supplies the times, and every result is gated on
 * how much of the lyric was actually heard: below a gate the lyrics pass through untouched.
 */
import type { ItemLyrics, LyricCue, LyricLine } from "@/services/jellyfin/lyrics";

export interface HeardWord {
  start: number;
  end: number;
  text: string;
}

/** Share of a lyric's words that must be heard before word times are trusted. */
export const WORD_FILL_SHARE = 0.5;
/** Higher bar where the hearing is the only source of line times. */
export const LINE_TIMING_SHARE = 0.65;
/** A whole-song shift is applied from this size, and only when the lines agree on it this closely. */
export const OFFSET_MIN_SECONDS = 0.5;
export const OFFSET_RESIDUAL_SECONDS = 0.6;
/** Heard words a minute below which a song is treated as having no lyrics to generate. */
export const GENERATED_WORDS_PER_MINUTE = 80;
const GENERATED_PAUSE_SECONDS = 0.7;
const GENERATED_LINE_WORDS = 10;

const UNSPACED = /[぀-ヿ㐀-鿿가-힯฀-๿]/;

/** Scripts written without spaces between words, which word alignment cannot use. */
export function hasUnspacedScript(text: string): boolean {
  return UNSPACED.test(text);
}

export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 9;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

/** 2 the same word, 1 close enough to be a mishearing of it, -1 a different word. */
function similarity(a: string, b: string): number {
  if (a === b) return 2;
  const shorter = Math.min(a.length, b.length);
  if (shorter >= 3 && (a.startsWith(b) || b.startsWith(a))) return 1;
  return editDistance(a, b) <= Math.max(1, Math.floor(shorter / 4)) ? 1 : -1;
}

const GAP = -0.5;

/**
 * A time for every lyric word: its heard twin's where the global alignment pairs them, and a
 * point between its neighbours' otherwise. `anchored` counts the paired ones.
 */
export function alignWords(lyricWords: string[], heard: { start: number; word: string }[]): { times: (number | null)[]; anchored: number } {
  const n = lyricWords.length;
  const m = heard.length;
  const times: (number | null)[] = new Array(n).fill(null);
  if (n === 0 || m === 0) return { times, anchored: 0 };

  const score = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const from = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) {
    score[i][0] = i * GAP;
    from[i][0] = 1;
  }
  for (let j = 1; j <= m; j++) {
    score[0][j] = j * GAP;
    from[0][j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diagonal = score[i - 1][j - 1] + similarity(lyricWords[i - 1], heard[j - 1].word);
      const up = score[i - 1][j] + GAP;
      const left = score[i][j - 1] + GAP;
      if (diagonal >= up && diagonal >= left) {
        score[i][j] = diagonal;
        from[i][j] = 0;
      } else if (up >= left) {
        score[i][j] = up;
        from[i][j] = 1;
      } else {
        score[i][j] = left;
        from[i][j] = 2;
      }
    }
  }

  let anchored = 0;
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && from[i][j] === 0) {
      if (similarity(lyricWords[i - 1], heard[j - 1].word) > 0) {
        times[i - 1] = heard[j - 1].start;
        anchored++;
      }
      i--;
      j--;
    } else if (i > 0 && (j === 0 || from[i][j] === 1)) i--;
    else j--;
  }

  const anchors = times.map((time, index) => (time === null ? -1 : index)).filter((index) => index >= 0);
  if (anchors.length === 0) return { times, anchored };
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (times[i] !== null) continue;
    while (next < anchors.length && anchors[next] < i) next++;
    const before = next > 0 ? anchors[next - 1] : undefined;
    const after = next < anchors.length ? anchors[next] : undefined;
    if (before !== undefined && after !== undefined) times[i] = (times[before] as number) + (((times[after] as number) - (times[before] as number)) * (i - before)) / (after - before);
    else if (before !== undefined) times[i] = (times[before] as number) + 0.4 * (i - before);
    else if (after !== undefined) times[i] = Math.max(0, (times[after] as number) - 0.4 * (after - i));
  }
  return { times, anchored };
}

interface LineWord {
  position: number;
  endPosition: number;
  word: string;
}

/** Each word of a line with its UTF-16 range, which is what a cue addresses. */
function wordsOf(text: string): LineWord[] {
  const words: LineWord[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const word = normalizeWord(match[0]);
    if (word) words.push({ position: match.index as number, endPosition: (match.index as number) + match[0].length, word });
  }
  return words;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

interface Fit {
  /** Per line, its words with a time each. */
  lines: { words: LineWord[]; times: number[] }[];
  share: number;
}

function fit(lines: LyricLine[], heard: HeardWord[]): Fit | null {
  if (lines.some((line) => hasUnspacedScript(line.text))) return null;
  const perLine = lines.map((line) => wordsOf(line.text));
  const flat = perLine.flat();
  const heardWords = heard.map((word) => ({ start: word.start, word: normalizeWord(word.text) })).filter((word) => word.word);
  if (flat.length === 0 || heardWords.length === 0) return null;
  const { times, anchored } = alignWords(
    flat.map((word) => word.word),
    heardWords,
  );
  let cursor = 0;
  return {
    share: anchored / flat.length,
    lines: perLine.map((words) => {
      const lineTimes = times.slice(cursor, cursor + words.length).map((time) => time ?? 0);
      cursor += words.length;
      return { words, times: lineTimes };
    }),
  };
}

/** Word cues held inside their line's own window and never running backwards. */
function cuesWithin(words: LineWord[], times: number[], lineStart: number, nextStart: number | null): LyricCue[] {
  let floor = lineStart;
  return words.map((word, index) => {
    const ceiling = nextStart === null ? Number.POSITIVE_INFINITY : nextStart;
    const start = Math.min(Math.max(index === 0 ? lineStart : times[index], floor), ceiling);
    floor = start;
    return { position: word.position, endPosition: word.endPosition, start, end: null };
  });
}

/**
 * Synced lyrics given word-by-word timing, and shifted whole when the file is another rip of
 * the song. Unchanged when too little of the lyric was heard.
 */
export function withWordTiming(lyrics: ItemLyrics, heard: HeardWord[]): ItemLyrics {
  if (!lyrics.synced) return lyrics;
  const fitted = fit(lyrics.lines, heard);
  if (!fitted || fitted.share < WORD_FILL_SHARE) return lyrics;

  const drift = lyrics.lines.map((line, index) => (fitted.lines[index].words.length ? fitted.lines[index].times[0] - (line.start as number) : null)).filter((value): value is number => value !== null);
  const offset = median(drift);
  const residual = median(drift.map((value) => Math.abs(value - offset)));
  const shift = Math.abs(offset) >= OFFSET_MIN_SECONDS && residual <= OFFSET_RESIDUAL_SECONDS ? offset : 0;

  const starts = lyrics.lines.map((line) => Math.max(0, (line.start as number) + shift));
  return {
    ...lyrics,
    lines: lyrics.lines.map((line, index) => ({
      ...line,
      start: starts[index],
      cues: cuesWithin(fitted.lines[index].words, fitted.lines[index].times, starts[index], index + 1 < starts.length ? starts[index + 1] : null),
    })),
  };
}

/** Plain text given line and word times from the hearing alone, or null when it was not heard well enough to trust. */
export function withLineTiming(lyrics: ItemLyrics, heard: HeardWord[]): ItemLyrics | null {
  const lines = lyrics.lines.filter((line) => line.text.trim() !== "");
  const fitted = fit(lines, heard);
  if (!fitted || fitted.share < LINE_TIMING_SHARE) return null;
  let floor = 0;
  const starts = fitted.lines.map((line) => {
    floor = Math.max(floor, line.times[0] ?? floor);
    return floor;
  });
  return {
    ...lyrics,
    synced: true,
    lines: lines.map((line, index) => ({
      text: line.text,
      start: starts[index],
      cues: cuesWithin(fitted.lines[index].words, fitted.lines[index].times, starts[index], index + 1 < starts.length ? starts[index + 1] : null),
    })),
  };
}

/** Lyrics written from the hearing itself, for a song with none anywhere. Null for a song with too few words. */
export function generatedLyrics(heard: HeardWord[], durationSeconds: number): ItemLyrics | null {
  if (durationSeconds <= 0 || (heard.length / durationSeconds) * 60 < GENERATED_WORDS_PER_MINUTE) return null;
  const lines: LyricLine[] = [];
  let words: HeardWord[] = [];
  const close = () => {
    if (words.length === 0) return;
    let text = "";
    const cues: LyricCue[] = words.map((word) => {
      const position = text.length ? text.length + 1 : 0;
      text = text.length ? `${text} ${word.text}` : word.text;
      return { position, endPosition: position + word.text.length, start: word.start, end: null };
    });
    lines.push({ text, start: words[0].start, cues });
    words = [];
  };
  for (const word of heard) {
    const previous = words[words.length - 1];
    if (previous && (word.start - previous.end >= GENERATED_PAUSE_SECONDS || words.length >= GENERATED_LINE_WORDS || /[.!?]$/.test(previous.text))) close();
    words.push(word);
  }
  close();
  return { synced: true, source: "generated", lines };
}
