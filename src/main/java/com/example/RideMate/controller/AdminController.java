package com.example.RideMate.controller;

import com.example.RideMate.entity.*;
import com.example.RideMate.repository.*;
import com.example.RideMate.service.MatchService;
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

    public AdminController(ReportRepository reportRepository,
                           UserRepository userRepository,
                           MatchRepository matchRepository,
                           RideRequestRepository rideRequestRepository,
                           MatchService matchService) {
        this.reportRepository = reportRepository;
        this.userRepository = userRepository;
        this.matchRepository = matchRepository;
        this.rideRequestRepository = rideRequestRepository;
        this.matchService = matchService;
    }

    private void check(String token) {
        if (token == null || !adminToken.equals(token)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Неверный админ-токен");
        }
    }

    public record AdminUserDTO(Long id, Long telegramId, String name, String username,
                               String status, Double rating, Integer tripCount, Integer noShowCount) {}

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
        switch (decision) {
            case "BAN" -> { target.setStatus(UserStatus.BANNED); report.setStatus(ReportStatus.REVIEWED); }
            case "UNBAN" -> { target.setStatus(UserStatus.ACTIVE); report.setStatus(ReportStatus.REVIEWED); }
            default -> report.setStatus(ReportStatus.DISMISSED);
        }
        userRepository.save(target);
        reportRepository.save(report);
        return Map.of("ok", true);
    }

    // ---------- Пользователи ----------

    @GetMapping("/users")
    public List<AdminUserDTO> users(@RequestParam(required = false) String q,
                                    @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        List<User> users = (q == null || q.isBlank())
                ? userRepository.findAll()
                : userRepository.findByFirstNameContainingIgnoreCaseOrUsernameContainingIgnoreCase(q, q);
        return users.stream()
                .map(u -> new AdminUserDTO(u.getId(), u.getTelegramId(), name(u),
                        u.getUsername(),
                        u.getStatus() == null ? "ACTIVE" : u.getStatus().name(),
                        u.getRating(), u.getTripCount(), u.getNoShowCount()))
                .toList();
    }

    @PostMapping("/users/{id}/ban")
    public Map<String, Object> ban(@PathVariable Long id,
                                   @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        check(token);
        userRepository.findById(id).ifPresent(u -> {
            u.setStatus(UserStatus.BANNED);
            userRepository.save(u);
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
