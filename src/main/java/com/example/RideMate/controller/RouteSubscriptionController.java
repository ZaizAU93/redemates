package com.example.RideMate.controller;

import com.example.RideMate.entity.RouteSubscription;
import com.example.RideMate.service.RouteSubscriptionService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/subscriptions")
@CrossOrigin
public class RouteSubscriptionController {

    private final RouteSubscriptionService subscriptionService;
    private final TelegramAuthService authService;

    public RouteSubscriptionController(RouteSubscriptionService subscriptionService,
                                       TelegramAuthService authService) {
        this.subscriptionService = subscriptionService;
        this.authService = authService;
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody CreateSubscriptionRequest request,
                                      @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        RouteSubscription sub = subscriptionService.createSubscription(
                telegramId,
                request.fromLat(), request.fromLon(),
                request.toLat(), request.toLon(),
                request.radiusMeters()
        );
        return Map.of("ok", true, "id", sub.getId());
    }

    @GetMapping
    public List<SubscriptionDTO> getMy(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return subscriptionService.getUserSubscriptions(telegramId).stream()
                .map(SubscriptionDTO::from)
                .collect(Collectors.toList());
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id,
                                      @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        subscriptionService.deleteSubscription(telegramId, id);
        return Map.of("ok", true);
    }

    public record CreateSubscriptionRequest(double fromLat, double fromLon,
                                            double toLat, double toLon, int radiusMeters) {}

    public record SubscriptionDTO(Long id, double fromLat, double fromLon,
                                  double toLat, double toLon,
                                  int radiusMeters, String createdAt) {
        public static SubscriptionDTO from(RouteSubscription s) {
            // getY() = широта, getX() = долгота
            return new SubscriptionDTO(
                    s.getId(),
                    s.getFromLocation().getY(),
                    s.getFromLocation().getX(),
                    s.getToLocation().getY(),
                    s.getToLocation().getX(),
                    s.getRadiusMeters(),
                    s.getCreatedAt() != null ? s.getCreatedAt().toString() : null
            );
        }
    }
}