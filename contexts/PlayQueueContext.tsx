import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback, useEffect, useRef } from "react";
import { playQueueManager } from "@/services/playQueueManager";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

interface PlayQueueContextType {
  queue: JellyfinVideoItem[];
  currentIndex: number;
  isLoading: boolean;
  hasNext: boolean;
  nextVideo: JellyfinVideoItem | null;
  progress: string;
  buildQueue: (folderId: string, folderName: string, startVideoId: string, folderType?: "folder" | "playlist") => Promise<void>;
  buildQueueFromItems: (items: JellyfinVideoItem[], folderId: string, folderName: string, startVideoId: string) => void;
  advanceToNext: () => JellyfinVideoItem | null;
  clear: () => void;
}

const PlayQueueContext = createContext<PlayQueueContextType | undefined>(undefined);

export function PlayQueueProvider({ children }: { children: ReactNode }) {
  const initialState = playQueueManager.getState();

  const [queue, setQueue] = useState<JellyfinVideoItem[]>(initialState.queue);
  const [currentIndex, setCurrentIndex] = useState(initialState.currentIndex);
  const [isLoading, setIsLoading] = useState(initialState.isLoading);

  const isFirstCallRef = useRef(true);

  useEffect(() => {
    isFirstCallRef.current = true;

    const unsubscribe = playQueueManager.subscribe((state) => {
      if (isFirstCallRef.current) {
        isFirstCallRef.current = false;
        logger.debug("Skipping first notification (already initialized)", {
          context: "PlayQueueContext",
        });
        return;
      }

      logger.debug("Received play queue state update", {
        context: "PlayQueueContext",
        queueLength: state.queue.length,
        currentIndex: state.currentIndex,
        isLoading: state.isLoading,
      });

      setQueue(state.queue);
      setCurrentIndex(state.currentIndex);
      setIsLoading(state.isLoading);
    });

    return unsubscribe;
  }, []);

  const hasNext = useMemo(() => {
    return currentIndex >= 0 && currentIndex < queue.length - 1;
  }, [currentIndex, queue.length]);

  const nextVideo = useMemo(() => {
    if (!hasNext) return null;
    return queue[currentIndex + 1] || null;
  }, [hasNext, queue, currentIndex]);

  const progress = useMemo(() => {
    if (queue.length === 0 || currentIndex < 0) return "";
    return `${currentIndex + 1} of ${queue.length}`;
  }, [queue.length, currentIndex]);

  const buildQueue = useCallback(async (folderId: string, folderName: string, startVideoId: string, folderType: "folder" | "playlist" = "folder") => {
    await playQueueManager.buildQueue(folderId, folderName, startVideoId, folderType);
  }, []);

  const buildQueueFromItems = useCallback((items: JellyfinVideoItem[], folderId: string, folderName: string, startVideoId: string) => {
    playQueueManager.buildQueueFromItems(items, folderId, folderName, startVideoId);
  }, []);

  const advanceToNext = useCallback(() => {
    return playQueueManager.advanceToNext();
  }, []);

  const clear = useCallback(() => {
    playQueueManager.clear();
  }, []);

  const value = useMemo(
    () => ({
      queue,
      currentIndex,
      isLoading,
      hasNext,
      nextVideo,
      progress,
      buildQueue,
      buildQueueFromItems,
      advanceToNext,
      clear,
    }),
    [queue, currentIndex, isLoading, hasNext, nextVideo, progress, buildQueue, buildQueueFromItems, advanceToNext, clear],
  );

  return <PlayQueueContext.Provider value={value}>{children}</PlayQueueContext.Provider>;
}

export function usePlayQueue() {
  const context = useContext(PlayQueueContext);
  if (context === undefined) {
    throw new Error("usePlayQueue must be used within a PlayQueueProvider");
  }
  return context;
}
