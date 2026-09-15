package com.example.RideMate.controller;


import com.example.RideMate.service.SafetyService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/safety")
@CrossOrigin
public class SafetyController {

    private final SafetyService safetyService;
    private final TelegramAuthService authService;

    public SafetyController(SafetyService safetyService, TelegramAuthService authService) {
        this.safetyService = safetyService;
        this.authService = authService;
    }

    @PostMapping("/report")
    public void reportUser(@RequestBody ReportRequest request,
                           @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long reporterId = authService.authenticate(initData);
        safetyService.reportUser(reporterId, request.reportedTelegramId(), request.reason(), request.details());
    }

    @PostMapping("/block")
    public void blockUser(@RequestBody BlockRequest request,
                          @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long blockerId = authService.authenticate(initData);
        safetyService.blockUser(blockerId, request.blockedTelegramId());
    }

    public record ReportRequest(Long reportedTelegramId, String reason, String details) {}
    public record BlockRequest(Long blockedTelegramId) {}
}