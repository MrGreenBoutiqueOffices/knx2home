import { KnxCatalog } from "@/lib/types";
import { parseKnxproj } from "@/lib/knx/parse";
import { ParseProgress } from "@/lib/types/parse";
import { isKnxPasswordError } from "@/lib/knx/zipDecrypt";

type Req = { t: "parse"; file: File; password?: string };
type Res =
  | { t: "progress"; p: ParseProgress }
  | { t: "result"; catalog: KnxCatalog }
  | { t: "error"; message: string; code?: string };

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  if (msg.t !== "parse") return;

  try {
    const catalog = await parseKnxproj(msg.file, {
      password: msg.password,
      onProgress: (p) =>
        (self as unknown as Worker).postMessage({ t: "progress", p } as Res),
    });
    (self as unknown as Worker).postMessage({ t: "result", catalog } as Res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse failed";
    const code = isKnxPasswordError(err) ? err.code : undefined;
    (self as unknown as Worker).postMessage({ t: "error", message, code } as Res);
  }
};

export {};
