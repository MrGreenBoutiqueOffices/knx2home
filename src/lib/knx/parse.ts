import { unzip } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type {
  GroupAddressCompat,
  GroupAddressMeta,
  KnxArea,
  KnxCatalog,
  KnxChannel,
  KnxComObject,
  KnxDevice,
  KnxFlags,
  KnxGroupAddress,
  KnxGroupAddressTree,
  KnxGroupLevel,
  KnxGroupObjectRole,
  KnxId,
  KnxIndexes,
  KnxLinkInfo,
  KnxParseReport,
  KnxProjectMeta,
  KnxSegment,
  KnxStackFrame,
  KnxTopology,
  KnxLine,
  KnxCatalogStats,
} from "../types";
import { ParseProgress } from "../types/parse";
import { decodeGaIntToTriple } from "./utils";
import { extractProtectedProject } from "./zipDecrypt";

/** ====================== GENERAL HELPERS ====================== */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

interface StackItem {
  tag: string;
  name?: string;
  attrs: Record<string, string>;
}

interface PartialArea {
  id: KnxId;
  name?: string;
  address?: string;
  lines: Set<KnxId>;
  attrs: Record<string, string>;
}

interface PartialLine {
  id: KnxId;
  name?: string;
  address?: string;
  segments: Set<KnxId>;
  devices: Set<KnxId>;
  attrs: Record<string, string>;
}

interface PartialSegment {
  id: KnxId;
  name?: string;
  address?: string;
  attrs: Record<string, string>;
}

interface PartialDeviceInstance {
  id: KnxId;
  name?: string;
  description?: string;
  address?: string;
  manufacturerRef?: string;
  productRef?: string;
  hardwareRef?: string;
  applicationProgramRef?: string;
  parameters: Record<string, string | number | boolean | null>;
  channelIds: Set<KnxId>;
  comObjectIds: Set<KnxId>;
  attrs: Record<string, string>;
}

interface PartialChannelInstance {
  id: KnxId;
  name?: string;
  description?: string;
  number?: number;
  comObjectIds: Set<KnxId>;
  attrs: Record<string, string>;
}

interface PartialComObjectInstance {
  id: KnxId;
  name?: string;
  description?: string;
  number?: number;
  datapointType?: string;
  rawDatapointType?: string;
  bitLength?: number;
  priority?: string;
  flags: KnxFlags;
  channelId?: KnxId;
  deviceId?: KnxId;
  definitionRef?: KnxId;
  groupAddressRefs: PartialGroupAddressBinding[];
  attrs: Record<string, string>;
}

interface PartialComObjectDefinition {
  id: KnxId;
  name?: string;
  number?: number;
  datapointType?: string;
  rawDatapointType?: string;
  bitLength?: number;
  priority?: string;
  flags: KnxFlags;
  attrs: Record<string, string>;
}

interface PartialGroupRange {
  id: KnxId;
  name?: string;
  address?: string;
  level: "main" | "middle" | "sub" | "range" | "unknown";
  parentId?: KnxId;
  children: Set<KnxId>;
  groupIds: Set<KnxId>;
  attrs: Record<string, string>;
}

interface PartialGroupAddress {
  id: KnxId;
  address?: string;
  mainGroup?: number;
  middleGroup?: number;
  subGroup?: number;
  addressString?: string;
  name?: string;
  description?: string;
  datapointType?: string;
  rawDatapointType?: string;
  flags?: KnxFlags;
  security?: {
    isSecure?: boolean;
    keyringRef?: string;
    attributes?: Record<string, string>;
  };
  priority?: string;
  bitLength?: number;
  parentRangeId?: KnxId;
  context?: string;
  meta?: GroupAddressMeta;
  attrs: Record<string, string>;
}

interface PartialGroupAddressBinding {
  id: string;
  role: KnxGroupObjectRole;
  groupAddressId?: KnxId;
  groupAddressRef?: string;
  comObjectId?: KnxId;
  channelId?: KnxId;
  deviceId?: KnxId;
  source: string;
  attributes: Record<string, string>;
  stack: KnxStackFrame[];
}

interface ParseState {
  entries: Record<string, Uint8Array>;
  meta: Partial<KnxProjectMeta>;
  areas: Map<KnxId, PartialArea>;
  lines: Map<KnxId, PartialLine>;
  segments: Map<KnxId, PartialSegment>;
  devices: Map<KnxId, PartialDeviceInstance>;
  channels: Map<KnxId, PartialChannelInstance>;
  comObjects: Map<KnxId, PartialComObjectInstance>;
  comObjectDefinitions: Map<KnxId, PartialComObjectDefinition>;
  groupRanges: Map<KnxId, PartialGroupRange>;
  groupAddresses: Map<KnxId, PartialGroupAddress>;
  bindings: PartialGroupAddressBinding[];
  linkInfos: KnxLinkInfo[];
  parsingNotes: string[];
  secureHints: Set<string>;
}

const SCAN_RANGE: [number, number] = [0, 20];
const FILE_RANGE: [number, number] = [20, 80];
const BUILD_RANGE: [number, number] = [80, 95];
const FINAL_RANGE: [number, number] = [95, 100];
// NOTE: Previously used for progress granularity; remove if unused to satisfy linters

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function rangePercent(range: [number, number], t: number): number {
  const [start, end] = range;
  return start + (end - start) * clamp01(t);
}

function normalizeBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const norm = value.trim().toLowerCase();
  if (norm === "true" || norm === "1" || norm === "yes") return true;
  if (norm === "false" || norm === "0" || norm === "no") return false;
  return undefined;
}

function normalizeNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeDatapoint(value: string | undefined): { canonical?: string; raw?: string } {
  if (!value) return {};
  const raw = value.trim();
  if (!raw) return {};
  let canonical = raw;
  const lower = raw.toLowerCase();
  if (lower.startsWith("dpt-")) {
    canonical = raw.slice(4);
  } else if (lower.startsWith("dpst-")) {
    const parts = lower.split("-").slice(1);
    if (parts.length >= 2) canonical = `${parseInt(parts[0] || "", 10)}.${parts[1]}`;
  } else if (/^\d+-\d+$/.test(lower)) {
    const [main, sub] = lower.split("-");
    canonical = `${parseInt(main, 10)}.${sub}`;
  } else if (/^\d+\.\d+$/.test(lower)) {
    canonical = raw;
  }
  return { canonical, raw };
}

function tagEndsWith(tag: string, suffix: string): boolean {
  const last = tag.split(":").pop() || tag;
  return last.toLowerCase() === suffix.toLowerCase();
}

function extractAttributes(node: unknown): Record<string, string> {
  if (typeof node !== "object" || node === null) return {};
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("@_")) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attrs[key.slice(2)] = String(value);
    }
  }
  return attrs;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotStack(stack: StackItem[]): KnxStackFrame[] {
  return stack.map((frame) => ({
    tag: frame.tag,
    name: frame.name,
    attributes: { ...frame.attrs },
  }));
}

function buildContextPath(stack: StackItem[]): string | undefined {
  const names: string[] = [];
  for (let i = 0; i < stack.length; i++) {
    const item = stack[i];
    const maybeName = item.name || item.attrs.Name || item.attrs.Text || item.attrs.Description;
    if (maybeName) names.push(maybeName);
  }
  if (!names.length) return undefined;
  return names.join(" / ");
}

function normalizeAddressFromAttrs(attrs: Record<string, string>): string | undefined {
  const explicit = attrs["Address"] || attrs["GroupAddress"];
  if (explicit) {
    const trimmed = explicit.trim();
    if (trimmed.includes("/")) return trimmed;
    if (/^\d+$/.test(trimmed)) {
      const triple = decodeGaIntToTriple(parseInt(trimmed, 10));
      if (triple) return triple;
    }
  }
  const mainStr = attrs["MainGroup"] || attrs["Main"];
  const middleStr = attrs["MiddleGroup"] || attrs["Middle"];
  const subStr = attrs["SubGroup"] || attrs["Sub"];
  if (mainStr && middleStr && subStr) {
    const main = Number(mainStr);
    const middle = Number(middleStr);
    const sub = Number(subStr);
    if (Number.isInteger(main) && Number.isInteger(middle) && Number.isInteger(sub)) {
      return `${main}/${middle}/${sub}`;
    }
  }
  return undefined;
}

function classifyGroupRangeLevel(attrs: Record<string, string>, stack: StackItem[]): PartialGroupRange["level"] {
  const type = (attrs["RangeType"] || attrs["Type"] || attrs["Level"] || "").toLowerCase();
  if (type.includes("main")) return "main";
  if (type.includes("middle")) return "middle";
  if (type.includes("sub")) return "sub";
  if (type.includes("range")) return "range";
  // fallback: depth-based guess (still structural, not naming)
  const depth = stack.filter((item) => tagEndsWith(item.tag, "GroupRange")).length;
  if (depth === 0) return "main";
  if (depth === 1) return "middle";
  if (depth === 2) return "sub";
  return "unknown";
}

function ensureMapEntry<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  const existing = map.get(key);
  if (existing) return existing;
  const created = factory();
  map.set(key, created);
  return created;
}

function boolRecordFromFlags(attrs: Record<string, string>): KnxFlags | undefined {
  const result: KnxFlags = {};
  let hasAnything = false;
  for (const [key, value] of Object.entries(attrs)) {
    if (!/flag$/i.test(key)) continue;
    const normalized = normalizeBoolean(value);
    if (normalized !== undefined) {
      result[key] = normalized;
      hasAnything = true;
    } else {
      result[key] = value;
      hasAnything = true;
    }
  }
  if (attrs["CommunicationFlag"]) {
    result.communication = normalizeBoolean(attrs["CommunicationFlag"]);
    hasAnything = true;
  }
  if (attrs["ReadOnInitFlag"]) {
    result.readOnInit = normalizeBoolean(attrs["ReadOnInitFlag"]);
    hasAnything = true;
  }
  if (attrs["VisibilityFlag"]) {
    result.visibility = normalizeBoolean(attrs["VisibilityFlag"]);
    hasAnything = true;
  }
  return hasAnything ? result : undefined;
}

function mergeFlags(primary?: KnxFlags, secondary?: KnxFlags): KnxFlags | undefined {
  if (!primary && !secondary) return undefined;
  return { ...(secondary ?? {}), ...(primary ?? {}) };
}

function detectRoleFromStack(stack: StackItem[], attrs: Record<string, string>): KnxGroupObjectRole {
  const connector = attrs["Connector"] || attrs["Role"] || attrs["Type"];
  if (connector) {
    const lower = connector.toLowerCase();
    if (lower.includes("send") || lower.includes("write")) return "write";
    if (lower.includes("status") || lower.includes("feedback")) return "status";
    if (lower.includes("state")) return "state";
    if (lower.includes("read")) return "read";
    if (lower.includes("receive") || lower.includes("listen")) return "listen";
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const item = stack[i];
    const lowerTag = item.tag.split(":").pop()?.toLowerCase() || item.tag.toLowerCase();
    if (lowerTag.includes("send")) return "write";
    if (lowerTag.includes("receive")) return "listen";
    if (lowerTag.includes("status") || lowerTag.includes("feedback")) return "status";
    if (lowerTag.includes("state")) return "state";
    if (lowerTag.includes("read")) return "read";
  }
  return "unknown";
}

/** ====================== XML WALKING ====================== */

function visitXml(
  state: ParseState,
  filename: string,
  node: unknown,
  stack: StackItem[] = []
) {
  if (!isPlainObject(node)) return;

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text") continue;

    const processEntry = (entry: unknown) => {
      if (!entry) return;
      const attrs = extractAttributes(entry);
      const nameAttr = attrs["Name"] || attrs["Text"] || attrs["Description"];
      const frame: StackItem = { tag: key, name: nameAttr, attrs };
      stack.push(frame);

      collectMeta(state, filename, key, attrs);
      collectTopology(state, filename, key, attrs, stack);
      collectGroupStructures(state, filename, key, attrs, stack);
      collectDevices(state, filename, key, attrs, stack);
      collectComObjects(state, filename, key, attrs, stack);
      collectBindings(state, filename, key, attrs, stack);
  collectSecurity(state, filename, key, attrs);

      if (isPlainObject(entry) || Array.isArray(entry)) visitXml(state, filename, entry, stack);

      stack.pop();
    };

    if (Array.isArray(value)) value.forEach(processEntry);
    else processEntry(value);
  }
}

/** ====================== COLLECTORS ====================== */

function collectMeta(
  state: ParseState,
  filename: string,
  tag: string,
  attrs: Record<string, string>
) {
  if (tagEndsWith(tag, "Project")) {
    if (!state.meta.name) {
      const nm = attrs["Name"] || attrs["ProjectName"];
      if (nm) state.meta.name = nm;
    }
    state.meta.modifiedAt = state.meta.modifiedAt || attrs["Modified"] || attrs["ModifiedDate"];
    state.meta.createdAt = state.meta.createdAt || attrs["Created"] || attrs["CreationDate"];
    state.meta.etsVersion = state.meta.etsVersion || attrs["ETSVersion"] || attrs["Version"];
  }
  if (tagEndsWith(tag, "ProjectInformation")) {
    state.meta.name = state.meta.name || attrs["ProjectName"] || attrs["Name"];
    state.meta.createdAt = state.meta.createdAt || attrs["Created"] || attrs["CreationDate"];
    state.meta.modifiedAt = state.meta.modifiedAt || attrs["Modified"] || attrs["ModificationTimestamp"];
    state.meta.etsVersion = state.meta.etsVersion || attrs["ETSVersion"] || attrs["ToolVersion"];
  }
  if (tagEndsWith(tag, "SoftwareInformation")) {
    state.meta.etsVersion = state.meta.etsVersion || attrs["SoftwareVersion"] || attrs["Version"];
  }
  if (tagEndsWith(tag, "ProjectFileVersion")) {
    state.meta.etsVersion = state.meta.etsVersion || attrs["Version"];
  }
  if (tagEndsWith(tag, "Modification")) {
    state.meta.modifiedAt = state.meta.modifiedAt || attrs["Date"];
  }
  if (tagEndsWith(tag, "Creation")) {
    state.meta.createdAt = state.meta.createdAt || attrs["Date"];
  }
}

function collectTopology(
  state: ParseState,
  filename: string,
  tag: string,
  attrs: Record<string, string>,
  stack: StackItem[]
) {
  if (!stack.some((item) => tagEndsWith(item.tag, "Topology"))) return;

  if (tagEndsWith(tag, "Area")) {
    const id = attrs["Id"] || attrs["ID"];
    if (!id) return;
    const area = ensureMapEntry(state.areas, id, () => ({
      id,
      name: undefined,
      address: undefined,
      lines: new Set<KnxId>(),
      attrs: {},
    }));
    area.name = area.name || attrs["Name"] || attrs["Text"];
    area.address = area.address || attrs["Address"] || attrs["Number"];
    area.attrs = { ...area.attrs, ...attrs };
  }

  if (tagEndsWith(tag, "Line")) {
    const id = attrs["Id"] || attrs["ID"];
    if (!id) return;
    const line = ensureMapEntry(state.lines, id, () => ({
      id,
      name: undefined,
      address: undefined,
      segments: new Set<KnxId>(),
      devices: new Set<KnxId>(),
      attrs: {},
    }));
    line.name = line.name || attrs["Name"] || attrs["Text"];
    line.address = line.address || attrs["Address"] || attrs["Number"];
    line.attrs = { ...line.attrs, ...attrs };

    const parentArea = stack
      .slice()
      .reverse()
      .find((item) => tagEndsWith(item.tag, "Area"));
    if (parentArea) {
      const areaId = parentArea.attrs["Id"] || parentArea.attrs["ID"];
      if (areaId) {
        const area = ensureMapEntry(state.areas, areaId, () => ({
          id: areaId,
          name: parentArea.attrs["Name"],
          address: parentArea.attrs["Address"],
          lines: new Set<KnxId>(),
          attrs: { ...parentArea.attrs },
        }));
        area.lines.add(id);
      }
    }
  }

  if (tagEndsWith(tag, "Segment")) {
    const id = attrs["Id"] || attrs["ID"];
    if (!id) return;
    const segment = ensureMapEntry(state.segments, id, () => ({
      id,
      name: undefined,
      address: undefined,
      attrs: {},
    }));
    segment.name = segment.name || attrs["Name"] || attrs["Text"];
    segment.address = segment.address || attrs["Address"] || attrs["Number"];
    segment.attrs = { ...segment.attrs, ...attrs };

    const parentLine = stack
      .slice()
      .reverse()
      .find((item) => tagEndsWith(item.tag, "Line"));
    if (parentLine) {
      const lineId = parentLine.attrs["Id"] || parentLine.attrs["ID"];
      if (lineId) {
        const line = ensureMapEntry(state.lines, lineId, () => ({
          id: lineId,
          name: parentLine.attrs["Name"],
          address: parentLine.attrs["Address"],
          segments: new Set<KnxId>(),
          devices: new Set<KnxId>(),
          attrs: { ...parentLine.attrs },
        }));
        line.segments.add(id);
      }
    }
  }
}

function collectGroupStructures(
  state: ParseState,
  filename: string,
  tag: string,
  attrs: Record<string, string>,
  stack: StackItem[]
) {
  if (tagEndsWith(tag, "GroupRange")) {
    const id = attrs["Id"] || attrs["ID"];
    if (!id) return;
    const level = classifyGroupRangeLevel(attrs, stack);
    const range = ensureMapEntry(state.groupRanges, id, () => ({
      id,
      name: undefined,
      address: undefined,
      level,
      parentId: undefined,
      children: new Set<KnxId>(),
      groupIds: new Set<KnxId>(),
      attrs: {},
    }));
    range.name = range.name || attrs["Name"] || attrs["Text"];
    range.address = range.address || attrs["Address"] || attrs["RangeStart"];
    range.attrs = { ...range.attrs, ...attrs };
    range.level = range.level === "unknown" ? level : range.level;

    const parentRange = stack
      .slice(0, -1)
      .reverse()
      .find((item) => tagEndsWith(item.tag, "GroupRange"));
    if (parentRange) {
      const parentId = parentRange.attrs["Id"] || parentRange.attrs["ID"];
      if (parentId && parentId !== id) {
        range.parentId = range.parentId || parentId;
        const parent = ensureMapEntry(state.groupRanges, parentId, () => ({
          id: parentId,
          name: parentRange.attrs["Name"],
          address: parentRange.attrs["Address"],
          level: classifyGroupRangeLevel(parentRange.attrs, stack.slice(0, -1)),
          parentId: undefined,
          children: new Set<KnxId>(),
          groupIds: new Set<KnxId>(),
          attrs: { ...parentRange.attrs },
        }));
        parent.children.add(id);
      }
    }
  }

  if (tagEndsWith(tag, "GroupAddress")) {
    const id = attrs["Id"] || attrs["ID"];
    if (!id) return;
    const ga = ensureMapEntry(state.groupAddresses, id, () => ({
      id,
      address: undefined,
      mainGroup: undefined,
      middleGroup: undefined,
      subGroup: undefined,
      addressString: undefined,
      name: undefined,
      description: undefined,
      datapointType: undefined,
      rawDatapointType: undefined,
      flags: undefined,
      security: undefined,
      priority: undefined,
      bitLength: undefined,
      parentRangeId: undefined,
      context: undefined,
      meta: undefined,
      attrs: {},
    }));
    const addr = normalizeAddressFromAttrs(attrs);
    if (addr) ga.address = addr;
    if (attrs["Address"]) ga.addressString = attrs["Address"];
    const main = normalizeNumber(attrs["MainGroup"] || attrs["Main"]);
    const middle = normalizeNumber(attrs["MiddleGroup"] || attrs["Middle"]);
    const sub = normalizeNumber(attrs["SubGroup"] || attrs["Sub"]);
    if (main !== undefined) ga.mainGroup = main;
    if (middle !== undefined) ga.middleGroup = middle;
    if (sub !== undefined) ga.subGroup = sub;
    const nm = attrs["Name"] || attrs["Text"];
    if (nm !== undefined) ga.name = nm;
    if (attrs["Description"] !== undefined) ga.description = attrs["Description"];
    {
      const { canonical, raw } = normalizeDatapoint(attrs["DatapointType"] || attrs["Datapoint"] || attrs["DPTs"]);
      if (canonical) ga.datapointType = canonical;
      if (raw) ga.rawDatapointType = raw;
    }
    ga.flags = mergeFlags(boolRecordFromFlags(attrs), ga.flags);
    if (attrs["Priority"]) ga.priority = attrs["Priority"];
    const bitLength = normalizeNumber(attrs["BitLength"] || attrs["Length"] || attrs["Size"]);
    if (bitLength !== undefined) ga.bitLength = bitLength;
    if (!ga.meta) {
      ga.meta = {
        source: filename,
        tag,
        context: buildContextPath(stack),
        attributes: { ...attrs },
        stack: snapshotStack(stack),
      };
    }
    ga.context = ga.context || buildContextPath(stack);
    ga.attrs = { ...ga.attrs, ...attrs };

    const parentRange = stack
      .slice(0, -1)
      .reverse()
      .find((item) => tagEndsWith(item.tag, "GroupRange"));
    if (parentRange) {
      const parentId = parentRange.attrs["Id"] || parentRange.attrs["ID"];
      if (parentId) {
        ga.parentRangeId = ga.parentRangeId || parentId;
        const range = ensureMapEntry(state.groupRanges, parentId, () => ({
          id: parentId,
          name: parentRange.attrs["Name"],
          address: parentRange.attrs["Address"],
          level: classifyGroupRangeLevel(parentRange.attrs, stack.slice(0, -1)),
          parentId: undefined,
          children: new Set<KnxId>(),
          groupIds: new Set<KnxId>(),
          attrs: { ...parentRange.attrs },
        }));
        range.groupIds.add(id);
      }
    }

    // security markers
    if (attrs["Security"] || attrs["SecurityMode"] || attrs["SecurityKeyRef"]) {
      ga.security = ga.security || { attributes: {} };
      if (attrs["Security"] && attrs["Security"].toLowerCase() !== "none") {
        ga.security.isSecure = true;
        state.secureHints.add(`GroupAddress:${id}`);
      }
      if (attrs["SecurityKeyRef"]) ga.security.keyringRef = attrs["SecurityKeyRef"];
      ga.security.attributes = { ...(ga.security.attributes ?? {}), ...attrs };
    }
  }
}

function collectDevices(
  state: ParseState,
  filename: string,
  tag: string,
  attrs: Record<string, string>,
  stack: StackItem[]
) {
  if (tagEndsWith(tag, "Channel") || tagEndsWith(tag, "ChannelInstance")) {
    const id = attrs["Id"] || attrs["ID"];
    if (!id) return;
    const channel = ensureMapEntry(state.channels, id, () => ({
      id,
      name: undefined,
      description: undefined,
      number: undefined,
      comObjectIds: new Set<KnxId>(),
      attrs: {},
    }));
    channel.name = channel.name || attrs["Name"] || attrs["Text"];
    channel.description = channel.description || attrs["Description"];
    channel.number = channel.number ?? normalizeNumber(attrs["Number"]);
    channel.attrs = { ...channel.attrs, ...attrs, Source: filename };

    const deviceFrame = stack
      .slice()
      .reverse()
      .find((item) => tagEndsWith(item.tag, "DeviceInstance"));
    if (deviceFrame) {
      const deviceId = deviceFrame.attrs["Id"] || deviceFrame.attrs["ID"];
      if (deviceId) {
        const device = ensureMapEntry(state.devices, deviceId, () => ({
          id: deviceId,
          name: deviceFrame.attrs["Name"],
          description: deviceFrame.attrs["Description"],
          address: deviceFrame.attrs["Address"],
          manufacturerRef: deviceFrame.attrs["Manufacturer"],
          productRef: deviceFrame.attrs["ProductRefId"],
          hardwareRef: deviceFrame.attrs["HardwareRefId"],
          applicationProgramRef: deviceFrame.attrs["ApplicationProgramRefId"],
          parameters: {},
          channelIds: new Set<KnxId>(),
          comObjectIds: new Set<KnxId>(),
          attrs: { ...deviceFrame.attrs },
        }));
        device.channelIds.add(id);
      }
    }
    return;
  }

  if (tagEndsWith(tag, "ParameterValue") || tagEndsWith(tag, "Parameter") || tagEndsWith(tag, "ParameterInstance")) {
    const deviceFrame = stack
      .slice()
      .reverse()
      .find((item) => tagEndsWith(item.tag, "DeviceInstance"));
    if (!deviceFrame) return;
    const deviceId = deviceFrame.attrs["Id"] || deviceFrame.attrs["ID"];
    if (!deviceId) return;
    const device = ensureMapEntry(state.devices, deviceId, () => ({
      id: deviceId,
      name: deviceFrame.attrs["Name"],
      description: deviceFrame.attrs["Description"],
      address: deviceFrame.attrs["Address"],
      manufacturerRef: deviceFrame.attrs["Manufacturer"],
      productRef: deviceFrame.attrs["ProductRefId"],
      hardwareRef: deviceFrame.attrs["HardwareRefId"],
      applicationProgramRef: deviceFrame.attrs["ApplicationProgramRefId"],
      parameters: {},
      channelIds: new Set<KnxId>(),
      comObjectIds: new Set<KnxId>(),
      attrs: { ...deviceFrame.attrs },
    }));
    const key = attrs["ParameterRefId"] || attrs["RefId"] || attrs["Id"];
    if (key && attrs["Value"] !== undefined) {
      device.parameters[key] = parseParameterValue(attrs["Value"]);
    }
    return;
  }

  if (!tagEndsWith(tag, "DeviceInstance")) return;
  const id = attrs["Id"] || attrs["ID"];
  if (!id) return;
  const device = ensureMapEntry(state.devices, id, () => ({
    id,
    name: undefined,
    description: undefined,
    address: undefined,
    manufacturerRef: undefined,
    productRef: undefined,
    hardwareRef: undefined,
    applicationProgramRef: undefined,
    parameters: {},
    channelIds: new Set<KnxId>(),
    comObjectIds: new Set<KnxId>(),
    attrs: {},
  }));
  device.name = device.name || attrs["Name"] || attrs["Text"];
  device.description = device.description || attrs["Description"];
  device.address = device.address || attrs["Address"] || attrs["IndividualAddress"];
  device.manufacturerRef = device.manufacturerRef || attrs["Manufacturer"] || attrs["ManufacturerId"];
  device.productRef = device.productRef || attrs["ProductRefId"];
  device.hardwareRef = device.hardwareRef || attrs["Hardware2ProgramRefId"] || attrs["HardwareRefId"];
  device.applicationProgramRef = device.applicationProgramRef || attrs["ApplicationProgramRefId"];
  device.attrs = { ...device.attrs, ...attrs };

  const lineFrame = stack
    .slice()
    .reverse()
    .find((item) => tagEndsWith(item.tag, "Line"));
  if (lineFrame) {
    const lineId = lineFrame.attrs["Id"] || lineFrame.attrs["ID"];
    if (lineId) {
      const line = ensureMapEntry(state.lines, lineId, () => ({
        id: lineId,
        name: lineFrame.attrs["Name"],
        address: lineFrame.attrs["Address"],
        segments: new Set<KnxId>(),
        devices: new Set<KnxId>(),
        attrs: { ...lineFrame.attrs },
      }));
      line.devices.add(id);
    }
  }

  device.attrs.Source = filename;
}

function parseParameterValue(value: string): string | number | boolean {
  const bool = normalizeBoolean(value);
  if (bool !== undefined) return bool;
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  return value;
}

function collectComObjects(
  state: ParseState,
  filename: string,
  tag: string,
  attrs: Record<string, string>,
  stack: StackItem[]
) {
  if (tagEndsWith(tag, "ComObject")) {
    const id = attrs["Id"] || attrs["ID"];
    if (!id) return;
    const definition = ensureMapEntry(state.comObjectDefinitions, id, () => ({
      id,
      name: undefined,
      number: undefined,
      datapointType: undefined,
      rawDatapointType: undefined,
      bitLength: undefined,
      priority: undefined,
      flags: {},
      attrs: {},
    }));
    definition.name = definition.name || attrs["Name"] || attrs["Text"];
    definition.number = definition.number ?? normalizeNumber(attrs["Number"]);
    if (!definition.datapointType) {
      const { canonical, raw } = normalizeDatapoint(attrs["DatapointType"] || attrs["Datapoint"] || attrs["DPTs"]);
      definition.datapointType = canonical;
      definition.rawDatapointType = raw;
    }
    const bitLength = normalizeNumber(attrs["BitLength"] || attrs["Length"] || attrs["Size"]);
    definition.bitLength = definition.bitLength ?? bitLength;
    definition.priority = definition.priority || attrs["Priority"];
    definition.flags = mergeFlags(definition.flags, boolRecordFromFlags(attrs)) ?? definition.flags;
    definition.attrs = { ...definition.attrs, ...attrs, Source: filename };
  }

  if (tagEndsWith(tag, "ComObjectInstanceRef")) {
    const id = attrs["Id"] || attrs["ID"] || attrs["RefId"];
    if (!id) return;
    const comObject = ensureMapEntry(state.comObjects, id, () => ({
      id,
      name: undefined,
      description: undefined,
      number: undefined,
      datapointType: undefined,
      rawDatapointType: undefined,
      bitLength: undefined,
      priority: undefined,
      flags: {},
      channelId: undefined,
      deviceId: undefined,
      definitionRef: undefined,
      groupAddressRefs: [],
      attrs: {},
    }));
    comObject.name = comObject.name || attrs["Name"] || attrs["Text"];
    comObject.description = comObject.description || attrs["Description"];
    comObject.number = comObject.number ?? normalizeNumber(attrs["Number"]);
    const { canonical, raw } = normalizeDatapoint(attrs["DatapointType"] || attrs["Datapoint"] || attrs["DPTs"]);
    comObject.datapointType = comObject.datapointType || canonical;
    comObject.rawDatapointType = comObject.rawDatapointType || raw;
    comObject.bitLength = comObject.bitLength ?? normalizeNumber(attrs["BitLength"] || attrs["Length"] || attrs["Size"]);
    comObject.priority = comObject.priority || attrs["Priority"];
    comObject.definitionRef = comObject.definitionRef || attrs["RefId"] || attrs["ComObjectRefId"];
    comObject.flags = mergeFlags(boolRecordFromFlags(attrs), comObject.flags) ?? comObject.flags;
    comObject.attrs = { ...comObject.attrs, ...attrs, Source: filename };

    const channel = stack
      .slice()
      .reverse()
      .find((item) => tagEndsWith(item.tag, "Channel") || tagEndsWith(item.tag, "ChannelInstance"));
    if (channel) {
      const channelId = channel.attrs["Id"] || channel.attrs["ID"];
      if (channelId) {
        comObject.channelId = comObject.channelId || channelId;
        const ch = ensureMapEntry(state.channels, channelId, () => ({
          id: channelId,
          name: channel.attrs["Name"],
          description: channel.attrs["Description"],
          number: normalizeNumber(channel.attrs["Number"]),
          comObjectIds: new Set<KnxId>(),
          attrs: { ...channel.attrs },
        }));
        ch.comObjectIds.add(id);
      }
    }

    const device = stack
      .slice()
      .reverse()
      .find((item) => tagEndsWith(item.tag, "DeviceInstance"));
    if (device) {
      const deviceId = device.attrs["Id"] || device.attrs["ID"];
      if (deviceId) {
        comObject.deviceId = comObject.deviceId || deviceId;
        const dev = ensureMapEntry(state.devices, deviceId, () => ({
          id: deviceId,
          name: device.attrs["Name"],
          description: device.attrs["Description"],
          address: device.attrs["Address"],
          manufacturerRef: device.attrs["Manufacturer"],
          productRef: device.attrs["ProductRefId"],
          hardwareRef: device.attrs["HardwareRefId"],
          applicationProgramRef: device.attrs["ApplicationProgramRefId"],
          parameters: {},
          channelIds: new Set<KnxId>(),
          comObjectIds: new Set<KnxId>(),
          attrs: { ...device.attrs },
        }));
        dev.comObjectIds.add(id);
        if (comObject.channelId) dev.channelIds.add(comObject.channelId);
      }
    }
  }
}

function collectBindings(
  state: ParseState,
  filename: string,
  tag: string,
  attrs: Record<string, string>,
  stack: StackItem[]
) {
  if (!tagEndsWith(tag, "GroupAddressRef")) return;
  const binding: PartialGroupAddressBinding = {
    id: `${filename}#${state.bindings.length}`,
    role: detectRoleFromStack(stack, attrs),
    groupAddressId: attrs["RefId"] || attrs["GroupAddressRefId"] || attrs["GroupAddressId"],
    groupAddressRef: attrs["RefId"] || attrs["GroupAddressRefId"] || attrs["GroupAddressId"],
    comObjectId: undefined,
    channelId: undefined,
    deviceId: undefined,
    source: filename,
    attributes: { ...attrs },
    stack: snapshotStack(stack),
  };

  const comObjectFrame = stack.slice().reverse().find((item) =>
    tagEndsWith(item.tag, "ComObjectInstanceRef") || tagEndsWith(item.tag, "ComObjectInstance")
  );
  if (comObjectFrame) {
    binding.comObjectId = comObjectFrame.attrs["Id"] || comObjectFrame.attrs["ID"] || comObjectFrame.attrs["RefId"];
  }
  const channelFrame = stack
    .slice()
    .reverse()
    .find((item) => tagEndsWith(item.tag, "Channel") || tagEndsWith(item.tag, "ChannelInstance"));
  if (channelFrame) {
    binding.channelId = channelFrame.attrs["Id"] || channelFrame.attrs["ID"];
  }
  const deviceFrame = stack
    .slice()
    .reverse()
    .find((item) => tagEndsWith(item.tag, "DeviceInstance"));
  if (deviceFrame) {
    binding.deviceId = deviceFrame.attrs["Id"] || deviceFrame.attrs["ID"];
  }

  state.bindings.push(binding);

  const link: KnxLinkInfo = {
    gaId: binding.groupAddressId || "",
    comObjectId: binding.comObjectId,
    channelId: binding.channelId,
    deviceId: binding.deviceId,
    context: buildContextPath(stack),
    role: binding.role,
    source: filename,
    attributes: { ...attrs },
    stack: snapshotStack(stack),
  };
  state.linkInfos.push(link);
}

function collectSecurity(
  state: ParseState,
  filename: string,
  tag: string,
  attrs: Record<string, string>
) {
  if (attrs["Security"] && attrs["Security"].toLowerCase() !== "none") {
    state.secureHints.add(`${tag}:${attrs["Id"] || attrs["ID"] || filename}`);
  }
  if (tagEndsWith(tag, "Keyring") || tagEndsWith(tag, "Security")) {
    state.secureHints.add(`${filename}:${tag}`);
  }
  if (attrs["SecurityKeyRef"]) state.secureHints.add(`${tag}:${attrs["SecurityKeyRef"]}`);
  if (attrs["SecurityLevel"]) state.secureHints.add(`${tag}:${attrs["SecurityLevel"]}`);
}

/** ====================== ASSEMBLY ====================== */

function buildGroupAddressTree(
  state: ParseState
): { tree: KnxGroupAddressTree; flat: KnxGroupAddress[]; compat: GroupAddressCompat[] } {
  const levels = new Map<KnxId, KnxGroupLevel>();
  const flat: KnxGroupAddress[] = [];
  const compat: GroupAddressCompat[] = [];
  const added = new Set<string>();

  const toGroupAddress = (ga: PartialGroupAddress): KnxGroupAddress | undefined => {
    if (!ga.address) return undefined;
    const entry: KnxGroupAddress = {
      id: ga.id,
      address: ga.address,
      name: ga.name,
      description: ga.description,
      datapointType: ga.datapointType,
      rawDatapointType: ga.rawDatapointType,
      flags: ga.flags,
      security: ga.security,
      priority: ga.priority,
      bitLength: ga.bitLength,
      contextPath: ga.context,
      meta: ga.meta,
    };
    flat.push(entry);
    added.add(entry.id);
    compat.push({
      id: entry.id,
      name: entry.name || entry.address,
      address: entry.address,
      description: entry.description,
      dpt: entry.datapointType,
      meta: entry.meta,
      links: [],
    });
    return entry;
  };

  const rangesById = state.groupRanges;

  for (const [id, range] of rangesById.entries()) {
    const level: KnxGroupLevel = levels.get(id) ?? {
      id,
      name: range.name,
      address: range.address,
      level: range.level,
      parentId: range.parentId,
      children: [],
    };
    levels.set(id, level);
  }

  for (const [id, range] of rangesById.entries()) {
    const level = levels.get(id)!;
    for (const childId of range.children) {
      const childLevel = levels.get(childId);
      if (childLevel) level.children.push(childLevel);
    }
    const items: KnxGroupAddress[] = [];
    for (const gaId of range.groupIds) {
      const partial = state.groupAddresses.get(gaId);
      if (!partial) continue;
      const full = toGroupAddress(partial);
      if (full) items.push(full);
    }
    if (items.length) level.items = items.sort((a, b) => compareAddressStrings(a.address, b.address));
  }

  // Add any group addresses that are not part of a GroupRange
  for (const [gaId, partial] of state.groupAddresses.entries()) {
    if (added.has(gaId)) continue;
    toGroupAddress(partial);
  }

  const roots = Array.from(levels.values()).filter((level) => !level.parentId || !levels.has(level.parentId));
  const sortedRoots = roots.sort((a, b) => compareOptionalAddress(a.address, b.address, a.name, b.name));

  return {
    tree: { mainGroups: sortedRoots },
    flat: flat.sort((a, b) => compareAddressStrings(a.address, b.address)),
    compat,
  };
}

function compareOptionalAddress(
  a?: string,
  b?: string,
  nameA?: string,
  nameB?: string
): number {
  if (a && b) return compareAddressStrings(a, b);
  if (a) return -1;
  if (b) return 1;
  if (nameA && nameB) return nameA.localeCompare(nameB);
  return 0;
}

function compareAddressStrings(a: string, b: string): number {
  const aParts = a.split("/").map((part) => parseInt(part, 10));
  const bParts = b.split("/").map((part) => parseInt(part, 10));
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}

function assembleDevices(state: ParseState): KnxDevice[] {
  const devices: KnxDevice[] = [];
  for (const partialDevice of state.devices.values()) {
    const channels: KnxChannel[] = [];
    for (const channelId of partialDevice.channelIds) {
      const partialChannel = state.channels.get(channelId);
      if (!partialChannel) continue;
      const comObjects: KnxComObject[] = [];
      for (const comObjectId of partialChannel.comObjectIds) {
        const comObject = state.comObjects.get(comObjectId);
        if (!comObject) continue;
        const assembled = assembleComObject(state, comObject);
        comObject.deviceId = partialDevice.id;
        comObject.channelId = partialChannel.id;
        comObjects.push(assembled);
      }
      channels.push({
        id: partialChannel.id,
        name: partialChannel.name,
        description: partialChannel.description,
        number: partialChannel.number,
        comObjects: comObjects.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      });
    }

    const deviceComObjects: KnxComObject[] = [];
    for (const comObjectId of partialDevice.comObjectIds) {
      const partial = state.comObjects.get(comObjectId);
      if (!partial) continue;
      const assembled = assembleComObject(state, partial);
      assembled.deviceId = partialDevice.id;
      if (assembled.channelId && !partialDevice.channelIds.has(assembled.channelId)) {
        // When com object references channel not recorded, attach channel stub
        partialDevice.channelIds.add(assembled.channelId);
      }
      deviceComObjects.push(assembled);
    }

    const device: KnxDevice = {
      id: partialDevice.id,
      name: partialDevice.name,
      description: partialDevice.description,
      address: partialDevice.address,
      manufacturerRef: partialDevice.manufacturerRef,
      productRef: partialDevice.productRef,
      hardwareRef: partialDevice.hardwareRef,
      applicationProgramRef: partialDevice.applicationProgramRef,
      parameters: Object.keys(partialDevice.parameters)
        .sort()
        .reduce<Record<string, string | number | boolean | null>>((acc, key) => {
          acc[key] = partialDevice.parameters[key];
          return acc;
        }, {}),
      channels: channels.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      comObjects: deviceComObjects.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    };
    devices.push(device);
  }

  return devices.sort((a, b) => {
    if (a.address && b.address) return comparePhysicalAddress(a.address, b.address);
    if (a.address) return -1;
    if (b.address) return 1;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

function comparePhysicalAddress(a: string, b: string): number {
  const parse = (value: string) => value.split(/[./]/).map((part) => parseInt(part, 10));
  const aParts = parse(a);
  const bParts = parse(b);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}

function assembleComObject(state: ParseState, partial: PartialComObjectInstance): KnxComObject {
  const definition = partial.definitionRef ? state.comObjectDefinitions.get(partial.definitionRef) : undefined;
  const { canonical: defCanonical, raw: defRaw } = normalizeDatapoint(definition?.datapointType || definition?.rawDatapointType);
  const comObject: KnxComObject = {
    id: partial.id,
    name: partial.name || definition?.name,
    description: partial.description || definition?.attrs?.Description,
    number: partial.number ?? definition?.number,
    datapointType: partial.datapointType || defCanonical || definition?.datapointType,
    rawDatapointType: partial.rawDatapointType || defRaw || definition?.rawDatapointType,
    bitLength: partial.bitLength ?? definition?.bitLength,
    priority: partial.priority || definition?.priority,
    flags: mergeFlags(partial.flags, definition?.flags) ?? {},
    groupAddressRefs: [],
    channelId: partial.channelId,
    deviceId: partial.deviceId,
  };
  comObject.groupAddressRefs = partial.groupAddressRefs.map((binding) => ({
    role: binding.role,
    groupAddressId: binding.groupAddressId || binding.groupAddressRef || "",
    refId: binding.groupAddressRef,
    source: binding.source,
    attributes: binding.attributes,
    stack: binding.stack,
  }));
  return comObject;
}

function attachBindingsToComObjects(state: ParseState) {
  for (const binding of state.bindings) {
    if (!binding.comObjectId) continue;
    const comObject = state.comObjects.get(binding.comObjectId);
    if (!comObject) continue;
    comObject.groupAddressRefs.push(binding);
  }
}

function buildTopology(state: ParseState, devices: KnxDevice[]): KnxTopology {
  const linesById = new Map<KnxId, KnxLine>();
  const segmentsById = new Map<KnxId, KnxSegment>();

  for (const [segmentId, segment] of state.segments.entries()) {
    segmentsById.set(segmentId, {
      id: segmentId,
      name: segment.name,
      address: segment.address,
    });
  }

  for (const [lineId, line] of state.lines.entries()) {
    const deviceInstances = devices.filter((device) => line.devices.has(device.id));
    linesById.set(lineId, {
      id: lineId,
      name: line.name,
      address: line.address,
      segments: Array.from(line.segments)
        .map((segmentId) => segmentsById.get(segmentId))
        .filter((segment): segment is KnxSegment => Boolean(segment)),
      devices: deviceInstances,
    });
  }

  const areas: KnxArea[] = [];
  for (const [areaId, area] of state.areas.entries()) {
    const lines = Array.from(area.lines)
      .map((lineId) => linesById.get(lineId))
      .filter((line): line is KnxLine => Boolean(line));
    areas.push({
      id: areaId,
      name: area.name,
      address: area.address,
      lines,
    });
  }

  return { areas };
}

function applyBindings(
  flatAddresses: KnxGroupAddress[],
  linkInfos: KnxLinkInfo[],
  devices: KnxDevice[]
): GroupAddressCompat[] {
  const byId = new Map(flatAddresses.map((ga) => [ga.id, ga] as const));
  const compatById = new Map<string, GroupAddressCompat>();

  const comObjectsById = new Map<string, KnxComObject>();
  for (const device of devices) {
    for (const comObject of device.comObjects) comObjectsById.set(comObject.id, comObject);
    for (const channel of device.channels) {
      for (const comObject of channel.comObjects) comObjectsById.set(comObject.id, comObject);
    }
  }

  for (const ga of flatAddresses) {
    compatById.set(ga.id, {
      id: ga.id,
      name: ga.name || ga.address,
      address: ga.address,
      description: ga.description,
      dpt: ga.datapointType,
      meta: ga.meta,
      links: [],
    });
  }

  for (const link of linkInfos) {
    if (!link.gaId) continue;
    const ga = byId.get(link.gaId);
    if (ga) {
      ga.links = ga.links || [];
      if (!ga.links.includes(link)) ga.links.push(link);
    }
    const compat = compatById.get(link.gaId);
    if (compat) {
      compat.links = compat.links || [];
      compat.links.push(link);
      if (!compat.dpt && link.comObjectId) {
        const comObject = comObjectsById.get(link.comObjectId);
        if (comObject?.datapointType) compat.dpt = comObject.datapointType;
      }
    }
    if (link.comObjectId && !link.comObject) {
      const comObject = comObjectsById.get(link.comObjectId);
      if (comObject) {
        link.comObject = comObject.name;
        if (!link.dpt && comObject.datapointType) link.dpt = comObject.datapointType;
      }
    }
  }

  return Array.from(compatById.values()).sort((a, b) => compareAddressStrings(a.address, b.address));
}

function buildIndexes(devices: KnxDevice[], flatGroupAddresses: KnxGroupAddress[]): KnxIndexes {
  const groupAddressesById: Record<string, KnxGroupAddress> = {};
  for (const ga of flatGroupAddresses) groupAddressesById[ga.id] = ga;

  const comObjectsById: Record<string, KnxComObject> = {};
  const devicesById: Record<string, KnxDevice> = {};

  for (const device of devices) {
    devicesById[device.id] = device;
    for (const comObject of device.comObjects) {
      comObjectsById[comObject.id] = comObject;
    }
    for (const channel of device.channels) {
      for (const comObject of channel.comObjects) {
        comObjectsById[comObject.id] = comObject;
      }
    }
  }

  return { groupAddressesById, comObjectsById, devicesById };
}

function computeStats(devices: KnxDevice[], flatGroupAddresses: KnxGroupAddress[], secureHints: Set<string>): KnxCatalogStats {
  const dptUsage: Record<string, number> = {};
  const accumulate = (value?: string) => {
    if (!value) return;
    const norm = value.toLowerCase();
    dptUsage[norm] = (dptUsage[norm] ?? 0) + 1;
  };
  for (const ga of flatGroupAddresses) accumulate(ga.datapointType);
  for (const device of devices) {
    for (const comObject of device.comObjects) accumulate(comObject.datapointType);
    for (const channel of device.channels) {
      for (const comObject of channel.comObjects) accumulate(comObject.datapointType);
    }
  }

  return {
    totals: {
      groupAddresses: flatGroupAddresses.length,
      devices: devices.length,
      comObjects: Object.values(dptUsage).reduce((sum, count) => sum + count, 0),
    },
    dptUsage,
    secure: {
      hasSecure: secureHints.size > 0,
      secureGroupAddressCount: flatGroupAddresses.filter((ga) => ga.security?.isSecure).length,
    },
  };
}

function buildReport(
  devices: KnxDevice[],
  flatGroupAddresses: KnxGroupAddress[],
  comObjectsById: Record<string, KnxComObject>,
  linkInfos: KnxLinkInfo[],
  secureHints: Set<string>,
  parsingNotes: string[]
): KnxParseReport {
  const missingGa = flatGroupAddresses.filter((ga) => !ga.datapointType && !ga.rawDatapointType).map((ga) => ga.id);
  const missingCo: string[] = [];
  const roleUnknown: string[] = [];
  const conflicts: KnxParseReport["datapointConflicts"] = [];
  const duplicatesMap = new Map<string, Array<{ deviceId?: string; channelId?: string; comObjectId?: string; role: KnxGroupObjectRole }>>();

  const visitComObject = (comObject: KnxComObject) => {
    if (!comObject.datapointType && !comObject.rawDatapointType) missingCo.push(comObject.id);
    for (const binding of comObject.groupAddressRefs) {
      if (binding.role === "unknown") roleUnknown.push(comObject.id);
      const ga = flatGroupAddresses.find((entry) => entry.id === binding.groupAddressId);
      if (ga && ga.datapointType && comObject.datapointType && ga.datapointType !== comObject.datapointType) {
        conflicts.push({
          groupAddressId: ga.id,
          comObjectId: comObject.id,
          groupAddressDpt: ga.datapointType,
          comObjectDpt: comObject.datapointType,
        });
      }
      const list = ensureMapEntry(duplicatesMap, binding.groupAddressId, () => []);
      list.push({
        deviceId: comObject.deviceId,
        channelId: comObject.channelId,
        comObjectId: comObject.id,
        role: binding.role,
      });
    }
  };

  for (const device of devices) {
    device.comObjects.forEach(visitComObject);
    device.channels.forEach((channel) => channel.comObjects.forEach(visitComObject));
  }

  const duplicates: KnxParseReport["duplicateBindings"] = [];
  for (const [gaId, bindings] of duplicatesMap.entries()) {
    if (bindings.length > 1) {
      duplicates.push({ groupAddressId: gaId, bindings });
    }
  }

  return {
    missingDatapointTypes: {
      groupAddresses: missingGa,
      comObjects: missingCo,
    },
    roleUnknown: Array.from(new Set(roleUnknown)),
    datapointConflicts: conflicts,
    duplicateBindings: duplicates,
    secureHints: {
      hasSecure: secureHints.size > 0,
      details: Array.from(secureHints).sort(),
    },
    parsingNotes,
  };
}

/** ====================== MAIN PARSER ====================== */

export async function parseKnxproj(
  file: File,
  opts?: {
    debug?: boolean;
    onProgress?: (p: ParseProgress) => void;
    preScanBytes?: number;
    yieldEveryFiles?: number;
    yieldDelayMs?: number;
    /** Project password for password protected ETS exports. */
    password?: string;
  }
): Promise<KnxCatalog> {
  const onProgress = opts?.onProgress;
  const preScanBytes = Math.max(512, Math.min(1 << 20, opts?.preScanBytes ?? 8192));
  const yieldEveryFiles = Math.max(1, Math.min(128, opts?.yieldEveryFiles ?? 8));
  const yieldDelayMs = Math.max(0, Math.min(10, opts?.yieldDelayMs ?? 0));

  const emit = (
    phase: ParseProgress["phase"],
    percent: number,
    extra: Partial<ParseProgress> = {}
  ) => {
    if (onProgress) onProgress({ phase, percent, ...extra });
  };

  emit("load_zip", rangePercent(SCAN_RANGE, 0));
  const buffer = await file.arrayBuffer();

  emit("scan_entries", rangePercent(SCAN_RANGE, 0.1));

  const knxprojEntries: string[] = [];
  const isProtectedProjectArchive = (name: string) => /^P-[^/\\]+\.zip$/i.test(name);
  const entries: Record<string, Uint8Array> = await new Promise((resolve, reject) => {
    unzip(
      new Uint8Array(buffer),
      {
        filter: (f) => {
          const name = f.name || "";
          if (/\.knxproj$/i.test(name)) knxprojEntries.push(name);
          return /\.xml$/i.test(name) || isProtectedProjectArchive(name);
        },
      },
      (err, out) => {
        if (err) return reject(err);
        resolve(out as Record<string, Uint8Array>);
      }
    );
  });

  // Password protected exports contain the project folder as an encrypted P-XXXX.zip.
  for (const archiveName of Object.keys(entries).filter(isProtectedProjectArchive)) {
    const archive = entries[archiveName];
    delete entries[archiveName];
    const projectFolder = archiveName.replace(/\.zip$/i, "");
    const inner = await extractProtectedProject(archive, opts?.password, (name) => /\.xml$/i.test(name));
    for (const [innerName, data] of Object.entries(inner)) {
      entries[`${projectFolder}/${innerName}`] = data;
    }
  }

  const xmlNames = Object.keys(entries).filter((name) => name.toLowerCase().endsWith(".xml"));
  const totalFiles = xmlNames.length || 1;
  const decoder = new TextDecoder("utf-8");

  emit("scan_entries", rangePercent(SCAN_RANGE, 1));

  const state: ParseState = {
    entries,
    meta: {},
    areas: new Map(),
    lines: new Map(),
    segments: new Map(),
    devices: new Map(),
    channels: new Map(),
    comObjects: new Map(),
    comObjectDefinitions: new Map(),
    groupRanges: new Map(),
    groupAddresses: new Map(),
    bindings: [],
    linkInfos: [],
    parsingNotes: [],
    secureHints: new Set(),
  };

  for (let i = 0; i < xmlNames.length; i++) {
    const name = xmlNames[i];
    emit("extract_xml", rangePercent(FILE_RANGE, i / totalFiles), { filename: name, filePercent: 0 });

    const raw = entries[name];
    const head = raw.subarray(0, Math.min(preScanBytes, raw.length));
    const headText = decoder.decode(head);
    const hasRelevant =
      headText.indexOf("GroupAddress") !== -1 ||
      headText.indexOf("ComObject") !== -1 ||
      headText.indexOf("Device") !== -1 ||
      headText.indexOf("Topology") !== -1 ||
      headText.indexOf("Project") !== -1;

    if (!hasRelevant) {
      emit("parse_xml", rangePercent(FILE_RANGE, (i + 1) / totalFiles), { filename: name, filePercent: 100 });
      if ((i % yieldEveryFiles) === yieldEveryFiles - 1) {
        await new Promise((resolve) => setTimeout(resolve, yieldDelayMs));
      }
      continue;
    }

    let xml = decoder.decode(raw);
    delete entries[name as keyof typeof entries];

    try {
      const ast = parser.parse(xml);
      visitXml(state, name, ast);
    } catch (error) {
      state.parsingNotes.push(`Failed to parse ${name}: ${String(error)}`);
    }

    emit("parse_xml", rangePercent(FILE_RANGE, (i + 1) / totalFiles), { filename: name, filePercent: 100 });

    if ((i % yieldEveryFiles) === yieldEveryFiles - 1) {
      await new Promise((resolve) => setTimeout(resolve, yieldDelayMs));
    }

    xml = "";
  }

  attachBindingsToComObjects(state);

  const buildSteps = state.groupAddresses.size + state.devices.size + state.bindings.length + 1;
  let processedSteps = 0;
  const emitBuildProgress = () => {
    emit("build_catalog", rangePercent(BUILD_RANGE, processedSteps / Math.max(1, buildSteps)));
  };

  const { tree, flat } = buildGroupAddressTree(state);
  processedSteps += state.groupAddresses.size;
  emitBuildProgress();

  const devices = assembleDevices(state);
  processedSteps += state.devices.size;
  emitBuildProgress();

  const topology = buildTopology(state, devices);
  processedSteps += 1;
  emitBuildProgress();

  const updatedCompat = applyBindings(flat, state.linkInfos, devices);
  processedSteps += state.bindings.length;
  emitBuildProgress();

  const links = state.linkInfos.filter((link) => !!link.gaId);

  const indexes = buildIndexes(devices, flat);
  const stats = computeStats(devices, flat, state.secureHints);
  const report = buildReport(devices, flat, indexes.comObjectsById, links, state.secureHints, state.parsingNotes);

  const projectName = state.meta.name || (knxprojEntries[0] ? knxprojEntries[0].split(/[\\/]/).pop()?.replace(/\.(knxproj|zip)$/i, "") : file.name);

  const catalog: KnxCatalog = {
    meta: {
      name: projectName || "Unknown",
      etsVersion: state.meta.etsVersion,
      createdAt: state.meta.createdAt,
      modifiedAt: state.meta.modifiedAt,
    },
    topology,
    devices,
    groupAddresses: {
      tree,
      flat,
    },
    indexes,
    stats,
    report,
    group_addresses: updatedCompat,
    links,
  };

  emit("done", rangePercent(FINAL_RANGE, 1));

  return catalog;
}
