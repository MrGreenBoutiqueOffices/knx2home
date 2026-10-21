import { describe, it, expect } from "@jest/globals";
import YAML from "yaml";

import {
  type HaEntities,
  pickEntitiesDomain,
  haEntitiesToYamlForDomain,
  haDomainListToYaml,
} from "@/lib/knx/export";

describe("domain YAML helpers", () => {
  const ent: HaEntities = {
    switches: [
      { name: "Switch A", address: "1/1/1", state_address: "1/1/2" },
      { name: "Switch B", address: "1/1/3" },
    ],
    binarySensors: [{ name: "Door", state_address: "2/1/1" }],
    lights: [
      {
        name: "Light A",
        address: "3/1/1",
        state_address: "3/1/2",
        brightness_address: "3/1/3",
        brightness_state_address: "3/1/4",
      },
    ],
    sensors: [
      { name: "Temp", state_address: "4/0/1", type: "temperature" },
      { name: "Hum", state_address: "4/0/2", type: "humidity" },
    ],
    times: [{ name: "Time", address: "5/0/0", state_address: "5/0/1" }],
    dates: [{ name: "Date", address: "5/0/2", state_address: "5/0/3" }],
    datetimes: [
      { name: "DateTime", address: "5/0/4", state_address: "5/0/5" },
    ],
    covers: [
      {
        name: "Cover A",
        move_long_address: "6/0/1",
        move_short_address: "6/0/2",
        stop_address: "6/0/3",
        position_address: "6/0/4",
        position_state_address: "6/0/5",
        angle_address: "6/0/6",
        angle_state_address: "6/0/7",
        invert_position: true,
        invert_angle: true,
      },
    ],
    scenes: [{ name: "Scene", address: "7/0/1", scene_number: 2 }],
    climates: [
      {
        name: "Bad oben",
        temperature_address: "8/0/1",
        target_temperature_state_address: "8/0/2",
        setpoint_shift_address: "8/0/3",
        setpoint_shift_mode: "DPT9002",
      },
    ],
    unknowns: [{ name: "Reserve", address: "9/9/9" }],
  };

  it("pickEntitiesDomain returns only requested domain", () => {
    const onlyLights = pickEntitiesDomain(ent, "light");
    expect(onlyLights.lights).toHaveLength(1);
    expect(onlyLights.switches).toHaveLength(0);
    expect(onlyLights.sensors).toHaveLength(0);

    const onlyUnknown = pickEntitiesDomain(ent, "_unknown");
    expect(onlyUnknown.unknowns).toHaveLength(1);
    expect(onlyUnknown.scenes).toHaveLength(0);
    expect(onlyUnknown.climates).toHaveLength(0);
  });

  it("haEntitiesToYamlForDomain emits knx root with single section", () => {
    const yaml = haEntitiesToYamlForDomain(ent, "switch");
    const parsed = YAML.parse(yaml);
    expect(parsed.knx.switch).toBeDefined();
    // All other sections should be absent
    expect(parsed.knx.light).toBeUndefined();
    expect(parsed.knx.sensor).toBeUndefined();
    expect(parsed.knx.cover).toBeUndefined();
    expect(parsed.knx.scene).toBeUndefined();
    expect(parsed.knx.climate).toBeUndefined();
    expect(parsed.knx._unknown).toBeUndefined();
    // spot-check quoting behavior for address
    expect(yaml).toContain('address: "1/1/1"');
  });

  it("haDomainListToYaml emits just a YAML list for the domain entries", () => {
    const listYaml = haDomainListToYaml(ent, "cover");
    const arr = YAML.parse(listYaml);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0].position_state_address).toBe("6/0/5");
    // Ensure addresses are quoted in list outputs too
    expect(listYaml).toContain('position_address: "6/0/4"');
  });

  it("haEntitiesToYamlForDomain emits climate entities with quoted addresses", () => {
    const yaml = haEntitiesToYamlForDomain(ent, "climate");
    const parsed = YAML.parse(yaml);
    expect(parsed.knx.climate[0]).toEqual({
      name: "Bad oben",
      temperature_address: "8/0/1",
      target_temperature_state_address: "8/0/2",
      setpoint_shift_address: "8/0/3",
      setpoint_shift_mode: "DPT9002",
    });
    expect(yaml).toContain('target_temperature_state_address: "8/0/2"');
    expect(parsed.knx.switch).toBeUndefined();
  });

  it("haDomainListToYaml includes sensor types without knx root", () => {
    const sensorYaml = haDomainListToYaml(ent, "sensor");
    const arr = YAML.parse(sensorYaml);
    expect(arr).toHaveLength(2);
    const types = arr.map((x: { type: string }) => x.type).sort();
    expect(types).toEqual(["humidity", "temperature"]);
    // No root key like `knx:`
    expect(sensorYaml.startsWith("knx:")).toBe(false);
  });
});
