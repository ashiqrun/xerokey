#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <Adafruit_MCP23X17.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <time.h>
#include <sys/time.h>

// ============================================================================
// 1. NETWORK & API CONFIGURATION
// ============================================================================

#define USE_LOCAL_SERVER

#ifdef USE_LOCAL_SERVER
  // Mac Local IP (IPv4)
  #define API_HOST "http://192.168.0.106:3000"
#else
  // Production Cloud URL
  #define API_HOST "https://xero-key.vercel.app"
#endif

#define API_MAIN_ENDPOINT API_HOST "/api/esp32"
#define API_PING_ENDPOINT API_HOST "/api/esp32/ping"
#define API_KEY           "xk_live_f4faea8cb68850525634ab1b214c8dd73104ad7b6aea16a5"

struct WifiCred { const char* ssid; const char* pass; };
const WifiCred WIFI_NETWORKS[] = {
  {"X",   "Run.5080"},
  {"BACKUP_WIFI_SSID", "BACKUP_WIFI_PASS"}
};

// ============================================================================
// 2. HARDWARE PINS & CONSTANTS
// ============================================================================

#define PIN_RFID_SS    5   // D5
#define PIN_RFID_RST   4   // D4
#define PIN_I2C_SDA    21  // D21
#define PIN_I2C_SCL    22  // D22
#define MCP_ADDR       0x20

#define PIN_LED_GREEN  25  // D25
#define PIN_LED_RED    27  // D27
#define PIN_BUZZER     13  // D13 (Safe boot GPIO)

#define NUM_LOCKERS    12
#define RELAY_PULSE_MS 1500UL
#define PING_INTERVAL  15000UL
#define FLUSH_COOLDOWN 10000UL // 10s guard to prevent server log spamming
#define MAX_LOG_BYTES  512000UL
#define LOG_FILE_PATH  "/offline_logs.csv"

// ============================================================================
// 3. 13 FIXED MASTER KEYS CONFIGURATION
// ============================================================================
// 1 Grand Master Key: Opens all 12 lockers sequentially (one-by-one, 600ms gap)
const char* const MASTER_UID_ALL = "04:FF:FF:FF:FF:FF:00";

// 12 Individual Master Keys: Opens designated Locker Bay L-01 through L-12
const char* const MASTER_UID_LOCKERS[NUM_LOCKERS] = {
  "04:01:00:00:00:00:01", // Master Key for Locker Bay 1
  "04:02:00:00:00:00:02", // Master Key for Locker Bay 2
  "04:03:00:00:00:00:03", // Master Key for Locker Bay 3
  "04:04:00:00:00:00:04", // Master Key for Locker Bay 4
  "04:05:00:00:00:00:05", // Master Key for Locker Bay 5
  "04:06:00:00:00:00:06", // Master Key for Locker Bay 6
  "04:07:00:00:00:00:07", // Master Key for Locker Bay 7
  "04:08:00:00:00:00:08", // Master Key for Locker Bay 8
  "04:09:00:00:00:00:09", // Master Key for Locker Bay 9
  "04:10:00:00:00:00:10", // Master Key for Locker Bay 10
  "04:11:00:00:00:00:11", // Master Key for Locker Bay 11
  "04:12:00:00:00:00:12"  // Master Key for Locker Bay 12
};

// --- Monotonically Tracked Event Payload ---
struct TxEvent {
  uint32_t seq;        // Strict increasing sequence ID
  uint32_t timestamp;  // Epoch or relative seconds
  char uid[32];        // NFC Card UID (e.g., "04:A1:B2:C3:D4:E5:F6")
  uint8_t lockerNum;   // 1-12 (0 for Grand Master / All)
  char action[16];     // "checkin", "checkout", "master_open", "master_all"
  char forcedBy[20];   // "MASTER_KEY", "MASTER_ALL", or ""
};

// --- Globals ---
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Adafruit_MCP23X17 mcp;
Preferences prefs;
WiFiMulti wifiMulti;
QueueHandle_t txQueue;

bool mcpConnected = false;
bool lockerOccupied[NUM_LOCKERS] = {false};
char lockerOwnerUid[NUM_LOCKERS][32] = {{0}};

// Hardware Sequence Tracking
uint32_t currentSeq = 0;
uint32_t lastServerSyncedSeq = 0;

// Non-blocking hardware timers (Core 1)
uint32_t relayOffAt[NUM_LOCKERS] = {0};
uint32_t buzzTimer = 0;
uint16_t buzzInterval = 0;
uint8_t  buzzEdgesLeft = 0;
bool     buzzSyncRedLed = false;
uint32_t lastScanTime = 0;

// ============================================================================
// 4. CORE 1 HELPERS (Zero Blocking, Local NVS & Hardware Control)
// ============================================================================

bool isSystemFull() {
  for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
    if (!lockerOccupied[i]) return false;
  }
  return true;
}

void syncStatusLeds() {
  bool full = isSystemFull();
  digitalWrite(PIN_LED_GREEN, full ? LOW : HIGH);
  digitalWrite(PIN_LED_RED,   full ? HIGH : LOW);
}

void triggerFeedback(uint8_t beeps, uint16_t intervalMs, bool blinkRed) {
  buzzEdgesLeft  = (beeps * 2) - 1;
  buzzInterval   = intervalMs;
  buzzSyncRedLed = blinkRed;
  buzzTimer      = millis();
  digitalWrite(PIN_BUZZER, HIGH);
  if (blinkRed) digitalWrite(PIN_LED_RED, HIGH);
}

inline void triggerSuccessBeep() {
  triggerFeedback(1, 120, false);
}

inline void triggerRejectionBeep() {
  // 3-beep rejection sequence with red LED for non-7-byte or unauthorized cards
  triggerFeedback(3, 80, true);
}

inline void triggerLockerFullLongBeep() {
  // Long continuous beep (1000ms) with red LED when all 12 lockers are occupied
  triggerFeedback(1, 1000, true);
}

void pulseLocker(uint8_t index) {
  if (mcpConnected) {
    mcp.digitalWrite(index, LOW); // Active-LOW relay engage
  }
  relayOffAt[index] = millis() + RELAY_PULSE_MS;
}

void saveSlotToNVS(uint8_t index) {
  prefs.begin("lockers", false);
  char key[8];
  snprintf(key, sizeof(key), "u%02d", index);
  if (lockerOccupied[index]) {
    prefs.putString(key, lockerOwnerUid[index]);
  } else {
    prefs.remove(key);
  }
  prefs.end();
}

void loadStateFromNVS() {
  prefs.begin("lockers", false);
  for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
    char key[8];
    snprintf(key, sizeof(key), "u%02d", i);
    String saved = prefs.getString(key, "");
    if (saved.length() > 0) {
      lockerOccupied[i] = true;
      strlcpy(lockerOwnerUid[i], saved.c_str(), sizeof(lockerOwnerUid[i]));
    } else {
      lockerOccupied[i] = false;
      lockerOwnerUid[i][0] = '\0';
    }
  }
  prefs.end();
}

uint32_t getNextSequence() {
  prefs.begin("seq_tracker", false);
  currentSeq = prefs.getUInt("seq", 0) + 1;
  prefs.putUInt("seq", currentSeq);
  prefs.end();
  return currentSeq;
}

uint32_t getEpochTime() {
  time_t now;
  time(&now);
  if (now > 1700000000) return (uint32_t)now;
  return (uint32_t)(millis() / 1000);
}

bool uidEquals(const char* a, const char* b) {
  if (!a || !b) return false;
  char ca[36], cb[36];
  uint8_t ja = 0, jb = 0;
  for (uint8_t i = 0; a[i] && ja < 35; i++) {
    if (a[i] != ':' && a[i] != ' ' && a[i] != '-') ca[ja++] = toupper((unsigned char)a[i]);
  }
  ca[ja] = '\0';
  for (uint8_t i = 0; b[i] && jb < 35; i++) {
    if (b[i] != ':' && b[i] != ' ' && b[i] != '-') cb[jb++] = toupper((unsigned char)b[i]);
  }
  cb[jb] = '\0';
  return strcmp(ca, cb) == 0;
}

// ============================================================================
// 5. MASTER KEY SEQUENTIAL & INDIVIDUAL ACTIONS
// ============================================================================

void executeGrandMasterOpen(const char* cardUid) {
  Serial.println("\n========================================================");
  Serial.println(" [MASTER KEY] >>> GRAND MASTER CARD DETECTED! <<<");
  Serial.println(" [MASTER KEY] Sequentially unlocking ALL 12 Lockers...");
  Serial.println("========================================================");

  uint32_t seq = getNextSequence();
  uint32_t ts = getEpochTime();

  TxEvent ev;
  ev.seq = seq;
  ev.timestamp = ts;
  strlcpy(ev.uid, cardUid, sizeof(ev.uid));
  ev.lockerNum = 0;
  strlcpy(ev.action, "master_all", sizeof(ev.action));
  strlcpy(ev.forcedBy, "MASTER_ALL", sizeof(ev.forcedBy));

  xQueueSend(txQueue, &ev, 0);

  // Unlocks all 12 lockers one-by-one with 600ms safety interval
  for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
    pulseLocker(i);
    lockerOccupied[i] = false;
    lockerOwnerUid[i][0] = '\0';
    saveSlotToNVS(i);

    // Audio chirp on each unlocked bay
    digitalWrite(PIN_BUZZER, HIGH);
    vTaskDelay(pdMS_TO_TICKS(70));
    digitalWrite(PIN_BUZZER, LOW);

    Serial.printf("[GRAND MASTER] Unlocked Locker Bay L-%02d (%d/12)\n", i + 1, i + 1);
    vTaskDelay(pdMS_TO_TICKS(600));
  }

  syncStatusLeds();
  triggerFeedback(2, 120, false);
  Serial.println("[GRAND MASTER] Finished unlocking all 12 lockers. System state clear.\n");
}

void executeIndividualMasterOpen(uint8_t lockerIdx, const char* cardUid) {
  uint8_t bayNumber = lockerIdx + 1;
  Serial.printf("\n[MASTER KEY] >>> INDIVIDUAL MASTER DETECTED FOR BAY L-%02d! <<<\n", bayNumber);

  uint32_t seq = getNextSequence();
  uint32_t ts = getEpochTime();

  TxEvent ev;
  ev.seq = seq;
  ev.timestamp = ts;
  strlcpy(ev.uid, cardUid, sizeof(ev.uid));
  ev.lockerNum = bayNumber;
  strlcpy(ev.action, "master_open", sizeof(ev.action));
  strlcpy(ev.forcedBy, "MASTER_KEY", sizeof(ev.forcedBy));

  xQueueSend(txQueue, &ev, 0);

  // Clear locker occupancy in ESP32 memory & NVS
  lockerOccupied[lockerIdx] = false;
  lockerOwnerUid[lockerIdx][0] = '\0';
  saveSlotToNVS(lockerIdx);

  pulseLocker(lockerIdx);
  syncStatusLeds();
  triggerFeedback(2, 100, false);

  Serial.printf("[ACTION] Master Override Unlocked Locker L-%02d.\n", bayNumber);
}

// ============================================================================
// 6. CORE 1 TASK: Hardware & Real-Time Logic (0ms Network Wait)
// ============================================================================

void core1HardwareTask(void* pvParameters) {
  Serial.println("[CORE 1] Hardware Task Started. Waiting for Master or User Cards...");

  for (;;) {
    uint32_t now = millis();

    // 1. Service non-blocking relay shutoffs
    for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
      if (relayOffAt[i] && (int32_t)(now - relayOffAt[i]) >= 0) {
        if (mcpConnected) mcp.digitalWrite(i, HIGH); // Active-LOW release
        relayOffAt[i] = 0;
        Serial.printf("[LOCKER] L-%02d Relay Closed.\n", i + 1);
      }
    }

    // 2. Service non-blocking buzzer & error LED state machine
    if (buzzEdgesLeft > 0 && (now - buzzTimer >= buzzInterval)) {
      buzzTimer = now;
      buzzEdgesLeft--;
      bool level = (buzzEdgesLeft % 2 == 1);
      digitalWrite(PIN_BUZZER, level ? HIGH : LOW);
      if (buzzSyncRedLed) digitalWrite(PIN_LED_RED, level ? HIGH : LOW);
      if (buzzEdgesLeft == 0) syncStatusLeds();
    }

    // 3. Poll RC522 (with 800ms debounce window)
    if ((now - lastScanTime > 800) && rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      lastScanTime = now;

      // Format scanned UID string
      char scannedUid[32] = {0};
      for (byte b = 0; b < rfid.uid.size && b < 10; b++) {
        char byteBuf[4];
        snprintf(byteBuf, sizeof(byteBuf), "%s%02X", (b > 0 ? ":" : ""), rfid.uid.uidByte[b]);
        strlcat(scannedUid, byteBuf, sizeof(scannedUid));
      }

      Serial.printf("[NFC SCAN] Card UID: %s (Length: %d bytes)\n", scannedUid, rfid.uid.size);

      // --- 1. Check for Grand Master Key (Supports 7-byte or 4-byte) ---
      if (uidEquals(scannedUid, MASTER_UID_ALL)) {
        executeGrandMasterOpen(scannedUid);
      }
      else {
        // --- 2. Check for 12 Individual Master Keys (Supports 7-byte or 4-byte) ---
        int8_t matchedMasterBay = -1;
        for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
          if (uidEquals(scannedUid, MASTER_UID_LOCKERS[i])) {
            matchedMasterBay = i;
            break;
          }
        }

        if (matchedMasterBay != -1) {
          executeIndividualMasterOpen(matchedMasterBay, scannedUid);
        }
        else {
          // --- 3. Regular User NFC: STRICT 7-BYTE UID RESTRICTION ---
          if (rfid.uid.size != 7) {
            Serial.printf("[SECURITY] Card UID %s REJECTED: User card must be 7-byte UID (received %d bytes).\n", scannedUid, rfid.uid.size);
            triggerRejectionBeep(); // 3-time warning beep
          }
          else {
            // Valid 7-byte User NFC Card
            int8_t existingIdx = -1;
            int8_t firstEmptyIdx = -1;

            for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
              if (lockerOccupied[i] && uidEquals(lockerOwnerUid[i], scannedUid)) {
                existingIdx = i;
                break;
              }
              if (!lockerOccupied[i] && firstEmptyIdx == -1) {
                firstEmptyIdx = i;
              }
            }

            if (existingIdx != -1) {
              // Action A: Check-Out
              lockerOccupied[existingIdx] = false;
              lockerOwnerUid[existingIdx][0] = '\0';
              saveSlotToNVS(existingIdx);
              pulseLocker(existingIdx);
              syncStatusLeds();
              triggerSuccessBeep();

              Serial.printf("[ACTION] USER CHECK-OUT -> Locker L-%02d Unlocked!\n", existingIdx + 1);

              uint32_t seq = getNextSequence();
              uint32_t ts = getEpochTime();

              TxEvent ev;
              ev.seq = seq;
              ev.timestamp = ts;
              strlcpy(ev.uid, scannedUid, sizeof(ev.uid));
              ev.lockerNum = existingIdx + 1;
              strlcpy(ev.action, "checkout", sizeof(ev.action));
              ev.forcedBy[0] = '\0';
              xQueueSend(txQueue, &ev, 0);

            } else if (firstEmptyIdx != -1) {
              // Action B: Check-In
              lockerOccupied[firstEmptyIdx] = true;
              strlcpy(lockerOwnerUid[firstEmptyIdx], scannedUid, sizeof(lockerOwnerUid[firstEmptyIdx]));
              saveSlotToNVS(firstEmptyIdx);
              pulseLocker(firstEmptyIdx);
              syncStatusLeds();
              triggerSuccessBeep();

              Serial.printf("[ACTION] USER CHECK-IN -> Assigned Locker L-%02d!\n", firstEmptyIdx + 1);

              uint32_t seq = getNextSequence();
              uint32_t ts = getEpochTime();

              TxEvent ev;
              ev.seq = seq;
              ev.timestamp = ts;
              strlcpy(ev.uid, scannedUid, sizeof(ev.uid));
              ev.lockerNum = firstEmptyIdx + 1;
              strlcpy(ev.action, "checkin", sizeof(ev.action));
              ev.forcedBy[0] = '\0';
              xQueueSend(txQueue, &ev, 0);

            } else {
              // Action C: Lockers Full -> Long Type Beep
              Serial.printf("[FULL] All 12 Lockers Occupied! Card UID %s denied check-in with LONG BEEP.\n", scannedUid);
              triggerLockerFullLongBeep(); // Long continuous warning beep (1000ms)
              lastScanTime = now + 400; // Cooldown cushion for long beep
            }
          }
        }
      }

      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// ============================================================================
// 7. CORE 0: Background Wi-Fi, API Sync, LittleFS & Sequence Protection
// ============================================================================

bool postTransaction(const TxEvent& ev) {
  if (wifiMulti.run() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(API_MAIN_ENDPOINT);
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);

  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"seq\":%u,\"timestamp\":%u,\"uid\":\"%s\",\"lockerNumber\":%u,\"action\":\"%s\",\"forcedBy\":\"%s\"}",
           ev.seq, ev.timestamp, ev.uid, ev.lockerNum, ev.action, ev.forcedBy);

  int code = http.POST((uint8_t*)payload, strlen(payload));
  String responseStr = "";
  if (code >= 200 && code < 300) {
    responseStr = http.getString();
    // Parse lastSyncedSeq from server response if available
    int idx = responseStr.indexOf("\"lastSyncedSeq\":");
    if (idx > 0) {
      uint32_t sSeq = (uint32_t)responseStr.substring(idx + 16).toInt();
      if (sSeq > lastServerSyncedSeq) lastServerSyncedSeq = sSeq;
    }
  }
  http.end();

  Serial.printf("[API SYNC] POST seq:#%u %s | L-%02d | %s | HTTP: %d\n",
                ev.seq, ev.uid, ev.lockerNum, ev.action, code);

  return (code >= 200 && code < 300);
}

void appendOfflineLog(const TxEvent& ev) {
  if (LittleFS.exists(LOG_FILE_PATH)) {
    File check = LittleFS.open(LOG_FILE_PATH, "r");
    size_t sz = check ? check.size() : 0;
    if (check) check.close();
    if (sz >= MAX_LOG_BYTES) LittleFS.remove(LOG_FILE_PATH);
  }

  File f = LittleFS.open(LOG_FILE_PATH, "a");
  if (f) {
    // Format: seq,timestamp,uid,lockerNum,action,forcedBy
    f.printf("%u,%u,%s,%u,%s,%s\n",
             ev.seq, ev.timestamp, ev.uid, ev.lockerNum, ev.action, ev.forcedBy);
    f.close();
    Serial.printf("[OFFLINE LOG] Queued seq:#%u to LittleFS flash memory.\n", ev.seq);
  }
}

void flushOfflineLogs() {
  if (!LittleFS.exists(LOG_FILE_PATH) || wifiMulti.run() != WL_CONNECTED) return;

  File f = LittleFS.open(LOG_FILE_PATH, "r");
  if (!f) return;

  String remaining = "";
  uint16_t syncedCount = 0;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    // Parse CSV line: seq,timestamp,uid,lockerNum,action,forcedBy
    int p1 = line.indexOf(',');
    int p2 = line.indexOf(',', p1 + 1);
    int p3 = line.indexOf(',', p2 + 1);
    int p4 = line.indexOf(',', p3 + 1);
    int p5 = line.indexOf(',', p4 + 1);

    if (p1 > 0 && p2 > p1 && p3 > p2 && p4 > p3) {
      uint32_t seq = (uint32_t)line.substring(0, p1).toInt();
      uint32_t ts  = (uint32_t)line.substring(p1 + 1, p2).toInt();
      String uid   = line.substring(p2 + 1, p3);
      uint8_t lkr  = (uint8_t)line.substring(p3 + 1, p4).toInt();
      String act   = (p5 > p4) ? line.substring(p4 + 1, p5) : line.substring(p4 + 1);
      String frc   = (p5 > p4) ? line.substring(p5 + 1) : "";

      // Verify if server has already updated past this sequence
      if (seq <= lastServerSyncedSeq) {
        // Server already has this record, safely skip to prevent duplicate/overwrite
        continue;
      }

      TxEvent ev;
      ev.seq = seq;
      ev.timestamp = ts;
      strlcpy(ev.uid, uid.c_str(), sizeof(ev.uid));
      ev.lockerNum = lkr;
      strlcpy(ev.action, act.c_str(), sizeof(ev.action));
      strlcpy(ev.forcedBy, frc.c_str(), sizeof(ev.forcedBy));

      if (!postTransaction(ev)) {
        // Failed: preserve this and all remaining lines
        remaining += line + "\n";
        while (f.available()) remaining += f.readStringUntil('\n') + "\n";
        break;
      } else {
        syncedCount++;
        if (seq > lastServerSyncedSeq) lastServerSyncedSeq = seq;
      }
    }
  }
  f.close();

  if (remaining.length() == 0) {
    LittleFS.remove(LOG_FILE_PATH);
    if (syncedCount > 0) {
      Serial.printf("[OFFLINE SYNC] All %d offline logs synced successfully. Flash buffer clear.\n", syncedCount);
    }
  } else {
    File fw = LittleFS.open(LOG_FILE_PATH, "w");
    if (fw) { fw.print(remaining); fw.close(); }
  }
}

void sendHeartbeat() {
  if (wifiMulti.run() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(API_PING_ENDPOINT);
  http.setTimeout(3000);
  http.addHeader("x-api-key", API_KEY);
  int code = http.GET();

  if (code >= 200 && code < 300) {
    String payload = http.getString();

    // 1. Sync highest acknowledged server sequence
    int idxSeq = payload.indexOf("\"lastSyncedSeq\":");
    if (idxSeq > 0) {
      uint32_t sSeq = (uint32_t)payload.substring(idxSeq + 16).toInt();
      if (sSeq > lastServerSyncedSeq) {
        lastServerSyncedSeq = sSeq;
      }
    }

    // 2. Sync internal RTC clock from server time
    int idxTime = payload.indexOf("\"serverTime\":");
    if (idxTime > 0) {
      time_t sTime = (time_t)payload.substring(idxTime + 13).toInt();
      if (sTime > 1700000000) {
        struct timeval tv = { sTime, 0 };
        settimeofday(&tv, NULL);
      }
    }
  }
  http.end();
  Serial.printf("[HEARTBEAT] Ping HTTP: %d | Server Verified Seq: #%u\n", code, lastServerSyncedSeq);
}

void core0NetworkTask(void* pvParameters) {
  uint32_t lastPing = 0;
  uint32_t lastFlushAttempt = 0;
  TxEvent ev;

  for (;;) {
    bool connected = (wifiMulti.run(2000) == WL_CONNECTED);

    // 1. Drain Queue Instantly
    while (xQueueReceive(txQueue, &ev, pdMS_TO_TICKS(50)) == pdPASS) {
      if (!connected || !postTransaction(ev)) {
        appendOfflineLog(ev);
      } else {
        if (ev.seq > lastServerSyncedSeq) lastServerSyncedSeq = ev.seq;
      }
    }

    // 2. Sync Cached LittleFS Logs & Ping Heartbeat
    if (connected) {
      uint32_t now = millis();
      if (now - lastFlushAttempt >= FLUSH_COOLDOWN) {
        lastFlushAttempt = now;
        flushOfflineLogs();
      }
      if (now - lastPing >= PING_INTERVAL) {
        lastPing = now;
        sendHeartbeat();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

// ============================================================================
// 8. SETUP & MAIN LOOP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n========================================================");
  Serial.println("   XERO KEY v7.0 DUAL-CORE MASTER-KEY MATRIX BOOTING... ");
  Serial.println("   [13 Fixed Master UIDs + Monotonic Sequence Sync]     ");
  Serial.println("========================================================");

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);
  pinMode(PIN_BUZZER,    OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Initialize I2C & MCP23017 Relay Expander
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
  if (mcp.begin_I2C(MCP_ADDR, &Wire)) {
    mcpConnected = true;
    for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
      mcp.pinMode(i, OUTPUT);
      mcp.digitalWrite(i, HIGH); // Active-LOW relays OFF
    }
    Serial.println("[INIT] MCP23017 Relay Expander Connected (0x20).");
  } else {
    Serial.println("[WARN] MCP23017 Not Detected! Running in standalone mode.");
  }

  // Initialize SPI & RC522 RFID
  SPI.begin(18, 19, 23, PIN_RFID_SS);
  rfid.PCD_Init();
  byte v = rfid.PCD_ReadRegister(rfid.VersionReg);
  Serial.printf("[INIT] RC522 Firmware Version: 0x%02X ", v);
  if (v == 0x00 || v == 0xFF) {
    Serial.println("-> WARNING: Communication failure! Check wiring.");
  } else {
    Serial.println("-> READY!");
  }

  // Initialize Storage & Sequence Counter
  LittleFS.begin(true);
  prefs.begin("seq_tracker", false);
  currentSeq = prefs.getUInt("seq", 0);
  prefs.end();
  Serial.printf("[INIT] Current Persistent Hardware Sequence: #%u\n", currentSeq);

  loadStateFromNVS();
  syncStatusLeds();

  // Configure NTP Time Sync
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  // Initialize WiFiMulti
  WiFi.mode(WIFI_STA);
  for (const auto& net : WIFI_NETWORKS) {
    wifiMulti.addAP(net.ssid, net.pass);
  }

  // Create Inter-Core Queue & Launch Dual-Core Tasks
  txQueue = xQueueCreate(48, sizeof(TxEvent));

  xTaskCreatePinnedToCore(core1HardwareTask, "Core1_HW",  4096, NULL, configMAX_PRIORITIES - 1, NULL, 1);
  xTaskCreatePinnedToCore(core0NetworkTask,  "Core0_Net", 8192, NULL, 1,                        NULL, 0);
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}
