"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KnxCatalog } from "@/lib/types";
import { ParseProgress } from "@/lib/types/parse";

type WorkerResponse =
  | { t: "progress"; p: ParseProgress }
  | { t: "result"; catalog: KnxCatalog }
  | { t: "error"; message: string; code?: string };

/** Error thrown by `parse`; `code` is set for password problems. */
export class KnxParseError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "KnxParseError";
    this.code = code;
  }
}

export function useKnxWorker() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressInfo, setProgressInfo] = useState<ParseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (catalog: KnxCatalog) => void;
    reject: (err: Error) => void;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const worker = new Worker(
      new URL("../workers/knxParser.worker.ts", import.meta.url),
      { type: "module" }
    );

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (!data) return;

      if (data.t === "progress") {
        setProgress(data.p.percent);
        setProgressInfo(data.p);
        return;
      }

      const pending = pendingRef.current;
      pendingRef.current = null;

      if (data.t === "result") {
        setProgress(100);
        setProgressInfo({ phase: "done", percent: 100 });
        setBusy(false);
        pending?.resolve(data.catalog);
        return;
      }

      if (data.t === "error") {
        setError(data.message);
        setBusy(false);
        const err = new KnxParseError(data.message, data.code);
        pending?.reject(err);
        return;
      }
    };

    const handleFailure = (message: string) => {
      setError(message);
      setProgress(0);
      setProgressInfo(null);
      setBusy(false);
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.reject(new Error(message));
    };

    worker.onmessage = handleMessage;
    worker.onerror = (event) => {
      handleFailure(event.message || "Worker error");
    };
    worker.onmessageerror = () => {
      handleFailure("Worker message error");
    };
    workerRef.current = worker;

    return () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      workerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) pending.reject(new Error("Parser worker terminated"));
    };
  }, []);

  const parse = useCallback(
    async (file: File, password?: string): Promise<KnxCatalog> => {
      if (!workerRef.current) throw new Error("Parser worker is not ready.");
      if (pendingRef.current) throw new Error("Parser is already working.");

      setBusy(true);
      setError(null);
      setProgress(0);
      setProgressInfo({ phase: "load_zip", percent: 0 });

      return new Promise<KnxCatalog>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        try {
          workerRef.current?.postMessage({ t: "parse", file, password: password || undefined });
        } catch (err) {
          pendingRef.current = null;
          const message =
            err instanceof Error ? err.message : "Could not start parser.";
          setBusy(false);
          setError(message);
          reject(new Error(message));
        }
      });
    },
    []
  );

  return { parse, busy, progress, progressInfo, error };
}
