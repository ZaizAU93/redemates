package com.example.RideMate.service;

import com.example.RideMate.entity.*;
import com.example.RideMate.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SafetyService {

    private static final int RESTRICT_THRESHOLD = 2; // жалоб от разных людей
    private static final int BAN_THRESHOLD = 3;

    private final UserRepository userRepository;
    private final ReportRepository reportRepository;
    private final UserBlockRepository userBlockRepository;
    private final TelegramBotService telegramBotService;

    public SafetyService(UserRepository userRepository,
                         ReportRepository reportRepository,
                         UserBlockRepository userBlockRepository,
                         TelegramBotService telegramBotService) {
        this.userRepository = userRepository;
        this.reportRepository = reportRepository;
        this.userBlockRepository = userBlockRepository;
        this.telegramBotService = telegramBotService;
    }

    @Transactional
    public void reportUser(Long reporterTelegramId, Long reportedTelegramId,
                           String reason, String details) {
        User reporter = userRepository.findByTelegramId(reporterTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        User reported = userRepository.findByTelegramId(reportedTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        if (reporter.getId().equals(reported.getId())) {
            throw new RuntimeException("Нельзя жаловаться на себя");
        }
        if (reportRepository.existsByReporterIdAndReportedId(reporter.getId(), reported.getId())) {
            throw new RuntimeException("Вы уже отправляли жалобу на этого пользователя");
        }

        Report report = new Report();
        report.setReporter(reporter);
        report.setReported(reported);
        report.setReason(reason);
        report.setDetails(details);
        reportRepository.save(report);

        long distinctComplaints = reportRepository.countDistinctReporters(reported.getId());
        if (distinctComplaints >= BAN_THRESHOLD) {
            reported.setStatus(UserStatus.BANNED);
            userRepository.save(reported);
            notify(reported, "🚫 Ваш аккаунт заблокирован после нескольких жалоб. " +
                    "Если считаете это ошибкой — свяжитесь с поддержкой.");
        } else if (distinctComplaints >= RESTRICT_THRESHOLD && reported.getStatus() == UserStatus.ACTIVE) {
            reported.setStatus(UserStatus.RESTRICTED);
            userRepository.save(reported);
            notify(reported, "⚠️ На вас поступило несколько жалоб: ваши заявки скрыты из поиска " +
                    "до проверки модератором. Ограничение снимут, если жалобы окажутся необоснованными.");
        }
    }

    // ---------- Действия модератора (использует админка) ----------

    @Transactional
    public void setModerationStatus(Long userId, UserStatus status) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        user.setStatus(status);
        userRepository.save(user);
        if (status == UserStatus.BANNED) {
            notify(user, "🚫 Ваш аккаунт заблокирован модератором.");
        } else if (status == UserStatus.ACTIVE) {
            notify(user, "✅ Ограничения с вашего аккаунта сняты. Приятных поездок!");
        }
    }

    private void notify(User user, String text) {
        if (user != null && user.getChatId() != null) {
            telegramBotService.sendMessage(user.getChatId(), text);
        }
    }

    @Transactional
    public void blockUser(Long blockerTelegramId, Long blockedTelegramId) {
        User blocker = userRepository.findByTelegramId(blockerTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        User blocked = userRepository.findByTelegramId(blockedTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        if (!userBlockRepository.existsByBlockerIdAndBlockedId(blocker.getId(), blocked.getId())) {
            UserBlock block = new UserBlock();
            block.setBlocker(blocker);
            block.setBlocked(blocked);
            userBlockRepository.save(block);
        }
    }

    public boolean isBlocked(Long userTelegramId, Long otherTelegramId) {
        User user = userRepository.findByTelegramId(userTelegramId).orElse(null);
        User other = userRepository.findByTelegramId(otherTelegramId).orElse(null);
        if (user == null || other == null) return false;
        return userBlockRepository.existsByBlockerIdAndBlockedId(user.getId(), other.getId());
    }
}
