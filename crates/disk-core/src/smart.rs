use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::{
    DiskHealthReport, HealthStatus, PhysicalDiskHealth, SmartAttrStatus, SmartAttribute,
    SmartProtocol,
};

#[derive(Debug, Clone)]
pub struct NvmeSmartParsed {
    pub health_status: HealthStatus,
    pub health_percent: u8,
    pub temperature_c: Option<i32>,
    pub total_host_reads_bytes: u64,
    pub total_host_writes_bytes: u64,
    pub power_on_count: u64,
    pub power_on_hours: u64,
    pub unsafe_shutdowns: u64,
    pub media_errors: u64,
    pub available_spare_pct: u8,
    pub diagnostic_notes: Vec<String>,
    pub attributes: Vec<SmartAttribute>,
}

#[derive(Debug, Clone)]
pub struct AtaSmartParsed {
    pub health_status: HealthStatus,
    pub health_percent: Option<u8>,
    pub temperature_c: Option<i32>,
    pub total_host_reads_bytes: Option<u64>,
    pub total_host_writes_bytes: Option<u64>,
    pub power_on_count: Option<u64>,
    pub power_on_hours: Option<u64>,
    pub unsafe_shutdowns: Option<u64>,
    pub media_errors: Option<u64>,
    pub diagnostic_notes: Vec<String>,
    pub attributes: Vec<SmartAttribute>,
}

#[inline]
fn read_u16_le(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([buf[off], buf[off + 1]])
}

#[inline]
fn read_u32_le(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

#[inline]
fn read_u128_le(buf: &[u8], off: usize) -> u128 {
    let mut arr = [0u8; 16];
    arr.copy_from_slice(&buf[off..off + 16]);
    u128::from_le_bytes(arr)
}

#[inline]
fn format_raw_hex(val: u64) -> String {
    format!("{:016X}", val)
}

#[inline]
fn kelvin_to_celsius(k: u16) -> Option<i32> {
    if k == 0 {
        None
    } else {
        Some(k as i32 - 273)
    }
}

#[inline]
fn temp_status(temp_c: Option<i32>) -> SmartAttrStatus {
    match temp_c {
        Some(t) if t >= 60 => SmartAttrStatus::Critical,
        Some(t) if t >= 50 => SmartAttrStatus::Caution,
        Some(_) => SmartAttrStatus::Good,
        None => SmartAttrStatus::Neutral,
    }
}

fn format_gb_decimal(bytes: u64) -> String {
    let gb = bytes / 1_000_000_000;
    if gb >= 10_000 {
        format!("{:.2} TB ({} GB)", bytes as f64 / 1_000_000_000_000.0, format_with_commas(gb))
    } else if gb > 0 {
        format!("{} GB", format_with_commas(gb))
    } else {
        let mb = bytes / 1_000_000;
        format!("{} MB", format_with_commas(mb))
    }
}

fn format_with_commas(n: u64) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (idx, &b) in bytes.iter().enumerate() {
        if idx > 0 && (bytes.len() - idx).is_multiple_of(3) {
            out.push(',');
        }
        out.push(b as char);
    }
    out
}

pub fn parse_nvme_identify_version(ver_raw: u32) -> String {
    if ver_raw == 0 {
        return "NVM Express".to_string();
    }
    let major = (ver_raw >> 16) & 0xFFFF;
    let minor = (ver_raw >> 8) & 0xFF;
    let tertiary = ver_raw & 0xFF;
    if tertiary > 0 {
        format!("NVM Express {}.{}.{}", major, minor, tertiary)
    } else {
        format!("NVM Express {}.{}", major, minor)
    }
}

/// Parses a standard 512-byte NVMe SMART / Health Information Log Page (Log ID 0x02).
pub fn parse_nvme_smart_log(buf: &[u8]) -> Option<NvmeSmartParsed> {
    if buf.len() < 216 {
        return None;
    }

    let critical_warning = buf[0];
    let comp_temp_k = read_u16_le(buf, 1);
    let comp_temp_c = kelvin_to_celsius(comp_temp_k);
    let avail_spare = buf[3];
    let avail_spare_thresh = buf[4];
    let pct_used = buf[5];

    // NVMe Data Units: reported in thousands of 512-byte blocks = 512,000 bytes per unit
    let data_units_read = read_u128_le(buf, 32);
    let data_units_written = read_u128_le(buf, 48);
    let host_read_cmds = read_u128_le(buf, 64);
    let host_write_cmds = read_u128_le(buf, 80);
    let controller_busy_min = read_u128_le(buf, 96);
    let power_cycles = read_u128_le(buf, 112);
    let power_on_hours = read_u128_le(buf, 128);
    let unsafe_shutdowns = read_u128_le(buf, 144);
    let media_errors = read_u128_le(buf, 160);
    let error_log_entries = read_u128_le(buf, 176);
    let warn_temp_time = read_u32_le(buf, 192);
    let crit_temp_time = read_u32_le(buf, 196);

    let total_host_reads_bytes = data_units_read.saturating_mul(512_000).min(u64::MAX as u128) as u64;
    let total_host_writes_bytes = data_units_written.saturating_mul(512_000).min(u64::MAX as u128) as u64;
    let health_percent = 100u8.saturating_sub(pct_used);

    let mut diagnostic_notes = Vec::new();
    let mut health_status = HealthStatus::Good;

    if critical_warning != 0 {
        health_status = HealthStatus::Critical;
        diagnostic_notes.push(format!(
            "NVMe Critical Warning bitmask is non-zero (0x{:02X}). Back up data immediately.",
            critical_warning
        ));
    }
    if avail_spare_thresh > 0 && avail_spare <= avail_spare_thresh {
        if health_status != HealthStatus::Critical {
            health_status = HealthStatus::Caution;
        }
        diagnostic_notes.push(format!(
            "Available spare ({avail_spare}%) is at or below threshold ({avail_spare_thresh}%)."
        ));
    }
    if health_percent <= 10 {
        if health_status == HealthStatus::Good {
            health_status = HealthStatus::Caution;
        }
        diagnostic_notes.push(format!(
            "SSD remaining life is low ({health_percent}% remaining)."
        ));
    }
    if let Some(t) = comp_temp_c {
        if t >= 60 {
            diagnostic_notes.push(format!(
                "High drive temperature detected ({t} °C). Check airflow or thermal pad."
            ));
        }
    }
    if media_errors > 0 {
        diagnostic_notes.push(format!(
            "Media and Data Integrity Errors logged: {} (monitor for increases).",
            format_with_commas(media_errors as u64)
        ));
    }

    let make_attr = |id: u8, name: &str, status: SmartAttrStatus, raw: u64, decoded: String| {
        SmartAttribute {
            id,
            id_hex: format!("{:02X}", id),
            name: name.to_string(),
            status,
            current: None,
            worst: None,
            threshold: None,
            raw_hex: format_raw_hex(raw),
            raw_value: raw,
            decoded_value: decoded,
        }
    };

    let spare_status = if avail_spare_thresh > 0 && avail_spare <= avail_spare_thresh {
        SmartAttrStatus::Critical
    } else if avail_spare <= avail_spare_thresh.saturating_add(10) {
        SmartAttrStatus::Caution
    } else {
        SmartAttrStatus::Good
    };

    let wear_status = if health_percent <= 10 {
        SmartAttrStatus::Critical
    } else if health_percent <= 25 {
        SmartAttrStatus::Caution
    } else {
        SmartAttrStatus::Good
    };

    let mut attributes = vec![
        make_attr(
            0x01,
            "Critical Warning",
            if critical_warning != 0 {
                SmartAttrStatus::Critical
            } else {
                SmartAttrStatus::Good
            },
            critical_warning as u64,
            if critical_warning == 0 {
                "None".to_string()
            } else {
                format!("0x{:02X}", critical_warning)
            },
        ),
        make_attr(
            0x02,
            "Composite Temperature",
            temp_status(comp_temp_c),
            comp_temp_k as u64,
            comp_temp_c
                .map(|c| format!("{} °C ({} K)", c, comp_temp_k))
                .unwrap_or_else(|| "—".to_string()),
        ),
        make_attr(
            0x03,
            "Available Spare",
            spare_status,
            avail_spare as u64,
            format!("{}%", avail_spare),
        ),
        make_attr(
            0x04,
            "Available Spare Threshold",
            SmartAttrStatus::Good,
            avail_spare_thresh as u64,
            format!("{}%", avail_spare_thresh),
        ),
        make_attr(
            0x05,
            "Percentage Used",
            wear_status,
            pct_used as u64,
            format!("{}% ({}% life left)", pct_used, health_percent),
        ),
        make_attr(
            0x06,
            "Data Units Read",
            SmartAttrStatus::Good,
            data_units_read as u64,
            format_gb_decimal(total_host_reads_bytes),
        ),
        make_attr(
            0x07,
            "Data Units Written",
            SmartAttrStatus::Good,
            data_units_written as u64,
            format_gb_decimal(total_host_writes_bytes),
        ),
        make_attr(
            0x08,
            "Host Read Commands",
            SmartAttrStatus::Good,
            host_read_cmds as u64,
            format_with_commas(host_read_cmds as u64),
        ),
        make_attr(
            0x09,
            "Host Write Commands",
            SmartAttrStatus::Good,
            host_write_cmds as u64,
            format_with_commas(host_write_cmds as u64),
        ),
        make_attr(
            0x0A,
            "Controller Busy Time",
            SmartAttrStatus::Good,
            controller_busy_min as u64,
            format!("{} min", format_with_commas(controller_busy_min as u64)),
        ),
        make_attr(
            0x0B,
            "Power Cycles",
            SmartAttrStatus::Good,
            power_cycles as u64,
            format_with_commas(power_cycles as u64),
        ),
        make_attr(
            0x0C,
            "Power On Hours",
            SmartAttrStatus::Good,
            power_on_hours as u64,
            format!("{} hrs", format_with_commas(power_on_hours as u64)),
        ),
        make_attr(
            0x0D,
            "Unsafe Shutdowns",
            SmartAttrStatus::Good,
            unsafe_shutdowns as u64,
            format_with_commas(unsafe_shutdowns as u64),
        ),
        make_attr(
            0x0E,
            "Media and Data Integrity Errors",
            if media_errors > 0 {
                SmartAttrStatus::Caution
            } else {
                SmartAttrStatus::Good
            },
            media_errors as u64,
            format_with_commas(media_errors as u64),
        ),
        make_attr(
            0x0F,
            "Number of Error Information Log Entries",
            SmartAttrStatus::Good,
            error_log_entries as u64,
            format_with_commas(error_log_entries as u64),
        ),
        make_attr(
            0x10,
            "Warning Composite Temperature Time",
            if warn_temp_time > 0 {
                SmartAttrStatus::Caution
            } else {
                SmartAttrStatus::Good
            },
            warn_temp_time as u64,
            format!("{} min", format_with_commas(warn_temp_time as u64)),
        ),
        make_attr(
            0x11,
            "Critical Composite Temperature Time",
            if crit_temp_time > 0 {
                SmartAttrStatus::Critical
            } else {
                SmartAttrStatus::Good
            },
            crit_temp_time as u64,
            format!("{} min", format_with_commas(crit_temp_time as u64)),
        ),
    ];

    // Temperature Sensors 1..8 (bytes 200..216, 2 bytes each)
    for idx in 0..8usize {
        let sensor_k = read_u16_le(buf, 200 + idx * 2);
        if let Some(sensor_c) = kelvin_to_celsius(sensor_k) {
            let attr_id = 0x12 + idx as u8;
            attributes.push(make_attr(
                attr_id,
                &format!("Temperature Sensor {}", idx + 1),
                temp_status(Some(sensor_c)),
                sensor_k as u64,
                format!("{} °C ({} K)", sensor_c, sensor_k),
            ));
        }
    }

    Some(NvmeSmartParsed {
        health_status,
        health_percent,
        temperature_c: comp_temp_c,
        total_host_reads_bytes,
        total_host_writes_bytes,
        power_on_count: power_cycles as u64,
        power_on_hours: power_on_hours as u64,
        unsafe_shutdowns: unsafe_shutdowns as u64,
        media_errors: media_errors as u64,
        available_spare_pct: avail_spare,
        diagnostic_notes,
        attributes,
    })
}

fn ata_attr_name(id: u8) -> &'static str {
    match id {
        0x01 => "Read Error Rate",
        0x02 => "Throughput Performance",
        0x03 => "Spin-Up Time",
        0x04 => "Start/Stop Count",
        0x05 => "Reallocated Sectors Count",
        0x07 => "Seek Error Rate",
        0x08 => "Seek Time Performance",
        0x09 => "Power-On Hours",
        0x0A => "Spin Retry Count",
        0x0B => "Recalibration Retries",
        0x0C => "Power Cycle Count",
        0xA0 => "Uncorrectable Sector Count",
        0xA1 => "Valid Spare Blocks",
        0xA3 => "Initial Invalid Blocks",
        0xA7 => "SSD Protect Mode",
        0xAA => "Available Reserved Space",
        0xAB => "SSD Program Fail Count",
        0xAC => "SSD Erase Fail Count",
        0xAD => "SSD Wear Leveling Count",
        0xAE => "Unexpected Power Loss Count",
        0xB1 => "Wear Range Delta",
        0xB5 => "Program Fail Count Total",
        0xB6 => "Erase Fail Count",
        0xB7 => "SATA Downshift Error Count",
        0xB8 => "End-to-End Error",
        0xBB => "Reported Uncorrectable Errors",
        0xBC => "Command Timeout",
        0xBD => "High Fly Writes",
        0xBE => "Airflow Temperature",
        0xBF => "G-Sense Error Rate",
        0xC0 => "Power-Off Retract Count",
        0xC1 => "Load/Unload Cycle Count",
        0xC2 => "Temperature",
        0xC3 => "Hardware ECC Recovered",
        0xC4 => "Reallocation Event Count",
        0xC5 => "Current Pending Sector Count",
        0xC6 => "Uncorrectable Sector Count",
        0xC7 => "UltraDMA CRC Error Count",
        0xC8 => "Multi-Zone Error Rate",
        0xE7 => "SSD Life Left",
        0xE8 => "Available Reserved Space",
        0xE9 => "Media Wearout Indicator",
        0xF1 => "Total LBAs Written",
        0xF2 => "Total LBAs Read",
        0xF9 => "NAND Writes (1GiB)",
        _ => "Vendor Specific Attribute",
    }
}

/// Parses standard 512-byte ATA S.M.A.R.T. Attribute & optional Threshold pages.
pub fn parse_ata_smart_data(attr_buf: &[u8], thresh_buf: Option<&[u8]>) -> AtaSmartParsed {
    let mut thresholds = [0u8; 256];
    let mut has_thresh = [false; 256];

    if let Some(tb) = thresh_buf {
        if tb.len() >= 362 {
            for slot in 0..30usize {
                let off = 2 + slot * 12;
                let id = tb[off];
                if id != 0 {
                    thresholds[id as usize] = tb[off + 1];
                    has_thresh[id as usize] = true;
                }
            }
        }
    }

    let mut attributes = Vec::new();
    let mut health_status = HealthStatus::Good;
    let mut health_percent: Option<u8> = None;
    let mut temperature_c: Option<i32> = None;
    let mut power_on_hours: Option<u64> = None;
    let mut power_on_count: Option<u64> = None;
    let mut unsafe_shutdowns: Option<u64> = None;
    let mut total_host_writes_bytes: Option<u64> = None;
    let mut total_host_reads_bytes: Option<u64> = None;
    let mut media_errors: u64 = 0;
    let mut diagnostic_notes = Vec::new();

    if attr_buf.len() >= 362 {
        for slot in 0..30usize {
            let off = 2 + slot * 12;
            let id = attr_buf[off];
            if id == 0 {
                continue;
            }
            let flags = read_u16_le(attr_buf, off + 1);
            let is_prefail = (flags & 0x0001) != 0;
            let current = attr_buf[off + 3];
            let worst = attr_buf[off + 4];
            let raw_bytes = &attr_buf[off + 5..off + 11];
            let raw_value = (raw_bytes[0] as u64)
                | ((raw_bytes[1] as u64) << 8)
                | ((raw_bytes[2] as u64) << 16)
                | ((raw_bytes[3] as u64) << 24)
                | ((raw_bytes[4] as u64) << 32)
                | ((raw_bytes[5] as u64) << 40);

            let thresh = if has_thresh[id as usize] {
                Some(thresholds[id as usize])
            } else {
                None
            };

            let mut attr_status = SmartAttrStatus::Good;
            if let Some(th) = thresh {
                if th > 0 && current <= th {
                    attr_status = if is_prefail {
                        SmartAttrStatus::Critical
                    } else {
                        SmartAttrStatus::Caution
                    };
                    if is_prefail {
                        health_status = HealthStatus::Critical;
                        diagnostic_notes.push(format!(
                            "Pre-fail attribute {:02X} ({}) dropped to threshold ({current} <= {th}).",
                            id,
                            ata_attr_name(id)
                        ));
                    } else if health_status == HealthStatus::Good {
                        health_status = HealthStatus::Caution;
                    }
                }
            }

            let decoded = match id {
                0xC2 | 0xBE => {
                    let t = (raw_value & 0xFF) as i8 as i32;
                    if (-20..=125).contains(&t) {
                        if temperature_c.is_none() || id == 0xC2 {
                            temperature_c = Some(t);
                        }
                        attr_status = temp_status(Some(t));
                        format!("{} °C", t)
                    } else {
                        format_with_commas(raw_value)
                    }
                }
                0x09 => {
                    let hrs = raw_value & 0xFFFF_FFFF;
                    power_on_hours = Some(hrs);
                    format!("{} hrs", format_with_commas(hrs))
                }
                0x0C => {
                    power_on_count = Some(raw_value);
                    format_with_commas(raw_value)
                }
                0xAE | 0xC0 => {
                    if unsafe_shutdowns.is_none() {
                        unsafe_shutdowns = Some(raw_value);
                    }
                    format_with_commas(raw_value)
                }
                0xE7 | 0xE9 => {
                    let pct = current.min(100);
                    if health_percent.is_none() || id == 0xE7 {
                        health_percent = Some(pct);
                    }
                    if pct <= 10 && health_status == HealthStatus::Good {
                        health_status = HealthStatus::Caution;
                    }
                    format!("{}%", pct)
                }
                0x05 | 0xC4 | 0xC5 | 0xC6 => {
                    if raw_value > 0 {
                        media_errors = media_errors.saturating_add(raw_value);
                        if attr_status == SmartAttrStatus::Good {
                            attr_status = SmartAttrStatus::Caution;
                        }
                        if health_status == HealthStatus::Good {
                            health_status = HealthStatus::Caution;
                        }
                        diagnostic_notes.push(format!(
                            "Attribute {:02X} ({}) is non-zero ({}).",
                            id,
                            ata_attr_name(id),
                            format_with_commas(raw_value)
                        ));
                    }
                    format_with_commas(raw_value)
                }
                0xF1 => {
                    // Common convention: 32 MiB units or 512-byte LBAs; treat raw * 512 if large else display count
                    let approx_bytes = raw_value.saturating_mul(512);
                    if approx_bytes >= 1_000_000_000 {
                        total_host_writes_bytes = Some(approx_bytes);
                        format_gb_decimal(approx_bytes)
                    } else {
                        format_with_commas(raw_value)
                    }
                }
                0xF2 => {
                    let approx_bytes = raw_value.saturating_mul(512);
                    if approx_bytes >= 1_000_000_000 {
                        total_host_reads_bytes = Some(approx_bytes);
                        format_gb_decimal(approx_bytes)
                    } else {
                        format_with_commas(raw_value)
                    }
                }
                _ => format_with_commas(raw_value),
            };

            attributes.push(SmartAttribute {
                id,
                id_hex: format!("{:02X}", id),
                name: ata_attr_name(id).to_string(),
                status: attr_status,
                current: Some(current),
                worst: Some(worst),
                threshold: thresh,
                raw_hex: format!("{:012X}", raw_value),
                raw_value,
                decoded_value: decoded,
            });
        }
    }

    if let Some(t) = temperature_c {
        if t >= 60 {
            diagnostic_notes.push(format!(
                "High drive temperature detected ({t} °C). Check airflow or cooling."
            ));
        }
    }

    AtaSmartParsed {
        health_status,
        health_percent,
        temperature_c,
        total_host_reads_bytes,
        total_host_writes_bytes,
        power_on_count,
        power_on_hours,
        unsafe_shutdowns,
        media_errors: if media_errors > 0 {
            Some(media_errors)
        } else {
            None
        },
        diagnostic_notes,
        attributes,
    }
}

pub fn format_smart_report_text(disk: &PhysicalDiskHealth, mask_serial: bool) -> String {
    let mut out = String::new();
    let serial = if mask_serial {
        "****************".to_string()
    } else if disk.serial_number.is_empty() {
        "N/A".to_string()
    } else {
        disk.serial_number.clone()
    };

    out.push_str("----------------------------------------------------------------------------\n");
    out.push_str(&format!(
        "DiskCleanupTool S.M.A.R.T. Health Report — Disk {} : {}\n",
        disk.disk_index, disk.model
    ));
    out.push_str("----------------------------------------------------------------------------\n");
    out.push_str(&format!("Model           : {}\n", disk.model));
    out.push_str(&format!("Firmware        : {}\n", disk.firmware));
    out.push_str(&format!("Serial Number   : {}\n", serial));
    out.push_str(&format!(
        "Capacity        : {:.1} GB ({} bytes)\n",
        disk.capacity_bytes as f64 / 1_000_000_000.0,
        format_with_commas(disk.capacity_bytes)
    ));
    out.push_str(&format!("Interface       : {}\n", disk.interface_type));
    out.push_str(&format!("Standard        : {}\n", disk.standard));
    out.push_str(&format!("Media Type      : {}\n", disk.media_type));
    out.push_str(&format!(
        "Drive Letters   : {}\n",
        if disk.drive_letters.is_empty() {
            "—".to_string()
        } else {
            disk.drive_letters.join(" ")
        }
    ));
    out.push_str(&format!("Features        : {}\n", disk.features.join(", ")));
    out.push_str(&format!(
        "Health Status   : {:?}{}\n",
        disk.health_status,
        disk.health_percent
            .map(|p| format!(" ({p}%)"))
            .unwrap_or_default()
    ));
    if let Some(t) = disk.temperature_c {
        out.push_str(&format!("Temperature     : {} °C ({} °F)\n", t, (t * 9) / 5 + 32));
    }
    if let Some(r) = disk.total_host_reads_bytes {
        out.push_str(&format!("Host Reads      : {}\n", format_gb_decimal(r)));
    }
    if let Some(w) = disk.total_host_writes_bytes {
        out.push_str(&format!("Host Writes     : {}\n", format_gb_decimal(w)));
    }
    if let Some(c) = disk.power_on_count {
        out.push_str(&format!("Power On Count  : {}\n", format_with_commas(c)));
    }
    if let Some(h) = disk.power_on_hours {
        out.push_str(&format!("Power On Hours  : {} hrs\n", format_with_commas(h)));
    }

    if !disk.attributes.is_empty() {
        out.push_str("\n-- S.M.A.R.T. Attributes ---------------------------------------------------\n");
        out.push_str("ID  Attribute Name                              Value                  Raw (Hex)\n");
        for attr in &disk.attributes {
            out.push_str(&format!(
                "{}  {:<42}  {:<21}  {}\n",
                attr.id_hex, attr.name, attr.decoded_value, attr.raw_hex
            ));
        }
    }

    out
}

#[cfg(windows)]
mod win_impl {
    use std::collections::BTreeMap;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, GetLogicalDriveStringsW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::Ioctl::{
        StorageAdapterProtocolSpecificProperty, StorageDeviceProperty,
        StorageDeviceProtocolSpecificProperty, StorageDeviceSeekPenaltyProperty,
        StorageDeviceTemperatureProperty, StorageDeviceTrimProperty,
        StorageDeviceWriteCacheProperty, IOCTL_DISK_GET_DRIVE_GEOMETRY_EX,
        IOCTL_STORAGE_QUERY_PROPERTY,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    use super::*;

    const GENERIC_READ_FLAG: u32 = 0x8000_0000;
    const GENERIC_WRITE_FLAG: u32 = 0x4000_0000;
    const IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS: u32 = 0x0056_0000;
    const SMART_RCV_DRIVE_DATA: u32 = 0x0007_C088;

    struct HandleGuard(HANDLE);
    impl Drop for HandleGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn map_drive_letters_to_disks() -> BTreeMap<u32, Vec<String>> {
        let mut map: BTreeMap<u32, Vec<String>> = BTreeMap::new();
        let mut buf = [0u16; 512];
        let len = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) } as usize;
        if len == 0 {
            return map;
        }

        let slice = &buf[..len.min(buf.len())];
        for part in slice.split(|&c| c == 0) {
            if part.len() < 2 {
                continue;
            }
            let letter = String::from_utf16_lossy(&part[..2]).to_ascii_uppercase();
            let vol_path = format!("\\\\.\\{}", letter);
            let wide = to_wide(&vol_path);
            let Ok(handle) = (unsafe {
                CreateFileW(
                    PCWSTR(wide.as_ptr()),
                    0,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    None,
                    OPEN_EXISTING,
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    None,
                )
            }) else {
                continue;
            };
            let _guard = HandleGuard(handle);

            let mut out = [0u8; 512];
            let mut returned = 0u32;
            let ok = unsafe {
                DeviceIoControl(
                    handle,
                    IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS,
                    None,
                    0,
                    Some(out.as_mut_ptr() as *mut std::ffi::c_void),
                    out.len() as u32,
                    Some(&mut returned),
                    None,
                )
            };
            if ok.is_ok() && returned >= 16 {
                let count = read_u32_le(&out, 0) as usize;
                for i in 0..count.min(16) {
                    // VOLUME_DISK_EXTENTS: NumberOfDiskExtents (4) + pad (4) + DISK_EXTENT[i] (24 bytes each, DiskNumber at +0)
                    let ext_off = 8 + i * 24;
                    if ext_off + 4 <= out.len() {
                        let disk_num = read_u32_le(&out, ext_off);
                        let list = map.entry(disk_num).or_default();
                        if !list.contains(&letter) {
                            list.push(letter.clone());
                        }
                    }
                }
            }
        }

        map
    }

    #[repr(C)]
    struct SimplePropertyQuery {
        property_id: u32,
        query_type: u32,
        additional_parameters: [u8; 4],
    }

    fn query_simple_property(handle: HANDLE, prop_id: u32, out: &mut [u8]) -> Option<usize> {
        let query = SimplePropertyQuery {
            property_id: prop_id,
            query_type: 0, // PropertyStandardQuery
            additional_parameters: [0; 4],
        };
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_STORAGE_QUERY_PROPERTY,
                Some(&query as *const _ as *const std::ffi::c_void),
                std::mem::size_of::<SimplePropertyQuery>() as u32,
                Some(out.as_mut_ptr() as *mut std::ffi::c_void),
                out.len() as u32,
                Some(&mut returned),
                None,
            )
        };
        if ok.is_ok() && returned > 0 {
            Some(returned as usize)
        } else {
            None
        }
    }

    fn read_cstr_at(buf: &[u8], offset: u32) -> String {
        let off = offset as usize;
        if off == 0 || off >= buf.len() {
            return String::new();
        }
        let end = buf[off..]
            .iter()
            .position(|&b| b == 0)
            .map(|p| off + p)
            .unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[off..end]).trim().to_string()
    }

    fn bus_type_name(bus_type: u8) -> &'static str {
        match bus_type {
            1 => "SCSI",
            2 => "ATAPI",
            3 => "ATA",
            4 => "IEEE 1394",
            5 => "SSA",
            6 => "Fibre Channel",
            7 => "USB",
            8 => "RAID",
            9 => "iSCSI",
            10 => "SAS",
            11 => "SATA",
            12 => "SD",
            13 => "MMC",
            14 => "Virtual",
            15 => "File-Backed Virtual",
            16 => "Storage Spaces",
            17 => "NVM Express",
            18 => "SCM",
            19 => "UFS",
            _ => "Unknown",
        }
    }

    fn query_capacity_bytes(handle: HANDLE) -> u64 {
        let mut out = [0u8; 64];
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_DISK_GET_DRIVE_GEOMETRY_EX,
                None,
                0,
                Some(out.as_mut_ptr() as *mut std::ffi::c_void),
                out.len() as u32,
                Some(&mut returned),
                None,
            )
        };
        // DISK_GEOMETRY_EX: DISK_GEOMETRY (24 bytes) + DiskSize (i64 at offset 24)
        if ok.is_ok() && returned >= 32 {
            let size = i64::from_le_bytes([
                out[24], out[25], out[26], out[27], out[28], out[29], out[30], out[31],
            ]);
            if size > 0 {
                return size as u64;
            }
        }
        0
    }

    fn query_temperature_property(handle: HANDLE) -> Option<i32> {
        let mut out = [0u8; 512];
        let len = query_simple_property(handle, StorageDeviceTemperatureProperty.0 as u32, &mut out)?;
        // STORAGE_TEMPERATURE_DATA_DESCRIPTOR:
        // Version(4), Size(4), CriticalTemp(i16@8), WarningTemp(i16@10), InfoCount(u16@12), Reserved0(2), Reserved1(8) -> Info[0] at 24
        // STORAGE_TEMPERATURE_INFO: Index(u16@0), Temperature(i16@2), OverThresh(i16@4), UnderThresh(i16@6)...
        if len >= 28 {
            let count = read_u16_le(&out, 12);
            if count > 0 {
                let temp = i16::from_le_bytes([out[26], out[27]]) as i32;
                if (-20..=125).contains(&temp) && temp != 0 {
                    return Some(temp);
                }
            }
        }
        None
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct StorageProtocolSpecificData {
        protocol_type: u32,
        data_type: u32,
        protocol_data_request_value: u32,
        protocol_data_request_sub_value: u32,
        protocol_data_offset: u32,
        protocol_data_length: u32,
        fixed_protocol_return_data: u32,
        protocol_data_request_sub_value2: u32,
        protocol_data_request_sub_value3: u32,
        protocol_data_request_sub_value4: u32,
    }

    fn query_nvme_protocol_data(
        handle: HANDLE,
        data_type: u32,
        req_val: u32,
        payload_len: usize,
    ) -> Option<Vec<u8>> {
        // Try both StorageAdapterProtocolSpecificProperty and StorageDeviceProtocolSpecificProperty
        let prop_ids = [
            StorageAdapterProtocolSpecificProperty.0 as u32,
            StorageDeviceProtocolSpecificProperty.0 as u32,
        ];
        let proto_size = std::mem::size_of::<StorageProtocolSpecificData>(); // 40 bytes
        let header_size = 8 + proto_size; // PropertyId(4) + QueryType(4) + StorageProtocolSpecificData(40)
        let total_size = header_size + payload_len;

        for prop_id in prop_ids {
            let mut buf = vec![0u8; total_size];
            buf[0..4].copy_from_slice(&prop_id.to_le_bytes());
            buf[4..8].copy_from_slice(&0u32.to_le_bytes()); // PropertyStandardQuery

            let spec = StorageProtocolSpecificData {
                protocol_type: 3, // ProtocolTypeNvme
                data_type,
                protocol_data_request_value: req_val,
                protocol_data_request_sub_value: 0,
                protocol_data_offset: proto_size as u32,
                protocol_data_length: payload_len as u32,
                fixed_protocol_return_data: 0,
                protocol_data_request_sub_value2: 0,
                protocol_data_request_sub_value3: 0,
                protocol_data_request_sub_value4: 0,
            };
            unsafe {
                std::ptr::copy_nonoverlapping(
                    &spec as *const _ as *const u8,
                    buf.as_mut_ptr().add(8),
                    proto_size,
                );
            }

            let mut returned = 0u32;
            let ok = unsafe {
                DeviceIoControl(
                    handle,
                    IOCTL_STORAGE_QUERY_PROPERTY,
                    Some(buf.as_ptr() as *const std::ffi::c_void),
                    buf.len() as u32,
                    Some(buf.as_mut_ptr() as *mut std::ffi::c_void),
                    buf.len() as u32,
                    Some(&mut returned),
                    None,
                )
            };

            if ok.is_ok() && (returned as usize) >= header_size {
                // STORAGE_PROTOCOL_DATA_DESCRIPTOR: Version(4), Size(4), ProtocolSpecificData(40)
                let ret_off = read_u32_le(&buf, 8 + 16) as usize;
                let ret_len = read_u32_le(&buf, 8 + 20) as usize;
                let data_start = 8 + ret_off;
                if ret_len > 0 && data_start + ret_len <= buf.len() {
                    return Some(buf[data_start..data_start + ret_len].to_vec());
                }
            }
        }
        None
    }

    #[repr(C, packed)]
    struct IdeRegs {
        features_reg: u8,
        sector_count_reg: u8,
        sector_number_reg: u8,
        cyl_low_reg: u8,
        cyl_high_reg: u8,
        drive_head_reg: u8,
        command_reg: u8,
        reserved: u8,
    }

    #[repr(C, packed)]
    struct SendCmdInParams {
        buffer_size: u32,
        drive_regs: IdeRegs,
        drive_number: u8,
        reserved: [u8; 3],
        dw_reserved: [u32; 4],
        buffer: [u8; 1],
    }

    fn query_ata_smart_page(handle: HANDLE, disk_index: u32, feature: u8) -> Option<Vec<u8>> {
        let in_params = SendCmdInParams {
            buffer_size: 512,
            drive_regs: IdeRegs {
                features_reg: feature,
                sector_count_reg: 1,
                sector_number_reg: 1,
                cyl_low_reg: 0x4F,
                cyl_high_reg: 0xC2,
                drive_head_reg: 0xA0,
                command_reg: 0xB0, // SMART_CMD
                reserved: 0,
            },
            drive_number: disk_index as u8,
            reserved: [0; 3],
            dw_reserved: [0; 4],
            buffer: [0; 1],
        };

        // SENDCMDOUTPARAMS header is 16 bytes (cBufferSize: 4, DriverStatus: 12) + 512 bytes data
        let mut out_buf = vec![0u8; 16 + 512];
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                handle,
                SMART_RCV_DRIVE_DATA,
                Some(&in_params as *const _ as *const std::ffi::c_void),
                (std::mem::size_of::<SendCmdInParams>() - 1) as u32,
                Some(out_buf.as_mut_ptr() as *mut std::ffi::c_void),
                out_buf.len() as u32,
                Some(&mut returned),
                None,
            )
        };

        if ok.is_ok() && (returned as usize) >= 16 + 362 {
            // DriverStatus.bDriverError at offset 4
            if out_buf[4] == 0 {
                return Some(out_buf[16..16 + 512].to_vec());
            }
        }
        None
    }

    fn clean_ascii(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes)
            .trim_matches(|c: char| c == '\0' || c.is_ascii_whitespace())
            .to_string()
    }

    pub fn collect_all_disk_health() -> DiskHealthReport {
        let is_admin = crate::is_process_elevated();
        let letter_map = map_drive_letters_to_disks();
        let mut disks = Vec::new();

        for disk_index in 0..16u32 {
            let dev_path = format!("\\\\.\\PhysicalDrive{}", disk_index);
            let wide = to_wide(&dev_path);

            let (handle, has_rw_access) = match unsafe {
                CreateFileW(
                    PCWSTR(wide.as_ptr()),
                    GENERIC_READ_FLAG | GENERIC_WRITE_FLAG,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    None,
                    OPEN_EXISTING,
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    None,
                )
            } {
                Ok(h) => (h, true),
                Err(_) => match unsafe {
                    CreateFileW(
                        PCWSTR(wide.as_ptr()),
                        0,
                        FILE_SHARE_READ | FILE_SHARE_WRITE,
                        None,
                        OPEN_EXISTING,
                        FILE_FLAGS_AND_ATTRIBUTES(0),
                        None,
                    )
                } {
                    Ok(h) => (h, false),
                    Err(_) => continue,
                },
            };
            let _guard = HandleGuard(handle);

            // 1. StorageDeviceProperty (Model, Firmware, Serial, BusType)
            let mut dev_buf = [0u8; 1024];
            let mut model = format!("PhysicalDrive{}", disk_index);
            let mut serial_number = String::new();
            let mut firmware = String::new();
            let mut bus_type = 0u8;

            if let Some(len) = query_simple_property(handle, StorageDeviceProperty.0 as u32, &mut dev_buf) {
                if len >= 36 {
                    let vendor_off = read_u32_le(&dev_buf, 12);
                    let product_off = read_u32_le(&dev_buf, 16);
                    let rev_off = read_u32_le(&dev_buf, 20);
                    let serial_off = read_u32_le(&dev_buf, 24);
                    bus_type = dev_buf[28];

                    let vendor = read_cstr_at(&dev_buf[..len], vendor_off);
                    let product = read_cstr_at(&dev_buf[..len], product_off);
                    let rev = read_cstr_at(&dev_buf[..len], rev_off);
                    let ser = read_cstr_at(&dev_buf[..len], serial_off);

                    let combined = if !vendor.is_empty()
                        && !product.is_empty()
                        && !product.to_ascii_lowercase().starts_with(&vendor.to_ascii_lowercase())
                    {
                        format!("{} {}", vendor, product)
                    } else if !product.is_empty() {
                        product
                    } else if !vendor.is_empty() {
                        vendor
                    } else {
                        model.clone()
                    };
                    model = combined;
                    firmware = rev;
                    serial_number = ser;
                }
            }

            let capacity_bytes = query_capacity_bytes(handle);
            let drive_letters = letter_map.get(&disk_index).cloned().unwrap_or_default();
            let interface_type = bus_type_name(bus_type).to_string();

            // 2. Seek Penalty (SSD vs HDD), TRIM, Write Cache
            let mut media_type = if bus_type == 17 {
                "SSD".to_string()
            } else {
                "Unknown".to_string()
            };
            let mut seek_buf = [0u8; 32];
            if let Some(len) = query_simple_property(
                handle,
                StorageDeviceSeekPenaltyProperty.0 as u32,
                &mut seek_buf,
            ) {
                if len >= 12 {
                    let incurs_seek = seek_buf[8] != 0;
                    media_type = if incurs_seek {
                        "HDD".to_string()
                    } else {
                        "SSD".to_string()
                    };
                }
            }

            let mut features = Vec::new();
            let mut trim_buf = [0u8; 32];
            if let Some(len) = query_simple_property(handle, StorageDeviceTrimProperty.0 as u32, &mut trim_buf) {
                if len >= 12 && trim_buf[8] != 0 {
                    features.push("TRIM".to_string());
                }
            }

            let mut wc_buf = [0u8; 32];
            if let Some(len) = query_simple_property(
                handle,
                StorageDeviceWriteCacheProperty.0 as u32,
                &mut wc_buf,
            ) {
                // STORAGE_WRITE_CACHE_PROPERTY: WriteCacheEnabled at offset 12
                if len >= 16 && wc_buf[12] != 0 {
                    features.push("VolatileWriteCache".to_string());
                }
            }

            let mut standard = if bus_type == 17 {
                "NVM Express".to_string()
            } else if bus_type == 11 || bus_type == 3 {
                "ATA/ACS".to_string()
            } else {
                interface_type.clone()
            };

            let mut temperature_c = query_temperature_property(handle);
            let mut protocol = SmartProtocol::BasicOnly;
            let mut health_status = HealthStatus::Unknown;
            let mut health_percent = None;
            let mut total_host_reads_bytes = None;
            let mut total_host_writes_bytes = None;
            let mut power_on_count = None;
            let mut power_on_hours = None;
            let mut unsafe_shutdowns = None;
            let mut media_errors = None;
            let mut available_spare_pct = None;
            let mut smart_available = false;
            let mut diagnostic_notes = Vec::new();
            let mut attributes = Vec::new();

            // 3. Protocol-specific S.M.A.R.T. queries (NVMe or SATA/ATA)
            if bus_type == 17 {
                // NVMe Identify Controller (DataType = 1, RequestValue = 1) for exact spec version & serial
                if let Some(id_ctrl) = query_nvme_protocol_data(handle, 1, 1, 4096) {
                    if id_ctrl.len() >= 84 {
                        let ver_raw = read_u32_le(&id_ctrl, 80);
                        standard = parse_nvme_identify_version(ver_raw);
                        let id_sn = clean_ascii(&id_ctrl[4..24]);
                        let id_mn = clean_ascii(&id_ctrl[24..64]);
                        let id_fr = clean_ascii(&id_ctrl[64..72]);
                        if !id_sn.is_empty() {
                            serial_number = id_sn;
                        }
                        if !id_mn.is_empty() {
                            model = id_mn;
                        }
                        if !id_fr.is_empty() {
                            firmware = id_fr;
                        }
                    }
                }

                // NVMe SMART / Health Information Log Page (DataType = 2, RequestValue = 2)
                if let Some(log_buf) = query_nvme_protocol_data(handle, 2, 2, 512) {
                    if let Some(parsed) = parse_nvme_smart_log(&log_buf) {
                        features.insert(0, "S.M.A.R.T.".to_string());
                        protocol = SmartProtocol::Nvme;
                        health_status = parsed.health_status;
                        health_percent = Some(parsed.health_percent);
                        if parsed.temperature_c.is_some() {
                            temperature_c = parsed.temperature_c;
                        }
                        total_host_reads_bytes = Some(parsed.total_host_reads_bytes);
                        total_host_writes_bytes = Some(parsed.total_host_writes_bytes);
                        power_on_count = Some(parsed.power_on_count);
                        power_on_hours = Some(parsed.power_on_hours);
                        unsafe_shutdowns = Some(parsed.unsafe_shutdowns);
                        media_errors = Some(parsed.media_errors);
                        available_spare_pct = Some(parsed.available_spare_pct);
                        diagnostic_notes = parsed.diagnostic_notes;
                        attributes = parsed.attributes;
                        smart_available = true;
                    }
                }
            } else if has_rw_access {
                // Try ATA SMART_RCV_DRIVE_DATA (READ_ATTRIBUTES = 0xD0, READ_THRESHOLDS = 0xD1)
                if let Some(attr_page) = query_ata_smart_page(handle, disk_index, 0xD0) {
                    let thresh_page = query_ata_smart_page(handle, disk_index, 0xD1);
                    let parsed = parse_ata_smart_data(&attr_page, thresh_page.as_deref());
                    if !parsed.attributes.is_empty() {
                        features.insert(0, "S.M.A.R.T.".to_string());
                        protocol = SmartProtocol::Ata;
                        health_status = parsed.health_status;
                        health_percent = parsed.health_percent;
                        if parsed.temperature_c.is_some() {
                            temperature_c = parsed.temperature_c;
                        }
                        total_host_reads_bytes = parsed.total_host_reads_bytes;
                        total_host_writes_bytes = parsed.total_host_writes_bytes;
                        power_on_count = parsed.power_on_count;
                        power_on_hours = parsed.power_on_hours;
                        unsafe_shutdowns = parsed.unsafe_shutdowns;
                        media_errors = parsed.media_errors;
                        diagnostic_notes = parsed.diagnostic_notes;
                        attributes = parsed.attributes;
                        smart_available = true;
                    }
                }
            }

            let requires_admin_for_smart = !smart_available && !is_admin;
            if requires_admin_for_smart {
                diagnostic_notes.push(
                    "Administrator privileges are required to read full S.M.A.R.T. telemetry."
                        .to_string(),
                );
            }

            disks.push(PhysicalDiskHealth {
                disk_index,
                model,
                serial_number,
                firmware,
                capacity_bytes,
                drive_letters,
                interface_type,
                standard,
                media_type,
                rotation_rate: None,
                features,
                protocol,
                health_status,
                health_percent,
                temperature_c,
                total_host_reads_bytes,
                total_host_writes_bytes,
                power_on_count,
                power_on_hours,
                unsafe_shutdowns,
                media_errors,
                available_spare_pct,
                smart_available,
                requires_admin_for_smart,
                diagnostic_notes,
                attributes,
            });
        }

        let collected_at_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        DiskHealthReport {
            is_admin,
            disks,
            collected_at_ts,
        }
    }
}

pub fn collect_all_disk_health() -> DiskHealthReport {
    #[cfg(windows)]
    {
        win_impl::collect_all_disk_health()
    }
    #[cfg(not(windows))]
    {
        let collected_at_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        DiskHealthReport {
            is_admin: false,
            disks: Vec::new(),
            collected_at_ts,
        }
    }
}
