use disk_core::model::{HealthStatus, PhysicalDiskHealth, SmartAttrStatus, SmartProtocol};
use disk_core::smart::{
    format_smart_report_text, parse_ata_smart_data, parse_nvme_identify_version,
    parse_nvme_smart_log,
};

#[test]
fn nvme_smart_log_parser_matches_spec_values() {
    assert_eq!(parse_nvme_identify_version(0x0001_0400), "NVM Express 1.4");
    assert_eq!(parse_nvme_identify_version(0x0002_0000), "NVM Express 2.0");

    // 512-byte NVMe SMART/Health Log Page 0x02 fixture matching a Samsung NVMe SSD:
    // CriticalWarning=0, CompositeTemp=0x0157 (343K = 70 C), AvailSpare=0x61 (97%),
    // AvailSpareThresh=0x0A (10%), PctUsed=0x0F (15% -> 85% health),
    // DataUnitsRead=0x00A0DE978, DataUnitsWritten=0x006168FFF,
    // PowerCycles=0x0CCD (3277), PowerOnHours=0x3798 (14232), UnsafeShutdowns=0x0114 (276),
    // MediaErrors=0x00CD (205), TempSensor1=0x0157 (70 C)
    let mut buf = [0u8; 512];
    buf[0] = 0x00;
    buf[1..3].copy_from_slice(&0x0157u16.to_le_bytes());
    buf[3] = 0x61;
    buf[4] = 0x0A;
    buf[5] = 0x0F;
    buf[32..48].copy_from_slice(&0x00A0_DE978u128.to_le_bytes());
    buf[48..64].copy_from_slice(&0x0061_68FFFu128.to_le_bytes());
    buf[112..128].copy_from_slice(&0x0CCDu128.to_le_bytes());
    buf[128..144].copy_from_slice(&0x3798u128.to_le_bytes());
    buf[144..160].copy_from_slice(&0x0114u128.to_le_bytes());
    buf[160..176].copy_from_slice(&0x00CDu128.to_le_bytes());
    buf[200..202].copy_from_slice(&0x0157u16.to_le_bytes());

    let parsed = parse_nvme_smart_log(&buf).expect("NVMe SMART log should parse");
    assert_eq!(parsed.health_status, HealthStatus::Good);
    assert_eq!(parsed.health_percent, 85);
    assert_eq!(parsed.temperature_c, Some(70));
    assert_eq!(parsed.available_spare_pct, 97);
    assert_eq!(parsed.power_on_count, 3277);
    assert_eq!(parsed.power_on_hours, 14232);
    assert_eq!(parsed.unsafe_shutdowns, 276);
    assert_eq!(parsed.media_errors, 205);

    let temp_attr = parsed
        .attributes
        .iter()
        .find(|a| a.id == 0x02)
        .expect("composite temp attr");
    assert_eq!(temp_attr.status, SmartAttrStatus::Critical);
    assert!(temp_attr.decoded_value.contains("70 °C"));
    assert!(parsed.attributes.iter().any(|a| a.id == 0x12));
}

#[test]
fn ata_smart_parser_detects_caution_and_temperature() {
    let mut attr = [0u8; 512];
    let mut thresh = [0u8; 512];

    // Slot 0: ID 0x05 Reallocated Sectors Count (raw = 4 -> Caution)
    attr[2] = 0x05;
    attr[3..5].copy_from_slice(&0x0033u16.to_le_bytes());
    attr[5] = 98;
    attr[6] = 98;
    attr[7..13].copy_from_slice(&[4, 0, 0, 0, 0, 0]);
    thresh[2] = 0x05;
    thresh[3] = 10;

    // Slot 1: ID 0x09 Power-On Hours (raw = 5000)
    let s1 = 2 + 12;
    attr[s1] = 0x09;
    attr[s1 + 3] = 95;
    attr[s1 + 4] = 95;
    attr[s1 + 5..s1 + 9].copy_from_slice(&5000u32.to_le_bytes());

    // Slot 2: ID 0xC2 Temperature (raw = 42 C -> Good)
    let s2 = 2 + 24;
    attr[s2] = 0xC2;
    attr[s2 + 3] = 58;
    attr[s2 + 4] = 50;
    attr[s2 + 5] = 42;

    // Slot 3: ID 0xE7 SSD Life Left (current = 91%)
    let s3 = 2 + 36;
    attr[s3] = 0xE7;
    attr[s3 + 3] = 91;
    attr[s3 + 4] = 91;

    let parsed = parse_ata_smart_data(&attr, Some(&thresh));
    assert_eq!(parsed.health_status, HealthStatus::Caution);
    assert_eq!(parsed.temperature_c, Some(42));
    assert_eq!(parsed.power_on_hours, Some(5000));
    assert_eq!(parsed.health_percent, Some(91));
    assert_eq!(parsed.media_errors, Some(4));

    let realloc = parsed.attributes.iter().find(|a| a.id == 0x05).unwrap();
    assert_eq!(realloc.status, SmartAttrStatus::Caution);
    assert_eq!(realloc.threshold, Some(10));

    let disk = PhysicalDiskHealth {
        disk_index: 0,
        model: "Test SSD 500GB".into(),
        serial_number: "SECRET-SN-9999".into(),
        firmware: "FW1.0".into(),
        capacity_bytes: 500_000_000_000,
        drive_letters: vec!["C:".into()],
        interface_type: "SATA".into(),
        standard: "ATA/ACS".into(),
        media_type: "SSD".into(),
        rotation_rate: None,
        features: vec!["S.M.A.R.T.".into(), "TRIM".into()],
        protocol: SmartProtocol::Ata,
        health_status: parsed.health_status,
        health_percent: parsed.health_percent,
        temperature_c: parsed.temperature_c,
        total_host_reads_bytes: None,
        total_host_writes_bytes: None,
        power_on_count: None,
        power_on_hours: parsed.power_on_hours,
        unsafe_shutdowns: None,
        media_errors: parsed.media_errors,
        available_spare_pct: None,
        smart_available: true,
        requires_admin_for_smart: false,
        diagnostic_notes: parsed.diagnostic_notes,
        attributes: parsed.attributes,
    };

    let masked = format_smart_report_text(&disk, true);
    assert!(!masked.contains("SECRET-SN-9999"));
    assert!(masked.contains("****************"));
    let unmasked = format_smart_report_text(&disk, false);
    assert!(unmasked.contains("SECRET-SN-9999"));
}
