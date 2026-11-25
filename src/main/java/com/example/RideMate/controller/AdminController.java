package com.example.RideMate.controller;

import com.example.RideMate.entity.*;
import com.example.RideMate.repository.*;
import com.example.RideMate.service.MatchService;
import com.example.RideMate.service.TelegramBotService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    @Value("${app.admin.token}")
    private String adminToken;

    private final ReportRepository reportRepository;
    private final UserRepository userRepository;
    private final MatchRepository matchRepository;
    private final RideRequestRepository rideRequestRepository;
    private final MatchService matchService;

    private final TelegramBotService telegramBotService; // Добавьте это поле

    private final VehicleRepository vehicleRepository; // <-- ДОБАВИТЬ

    public AdminController(ReportRepository reportRepository,
                           UserRepository userRepository,
                           MatchRepository matchRepository,
                           RideRequestRepository rideRequestRepository,
                           MatchService matchService,
                           TelegramBotService telegramBotService,
                           VehicleRepository vehicleRepository) { // <-- ДОБАВИТЬ
        this.reportRepository = reportRepository;
        this.userRepository = userRepository;
        this.matchRepository = matchRepository;
        this.rideRequestRepository = rideRequestRepository;
        this.matchService = matchService;
        this.telegramBotService = telegramBotService;
        this.vehicleRepository = vehicleRepository; // <-- ДОБАВИТЬ
    }
    private void check(String token) {
        if (token == null || !adminToken.equals(token)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Неверный админ-токен");
        }
    }

    public record AdminUserDTO(
            Long id,
            Long telegramId,
            String name,
            String username,
            String status,
            Double rating,
            Integer tripCount,
            Integer noShowCount,
            String phone,
            Boolean phoneVerified,
            String role,
            String vehicleBrand,
            String vehicleModel,
            String vehicleColor,
            Integer vehicleSeats
    ) {}

    public record AdminReportDTO(Long id, String reporter, Long reporterTg, String reported,
                                 Long reportedTg, String reason, String details, String status,
                                 String reportedStatus, LocalDateTime createdAt) {}

    // ---------- Жалобы ----------

    @GetMapping("/reports")
    public List<AdminReportDTO> reports(@RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        return reportRepository.findByStatusOrderByCreatedAtDesc(ReportStatus.NEW).stream()
                .map(r -> new AdminReportDTO(
                        r.getId(),
                        name(r.getReporter()), r.getReporter().getTelegramId(),
                        name(r.getReported()), r.getReported().getTelegramId(),
                        r.getReason(), r.getDetails(),
                        r.getStatus().name(), r.getReported().getStatus().name(),
                        r.getCreatedAt()))
                .toList();
    }

    /** decision: BAN — забанить, UNBAN — снять ограничения, DISMISS — отклонить жалобу. */
    @PostMapping("/reports/{id}/resolve")
    public Map<String, Object> resolveReport(@PathVariable Long id,
                                             @RequestParam String decision,
                                             @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        Report report = reportRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        User target = report.getReported();
        User reporter = report.getReporter();

        String targetMsg = null;
        String reporterMsg = null;

        switch (decision) {
            case "BAN" -> {
                target.setStatus(UserStatus.BANNED);
                report.setStatus(ReportStatus.REVIEWED);
                targetMsg = "🚫 Ваш аккаунт заблокирован модератором на основании жалобы. " +
                        "Причина: " + report.getReason() + ". Если считаете это ошибкой — свяжитесь с поддержкой.";
                reporterMsg = "✅ Ваша жалоба на пользователя рассмотрена. Нарушитель заблокирован. Спасибо!";
            }
            case "UNBAN" -> {
                target.setStatus(UserStatus.ACTIVE);
                report.setStatus(ReportStatus.REVIEWED);
                targetMsg = "✅ Ограничения с вашего аккаунта сняты. Приятных поездок!";
                reporterMsg = "ℹ️ Ваша жалоба рассмотрена. Ограничения с пользователя сняты.";
            }
            default -> {
                report.setStatus(ReportStatus.DISMISSED);
                targetMsg = "ℹ️ Жалоба на вас была отклонена модератором. Ограничения не наложены.";
                reporterMsg = "ℹ️ Ваша жалоба рассмотрена и отклонена.";
            }
        }

        userRepository.save(target);
        reportRepository.save(report);

        // 🔥 Отправка уведомлений
        if (targetMsg != null && target.getChatId() != null) telegramBotService.sendMessage(target.getChatId(), targetMsg);
        if (reporterMsg != null && reporter.getChatId() != null) telegramBotService.sendMessage(reporter.getChatId(), reporterMsg);

        return Map.of("ok", true);
    }

    // ---------- Пользователи ----------

    @GetMapping("/users")
    public List<AdminUserDTO> users(@RequestParam(required = false) String q,
                                    @RequestParam(required = false) String status,
                                    @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);

        List<User> users;
        if (status != null && !status.isBlank()) {
            users = userRepository.findByStatus(UserStatus.valueOf(status.toUpperCase()));
        } else if (q != null && !q.isBlank()) {
            try {
                Long tgId = Long.parseLong(q);
                users = userRepository.findByTelegramId(tgId)
                        .map(List::of)
                        .orElseGet(() -> userRepository
                                .findByFirstNameContainingIgnoreCaseOrUsernameContainingIgnoreCase(q, q));
            } catch (NumberFormatException e) {
                users = userRepository
                        .findByFirstNameContainingIgnoreCaseOrUsernameContainingIgnoreCase(q, q);
            }
        } else {
            users = userRepository.findAll();
        }

        return users.stream().map(u -> {
            Vehicle v = (u.getRole() == Role.DRIVER)
                    ? vehicleRepository.findFirstByOwnerIdOrderByCreatedAtDesc(u.getId())
                    : null;
            return new AdminUserDTO(
                    u.getId(),
                    u.getTelegramId(),
                    name(u),
                    u.getUsername(),
                    u.getStatus() == null ? "ACTIVE" : u.getStatus().name(),
                    u.getRating(),
                    u.getTripCount(),
                    u.getNoShowCount(),
                    u.getPhone(),
                    Boolean.TRUE.equals(u.getPhoneVerified()),
                    u.getRole() != null ? u.getRole().name() : null,
                    v != null ? v.getBrand() : null,
                    v != null ? v.getModel() : null,
                    v != null ? v.getColor() : null,
                    v != null ? v.getSeats() : null
            );
        }).toList();
    }

    @PostMapping("/users/{id}/ban")
    public Map<String, Object> ban(@PathVariable Long id,
                                   @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        userRepository.findById(id).ifPresent(u -> {
            u.setStatus(UserStatus.BANNED);
            userRepository.save(u);
            if (u.getChatId() != null) {
                telegramBotService.sendMessage(u.getChatId(), "🚫 Ваш аккаунт заблокирован модератором.");
            }
        });
        return Map.of("ok", true);
    }

    @PostMapping("/users/{id}/unban")
    public Map<String, Object> unban(@PathVariable Long id,
                                     @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        userRepository.findById(id).ifPresent(u -> {
            u.setStatus(UserStatus.ACTIVE);
            userRepository.save(u);
            if (u.getChatId() != null) {
                telegramBotService.sendMessage(u.getChatId(), "✅ Ограничения с вашего аккаунта сняты.");
            }
        });
        return Map.of("ok", true);
    }

    // ---------- Спорные поездки ----------

    @GetMapping("/disputes")
    public List<Map<String, Object>> disputes(@RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        return matchRepository.findByStatus(MatchStatus.DISPUTED).stream()
                .map(m -> {
                    RideRequest ride = m.getRideRequest();
                    return Map.<String, Object>of(
                            "matchId", m.getId(),
                            "rideRequestId", ride.getId(),
                            "owner", name(ride.getUser()) + " (tg " + ride.getUser().getTelegramId() + ")",
                            "responder", name(m.getResponder()) + " (tg " + m.getResponder().getTelegramId() + ")",
                            "ownerIsDriver", ride.getRole() == Role.DRIVER,
                            "driverOutcome", String.valueOf(m.getDriverOutcome()),
                            "passengerOutcome", String.valueOf(m.getPassengerOutcome()),
                            "departureTime", String.valueOf(ride.getDepartureTime()));
                })
                .toList();
    }

    /** decision: DRIVER / PASSENGER / VOID. */
    @PostMapping("/disputes/{matchId}/resolve")
    public Map<String, Object> resolveDispute(@PathVariable Long matchId,
                                              @RequestParam String decision,
                                              @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        matchService.resolveDispute(matchId, decision);
        return Map.of("ok", true);
    }

    // ---------- Статистика ----------

    @GetMapping("/stats")
    public Map<String, Object> stats(@RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        return Map.of(
                "users", userRepository.count(),
                "restricted", userRepository.countByStatus(UserStatus.RESTRICTED),
                "banned", userRepository.countByStatus(UserStatus.BANNED),
                "activeRides", rideRequestRepository.countByStatus(RideStatus.ACTIVE),
                "completedRides", rideRequestRepository.countByStatus(RideStatus.COMPLETED),
                "newReports", reportRepository.findByStatusOrderByCreatedAtDesc(ReportStatus.NEW).size()
        );
    }

    private String name(User u) {
        return (u.getFirstName() == null ? "" : u.getFirstName())
                + (u.getLastName() == null ? "" : " " + u.getLastName());
    }
}
