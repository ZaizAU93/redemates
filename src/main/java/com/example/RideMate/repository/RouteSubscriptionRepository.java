package com.example.RideMate.repository;

import com.example.RideMate.entity.RouteSubscription;
import org.locationtech.jts.geom.Point;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface RouteSubscriptionRepository extends JpaRepository<RouteSubscription, Long> {

    List<RouteSubscription> findByUserIdAndActive(Long userId, Boolean active);

    /**
     * Подписки, у которых обе точки рядом с новым маршрутом водителя.
     * Упрощённый вариант: совпадение по from и to с допуском.
     */
    @Query(value = """
        SELECT s.* FROM route_subscriptions s
        WHERE s.active = TRUE
          AND ST_DWithin(s.from_location, ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326), s.radius_meters)
          AND ST_DWithin(s.to_location, ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326), s.radius_meters)
        """, nativeQuery = true)
    List<RouteSubscription> findMatchingSubscriptions(
            @Param("fromLat") double fromLat,
            @Param("fromLon") double fromLon,
            @Param("toLat") double toLat,
            @Param("toLon") double toLon
    );

    @Modifying
    @Query("DELETE FROM RouteSubscription s WHERE s.user.id = :userId AND s.id = :subscriptionId")
    int deleteByIdAndUserId(@Param("subscriptionId") Long subscriptionId, @Param("userId") Long userId);
}
