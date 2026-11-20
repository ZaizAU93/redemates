package com.example.RideMate.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

@Service
public class AuthService {

    @Value("${telegram.bot-token}")
    private String botToken;

    /**
     * Проверяет Telegram InitData и возвращает telegram_id пользователя.
     * Бросает исключение, если данные не прошли проверку.
     */
    public Long authenticate(String initData) {
        if (initData == null || initData.isBlank()) {
            throw new RuntimeException("Не авторизован: отсутствуют данные Telegram");
        }

        Map<String, String> params = parseInitData(initData);

        String receivedHash = params.get("hash");
        if (receivedHash == null || receivedHash.isBlank()) {
            throw new RuntimeException("Не авторизован: нет подписи");
        }

        if (!isValidSignature(params, receivedHash)) {
            throw new RuntimeException("Не авторизован: подпись не совпадает");
        }

        String userJson = params.get("user");
        if (userJson == null) {
            throw new RuntimeException("Не авторизован: нет данных пользователя");
        }

        String telegramIdStr = extractTelegramId(userJson);
        try {
            return Long.parseLong(telegramIdStr);
        } catch (NumberFormatException e) {
            throw new RuntimeException("Не авторизован: некорректный telegram_id");
        }
    }

    private Map<String, String> parseInitData(String initData) {
        Map<String, String> params = new HashMap<>();
        for (String pair : initData.split("&")) {
            int idx = pair.indexOf('=');
            if (idx > 0) {
                String key = pair.substring(0, idx);
                String value = URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8);
                params.put(key, value);
            }
        }
        return params;
    }

    private boolean isValidSignature(Map<String, String> params, String receivedHash) {
        // 1. Строка из всех параметров, кроме hash, отсортированных по ключу
        String dataCheckString = params.entrySet().stream()
                .filter(e -> !e.getKey().equals("hash"))
                .sorted(Map.Entry.comparingByKey())
                .map(e -> e.getKey() + "=" + e.getValue())
                .reduce((a, b) -> a + "\n" + b)
                .orElse("");

        try {
            // 2. Секрет = HMAC_SHA256(botToken, ключ "WebAppData")
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec("WebAppData".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] secretKey = mac.doFinal(botToken.getBytes(StandardCharsets.UTF_8));

            // 3. Итоговая подпись = HMAC_SHA256(dataCheckString, secretKey)
            mac.init(new SecretKeySpec(secretKey, "HmacSHA256"));
            byte[] computed = mac.doFinal(dataCheckString.getBytes(StandardCharsets.UTF_8));

            String computedHex = bytesToHex(computed);
            return computedHex.equalsIgnoreCase(receivedHash);
        } catch (Exception e) {
            throw new RuntimeException("Ошибка проверки подписи", e);
        }
    }

    private String extractTelegramId(String userJson) {
        // Лёгкий парсер без Джексона: достаём "id":N из JSON пользователя
        String marker = "\"id\":";
        int start = userJson.indexOf(marker);
        if (start == -1) throw new RuntimeException("Не найден id пользователя в initData");
        start += marker.length();
        int end = start;
        while (end < userJson.length() && (Character.isDigit(userJson.charAt(end)))) end++;
        return userJson.substring(start, end);
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
