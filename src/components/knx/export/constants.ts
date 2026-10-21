import { HaDomain } from "@/lib/knx/export";

export const ALL_DOMAINS: HaDomain[] = [
  "switch",
  "binary_sensor",
  "light",
  "sensor",
  "time",
  "date",
  "datetime",
  "cover",
  "climate",
  "scene",
  "_unknown",
];

export const LABEL: Record<HaDomain, string> = {
  switch: "Switches",
  binary_sensor: "Binary sensors",
  light: "Lights",
  sensor: "Sensors",
  time: "Times",
  date: "Dates",
  datetime: "Date & Time",
  cover: "Covers",
  climate: "Climate",
  scene: "Scenes",
  _unknown: "Unknown",
};
