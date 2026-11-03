#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <Adafruit_MCP23X17.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <time.h>
#include <sys/time.h>
#include <esp_task_wdt.h> // Watchdog Timer Library

// Mutex Locks for Thread Safety Across ESP32 Dual Cores
SemaphoreHandle_t nvsMutex = NULL;  // Preferences NVS Mutex
SemaphoreHandle_t i2cMutex = NULL;  // I2C Bus Mutex (protects shared Wire between MCP23017 and DS3231)

// 1. NETWORK & API CONFIGURATION

// Primary Cloud Production Server (Domain Server - Always contacted primarily)
#define PRIMARY_API_HOST    "https://www.xerokey.run"

// Secondary Local Development Fallback Server (Only contacted if domain server is unreachable)
#define SECONDARY_API_HOST  "http://192.168.0.106:3000"

#define API_KEY             "xk_live_f4faea8cb68850525634ab1b214c8dd73104ad7b6aea16a5"

struct WifiCred { const char* ssid; const char* pass; };
const WifiCred WIFI_NETWORKS[] = {
  {"DIU_Daffodil Smart City",   "diu123456789"},
  {"X", "Run.5080"},
  {"ashiqrun", "Run.5080"}
};

// 2. HARDWARE PINS & CONSTANTS

#define PIN_RFID_SS      5   // D5
#define PIN_RFID_RST     4   // D4
#define PIN_I2C_SDA      21  // D21
#define PIN_I2C_SCL      22  // D22
#define MCP_ADDR         0x20
#define DS3231_I2C_ADDR  0x68 // DS3231 High-Precision Real-Time Clock I2C Address

#define PIN_LED_GREEN    25  // D25
#define PIN_LED_RED      27  // D27
#define PIN_BUZZER       13  // D13 (Safe boot GPIO)

#ifndef LED_BUILTIN
  #define PIN_LED_BUILTIN 2   // Onboard LED on most ESP32 Dev Kits (GPIO 2)
#else
  #define PIN_LED_BUILTIN LED_BUILTIN
#endif

#define NUM_LOCKERS      12
#define RELAY_PULSE_MS   1500UL
#define PING_INTERVAL    15000UL
#define FLUSH_COOLDOWN   10000UL // 10s guard to prevent server log spamming
#define MAX_LOG_BYTES    512000UL
#define LOG_FILE_PATH    "/offline_logs.csv"

#define WDT_TIMEOUT      15 // 15 Seconds Hardware Watchdog Timeout

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
bool ds3231Connected = false;
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

// 4. DS3231 HARDWARE REAL-TIME CLOCK DRIVER (Offline Accuracy)

static inline uint8_t bcd2dec(uint8_t val) {
  return ((val / 16 * 10) + (val % 16));
}

static inline uint8_t dec2bcd(uint8_t val) {
  return ((val / 10 * 16) + (val % 10));
}

bool ds3231_init() {
  if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(100)) != pdTRUE) {
    return false;
  }

  Wire.beginTransmission(DS3231_I2C_ADDR);
  if (Wire.endTransmission() != 0) {
    if (i2cMutex) xSemaphoreGive(i2cMutex);
    ds3231Connected = false;
    Serial.println("[RTC ERROR] DS3231 RTC not detected at I2C address 0x68!");
    return false;
  }

  // Check Status Register (0x0F) for OSF (Oscillator Stop Flag)
  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x0F);
  if (Wire.endTransmission() == 0) {
    Wire.requestFrom((uint8_t)DS3231_I2C_ADDR, (uint8_t)1);
    if (Wire.available()) {
      uint8_t status = Wire.read();
      if (status & 0x80) {
        Serial.println("[RTC WARNING] DS3231 oscillator was stopped (power loss). Time will be synced when connected.");
        // Clear OSF bit
        Wire.beginTransmission(DS3231_I2C_ADDR);
        Wire.write(0x0F);
        Wire.write(status & ~0x80);
        Wire.endTransmission();
      }
    }
  }

  // Control Register (0x0E): Enable oscillator (clear bit 7 EOSC)
  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x0E);
  Wire.write(0x00);
  Wire.endTransmission();

  if (i2cMutex) xSemaphoreGive(i2cMutex);

  ds3231Connected = true;
  Serial.println("[RTC SUCCESS] DS3231 Hardware Real-Time Clock online!");
  return true;
}

uint32_t ds3231_getEpoch() {
  if (!ds3231Connected) return 0;

  if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(100)) != pdTRUE) {
    return 0;
  }

  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x00); // Start at register 00 (seconds)
  if (Wire.endTransmission() != 0) {
    if (i2cMutex) xSemaphoreGive(i2cMutex);
    return 0;
  }

  uint8_t bytesRead = Wire.requestFrom((uint8_t)DS3231_I2C_ADDR, (uint8_t)7);
  if (bytesRead < 7) {
    if (i2cMutex) xSemaphoreGive(i2cMutex);
    return 0;
  }

  uint8_t rawSec  = Wire.read();
  uint8_t rawMin  = Wire.read();
  uint8_t rawHour = Wire.read();
  Wire.read(); // Day of week (unused)
  uint8_t rawDate = Wire.read();
  uint8_t rawMon  = Wire.read();
  uint8_t rawYear = Wire.read();

  if (i2cMutex) xSemaphoreGive(i2cMutex);

  uint8_t sec  = bcd2dec(rawSec & 0x7F);
  uint8_t min  = bcd2dec(rawMin & 0x7F);
  uint8_t hour = bcd2dec(rawHour & 0x3F); // 24-hour mode
  uint8_t date = bcd2dec(rawDate & 0x3F);
  uint8_t mon  = bcd2dec(rawMon & 0x1F);
  uint16_t year = 2000 + bcd2dec(rawYear);

  if (mon < 1 || mon > 12 || date < 1 || date > 31 || hour > 23 || min > 59 || sec > 59) {
    return 0;
  }

  struct tm t;
  memset(&t, 0, sizeof(struct tm));
  t.tm_sec  = sec;
  t.tm_min  = min;
  t.tm_hour = hour;
  t.tm_mday = date;
  t.tm_mon  = mon - 1;     // Months 0-11
  t.tm_year = year - 1900; // Years since 1900
  t.tm_isdst = 0;

  time_t epoch = mktime(&t);
  return (epoch > 0) ? (uint32_t)epoch : 0;
}

bool ds3231_setEpoch(uint32_t epoch) {
  if (epoch < 1700000000) return false;

  time_t tSec = (time_t)epoch;
  struct tm t;
  gmtime_r(&tSec, &t);

  uint8_t sec  = dec2bcd(t.tm_sec);
  uint8_t min  = dec2bcd(t.tm_min);
  uint8_t hour = dec2bcd(t.tm_hour); // 24-hour mode (bit 6 = 0)
  uint8_t dow  = dec2bcd(t.tm_wday + 1);
  uint8_t date = dec2bcd(t.tm_mday);
  uint8_t mon  = dec2bcd(t.tm_mon + 1);
  uint8_t year = dec2bcd(t.tm_year + 1900 - 2000);

  if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(100)) != pdTRUE) {
    return false;
  }

  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x00);
  Wire.write(sec);
  Wire.write(min);
  Wire.write(hour);
  Wire.write(dow);
  Wire.write(date);
  Wire.write(mon);
  Wire.write(year);
  uint8_t err = Wire.endTransmission();

  // Clear OSF in status register (0x0F)
  Wire.beginTransmission(DS3231_I2C_ADDR);
  Wire.write(0x0F);
  Wire.write(0x00);
  Wire.endTransmission();

  if (i2cMutex) xSemaphoreGive(i2cMutex);

  if (err == 0) {
    ds3231Connected = true;
    Serial.printf("[RTC SYNC] DS3231 hardware RTC calibrated to epoch: %u\n", epoch);
    return true;
  }
  return false;
}

// 5. CORE 1 HELPERS (Zero Blocking, Local NVS & Hardware Control)

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
    if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      mcp.digitalWrite(index, LOW);
      xSemaphoreGive(i2cMutex);
    }
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
  // 1. Check ESP32 internal POSIX system clock (seeded from DS3231 or NTP)
  time_t now;
  time(&now);
  if (now > 1700000000) {
    return (uint32_t)now;
  }

  // 2. Offline Fallback: Read directly from DS3231 hardware RTC
  if (ds3231Connected) {
    uint32_t rtcEpoch = ds3231_getEpoch();
    if (rtcEpoch > 1700000000) {
      struct timeval tv = { (time_t)rtcEpoch, 0 };
      settimeofday(&tv, NULL);
      return rtcEpoch;
    }
  }

  // 3. Absolute Fallback (only if RTC uninitialized and no network)
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

// 6. MASTER KEY SEQUENTIAL & INDIVIDUAL ACTIONS

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

// 7. CORE 1 TASK: Hardware & Real-Time Logic (0ms Network Wait)

void core1HardwareTask(void* pvParameters) {
  esp_task_wdt_add(NULL); // Subscribe this task to Watchdog Timer
  Serial.println("[CORE 1] Hardware Task Started.");

  for (;;) {
    esp_task_wdt_reset(); // Kick the dog
    uint32_t now = millis();

    for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
      if (relayOffAt[i] && (int32_t)(now - relayOffAt[i]) >= 0) {
        if (mcpConnected) {
          if (i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            mcp.digitalWrite(i, HIGH);
            xSemaphoreGive(i2cMutex);
          }
        }
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

    // Built-in LED Wi-Fi Status: Solid ON when connected, Blink (250ms interval) while connecting/disconnected
    static uint32_t lastWifiLedBlink = 0;
    static bool wifiLedState = false;
    static bool prevConnected = false;
    bool isWifiConnected = (WiFi.status() == WL_CONNECTED);

    if (isWifiConnected) {
      if (!prevConnected) {
        prevConnected = true;
        wifiLedState = true;
        digitalWrite(PIN_LED_BUILTIN, HIGH);
      }
    } else {
      prevConnected = false;
      if (now - lastWifiLedBlink >= 250) {
        lastWifiLedBlink = now;
        wifiLedState = !wifiLedState;
        digitalWrite(PIN_LED_BUILTIN, wifiLedState ? HIGH : LOW);
      }
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

// 8. CORE 0: Background Wi-Fi, API Sync, LittleFS & Sequence Protection

/**
 * Executes an HTTP or HTTPS request with automatic TLS support and redirect following.
 * Works seamlessly with both cloud HTTPS (Vercel) and local HTTP development servers.
 */
bool executeHttpRequest(const char* host, const char* endpointPath, const char* method, const char* payload, String& responseOut, int& statusCodeOut) {
  if (!host || strlen(host) == 0) return false;
  String fullUrl = String(host) + endpointPath;
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(4500);

  int code = -1;
  if (fullUrl.startsWith("https://")) {
    WiFiClientSecure secureClient;
    secureClient.setInsecure(); // Bypass cert chain validation for Let's Encrypt / Vercel SSL
    secureClient.setTimeout(5);
    if (!http.begin(secureClient, fullUrl)) {
      Serial.printf("[HTTP ERROR] Failed to begin HTTPS connection to: %s\n", fullUrl.c_str());
      return false;
    }
    http.addHeader("x-api-key", API_KEY);
    if (payload && strlen(payload) > 0) {
      http.addHeader("Content-Type", "application/json");
      code = http.POST((uint8_t*)payload, strlen(payload));
    } else {
      code = http.GET();
    }
    statusCodeOut = code;
    if (code >= 200 && code < 300) {
      responseOut = http.getString();
    }
    http.end();
  } else {
    WiFiClient plainClient;
    plainClient.setTimeout(4);
    if (!http.begin(plainClient, fullUrl)) {
      Serial.printf("[HTTP ERROR] Failed to begin HTTP connection to: %s\n", fullUrl.c_str());
      return false;
    }
    http.addHeader("x-api-key", API_KEY);
    if (payload && strlen(payload) > 0) {
      http.addHeader("Content-Type", "application/json");
      code = http.POST((uint8_t*)payload, strlen(payload));
    } else {
      code = http.GET();
    }
    statusCodeOut = code;
    if (code >= 200 && code < 300) {
      responseOut = http.getString();
    }
    http.end();
  }

  return (code >= 200 && code < 300);
}

bool postTransaction(const TxEvent& ev) {
  if (wifiMulti.run() != WL_CONNECTED) return false;

  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"seq\":%u,\"timestamp\":%u,\"uid\":\"%s\",\"lockerNumber\":%u,\"action\":\"%s\",\"forcedBy\":\"%s\"}",
           ev.seq, ev.timestamp, ev.uid, ev.lockerNum, ev.action, ev.forcedBy);

  String responseStr;
  int code = -1;

  // 1. Primary Attempt: Send to Cloud Domain Server (https://www.xerokey.run)
  bool success = executeHttpRequest(PRIMARY_API_HOST, "/api/esp32", "POST", payload, responseStr, code);

  // 2. Fallback Attempt: If Cloud Domain Server fails and Local Server is configured, try Local Server
  #ifdef SECONDARY_API_HOST
  if (!success) {
    Serial.printf("[NET] Primary domain server unreachable (HTTP %d). Attempting secondary local server...\n", code);
    success = executeHttpRequest(SECONDARY_API_HOST, "/api/esp32", "POST", payload, responseStr, code);
  }
  #endif

  if (success) {
    Serial.printf("[NET SUCCESS] Transaction seq #%u posted successfully! (HTTP %d)\n", ev.seq, code);
    int idx = responseStr.indexOf("\"lastSyncedSeq\":");
    if (idx > 0) {
      uint32_t sSeq = (uint32_t)responseStr.substring(idx + 16).toInt();
      if (sSeq > lastServerSyncedSeq) lastServerSyncedSeq = sSeq;
    }
  } else {
    Serial.printf("[NET FAIL] Could not post transaction seq #%u to any server (last HTTP: %d). Queuing offline.\n", ev.seq, code);
  }

  return success;
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

  const char* TMP_PATH = "/offline_tmp.csv";
  File tmp = LittleFS.open(TMP_PATH, "w");
  bool hasFailed = false;
  bool hasRemaining = false;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

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

  String payload;
  int code = -1;

  // 1. Primary Attempt: Ping Cloud Domain Server (https://www.xerokey.run)
  bool success = executeHttpRequest(PRIMARY_API_HOST, "/api/esp32/ping", "GET", NULL, payload, code);

  // 2. Fallback Attempt: If Cloud Domain Server fails, try Secondary Local Server
  #ifdef SECONDARY_API_HOST
  if (!success) {
    Serial.printf("[PING] Primary domain server ping unreachable (HTTP %d). Trying secondary local server...\n", code);
    success = executeHttpRequest(SECONDARY_API_HOST, "/api/esp32/ping", "GET", NULL, payload, code);
  }
  #endif

  if (success) {
    Serial.printf("[PING OK] Heartbeat acknowledged by server (HTTP %d)\n", code);
    int idxSeq = payload.indexOf("\"lastSyncedSeq\":");
    if (idxSeq > 0) {
      uint32_t sSeq = (uint32_t)payload.substring(idxSeq + 16).toInt();
      if (sSeq > lastServerSyncedSeq) lastServerSyncedSeq = sSeq;
    }
    int idxTime = payload.indexOf("\"serverTime\":");
    if (idxTime > 0) {
      time_t sTime = (time_t)payload.substring(idxTime + 13).toInt();
      if (sTime > 1700000000) {
        // 1. Update ESP32 internal POSIX system time
        struct timeval tv = { sTime, 0 };
        settimeofday(&tv, NULL);

        // 2. Discipline & synchronize the DS3231 Hardware Real-Time Clock
        if (ds3231Connected) {
          ds3231_setEpoch((uint32_t)sTime);
        }
      }
    }
  } else {
    Serial.printf("[PING FAILED] Domain and local servers unreachable (last HTTP code: %d)\n", code);
  }
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

// 9. SETUP & MAIN LOOP

void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize Hardware Watchdog Timer (Panic on timeout)
  esp_task_wdt_config_t wdt_config;
  wdt_config.timeout_ms = WDT_TIMEOUT * 1000;
  wdt_config.idle_core_mask = (1 << portNUM_PROCESSORS) - 1;
  wdt_config.trigger_panic = true;
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);

  // Create Dual-Core Mutexes
  nvsMutex = xSemaphoreCreateMutex();
  i2cMutex = xSemaphoreCreateMutex();

  pinMode(PIN_LED_BUILTIN, OUTPUT);
  digitalWrite(PIN_LED_BUILTIN, LOW);
  pinMode(PIN_LED_GREEN,   OUTPUT);
  pinMode(PIN_LED_RED,     OUTPUT);
  pinMode(PIN_BUZZER,      OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Initialize I2C Bus for MCP23017 and DS3231 RTC
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);

  // Initialize DS3231 Real-Time Clock
  ds3231_init();
  if (ds3231Connected) {
    uint32_t rtcEpoch = ds3231_getEpoch();
    if (rtcEpoch > 1700000000) {
      struct timeval tv = { (time_t)rtcEpoch, 0 };
      settimeofday(&tv, NULL);
      Serial.printf("[RTC BOOT] System clock initialized from DS3231 RTC offline! Current Epoch: %u\n", rtcEpoch);
    } else {
      Serial.println("[RTC BOOT WARNING] DS3231 time uninitialized. Will calibrate automatically upon server connection.");
    }
  }

  // Initialize MCP23017 Relay Controller
  if (mcp.begin_I2C(MCP_ADDR, &Wire)) {
    mcpConnected = true;
    for (uint8_t i = 0; i < NUM_LOCKERS; i++) {
      mcp.pinMode(i, OUTPUT);
      mcp.digitalWrite(i, HIGH);
    }
    Serial.println("[MCP23017] 12-relay IO expander initialized successfully.");
  } else {
    Serial.println("[MCP23017 ERROR] Failed to find MCP23017 at address 0x20!");
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
