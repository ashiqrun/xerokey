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
#include <esp_task_wdt.h> // Watchdog Timer Library

// NVS Thread-Safety Mutex (Preferences is NOT thread-safe across cores)
SemaphoreHandle_t nvsMutex = NULL;

// 1. NETWORK & API CONFIGURATION

#define USE_LOCAL_SERVER

#ifdef USE_LOCAL_SERVER
  // Mac Local IP (IPv4)
  #define API_HOST "http://192.168.0.106:3000"
#else
  // Production Cloud URL
  #define API_HOST "https://xerokey.run"
#endif

#define API_MAIN_ENDPOINT API_HOST "/api/esp32"
#define API_PING_ENDPOINT API_HOST "/api/esp32/ping"
#define API_KEY           "xk_live_f4faea8cb68850525634ab1b214c8dd73104ad7b6aea16a5"

struct WifiCred { const char* ssid; const char* pass; };
const WifiCred WIFI_NETWORKS[] = {
  {"X",   "Run.5080"},
  {"ashiqrun", "Run.5080"}
};

// 2. HARDWARE PINS & CONSTANTS

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

#define WDT_TIMEOUT    15 // 15 Seconds Hardware Watchdog Timeout

// 3. 13 FIXED MASTER KEYS CONFIGURATION

const char* const MASTER_UID_ALL = "A1:B9:80:66";

const char* const MASTER_UID_LOCKERS[NUM_LOCKERS] = {
  "04:01:00:00:00:00:01", "04:02:00:00:00:00:02", "04:03:00:00:00:00:03",
  "04:04:00:00:00:00:04", "04:05:00:00:00:00:05", "04:06:00:00:00:00:06",
  "04:07:00:00:00:00:07", "04:08:00:00:00:00:08", "04:09:00:00:00:00:09",
  "04:10:00:00:00:00:10", "04:11:00:00:00:00:11", "04:12:00:00:00:00:12"
};

struct TxEvent {
  uint32_t seq;
  uint32_t timestamp;
  char uid[32];
  uint8_t lockerNum;
  char action[16];
  char forcedBy[20];
};

MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Adafruit_MCP23X17 mcp;
Preferences prefs;
WiFiMulti wifiMulti;
QueueHandle_t txQueue;

bool mcpConnected = false;
volatile bool lockerOccupied[NUM_LOCKERS] = {false};
char lockerOwnerUid[NUM_LOCKERS][32] = {{0}};

volatile uint32_t currentSeq = 0;
volatile uint32_t lastServerSyncedSeq = 0;

volatile uint32_t relayOffAt[NUM_LOCKERS] = {0};
volatile uint32_t buzzTimer = 0;
volatile uint16_t buzzInterval = 0;
volatile uint8_t  buzzEdgesLeft = 0;
volatile bool     buzzSyncRedLed = false;
volatile uint32_t lastScanTime = 0;
uint32_t lastRfidCheck = 0; // RC522 health check timer

// 4. CORE 1 HELPERS (Zero Blocking, Local NVS & Hardware Control)

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
    mcp.digitalWrite(index, LOW);
  }
  relayOffAt[index] = millis() + RELAY_PULSE_MS;
}

void saveSlotToNVS(uint8_t index) {
  if (xSemaphoreTake(nvsMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    prefs.begin("lockers", false);
    char key[8];
    snprintf(key, sizeof(key), "u%02d", index);
    if (lockerOccupied[index]) {
      prefs.putString(key, lockerOwnerUid[index]);
    } else {
      prefs.remove(key);
    }
    prefs.end();
    xSemaphoreGive(nvsMutex);
  }
}

void loadStateFromNVS() {
  if (xSemaphoreTake(nvsMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
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
    xSemaphoreGive(nvsMutex);
  }
}

uint32_t getNextSequence() {
  uint32_t seq = 0;
  if (xSemaphoreTake(nvsMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    prefs.begin("seq_tracker", false);
    currentSeq = prefs.getUInt("seq", 0) + 1;
    prefs.putUInt("seq", currentSeq);
    prefs.end();
    seq = currentSeq;
    xSemaphoreGive(nvsMutex);
  }
  return seq;
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
  for (uint16_t i = 0; a[i] && ja < 35 && i < 64; i++) {
    if (a[i] != ':' && a[i] != ' ' && a[i] != '-') ca[ja++] = toupper((unsigned char)a[i]);
  }
  ca[ja] = '\0';
  for (uint16_t i = 0; b[i] && jb < 35 && i < 64; i++) {
    if (b[i] != ':' && b[i] != ' ' && b[i] != '-') cb[jb++] = toupper((unsigned char)b[i]);
  }
  cb[jb] = '\0';
  return strcmp(ca, cb) == 0;
}

// 5. MASTER KEY SEQUENTIAL & INDIVIDUAL ACTIONS

void executeGrandMasterOpen(const char* cardUid) {
  Serial.println("\n========================================================");
  Serial.println("  GRAND MASTER CARD DETECTED! ");
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

  for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
    esp_task_wdt_reset(); // Prevent WDT timeout during sequential unlock
    pulseLocker(i);
    lockerOccupied[i] = false;
    lockerOwnerUid[i][0] = '\0';
    saveSlotToNVS(i);

    digitalWrite(PIN_BUZZER, HIGH);
    vTaskDelay(pdMS_TO_TICKS(70));
    digitalWrite(PIN_BUZZER, LOW);
    vTaskDelay(pdMS_TO_TICKS(600));
  }
  syncStatusLeds();
  triggerFeedback(2, 120, false);
}

void executeIndividualMasterOpen(uint8_t lockerIdx, const char* cardUid) {
  uint8_t bayNumber = lockerIdx + 1;
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

  lockerOccupied[lockerIdx] = false;
  lockerOwnerUid[lockerIdx][0] = '\0';
  saveSlotToNVS(lockerIdx);

  pulseLocker(lockerIdx);
  syncStatusLeds();
  triggerFeedback(2, 100, false);
}

// 6. CORE 1 TASK: Hardware & Real-Time Logic (0ms Network Wait)

void core1HardwareTask(void* pvParameters) {
  esp_task_wdt_add(NULL); // Subscribe this task to Watchdog Timer
  Serial.println("[CORE 1] Hardware Task Started.");

  for (;;) {
    esp_task_wdt_reset(); // Kick the dog
    uint32_t now = millis();

    for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
      if (relayOffAt[i] && (int32_t)(now - relayOffAt[i]) >= 0) {
        if (mcpConnected) mcp.digitalWrite(i, HIGH);
        relayOffAt[i] = 0;
      }
    }

    if (buzzEdgesLeft > 0 && (now - buzzTimer >= buzzInterval)) {
      buzzTimer = now;
      buzzEdgesLeft--;
      bool level = (buzzEdgesLeft % 2 == 1);
      digitalWrite(PIN_BUZZER, level ? HIGH : LOW);
      if (buzzSyncRedLed) digitalWrite(PIN_LED_RED, level ? HIGH : LOW);
      if (buzzEdgesLeft == 0) syncStatusLeds();
    }

    // RC522 Health Check — re-init if SPI communication lost (every 30s)
    if (now - lastRfidCheck >= 30000) {
      lastRfidCheck = now;
      byte ver = rfid.PCD_ReadRegister(rfid.VersionReg);
      if (ver == 0x00 || ver == 0xFF) {
        Serial.println("[WARN] RC522 SPI failure detected! Re-initializing...");
        rfid.PCD_Init();
        vTaskDelay(pdMS_TO_TICKS(50));
      }
    }

    if ((now - lastScanTime > 800) && rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      lastScanTime = now;

      char scannedUid[32] = {0};
      for (byte b = 0; b < rfid.uid.size && b < 10; b++) {
        char byteBuf[6];
        snprintf(byteBuf, sizeof(byteBuf), "%s%02X", (b > 0 ? ":" : ""), rfid.uid.uidByte[b]);
        strlcat(scannedUid, byteBuf, sizeof(scannedUid));
      }

      Serial.printf("[NFC SCAN] Card UID: %s (Length: %d bytes)\n", scannedUid, rfid.uid.size);

      // --- 1. Master Keys Check: Can be 7-byte or 4-byte ---
      if (uidEquals(scannedUid, MASTER_UID_ALL)) {
        executeGrandMasterOpen(scannedUid);
      }
      else {
        int8_t matchedMasterBay = -1;
        for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
          if (uidEquals(scannedUid, MASTER_UID_LOCKERS[i])) {
            matchedMasterBay = i; break;
          }
        }

        if (matchedMasterBay != -1) {
          executeIndividualMasterOpen(matchedMasterBay, scannedUid);
        }
        else {
          // --- 2. Regular User NFC: STRICT 7-BYTE UID RESTRICTION ---
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
                existingIdx = i; break;
              }
              if (!lockerOccupied[i] && firstEmptyIdx == -1) firstEmptyIdx = i;
            }

            if (existingIdx != -1) {
              // Action A: User Check-Out
              lockerOccupied[existingIdx] = false;
              lockerOwnerUid[existingIdx][0] = '\0';
              saveSlotToNVS(existingIdx);
              pulseLocker(existingIdx);
              syncStatusLeds();
              triggerSuccessBeep();

              Serial.printf("[ACTION] USER CHECK-OUT -> Locker L-%02d Unlocked!\n", existingIdx + 1);

              TxEvent ev;
              ev.seq = getNextSequence();
              ev.timestamp = getEpochTime();
              strlcpy(ev.uid, scannedUid, sizeof(ev.uid));
              ev.lockerNum = existingIdx + 1;
              strlcpy(ev.action, "checkout", sizeof(ev.action));
              ev.forcedBy[0] = '\0';
              xQueueSend(txQueue, &ev, 0);

            } else if (firstEmptyIdx != -1) {
              // Action B: User Check-In
              lockerOccupied[firstEmptyIdx] = true;
              strlcpy(lockerOwnerUid[firstEmptyIdx], scannedUid, sizeof(lockerOwnerUid[firstEmptyIdx]));
              saveSlotToNVS(firstEmptyIdx);
              pulseLocker(firstEmptyIdx);
              syncStatusLeds();
              triggerSuccessBeep();

              Serial.printf("[ACTION] USER CHECK-IN -> Assigned Locker L-%02d!\n", firstEmptyIdx + 1);

              TxEvent ev;
              ev.seq = getNextSequence();
              ev.timestamp = getEpochTime();
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

// 7. CORE 0: Background Wi-Fi, API Sync, LittleFS & Sequence Protection

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
  if (code >= 200 && code < 300) {
    String responseStr = http.getString();
    int idx = responseStr.indexOf("\"lastSyncedSeq\":");
    if (idx > 0) {
      uint32_t sSeq = (uint32_t)responseStr.substring(idx + 16).toInt();
      if (sSeq > lastServerSyncedSeq) lastServerSyncedSeq = sSeq;
    }
  }
  http.end();
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
    f.printf("%u,%u,%s,%u,%s,%s\n", ev.seq, ev.timestamp, ev.uid, ev.lockerNum, ev.action, ev.forcedBy);
    f.close();
  }
}

void flushOfflineLogs() {
  if (!LittleFS.exists(LOG_FILE_PATH) || wifiMulti.run() != WL_CONNECTED) return;

  File f = LittleFS.open(LOG_FILE_PATH, "r");
  if (!f) return;

  // Use a temp file to store unsent lines (avoids heap-killing String accumulation)
  const char* TMP_PATH = "/offline_tmp.csv";
  File tmp = LittleFS.open(TMP_PATH, "w");
  bool hasFailed = false;
  bool hasRemaining = false;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    // If a previous POST failed, write all remaining lines to temp file directly
    if (hasFailed) {
      if (tmp) { tmp.println(line); hasRemaining = true; }
      continue;
    }

    int p1 = line.indexOf(','); int p2 = line.indexOf(',', p1 + 1);
    int p3 = line.indexOf(',', p2 + 1); int p4 = line.indexOf(',', p3 + 1);
    int p5 = line.indexOf(',', p4 + 1);

    if (p1 > 0 && p2 > p1 && p3 > p2 && p4 > p3) {
      uint32_t seq = (uint32_t)line.substring(0, p1).toInt();
      uint32_t ts  = (uint32_t)line.substring(p1 + 1, p2).toInt();
      String uid   = line.substring(p2 + 1, p3);
      uint8_t lkr  = (uint8_t)line.substring(p3 + 1, p4).toInt();
      String act   = (p5 > p4) ? line.substring(p4 + 1, p5) : line.substring(p4 + 1);
      String frc   = (p5 > p4) ? line.substring(p5 + 1) : "";

      if (seq <= lastServerSyncedSeq) continue;

      TxEvent ev;
      ev.seq = seq; ev.timestamp = ts; ev.lockerNum = lkr;
      strlcpy(ev.uid, uid.c_str(), sizeof(ev.uid));
      strlcpy(ev.action, act.c_str(), sizeof(ev.action));
      strlcpy(ev.forcedBy, frc.c_str(), sizeof(ev.forcedBy));

      if (!postTransaction(ev)) {
        hasFailed = true;
        if (tmp) { tmp.println(line); hasRemaining = true; }
      } else {
        if (seq > lastServerSyncedSeq) lastServerSyncedSeq = seq;
      }
    }
  }
  f.close();
  if (tmp) tmp.close();

  if (!hasRemaining) {
    LittleFS.remove(LOG_FILE_PATH);
    LittleFS.remove(TMP_PATH);
  } else {
    LittleFS.remove(LOG_FILE_PATH);
    LittleFS.rename(TMP_PATH, LOG_FILE_PATH);
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
    int idxSeq = payload.indexOf("\"lastSyncedSeq\":");
    if (idxSeq > 0) {
      uint32_t sSeq = (uint32_t)payload.substring(idxSeq + 16).toInt();
      if (sSeq > lastServerSyncedSeq) lastServerSyncedSeq = sSeq;
    }
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
}

void core0NetworkTask(void* pvParameters) {
  esp_task_wdt_add(NULL); // Subscribe this task to Watchdog Timer
  uint32_t lastPing = 0;
  uint32_t lastFlushAttempt = 0;
  TxEvent ev;

  for (;;) {
    esp_task_wdt_reset(); // Kick the dog
    bool connected = (wifiMulti.run(2000) == WL_CONNECTED);

    while (xQueueReceive(txQueue, &ev, pdMS_TO_TICKS(50)) == pdPASS) {
      if (!connected || !postTransaction(ev)) {
        appendOfflineLog(ev);
      } else {
        if (ev.seq > lastServerSyncedSeq) lastServerSyncedSeq = ev.seq;
      }
    }

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

// 8. SETUP & MAIN LOOP

void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize Hardware Watchdog Timer (Panic on timeout)
  // Initialize Hardware Watchdog Timer (ESP32 Core 3.x update)
  esp_task_wdt_config_t wdt_config;
  wdt_config.timeout_ms = WDT_TIMEOUT * 1000; // Convert seconds to milliseconds
  wdt_config.idle_core_mask = (1 << portNUM_PROCESSORS) - 1; // Monitor all cores
  wdt_config.trigger_panic = true; // Restart ESP32 if frozen
  
  esp_task_wdt_init(&wdt_config);
  
  esp_task_wdt_add(NULL); // Subscribe main setup/loop task

  // Create NVS mutex for thread-safe Preferences access across cores
  nvsMutex = xSemaphoreCreateMutex();

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);
  pinMode(PIN_BUZZER,    OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
  if (mcp.begin_I2C(MCP_ADDR, &Wire)) {
    mcpConnected = true;
    for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
      mcp.pinMode(i, OUTPUT);
      mcp.digitalWrite(i, HIGH);
    }
  } 

  SPI.begin(18, 19, 23, PIN_RFID_SS);
  rfid.PCD_Init();

  LittleFS.begin(true);
  if (xSemaphoreTake(nvsMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
    prefs.begin("seq_tracker", false);
    currentSeq = prefs.getUInt("seq", 0);
    prefs.end();
    xSemaphoreGive(nvsMutex);
  }

  loadStateFromNVS();
  syncStatusLeds();

  configTime(0, 0, "pool.ntp.org", "time.google.com");

  WiFi.mode(WIFI_STA);
  for (const auto& net : WIFI_NETWORKS) {
    wifiMulti.addAP(net.ssid, net.pass);
  }

  txQueue = xQueueCreate(48, sizeof(TxEvent));
  xTaskCreatePinnedToCore(core1HardwareTask, "Core1_HW",  8192, NULL, configMAX_PRIORITIES - 1, NULL, 1);
  xTaskCreatePinnedToCore(core0NetworkTask,  "Core0_Net", 8192, NULL, 1,                        NULL, 0);
}

void loop() {
  static uint32_t lastMemCheck = 0;
  uint32_t now = millis();

  esp_task_wdt_reset(); // Keep Watchdog happy for main loop

  // Stress Testing Memory Logger (Runs every 1 minute)
  if (now - lastMemCheck >= 60000) {
    lastMemCheck = now;
    uint32_t freeHeap = esp_get_free_heap_size();
    uint32_t minFreeHeap = esp_get_minimum_free_heap_size();
    uint32_t uptimeMins = now / 60000;

    Serial.printf("\n[STRESS TEST] Uptime: %lu min | Free Heap: %lu B | Min Free: %lu B\n",
                  uptimeMins, freeHeap, minFreeHeap);
  }

  vTaskDelay(pdMS_TO_TICKS(1000));
}