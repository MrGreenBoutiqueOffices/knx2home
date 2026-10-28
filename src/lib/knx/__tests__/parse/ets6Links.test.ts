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

// Shape of an ETS6 export: com objects only carry a RefId, a device-local ChannelId and a Links attribute.
const projectXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23" CreatedBy="ETS6">
  <Project Id="P-0001">
    <Installations>
      <Installation Name="">
        <Topology>
          <Area Id="P-0001-0_A-1" Address="1">
            <Line Id="P-0001-0_L-1" Address="1">
              <Segment Id="P-0001-0_S-1">
                <DeviceInstance Id="P-0001-0_DI-1" Address="1" Name="">
                  <ComObjectInstanceRefs>
                    <ComObjectInstanceRef RefId="MD-3_M-1_MI-1_O-2-31_R-1" ChannelId="MD-3_M-1_MI-1_CH-2" Links="GA-1 GA-10" />
                    <ComObjectInstanceRef RefId="MD-3_M-1_MI-1_O-2-38_R-3" ChannelId="MD-3_M-1_MI-1_CH-2" Links="GA-2" />
                    <ComObjectInstanceRef RefId="MD-1_M-2_MI-1_O-2-50_R-18" ChannelId="MD-1_M-2_MI-1_CH-2" Links="GA-7" />
                    <ComObjectInstanceRef RefId="MD-1_M-2_MI-1_O-2-51_R-19" ChannelId="MD-1_M-2_MI-1_CH-2" Links="GA-8" />
                    <ComObjectInstanceRef RefId="MD-1_M-2_MI-1_O-2-58_R-40" ChannelId="MD-1_M-2_MI-1_CH-2" Links="GA-9" />
                  </ComObjectInstanceRefs>
                </DeviceInstance>
                <DeviceInstance Id="P-0001-0_DI-2" Address="2" Name="">
                  <ComObjectInstanceRefs>
                    <ComObjectInstanceRef RefId="MD-3_M-1_MI-1_O-2-31_R-1" ChannelId="MD-3_M-1_MI-1_CH-2" Links="GA-3" />
                    <ComObjectInstanceRef RefId="MD-3_M-1_MI-1_O-2-38_R-3" ChannelId="MD-3_M-1_MI-1_CH-2" Links="GA-4" />
                    <ComObjectInstanceRef RefId="O-0_R-24" Links="GA-5" />
                    <ComObjectInstanceRef RefId="O-6_R-18" Links="GA-6" />
                  </ComObjectInstanceRefs>
                </DeviceInstance>
                <DeviceInstance Id="P-0001-0_DI-3" Address="3" Name="">
                  <ComObjectInstanceRefs>
                    <ComObjectInstanceRef RefId="O-16_R-496" Links="GA-5 GA-6" />
                  </ComObjectInstanceRefs>
                </DeviceInstance>
              </Segment>
            </Line>
          </Area>
        </Topology>
        <GroupAddresses>
          <GroupRanges>
            <GroupRange Id="P-0001-0_GR-1" RangeStart="1" RangeEnd="2047" Name="Zentral">
              <GroupAddress Id="P-0001-0_GA-1" Address="515" Name="Flur vorne Schalten EIN/AUS" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-2" Address="3" Name="Flur vorne Licht" DatapointType="DPST-1-11" />
              <GroupAddress Id="P-0001-0_GA-3" Address="516" Name="Kochinsel Schalten EIN/AUS" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-4" Address="5" Name="Kochinsel Licht" DatapointType="DPST-1-11" />
              <GroupAddress Id="P-0001-0_GA-5" Address="519" Name="Wohnzimmer EIN/AUS" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-6" Address="7" Name="Wohnzimmer Licht" DatapointType="DPST-1-11" />
              <GroupAddress Id="P-0001-0_GA-7" Address="40" Name="Windalarm" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-8" Address="782" Name="Beschattung freigeben Küche" DatapointType="DPST-1-1" />
              <GroupAddress Id="P-0001-0_GA-9" Address="41" Name="Beschattung Zustand Küche" DatapointType="DPST-1-11" />
              <GroupAddress Id="P-0001-0_GA-10" Address="512" Name="Zentralfunktion Aus" DatapointType="DPST-1-1" />
            </GroupRange>
          </GroupRanges>
        </GroupAddresses>
      </Installation>
    </Installations>
  </Project>
</KNX>`;

async function parseProject() {
  const zip = zipSync({ "P-0001/0.xml": te.encode(projectXml), "demo.knxproj": te.encode("") }, { level: 0 });
  return parseKnxproj(memoryFile("demo.knxproj", zip));
}

describe("ETS5/6 com object links", () => {
  it("reads Links attributes and scopes com objects and channels per device", async () => {
    const catalog = await parseProject();
    const linked = (catalog.links ?? []).filter((l) => l.origin === "links");
    expect(linked).toHaveLength(12);

    const dev1 = catalog.devices.find((d) => d.id === "P-0001-0_DI-1")!;
    const dev2 = catalog.devices.find((d) => d.id === "P-0001-0_DI-2")!;
    const switchObject = (dev: typeof dev1) =>
      dev.comObjects.find((co) => co.id.endsWith("_MD-3_M-1_MI-1_O-2-31_R-1"))!;
    expect(switchObject(dev1).id).not.toBe(switchObject(dev2).id);
    expect(switchObject(dev1).groupAddressRefs.map((r) => r.groupAddressId)).toEqual([
      "P-0001-0_GA-1",
      "P-0001-0_GA-10",
    ]);
    expect(switchObject(dev2).groupAddressRefs.map((r) => r.groupAddressId)).toEqual(["P-0001-0_GA-3"]);
    expect(switchObject(dev1).channelId).toBe("P-0001-0_DI-1_MD-3_M-1_MI-1_CH-2");
    expect(switchObject(dev2).channelId).toBe("P-0001-0_DI-2_MD-3_M-1_MI-1_CH-2");
  });

  it("pairs switch states from the actuator channel or a listening push button", async () => {
    const ent = buildHaEntities(await parseProject());
    const stateOf = (address: string) => ent.switches.find((s) => s.address === address)?.state_address;

    // same actuator channel, status object sends a 1.011 GA
    expect(stateOf("0/2/3")).toBe("0/0/3");
    expect(stateOf("0/2/4")).toBe("0/0/5");
    // push button sends 0/2/7 and listens to 0/0/7
    expect(stateOf("0/2/7")).toBe("0/0/7");
    // shutter channel with two switching objects is ambiguous
    expect(stateOf("0/0/40")).toBeUndefined();
    expect(stateOf("0/3/14")).toBeUndefined();
    // central function linked into the switching object is no state
    expect(stateOf("0/2/0")).toBeUndefined();

    const binaryAddresses = ent.binarySensors.map((b) => b.state_address);
    expect(binaryAddresses).not.toEqual(expect.arrayContaining(["0/0/3", "0/0/5", "0/0/7"]));
    expect(ent.lights).toHaveLength(0);
  });
});
