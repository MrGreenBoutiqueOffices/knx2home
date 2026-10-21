"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  haEntitiesToYaml,
  HaDomain,
  haDomainListToYaml,
} from "@/lib/knx/export";
import { Entities } from "@/components/entity/entity-config";
import { downloadBlob, downloadText } from "@/lib/utils/download";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ALL_DOMAINS } from "./export/constants";
import ExportOptions from "./export/ExportOptions";
import ExportActions from "./export/ExportActions";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  projectName?: string;
  entities: Entities;
};

export default function ExportWizard({
  open,
  onOpenChange,
  projectName,
  entities,
}: Props) {
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const [selected, setSelected] = useState<Set<HaDomain>>(
    new Set(ALL_DOMAINS.filter((d) => d !== "_unknown"))
  );
  const [prefix, setPrefix] = useState<string>("");

  const counts: Record<HaDomain, number> = useMemo(
    () =>
      ({
        switch: entities.switches.length,
        binary_sensor: entities.binarySensors.length,
        light: entities.lights.length,
        sensor: entities.sensors.length,
        time: entities.times.length,
        date: entities.dates.length,
        datetime: entities.datetimes.length,
        cover: entities.covers.length,
        climate: entities.climates.length,
        scene: entities.scenes.length,
        _unknown: entities.unknowns.length,
      } as Record<HaDomain, number>),
    [entities]
  );

  const availableDomains = ALL_DOMAINS.filter(
    (d) => d !== "_unknown" && counts[d] > 0
  );
  const selectedDomains = useMemo(
    () => availableDomains.filter((d) => selected.has(d)),
    [availableDomains, selected]
  );
  const selectedEntityCount = useMemo(
    () => selectedDomains.reduce((acc, d) => acc + counts[d], 0),
    [selectedDomains, counts]
  );

  useEffect(() => {
    setPrefix((projectName || "project").replace(/[^a-z0-9_-]+/gi, "_"));
  }, [projectName]);

  function toggle(domain: HaDomain) {
    const next = new Set(selected);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    setSelected(next);
  }

  function setAll(on: boolean) {
    if (on) {
      const next = new Set(availableDomains);
      setSelected(next);
    } else {
      const next = new Set<HaDomain>();
      setSelected(next);
    }
  }

  async function exportSingleYaml() {
    try {
      const domains = selectedDomains;
      if (domains.length === 0) {
        toast.error("Nothing selected", {
          description: "Choose one or more types.",
        });
        return;
      }
      // Merge strategy: start with empty and copy lists from selected domains
      const empty: Entities = {
        switches: [],
        binarySensors: [],
        lights: [],
        sensors: [],
        times: [],
        dates: [],
        datetimes: [],
        covers: [],
        climates: [],
        scenes: [],
        unknowns: [],
      };
      for (const d of domains) {
        if (d === "switch") empty.switches = entities.switches;
        else if (d === "binary_sensor")
          empty.binarySensors = entities.binarySensors;
        else if (d === "light") empty.lights = entities.lights;
        else if (d === "sensor") empty.sensors = entities.sensors;
        else if (d === "time") empty.times = entities.times;
        else if (d === "date") empty.dates = entities.dates;
        else if (d === "datetime") empty.datetimes = entities.datetimes;
        else if (d === "cover") empty.covers = entities.covers;
        else if (d === "climate") empty.climates = entities.climates;
        else if (d === "scene") empty.scenes = entities.scenes;
        else if (d === "_unknown") empty.unknowns = entities.unknowns;
      }
      const yaml = haEntitiesToYaml(empty);
      const filenameSafe =
        prefix || (projectName || "project").replace(/[^a-z0-9_-]+/gi, "_");
      downloadText(`${filenameSafe}_knx.yaml`, yaml);
      toast.success("Exported YAML", {
        description: `Saved ${domains.length} type(s)`,
      });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not export YAML";
      toast.error("Export failed", { description: msg });
    }
  }

  async function exportZip() {
    try {
      const domains = selectedDomains;
      if (domains.length === 0) {
        toast.error("Nothing selected", {
          description: "Choose one or more types.",
        });
        return;
      }
      const zip = new JSZip();
      // Add per-domain files containing only the list for that domain
      for (const d of domains) {
        const yaml = haDomainListToYaml(entities, d);
        const name = `knx/knx_${d}.yaml`;
        zip.file(name, yaml);
      }
      // Add a root file that references selected domains via !include
      const includesLines: string[] = ["knx:"];
      for (const d of domains) {
        includesLines.push(`  ${d}: !include knx/knx_${d}.yaml`);
      }
      const mainYaml = includesLines.join("\n") + "\n";
      const mainName = "knx.yaml";
      zip.file(mainName, mainYaml);
      const blob = await zip.generateAsync({ type: "blob" });
      const filenameSafe =
        prefix || (projectName || "project").replace(/[^a-z0-9_-]+/gi, "_");
      downloadBlob(`${filenameSafe}_knx_parts.zip`, blob);
      toast.success("Exported ZIP", {
        description: `${domains.length} files saved`,
      });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not export ZIP";
      toast.error("Export failed", { description: msg });
    }
  }

  const actionsDesktop = (
    <ExportActions
      onExportYaml={exportSingleYaml}
      onExportZip={exportZip}
      disabled={selectedDomains.length === 0}
      variant="desktop"
    />
  );

  const actionsMobile = (
    <ExportActions
      onExportYaml={exportSingleYaml}
      onExportZip={exportZip}
      disabled={selectedDomains.length === 0}
      variant="mobile"
    />
  );

  const content = (
    <ExportOptions
      prefix={prefix}
      setPrefix={setPrefix}
      availableDomains={availableDomains}
      counts={counts}
      selected={selected}
      toggle={toggle}
      setAll={setAll}
      selectedDomains={selectedDomains}
      selectedEntityCount={selectedEntityCount}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="mx-auto w-full max-w-3xl">
            <DialogHeader className="text-left">
              <DialogTitle>Export Home Assistant YAML</DialogTitle>
              <DialogDescription>
                Choose which entity types to export. Download as a single YAML
                file or a ZIP with separate files per type.
              </DialogDescription>
            </DialogHeader>
            {content}
            <DialogFooter className="mt-6">{actionsDesktop}</DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[85vh] rounded-t-2xl">
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 pb-4">
              <DrawerHeader className="p-0 pt-4 text-left">
                <DrawerTitle>Export Home Assistant YAML</DrawerTitle>
                <DrawerDescription>
                  Choose which entity types to export. Download as a single YAML
                  file or a ZIP with separate files per type.
                </DrawerDescription>
              </DrawerHeader>
              {content}
            </div>
          </div>
          <DrawerFooter className="border-t">
            <div className="flex w-full flex-nowrap items-center justify-between gap-2 overflow-x-auto">
              {actionsMobile}
            </div>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
