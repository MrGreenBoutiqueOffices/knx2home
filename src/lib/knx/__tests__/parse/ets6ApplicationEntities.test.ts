import { describe, expect, it } from "@jest/globals";
import { zipSync } from "fflate";

import { parseKnxproj } from "@/lib/knx/parse";
import { buildHaEntities } from "@/lib/knx/export";

const te = new TextEncoder();

function memoryFile(name: string, data: Uint8Array): File {
  return {
    name,
    size: data.byteLength,
    type: "application/zip",
    lastModified: Date.now(),
    arrayBuffer: () => Promise.resolve(data.slice().buffer),
  } as unknown as File;
}

// Dimming actuator without ETS channels: the application program groups objects by their text.
const dimmerApplication = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23">
  <ManufacturerData>
    <Manufacturer RefId="M-0083">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0083_A-001B-22-AEFA" Name="Dimming 4-fold">
          <Static>
            <ComObjectTable>
              <ComObject Id="M-0083_A-001B-22-AEFA_O-0" Name="Switch_0" Text="Channel A" Number="0" FunctionText="Switch" ReadFlag="Disabled" WriteFlag="Enabled" TransmitFlag="Disabled" UpdateFlag="Disabled" />
              <ComObject Id="M-0083_A-001B-22-AEFA_O-4" Name="DimRel_0" Text="Channel A" Number="4" FunctionText="Dimming relative" ReadFlag="Disabled" WriteFlag="Enabled" TransmitFlag="Disabled" UpdateFlag="Disabled" />
              <ComObject Id="M-0083_A-001B-22-AEFA_O-5" Name="DimAbs_0" Text="Channel A" Number="5" FunctionText="Dimming absolute" ReadFlag="Disabled" WriteFlag="Enabled" TransmitFlag="Disabled" UpdateFlag="Disabled" />
              <ComObject Id="M-0083_A-001B-22-AEFA_O-6" Name="StateOnOff_0" Text="Channel A" Number="6" FunctionText="State On/Off" ReadFlag="Enabled" WriteFlag="Disabled" TransmitFlag="Enabled" UpdateFlag="Disabled" />
              <ComObject Id="M-0083_A-001B-22-AEFA_O-7" Name="StateDimming_0" Text="Channel A" Number="7" FunctionText="State of dimming value" ReadFlag="Enabled" WriteFlag="Disabled" TransmitFlag="Enabled" UpdateFlag="Disabled" />
              <ComObject Id="M-0083_A-001B-22-AEFA_O-30" Name="HeatCool" Text="Heating = 1 / Cooling = 0" Number="30" FunctionText="Switchover" ReadFlag="Disabled" WriteFlag="Enabled" TransmitFlag="Enabled" UpdateFlag="Enabled" />
              <ComObject Id="M-0083_A-001B-22-AEFA_O-31" Name="HeatCoolState" Text="Heating = 1 / Cooling = 0" Number="31" FunctionText="Status" ReadFlag="Enabled" WriteFlag="Disabled" TransmitFlag="Enabled" UpdateFlag="Disabled" />
            </ComObjectTable>
          </Static>
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

const projectXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23" CreatedBy="ETS6">
  <Project Id="P-0001">
    <Installations>
      <Installation Name="">
        <Topology>
          <Area Id="P-0001-0_A-1" Address="1">
            <Line Id="P-0001-0_L-1" Address="1">
              <Segment Id="P-0001-0_S-1">
                <DeviceInstance Id="P-0001-0_DI-1" Address="1" Name="" Hardware2ProgramRefId="M-0083_H-250-1_HP-001B-22-AEFA">
                  <ComObjectInstanceRefs>
                    <ComObjectInstanceRef RefId="O-0_R-24" Links="GA-1" />
                    <ComObjectInstanceRef RefId="O-4_R-1" Links="GA-3" />
                    <ComObjectInstanceRef RefId="O-5_R-2" Links="GA-4" />
                    <ComObjectInstanceRef RefId="O-6_R-18" Links="GA-2" />
                    <ComObjectInstanceRef RefId="O-7_R-3" Links="GA-5" />
                  </ComObjectInstanceRefs>
                </DeviceInstance>
                <DeviceInstance Id="P-0001-0_DI-2" Address="2" Name="">
                  <ComObjectInstanceRefs>
                    <ComObjectInstanceRef RefId="O-55_R-4" Links="GA-10" />
                    <ComObjectInstanceRef RefId="O-54_R-3" Links="GA-11" />
                    <ComObjectInstanceRef RefId="O-17_R-50" Links="GA-12" />
                    <ComObjectInstanceRef RefId="O-34_R-73" Links="GA-13" />
                    <ComObjectInstanceRef RefId="O-53_R-13" Links="GA-14" />
                    <ComObjectInstanceRef RefId="O-52_R-15" Links="GA-15" />
                    <ComObjectInstanceRef RefId="O-51_R-1" Links="GA-16" />
                  </ComObjectInstanceRefs>
                </DeviceInstance>
                <DeviceInstance Id="P-0001-0_DI-3" Address="3" Name="">
                  <ComObjectInstanceRefs>
                    <ComObjectInstanceRef RefId="O-11_R-29" Links="GA-10" />
                    <ComObjectInstanceRef RefId="O-12_R-30" Links="GA-12" />
                  </ComObjectInstanceRefs>
                </DeviceInstance>
              </Segment>
            </Line>
          </Area>
        </Topology>
        <GroupAddresses>
          <GroupRanges>
            <GroupRange Id="P-0001-0_GR-1" RangeStart="1" RangeEnd="2047" Name="EG">
              <GroupAddress Id="P-0001-0_GA-1" Address="519" Name="Wohnzimmer EIN/AUS" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-2" Address="7" Name="Wohnzimmer Licht" DatapointType="DPST-1-11" />
              <GroupAddress Id="P-0001-0_GA-3" Address="769" Name="Wohnzimmer Dimmen relativ" DatapointType="DPST-3-7" />
              <GroupAddress Id="P-0001-0_GA-4" Address="773" Name="Wohnzimmer Dimmen absolut" DatapointType="DPST-5-1" />
              <GroupAddress Id="P-0001-0_GA-5" Address="778" Name="Wohnzimmer Dimmen Status" DatapointType="DPST-5-1" />
              <GroupAddress Id="P-0001-0_GA-10" Address="1040" Name="Außentemperatur" DatapointType="DPST-9-1" />
              <GroupAddress Id="P-0001-0_GA-11" Address="1041" Name="Windgeschwindigkeit" DatapointType="DPST-9-5" />
              <GroupAddress Id="P-0001-0_GA-12" Address="1044" Name="Süd Sonneneinstrahlung" DatapointType="DPST-9-4" />
              <GroupAddress Id="P-0001-0_GA-13" Address="1043" Name="West Sonneneinstrahlung" DatapointType="DPST-9-4" />
              <GroupAddress Id="P-0001-0_GA-14" Address="40" Name="Windalarm" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-15" Address="1046" Name="Tag/Nacht" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-16" Address="1042" Name="Dämmerung" DatapointType="DPST-9-4" />
              <GroupAddress Id="P-0001-0_GA-20" Address="783" Name="Diagnosetext Küche" DatapointType="DPST-16-0" />
              <GroupAddress Id="P-0001-0_GA-21" Address="784" Name="Info Latin" DatapointType="DPST-16-1" />
            </GroupRange>
          </GroupRanges>
        </GroupAddresses>
      </Installation>
    </Installations>
  </Project>
</KNX>`;

async function parseProject() {
  const zip = zipSync(
    {
      "P-0001/0.xml": te.encode(projectXml),
      "M-0083/M-0083_A-001B-22-AEFA.xml": te.encode(dimmerApplication),
      "demo.knxproj": te.encode(""),
    },
    { level: 0 }
  );
  return parseKnxproj(memoryFile("demo.knxproj", zip));
}

describe("ETS6 application program data", () => {
  it("derives channels and flags from the application program", async () => {
    const catalog = await parseProject();
    const switchLink = catalog.links?.find((l) => l.comObjectId === "P-0001-0_DI-1_O-0_R-24");
    expect(switchLink?.channelId).toBe("P-0001-0_DI-1_text:Channel A");
    expect(switchLink?.flags).toEqual({ ReadFlag: false, WriteFlag: true, TransmitFlag: false, UpdateFlag: false });
    const device = catalog.devices.find((d) => d.id === "P-0001-0_DI-1")!;
    expect(device.channels.map((c) => c.name)).toEqual(["Channel A"]);
  });

  it("exports a dimming actuator output as light instead of a switch", async () => {
    const ent = buildHaEntities(await parseProject());
    expect(ent.lights).toEqual([
      {
        name: "Wohnzimmer",
        address: "0/2/7",
        state_address: "0/0/7",
        brightness_address: "0/3/5",
        brightness_state_address: "0/3/10",
      },
    ]);
    expect(ent.switches.map((s) => s.address)).not.toContain("0/2/7");
    expect(ent.sensors.map((s) => s.state_address)).not.toEqual(expect.arrayContaining(["0/3/5", "0/3/10"]));
  });

  it("builds one weather entity for the weather station", async () => {
    const ent = buildHaEntities(await parseProject());
    expect(ent.weathers).toEqual([
      {
        name: "Wetterstation",
        address_temperature: "0/4/16",
        address_brightness_south: "0/4/20",
        address_brightness_west: "0/4/19",
        address_wind_speed: "0/4/17",
        address_wind_alarm: "0/0/40",
        address_day_night: "0/4/22",
      },
    ]);
    // weather station values stay available as sensors
    expect(ent.sensors.map((s) => s.state_address)).toEqual(expect.arrayContaining(["0/4/16", "0/4/17"]));
  });

  it("exports DPT 16 group addresses as text sensors", async () => {
    const ent = buildHaEntities(await parseProject());
    expect(ent.sensors).toEqual(
      expect.arrayContaining([
        { name: "Diagnosetext Küche", state_address: "0/3/15", type: "string" },
        { name: "Info Latin", state_address: "0/3/16", type: "latin_1" },
      ])
    );
  });
});
