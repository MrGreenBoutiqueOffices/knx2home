"use client";

import { useMemo } from "react";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ChevronDown, Lightbulb, ToggleLeft, Gauge, DoorOpen, Clock, Calendar, CalendarClock, Clapperboard, Binary, HelpCircle, Thermometer, CloudSun } from "lucide-react";
import { Badge } from "@/components/ui/badge";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DomainEntityMap,
  EntityDomain,
  EntityOverride,
  EntityOverrides,
  KeyedEntities,
  entityPrimaryIdentifier,
  extractKeyIdentifier,
} from "./entity-config";
import { SENSOR_META } from "@/lib/knx/sensorMeta";

interface EntityTableRow {
  key: string;
  domain: EntityDomain;
  base: DomainEntityMap[EntityDomain];
  current: DomainEntityMap[EntityDomain];
  override?: EntityOverride;
  primary: string;
}

export type EntityChangeHandler = (
  domain: EntityDomain,
  key: string,
  base: DomainEntityMap[EntityDomain],
  patch: Partial<EntityOverride>
) => void;

export type EntityResetHandler = (key: string) => void;

function PrimaryCell({ value, addressIndex }: { value: string; addressIndex?: Record<string, { name?: string; dpt?: string; id?: string }> }) {
  if (!value) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const info = addressIndex?.[value];
  const codeNode = (
    <code className="text-xs text-muted-foreground">{value}</code>
  );
  if (!info) return codeNode;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{codeNode}</TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col text-xs">
          <span className="font-medium">{info.name ?? "Unnamed GA"}</span>
          {info.dpt ? <span>DPT {info.dpt}</span> : null}
          {info.id ? <span>ID {info.id}</span> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface AddressBadgeProps {
  label: string;
  value?: string | null;
  intent?: "normal" | "warning";
}

function AddressBadge({ label, value, intent = "normal" }: AddressBadgeProps) {
  if (!value) return null;
  const baseClass = "rounded px-1 py-[1px] text-[0.65rem] font-medium transition-colors";
  const visualClass =
    intent === "warning"
      ? "border border-destructive/60 text-destructive"
      : "bg-muted text-muted-foreground";
  return (
    <code className={cn(baseClass, visualClass)}>
      {label}: {value}
    </code>
  );
}

function AddressBadgeList({ items, addressIndex }: { items: AddressBadgeProps[]; addressIndex?: Record<string, { name?: string; dpt?: string; id?: string }> }) {
  const visible = items.filter((item) => item.value);
  if (!visible.length) {
    return <span className="text-[0.7rem] text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((item) => {
        const info = item.value ? addressIndex?.[item.value] : undefined;
        const badge = (
          <AddressBadge
            key={`${item.label}-${item.value}`}
            label={item.label}
            value={item.value}
            intent={item.intent ?? (item.label === "_unknown" ? "warning" : "normal")}
          />
        );
        if (!info) return badge;
        return (
          <Tooltip key={`${item.label}-${item.value}`}>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent>
              <div className="flex flex-col text-xs">
                <span className="font-medium">{info.name ?? "Unnamed GA"}</span>
                {info.dpt ? <span>DPT {info.dpt}</span> : null}
                {info.id ? <span>ID {info.id}</span> : null}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function SensorTypeCell({ type }: { type: string }) {
  const meta = SENSOR_META[type] ?? {};
  const Icon = meta.Icon;
  const unit = meta.unit;
  const isUnknown = type === "_unknown";

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {Icon ? <Icon className="h-3 w-3 text-muted-foreground" /> : null}
      <code className={cn(isUnknown && "text-destructive")}>{type}</code>
      {unit ? <span className="text-muted-foreground">({unit})</span> : null}
    </span>
  );
}

export function buildRows(
  domain: EntityDomain,
  list: KeyedEntities[keyof KeyedEntities],
  overrides: EntityOverrides
): EntityTableRow[] {
  return list.map((item) => {
    const baseEntity = item.base as DomainEntityMap[typeof domain];
    const currentEntity = item.current as DomainEntityMap[typeof domain];
    const primary =
      entityPrimaryIdentifier(domain, baseEntity) ?? extractKeyIdentifier(item.key);

    return {
      key: item.key,
      domain,
      base: baseEntity,
      current: currentEntity,
      override: overrides[item.key],
      primary,
    };
  });
}

function createColumns(
  domain: EntityDomain,
  addressIndex: Record<string, { name?: string; dpt?: string; id?: string }> | undefined,
  onChange: EntityChangeHandler,
  onReset: EntityResetHandler
): ColumnDef<EntityTableRow>[] {
  type Meta = { className?: string };
  const columns: ColumnDef<EntityTableRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => {
        const { key, base, current, domain: rowDomain } = row.original;
        const overrideName = row.original.override?.name ?? "";
        return (
          <Input
            value={overrideName || current.name || ""}
            placeholder={base.name ?? "Custom name"}
            onChange={(event) =>
              onChange(rowDomain, key, base, {
                name: event.target.value,
              })
            }
            className="h-8 bg-white text-xs transition hover:bg-white focus:bg-white dark:bg-card dark:hover:bg-card dark:focus:bg-card md:h-9 md:text-sm"
          />
        );
      },
  meta: { className: "md:sticky md:left-0 md:z-10 md:bg-transparent min-w-[12rem]" } as Meta,
    },
    {
      accessorKey: "primary",
      header: "Primary GA",
      cell: ({ row }) => <PrimaryCell value={row.original.primary} addressIndex={addressIndex} />,
    },
  ];

  if (domain === "cover") {
    columns.push({
      id: "cover_commands",
      header: () => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">Commands</span>
          </TooltipTrigger>
          <TooltipContent>
            Open/close/stop addresses for the cover.
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["cover"];
        return (
          <AddressBadgeList
            addressIndex={addressIndex}
            items={[
              { label: "long", value: entity.move_long_address },
              { label: "short", value: entity.move_short_address },
              { label: "stop", value: entity.stop_address },
            ]}
          />
        );
      },
    });
    columns.push({
      id: "cover_position",
      header: () => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">Position</span>
          </TooltipTrigger>
          <TooltipContent>
            Command/state group addresses for slat position.
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["cover"];
        return (
          <AddressBadgeList
            addressIndex={addressIndex}
            items={[
              { label: "cmd", value: entity.position_address },
              { label: "state", value: entity.position_state_address },
            ]}
          />
        );
      },
    });
    columns.push({
      id: "cover_angle",
      header: () => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">Angle</span>
          </TooltipTrigger>
          <TooltipContent>
            Command/state group addresses for tilt angle.
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["cover"];
        return (
          <AddressBadgeList
            addressIndex={addressIndex}
            items={[
              { label: "cmd", value: entity.angle_address },
              { label: "state", value: entity.angle_state_address },
            ]}
          />
        );
      },
    });
    columns.push({
      id: "invert_position",
      header: () => (
        <div className="flex flex-col">
          <span>Invert position</span>
          <span className="text-xs text-muted-foreground">Reverse up/down commands</span>
        </div>
      ),
      cell: ({ row }) => {
        const { key } = row.original;
        const typedBase = row.original.base as DomainEntityMap["cover"];
        const typedCurrent = row.original.current as DomainEntityMap["cover"];
        return (
          <div className="flex items-center gap-2">
            <Switch
              className="cursor-pointer"
              checked={Boolean(typedCurrent.invert_position)}
              onCheckedChange={(checked) =>
                onChange("cover", key, typedBase, {
                  invert_position: checked,
                })
              }
              id={`${key}-invert-position`}
            />
            <Label htmlFor={`${key}-invert-position`} className="text-xs text-muted-foreground">
              Toggle
            </Label>
          </div>
        );
      },
    });
    columns.push({
      id: "invert_angle",
      header: () => (
        <div className="flex flex-col">
          <span>Invert angle</span>
          <span className="text-xs text-muted-foreground">Reverse tilt direction</span>
        </div>
      ),
      cell: ({ row }) => {
        const { key } = row.original;
        const typedBase = row.original.base as DomainEntityMap["cover"];
        const typedCurrent = row.original.current as DomainEntityMap["cover"];
        return (
          <div className="flex items-center gap-2">
            <Switch
              className="cursor-pointer"
              checked={Boolean(typedCurrent.invert_angle)}
              onCheckedChange={(checked) =>
                onChange("cover", key, typedBase, {
                  invert_angle: checked,
                })
              }
              id={`${key}-invert-angle`}
            />
            <Label htmlFor={`${key}-invert-angle`} className="text-xs text-muted-foreground">
              Toggle
            </Label>
          </div>
        );
      },
    });
  }

  if (domain === "climate") {
    const climateColumn = (
      id: string,
      header: string,
      hint: string,
      items: (entity: DomainEntityMap["climate"]) => AddressBadgeProps[]
    ) =>
      columns.push({
        id,
        header: () => (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">{header}</span>
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        ),
        cell: ({ row }) => (
          <AddressBadgeList
            addressIndex={addressIndex}
            items={items(row.original.base as DomainEntityMap["climate"])}
          />
        ),
      });
    climateColumn("climate_temperature", "Temperature", "Actual temperature and setpoint state.", (e) => [
      { label: "actual", value: e.temperature_address },
      { label: "target", value: e.target_temperature_state_address },
      { label: "humidity", value: e.humidity_state_address },
    ]);
    climateColumn("climate_shift", "Setpoint shift", "Command/state group addresses for the setpoint shift.", (e) => [
      { label: "cmd", value: e.setpoint_shift_address },
      { label: "state", value: e.setpoint_shift_state_address },
    ]);
    climateColumn("climate_mode", "Mode", "HVAC operation mode (DPT 20.102) and controller mode (DPT 20.105).", (e) => [
      { label: "op", value: e.operation_mode_address },
      { label: "op state", value: e.operation_mode_state_address },
      { label: "ctrl", value: e.controller_mode_address },
      { label: "ctrl state", value: e.controller_mode_state_address },
    ]);
    climateColumn("climate_activity", "Activity", "Valve/heating activity, command value and heat/cool state.", (e) => [
      { label: "active", value: e.active_state_address },
      { label: "value", value: e.command_value_state_address },
      { label: "heat/cool", value: e.heat_cool_state_address },
    ]);
  }

  if (domain === "weather") {
    const weatherColumn = (
      id: string,
      header: string,
      items: (entity: DomainEntityMap["weather"]) => AddressBadgeProps[]
    ) =>
      columns.push({
        id,
        header,
        cell: ({ row }) => (
          <AddressBadgeList
            addressIndex={addressIndex}
            items={items(row.original.base as DomainEntityMap["weather"])}
          />
        ),
      });
    weatherColumn("weather_climate", "Climate", (e) => [
      { label: "temp", value: e.address_temperature },
      { label: "humidity", value: e.address_humidity },
      { label: "pressure", value: e.address_air_pressure },
    ]);
    weatherColumn("weather_brightness", "Brightness", (e) => [
      { label: "S", value: e.address_brightness_south },
      { label: "W", value: e.address_brightness_west },
      { label: "E", value: e.address_brightness_east },
      { label: "N", value: e.address_brightness_north },
    ]);
    weatherColumn("weather_wind", "Wind", (e) => [
      { label: "speed", value: e.address_wind_speed },
      { label: "bearing", value: e.address_wind_bearing },
    ]);
    weatherColumn("weather_alarms", "Alarms", (e) => [
      { label: "wind", value: e.address_wind_alarm },
      { label: "rain", value: e.address_rain_alarm },
      { label: "frost", value: e.address_frost_alarm },
      { label: "day/night", value: e.address_day_night },
    ]);
  }

  if (domain === "switch") {
    columns.push({
      id: "switch_command",
      header: "Command",
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["switch"];
        return <PrimaryCell value={entity.address ?? ""} addressIndex={addressIndex} />;
      },
    });
    columns.push({
      id: "switch_state",
      header: "State",
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["switch"];
        return <PrimaryCell value={entity.state_address ?? ""} addressIndex={addressIndex} />;
      },
    });
    columns.push({
      id: "switch_respond",
      header: () => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">Respond</span>
          </TooltipTrigger>
          <TooltipContent>
            Indicates whether the switch replies to read requests.
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["switch"];
        return <span className="text-xs text-muted-foreground">{entity.respond_to_read ? "Yes" : "No"}</span>;
      },
    });
  }

  if (domain === "binary_sensor") {
    columns.push({
      id: "binary_state",
      header: "State",
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["binary_sensor"];
        return <PrimaryCell value={entity.state_address ?? ""} addressIndex={addressIndex} />;
      },
    });
  }

  if (domain === "time" || domain === "date" || domain === "datetime") {
    columns.push({
      id: `${domain}_state`,
      header: "State",
      cell: ({ row }) => {
        const entity = row.original.base as
          | DomainEntityMap["time"]
          | DomainEntityMap["date"]
          | DomainEntityMap["datetime"];
        return <PrimaryCell value={entity.state_address ?? ""} addressIndex={addressIndex} />;
      },
      meta: { className: "hidden sm:table-cell" } as Meta,
    });
  }

  if (domain === "light") {
    columns.push({
      id: "light_command",
      header: "Command",
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["light"];
        return <PrimaryCell value={entity.address ?? ""} addressIndex={addressIndex} />;
      },
      meta: { className: "hidden sm:table-cell" } as Meta,
    });
    columns.push({
      id: "light_state",
      header: "State",
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["light"];
        return <PrimaryCell value={entity.state_address ?? ""} addressIndex={addressIndex} />;
      },
      meta: { className: "hidden sm:table-cell" } as Meta,
    });
    columns.push({
      id: "light_brightness",
      header: () => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">Brightness</span>
          </TooltipTrigger>
          <TooltipContent>
            Dimming command group address (if available).
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["light"];
        return <PrimaryCell value={entity.brightness_address ?? ""} addressIndex={addressIndex} />;
      },
      meta: { className: "hidden sm:table-cell" } as Meta,
    });
  }

  if (domain === "scene") {
    columns.push({
      id: "scene_address",
      header: "Address",
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["scene"];
        return <PrimaryCell value={entity.address ?? ""} addressIndex={addressIndex} />;
      },
      meta: { className: "hidden sm:table-cell" } as Meta,
    });
  }

  if (domain === "sensor") {
    columns.push({
      id: "sensor_state",
      header: "State",
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["sensor"];
        return <PrimaryCell value={entity.state_address ?? ""} addressIndex={addressIndex} />;
      },
    });
    columns.push({
      id: "sensor_type",
      header: () => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">Type</span>
          </TooltipTrigger>
          <TooltipContent>
            KNX sensor type (e.g. temperature, humidity).
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => {
        const entity = row.original.base as DomainEntityMap["sensor"];
        return <SensorTypeCell type={entity.type} />;
      },
    });
  }

  columns.push({
    id: "actions",
    header: "Actions",
    cell: ({ row }) => {
      const { override, key } = row.original;
      if (!override) return null;
      return (
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer sm:h-8 sm:w-auto sm:px-2"
            onClick={() => onReset(key)}
            aria-label="Reset"
            title="Reset"
          >
            <span className="hidden sm:inline">Reset</span>
            <span className="inline sm:hidden">↺</span>
          </Button>
        </div>
      );
    },
    meta: { className: "" } as Meta,
  });

  return columns;
}

export interface SectionData {
  key: keyof KeyedEntities;
  domain: EntityDomain;
  label: string;
  rows: EntityTableRow[];
}

interface EntitySectionTableProps {
  section: SectionData;
  addressIndex?: Record<string, { name?: string; dpt?: string; id?: string }>;
  onChange: EntityChangeHandler;
  onReset: EntityResetHandler;
  collapsed: boolean;
  onToggle: () => void;
}

export function EntitySectionTable({
  section,
  addressIndex,
  onChange,
  onReset,
  collapsed,
  onToggle,
}: EntitySectionTableProps) {
  const ICONS: Record<EntityDomain, React.ComponentType<{ className?: string }>> = {
    switch: ToggleLeft,
    light: Lightbulb,
    binary_sensor: Binary,
    sensor: Gauge,
    time: Clock,
    date: Calendar,
    datetime: CalendarClock,
    cover: DoorOpen,
    climate: Thermometer,
    weather: CloudSun,
    scene: Clapperboard,
    _unknown: HelpCircle,
  };
  const COLOR_MAP: Record<EntityDomain, string> = {
    switch: "text-blue-500",
    light: "text-amber-500",
    binary_sensor: "text-purple-500",
    sensor: "text-green-500",
    time: "text-cyan-500",
    date: "text-pink-500",
    datetime: "text-indigo-500",
    cover: "text-orange-500",
    climate: "text-red-500",
    weather: "text-sky-500",
    scene: "text-violet-500",
    _unknown: "text-gray-500",
  };

  const columns = useMemo(
    () => createColumns(section.domain, addressIndex, onChange, onReset),
    [section.domain, addressIndex, onChange, onReset]
  );

  const table = useReactTable({
    data: section.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <section className="space-y-1.5">
      <div className="group overflow-hidden rounded-xl border border-border/70 bg-gradient-to-r from-muted/60 via-card to-card shadow-sm">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/70 text-foreground">
            {(() => {
              const Icon = ICONS[section.domain];
              const color = COLOR_MAP[section.domain];
              return Icon ? <Icon className={cn("h-5 w-5", color)} /> : <span className="text-sm font-semibold">{section.label.charAt(0)}</span>;
            })()}
          </div>
          <span className="text-sm font-semibold">{section.label}</span>
        </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[0.7rem] font-semibold shadow-sm">
              {section.rows.length}
            </Badge>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                collapsed ? "-rotate-90" : "rotate-0"
              )}
            />
          </div>
        </button>
        {!collapsed && (
          <div className="border-t border-border/60 bg-white dark:bg-background/90">
            <Table>
              <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-white dark:bg-background">
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "text-xs font-semibold text-muted-foreground",
                          (header.column.columnDef as ColumnDef<EntityTableRow> & { meta?: { className?: string } }).meta?.className
                        )}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row, idx) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        idx % 2 === 0 ? "bg-white dark:bg-background/85" : "bg-white/80 dark:bg-background/70",
                        "hover:bg-muted/30 dark:hover:bg-muted/20"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={(cell.column.columnDef as ColumnDef<EntityTableRow> & { meta?: { className?: string } }).meta?.className}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-center">
                      <span className="text-xs text-muted-foreground">No entities</span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  );
}
