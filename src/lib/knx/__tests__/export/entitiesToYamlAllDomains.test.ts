import { describe, it, expect } from "@jest/globals";
import YAML from "yaml";
import type { HaCover, HaDate, HaDateTime, HaLight, HaScene, HaSensor, HaSwitch, HaTime, UnknownEntity } from "@/lib/types";
import { haEntitiesToYaml } from "@/lib/knx/export";

describe("haEntitiesToYaml with all domains", () => {
  it("emits all knx domain sections and quotes names/addresses", () => {
    const switches: HaSwitch[] = [
      { name: 'Switch: "Living"', address: "1/1/1", state_address: "1/1/2" },
    ];
    const binarySensors = [ { name: "Door", state_address: "2/1/1" } ];
    const lights: HaLight[] = [
      { name: "Lamp", address: "1/2/1", state_address: "1/2/2", brightness_address: "1/2/3", brightness_state_address: "1/2/4" },
    ];
    const sensors: HaSensor[] = [ { name: "Temp", state_address: "3/0/1", type: "temperature" } ];
    const times: HaTime[] = [ { name: "Time", address: "5/0/0", state_address: "5/0/1" } ];
    const dates: HaDate[] = [ { name: "Date", address: "5/0/2", state_address: "5/0/3" } ];
    const datetimes: HaDateTime[] = [ { name: "DT", address: "5/0/4", state_address: "5/0/5" } ];
    const covers: HaCover[] = [
      { name: "Cover", move_long_address: "6/0/1", move_short_address: "6/0/2", stop_address: "6/0/3", position_address: "6/0/4", position_state_address: "6/0/5", angle_address: "6/0/6", angle_state_address: "6/0/7", invert_position: true, invert_angle: false },
    ];
    const scenes: HaScene[] = [ { name: "Scene", address: "7/0/1", scene_number: 2 } ];
    const unknowns: UnknownEntity[] = [ { name: "Reserve", address: "9/9/9" } ];

    const yaml = haEntitiesToYaml({
      switches,
      binarySensors,
      lights,
      sensors,
      times,
      dates,
      datetimes,
      covers,
      climates: [],
      scenes,
      unknowns,
    });

    const parsed = YAML.parse(yaml);
    expect(parsed.knx.switch[0].address).toBe("1/1/1");
    expect(parsed.knx.light[0].brightness_address).toBe("1/2/3");
    expect(parsed.knx.sensor[0].type).toBe("temperature");
    expect(parsed.knx.cover[0].position_state_address).toBe("6/0/5");
    expect(parsed.knx.scene[0].scene_number).toBe(2);
    expect(parsed.knx._unknown[0].name).toBe("Reserve");

    // Ensure the name with quotes parses back correctly (quoting applied in YAML output)
    expect(parsed.knx.switch[0].name).toBe('Switch: "Living"');
    // Spot-check quoting for address fields remains double-quoted in output
    expect(yaml).toContain('address: "1/1/1"');
  });
});
