package com.example.RideMate.controller;

import com.example.RideMate.entity.User;
import com.example.RideMate.repository.UserRepository;
import com.example.RideMate.service.PhoneVerificationService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/phone")
@CrossOrigin
public class PhoneController {

    private final PhoneVerificationService phoneVerificationService;
    private final TelegramAuthService authService;
    private final UserRepository userRepository;

    public PhoneController(PhoneVerificationService phoneVerificationService,
                           TelegramAuthService authService,
                           UserRepository userRepository) {
        this.phoneVerificationService = phoneVerificationService;
        this.authService = authService;
        this.userRepository = userRepository;
    }

    @PostMapping("/request")
    public Map<String, Object> request(@RequestBody PhoneRequest request,
                                       @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        phoneVerificationService.requestCode(telegramId, request.phone());
        return Map.of("ok", true, "message", "Код отправлен вам в чат с ботом");
    }

    @PostMapping("/verify")
    public Map<String, Object> verify(@RequestBody CodeRequest request,
                                      @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        phoneVerificationService.verifyCode(telegramId, request.code());
        return Map.of("ok", true, "message", "Телефон подтверждён");
    }

    @GetMapping("/status")
    public Map<String, Object> status(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        User user = userRepository.findByTelegramId(telegramId).orElse(null);
        if (user == null) return Map.of("verified", false);
        return Map.of(
                "phone", user.getPhone() == null ? "" : user.getPhone(),
                "verified", Boolean.TRUE.equals(user.getPhoneVerified()));
    }

    public record PhoneRequest(String phone) {}
    public record CodeRequest(String code) {}
}
