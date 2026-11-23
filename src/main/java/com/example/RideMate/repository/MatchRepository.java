package com.example.RideMate.repository;

import com.example.RideMate.entity.Match;
import com.example.RideMate.entity.MatchStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface MatchRepository extends JpaRepository<Match, Long> {
    boolean existsByRideRequestIdAndResponderId(Long rideRequestId, Long responderId);
    List<Match> findByRideRequestId(Long rideRequestId);
    List<Match> findByResponderId(Long responderId);
    List<Match> findByRideRequestUserId(Long userId);
    List<Match> findByRideRequestIdAndStatus(Long rideRequestId, MatchStatus status);
    List<Match> findByStatusAndExpiresAtBefore(MatchStatus status, LocalDateTime time);

    @org.springframework.data.jpa.repository.Query(
            "select m from Match m where m.status = 'CONFIRMED' " +
                    "and (m.driverOutcome is not null or m.passengerOutcome is not null) " +
                    "and m.rideRequest.departureTime < :deadline")
    List<Match> findStaleOutcomes(@org.springframework.data.repository.query.Param("deadline") LocalDateTime deadline);

    List<Match> findByStatus(MatchStatus status);

}
