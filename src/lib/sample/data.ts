// FICTIONAL SAMPLE DATA. Every tag, value, vendor and procedure here is invented for a
// software demo. It does not describe any real plant and must not be used for operations.

import type { AssetType } from "../types";

export const SAMPLE_SITE_NAME = "Sample Site: Bus 1A (fictional)";
export const SAMPLE_LOCATION = "Demo data";

export const SAMPLE_ASSETS: { tag: string; name: string; type: AssetType; description: string; params?: Record<string, string> }[] = [
  { tag: "SWYD-230", name: "230 kV Switchyard", type: "source", description: "Offsite power supply.", params: { voltage: "230 kV" } },
  { tag: "SAT-1A", name: "Station Aux Transformer", type: "transformer", description: "Steps offsite power down to the 4.16 kV safety bus.", params: { voltage_ratio: "230/4.16 kV" } },
  { tag: "52-1A01", name: "Normal Supply Breaker", type: "breaker", description: "Normal supply breaker from SAT-1A to Bus 1A.", params: { normal_state: "closed" } },
  { tag: "BUS-1A", name: "4.16 kV Bus 1A", type: "bus", description: "Safety-related 4.16 kV switchgear.", params: { voltage: "4.16 kV" } },
  { tag: "EDG-1A", name: "Emergency Diesel Generator", type: "generator", description: "Standby source on loss of offsite power." },
  { tag: "52-1A02", name: "EDG Output Breaker", type: "breaker", description: "Connects EDG-1A to Bus 1A.", params: { normal_state: "open" } },
  { tag: "52-1A03", name: "RHR Pump Feeder", type: "breaker", description: "Feeder breaker for RHR pump P-1A." },
  { tag: "P-1A", name: "RHR Pump", type: "motor", description: "Residual heat removal pump motor." },
  { tag: "52-1A04", name: "Core Spray Feeder", type: "breaker", description: "Feeder breaker for core spray pump P-1C." },
  { tag: "P-1C", name: "Core Spray Pump", type: "motor", description: "Core spray pump motor." },
  { tag: "52-1A05", name: "Load Center Feeder", type: "breaker", description: "Feeder breaker for load center transformer T-1A5." },
  { tag: "T-1A5", name: "Load Center Transformer", type: "transformer", description: "Steps 4,160 V down to 480 V.", params: { voltage_ratio: "4160/480 V" } },
  { tag: "MCC-1A1", name: "Motor Control Center", type: "mcc", description: "480 V motor control center.", params: { voltage: "480 V" } },
  { tag: "MOV-E11-F004A", name: "RHR Suction Valve", type: "valve", description: "Motor-operated RHR pump suction valve." },
  { tag: "FN-1A", name: "Room Cooler Fan", type: "motor", description: "RHR pump room cooler fan." },
];

export const SAMPLE_EDGES: [string, string, string][] = [
  ["SWYD-230", "SAT-1A", "230 kV"],
  ["SAT-1A", "52-1A01", "4.16 kV"],
  ["52-1A01", "BUS-1A", ""],
  ["EDG-1A", "52-1A02", "4.16 kV"],
  ["52-1A02", "BUS-1A", "Standby"],
  ["BUS-1A", "52-1A03", ""],
  ["52-1A03", "P-1A", "Feeder"],
  ["BUS-1A", "52-1A04", ""],
  ["52-1A04", "P-1C", "Feeder"],
  ["BUS-1A", "52-1A05", ""],
  ["52-1A05", "T-1A5", "4.16 kV"],
  ["T-1A5", "MCC-1A1", "480 V"],
  ["MCC-1A1", "MOV-E11-F004A", "480 V"],
  ["MCC-1A1", "FN-1A", "480 V"],
];

export const MANUAL_FILE_NAME = "SAMPLE_Bus1A_OM_Manual.txt";
export const MANUAL_TITLE =
  "SAMPLE Bus 1A Operating and Maintenance Manual (fictional training document, not for plant use)";

const HEADER = `${MANUAL_TITLE}\nFICTIONAL - FOR SOFTWARE DEMONSTRATION ONLY.`;

/** Eleven pages, one string per page. Written so each page chunks cleanly. */
export const MANUAL_PAGES: string[] = [
  `${HEADER}
Page 1. Introduction and Scope.
This fictional manual describes the 4.16 kV safety bus BUS-1A at an invented demonstration site. It exists only to exercise the Capital Delivery Accelerator software. None of the values, procedures or equipment descriptions apply to any real facility.
BUS-1A is normally fed from the 230 kV switchyard SWYD-230 through station auxiliary transformer SAT-1A and normal supply breaker 52-1A01. Emergency diesel generator EDG-1A provides a standby source through output breaker 52-1A02.
Loads on BUS-1A covered here are RHR pump P-1A through feeder 52-1A03, core spray pump P-1C through feeder 52-1A04, and load center transformer T-1A5 through feeder 52-1A05. T-1A5 feeds motor control center MCC-1A1, which supplies RHR suction valve MOV-E11-F004A and room cooler fan FN-1A.`,

  `${HEADER}
Page 2. Section 1: Equipment Data, Transformers and Breakers.
SAT-1A station auxiliary transformer: rated 30 MVA, cooling class ONAN/ONAF, impedance 8.5 percent, voltage ratio 230 kV to 4.16 kV.
4.16 kV breakers 52-1A01, 52-1A02, 52-1A03, 52-1A04 and 52-1A05: vacuum breakers rated 1200 A continuous, 40 kA interrupting, with 125 VDC control power.
T-1A5 load center transformer: 1500 kVA, dry type, 4160 V to 480 V.
MCC-1A1 motor control center: 800 A horizontal bus, 24 buckets, 480 V.`,

  `${HEADER}
Page 3. Section 1 continued: Equipment Data, Rotating Equipment and Valves.
EDG-1A emergency diesel generator: rated 2850 kW at 900 rpm. EDG-1A reaches rated speed and voltage in 10 s or less from a start signal. Fuel consumption at full load is 205 gal/hr.
P-1A RHR pump motor: 1250 HP, 1785 rpm, rated flow 7,700 gpm.
P-1C core spray pump motor: 800 HP, rated flow 4,625 gpm.
MOV-E11-F004A RHR suction valve actuator: size SMB-00, 2 HP motor, stroke time 60 s, thrust limit 12,500 lbf.
FN-1A room cooler fan: 15 HP motor, 12,000 cfm.`,

  `${HEADER}
Page 4. Section 2: Normal Lineup.
In the normal lineup BUS-1A is energized from SWYD-230 through SAT-1A with breaker 52-1A01 closed. EDG-1A is in standby with output breaker 52-1A02 open and the EDG in auto.
Feeder breakers 52-1A03, 52-1A04 and 52-1A05 are racked in. 52-1A05 is closed so that T-1A5 and MCC-1A1 are energized. 52-1A03 and 52-1A04 are open with their pumps in standby.
MOV-E11-F004A is normally open. FN-1A is in auto and starts with P-1A. Verify bus voltage between 4.10 kV and 4.25 kV once per shift.`,

  `${HEADER}
Page 5. Section 3: Loss of Offsite Power Response.
On loss of voltage on BUS-1A, the undervoltage relays trip 52-1A01 and shed bus loads. EDG-1A receives an automatic start signal and must reach rated speed and voltage in 10 s or less.
When EDG-1A is at rated voltage and frequency, 52-1A02 closes automatically and the load sequencer restores loads in this order.
Step 1. At 0 s after 52-1A02 closes, the sequencer closes 52-1A05 to re-energize T-1A5 and MCC-1A1.
Step 2. At 5 s, the sequencer closes 52-1A03 to start RHR pump P-1A.
Step 3. At 10 s, the sequencer closes 52-1A04 to start core spray pump P-1C.
Operators verify each step on the bus ammeter and report any sequencer step that does not occur.`,

  `${HEADER}
Page 6. Section 4: Restoring Offsite Power.
Use this section to transfer BUS-1A from EDG-1A back to offsite power once SWYD-230 and SAT-1A are confirmed available.
Step 1. Verify SAT-1A secondary voltage is normal.
Step 2. Place the synchroscope in service and synchronize EDG-1A with the offsite source.
Step 3. Close 52-1A01 when the synchroscope is slow in the fast direction near the 12 o'clock position.
Step 4. Unload EDG-1A to less than 200 kW.
Step 5. Open 52-1A02.
Step 6. Run EDG-1A unloaded for a 5 min cooldown, then shut it down and return it to standby in auto.`,

  `${HEADER}
Page 7. Section 5: EDG Monthly Surveillance.
Perform the EDG-1A surveillance once per month.
Step 1. Verify the day tank level is above 75 percent before starting.
Step 2. Start EDG-1A from the control room and verify it reaches rated speed and voltage in 10 s or less.
Step 3. Synchronize to BUS-1A and close 52-1A02.
Step 4. Load EDG-1A to between 2565 kW and 2850 kW and run for 60 min.
Step 5. Record fuel consumption, which should be near 205 gal/hr at full load.
Step 6. Unload to less than 200 kW, open 52-1A02 and complete a 5 min cooldown.`,

  `${HEADER}
Page 8. Section 6: Breaker Racking and Isolation.
Racking any 4.16 kV breaker on BUS-1A requires arc-flash PPE category 4. Use the remote racking device where available and stand clear of the cubicle door.
Step 1. Open the breaker and verify the open indication.
Step 2. Remove 125 VDC control power fuses.
Step 3. Rack the breaker to the disconnect position.
Step 4. Apply the isolation tag and verify zero energy before work.`,

  `${HEADER}
Page 9. Section 7: RHR Pump P-1A Start.
Use this procedure for a manual start of RHR pump P-1A.
Step 1. Verify MOV-E11-F004A RHR suction valve is fully open.
Step 2. Verify room cooler fan FN-1A is running.
Step 3. Close feeder breaker 52-1A03 to start P-1A.
Step 4. Verify motor current settles below 160 A within 10 s.
Step 5. Verify discharge flow approaches 7,700 gpm.
Limit P-1A to 2 cold starts or 1 hot start per hour to protect the motor windings.`,

  `${HEADER}
Page 10. Section 8: MOV Stroke Test.
Stroke test MOV-E11-F004A quarterly.
Step 1. Verify P-1A is stopped and 52-1A03 is open.
Step 2. Stroke MOV-E11-F004A closed from MCC-1A1 and time the stroke. The acceptance limit is 60 s.
Step 3. Stroke the valve open and time the stroke.
Step 4. Confirm the measured thrust stays below the 12,500 lbf limit using diagnostic test equipment.
Step 5. Return MOV-E11-F004A to the normally open position.`,

  `${HEADER}
Page 11. Section 9: Preventive Maintenance.
SAT-1A: sample oil for dissolved gas annually and inspect cooling fans quarterly. Alarm if top oil temperature exceeds 85 degC.
4.16 kV breakers: inspect, clean and time every 6 years or 2,000 operations.
P-1A and P-1C motors: measure insulation resistance every 2 years; trend bearing temperature, alarm at 85 degC.
MCC-1A1: thermography annually. FN-1A: lubricate bearings every 6 months.
EDG-1A: inspect and change lubricating oil every 24 months.`,
];

/** Pre-computed manual extraction so the sample works without an API key. Keyed by tag. */
export const MANUAL_EXTRACTION = {
  assets: [
    { tag: "SAT-1A", params: { rating: "30 MVA", cooling: "ONAN/ONAF", impedance: "8.5%", top_oil_alarm: "85 degC" }, description: "" },
    ...["52-1A01", "52-1A02", "52-1A03", "52-1A04", "52-1A05"].map((tag) => ({
      tag,
      params: { breaker_type: "vacuum", continuous_rating: "1200 A", interrupting_rating: "40 kA", control_power: "125 VDC", racking_ppe: "arc-flash category 4" },
      description: "",
    })),
    {
      tag: "EDG-1A",
      params: { rating: "2850 kW", speed: "900 rpm", start_time: "10 s or less", fuel_consumption: "205 gal/hr", unload_before_trip: "< 200 kW", cooldown: "5 min" },
      description: "Standby diesel generator that starts and reaches rated speed in 10 s or less on loss of offsite power.",
    },
    {
      tag: "P-1A",
      params: { motor_rating: "1250 HP", speed: "1785 rpm", rated_flow: "7,700 gpm", start_current_limit: "< 160 A within 10 s", start_limit: "2 cold or 1 hot start per hour", sequencer_step: "5 s" },
      description: "",
    },
    { tag: "P-1C", params: { motor_rating: "800 HP", rated_flow: "4,625 gpm", sequencer_step: "10 s" }, description: "" },
    { tag: "T-1A5", params: { rating: "1500 kVA", construction: "dry type" }, description: "" },
    { tag: "MCC-1A1", params: { bus_rating: "800 A", buckets: "24" }, description: "" },
    { tag: "MOV-E11-F004A", params: { actuator: "SMB-00", motor_rating: "2 HP", stroke_time: "60 s", thrust_limit: "12,500 lbf", normal_position: "open" }, description: "" },
    { tag: "FN-1A", params: { motor_rating: "15 HP", airflow: "12,000 cfm" }, description: "" },
    { tag: "BUS-1A", params: { normal_voltage_band: "4.10-4.25 kV" }, description: "" },
  ],
};

export const ASSET_REGISTER_FILE = "SAMPLE_asset_register.csv";
export const ASSET_REGISTER_CSV = `asset_tag,manufacturer,model,install_year,criticality,maximo_location
SAT-1A,Example Transformer Co,EX-30M,1998,A,DEMO-SWGR-SAT1A
52-1A01,Example Switchgear Co,EVB-1200,2011,A,DEMO-SWGR-1A-01
BUS-1A,Example Switchgear Co,EMS-5,1998,A,DEMO-SWGR-1A
EDG-1A,Example Engine Co,EDX-16,1987,A,DEMO-EDG-1A
52-1A02,Example Switchgear Co,EVB-1200,2011,A,DEMO-SWGR-1A-02
P-1A,Example Motor Co,EMV-1250,1987,A,DEMO-RHR-P1A
P-1C,Example Motor Co,EMV-800,1987,A,DEMO-CS-P1C
T-1A5,Example Transformer Co,EDT-1500,2004,B,DEMO-LC-1A5
MCC-1A1,Example Controls Co,EMC-800,2004,B,DEMO-MCC-1A1
MOV-E11-F004A,Example Valve Co,EGV-18,1987,A,DEMO-RHR-F004A
`;

export const HISTORIAN_FILE = "SAMPLE_historian_export.csv";
export const HISTORIAN_CSV = `tag,signal,timestamp,value,unit
P-1A,motor_current,2026-10-01T05:00:00Z,151,A
P-1A,motor_current,2026-10-01T06:00:00Z,148,A
P-1A,bearing_temp,2026-10-01T05:00:00Z,60,degC
P-1A,bearing_temp,2026-10-01T06:00:00Z,61,degC
EDG-1A,day_tank_level,2026-10-01T06:00:00Z,92,%
BUS-1A,bus_voltage,2026-10-01T05:00:00Z,4.16,kV
BUS-1A,bus_voltage,2026-10-01T06:00:00Z,4.17,kV
SAT-1A,top_oil_temp,2026-10-01T06:00:00Z,54,degC
`;
