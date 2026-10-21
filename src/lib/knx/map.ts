import { KnxCatalog, KnxGroupObjectBinding, KnxGroupObjectRole, KnxFlags, MappedEntity, HaSwitch, HaBinarySensor, HaLight, HaSensor, HaTime, HaDate, HaDateTime, HaScene } from "../types";

// Clean, role/DPT-driven mapping. No name heuristics.
// Contract: consume only catalog.devices, catalog.groupAddresses.flat, and links/indexes
// Output: list of mapped entities (domain + payload), without duplicates.

export function buildEntitiesFromCatalog(catalog: KnxCatalog): MappedEntity[] {
  const result: MappedEntity[] = [];

  const gaById = catalog.indexes.groupAddressesById;

  // Helper to fetch GA by binding
  const getGa = (ref?: KnxGroupObjectBinding) => (ref?.groupAddressId ? gaById[ref.groupAddressId] : undefined);

  // Role helpers
  const byRole = (list: KnxGroupObjectBinding[], role: KnxGroupObjectRole) => list.filter((r) => r.role === role);
  const first = <T,>(arr: T[]): T | undefined => (arr.length ? arr[0] : undefined);

  // DPT helpers (normalize short forms like 9.1 -> 9.001)
  const normalizeDpt = (dpt?: string) => {
    if (!dpt) return dpt;
    const m = dpt.match(/^(\d+)\.(\d+)$/);
    if (!m) return dpt;
    const major = m[1];
    const minor = m[2].padStart(3, "0");
    return `${major}.${minor}`;
  };
  const eqDpt = (dpt: string | undefined, code: string) => normalizeDpt(dpt) === code;
  const isBoolDpt = (dpt?: string) => !!dpt && /^1\./.test(dpt);
  const isPercentDpt = (dpt?: string) => !!dpt && /^5\./.test(dpt);
  const isFloat2B = (dpt?: string) => !!dpt && /^9\./.test(dpt);
  const isFloat4B = (dpt?: string) => !!dpt && /^14\./.test(dpt);
  const isTime = (dpt?: string) => eqDpt(dpt, "10.001");
  const isDate = (dpt?: string) => eqDpt(dpt, "11.001");
  const isDateTime = (dpt?: string) => eqDpt(dpt, "19.001");
  const isScene = (dpt?: string) => !!dpt && /^18\./.test(dpt);

  const sensorTypeFromDpt = (dpt?: string): string => {
    const nd = normalizeDpt(dpt);
    switch (nd) {
      case "9.001": return "temperature";
      case "9.004": return "illuminance";
      case "9.006": return "humidity";
      case "9.008": return "pressure_2byte";
      default: return "sensor";
    }
  };

  // Emit helpers
  const pushSwitch = (name: string | undefined, on: string, state?: string) => {
    const e: HaSwitch = { name, address: on };
    if (state) e.state_address = state;
    result.push({ domain: "switch", payload: e });
  };
  const pushBinary = (name: string | undefined, state: string) => {
    const e: HaBinarySensor = { name, state_address: state };
    result.push({ domain: "binary_sensor", payload: e });
  };
  const pushLight = (
    name: string | undefined,
    on?: string,
    onState?: string,
    brightness?: string,
    brightnessState?: string
  ) => {
    if (!on && !brightness) return; // need at least one
    const e: HaLight = on ? { name, address: on } : { name, address: brightness! };
    if (onState) e.state_address = onState;
    if (brightness) e.brightness_address = brightness;
    if (brightnessState) e.brightness_state_address = brightnessState;
    result.push({ domain: "light", payload: e });
  };
  const pushSensor = (name: string | undefined, state: string, type: string) => {
    const e: HaSensor = { name, state_address: state, type };
    result.push({ domain: "sensor", payload: e });
  };
  // const pushCover = (name: string | undefined, part: Partial<HaCover>) => {
  //   result.push({ domain: "cover", payload: { name, ...part } });
  // };
  const pushTime = (name: string | undefined, addr: string) => result.push({ domain: "time", payload: { name, address: addr } as HaTime });
  const pushDate = (name: string | undefined, addr: string) => result.push({ domain: "date", payload: { name, address: addr } as HaDate });
  const pushDateTime = (name: string | undefined, addr: string) => result.push({ domain: "datetime", payload: { name, address: addr } as HaDateTime });
  const pushScene = (name: string | undefined, addr: string) => result.push({ domain: "scene", payload: { name, address: addr } as HaScene });

  // Iterate all com objects across devices and channels
  for (const dev of catalog.devices) {
    const emitFromComObject = (
      coName: string | undefined,
      bindings: KnxGroupObjectBinding[],
      dpt?: string,
      flags?: KnxFlags,
      consumedIds?: Set<string>,
      lightEmitted?: boolean
    ) => {
      const unknowns = bindings.filter((b) => b.role === "unknown");
      const writeB = byRole(bindings, "write");
      const stateB = [...byRole(bindings, "state"), ...byRole(bindings, "status"), ...byRole(bindings, "read")];
      // Fallback role deduction from flags (structured, not heuristics)
      const w = first(writeB) || (flags?.write ? first(unknowns) : undefined);
      const st = first(stateB) || ((flags?.read || flags?.update || flags?.transmit) ? first(unknowns) : undefined);
      const listen = first(byRole(bindings, "listen"));

      const gw = getGa(w);
      const gst = getGa(st);
      const gl = getGa(listen);

      const dptPref = (ga?: ReturnType<typeof getGa>) => ga?.datapointType || dpt;

      // If GA already consumed by a channel-level aggregate, skip
      if (consumedIds && ((gw?.id && consumedIds.has(gw.id)) || (gst?.id && consumedIds.has(gst.id)) || (gl?.id && consumedIds.has(gl.id)))) {
        return;
      }

      // Scenes
      if (gw?.address && isScene(dptPref(gw))) {
        pushScene(coName, gw.address);
        return;
      }

      // Switch / binary sensor based on presence of write vs read-only (skip if a light was already emitted at channel level)
      if (!lightEmitted) {
        if (gw?.address && isBoolDpt(dptPref(gw))) {
          pushSwitch(coName, gw.address, gst?.address);
          return;
        }
        if (!gw?.address && (gst?.address || gl?.address) && isBoolDpt(dptPref(gst) || dptPref(gl))) {
          pushBinary(coName, (gst?.address || gl?.address)!);
          return;
        }
      }

      // Light dimming at com-object level only if brightness (5.xxx) write is present and no channel-level light suppressed it
      const brightnessAddr = gw?.address && isPercentDpt(dptPref(gw)) ? gw.address : undefined;
      const brightnessStateAddr = gst?.address && isPercentDpt(dptPref(gst)) ? gst.address : undefined;
      const onOffAddr = gw?.address && isBoolDpt(dptPref(gw)) ? gw.address : undefined;
      const onOffStateAddr = gst?.address && isBoolDpt(dptPref(gst)) ? gst.address : undefined;
      if (!lightEmitted && brightnessAddr) {
        pushLight(coName, onOffAddr, onOffStateAddr, brightnessAddr, brightnessStateAddr);
        return;
      }

      // Common sensors (temperature, etc.) by DPT (prefer GA-level DPT)
      const stateAddr = gst?.address || gl?.address;
      const stateDpt = dptPref(gst) || dptPref(gl);
      if (stateAddr) {
        if (isFloat2B(stateDpt)) {
          pushSensor(coName, stateAddr, sensorTypeFromDpt(stateDpt));
          return;
        }
        if (isFloat4B(stateDpt)) {
          pushSensor(coName, stateAddr, "sensor");
          return;
        }
        if (isTime(stateDpt)) {
          pushTime(coName, stateAddr);
          return;
        }
        if (isDate(stateDpt)) {
          pushDate(coName, stateAddr);
          return;
        }
        if (isDateTime(stateDpt)) {
          pushDateTime(coName, stateAddr);
          return;
        }
      }

      // Conservative: if nothing matched but we have a listen GA with numeric type, expose as sensor
      if (gl?.address && (isPercentDpt(gl.datapointType) || isFloat2B(gl.datapointType) || isFloat4B(gl.datapointType))) {
        const t = isPercentDpt(gl.datapointType) ? "percent" : sensorTypeFromDpt(gl.datapointType);
        pushSensor(coName, gl.address, t);
        return;
      }
    };

    // device-level com objects
    for (const co of dev.comObjects) emitFromComObject(co.name, co.groupAddressRefs, co.datapointType, co.flags);
    // channel-level com objects with light aggregation per channel
    for (const ch of dev.channels) {
      // Build a simple view over all bindings with their co-level DPTs
      const all = ch.comObjects.flatMap((co) => co.groupAddressRefs.map((b) => ({ b, coDpt: co.datapointType })));
      const findGa = (predicate: (role: KnxGroupObjectRole, dpt: string | undefined) => boolean) => {
        for (const { b, coDpt } of all) {
          const ga = getGa(b);
          const dptHere = ga?.datapointType || coDpt;
          if (ga && predicate(b.role, dptHere)) return ga;
        }
        return undefined as ReturnType<typeof getGa> | undefined;
      };
      const isStateRole = (r: KnxGroupObjectRole) => r === "state" || r === "status" || r === "read";
      const brightnessWrite = findGa((role, dpt) => role === "write" && isPercentDpt(dpt));
      const brightnessState = findGa((role, dpt) => isStateRole(role) && isPercentDpt(dpt));
      const onOffWrite = findGa((role, dpt) => role === "write" && isBoolDpt(dpt));
      const onOffState = findGa((role, dpt) => isStateRole(role) && isBoolDpt(dpt));

      const consumed = new Set<string>();
      let lightEmitted = false;
      if (brightnessWrite?.address) {
        pushLight(ch.name, onOffWrite?.address, onOffState?.address, brightnessWrite.address, brightnessState?.address);
        lightEmitted = true;
        if (brightnessWrite.id) consumed.add(brightnessWrite.id);
        if (brightnessState?.id) consumed.add(brightnessState.id);
        if (onOffWrite?.id) consumed.add(onOffWrite.id);
        if (onOffState?.id) consumed.add(onOffState.id);
      }
      for (const co of ch.comObjects) {
        emitFromComObject(co.name, co.groupAddressRefs, co.datapointType, co.flags, consumed, lightEmitted);
      }
    }
  }

  // Deduplicate deterministically by a per-domain natural key
  const seen = new Set<string>();
  const keyFor = (m: MappedEntity): string => {
    switch (m.domain) {
      case "switch": return `sw|${m.payload.address}|${m.payload.state_address ?? ''}`;
      case "binary_sensor": return `bs|${m.payload.state_address}`;
      case "light": return `li|${m.payload.address}|${m.payload.brightness_address ?? ''}`;
      case "sensor": return `se|${m.payload.state_address}|${m.payload.type}`;
      case "time": return `ti|${m.payload.address}`;
      case "date": return `da|${m.payload.address}`;
      case "datetime": return `dt|${m.payload.address}`;
      case "cover": return `co|${JSON.stringify(m.payload)}`;
      case "scene": return `sc|${m.payload.address}|${m.payload.scene_number ?? ''}`;
      case "climate": return `cl|${m.payload.target_temperature_state_address}`;
      case "_unknown": return `un|${m.payload.address}|${m.payload.dpt ?? ''}`;
    }
  };
  const dedup = result.filter((m) => {
    const k = keyFor(m);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return dedup;
}
