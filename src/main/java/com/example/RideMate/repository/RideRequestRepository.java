package com.example.RideMate.repository;

import com.example.RideMate.entity.RideRequest;
import com.example.RideMate.entity.RideStatus;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Point;
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
     * CAST вместо :: — иначе Hibernate путает двоеточие с именованным параметром
     * (ошибка "No argument for named parameter ':route::geometry'").
     */
    @Query(value = """
        SELECT * FROM ride_requests
        WHERE role = 'DRIVER'
          AND status = 'ACTIVE'
          AND route IS NOT NULL
          AND ST_DWithin(route, ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326), :fromRadiusMeters)
          AND ST_DWithin(route, ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326), :toRadiusMeters)
          AND ST_LineLocatePoint(CAST(route AS geometry), ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326))
              < ST_LineLocatePoint(CAST(route AS geometry), ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326))
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
     * CAST вместо :: — иначе Hibernate путает двоеточие с именованным параметром.
     */
    @Query(value = """
        SELECT * FROM ride_requests
        WHERE role = 'PASSENGER'
          AND status = 'ACTIVE'
          AND ST_DWithin(CAST(:route AS geometry), from_location, :fromRadiusMeters)
          AND ST_DWithin(CAST(:route AS geometry), to_location, :toRadiusMeters)
          AND ST_LineLocatePoint(CAST(:route AS geometry), from_location)
              < ST_LineLocatePoint(CAST(:route AS geometry), to_location)
        LIMIT :limit
        """, nativeQuery = true)
    List<RideRequest> findPassengersAlongRoute(
            @Param("route") LineString route,
            @Param("fromRadiusMeters") double fromRadiusMeters,
            @Param("toRadiusMeters") double toRadiusMeters,
            @Param("limit") int limit
    );



    /**
     * Поиск «по пути»: маршрут кандидата — сохранённая линия route,
     * а если её нет — прямая от «Откуда» до «Куда».
     * Обе точки ищущего должны лежать в радиусе от маршрута
     * и в правильном направлении (from раньше to вдоль линии).
     * CAST вместо :: — Hibernate путает двоеточие с именованным параметром.
     */
    @Query(value = """
        SELECT * FROM ride_requests
        WHERE role = :role
          AND status = 'ACTIVE'
          AND (available_seats IS NULL OR available_seats > 0)
          AND ST_DWithin(
                COALESCE(route, CAST(ST_MakeLine(CAST(from_location AS geometry), CAST(to_location AS geometry)) AS geography)),
                CAST(ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326) AS geography),
                :fromRadiusMeters)
          AND ST_DWithin(
                COALESCE(route, CAST(ST_MakeLine(CAST(from_location AS geometry), CAST(to_location AS geometry)) AS geography)),
                CAST(ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326) AS geography),
                :toRadiusMeters)
          AND ST_LineLocatePoint(
                CAST(COALESCE(route, CAST(ST_MakeLine(CAST(from_location AS geometry), CAST(to_location AS geometry)) AS geography)) AS geometry),
                ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326))
              < ST_LineLocatePoint(
                CAST(COALESCE(route, CAST(ST_MakeLine(CAST(from_location AS geometry), CAST(to_location AS geometry)) AS geography)) AS geometry),
                ST_SetSRID(ST_MakePoint(:toLon, :toLat), 4326))
        ORDER BY ST_Distance(
                COALESCE(route, CAST(ST_MakeLine(CAST(from_location AS geometry), CAST(to_location AS geometry)) AS geography)),
                CAST(ST_SetSRID(ST_MakePoint(:fromLon, :fromLat), 4326) AS geography))
        LIMIT :limit
        """, nativeQuery = true)
    List<RideRequest> findRidesAlongPath(
            @Param("role") String role,
            @Param("fromLat") double fromLat,
            @Param("fromLon") double fromLon,
            @Param("toLat") double toLat,
            @Param("toLon") double toLon,
            @Param("fromRadiusMeters") double fromRadiusMeters,
            @Param("toRadiusMeters") double toRadiusMeters,
            @Param("limit") int limit
    );

    long countByStatus(RideStatus status);

    List<RideRequest> findByStatusInAndDepartureTimeBetweenAndReminderSentFalse(
            List<RideStatus> statuses,
            LocalDateTime start,
            LocalDateTime end
    );

    List<RideRequest> findByUserIdAndStatusIn(Long userId, List<RideStatus> statuses);

    @Query("SELECT r FROM RideRequest r WHERE r.status IN " +
            "(com.example.RideMate.entity.RideStatus.ACTIVE, com.example.RideMate.entity.RideStatus.MATCHED) " +
            "AND ST_Distance(r.fromLocation, :userPoint) <= :radius " +
            "AND r.user.id != :excludeUserId")
    List<RideRequest> findActiveRidesNearLocation(
            @Param("userPoint") Point userPoint,
            @Param("radius") int radiusMeters,
            @Param("excludeUserId") Long excludeUserId);
}
