/**
 * Known lyrics fitted to heard words: the pairing, each gate, the whole-song shift, and lyrics
 * written from the hearing alone. Words are synthetic.
 */
import { alignWords, generatedLyrics, hasUnspacedScript, normalizeWord, withLineTiming, withWordTiming, type HeardWord } from "@/services/lyrics/align";
import type { ItemLyrics } from "@/services/jellyfin/lyrics";

const heard = (words: [number, string][]): HeardWord[] => words.map(([start, text]) => ({ start, end: start + 0.3, text }));
const synced = (lines: [number, string][]): ItemLyrics => ({ synced: true, source: "lrclib", lines: lines.map(([start, text]) => ({ text, start, cues: [] })) });

describe("alignWords", () => {
  it("pairs the same words in order and fills the unheard ones in between", () => {
    const { times, anchored } = alignWords(
      ["alpha", "bravo", "charlie", "delta"],
      [
        { start: 1, word: "alpha" },
        { start: 4, word: "delta" },
      ],
    );
    expect(anchored).toBe(2);
    expect(times).toEqual([1, 2, 3, 4]);
  });

  it("takes a near miss for the word it was", () => {
    expect(alignWords(["running"], [{ start: 2, word: "runnin" }]).anchored).toBe(1);
    expect(alignWords(["running"], [{ start: 2, word: "table" }]).anchored).toBe(0);
  });

  it("ignores words heard that the lyric does not have", () => {
    const { times, anchored } = alignWords(
      ["alpha", "bravo"],
      [
        { start: 1, word: "alpha" },
        { start: 2, word: "yeah" },
        { start: 3, word: "bravo" },
      ],
    );
    expect(anchored).toBe(2);
    expect(times).toEqual([1, 3]);
  });

  it("has no times to give when nothing was heard", () => {
    expect(alignWords(["alpha"], [])).toEqual({ times: [null], anchored: 0 });
  });
});

describe("normalizeWord and scripts", () => {
  it("drops case, accents and punctuation", () => {
    expect(normalizeWord("Corazón,")).toBe("corazon");
    expect(normalizeWord("don't")).toBe("dont");
  });

  it("knows the scripts written without spaces", () => {
    expect(hasUnspacedScript("こんにちは")).toBe(true);
    expect(hasUnspacedScript("plain words")).toBe(false);
  });
});

describe("withWordTiming", () => {
  const lyrics = synced([
    [10, "alpha bravo charlie"],
    [20, "delta echo foxtrot"],
  ]);

  it("gives each word a time inside its own line", () => {
    const fitted = withWordTiming(
      lyrics,
      heard([
        [10.2, "alpha"],
        [11, "bravo"],
        [12, "charlie"],
        [20.1, "delta"],
        [21, "echo"],
        [22, "foxtrot"],
      ]),
    );
    expect(fitted.lines[0].start).toBe(10);
    expect(fitted.lines[0].cues).toEqual([
      { position: 0, endPosition: 5, start: 10, end: null },
      { position: 6, endPosition: 11, start: 11, end: null },
      { position: 12, endPosition: 19, start: 12, end: null },
    ]);
    expect(fitted.lines[1].cues.map((cue) => cue.start)).toEqual([20, 21, 22]);
  });

  it("holds a word heard late inside the next line's start", () => {
    const fitted = withWordTiming(
      lyrics,
      heard([
        [10, "alpha"],
        [11, "bravo"],
        [25, "charlie"],
        [20, "delta"],
        [21, "echo"],
        [22, "foxtrot"],
      ]),
    );
    expect(Math.max(...fitted.lines[0].cues.map((cue) => cue.start))).toBeLessThanOrEqual(20);
  });

  it("shifts the whole song when every line is off by the same amount", () => {
    const fitted = withWordTiming(
      lyrics,
      heard([
        [12.5, "alpha"],
        [13, "bravo"],
        [14, "charlie"],
        [22.5, "delta"],
        [23, "echo"],
        [24, "foxtrot"],
      ]),
    );
    expect(fitted.lines.map((line) => line.start)).toEqual([12.5, 22.5]);
  });

  it("leaves a small drift alone", () => {
    const fitted = withWordTiming(
      lyrics,
      heard([
        [10.3, "alpha"],
        [11, "bravo"],
        [12, "charlie"],
        [20.3, "delta"],
        [21, "echo"],
        [22, "foxtrot"],
      ]),
    );
    expect(fitted.lines.map((line) => line.start)).toEqual([10, 20]);
  });

  it("returns the lyrics untouched when under half the words were heard", () => {
    expect(
      withWordTiming(
        lyrics,
        heard([
          [10, "alpha"],
          [20, "delta"],
        ]),
      ),
    ).toBe(lyrics);
  });

  it("does not align a script without spaces, or plain text", () => {
    const japanese = synced([[1, "こんにちは"]]);
    expect(withWordTiming(japanese, heard([[1, "こんにちは"]]))).toBe(japanese);
    const plain: ItemLyrics = { synced: false, lines: [{ text: "alpha", start: null, cues: [] }] };
    expect(withWordTiming(plain, heard([[1, "alpha"]]))).toBe(plain);
  });
});

describe("withLineTiming", () => {
  const plain: ItemLyrics = {
    synced: false,
    source: "lrclib",
    lines: [
      { text: "alpha bravo charlie", start: null, cues: [] },
      { text: "", start: null, cues: [] },
      { text: "delta echo foxtrot", start: null, cues: [] },
    ],
  };

  it("times plain text from the hearing and drops the blank lines", () => {
    const timed = withLineTiming(
      plain,
      heard([
        [5, "alpha"],
        [6, "bravo"],
        [7, "charlie"],
        [15, "delta"],
        [16, "echo"],
        [17, "foxtrot"],
      ]),
    );
    expect(timed?.synced).toBe(true);
    expect(timed?.lines.map((line) => [line.text, line.start])).toEqual([
      ["alpha bravo charlie", 5],
      ["delta echo foxtrot", 15],
    ]);
  });

  it("is null when too little was heard to trust the times", () => {
    expect(
      withLineTiming(
        plain,
        heard([
          [5, "alpha"],
          [6, "bravo"],
          [15, "delta"],
        ]),
      ),
    ).toBeNull();
  });
});

describe("generatedLyrics", () => {
  const spoken = (count: number, gapEvery: number): HeardWord[] =>
    Array.from({ length: count }, (_, i) => ({ start: i * 0.4 + Math.floor(i / gapEvery), end: i * 0.4 + Math.floor(i / gapEvery) + 0.3, text: `word${i}` }));

  it("is null for a song with few words", () => {
    expect(generatedLyrics(spoken(20, 5), 120)).toBeNull();
    expect(generatedLyrics(spoken(20, 5), 0)).toBeNull();
  });

  it("cuts lines at pauses and times every word", () => {
    const lyrics = generatedLyrics(spoken(100, 5), 60);
    expect(lyrics?.source).toBe("generated");
    expect(lyrics?.synced).toBe(true);
    expect(lyrics?.lines).toHaveLength(20);
    expect(lyrics?.lines[0].text).toBe("word0 word1 word2 word3 word4");
    expect(lyrics?.lines[0].cues[1]).toEqual({ position: 6, endPosition: 11, start: 0.4, end: null });
    expect(lyrics?.lines[1].start).toBeCloseTo(3);
  });

  it("ends a line at a sentence and caps a run of words", () => {
    const sentence: HeardWord[] = [
      { start: 0, end: 0.2, text: "Hello" },
      { start: 0.3, end: 0.5, text: "there." },
      { start: 0.6, end: 0.8, text: "Again" },
    ];
    expect(generatedLyrics(sentence, 2)?.lines.map((line) => line.text)).toEqual(["Hello there.", "Again"]);
    expect(generatedLyrics(spoken(30, 1000), 12)?.lines.map((line) => line.cues.length)).toEqual([10, 10, 10]);
  });
});
