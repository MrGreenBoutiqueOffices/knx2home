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

const comObject = (id: string, fn: string, dpt: string, write: boolean, transmit: boolean) =>
  `<ComObject Id="${id}" Text="Channel A" FunctionText="${fn}" DatapointType="${dpt}" ReadFlag="${
    write ? "Disabled" : "Enabled"
  }" WriteFlag="${write ? "Enabled" : "Disabled"}" TransmitFlag="${transmit ? "Enabled" : "Disabled"}" UpdateFlag="Disabled" />`;

// Shutter actuator with module based channels (ModuleDefs) and a push button application.
const actuatorApplication = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23">
  <ManufacturerData><Manufacturer RefId="M-0083"><ApplicationPrograms>
    <ApplicationProgram Id="M-0083_A-00C0-41-AD85" Name="Shutter 12-fold">
      <ModuleDefs><ModuleDef Id="M-0083_A-00C0-41-AD85_MD-2"><Static><ComObjects>
        ${comObject("M-0083_A-00C0-41-AD85_MD-2_O-2-31", "Shutter Up/Down", "DPST-1-8", true, false)}
        ${comObject("M-0083_A-00C0-41-AD85_MD-2_O-2-32", "Slats adjustment / Stop", "DPST-1-7", true, false)}
        ${comObject("M-0083_A-00C0-41-AD85_MD-2_O-2-33", "Stop", "DPST-1-17", true, false)}
        ${comObject("M-0083_A-00C0-41-AD85_MD-2_O-2-38", "Absolute position", "DPST-5-1", true, false)}
        ${comObject("M-0083_A-00C0-41-AD85_MD-2_O-2-39", "Absolute position of slats", "DPST-5-1", true, false)}
        ${comObject("M-0083_A-00C0-41-AD85_MD-2_O-2-40", "Status current position", "DPST-5-1", false, true)}
        ${comObject("M-0083_A-00C0-41-AD85_MD-2_O-2-41", "Status cur. position of slats", "DPST-5-1", false, true)}
      </ComObjects></Static></ModuleDef></ModuleDefs>
    </ApplicationProgram>
  </ApplicationPrograms></Manufacturer></ManufacturerData>
</KNX>`;

const buttonApplication = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23">
  <ManufacturerData><Manufacturer RefId="M-00E1"><ApplicationPrograms>
    <ApplicationProgram Id="M-00E1_A-E024-30-0403" Name="Push button">
      <Static><ComObjects>
        ${comObject("M-00E1_A-E024-30-0403_O-0", "Shutter long", "DPST-1-8", true, true)}
        ${comObject("M-00E1_A-E024-30-0403_O-1", "Shutter short", "DPST-1-7", true, true)}
      </ComObjects></Static>
    </ApplicationProgram>
  </ApplicationPrograms></Manufacturer></ManufacturerData>
</KNX>`;

const projectXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23" CreatedBy="ETS6">
  <Project Id="P-0001"><Installations><Installation Name="">
    <Topology><Area Id="P-0001-0_A-1" Address="1"><Line Id="P-0001-0_L-1" Address="1"><Segment Id="P-0001-0_S-1">
      <DeviceInstance Id="P-0001-0_DI-1" Address="1" Name="" Hardware2ProgramRefId="M-0083_H-282-1_HP-00C0-41-AD85">
        <ComObjectInstanceRefs>
          <ComObjectInstanceRef RefId="MD-2_M-9_MI-1_O-2-31_R-4" ChannelId="MD-2_M-9_MI-1_CH-4" Links="GA-1" />
          <ComObjectInstanceRef RefId="MD-2_M-9_MI-1_O-2-33_R-1" ChannelId="MD-2_M-9_MI-1_CH-4" Links="GA-2" />
          <ComObjectInstanceRef RefId="MD-2_M-9_MI-1_O-2-38_R-5" ChannelId="MD-2_M-9_MI-1_CH-4" Links="GA-3" />
          <ComObjectInstanceRef RefId="MD-2_M-9_MI-1_O-2-40_R-7" ChannelId="MD-2_M-9_MI-1_CH-4" Links="GA-4" />
          <ComObjectInstanceRef RefId="MD-2_M-9_MI-1_O-2-39_R-6" ChannelId="MD-2_M-9_MI-1_CH-4" Links="GA-5" />
          <ComObjectInstanceRef RefId="MD-2_M-9_MI-1_O-2-41_R-8" ChannelId="MD-2_M-9_MI-1_CH-4" Links="GA-6" />
          <ComObjectInstanceRef RefId="MD-2_M-12_MI-1_O-2-31_R-4" ChannelId="MD-2_M-12_MI-1_CH-4" Links="GA-10" />
          <ComObjectInstanceRef RefId="MD-2_M-12_MI-1_O-2-32_R-2" ChannelId="MD-2_M-12_MI-1_CH-4" Links="GA-11" />
          <ComObjectInstanceRef RefId="MD-2_M-13_MI-1_O-2-31_R-4" ChannelId="MD-2_M-13_MI-1_CH-4" Links="GA-10" />
          <ComObjectInstanceRef RefId="MD-2_M-13_MI-1_O-2-32_R-2" ChannelId="MD-2_M-13_MI-1_CH-4" Links="GA-11" />
        </ComObjectInstanceRefs>
      </DeviceInstance>
      <DeviceInstance Id="P-0001-0_DI-2" Address="2" Name="" Hardware2ProgramRefId="M-00E1_H-14024.2D10-1_HP-E024-30-0403">
        <ComObjectInstanceRefs>
          <ComObjectInstanceRef RefId="O-0_R-437" Links="GA-1" />
          <ComObjectInstanceRef RefId="O-1_R-438" Links="GA-2" />
        </ComObjectInstanceRefs>
      </DeviceInstance>
    </Segment></Line></Area></Topology>
    <GroupAddresses><GroupRanges><GroupRange Id="P-0001-0_GR-1" RangeStart="1" RangeEnd="2047" Name="Jalousie">
      <GroupAddress Id="P-0001-0_GA-1" Address="264" Name="Büro Jalousie Hoch/Runter" DatapointType="DPST-1-8" />
      <GroupAddress Id="P-0001-0_GA-2" Address="265" Name="Büro Jalousie Stop" DatapointType="DPST-1-8" />
      <GroupAddress Id="P-0001-0_GA-3" Address="266" Name="Büro Jalousie Position" DatapointType="DPST-5-1" />
      <GroupAddress Id="P-0001-0_GA-4" Address="267" Name="Büro Jalousie Position Status" DatapointType="DPST-5-1" />
      <GroupAddress Id="P-0001-0_GA-5" Address="268" Name="Büro Jalousie Lamelle" DatapointType="DPST-5-1" />
      <GroupAddress Id="P-0001-0_GA-6" Address="269" Name="Büro Jalousie Lamelle Status" DatapointType="DPST-5-1" />
      <GroupAddress Id="P-0001-0_GA-10" Address="260" Name="Wohnzimmer Jalousie Auf /Ab" DatapointType="DPST-1-8" />
      <GroupAddress Id="P-0001-0_GA-11" Address="261" Name="Wohnzimmer Jalousie Stop" DatapointType="DPST-1-8" />
      <GroupAddress Id="P-0001-0_GA-20" Address="256" Name="Gäste Jalousie Auf /Ab" DatapointType="DPST-1-8" />
      <GroupAddress Id="P-0001-0_GA-21" Address="257" Name="Gäste Jalousie Stop" DatapointType="DPST-1-8" />
    </GroupRange></GroupRanges></GroupAddresses>
  </Installation></Installations></Project>
</KNX>`;

async function entities() {
  const zip = zipSync(
    {
      "P-0001/0.xml": te.encode(projectXml),
      "M-0083/M-0083_A-00C0-41-AD85.xml": te.encode(actuatorApplication),
      "M-00E1/M-00E1_A-E024-30-0403.xml": te.encode(buttonApplication),
      "demo.knxproj": te.encode(""),
    },
    { level: 0 }
  );
  return buildHaEntities(await parseKnxproj(memoryFile("demo.knxproj", zip)));
}

describe("covers from shutter actuator channels", () => {
  it("uses the application object DPT for up/down, stop, position and slats", async () => {
    const ent = await entities();
    expect(ent.covers).toContainEqual({
      name: "Büro Jalousie",
      move_long_address: "0/1/8",
      stop_address: "0/1/9",
      position_address: "0/1/10",
      position_state_address: "0/1/11",
      angle_address: "0/1/12",
      angle_state_address: "0/1/13",
    });
  });

  it("merges motor channels driven by the same GA and ignores push buttons", async () => {
    const ent = await entities();
    const wohnzimmer = ent.covers.filter((c) => c.move_long_address === "0/1/4");
    expect(wohnzimmer).toEqual([
      { name: "Wohnzimmer Jalousie", move_long_address: "0/1/4", move_short_address: "0/1/5" },
    ]);
    // stop GAs never become their own cover
    expect(ent.covers.map((c) => c.move_long_address)).not.toEqual(expect.arrayContaining(["0/1/9", "0/1/5"]));
  });

  it("combines unlinked German up/down and stop GAs by name", async () => {
    const ent = await entities();
    expect(ent.covers).toContainEqual({ name: "Gäste Jalousie", move_long_address: "0/1/0", stop_address: "0/1/1" });
  });
});
