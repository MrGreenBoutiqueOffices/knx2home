import { buildHaEntities } from "@/lib/knx/export";

export type Entities = ReturnType<typeof buildHaEntities>;
export type EntityCollectionKey = keyof Entities;

export const DOMAIN_BY_COLLECTION = {
  switches: "switch",
  binarySensors: "binary_sensor",
  lights: "light",
  sensors: "sensor",
  times: "time",
  dates: "date",
  datetimes: "datetime",
  covers: "cover",
  climates: "climate",
  scenes: "scene",
  unknowns: "_unknown",
} as const;

export type EntityDomain = (typeof DOMAIN_BY_COLLECTION)[EntityCollectionKey];

export type DomainEntityMap = {
  switch: Entities["switches"][number];
  binary_sensor: Entities["binarySensors"][number];
  light: Entities["lights"][number];
  sensor: Entities["sensors"][number];
  time: Entities["times"][number];
  date: Entities["dates"][number];
  datetime: Entities["datetimes"][number];
  cover: Entities["covers"][number];
  climate: Entities["climates"][number];
  scene: Entities["scenes"][number];
  _unknown: Entities["unknowns"][number];
};

export type EntityOverride = {
  name?: string;
  invert_position?: boolean;
  invert_angle?: boolean;
};

export type EntityOverrides = Record<string, EntityOverride>;

export type KeyedEntity<K extends EntityCollectionKey> = {
  key: string;
  domain: (typeof DOMAIN_BY_COLLECTION)[K];
  base: Entities[K][number];
  current: Entities[K][number];
};

export type KeyedEntities = {
  [K in EntityCollectionKey]: KeyedEntity<K>[];
};

export function entityPrimaryIdentifier<D extends EntityDomain>(
  domain: D,
  entity: DomainEntityMap[D]
): string | null {
  if (domain === "switch" || domain === "light") {
    const typed = entity as DomainEntityMap["switch"];
    return typed.address ?? null;
  }
  if (domain === "binary_sensor" || domain === "sensor") {
    const typed = entity as DomainEntityMap["sensor"];
    return typed.state_address ?? null;
  }
  if (domain === "time" || domain === "date" || domain === "datetime") {
    const typed = entity as
      | DomainEntityMap["time"]
      | DomainEntityMap["date"]
      | DomainEntityMap["datetime"];
    return typed.state_address ?? null;
  }
  if (domain === "cover") {
    const typed = entity as DomainEntityMap["cover"];
    return (
      typed.move_long_address ??
      typed.move_short_address ??
      typed.position_address ??
      typed.stop_address ??
      null
    );
  }
  if (domain === "climate") {
    // the actual temperature GA can be shared by several rooms, the setpoint is unique
    const typed = entity as DomainEntityMap["climate"];
    return typed.target_temperature_state_address ?? typed.temperature_address ?? null;
  }
  if (domain === "scene") {
    const typed = entity as DomainEntityMap["scene"];
    return typed.address ?? null;
  }
  if (domain === "_unknown") {
    const typed = entity as DomainEntityMap["_unknown"];
    return typed.address ?? null;
  }
  return null;
}

export function makeEntityKey<D extends EntityDomain>(
  domain: D,
  entity: DomainEntityMap[D],
  index: number
): string {
  const primary = entityPrimaryIdentifier(domain, entity);
  const id = primary ? String(primary) : `#${index}`;
  return `${domain}:${id}`;
}

export function applyEntityOverride<D extends EntityDomain>(
  domain: D,
  key: string,
  base: DomainEntityMap[D],
  overrides?: EntityOverrides
) {
  if (!overrides) return base;
  const override = overrides[key];
  if (!override) return base;

  const next = { ...base } as DomainEntityMap[D];
  if (override.name !== undefined) next.name = override.name;
  if (domain === "cover") {
    const cover = next as DomainEntityMap["cover"];
    if (override.invert_position !== undefined) {
      cover.invert_position = override.invert_position;
    }
    if (override.invert_angle !== undefined) {
      cover.invert_angle = override.invert_angle;
    }
  }
  return next;
}

export function cleanOverride<D extends EntityDomain>(
  domain: D,
  base: DomainEntityMap[D],
  candidate: EntityOverride
): EntityOverride {
  const cleaned: EntityOverride = {};
  if (
    candidate.name !== undefined &&
    candidate.name !== (base.name ?? "")
  ) {
    cleaned.name = candidate.name;
  }

  if (domain === "cover") {
    const cover = base as DomainEntityMap["cover"];
    const baseInvertPos = Boolean(cover.invert_position);
    const baseInvertAngle = Boolean(cover.invert_angle);
    if (
      candidate.invert_position !== undefined &&
      candidate.invert_position !== baseInvertPos
    ) {
      cleaned.invert_position = candidate.invert_position;
    }
    if (
      candidate.invert_angle !== undefined &&
      candidate.invert_angle !== baseInvertAngle
    ) {
      cleaned.invert_angle = candidate.invert_angle;
    }
  }

  return cleaned;
}

export function hasOverrideValues(override: EntityOverride): boolean {
  return (
    override.name !== undefined ||
    override.invert_position !== undefined ||
    override.invert_angle !== undefined
  );
}

export function extractKeyIdentifier(key: string): string {
  const [, identifier] = key.split(":", 2);
  return identifier ?? key;
}
