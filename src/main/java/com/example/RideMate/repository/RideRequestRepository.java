package com.example.RideMate.repository;

import com.example.RideMate.entity.RideRequest;
import com.example.RideMate.entity.RideStatus;
import org.locationtech.jts.geom.LineString;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface RideRequestRepository extends JpaRepository<RideRequest, Long> {

    @Query(value = """
        SELECT * FROM ride_requests
        WHERE role = :role
          AND status = 'ACTIVE'
          AND ST_DWithin(from_location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :radiusMeters)
        ORDER BY from_location <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
        LIMIT :limit
        """, nativeQuery = true)
    List<RideRequest> findNearbyRequests(
            @Param("role") String role,
            @Param("lat") double lat,
            @Param("lon") double lon,
            @Param("radiusMeters") double radiusMeters,
            @Param("limit") int limit
    );

    @Query(value = """
        SELECT * FROM ride_requests
        WHERE role = :role
          AND status = 'ACTIVE'
          AND ST_DWithin(from_location, ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326), :fromRadiusMeters)
          AND ST_DWithin(to_location, ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326), :toRadiusMeters)
        ORDER BY from_location <-> ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326)
        LIMIT :limit
        """, nativeQuery = true)
    List<RideRequest> findCompatibleRequests(
            @Param("role") String role,
            @Param("fromLat") double fromLat,
            @Param("fromLon") double fromLon,
            @Param("toLat") double toLat,
            @Param("toLon") double toLon,
            @Param("fromRadiusMeters") double fromRadiusMeters,
            @Param("toRadiusMeters") double toRadiusMeters,
            @Param("limit") int limit
    );

    List<RideRequest> findByUserId(Long userId);

    Optional<RideRequest> findFirstByUserIdAndStatus(Long userId, RideStatus status);

    @Modifying
    @Query("UPDATE RideRequest r SET r.status = 'CANCELLED' WHERE r.id = :id AND r.user.telegramId = :telegramId")
    int cancelRequest(@Param("id") Long id, @Param("telegramId") Long telegramId);

    @Modifying
    @Query("UPDATE RideRequest r SET r.status = 'COMPLETED' WHERE r.id = :id AND r.user.telegramId = :telegramId")
    int completeRide(@Param("id") Long id, @Param("telegramId") Long telegramId);

    @Modifying
    @Query("UPDATE RideRequest r SET r.availableSeats = r.availableSeats - :requestedSeats " +
            "WHERE r.id = :rideId AND r.availableSeats >= :requestedSeats AND r.status = 'ACTIVE'")
    int decrementSeats(@Param("rideId") Long rideId, @Param("requestedSeats") int requestedSeats);

    @Modifying
    @Query("UPDATE RideRequest r SET r.availableSeats = r.availableSeats + :seats " +
            "WHERE r.id = :rideId")
    int incrementSeats(@Param("rideId") Long rideId, @Param("seats") int seats);


    List<RideRequest> findByStatusAndDepartureTimeBefore(RideStatus status, LocalDateTime time);

    List<RideRequest> findByUserIdAndStatus(Long userId, RideStatus status);

    /**
     * Поиск заявок водителей, чей маршрут проходит рядом с точками пассажира
     * и в правильном направлении (from раньше to вдоль линии).
     */
    @Query(value = """
        SELECT * FROM ride_requests
        WHERE role = 'DRIVER'
          AND status = 'ACTIVE'
          AND route IS NOT NULL
          AND ST_DWithin(route, ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326), :fromRadiusMeters)
          AND ST_DWithin(route, ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326), :toRadiusMeters)
          AND ST_LineLocatePoint(route::geometry, ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326))
              < ST_LineLocatePoint(route::geometry, ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326))
          AND (available_seats IS NULL OR available_seats > 0)
        LIMIT :limit
        """, nativeQuery = true)
    List<RideRequest> findRequestsAlongRoute(
            @Param("fromLat") double fromLat,
            @Param("fromLon") double fromLon,
            @Param("toLat") double toLat,
            @Param("toLon") double toLon,
            @Param("fromRadiusMeters") double fromRadiusMeters,
            @Param("toRadiusMeters") double toRadiusMeters,
            @Param("limit") int limit
    );

    /**
     * Для водителя: заявки пассажиров, чьи точки лежат рядом с его маршрутом,
     * в правильном направлении.
     */
    @Query(value = """
        SELECT * FROM ride_requests
        WHERE role = 'PASSENGER'
          AND status = 'ACTIVE'
          AND ST_DWithin(:route, from_location, :fromRadiusMeters)
          AND ST_DWithin(:route, to_location, :toRadiusMeters)
          AND ST_LineLocatePoint(:route::geometry, from_location::geometry)
              < ST_LineLocatePoint(:route::geometry, to_location::geometry)
        LIMIT :limit
        """, nativeQuery = true)
    List<RideRequest> findPassengersAlongRoute(
            @Param("route") LineString route,
            @Param("fromRadiusMeters") double fromRadiusMeters,
            @Param("toRadiusMeters") double toRadiusMeters,
            @Param("limit") int limit
    );



}