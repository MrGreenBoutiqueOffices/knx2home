"use client";

import { Badge } from "@/components/ui/badge";
import type { EntitySummary } from "@/lib/knx/export";
import { SENSOR_META } from "@/lib/knx/sensorMeta";
import {
  Lightbulb,
  ToggleLeft,
  Gauge,
  DoorOpen,
  Clock,
  Calendar,
  CalendarClock,
  Clapperboard,
  Binary,
  HelpCircle,
  Thermometer,
  CloudSun,
} from "lucide-react";

const DOMAIN_ICONS = {
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

const DOMAIN_COLORS = {
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

export default function StatsBar({ summary }: { summary: EntitySummary }) {
  const unknownCount = summary.counts._unknown;
  const totalCount = summary.counts.total;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="rounded-md bg-destructive/15 p-1.5">
              <HelpCircle className="h-4 w-4 text-destructive" strokeWidth={2} />
            </div>
            <span className="text-sm font-semibold">Unknown</span>
          </div>
          <Badge className="bg-destructive text-destructive-foreground font-bold">
            {unknownCount}
          </Badge>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="rounded-md bg-primary/15 p-1.5">
              <Gauge className="h-4 w-4 text-primary" strokeWidth={2} />
            </div>
            <span className="text-sm font-semibold">Total</span>
          </div>
          <Badge className="bg-primary text-primary-foreground font-bold">
            {totalCount}
          </Badge>
        </div>
      </div>

      {/* Sensor Types - keep for context */}
      {Object.keys(summary.sensorsByType).length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Sensor Types
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(summary.sensorsByType)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([type, count]) => {
                const meta = SENSOR_META[type] ?? {};
                const Icon = meta.Icon;
                return (
                  <Badge
                    key={type}
                    variant="outline"
                    className="gap-1.5 text-xs"
                  >
                    {Icon && <Icon className="h-3 w-3" />}
                    <span className="font-mono">{type}</span>
                    <span className="text-muted-foreground">×{count}</span>
                  </Badge>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
