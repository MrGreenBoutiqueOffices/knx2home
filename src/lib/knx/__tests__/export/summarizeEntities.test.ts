import { describe, it, expect } from "@jest/globals";
import { summarizeEntities, type HaEntities } from "@/lib/knx/export";

describe("summarizeEntities", () => {
  it("counts domains and groups sensors by type", () => {
    const ent: HaEntities = {
      switches: [{ address: "1/1/1" }],
      binarySensors: [{ state_address: "1/2/1" }],
      lights: [
        { address: "1/3/1" },
        { address: "1/3/2", brightness_address: "1/3/3" },
      ],
      sensors: [
        { state_address: "2/1/1", type: "temperature" },
        { state_address: "2/1/2", type: "temperature" },
        { state_address: "2/1/3", type: "humidity" },
      ],
      times: [],
      dates: [],
      datetimes: [],
      covers: [{ move_long_address: "4/0/1" }],
      climates: [{ temperature_address: "6/0/1", target_temperature_state_address: "6/0/2" }],
      scenes: [{ address: "5/0/1", scene_number: 1 }],
      unknowns: [{ name: "Other", address: "9/9/9" }],
    };

    const summary = summarizeEntities(ent);
    expect(summary.counts.switch).toBe(1);
    expect(summary.counts.binary_sensor).toBe(1);
    expect(summary.counts.light).toBe(2);
    expect(summary.counts.sensor).toBe(3);
    expect(summary.counts.cover).toBe(1);
    expect(summary.counts.scene).toBe(1);
    expect(summary.counts.climate).toBe(1);
    expect(summary.counts._unknown).toBe(1);
    expect(summary.counts.total).toBe(11);

    expect(summary.sensorsByType).toEqual({ temperature: 2, humidity: 1 });
  });
});
