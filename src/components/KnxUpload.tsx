"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { KnxCatalog } from "@/lib/types";
import {
  toCatalogYaml,
  buildHaEntities,
  summarizeEntities,
  haEntitiesToYaml,
  haEntitiesToYamlForDomain,
  HaDomain,
} from "@/lib/knx/export";
import { KnxParseError, useKnxWorker } from "@/hooks/useKnxWorker";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Copy, FileDown, PackageOpen } from "lucide-react";

import { downloadText } from "@/lib/utils/download";
import { buildSavedConfig, parseSavedConfig, stringifySavedConfig } from "@/lib/utils/config";
import SnapshotControls from "./knx/SnapshotControls";
import UploadDropzone from "./knx/UploadDropzone";
import OptionsBar from "./knx/OptionsBar";
import ProgressInfo from "./knx/ProgressInfo";
import StatsBar from "./knx/StatsBar";
import CodePanel from "./knx/CodePanel";
import ExportWizard from "./knx/ExportWizard";
import EntityConfigurator from "./entity/EntityConfigurator";
import {
  DOMAIN_BY_COLLECTION,
  applyEntityOverride,
  cleanOverride,
  Entities,
  EntityDomain,
  DomainEntityMap,
  EntityOverride,
  EntityOverrides,
  hasOverrideValues,
  KeyedEntities,
  makeEntityKey,
} from "./entity/entity-config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Stepper from "@/components/Stepper";

export default function KnxUpload() {
  const { parse, busy, progress, progressInfo, error } = useKnxWorker();

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<KnxCatalog | null>(null);
  const [dropReserveFromUnknown, setDropReserveFromUnknown] = useState(true);
  const [dzKey, setDzKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [yamlSearch, setYamlSearch] = useState("");
  const projectName = catalog?.meta?.name ?? "Unknown";

  const [entityOverrides, setEntityOverrides] = useState<EntityOverrides>({});

  const baseEntities = useMemo(() => (catalog ? buildHaEntities(catalog, { dropReserveFromUnknown }) : null), [
    catalog,
    dropReserveFromUnknown,
  ]);

  const keyedEntities = useMemo<KeyedEntities | null>(() => {
    if (!baseEntities) return null;
    return {
      switches: baseEntities.switches.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.switches;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      binarySensors: baseEntities.binarySensors.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.binarySensors;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      lights: baseEntities.lights.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.lights;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      sensors: baseEntities.sensors.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.sensors;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      times: baseEntities.times.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.times;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      dates: baseEntities.dates.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.dates;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      datetimes: baseEntities.datetimes.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.datetimes;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      covers: baseEntities.covers.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.covers;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      scenes: baseEntities.scenes.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.scenes;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
      unknowns: baseEntities.unknowns.map((entity, index) => {
        const domain = DOMAIN_BY_COLLECTION.unknowns;
        const key = makeEntityKey(domain, entity, index);
        return { key, domain, base: entity, current: applyEntityOverride(domain, key, entity, entityOverrides) };
      }),
    } satisfies KeyedEntities;
  }, [baseEntities, entityOverrides]);

  const adjustedEntities = useMemo(() => {
    if (!keyedEntities) return null;
    return {
      switches: keyedEntities.switches.map((item) => item.current),
      binarySensors: keyedEntities.binarySensors.map((item) => item.current),
      lights: keyedEntities.lights.map((item) => item.current),
      sensors: keyedEntities.sensors.map((item) => item.current),
      times: keyedEntities.times.map((item) => item.current),
      dates: keyedEntities.dates.map((item) => item.current),
      datetimes: keyedEntities.datetimes.map((item) => item.current),
      covers: keyedEntities.covers.map((item) => item.current),
      scenes: keyedEntities.scenes.map((item) => item.current),
      unknowns: keyedEntities.unknowns.map((item) => item.current),
    } satisfies Entities;
  }, [keyedEntities]);

  const summary = useMemo(() => (adjustedEntities ? summarizeEntities(adjustedEntities) : null), [adjustedEntities]);

  const addressIndex = useMemo(() => {
    const idx: Record<string, { name?: string; dpt?: string; id?: string }> = {};
    if (!catalog) return idx;
    if (catalog.groupAddresses?.flat) {
      for (const ga of catalog.groupAddresses.flat) {
        idx[ga.address] = { name: ga.name, dpt: ga.datapointType, id: ga.id };
      }
    } else {
      const maybeLegacy = catalog as unknown as {
        group_addresses?: Array<{ id: string; name?: string; address: string; dpt?: string }>;
      };
      if (Array.isArray(maybeLegacy.group_addresses)) {
        for (const ga of maybeLegacy.group_addresses) {
          idx[ga.address] = { name: ga.name, dpt: ga.dpt, id: ga.id };
        }
      }
    }
    return idx;
  }, [catalog]);

  const catalogYaml = useMemo(() => (catalog ? toCatalogYaml(catalog) : ""), [catalog]);
  const haYaml = useMemo(() => (adjustedEntities ? haEntitiesToYaml(adjustedEntities) : ""), [adjustedEntities]);

  const handleCopyDomain = useCallback(
    async (domain: HaDomain) => {
      if (!adjustedEntities) return;
      const yaml = haEntitiesToYamlForDomain(adjustedEntities, domain);
      try {
        await navigator.clipboard.writeText(yaml);
        const labelMap: Record<HaDomain, string> = {
          switch: "Switches",
          binary_sensor: "Binary sensors",
          light: "Lights",
          sensor: "Sensors",
          time: "Times",
          date: "Dates",
          datetime: "DateTimes",
          cover: "Covers",
          scene: "Scenes",
          _unknown: "Unknown",
        };
        toast.success("Copied", {
          description: `${labelMap[domain]} YAML copied to clipboard`,
        });
      } catch {
        toast.error("Copy failed", {
          description: "Could not copy text.",
        });
      }
    },
    [adjustedEntities]
  );

  const handleOverrideChange = useCallback(
    (domain: EntityDomain, key: string, base: DomainEntityMap[EntityDomain], patch: Partial<EntityOverride>) => {
      setEntityOverrides((prev) => {
        const prevEntry = prev[key] ?? {};
        const merged: EntityOverride = { ...prevEntry, ...patch };
        const cleaned = cleanOverride(domain, base, merged);
        if (!hasOverrideValues(cleaned)) {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (
          prevEntry.name === cleaned.name &&
          prevEntry.invert_position === cleaned.invert_position &&
          prevEntry.invert_angle === cleaned.invert_angle
        ) {
          return prev;
        }
        return { ...prev, [key]: cleaned };
      });
    },
    []
  );

  const handleOverrideReset = useCallback((key: string) => {
    setEntityOverrides((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleExportConfig = useCallback(() => {
    if (!catalog) {
      toast.error("Nothing to export", {
        description: "Upload and parse a project first.",
      });
      return;
    }
    const cfg = buildSavedConfig({
      catalog,
      overrides: entityOverrides,
      dropReserveFromUnknown,
    });
    const filenameSafe = (projectName || "project").replace(/[^a-z0-9_-]+/gi, "_");
    downloadText(`${filenameSafe}_knx2home_config.json`, stringifySavedConfig(cfg));
  }, [catalog, entityOverrides, dropReserveFromUnknown, projectName]);

  const handleImportConfig = useCallback(async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      const pick = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
        input.click();
      });
      if (!pick) return;
      const text = await pick.text();
      const cfg = parseSavedConfig(text);
      setCatalog(cfg.catalog);
      setEntityOverrides(cfg.overrides || {});
      setDropReserveFromUnknown(Boolean(cfg.options?.dropReserveFromUnknown));
      const overrideCount = Object.keys(cfg.overrides || {}).length;
      const gaCount =
        (cfg.catalog.groupAddresses && Array.isArray(cfg.catalog.groupAddresses.flat)
          ? cfg.catalog.groupAddresses.flat.length
          : 0) ||
        (Array.isArray(cfg.catalog.group_addresses) ? cfg.catalog.group_addresses.length : 0);
      const project = cfg.project ?? cfg.catalog.meta?.name ?? "Unknown";
      toast.success("Configuration loaded", {
        description: `${project} • ${gaCount} group addresses • ${overrideCount} overrides`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not import configuration";
      toast.error("Import failed", { description: msg });
    }
  }, []);

  async function handleParse() {
    if (!file || busy) return;
    setPasswordError(null);
    try {
      const cat = await parse(file, password);
      setCatalog(cat);
      setEntityOverrides({});
      setStep(2);
      toast.success("Ready", {
        description: `${cat.group_addresses.length} group addresses found.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not parse the file.";
      const code = e instanceof KnxParseError ? e.code : undefined;
      if (code === "PASSWORD_REQUIRED" || code === "PASSWORD_INVALID") {
        const hint =
          code === "PASSWORD_REQUIRED"
            ? "This project is password protected. Enter the project password and parse again."
            : "The password is not correct. Please try again.";
        setPasswordError(hint);
        toast.error(code === "PASSWORD_REQUIRED" ? "Password required" : "Invalid password", { description: hint });
        document.getElementById("opt-password")?.focus();
      } else {
        toast.error("Parsing error", { description: msg });
      }
      setCatalog(null);
      setEntityOverrides({});
    }
  }

  function handleReset() {
    setFile(null);
    setPassword("");
    setPasswordError(null);
    setCatalog(null);
    setDzKey((k) => k + 1);
    setEntityOverrides({});
    setStep(1);
  }

  const totalEntities = summary ? Object.values(summary.counts).reduce((a, b) => a + b, 0) : 0;
  const canGoPrev = step > 1;
  const canGoNext = step === 1 ? Boolean(catalog) : step === 2 ? Boolean(catalog) : false;
  const nextLabel = step === 1 ? "Go to entities" : step === 2 ? "Go to YAML" : "Done";

  return (
    <div className="min-h-screen bg-linear-to-b from-muted/20 via-background to-background">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <header className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">KNX → Home Assistant</h1>
              </div>
              <p className="text-sm text-muted-foreground">Follow the steps: upload, review entities, export YAML.</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={busy}
                className="text-sm font-semibold border-destructive/40 text-destructive hover:bg-destructive/10 w-full sm:w-auto"
              >
                Reset
              </Button>
              <SnapshotControls
                busy={busy}
                hasCatalog={Boolean(catalog)}
                onImportConfig={handleImportConfig}
                onExportConfig={handleExportConfig}
              />
              {catalog && adjustedEntities && (
                <Button onClick={() => setExportOpen(true)} className="text-sm font-semibold w-full sm:w-auto">
                  <FileDown className="h-4 w-4" />
                  Export
                </Button>
              )}
            </div>
          </div>

          <Stepper step={step} onStepChange={setStep} hasCatalog={Boolean(catalog)} />
        </header>

        {step === 1 && (
          <Section title="Upload" description="Upload and parse your .knxproj">
            <div className="space-y-4">
              <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[2fr_1fr]">
                <UploadDropzone
                  key={dzKey}
                  onSelect={(f) => {
                    setFile(f);
                    setPasswordError(null);
                  }}
                  className="h-full"
                />
                <div className="flex h-full flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm sm:p-5">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Parser & options</p>
                    <p className="text-xs text-muted-foreground">Set reserve handling, import, or start parsing.</p>
                  </div>
                  <OptionsBar
                    file={file}
                    busy={busy}
                    dropReserveFromUnknown={dropReserveFromUnknown}
                    onToggleReserve={setDropReserveFromUnknown}
                    password={password}
                    onPasswordChange={(v) => {
                      setPassword(v);
                      setPasswordError(null);
                    }}
                    passwordError={passwordError}
                    onParse={handleParse}
                    onReset={handleReset}
                  />
                </div>
              </div>
              <ProgressInfo busy={busy} progress={progress} info={progressInfo} error={error} />
            </div>
          </Section>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <Section
              title="Entities"
              description="Adjust names or settings"
              badge={catalog ? `${totalEntities} entities` : undefined}
            >
              {!catalog ? (
                <Card className="border border-dashed">
                  <CardContent className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center">
                    <PackageOpen className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-foreground">No project yet</p>
                      <p className="text-sm text-muted-foreground">Upload a .knxproj to view entities.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
                  <CardContent className="space-y-5 p-5">
                    {keyedEntities && adjustedEntities && (
                      <EntityConfigurator
                        entities={keyedEntities}
                        overrides={entityOverrides}
                        addressIndex={addressIndex}
                        onChange={handleOverrideChange}
                        onReset={handleOverrideReset}
                      />
                    )}
                    {adjustedEntities && summary ? <StatsBar summary={summary} /> : null}
                  </CardContent>
                </Card>
              )}
            </Section>
          </div>
        )}

        {step === 3 && catalog && adjustedEntities && (
          <Section title="YAML" description="Copy, search, or export">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                {summary && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        Copy
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuLabel>Copy YAML</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() =>
                          navigator.clipboard
                            .writeText(haYaml)
                            .then(() =>
                              toast.success("Copied", {
                                description: "Full YAML copied to clipboard",
                              })
                            )
                            .catch(() => toast.error("Copy failed"))
                      }
                    >
                        All (full config)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {summary.counts.switch > 0 && (
                        <DropdownMenuItem onClick={() => handleCopyDomain("switch")}>
                          Switches ({summary.counts.switch})
                        </DropdownMenuItem>
                      )}
                      {summary.counts.binary_sensor > 0 && (
                        <DropdownMenuItem onClick={() => handleCopyDomain("binary_sensor")}>
                          Binary Sensors ({summary.counts.binary_sensor})
                        </DropdownMenuItem>
                      )}
                      {summary.counts.light > 0 && (
                        <DropdownMenuItem onClick={() => handleCopyDomain("light")}>
                          Lights ({summary.counts.light})
                        </DropdownMenuItem>
                      )}
                      {summary.counts.sensor > 0 && (
                        <DropdownMenuItem onClick={() => handleCopyDomain("sensor")}>
                          Sensors ({summary.counts.sensor})
                        </DropdownMenuItem>
                      )}
                      {summary.counts.cover > 0 && (
                        <DropdownMenuItem onClick={() => handleCopyDomain("cover")}>
                          Covers ({summary.counts.cover})
                        </DropdownMenuItem>
                      )}
                      {summary.counts.scene > 0 && (
                        <DropdownMenuItem onClick={() => handleCopyDomain("scene")}>
                          Scenes ({summary.counts.scene})
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button size="sm" onClick={() => setExportOpen(true)}>
                  <FileDown className="mr-1 h-3.5 w-3.5" />
                  Export
                </Button>
              </div>
              <div className="w-full sm:w-80">
                <Input
                  value={yamlSearch}
                  onChange={(e) => setYamlSearch(e.target.value)}
                  placeholder="Search YAML or catalog..."
                />
              </div>
            </div>

            <Card className="mt-4 rounded-2xl border border-border/60 bg-card/90 shadow-sm">
              <CardContent className="p-5">
                <Tabs defaultValue="ha" className="space-y-4">
                  <TabsList className="grid w-full grid-cols-2 bg-muted/60">
                    <TabsTrigger value="ha">Home Assistant</TabsTrigger>
                    <TabsTrigger value="catalog">Catalog</TabsTrigger>
                  </TabsList>

                  <TabsContent value="ha" className="mt-0">
                    <CodePanel value={haYaml} ariaLabel="Home Assistant YAML" fullHeight searchTerm={yamlSearch} />
                  </TabsContent>

                  <TabsContent value="catalog" className="mt-0">
                    <CodePanel value={catalogYaml} ariaLabel="Catalog YAML" fullHeight searchTerm={yamlSearch} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </Section>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">Step {step} of 3</div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap sm:items-center">
            <Button
              variant="outline"
              size="sm"
              disabled={!canGoPrev}
              className="w-full basis-[48%] sm:w-auto sm:basis-auto"
              onClick={() => setStep((prev) => (prev > 1 ? ((prev - 1) as 1 | 2 | 3) : prev))}
            >
              Back
            </Button>
            <Button
              size="sm"
              disabled={!canGoNext}
              className="w-full basis-[48%] sm:w-auto sm:basis-auto"
              onClick={() => setStep((prev) => (prev < 3 ? ((prev + 1) as 1 | 2 | 3) : prev))}
            >
              {nextLabel}
            </Button>
          </div>
        </div>
      </div>

      {adjustedEntities && (
        <ExportWizard
          open={exportOpen}
          onOpenChange={setExportOpen}
          projectName={projectName}
          entities={adjustedEntities}
        />
      )}
    </div>
  );
}

function Section({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {badge ? (
          <Badge variant="secondary" className="text-xs font-semibold">
            {badge}
          </Badge>
        ) : null}
      </div>
      {children}
    </div>
  );
}
