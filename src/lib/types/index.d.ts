export type KnxId = string;

export interface KnxProjectMeta {
  name: string;
  etsVersion?: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface KnxTopology {
  areas: KnxArea[];
}

export interface KnxArea {
  id: KnxId;
  name?: string;
  address?: string;
  lines: KnxLine[];
}

export interface KnxLine {
  id: KnxId;
  name?: string;
  address?: string;
  segments?: KnxSegment[];
  devices: KnxDevice[];
}

export interface KnxSegment {
  id: KnxId;
  name?: string;
  address?: string;
}

export interface KnxDevice {
  id: KnxId;
  name?: string;
  address?: string;
  description?: string;
  manufacturerRef?: string;
  productRef?: string;
  hardwareRef?: string;
  applicationProgramRef?: string;
  parameters?: Record<string, string | number | boolean | null>;
  channels: KnxChannel[];
  comObjects: KnxComObject[];
}

export interface KnxChannel {
  id: KnxId;
  name?: string;
  number?: number;
  description?: string;
  comObjects: KnxComObject[];
}

export interface KnxComObject {
  id: KnxId;
  name?: string;
  number?: number;
  description?: string;
  datapointType?: string;
  rawDatapointType?: string;
  bitLength?: number;
  priority?: string;
  flags: KnxFlags;
  groupAddressRefs: KnxGroupObjectBinding[];
  channelId?: KnxId;
  deviceId?: KnxId;
}

export interface KnxFlags {
  read?: boolean;
  write?: boolean;
  transmit?: boolean;
  update?: boolean;
  readOnInit?: boolean;
  communication?: boolean;
  visibility?: boolean;
  priority?: string;
  [key: string]: boolean | string | undefined;
}

export type KnxGroupObjectRole =
  | "write"
  | "state"
  | "read"
  | "status"
  | "listen"
  | "unknown";

export interface KnxGroupObjectBinding {
  role: KnxGroupObjectRole;
  groupAddressId: KnxId;
  refId?: KnxId;
  source?: string;
  attributes?: Record<string, string>;
  stack?: KnxStackFrame[];
}

export interface KnxGroupAddressTree {
  mainGroups: KnxGroupLevel[];
}

export interface KnxGroupLevel {
  id: KnxId;
  name?: string;
  address?: string;
  level: "main" | "middle" | "sub" | "range" | "unknown";
  parentId?: KnxId;
  children: KnxGroupLevel[];
  items?: KnxGroupAddress[];
}

export interface KnxSecurityInfo {
  isSecure?: boolean;
  keyringRef?: string;
  attributes?: Record<string, string>;
}

export interface KnxGroupAddress {
  id: KnxId;
  address: string;
  name?: string;
  description?: string;
  datapointType?: string;
  rawDatapointType?: string;
  flags?: KnxFlags;
  security?: KnxSecurityInfo;
  priority?: string;
  bitLength?: number;
  contextPath?: string;
  meta?: GroupAddressMeta;
  links?: KnxLinkInfo[];
}

export interface KnxStackFrame {
  tag: string;
  attributes?: Record<string, string>;
  name?: string;
}

export interface GroupAddressMeta {
  source?: string;
  tag?: string;
  context?: string;
  attributes?: Record<string, string>;
  stack?: KnxStackFrame[];
}

export interface KnxLinkInfo {
  gaId: string;
  comObjectId?: string;
  channelId?: string;
  deviceId?: string;
  context?: string;
  comObject?: string;
  dpt?: string;
  flags?: Record<string, boolean | string>;
  role?: KnxGroupObjectRole;
  /** "links" when read from an ETS5/6 `Links` attribute instead of a `GroupAddressRef` element. */
  origin?: "groupAddressRef" | "links";
  source?: string;
  attributes?: Record<string, string>;
  stack?: KnxStackFrame[];
}

export interface KnxIndexes {
  groupAddressesById: Record<string, KnxGroupAddress>;
  comObjectsById: Record<string, KnxComObject>;
  devicesById: Record<string, KnxDevice>;
}

export interface KnxCatalogStats {
  totals: {
    groupAddresses: number;
    devices: number;
    comObjects: number;
  };
  dptUsage: Record<string, number>;
  secure: {
    hasSecure: boolean;
    secureGroupAddressCount: number;
  };
}

export interface KnxParseReport {
  missingDatapointTypes: {
    groupAddresses: string[];
    comObjects: string[];
  };
  roleUnknown: string[];
  datapointConflicts: Array<{
    groupAddressId: string;
    comObjectId: string;
    groupAddressDpt?: string;
    comObjectDpt?: string;
  }>;
  duplicateBindings: Array<{
    groupAddressId: string;
    bindings: Array<{
      deviceId?: string;
      channelId?: string;
      comObjectId?: string;
      role: KnxGroupObjectRole;
    }>;
  }>;
  secureHints: {
    hasSecure: boolean;
    details: string[];
  };
  parsingNotes: string[];
}

export interface GroupAddressCompat {
  id: string;
  name: string;
  address: string;
  description?: string;
  dpt?: string;
  meta?: GroupAddressMeta;
  links?: KnxLinkInfo[];
}

export interface KnxCatalog {
  meta: KnxProjectMeta;
  topology: KnxTopology;
  devices: KnxDevice[];
  groupAddresses: {
    tree: KnxGroupAddressTree;
    flat: KnxGroupAddress[];
  };
  indexes: KnxIndexes;
  stats: KnxCatalogStats;
  report: KnxParseReport;
  // Legacy compatibility for existing HA export pipeline
  group_addresses: GroupAddressCompat[];
  links?: KnxLinkInfo[];
}

// Legacy GA shape used by aggregate helpers and legacy tests
export type GroupAddress = {
  id: KnxId;
  name?: string;
  address: string;
  dpt?: string;
  description?: string;
};

export type HAType =
  | "switch"
  | "binary_sensor"
  | "light"
  | "sensor"
  | "cover"
  | "time"
  | "date"
  | "datetime"
  | "scene"
  | "unknown";

export interface HaSwitch {
  name?: string;
  address: string;
  state_address?: string;
  invert?: boolean;
  respond_to_read?: boolean;
  entity_category?: string;
  device_class?: string;
}

export interface HaBinarySensor {
  name?: string;
  state_address: string;
  device_class?: string;
  entity_category?: string;
}

export interface HaLight {
  name?: string;
  address: string;
  state_address?: string;
  brightness_address?: string;
  brightness_state_address?: string;
}

export interface HaSensor {
  name?: string;
  state_address: string;
  type: string;
}

export interface HaTime {
  name?: string;
  address: string;
  state_address?: string;
  respond_to_read?: boolean;
  sync_state?: boolean | string | number;
  entity_category?: string;
}

export interface HaDate {
  name?: string;
  address: string;
  state_address?: string;
  respond_to_read?: boolean;
  sync_state?: boolean | string | number;
  entity_category?: string;
}

export interface HaDateTime {
  name?: string;
  address: string;
  state_address?: string;
  respond_to_read?: boolean;
  sync_state?: boolean | string | number;
  entity_category?: string;
}

export interface HaCover {
  name?: string;
  move_long_address?: string;
  move_short_address?: string;
  stop_address?: string;
  position_address?: string;
  position_state_address?: string;
  angle_address?: string;
  angle_state_address?: string;
  invert_position?: boolean;
  invert_angle?: boolean;
  travelling_time_up?: number;
  travelling_time_down?: number;
}

export interface HaScene {
  name?: string;
  address: string;
  scene_number?: number;
}

export interface HaClimate {
  name?: string;
  temperature_address: string;
  target_temperature_address?: string;
  target_temperature_state_address: string;
  setpoint_shift_address?: string;
  setpoint_shift_state_address?: string;
  setpoint_shift_mode?: "DPT6010" | "DPT9002";
  operation_mode_address?: string;
  operation_mode_state_address?: string;
  controller_mode_address?: string;
  controller_mode_state_address?: string;
  heat_cool_state_address?: string;
  active_state_address?: string;
  command_value_state_address?: string;
  humidity_state_address?: string;
}

export interface UnknownEntity {
  name: string;
  address: string;
  dpt?: string;
}

export interface HaWeather {
  name?: string;
  address_temperature: string;
  address_brightness_south?: string;
  address_brightness_west?: string;
  address_brightness_east?: string;
  address_brightness_north?: string;
  address_wind_speed?: string;
  address_wind_bearing?: string;
  address_rain_alarm?: string;
  address_frost_alarm?: string;
  address_wind_alarm?: string;
  address_day_night?: string;
  address_air_pressure?: string;
  address_humidity?: string;
}

export type MappedEntity =
  | { domain: "switch"; payload: HaSwitch }
  | { domain: "binary_sensor"; payload: HaBinarySensor }
  | { domain: "light"; payload: HaLight }
  | { domain: "sensor"; payload: HaSensor }
  | { domain: "time"; payload: HaTime }
  | { domain: "date"; payload: HaDate }
  | { domain: "datetime"; payload: HaDateTime }
  | { domain: "cover"; payload: HaCover }
  | { domain: "scene"; payload: HaScene }
  | { domain: "climate"; payload: HaClimate }
  | { domain: "weather"; payload: HaWeather }
  | { domain: "_unknown"; payload: UnknownEntity };

export interface ExportOptions {
  dropReserveFromUnknown?: boolean;
}

export interface LightAggregate {
  name: string;
  on_off?: string;
  on_off_state?: string;
  brightness?: string;
  brightness_state?: string;
  dimming?: string;
  consumedIds: Set<string>;
}
