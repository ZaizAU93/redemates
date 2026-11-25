package com.example.RideMate.controller;

import com.example.RideMate.entity.SupportMessage;
import com.example.RideMate.repository.SupportMessageRepository;
import com.example.RideMate.repository.UserRepository;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/support")
@CrossOrigin
public class SupportController {

    private final SupportMessageRepository repository;
    private final TelegramAuthService authService;
    private final UserRepository userRepository;

    public SupportController(SupportMessageRepository repository,
                             TelegramAuthService authService,
                             UserRepository userRepository) {
        this.repository = repository;
        this.authService = authService;
        this.userRepository = userRepository;
    }

    /** Отправить обращение из мини-аппа. */
    @PostMapping
    public Map<String, Object> send(@RequestBody SupportRequest request,
                                    @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);

        String topic = request.topic() == null ? "" : request.topic().trim();
        if (!List.of("PROBLEM", "IDEA", "QUESTION").contains(topic)) {
            topic = "QUESTION";
        }
        String message = request.message() == null ? "" : request.message().trim();
        if (message.isEmpty()) {
            return Map.of("ok", false, "message", "Напишите текст обращения");
        }
        if (message.length() > 2000) {
            message = message.substring(0, 2000);
        }
        if (repository.countRecentByUser(telegramId, LocalDateTime.now().minusHours(24)) >= 5) {
            return Map.of("ok", false, "message", "Слишком много обращений за сутки. Попробуйте завтра.");
        }

        SupportMessage m = new SupportMessage();
        m.setUserTelegramId(telegramId);
        m.setTopic(topic);
        m.setMessage(message);
        repository.save(m);
        return Map.of("ok", true, "message", "Обращение отправлено! Мы его прочитаем.");
    }

    /** Свои обращения — чтобы пользователь видел, что не потерялось. */
    @GetMapping("/my")
    public List<Map<String, Object>> my(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return repository.findAll().stream()
                .filter(m -> m.getUserTelegramId().equals(telegramId))
                .sorted((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()))
                .limit(20)
                .map(m -> {
                    Map<String, Object> row = new HashMap<>();
                    row.put("topic", m.getTopic());
                    row.put("message", m.getMessage());
                    row.put("status", m.getStatus());
                    row.put("createdAt", m.getCreatedAt());
                    return row;
                })
                .collect(Collectors.toList());
    }

    public record SupportRequest(String topic, String message) {}

    // ---- Админская часть ----

    @GetMapping("/admin/all")
    public List<Map<String, Object>> all(@RequestHeader("X-Admin-Token") String token) {
        checkAdmin(token);
        return repository.findAllByOrderByStatusAscCreatedAtDesc().stream()
                .map(m -> {
                    Map<String, Object> row = new HashMap<>();
                    row.put("id", m.getId());
                    row.put("userTelegramId", m.getUserTelegramId());
                    row.put("userName", userRepository.findByTelegramId(m.getUserTelegramId())
                            .map(u -> u.getFirstName()).orElse("?"));
                    row.put("topic", m.getTopic());
                    row.put("message", m.getMessage());
                    row.put("status", m.getStatus());
                    row.put("createdAt", m.getCreatedAt());
                    return row;
                })
                .collect(Collectors.toList());
    }

    @PutMapping("/admin/{id}/resolve")
    public Map<String, Object> resolve(@PathVariable Long id,
                                       @RequestHeader("X-Admin-Token") String token) {
        checkAdmin(token);
        return repository.findById(id).map(m -> {
            m.setStatus("RESOLVED");
            repository.save(m);
            Map<String, Object> ok = new HashMap<>();
            ok.put("ok", true);
            return ok;
        }).orElseGet(() -> {
            Map<String, Object> err = new HashMap<>();
            err.put("ok", false);
            err.put("message", "Обращение не найдено");
            return err;
        });
    }

    @GetMapping("/admin/new-count")
    public Map<String, Object> newCount(@RequestHeader("X-Admin-Token") String token) {
        checkAdmin(token);
        return Map.of("new", repository.countByStatus("NEW"));
    }

    private void checkAdmin(String token) {
        if (token == null || !token.equals(adminToken)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Неверный админ-токен");
        }
    }

    @org.springframework.beans.factory.annotation.Value("${app.admin.token}")
    private String adminToken;
}
