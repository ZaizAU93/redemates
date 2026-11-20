package com.example.RideMate.service;

import com.example.RideMate.entity.RouteSubscription;
import com.example.RideMate.entity.User;
import com.example.RideMate.repository.RouteSubscriptionRepository;
import com.example.RideMate.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class RouteSubscriptionService {

    private final RouteSubscriptionRepository subscriptionRepository;
    private final UserRepository userRepository;
    private final TelegramBotService telegramBotService;
    private final GeometryFactory geometryFactory;

    @Transactional
    public RouteSubscription create(Long telegramId, double fromLat, double fromLon,
                                    double toLat, double toLon, Integer radiusMeters) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        List<RouteSubscription> existing = subscriptionRepository.findByUserIdAndActive(user.getId(), true);
        if (existing.size() >= 5) {
            throw new RuntimeException("Максимум 5 активных подписок. Удалите одну из старых.");
        }

        RouteSubscription sub = new RouteSubscription();
        sub.setUser(user);
        sub.setFromLocation(geometryFactory.createPoint(new Coordinate(fromLon, fromLat)));
        sub.setToLocation(geometryFactory.createPoint(new Coordinate(toLon, toLat)));
        sub.setRadiusMeters(radiusMeters != null ? radiusMeters : 5000);
        return subscriptionRepository.save(sub);
    }

    @Transactional
    public void delete(Long telegramId, Long subscriptionId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        subscriptionRepository.deleteByIdAndUserId(subscriptionId, user.getId());
    }

    @Transactional(readOnly = true)
    public List<RouteSubscription> getMy(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return subscriptionRepository.findByUserIdAndActive(user.getId(), true);
    }
}
