package com.example.RideMate.service;

import com.example.RideMate.entity.User;
import com.example.RideMate.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class PhoneVerificationService {

    private record PendingCode(String phone, String code, LocalDateTime expiresAt, LocalDateTime requestedAt) {}

    private static final int CODE_VALID_MINUTES = 10;
    private static final int RESEND_COOLDOWN_SECONDS = 60;

    private final Map<Long, PendingCode> pending = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final UserRepository userRepository;
    private final RestClient telegram = RestClient.create();

    @Value("${telegram.bot-token}")
    private String botToken;

    public PhoneVerificationService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    /** Пользователь ввёл телефон: нормализуем, шлём код в чат Telegram. */
    @Transactional
    public void requestCode(Long telegramId, String phoneRaw) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        if (user.getChatId() == null) {
            throw new RuntimeException("Напишите нашему боту /start в Telegram, чтобы получать сообщения");
        }
        if (Boolean.TRUE.equals(user.getPhoneVerified())) {
            throw new RuntimeException("Телефон уже подтверждён");
        }

        String phone = normalizePhone(phoneRaw);
        if (phone == null) {
            throw new RuntimeException("Введите телефон в формате +375XXXXXXXXX");
        }

        // Защита от спама повторными запросами
        PendingCode existing = pending.get(telegramId);
        if (existing != null && existing.requestedAt().plusSeconds(RESEND_COOLDOWN_SECONDS).isAfter(LocalDateTime.now())) {
            throw new RuntimeException("Код уже отправлен. Повторите через минуту.");
        }

        String code = String.format("%06d", random.nextInt(1_000_000));
        pending.put(telegramId, new PendingCode(phone, code,
                LocalDateTime.now().plusMinutes(CODE_VALID_MINUTES), LocalDateTime.now()));

        sendTelegramMessage(user.getChatId(),
                "🔐 Код подтверждения RideMate: " + code + "\nДействует " + CODE_VALID_MINUTES + " минут.");
    }

    /** Пользователь ввёл код из сообщения бота. */
    @Transactional
    public void verifyCode(Long telegramId, String codeRaw) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        PendingCode entry = pending.get(telegramId);
        if (entry == null) {
            throw new RuntimeException("Сначала запросите код");
        }
        if (entry.expiresAt().isBefore(LocalDateTime.now())) {
            pending.remove(telegramId);
            throw new RuntimeException("Код истёк, запросите новый");
        }
        if (!entry.code().equals(codeRaw == null ? "" : codeRaw.trim())) {
            throw new RuntimeException("Неверный код");
        }

        user.setPhone(entry.phone());
        user.setPhoneVerified(true);
        userRepository.save(user);
        pending.remove(telegramId);

        if (user.getChatId() != null) {
            sendTelegramMessage(user.getChatId(), "✅ Телефон подтверждён! Ваш профиль стал надёжнее для попутчиков.");
        }
    }

    /** Телефон в едином формате: +375XXXXXXXXX (или любая страна, если цифр 10–15). */
    private String normalizePhone(String raw) {
        if (raw == null) return null;
        String digits = raw.replaceAll("[^0-9]", "");
        if (raw.trim().startsWith("+375") && digits.startsWith("375") && digits.length() == 12) {
            return "+" + digits;
        }
        if (digits.length() >= 10 && digits.length() <= 15) {
            return "+" + digits;
        }
        return null;
    }

    private void sendTelegramMessage(Long chatId, String text) {
        try {
            telegram.post()
                    .uri("https://api.telegram.org/bot{token}/sendMessage", botToken.trim())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("chat_id", chatId, "text", text))
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            throw new RuntimeException("Не удалось отправить код в Telegram: " + e.getMessage());
        }
    }
}
