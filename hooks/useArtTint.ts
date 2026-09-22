import { artTint, blurhashAverage, type ArtTint } from "@/utils/guide";
import { Image } from "expo-image";
import { useEffect, useReducer } from "react";

/** Pixels the art is decoded at for the hash pass: a thumbnail off the disk entry the cell's Image wrote. */
const SAMPLE_HEIGHT = 48;
const CACHE_LIMIT = 2000;
const tints = new Map<string, ArtTint | null>();
const pending = new Map<string, Promise<ArtTint | null>>();

async function readTint(uri: string): Promise<ArtTint | null> {
  const ref = await Image.loadAsync(uri, { maxHeight: SAMPLE_HEIGHT });
  try {
    const hash = await Image.generateBlurhashAsync(ref, [1, 1]);
    const average = hash ? blurhashAverage(hash) : null;
    return average ? artTint(average) : null;
  } finally {
    ref.release();
  }
}

function tintFor(id: string, uri: string): Promise<ArtTint | null> {
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const task = readTint(uri)
    .catch(() => null)
    .then((tint) => {
      if (tints.size >= CACHE_LIMIT) tints.clear();
      tints.set(id, tint);
      pending.delete(id);
      return tint;
    });
  pending.set(id, task);
  return task;
}

/** The art's tint for a cell while it is active; read once per programme and kept for the session. */
export function useArtTint(id: string | undefined, uri: string | null, active: boolean): ArtTint | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const known = id ? tints.get(id) : undefined;
  const unread = known === undefined;
  useEffect(() => {
    if (!active || !id || !uri || !unread) return;
    let live = true;
    tintFor(id, uri).then(() => {
      if (live) rerender();
    });
    return () => {
      live = false;
    };
  }, [active, id, uri, unread]);
  return active ? (known ?? null) : null;
}
