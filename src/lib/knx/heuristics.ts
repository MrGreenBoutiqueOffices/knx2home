import type { HAType } from "../types";
import { normalizeDptToDot, normalizeDptToHyphen, isSceneLikeName } from "./utils";

function isStatusName(name: string): boolean {
  return /\bstatus\b/i.test(name);
}

function isCoverLike(name: string): boolean {
  return /(rolluik|jaloezie|lamel|screen|blind|shutter|cover|gordijn|raam|zonwering|zonnescherm|awning|louver|stores|volet)/i.test(
    name
  );
}

const TIME_HINT_RE =
  /(tijd|time|clock|rtc|uur|zeit|uhr|hora|heure|std|stunden|stunde|ntp|utc)/i;
const DATE_HINT_RE = /(datum|date|calendar|kalender|fecha|jour|tag|giorno)/i;
const DATETIME_HINT_RE =
  /(datetime|date[\s_/-]*time|tijdstempel|timestamp|zeitstempel)/i;
const SWITCH_HINT_RE = /(aan|uit|switch|centraal|on|off)/i;

export function isLA(name: string): boolean {
  return /^LA\d+/i.test(name) || /^LA\d+-/i.test(name);
}

export function guessEntityType(dpt: string | undefined, name: string, address?: string): HAType {
  // 1. User hints (optional explicit override)
  const hintMatch = name.match(/\[(\w+)\]/);
  if (hintMatch) {
    const hint = hintMatch[1].toLowerCase();
    if (['switch', 'light', 'cover', 'sensor', 'binary_sensor', 'scene'].includes(hint)) {
      return hint as HAType;
    }
  }

  // 2. Central group override
  if (address && address.startsWith("0/1/")) return "scene";

  const nd = normalizeDptToHyphen(dpt);
  const dot = normalizeDptToDot(dpt);
  const lowerName = name.toLowerCase();
  const isSwitchLike = SWITCH_HINT_RE.test(lowerName);
  const hasTimeHint = TIME_HINT_RE.test(lowerName);
  const hasDateHint = DATE_HINT_RE.test(lowerName);
  const hasBothTimeAndDateHints = hasTimeHint && hasDateHint;
  const explicitDateTimeHint = DATETIME_HINT_RE.test(lowerName);

  const isTimeDpt = dot === "10.001" || nd === "10-1";
  const isDateDpt = dot === "11.001" || nd === "11-1";
  const isDateTimeDpt = dot === "19.001" || nd === "19-1";

  // 3. Scene name hints (before DPT to allow override)
  if (isSceneLikeName(lowerName)) {
    return "scene";
  }

  // 4. DPT-based HARD classification (HIGHEST PRIORITY after scene names)
  if (nd) {
    // Scenes by DPT
    if (nd.startsWith("18-") || nd === "18" || nd.startsWith("17-") || nd === "17") {
      return "scene";
    }

    // Time/Date/DateTime
    if (isDateTimeDpt) {
      if (explicitDateTimeHint || hasBothTimeAndDateHints) return "datetime";
      if (!isSwitchLike) return "datetime";
    }
    if (isTimeDpt) {
      if (hasTimeHint) return "time";
      if (!isSwitchLike) return "time";
    }
    if (isDateDpt) {
      if (hasDateHint) return "date";
      if (!isSwitchLike) return "date";
    }

    // CRITICAL: Boolean DPT 1.1 = switch, NOT light (unless in aggregate context)
    if (nd === "1-1") {
      return isStatusName(name) ? "binary_sensor" : "switch";
    }

    // DPT 1.5 (alarm/fault), 1.6 (binary value), 1.9 (open/close) = binary sensors
    if (nd === "1-5" || nd === "1-6" || nd === "1-9") {
      return "binary_sensor";
    }

    // DPT 1.10 (start/stop) could be binary sensor or switch depending on name
    if (nd === "1-10") {
      return isStatusName(name) ? "binary_sensor" : "switch";
    }

    // Dimming control = light component
    if (nd === "3-7") return "light";

    // DPT 5.1: Cover keywords have priority over LA prefix!
    if (nd === "5-1") {
      if (isCoverLike(name)) return "cover";  // Cover first!
      if (isLA(name)) return "light";
      if (/(brightness|helderheid)/i.test(name)) return "light";
      return "sensor";
    }

    // DPT 5.3: Angle (cover or sensor)
    if (nd === "5-3") {
      return isCoverLike(name) ? "cover" : "sensor";
    }

    // Sensor DPTs
    if (nd.startsWith("7-") || nd.startsWith("8-") || nd.startsWith("9-") || nd === "9") {
      return "sensor";
    }
    if (nd === "12-1" || nd.startsWith("12-")) return "sensor";
    // Character strings (DPT 16) are read-only text sensors
    if (nd === "16" || nd.startsWith("16-")) return "sensor";

    // Cover DPTs
    if (nd === "1-7" || nd === "1-8" || nd === "1-10") return "cover";

    // Other switch DPTs
    if (nd === "1-2" || nd === "2-1") return "switch";

    // Other sensor DPTs
    if (nd === "20-102" || nd === "20-105") return "sensor";  // 20.102 = time delay, 20.105 = HVAC mode
  }

  // 5. Strong name-based hints
  if (isLA(name) || /(licht|light|lamp|dim)/.test(lowerName)) return "light";
  if (isCoverLike(name)) return "cover";
  if (isSceneLikeName(lowerName)) return "scene";
  if (/(temp|temperatuur|temperature|hum|co2|lux|druk|pressure|wind|rain|flow)/.test(lowerName)) {
    return "sensor";
  }
  if (isStatusName(name)) return "binary_sensor";

  // 6. Address pattern as LAST fallback (only if DPT unknown)
  if (!nd && address) {
    const m = address.match(/^(\d+)\/(\d+)\/(\d+)$/);
    if (m) {
      const main = Number(m[1]);
      const middle = Number(m[2]);
      if (main === 1 && [1, 2, 3, 4, 5].includes(middle)) {
        return "light";  // Only as fallback when DPT is unknown
      }
    }
  }

  if (isSwitchLike) return "switch";
  return "unknown";
}
