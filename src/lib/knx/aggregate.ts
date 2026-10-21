import {
  GroupAddress,
  LightAggregate,
  MappedEntity,
  HaSwitch,
  HaBinarySensor,
  HaLight,
  HaSensor,
  HaTime,
  HaDate,
  HaDateTime,
  HaCover,
  UnknownEntity,
} from "../types";
import { isLA, guessEntityType } from "./heuristics";
import { parseAddress, normalizeDptToDot, normalizeDptToHyphen, isSceneLikeName } from "./utils";
import { KnxLinkInfo } from "../types";

/** ====================== MICRO OPTS / CACHES ====================== */
const STATUS_RE = /\bstatus\b/i;
const NAME_STRIP_RE =
  /\b(status|aan\/?uit|aan|uit|schakel|switch|cmd|command)\b/gi;

/** ====================== LIGHT AGGREGATE ====================== */
export function buildLaLightAggregates(gas: GroupAddress[]): LightAggregate[] {
  const byBase = new Map<string, LightAggregate>();

  for (const ga of gas) {
    if (!isLA(ga.name ?? "")) continue;
    const parts = parseAddress(ga.address);
    if (!parts) continue;

    const base = (ga.name ?? ga.address).trim();
    let agg = byBase.get(base);
    if (!agg) {
      agg = { name: base, consumedIds: new Set<string>() };
      byBase.set(base, agg);
    }

    const dpt = normalizeDptToHyphen(ga.dpt);
    if (dpt === "1-1") {
      if (parts.middle === 1) agg.on_off = ga.address;
      if (parts.middle === 5) agg.on_off_state = ga.address;
      agg.consumedIds.add(ga.id);
    } else if (dpt === "3-7") {
      if (parts.middle === 2) agg.dimming = ga.address;
      agg.consumedIds.add(ga.id);
    } else if (dpt === "5-1") {
      if (parts.middle === 3) agg.brightness = ga.address;
      if (parts.middle === 4) agg.brightness_state = ga.address;
      agg.consumedIds.add(ga.id);
    }
  }

  return Array.from(byBase.values()).filter(
    (a) => a.on_off || a.brightness || a.dimming
  );
}

/** ====================== ADDRESS-PATTERN LIGHT AGGREGATE (1/*) ====================== */
export function buildAddressLightAggregates(gas: GroupAddress[]): LightAggregate[] {
  // Map by sub index across middles for main group 1 (lighting)
  // 1/1/*: on/off command (1.001)
  // 1/5/*: on/off state (1.001)
  // 1/2/*: dimming step (3.007)
  // 1/3/*: brightness set (5.001)
  // 1/4/*: brightness state (5.001)
  type Key = number; // sub index
  const groups = new Map<Key, LightAggregate & { nameChosen?: boolean }>();

  for (const ga of gas) {
    const parts = parseAddress(ga.address);
    if (!parts) continue;
    if (parts.main !== 1) continue;

    // Skip central groups 1/0, 1/6, 1/7 from aggregation
    if (parts.middle === 0 || parts.middle === 6 || parts.middle === 7) continue;

    const dpt = normalizeDptToHyphen(ga.dpt);
    let g = groups.get(parts.sub);
    if (!g) {
      g = { name: ga.name ?? ga.address, consumedIds: new Set<string>() } as LightAggregate & {
        nameChosen?: boolean;
      };
      groups.set(parts.sub, g);
    }

    // Prefer naming from 1/1 (switch cmd) or 1/3 (brightness cmd)
    if (!g.nameChosen && (parts.middle === 1 || parts.middle === 3) && ga.name) {
      g.name = ga.name;
      g.nameChosen = true;
    }

    if (parts.middle === 1 && dpt === "1-1") {
      g.on_off = ga.address;
      g.consumedIds.add(ga.id);
      continue;
    }
    if (parts.middle === 5 && dpt === "1-1") {
      g.on_off_state = ga.address;
      g.consumedIds.add(ga.id);
      continue;
    }
    if (parts.middle === 2 && dpt === "3-7") {
      g.dimming = ga.address;
      g.consumedIds.add(ga.id);
      continue;
    }
    if (parts.middle === 3 && (dpt === "5-1" || dpt === "5")) {
      g.brightness = ga.address;
      g.consumedIds.add(ga.id);
      continue;
    }
    if (parts.middle === 4 && (dpt === "5-1" || dpt === "5")) {
      g.brightness_state = ga.address;
      g.consumedIds.add(ga.id);
      continue;
    }
  }

  // Only return aggregates that have brightness OR dimming (not just on/off)
  // Pure on/off switches should be handled by switch aggregation
  return Array.from(groups.values()).filter(
    (a) => a.brightness || a.dimming
  );
}

/** ====================== LINK-DRIVEN LIGHT AGGREGATE ====================== */
export function buildLinkedLightAggregates(
  gas: GroupAddress[],
  linksByGa?: Map<string, KnxLinkInfo>
): LightAggregate[] {
  if (!linksByGa) return [];

  type CtxKey = string;
  const byCtx = new Map<CtxKey, { items: GroupAddress[]; name?: string }>();
  const contextOf = (gaId: string): string | undefined => {
    const l = linksByGa!.get(gaId);
    return l?.comObject || l?.context;
  };
  const isStatus = (g: GroupAddress): boolean => /\bstatus\b|\bstate\b/i.test(g.name ?? "");
  const isReadFlag = (gaId: string): boolean => {
    const f = linksByGa!.get(gaId)?.flags || {};
    const v = f["ReadFlag"];
    return v === true || v === "true";
  };

  for (const g of gas) {
    const ctx = g.id ? contextOf(g.id) : undefined;
    if (!ctx) continue;
    let entry = byCtx.get(ctx);
    if (!entry) {
      entry = { items: [], name: undefined };
      byCtx.set(ctx, entry);
    }
    entry.items.push(g);
    if (!entry.name) entry.name = g.name;
  }

  const out: LightAggregate[] = [];

  byCtx.forEach(({ items, name }, ctx) => {
    // Look for GA types inside this context
    const oneBits: GroupAddress[] = [];
    const dimming: GroupAddress[] = [];
    const bright: GroupAddress[] = [];

    for (const g of items) {
      const d = normalizeDptToHyphen(g.dpt);
      if (d === "1-1") oneBits.push(g);
      else if (d === "3-7") dimming.push(g);
      else if (d === "5-1" || d === "5") bright.push(g);
    }

    if (oneBits.length === 0 && dimming.length === 0 && bright.length === 0)
      return;

    const agg: LightAggregate = { name: name ?? ctx, consumedIds: new Set<string>() };

    if (oneBits.length) {
      // choose command and status
      const cmd = oneBits.find((g) => !isStatus(g) && !isReadFlag(g.id)) || oneBits[0];
      const st = oneBits.find((g) => isStatus(g) || isReadFlag(g.id));
      if (cmd) {
        agg.on_off = cmd.address;
        agg.consumedIds.add(cmd.id);
      }
      if (st) {
        agg.on_off_state = st.address;
        agg.consumedIds.add(st.id);
      }
    }

    if (dimming.length) {
      agg.dimming = dimming[0].address;
      agg.consumedIds.add(dimming[0].id);
    }

    if (bright.length) {
      const st = bright.find((g) => isStatus(g) || isReadFlag(g.id));
      const cmd = bright.find((g) => !(isStatus(g) || isReadFlag(g.id))) || bright[0];
      if (cmd) {
        agg.brightness = cmd.address;
        agg.consumedIds.add(cmd.id);
      }
      if (st) {
        agg.brightness_state = st.address;
        agg.consumedIds.add(st.id);
      }
    }

    if (agg.on_off || agg.brightness || agg.dimming) out.push(agg);
  });

  return out;
}

/** ====================== NAME-BASED LIGHT AGGREGATE ====================== */
export function buildNameBasedLightAggregates(
  gas: GroupAddress[]
): LightAggregate[] {
  // Group by base name (strip common suffixes like s, d, w, status, aan, uit)
  const byBase = new Map<string, {
    agg: LightAggregate;
    candidates: GroupAddress[];
  }>();

  const stripSuffix = (name: string): string => {
    return name
      .replace(/\s+(s|d|w|status|aan|uit|on|off)$/i, '')
      .trim();
  };

  // First pass: group candidates by base name
  for (const ga of gas) {
    const baseName = stripSuffix(ga.name ?? '');
    if (!baseName) continue;

    let entry = byBase.get(baseName);
    if (!entry) {
      entry = {
        agg: { name: baseName, consumedIds: new Set<string>() },
        candidates: []
      };
      byBase.set(baseName, entry);
    }
    entry.candidates.push(ga);
  }

  // Second pass: build light aggregates from candidates
  const results: LightAggregate[] = [];

  for (const [baseName, { agg, candidates }] of byBase.entries()) {
    // Look for pattern: " s" (switch), " d" (dim), " w" (brightness)
    for (const ga of candidates) {
      const suffix = ga.name?.match(/\s+(s|d|w)$/i)?.[1]?.toLowerCase();
      const dpt = normalizeDptToHyphen(ga.dpt);

      // Match suffix + DPT combination
      if (suffix === 's' && dpt === '1-1') {
        agg.on_off = ga.address;
        agg.consumedIds.add(ga.id);
      } else if (suffix === 'd' && dpt === '3-7') {
        agg.dimming = ga.address;
        agg.consumedIds.add(ga.id);
      } else if (suffix === 'w' && dpt === '5-1') {
        agg.brightness = ga.address;
        agg.consumedIds.add(ga.id);
      }

      // Also check for status variants (without suffix but with "status" in name)
      if (!suffix && /status/i.test(ga.name ?? '')) {
        if (dpt === '1-1') {
          agg.on_off_state = ga.address;
          agg.consumedIds.add(ga.id);
        } else if (dpt === '5-1') {
          agg.brightness_state = ga.address;
          agg.consumedIds.add(ga.id);
        }
      }
    }

    // Only include if we have at least on/off OR brightness
    if (agg.on_off || agg.brightness) {
      results.push(agg);
    }
  }

  return results;
}

/** ====================== SWITCH AGGREGATE ====================== */
function isStatusName(name?: string): boolean {
  if (!name) return false;
  return STATUS_RE.test(name);
}
function normalizeBaseName(name?: string): string {
  const raw = (name ?? "");
  let n = raw.toLowerCase().trim();
  n = n.replace(NAME_STRIP_RE, "");
  n = n.replace(/\s+/g, " ").trim();
  return n.length ? n : raw.toLowerCase().trim();
}

export interface SwitchAggregate {
  name: string;
  address?: string;
  state_address?: string;
  consumedIds: Set<string>;
}

export function buildSwitchAggregates(
  gas: GroupAddress[],
  linksByGa?: Map<string, KnxLinkInfo>,
  comObjectLinks?: KnxLinkInfo[]
): SwitchAggregate[] {
  const byBase = new Map<string, SwitchAggregate>();

  for (const ga of gas) {
    // Do not treat central 0/1/* group addresses as switches; these are scenes
  if (ga.address?.startsWith("0/1/")) continue;

    const dpt = normalizeDptToHyphen(ga.dpt);
    if (dpt !== "1-1") continue;

  // Skip names that clearly indicate a scene so they'll map as scene later
  if (isSceneLikeName(ga.name ?? "")) continue;

    // Skip lighting central 'waarde sturen' middle 7 to avoid conflicting with scenes test data
    const parts = parseAddress(ga.address);
    if (parts && parts.main === 1 && parts.middle === 7) continue;

    const base = normalizeBaseName(ga.name ?? ga.address);
    let agg = byBase.get(base);
    if (!agg) {
      agg = { name: ga.name ?? ga.address, consumedIds: new Set<string>() };
      byBase.set(base, agg);
    }

    if (isStatusName(ga.name)) {
      if (!agg.state_address) agg.state_address = ga.address;
      agg.consumedIds.add(ga.id);
    } else {
      if (!agg.address) {
        agg.address = ga.address;
        agg.name = ga.name ?? agg.name;
      }
      agg.consumedIds.add(ga.id);
    }
  }
  const result = Array.from(byBase.values()).filter((a) => !!a.address);

  if (comObjectLinks?.length) pairSwitchStatesFromLinks(result, gas, comObjectLinks);

  if (!linksByGa) return result;

  // Link-driven pairing: if a switch has no state, try to find a matching state GA in same context
  const contextOf = (gaId?: string): string | undefined => {
    if (!gaId) return undefined;
    const l = linksByGa.get(gaId);
    return l?.comObject || l?.context;
  };
  const isReadFlag = (gaId: string): boolean => {
    const l = linksByGa.get(gaId);
    const f = l?.flags || {};
    const v = f["ReadFlag"];
    return v === true || v === "true";
  };

  for (const agg of result) {
    if (agg.state_address) continue;
    if (!agg.address) continue;

    // Find GA id for command
    const cmdGa = gas.find((g) => g.address === agg.address);
    if (!cmdGa) continue;
    const cmdCtx = contextOf(cmdGa.id);
    if (!cmdCtx) continue;

    // Candidates: same context, DPT 1-1, not the same GA
    const candidates: GroupAddress[] = [];
    for (const g of gas) {
      if (g.id === cmdGa.id) continue;
      const dpt = normalizeDptToHyphen(g.dpt);
      if (dpt !== "1-1") continue;
      const ctx = contextOf(g.id);
      if (!ctx) continue;
      if (ctx !== cmdCtx) continue;
      candidates.push(g);
    }

    // Prefer ones marked with ReadFlag or name indicating status
  let chosen: GroupAddress | undefined = candidates.find((g) => isReadFlag(g.id));
  if (!chosen) chosen = candidates.find((g) => isStatusName(g.name));
    if (!chosen) chosen = candidates[0];

    if (chosen) {
      agg.state_address = chosen.address;
      agg.consumedIds.add(chosen.id);
    }
  }

  return result;
}

/**
 * Uses ETS5/6 com object links to find the state GA of a switch:
 *  1. a com object that sends the command (first link) and listens to a state GA (e.g. a push button)
 *  2. another com object in the same actuator channel, if the channel has only one switching object
 * Only GAs with DPT 1.011 or a status-like name qualify as state.
 */
function pairSwitchStatesFromLinks(
  switches: SwitchAggregate[],
  gas: GroupAddress[],
  links: KnxLinkInfo[]
) {
  const gaById = new Map(gas.map((g) => [g.id, g] as const));
  const gaIdByAddress = new Map(gas.map((g) => [g.address, g.id] as const));
  const push = (map: Map<string, KnxLinkInfo[]>, key: string, l: KnxLinkInfo) =>
    (map.get(key) ?? map.set(key, []).get(key)!).push(l);
  // links are emitted in attribute order, so the first link per com object is its sending GA
  const byComObject = new Map<string, KnxLinkInfo[]>();
  const byChannel = new Map<string, KnxLinkInfo[]>();
  const byGa = new Map<string, KnxLinkInfo[]>();
  for (const l of links) {
    if (l.comObjectId) push(byComObject, l.comObjectId, l);
    if (l.channelId) push(byChannel, l.channelId, l);
    push(byGa, l.gaId, l);
  }
  const commandIds = new Set(
    switches.map((s) => (s.address ? gaIdByAddress.get(s.address) : undefined)).filter(Boolean)
  );
  const isStateGa = (gaId: string): GroupAddress | undefined => {
    const g = gaById.get(gaId);
    if (!g || commandIds.has(gaId)) return undefined;
    const dpt = normalizeDptToHyphen(g.dpt);
    if (dpt === "1-11") return g;
    if (dpt?.startsWith("1-") && (isStatusName(g.name) || /\bstate\b/i.test(g.name ?? ""))) return g;
    return undefined;
  };

  for (const agg of switches) {
    if (agg.state_address || !agg.address) continue;
    const cmdId = gaIdByAddress.get(agg.address);
    if (!cmdId) continue;
    const cmdLinks = byGa.get(cmdId) ?? [];

    // Only objects that send the command; listening objects (e.g. central off) are skipped
    const sendingLinks = cmdLinks.filter(
      (l) => byComObject.get(l.comObjectId ?? "")?.[0]?.gaId === cmdId
    );

    let chosen: GroupAddress | undefined;
    for (const cmdLink of sendingLinks) {
      const objectLinks = byComObject.get(cmdLink.comObjectId ?? "") ?? [];
      for (const l of objectLinks.slice(1)) {
        chosen = isStateGa(l.gaId);
        if (chosen) break;
      }
      if (chosen) break;
    }

    if (!chosen) {
      for (const cmdLink of sendingLinks) {
        if (!cmdLink.channelId) continue;
        const channelLinks = byChannel.get(cmdLink.channelId) ?? [];
        const switchingObjects = new Set(
          channelLinks.filter((l) => commandIds.has(l.gaId)).map((l) => l.comObjectId)
        );
        // e.g. shutter channels with wind alarm and enable objects: ambiguous
        if (switchingObjects.size !== 1) continue;
        for (const l of channelLinks) {
          if (l.comObjectId === cmdLink.comObjectId) continue;
          chosen = isStateGa(l.gaId);
          if (chosen) break;
        }
        if (chosen) break;
      }
    }

    if (chosen) {
      agg.state_address = chosen.address;
      agg.consumedIds.add(chosen.id);
    }
  }
}

export function collectConsumedIds(
  ...aggs: Array<{ consumedIds: Set<string> }[]>
): Set<string> {
  const consumed = new Set<string>();
  for (const group of aggs)
    for (const a of group) a.consumedIds.forEach((id) => consumed.add(id));
  return consumed;
}

/** ====================== SENSOR TYPE-MAPPING ====================== */
const DPT_TO_HA: Record<string, string> = {
  // 5.*
  "5": "1byte_unsigned",
  "5.001": "percent",
  "5.003": "angle",
  "5.004": "percentU8",
  "5.005": "decimal_factor",
  "5.006": "tariff",
  "5.010": "pulse",
  // 6.*
  "6": "1byte_signed",
  "6.001": "percentV8",
  "6.010": "counter_pulses",
  // 7.*
  "7": "2byte_unsigned",
  "7.001": "pulse_2byte",
  "7.002": "time_period_msec",
  "7.003": "time_period_10msec",
  "7.004": "time_period_100msec",
  "7.005": "time_period_sec",
  "7.006": "time_period_min",
  "7.007": "time_period_hrs",
  "7.011": "length_mm",
  "7.012": "current",
  "7.013": "brightness",
  "7.600": "color_temperature",
  // 8.*
  "8": "2byte_signed",
  "8.001": "pulse_2byte_signed",
  "8.002": "delta_time_ms",
  "8.003": "delta_time_10ms",
  "8.004": "delta_time_100ms",
  "8.005": "delta_time_sec",
  "8.006": "delta_time_min",
  "8.007": "delta_time_hrs",
  "8.010": "percentV16",
  "8.011": "rotation_angle",
  "8.012": "length_m",
  // 9.*
  "9": "2byte_float",
  "9.001": "temperature",
  "9.002": "temperature_difference_2byte",
  "9.003": "temperature_a",
  "9.004": "illuminance",
  "9.005": "wind_speed_ms",
  "9.006": "pressure_2byte",
  "9.007": "humidity",
  "9.008": "ppm",
  "9.009": "air_flow",
  "9.010": "time_1",
  "9.011": "time_2",
  "9.020": "voltage",
  "9.021": "curr",
  "9.022": "power_density",
  "9.023": "kelvin_per_percent",
  "9.024": "power_2byte",
  "9.025": "volume_flow",
  "9.026": "rain_amount",
  "9.027": "temperature_f",
  "9.028": "wind_speed_kmh",
  "9.029": "absolute_humidity",
  "9.030": "concentration_ugm3",
  // 12.*
  "12": "4byte_unsigned",
  "12.001": "pulse_4_ucount",
  "12.100": "long_time_period_sec",
  "12.101": "long_time_period_min",
};

const FALLBACK_PATTERNS = [
  [/temp|temperatuur/i, "temperature"],
  [/hum|humidity|rv/i, "humidity"],
  [/lux|illuminance|lichtsterkte/i, "illuminance"],
  [/\bppm\b|co2/i, "ppm"],
  [/volt|spanning|voltage/i, "voltage"],
  [/(^|\W)(amp|stroom|current|ma|a)($|\W)/i, "curr"],
  [/power|vermogen|watt|kw\b/i, "power_2byte"],
  [/press|druk/i, "pressure_2byte"],
  [/wind.*km\/?h/i, "wind_speed_kmh"],
  [/wind|windsnelheid/i, "wind_speed_ms"],
  [/rain|regen/i, "rain_amount"],
  [/flow|debiet/i, "volume_flow"],
] as const;

function fallbackTypeFromName(name?: string): string | undefined {
  if (!name) return undefined;
  for (const [re, t] of FALLBACK_PATTERNS) if (re.test(name)) return t;
  return undefined;
}

export function dptToSensorType(
  dpt?: string,
  name?: string
): string | undefined {
  const norm = normalizeDptToDot(dpt);
  if (norm === "10.001" || norm === "11.001" || norm === "19.001")
    return undefined;
  if (norm && DPT_TO_HA[norm]) return DPT_TO_HA[norm];

  if (norm === "5") return DPT_TO_HA["5"];
  if (norm === "6") return DPT_TO_HA["6"];
  if (norm === "7") return DPT_TO_HA["7"];
  if (norm === "8") return DPT_TO_HA["8"];
  if (norm === "9") return DPT_TO_HA["9"];
  if (norm === "12") return DPT_TO_HA["12"];

  return fallbackTypeFromName(name);
}

/** ====================== COVER AGGREGATE ====================== */
const RE_COVER_WORDS =
  /\b(rolluik|jaloezie|lamel|screen|blind|shutter|cover|gordijn|raam|schuifdeur|schuifdeuren|deur|door)\b/i; // GA names indicating cover-like devices
const RE_STATUS2 = /\b(status|state|feedback|actual|istwert)\b/i; // GA hints that carry feedback/state values
const RE_POS = /\b(pos(ition)?|positie|stand)\b/i; // GA names indicating slat/cover position
const RE_ANGLE = /\b(angle|tilt|lamel|hoek)\b/i; // GA names indicating slat tilt/angle control
const RE_STOP = /\bstop\b/i; // GA names for stop commands on the cover actuator
const RE_SHORT = /\b(short|step|stap|kort)\b/i; // GA names signalling short/stepwise movement
const RE_LONG = /\b(long|lang|up\/?down|omhoog|omlaag|open|close|sluit)\b/i; // GA names signalling long/continuous movement
const RE_INVERT = /\b(invert|omgekeerd|inverse)\b/i; // GA names signalling direction inversion

function coverBaseName(name?: string): string {
  let n = (name ?? "").toLowerCase();
  n = n
    .replace(RE_STATUS2, "")
    .replace(RE_POS, "")
    .replace(RE_ANGLE, "")
    .replace(RE_STOP, "")
    .replace(RE_SHORT, "")
    .replace(RE_LONG, "");
  n = n.replace(/\s+/g, " ").trim();
  return n || (name ?? "").toLowerCase();
}

export interface CoverAggregate {
  name: string;
  consumedIds: Set<string>;
  move_long_address?: string;
  move_short_address?: string;
  stop_address?: string;
  position_address?: string;
  position_state_address?: string;
  angle_address?: string;
  angle_state_address?: string;
  invert_position?: boolean;
  invert_angle?: boolean;
}

interface CoverEntryMeta {
  ga: GroupAddress;
  dpt: string | null;
  isCommand: boolean;
  isStop: boolean;
  isCoverLike: boolean;
  hasStatus: boolean;
  hasPositionHint: boolean;
  hasAngleHint: boolean;
  hasInvert: boolean;
}

export function buildCoverAggregates(
  gas: GroupAddress[],
  linksByGa?: Map<string, KnxLinkInfo>
): CoverAggregate[] {
  const groups = new Map<
    string,
    {
      name: string;
      entries: CoverEntryMeta[];
      hasCommand: boolean;
    }
  >();

  for (const ga of gas) {
    const name = ga.name ?? "";
    const key = coverBaseName(name || ga.address);
    const d = normalizeDptToHyphen(ga.dpt);
    const isCoverLike = RE_COVER_WORDS.test(name);
    const isStop = RE_STOP.test(name);
    const isCommand =
      d === "1-7" ||
      d === "1-8" ||
      d === "1-10" ||
      isStop ||
      RE_LONG.test(name) ||
      RE_SHORT.test(name);

    const entry: CoverEntryMeta = {
      ga,
      dpt: d,
      isCommand,
      isStop,
      isCoverLike,
      hasStatus: RE_STATUS2.test(name),
      hasPositionHint: d === "5-1" || RE_POS.test(name),
      hasAngleHint: d === "5-3" || RE_ANGLE.test(name),
      hasInvert: RE_INVERT.test(name),
    };

    let group = groups.get(key);
    if (!group) {
      group = {
        name: name || ga.address,
        entries: [],
        hasCommand: false,
      };
      groups.set(key, group);
    }

    if (isCommand && !group.hasCommand) {
      group.name = name || group.name;
    }

    group.entries.push(entry);
    if (isCommand) group.hasCommand = true;
  }

  const aggregates: CoverAggregate[] = [];

  groups.forEach((group) => {
    const agg: CoverAggregate = {
      name: group.name,
      consumedIds: new Set<string>(),
    };

    for (const entry of group.entries) {
      const {
        ga,
        dpt,
        isCommand,
        isStop,
        isCoverLike,
        hasStatus,
        hasPositionHint,
        hasAngleHint,
        hasInvert,
      } = entry;

      if (isCommand) {
        if (dpt === "1-8" || (dpt === "1-10" && !isStop)) {
          if (!agg.move_long_address) agg.move_long_address = ga.address;
          agg.consumedIds.add(ga.id);
        } else if (dpt === "1-7") {
          if (!agg.move_short_address) agg.move_short_address = ga.address;
          agg.consumedIds.add(ga.id);
        } else if (dpt === "1-10" && isStop) {
          if (!agg.stop_address) agg.stop_address = ga.address;
          agg.consumedIds.add(ga.id);
        }

        if (hasInvert) agg.invert_position = true;
        continue;
      }

      const eligible = group.hasCommand || isCoverLike;
      if (!eligible) continue;

      if (hasPositionHint) {
        if (hasStatus) {
          if (!agg.position_state_address)
            agg.position_state_address = ga.address;
        } else {
          if (!agg.position_address) agg.position_address = ga.address;
        }
        agg.consumedIds.add(ga.id);
        if (hasInvert && !hasAngleHint) agg.invert_position = true;
        continue;
      }

      if (hasAngleHint) {
        if (hasStatus) {
          if (!agg.angle_state_address) agg.angle_state_address = ga.address;
        } else {
          if (!agg.angle_address) agg.angle_address = ga.address;
        }
        agg.consumedIds.add(ga.id);
        if (hasInvert) agg.invert_angle = true;
        continue;
      }

      if (hasInvert) {
        agg.invert_position = true;
      }
    }

    if (
      agg.move_long_address ||
      agg.move_short_address ||
      agg.stop_address ||
      agg.position_address ||
      agg.position_state_address ||
      agg.angle_address ||
      agg.angle_state_address
    ) {
      aggregates.push(agg);
    }
  });

  // Link-driven fill-ins for missing state addresses
  if (linksByGa) {
    const contextOf = (gaId: string): string | undefined => {
      const l = linksByGa.get(gaId);
      return l?.comObject || l?.context;
    };
    const isReadFlag = (gaId: string): boolean => {
      const f = linksByGa.get(gaId)?.flags || {};
      const v = f["ReadFlag"];
      return v === true || v === "true";
    };
    // Build lookup by address -> GA
    const byAddress = new Map(gas.map((g) => [g.address, g] as const));
    const groupByContext = new Map<string, GroupAddress[]>();
    for (const g of gas) {
      const ctx = contextOf(g.id);
      if (!ctx) continue;
      const arr = groupByContext.get(ctx) ?? [];
      arr.push(g);
      groupByContext.set(ctx, arr);
    }

    for (const agg of aggregates) {
      const seedAddr =
        agg.position_address ||
        agg.angle_address ||
        agg.move_long_address ||
        agg.move_short_address ||
        agg.stop_address;
      if (!seedAddr) continue;
      const seedGa = byAddress.get(seedAddr);
      if (!seedGa) continue;
      const ctx = contextOf(seedGa.id);
      if (!ctx) continue;
      const peers = groupByContext.get(ctx) ?? [];

      if (agg.position_address && !agg.position_state_address) {
        const cand = peers
          .filter((g) => normalizeDptToHyphen(g.dpt)?.startsWith("5-") && (RE_STATUS2.test(g.name ?? "") || isReadFlag(g.id)))
          .find((g) => normalizeDptToHyphen(g.dpt) === "5-1");
        if (cand) {
          agg.position_state_address = cand.address;
          agg.consumedIds.add(cand.id);
        }
      }

      if (agg.angle_address && !agg.angle_state_address) {
        const cand = peers
          .filter((g) => normalizeDptToHyphen(g.dpt)?.startsWith("5-") && (RE_STATUS2.test(g.name ?? "") || isReadFlag(g.id)))
          .find((g) => normalizeDptToHyphen(g.dpt) === "5-3");
        if (cand) {
          agg.angle_state_address = cand.address;
          agg.consumedIds.add(cand.id);
        }
      }
    }
  }

  return aggregates;
}

/** ====================== Fallback mapping for single GA's ====================== */

function assignCoverValue(
  payload: HaCover,
  kind: "position" | "angle",
  address: string,
  hasStatus: boolean
): void {
  if (kind === "angle") {
    if (hasStatus) payload.angle_state_address = address;
    else payload.angle_address = address;
    return;
  }
  if (hasStatus) payload.position_state_address = address;
  else payload.position_address = address;
}

export function mapSingleGaToEntity(ga: GroupAddress): MappedEntity {
  // Treat central 0/1/* addresses as scenes, regardless of DPT
  if (ga.address?.startsWith("0/1/")) {
    const m = (ga.name ?? "").match(/\b(\d{1,2})\b/);
    const scene_number = m ? parseInt(m[1], 10) : undefined;
    const payload = { name: ga.name, address: ga.address, scene_number };
    return { domain: "scene", payload } as MappedEntity;
  }

  const t = guessEntityType(ga.dpt, ga.name ?? "", ga.address);
  const dptHyphen = normalizeDptToHyphen(ga.dpt);

  if (t === "switch") {
    const payload: HaSwitch = { name: ga.name, address: ga.address };
    return { domain: "switch", payload };
  }

  if (t === "binary_sensor") {
    const payload: HaBinarySensor = {
      name: ga.name,
      state_address: ga.address,
    };
    return { domain: "binary_sensor", payload };
  }

  if (t === "light") {
    if (dptHyphen === "1-1") {
      const payload: HaLight = { name: ga.name, address: ga.address };
      return { domain: "light", payload };
    }
    if (dptHyphen === "5-1") {
      const payload: HaSensor = {
        name: ga.name,
        state_address: ga.address,
        type: "percent",
      };
      return { domain: "sensor", payload };
    }
  }

  if (t === "scene") {
    const m = (ga.name ?? "").match(/\b(\d{1,2})\b/);
    const scene_number = m ? parseInt(m[1], 10) : undefined;
    const payload = { name: ga.name, address: ga.address, scene_number };
    return { domain: "scene", payload } as MappedEntity;
  }

  if (t === "sensor") {
    const sensorType = dptToSensorType(ga.dpt, ga.name ?? "");
    if (sensorType) {
      const payload: HaSensor = {
        name: ga.name,
        state_address: ga.address,
        type: sensorType,
      };
      return { domain: "sensor", payload };
    }
    const unknownPayload: UnknownEntity = {
      name: ga.name ?? ga.address,
      address: ga.address,
      dpt: ga.dpt,
    };
    return { domain: "_unknown", payload: unknownPayload };
  }

  if (t === "time") {
    const payload: HaTime = {
      name: ga.name,
      address: ga.address,
      state_address: ga.address,
    };
    return { domain: "time", payload };
  }

  if (t === "date") {
    const payload: HaDate = {
      name: ga.name,
      address: ga.address,
      state_address: ga.address,
    };
    return { domain: "date", payload };
  }

  if (t === "datetime") {
    const payload: HaDateTime = {
      name: ga.name,
      address: ga.address,
      state_address: ga.address,
    };
    return { domain: "datetime", payload };
  }

  if (t === "cover") {
    const payload: HaCover = { name: ga.name };
    const dptHyphen = normalizeDptToHyphen(ga.dpt);
    const nm = ga.name ?? "";
    const hasStatus = RE_STATUS2.test(nm);
    const hasAngleHint = RE_ANGLE.test(nm);
    const hasPositionHint = RE_POS.test(nm);
    const hasInvert = RE_INVERT.test(nm);
    const isStopName = RE_STOP.test(nm);

    let invertTargetsAngle = false;

    if (dptHyphen === "1-7") {
      payload.move_short_address = ga.address;
    } else if (dptHyphen === "1-8" || (dptHyphen === "1-10" && !isStopName)) {
      payload.move_long_address = ga.address;
    } else if (dptHyphen === "1-10" && isStopName) {
      payload.stop_address = ga.address;
    } else if (dptHyphen === "5-3") {
      invertTargetsAngle = true;
      assignCoverValue(payload, "angle", ga.address, hasStatus);
    } else if (dptHyphen === "5-1" || dptHyphen === "5") {
      assignCoverValue(payload, "position", ga.address, hasStatus);
    } else if (dptHyphen && dptHyphen.startsWith("5-")) {
      if (hasAngleHint && !hasPositionHint) {
        invertTargetsAngle = true;
        assignCoverValue(payload, "angle", ga.address, hasStatus);
      } else {
        assignCoverValue(payload, "position", ga.address, hasStatus);
      }
    }

    const recognized = Boolean(
      payload.move_long_address ||
        payload.move_short_address ||
        payload.stop_address ||
        payload.position_address ||
        payload.position_state_address ||
        payload.angle_address ||
        payload.angle_state_address
    );

    if (recognized) {
      if (hasInvert) {
        if (invertTargetsAngle) payload.invert_angle = true;
        else payload.invert_position = true;
      }
      return { domain: "cover", payload };
    }
  }

  const payload: UnknownEntity = {
    name: ga.name ?? ga.address,
    address: ga.address,
    dpt: ga.dpt,
  };
  return { domain: "_unknown", payload };
}
