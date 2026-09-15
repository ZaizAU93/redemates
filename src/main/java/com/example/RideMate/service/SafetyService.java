package com.example.RideMate.service;


import com.example.RideMate.entity.*;
import com.example.RideMate.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SafetyService {

    private final UserRepository userRepository;
    private final ReportRepository reportRepository;
    private final UserBlockRepository userBlockRepository;

    public SafetyService(UserRepository userRepository,
                         ReportRepository reportRepository,
                         UserBlockRepository userBlockRepository) {
        this.userRepository = userRepository;
        this.reportRepository = reportRepository;
        this.userBlockRepository = userBlockRepository;
    }

    @Transactional
    public void reportUser(Long reporterTelegramId, Long reportedTelegramId,
                           String reason, String details) {
        User reporter = userRepository.findByTelegramId(reporterTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        User reported = userRepository.findByTelegramId(reportedTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        Report report = new Report();
        report.setReporter(reporter);
        report.setReported(reported);
        report.setReason(reason);
        report.setDetails(details);
        reportRepository.save(report);
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