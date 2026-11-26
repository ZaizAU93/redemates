package com.example.RideMate.service;

import com.example.RideMate.entity.RouteSubscription;
import com.example.RideMate.entity.User;
import com.example.RideMate.repository.RouteSubscriptionRepository;
import com.example.RideMate.repository.UserRepository;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class RouteSubscriptionService {

    private final RouteSubscriptionRepository repository;
    private final UserRepository userRepository;
    private final GeometryFactory geometryFactory = new GeometryFactory(new PrecisionModel(), 4326);

    public RouteSubscriptionService(RouteSubscriptionRepository repository, UserRepository userRepository) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    @Transactional
    public RouteSubscription createSubscription(Long telegramId, double fromLat, double fromLon,
                                                double toLat, double toLon, int radiusMeters) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        // Проверка дубликатов: сравниваем lat/lon через getY()/getX()
        List<RouteSubscription> existing = repository.findByUserId(user.getId());
        boolean isDuplicate = existing.stream().anyMatch(s ->
                Math.abs(s.getFromLocation().getY() - fromLat) < 0.0001 &&
                        Math.abs(s.getFromLocation().getX() - fromLon) < 0.0001 &&
                        Math.abs(s.getToLocation().getY() - toLat) < 0.0001 &&
                        Math.abs(s.getToLocation().getX() - toLon) < 0.0001
        );
        if (isDuplicate) {
            throw new RuntimeException("Вы уже подписаны на этот маршрут");
        }

        RouteSubscription sub = new RouteSubscription();
        sub.setUser(user);
        // ВНИМАНИЕ: Coordinate(lon, lat) — X это долгота, Y это широта
        sub.setFromLocation(geometryFactory.createPoint(new Coordinate(fromLon, fromLat)));
        sub.setToLocation(geometryFactory.createPoint(new Coordinate(toLon, toLat)));
        sub.setRadiusMeters(radiusMeters);
        sub.setActive(true);
        sub.setCreatedAt(LocalDateTime.now());

        return repository.save(sub);
    }

    @Transactional(readOnly = true)
    public List<RouteSubscription> getUserSubscriptions(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return repository.findByUserIdAndActiveTrue(user.getId());
    }

    @Transactional
    public void deleteSubscription(Long telegramId, Long subscriptionId) {
        RouteSubscription sub = repository.findById(subscriptionId)
                .orElseThrow(() -> new RuntimeException("Подписка не найдена"));
        if (!sub.getUser().getTelegramId().equals(telegramId)) {
            throw new RuntimeException("Можно удалить только свою подписку");
        }
        repository.delete(sub);
    }
}