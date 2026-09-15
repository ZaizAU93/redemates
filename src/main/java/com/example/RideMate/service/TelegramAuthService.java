package com.example.RideMate.service;


import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
@Slf4j
public class TelegramAuthService {

    @Value("${telegram.bot-token:}")
    private String botToken;

    @Value("${telegram.auth.max-age-seconds:86400}")
    private long maxAgeSeconds;

    @Value("${app.allow-test-user:false}")
    private boolean allowTestUser;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Проверка Telegram Mini App initData.
     *
     * Схема:
     *
     * 1. Получаем initData
     * 2. Парсим query string
     * 3. Забираем hash
     * 4. Удаляем ТОЛЬКО hash
     * 5. signature оставляем
     * 6. Сортируем параметры
     * 7. Создаем data_check_string
     * 8. Создаем secret key через HMAC-SHA256
     * 9. Считаем итоговый HMAC
     * 10. Сравниваем с hash
     */
    public Long authenticate(String initData) {

        log.info("========== TELEGRAM AUTH START ==========");

        if (initData == null || initData.isBlank()) {

            log.error("Telegram initData is empty");

            throw new SecurityException(
                    "Telegram initData отсутствует"
            );
        }

        if (botToken == null || botToken.isBlank()) {

            log.error("Telegram bot token is empty");

            throw new SecurityException(
                    "Telegram bot token не настроен"
            );
        }

        String cleanBotToken = botToken.trim();

        log.info(
                "initData length: {}",
                initData.length()
        );

        log.info(
                "bot token exists: {}",
                !cleanBotToken.isBlank()
        );

        log.info(
                "bot token length: {}",
                cleanBotToken.length()
        );

        try {

            /*
             * =====================================================
             * 1. PARSE INIT DATA
             * =====================================================
             */

            Map<String, String> params =
                    parseInitData(initData);

            log.info(
                    "parameters count: {}",
                    params.size()
            );

            log.info(
                    "parameters: {}",
                    params.keySet()
            );

            /*
             * =====================================================
             * 2. GET TELEGRAM HASH
             * =====================================================
             */

            String receivedHash =
                    params.get("hash");

            if (receivedHash == null ||
                    receivedHash.isBlank()) {

                log.error(
                        "Telegram hash is missing"
                );

                throw new SecurityException(
                        "В initData отсутствует hash"
                );
            }

            /*
             * ВАЖНО:
             *
             * Удаляем ТОЛЬКО hash.
             *
             * signature НЕ удаляем.
             *
             * Telegram добавляет signature в initData,
             * и она должна участвовать в data_check_string
             * при проверке через bot token.
             */

            params.remove("hash");

            log.info(
                    "parameters after removing hash: {}",
                    params.keySet()
            );

            /*
             * =====================================================
             * 3. AUTH DATE
             * =====================================================
             */

            String authDateString =
                    params.get("auth_date");

            if (authDateString == null ||
                    authDateString.isBlank()) {

                log.error(
                        "auth_date is missing"
                );

                throw new SecurityException(
                        "В initData отсутствует auth_date"
                );
            }

            long authDate;

            try {

                authDate =
                        Long.parseLong(authDateString);

            } catch (NumberFormatException e) {

                log.error(
                        "Invalid auth_date: {}",
                        authDateString
                );

                throw new SecurityException(
                        "Некорректный auth_date"
                );
            }

            long currentTime =
                    Instant.now().getEpochSecond();

            long authAge =
                    currentTime - authDate;

            log.info(
                    "auth_date: {}",
                    authDate
            );

            log.info(
                    "current timestamp: {}",
                    currentTime
            );

            log.info(
                    "auth age seconds: {}",
                    authAge
            );

            log.info(
                    "max age seconds: {}",
                    maxAgeSeconds
            );

            /*
             * Если Telegram прислал дату из будущего.
             */

            if (authAge < -60) {

                log.error(
                        "auth_date is in the future"
                );

                throw new SecurityException(
                        "Некорректная дата Telegram"
                );
            }

            /*
             * Проверяем срок действия.
             */

            if (authAge > maxAgeSeconds) {

                if (!allowTestUser) {

                    log.error(
                            "Telegram initData expired. age={}, maxAge={}",
                            authAge,
                            maxAgeSeconds
                    );

                    throw new SecurityException(
                            "Telegram initData устарел"
                    );
                }

                log.warn(
                        "OLD Telegram initData accepted because " +
                                "app.allow-test-user=true"
                );
            }

            /*
             * =====================================================
             * 4. BUILD DATA CHECK STRING
             * =====================================================
             */

            String dataCheckString =
                    buildDataCheckString(params);

            log.info(
                    "data_check_string:"
            );

            log.info(
                    "\n{}",
                    dataCheckString
            );

            /*
             * =====================================================
             * 5. CREATE TELEGRAM SECRET KEY
             * =====================================================
             *
             * secret_key =
             *
             * HMAC-SHA256(
             *     key  = "WebAppData",
             *     data = botToken
             * )
             *
             * ВАЖНО:
             * результат используем как RAW BYTES.
             * Нельзя сначала переводить его в HEX.
             */

            byte[] secretKeyBytes =
                    hmacSha256(
                            "WebAppData".getBytes(
                                    StandardCharsets.UTF_8
                            ),
                            cleanBotToken.getBytes(
                                    StandardCharsets.UTF_8
                            )
                    );

            /*
             * =====================================================
             * 6. CALCULATE FINAL HASH
             * =====================================================
             */

            byte[] calculatedHashBytes =
                    hmacSha256(
                            secretKeyBytes,
                            dataCheckString.getBytes(
                                    StandardCharsets.UTF_8
                            )
                    );

            String calculatedHash =
                    bytesToHex(
                            calculatedHashBytes
                    );

            /*
             * =====================================================
             * 7. COMPARE HASH
             * =====================================================
             */

            log.info(
                    "Telegram hash:   {}",
                    receivedHash
            );

            log.info(
                    "Calculated hash: {}",
                    calculatedHash
            );

            boolean hashMatches =
                    constantTimeEquals(
                            receivedHash,
                            calculatedHash
                    );

            log.info(
                    "HASH MATCH: {}",
                    hashMatches
            );

            if (!hashMatches) {

                log.error(
                        "Telegram initData signature verification FAILED"
                );

                throw new SecurityException(
                        "Неверная подпись initData"
                );
            }

            /*
             * =====================================================
             * 8. GET USER
             * =====================================================
             */

            String userJson =
                    params.get("user");

            if (userJson == null ||
                    userJson.isBlank()) {

                log.error(
                        "Telegram user is missing"
                );

                throw new SecurityException(
                        "В initData отсутствует пользователь Telegram"
                );
            }

            log.info(
                    "user exists: true"
            );

            JsonNode userNode;

            try {

                userNode =
                        objectMapper.readTree(
                                userJson
                        );

            } catch (Exception e) {

                log.error(
                        "Cannot parse Telegram user JSON",
                        e
                );

                throw new SecurityException(
                        "Некорректные данные пользователя Telegram"
                );
            }

            /*
             * =====================================================
             * 9. GET USER ID
             * =====================================================
             */

            JsonNode idNode =
                    userNode.get("id");

            if (idNode == null ||
                    idNode.isNull()) {

                log.error(
                        "Telegram user id is missing"
                );

                throw new SecurityException(
                        "В данных Telegram отсутствует user id"
                );
            }

            long telegramUserId =
                    idNode.asLong();

            if (telegramUserId <= 0) {

                throw new SecurityException(
                        "Некорректный Telegram user id"
                );
            }

            /*
             * =====================================================
             * 10. USER INFO
             * =====================================================
             */

            String username = "";

            if (userNode.has("username") &&
                    !userNode.get("username").isNull()) {

                username =
                        userNode.get("username").asText();
            }

            String firstName = "";

            if (userNode.has("first_name") &&
                    !userNode.get("first_name").isNull()) {

                firstName =
                        userNode.get("first_name").asText();
            }

            log.info(
                    "Telegram authentication SUCCESS. " +
                            "userId={}, username={}, firstName={}",
                    telegramUserId,
                    username,
                    firstName
            );

            log.info(
                    "========== TELEGRAM AUTH END =========="
            );

            return telegramUserId;

        } catch (SecurityException e) {

            log.error(
                    "Telegram authentication failed: {}",
                    e.getMessage()
            );

            throw e;

        } catch (Exception e) {

            log.error(
                    "Unexpected Telegram authentication error",
                    e
            );

            throw new SecurityException(
                    "Ошибка проверки Telegram initData",
                    e
            );
        }
    }

    /**
     * Парсинг Telegram initData.
     *
     * Используем URLDecoder, чтобы:
     *
     * %7B -> {
     * %22 -> "
     * %D0%90 -> А
     */
    private Map<String, String> parseInitData(
            String initData
    ) {

        Map<String, String> params =
                new TreeMap<>();

        String[] pairs =
                initData.split("&");

        for (String pair : pairs) {

            if (pair == null ||
                    pair.isEmpty()) {

                continue;
            }

            int separatorIndex =
                    pair.indexOf('=');

            if (separatorIndex <= 0) {

                continue;
            }

            String encodedKey =
                    pair.substring(
                            0,
                            separatorIndex
                    );

            String encodedValue =
                    pair.substring(
                            separatorIndex + 1
                    );

            String key =
                    URLDecoder.decode(
                            encodedKey,
                            StandardCharsets.UTF_8
                    );

            String value =
                    URLDecoder.decode(
                            encodedValue,
                            StandardCharsets.UTF_8
                    );

            params.put(
                    key,
                    value
            );
        }

        return params;
    }

    /**
     * Создает data_check_string.
     *
     * Параметры сортируются по имени.
     *
     * Например:
     *
     * auth_date=...
     * chat_instance=...
     * chat_type=...
     * signature=...
     * user=...
     */
    private String buildDataCheckString(
            Map<String, String> params
    ) {

        List<String> lines =
                new ArrayList<>();

        params.entrySet()
                .stream()
                .sorted(
                        Map.Entry.comparingByKey()
                )
                .forEach(entry ->
                        lines.add(
                                entry.getKey()
                                        + "="
                                        + entry.getValue()
                        )
                );

        return String.join(
                "\n",
                lines
        );
    }

    /**
     * HMAC-SHA256.
     *
     * key  = HMAC key
     * data = данные
     */
    private byte[] hmacSha256(
            byte[] key,
            byte[] data
    ) throws Exception {

        Mac mac =
                Mac.getInstance(
                        "HmacSHA256"
                );

        SecretKeySpec secretKey =
                new SecretKeySpec(
                        key,
                        "HmacSHA256"
                );

        mac.init(secretKey);

        return mac.doFinal(data);
    }

    /**
     * byte[] -> HEX.
     */
    private String bytesToHex(
            byte[] bytes
    ) {

        StringBuilder result =
                new StringBuilder(
                        bytes.length * 2
                );

        for (byte b : bytes) {

            result.append(
                    String.format(
                            "%02x",
                            b & 0xff
                    )
            );
        }

        return result.toString();
    }

    /**
     * Constant-time comparison.
     */
    private boolean constantTimeEquals(
            String expected,
            String actual
    ) {

        if (expected == null ||
                actual == null) {

            return false;
        }

        byte[] expectedBytes =
                expected
                        .trim()
                        .toLowerCase()
                        .getBytes(
                                StandardCharsets.UTF_8
                        );

        byte[] actualBytes =
                actual
                        .trim()
                        .toLowerCase()
                        .getBytes(
                                StandardCharsets.UTF_8
                        );

        return MessageDigest.isEqual(
                expectedBytes,
                actualBytes
        );
    }

    /**
     * Возвращает Telegram user.
     */
    public JsonNode getTelegramUser(
            String initData
    ) {

        authenticate(initData);

        Map<String, String> params =
                parseInitData(initData);

        String userJson =
                params.get("user");

        if (userJson == null ||
                userJson.isBlank()) {

            throw new SecurityException(
                    "Telegram user отсутствует"
            );
        }

        try {

            return objectMapper.readTree(
                    userJson
            );

        } catch (Exception e) {

            throw new SecurityException(
                    "Не удалось прочитать Telegram user",
                    e
            );
        }
    }

    /**
     * Возвращает Telegram ID.
     */
    public Long getTelegramUserId(
            String initData
    ) {

        return authenticate(initData);
    }

    /**
     * Проверяет initData.
     */
    public boolean isValidInitData(
            String initData
    ) {

        try {

            authenticate(initData);

            return true;

        } catch (Exception e) {

            return false;
        }
    }
}