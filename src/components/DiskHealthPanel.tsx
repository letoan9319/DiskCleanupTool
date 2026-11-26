import { useMemo, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Clock,
  Copy,
  Download,
  FileJson,
  Gauge,
  HardDrive,
  Heart,
  RefreshCw,
  ShieldAlert,
} from "./WindowsIcons";
import {
  DiskHealthReport,
  HealthStatus,
  PhysicalDiskHealth,
  SmartAttrStatus,
  formatNumber,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface DiskHealthPanelProps {
  report: DiskHealthReport | null;
  loading: boolean;
  hasScanSummary: boolean;
  autoRefreshSec: number;
  onChangeAutoRefresh: (sec: number) => void;
  onRefresh: () => void;
  onRelaunchAdmin: () => void;
  onBackHome: () => void;
  onCopyText: (text: string, toastMsg: string) => void;
  onToast: (msg: string, isError?: boolean) => void;
}

function formatCapacityGb(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const gb = bytes / 1_000_000_000;
  if (gb >= 1000) {
    return `${(gb / 1000).toFixed(2)} TB (${gb.toFixed(1)} GB)`;
  }
  return `${gb.toFixed(1)} GB`;
}

function formatHostBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  const gb = bytes / 1_000_000_000;
  if (gb >= 10_000) {
    return `${(bytes / 1_000_000_000_000).toFixed(2)} TB (${formatNumber(Math.round(gb))} GB)`;
  }
  if (gb >= 1) {
    return `${formatNumber(Math.round(gb))} GB`;
  }
  return `${formatNumber(Math.round(bytes / 1_000_000))} MB`;
}

function formatTemp(tempC: number | null, unit: "C" | "F"): string {
  if (tempC === null || tempC === undefined) return "—";
  if (unit === "F") {
    return `${Math.round((tempC * 9) / 5 + 32)} °F`;
  }
  return `${tempC} °C`;
}

function healthColor(status: HealthStatus): string {
  switch (status) {
    case "good":
      return "var(--success)";
    case "caution":
      return "var(--warning)";
    case "critical":
      return "var(--danger)";
    default:
      return "var(--text-muted)";
  }
}

function tempColor(tempC: number | null): string {
  if (tempC === null) return "var(--text-muted)";
  if (tempC >= 60) return "var(--danger)";
  if (tempC >= 50) return "var(--warning)";
  return "var(--success)";
}

function attrDotColor(status: SmartAttrStatus): string {
  switch (status) {
    case "good":
      return "var(--accent)";
    case "caution":
      return "var(--warning)";
    case "critical":
      return "var(--danger)";
    default:
      return "var(--text-muted)";
  }
}

function buildClipboardReport(disk: PhysicalDiskHealth, maskSerial: boolean): string {
  const serial = maskSerial ? "****************" : disk.serialNumber || "N/A";
  const lines = [
    `DiskCleanupTool S.M.A.R.T. Report — Disk ${disk.diskIndex}: ${disk.model}`,
    `Capacity: ${formatCapacityGb(disk.capacityBytes)} | Drives: ${disk.driveLetters.join(" ") || "—"}`,
    `Firmware: ${disk.firmware || "—"} | Serial: ${serial}`,
    `Interface: ${disk.interfaceType} | Standard: ${disk.standard} | Media: ${disk.mediaType}`,
    `Health: ${disk.healthStatus.toUpperCase()}${disk.healthPercent !== null ? ` (${disk.healthPercent}%)` : ""} | Temp: ${disk.temperatureC !== null ? `${disk.temperatureC} °C` : "—"}`,
    `Host Reads: ${formatHostBytes(disk.totalHostReadsBytes)} | Host Writes: ${formatHostBytes(disk.totalHostWritesBytes)}`,
    `Power Cycles: ${disk.powerOnCount !== null ? formatNumber(disk.powerOnCount) : "—"} | Power On Hours: ${disk.powerOnHours !== null ? `${formatNumber(disk.powerOnHours)} hrs` : "—"}`,
  ];
  if (disk.attributes.length > 0) {
    lines.push("", "ID  Attribute Name                             Value                 Raw (Hex)");
    for (const a of disk.attributes) {
      lines.push(
        `${a.idHex}  ${a.name.padEnd(42, " ")} ${a.decodedValue.padEnd(21, " ")} ${a.rawHex}`
      );
    }
  }
  return lines.join("\n");
}

export function DiskHealthPanel({
  report,
  loading,
  hasScanSummary,
  autoRefreshSec,
  onChangeAutoRefresh,
  onRefresh,
  onRelaunchAdmin,
  onBackHome,
  onCopyText,
  onToast,
}: DiskHealthPanelProps) {
  const { t } = useI18n();
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [tempUnit, setTempUnit] = useState<"C" | "F">("C");
  const [maskSerial, setMaskSerial] = useState<boolean>(false);
  const [onlyWarnings, setOnlyWarnings] = useState<boolean>(false);

  const disks = report?.disks ?? [];
  const activeDisk: PhysicalDiskHealth | null =
    disks.find((d) => d.diskIndex === selectedIdx) ?? disks[0] ?? null;

  const filteredAttrs = useMemo(() => {
    if (!activeDisk) return [];
    if (!onlyWarnings) return activeDisk.attributes;
    return activeDisk.attributes.filter(
      (a) => a.status === "caution" || a.status === "critical"
    );
  }, [activeDisk, onlyWarnings]);

  const statusText = (s: HealthStatus): string => {
    switch (s) {
      case "good":
        return t.healthGood;
      case "caution":
        return t.healthCaution;
      case "critical":
        return t.healthCritical;
      default:
        return t.healthUnknown;
    }
  };

  const handleExport = async (format: "txt" | "json") => {
    if (!activeDisk) return;
    try {
      const destPath = await saveDialog({
        defaultPath: `disk${activeDisk.diskIndex}-smart-report.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!destPath) return;
      await invoke("export_disk_health", {
        diskIndex: activeDisk.diskIndex,
        format,
        maskSerial,
        destPath,
      });
      onToast(t.healthExportSaved);
    } catch (err) {
      onToast(String(err), true);
    }
  };

  return (
    <section className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Top Disk Health Control Strip */}
      <div
        className="px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap shrink-0"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {!hasScanSummary && (
            <button
              type="button"
              onClick={onBackHome}
              className="h-7 px-2.5 border text-[12px] flex items-center gap-1.5 cursor-pointer"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.healthBackHome}</span>
            </button>
          )}
          <div className="flex items-center gap-2 pr-2">
            <Heart className="w-4 h-4 text-rose-400" />
            <h2 className="font-semibold text-[13px] tracking-tight">{t.healthTitle}</h2>
          </div>

          {/* Physical Disk Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {disks.map((d) => {
              const isCurrent = activeDisk?.diskIndex === d.diskIndex;
              return (
                <button
                  key={d.diskIndex}
                  type="button"
                  onClick={() => setSelectedIdx(d.diskIndex)}
                  className="px-2.5 py-1 border text-[11px] flex items-center gap-2 cursor-pointer transition-colors"
                  style={{
                    backgroundColor: isCurrent ? "var(--bg-selected)" : "var(--bg-elevated)",
                    borderColor: isCurrent ? "var(--accent)" : "var(--border-subtle)",
                    boxShadow: isCurrent ? "2px 2px 0 var(--pixel-shadow)" : "none",
                  }}
                >
                  <span
                    className="w-2 h-2 inline-block shrink-0"
                    style={{ backgroundColor: healthColor(d.healthStatus) }}
                  />
                  <span className="font-mono-num font-semibold">
                    {d.driveLetters.length > 0 ? d.driveLetters.join(" ") : `Disk ${d.diskIndex}`}
                  </span>
                  {d.healthPercent !== null && (
                    <span className="font-mono-num" style={{ color: healthColor(d.healthStatus) }}>
                      {d.healthPercent}%
                    </span>
                  )}
                  {d.temperatureC !== null && (
                    <span className="font-mono-num font-semibold" style={{ color: tempColor(d.temperatureC) }}>
                      {formatTemp(d.temperatureC, tempUnit)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Utility actions */}
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <button
            type="button"
            onClick={() => setTempUnit((u) => (u === "C" ? "F" : "C"))}
            className="h-7 px-2 border font-mono-num cursor-pointer"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            °{tempUnit}
          </button>

          <select
            value={autoRefreshSec}
            onChange={(e) => onChangeAutoRefresh(Number(e.target.value))}
            className="h-7 px-1.5 border text-[11px] outline-none cursor-pointer"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
            title={t.healthAutoRefresh}
          >
            <option value={0}>
              {t.healthAutoRefresh}: {t.healthAutoOff}
            </option>
            <option value={30}>{t.healthAutoRefresh}: 30s</option>
            <option value={60}>{t.healthAutoRefresh}: 60s</option>
            <option value={300}>{t.healthAutoRefresh}: 5m</option>
          </select>

          <button
            type="button"
            onClick={() => setMaskSerial((m) => !m)}
            className="h-7 px-2 border cursor-pointer"
            style={{
              backgroundColor: maskSerial ? "var(--bg-selected)" : "var(--bg-elevated)",
              borderColor: maskSerial ? "var(--accent)" : "var(--border-subtle)",
              color: maskSerial ? "var(--accent)" : "var(--text-secondary)",
            }}
          >
            {maskSerial ? t.healthShowSerial : t.healthHideSerial}
          </button>

          {activeDisk && (
            <>
              <button
                type="button"
                onClick={() =>
                  onCopyText(buildClipboardReport(activeDisk, maskSerial), t.healthReportCopied)
                }
                className="h-7 px-2 border flex items-center gap-1 cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
                title={t.healthCopyReport}
              >
                <Copy className="w-3 h-3" />
                <span className="hidden lg:inline">{t.healthCopyReport}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleExport("txt")}
                className="h-7 px-2 border flex items-center gap-1 cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
                title={t.healthExportTxt}
              >
                <Download className="w-3 h-3" />
                <span>TXT</span>
              </button>

              <button
                type="button"
                onClick={() => void handleExport("json")}
                className="h-7 px-2 border flex items-center gap-1 cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
                title={t.healthExportJson}
              >
                <FileJson className="w-3 h-3" />
                <span>JSON</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 px-2.5 border font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: "var(--accent-strong)",
              borderColor: "var(--border-strong)",
              color: "#ffffff",
            }}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? t.healthRefreshing : t.healthRefresh}</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        {!activeDisk ? (
          <div
            className="flex-1 flex flex-col items-center justify-center py-16 gap-2 text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            <HardDrive className="w-7 h-7 opacity-60" />
            <span>{loading ? t.healthRefreshing : t.healthNoDisks}</span>
          </div>
        ) : (
          <>
            {/* Admin prompt if S.M.A.R.T. requires elevation */}
            {activeDisk.requiresAdminForSmart && (
              <div
                className="px-3 py-2.5 border flex items-center justify-between gap-3 flex-wrap text-[12px] shrink-0"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--warning)",
                  boxShadow: "3px 3px 0 var(--pixel-shadow)",
                }}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>{t.healthAdminRequired}</span>
                </div>
                <button
                  type="button"
                  onClick={onRelaunchAdmin}
                  className="h-7 px-3 border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
                  style={{
                    backgroundColor: "var(--accent-strong)",
                    borderColor: "var(--border-strong)",
                    color: "#ffffff",
                  }}
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{t.healthAdminBtn}</span>
                </button>
              </div>
            )}

            {/* Disk Identity & Top Telemetry Cards */}
            <div
              className="border p-3.5 flex flex-col gap-3 shrink-0"
              style={{
                backgroundColor: "var(--bg-panel)",
                borderColor: "var(--border-strong)",
                boxShadow: "3px 3px 0 var(--pixel-shadow)",
              }}
            >
              {/* Model Title Row */}
              <div className="flex items-center justify-between gap-3 flex-wrap border-b pb-2.5" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <HardDrive className="w-5 h-5 shrink-0" style={{ color: "var(--accent)" }} />
                  <h3 className="font-mono-num font-bold text-[16px] truncate">
                    {activeDisk.model}
                  </h3>
                  <span
                    className="font-mono-num text-[12px] font-semibold px-2 py-0.5 border shrink-0"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    {formatCapacityGb(activeDisk.capacityBytes)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono-num">
                  <span
                    className="px-2 py-0.5 border"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-subtle)",
                      color: "var(--accent)",
                    }}
                  >
                    {activeDisk.standard}
                  </span>
                  <span
                    className="px-2 py-0.5 border"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {activeDisk.mediaType}
                  </span>
                </div>
              </div>

              {/* Health + Temp Left Column | Specs Right Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Left: Health & Temperature Status Cards */}
                <div className="lg:col-span-3 flex flex-row lg:flex-col gap-2.5">
                  <div
                    className="flex-1 p-3 border flex flex-col justify-between gap-2"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: healthColor(activeDisk.healthStatus),
                    }}
                  >
                    <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <span>{t.healthStatusLabel}</span>
                      <Heart className="w-3.5 h-3.5" style={{ color: healthColor(activeDisk.healthStatus) }} />
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span
                        className="font-mono-num text-[20px] font-bold"
                        style={{ color: healthColor(activeDisk.healthStatus) }}
                      >
                        {statusText(activeDisk.healthStatus)}
                      </span>
                      {activeDisk.healthPercent !== null && (
                        <span className="font-mono-num text-[18px] font-bold">
                          {activeDisk.healthPercent}%
                        </span>
                      )}
                    </div>
                    {activeDisk.healthPercent !== null && (
                      <div className="w-full h-2 overflow-hidden" style={{ backgroundColor: "var(--bar-track)" }}>
                        <div
                          className="h-full"
                          style={{
                            width: `${activeDisk.healthPercent}%`,
                            backgroundColor: healthColor(activeDisk.healthStatus),
                            backgroundImage:
                              "repeating-linear-gradient(90deg, transparent 0 8px, var(--bg-elevated) 8px 10px)",
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div
                    className="flex-1 p-3 border flex flex-col justify-between gap-1.5"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: tempColor(activeDisk.temperatureC),
                    }}
                  >
                    <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <span>{t.healthTempLabel}</span>
                      <Gauge className="w-3.5 h-3.5" style={{ color: tempColor(activeDisk.temperatureC) }} />
                    </div>
                    <div
                      className="font-mono-num text-[22px] font-bold"
                      style={{ color: tempColor(activeDisk.temperatureC) }}
                    >
                      {formatTemp(activeDisk.temperatureC, tempUnit)}
                    </div>
                    {activeDisk.temperatureC !== null && (
                      <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {activeDisk.temperatureC >= 60
                          ? t.healthTempHotWarn
                          : activeDisk.temperatureC >= 50
                          ? t.healthTempWarmWarn
                          : t.healthTempNormal}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Technical Metadata Grid */}
                <div className="lg:col-span-9 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  {[
                    [t.healthFirmware, activeDisk.firmware || "—"],
                    [t.healthHostReads, formatHostBytes(activeDisk.totalHostReadsBytes)],
                    [
                      t.healthSerial,
                      maskSerial ? "••••••••••••••••" : activeDisk.serialNumber || "—",
                    ],
                    [t.healthHostWrites, formatHostBytes(activeDisk.totalHostWritesBytes)],
                    [t.healthInterface, activeDisk.interfaceType],
                    [
                      t.healthPowerCycles,
                      activeDisk.powerOnCount !== null
                        ? formatNumber(activeDisk.powerOnCount)
                        : "—",
                    ],
                    [
                      t.healthDriveLetters,
                      activeDisk.driveLetters.length > 0 ? activeDisk.driveLetters.join("  ") : "—",
                    ],
                    [
                      t.healthPowerHours,
                      activeDisk.powerOnHours !== null
                        ? `${formatNumber(activeDisk.powerOnHours)} hrs`
                        : "—",
                    ],
                    [
                      t.healthMediaType,
                      activeDisk.rotationRate && activeDisk.rotationRate > 0
                        ? `${activeDisk.mediaType} (${activeDisk.rotationRate} RPM)`
                        : activeDisk.mediaType,
                    ],
                    [
                      t.healthUnsafeShutdowns,
                      activeDisk.unsafeShutdowns !== null
                        ? formatNumber(activeDisk.unsafeShutdowns)
                        : "—",
                    ],
                    [
                      t.healthFeatures,
                      activeDisk.features.length > 0 ? activeDisk.features.join(", ") : "—",
                    ],
                    [
                      t.healthAvailSpare,
                      activeDisk.availableSparePct !== null
                        ? `${activeDisk.availableSparePct}%`
                        : "—",
                    ],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-3 py-1 px-2 border-b"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                        {label}
                      </span>
                      <span className="font-mono-num font-medium truncate text-right" title={val}>
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Diagnostic Notes */}
              {activeDisk.diagnosticNotes.length > 0 && !activeDisk.requiresAdminForSmart && (
                <div className="flex flex-col gap-1 pt-1">
                  {activeDisk.diagnosticNotes.map((note, idx) => (
                    <div
                      key={idx}
                      className="px-2.5 py-1.5 border text-[11px] flex items-center gap-2"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        borderColor: "var(--warning)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* S.M.A.R.T. Attribute Table */}
            {activeDisk.attributes.length > 0 && (
              <div
                className="border flex flex-col overflow-hidden shrink-0"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-strong)",
                  boxShadow: "3px 3px 0 var(--pixel-shadow)",
                }}
              >
                <div
                  className="px-3 py-2 border-b flex items-center justify-between gap-2"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center gap-2 text-[12px] font-semibold">
                    <Activity className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                    <span>
                      {t.healthAttrTableTitle} ({filteredAttrs.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setOnlyWarnings(false)}
                      className="px-2 py-0.5 border cursor-pointer"
                      style={{
                        backgroundColor: !onlyWarnings ? "var(--bg-selected)" : "transparent",
                        borderColor: !onlyWarnings ? "var(--accent)" : "var(--border-subtle)",
                        color: !onlyWarnings ? "var(--accent)" : "var(--text-secondary)",
                      }}
                    >
                      {t.healthAllAttrs}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnlyWarnings(true)}
                      className="px-2 py-0.5 border cursor-pointer"
                      style={{
                        backgroundColor: onlyWarnings ? "var(--bg-selected)" : "transparent",
                        borderColor: onlyWarnings ? "var(--warning)" : "var(--border-subtle)",
                        color: onlyWarnings ? "var(--warning)" : "var(--text-secondary)",
                      }}
                    >
                      {t.healthOnlyWarnings}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr
                        className="border-b text-[11px] uppercase tracking-wider"
                        style={{
                          borderColor: "var(--border-subtle)",
                          color: "var(--text-muted)",
                        }}
                      >
                        <th className="py-1.5 px-2.5 w-8 text-center" />
                        <th className="py-1.5 px-2 w-12 text-left font-mono-num">{t.healthColId}</th>
                        <th className="py-1.5 px-2 text-left">{t.healthColAttr}</th>
                        {activeDisk.protocol === "ata" && (
                          <>
                            <th className="py-1.5 px-2 w-16 text-right font-mono-num">{t.healthColCur}</th>
                            <th className="py-1.5 px-2 w-16 text-right font-mono-num">{t.healthColWorst}</th>
                            <th className="py-1.5 px-2 w-16 text-right font-mono-num">{t.healthColThresh}</th>
                          </>
                        )}
                        <th className="py-1.5 px-3 text-right">{t.healthColValue}</th>
                        <th className="py-1.5 px-3 w-44 text-right font-mono-num">{t.healthColRaw}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAttrs.map((attr) => (
                        <tr
                          key={attr.id}
                          className="border-b hover:bg-sky-500/5"
                          style={{ borderColor: "var(--border-subtle)" }}
                        >
                          <td className="py-1.5 px-2.5 text-center">
                            <span
                              className="w-2.5 h-2.5 inline-block"
                              style={{ backgroundColor: attrDotColor(attr.status) }}
                              title={attr.status}
                            />
                          </td>
                          <td className="py-1.5 px-2 font-mono-num font-semibold" style={{ color: "var(--text-secondary)" }}>
                            {attr.idHex}
                          </td>
                          <td className="py-1.5 px-2 font-medium">{attr.name}</td>
                          {activeDisk.protocol === "ata" && (
                            <>
                              <td className="py-1.5 px-2 text-right font-mono-num">{attr.current ?? "—"}</td>
                              <td className="py-1.5 px-2 text-right font-mono-num">{attr.worst ?? "—"}</td>
                              <td className="py-1.5 px-2 text-right font-mono-num">{attr.threshold ?? "—"}</td>
                            </>
                          )}
                          <td
                            className="py-1.5 px-3 text-right font-mono-num font-semibold"
                            style={{
                              color:
                                attr.status === "critical"
                                  ? "var(--danger)"
                                  : attr.status === "caution"
                                  ? "var(--warning)"
                                  : "var(--text-primary)",
                            }}
                          >
                            {attr.decodedValue}
                          </td>
                          <td
                            className="py-1.5 px-3 text-right font-mono-num text-[11px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {attr.rawHex}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {report && report.collectedAtTs > 0 && (
                  <div
                    className="px-3 py-1.5 border-t flex items-center justify-end gap-1.5 text-[11px] font-mono-num"
                    style={{
                      borderColor: "var(--border-subtle)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <Clock className="w-3 h-3" />
                    <span>{new Date(report.collectedAtTs * 1000).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
