package com.example.RideMate.controller;

import com.example.RideMate.entity.RouteSubscription;
import com.example.RideMate.service.RouteSubscriptionService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/subscriptions")
public class RouteSubscriptionController {

    private final RouteSubscriptionService subscriptionService;
    private final TelegramAuthService authService;

    public RouteSubscriptionController(RouteSubscriptionService subscriptionService, TelegramAuthService authService) {
        this.subscriptionService = subscriptionService;
        this.authService = authService;
    }

    public record SubDTO(Long id, double fromLat, double fromLon, double toLat, double toLon,
                         Integer radiusMeters, String createdAt) {}

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body,
                                    @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        RouteSubscription sub = subscriptionService.create(
                telegramId,
                ((Number) body.get("fromLat")).doubleValue(),
                ((Number) body.get("fromLon")).doubleValue(),
                ((Number) body.get("toLat")).doubleValue(),
                ((Number) body.get("toLon")).doubleValue(),
                (Integer) body.getOrDefault("radiusMeters", 5000));
        return ResponseEntity.ok(toDTO(sub));
    }

    @GetMapping
    public List<SubDTO> getMy(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return subscriptionService.getMy(telegramId).stream().map(this::toDTO).toList();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id,
                                       @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        subscriptionService.delete(telegramId, id);
        return ResponseEntity.ok().build();
    }

    private SubDTO toDTO(RouteSubscription s) {
        return new SubDTO(s.getId(),
                s.getFromLocation().getY(), s.getFromLocation().getX(),
                s.getToLocation().getY(), s.getToLocation().getX(),
                s.getRadiusMeters(), s.getCreatedAt().toString());
    }
}
